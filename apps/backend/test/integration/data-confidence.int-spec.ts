import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataConfidenceController } from '../../src/data-confidence/data-confidence.controller';
import { DataConfidenceService } from '../../src/data-confidence/data-confidence.service';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SessionModule } from '../../src/session/session.module';
import { SESSION_COOKIE, SessionService } from '../../src/session/session.service';
import { resetDb, seedCompetitor, seedProduct, seedStore, type SeededStore } from './db';
import { envModule } from './support';

const DAY = 24 * 3_600_000;

describe('data confidence read model (real PostgreSQL + HTTP)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sessions: SessionService;
  let base: string;
  let a: SeededStore;
  let b: SeededStore;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [envModule(), PrismaModule, SessionModule],
      controllers: [DataConfidenceController],
      providers: [DataConfidenceService],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    prisma = moduleRef.get(PrismaService);
    sessions = moduleRef.get(SessionService);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDb(prisma);
    a = await seedStore(prisma);
    b = await seedStore(prisma);
  });

  const cookie = (s: SeededStore) =>
    `${SESSION_COOKIE}=${encodeURIComponent(sessions.issue({ tenantId: s.tenantId, storeId: s.storeId }))}`;

  async function api(path: string, as?: SeededStore) {
    const res = await fetch(`${base}${path}`, { headers: as ? { cookie: cookie(as) } : {} });
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  }

  async function audit(
    s: SeededStore,
    over: {
      entityType?: string;
      entityId?: string;
      score: number;
      status: 'PASSED' | 'WARNING' | 'FAILED';
      checks: unknown;
      ageMs?: number;
    },
  ) {
    return prisma.dataConfidenceAudit.create({
      data: {
        tenantId: s.tenantId,
        storeId: s.storeId,
        entityType: over.entityType ?? 'competitor',
        entityId: over.entityId ?? randomUUID(),
        source: 'recommendation_engine',
        confidenceScore: over.score,
        status: over.status,
        checks: over.checks as never,
        createdAt: new Date(Date.now() - (over.ageMs ?? 1000)),
      },
    });
  }

  const good = [
    { name: 'price_freshness', score: 1, detail: 'observed 2h ago' },
    { name: 'cost_known', score: 1, detail: 'cost price available' },
  ];
  const weak = [
    { name: 'price_freshness', score: 0.5, detail: 'observed 100h ago' },
    { name: 'cost_known', score: 0.6, detail: 'cost price missing' },
  ];

  it('summarises the 30-day window per status and per check, weakest check first', async () => {
    await audit(a, { score: 0.95, status: 'PASSED', checks: good, ageMs: 1000 }); // newest
    await audit(a, { score: 0.55, status: 'WARNING', checks: weak, ageMs: 2000 });
    await audit(a, { score: 0.3, status: 'FAILED', checks: weak, ageMs: 3000 });
    await audit(a, { score: 0.1, status: 'FAILED', checks: weak, ageMs: 40 * DAY }); // outside window
    await audit(b, { score: 0.9, status: 'PASSED', checks: good }); // other store

    const { json } = await api('/api/v1/data-confidence', a);

    expect(json.summary).toMatchObject({
      windowDays: 30,
      auditsCount: 3,
      byStatus: { PASSED: 1, WARNING: 1, FAILED: 1 },
      averageScore: 60, // (0.95 + 0.55 + 0.30) / 3
    });
    // price_freshness: (1 + .5 + .5)/3 = 67; cost_known: (1 + .6 + .6)/3 = 73
    expect(json.summary.checks).toEqual([
      { name: 'price_freshness', averageScore: 67, count: 3 },
      { name: 'cost_known', averageScore: 73, count: 3 },
    ]);
    // The list is not window-limited, newest first.
    expect(json.total).toBe(4);
    expect(json.items[0].score).toBe(95);
  });

  it('survives malformed producer JSON instead of failing the page', async () => {
    await audit(a, { score: 0.8, status: 'PASSED', checks: { not: 'an array' } });
    await audit(a, { score: 0.7, status: 'PASSED', checks: [null, 'x', 7, { name: 'ok', score: 0.5 }] });
    await audit(a, {
      score: 0.6,
      status: 'WARNING',
      checks: [
        { name: 'bad_score', score: '0.9' },
        { score: 0.4 },
        { name: 'real', score: 0.4, detail: 42 },
      ],
    });

    const { status, json } = await api('/api/v1/data-confidence', a);

    expect(status).toBe(200);
    expect(json.summary.checks).toEqual([
      { name: 'ok', averageScore: 50, count: 1 },
      { name: 'real', averageScore: 40, count: 1 },
    ].sort((x, y) => x.averageScore - y.averageScore));
    const byScore = Object.fromEntries(json.items.map((i: any) => [i.score, i.checks]));
    expect(byScore[80]).toEqual([]);
    expect(byScore[70]).toEqual([{ name: 'ok', score: 50, detail: null }]);
    expect(byScore[60]).toEqual([{ name: 'real', score: 40, detail: null }]);
  });

  it('resolves competitor/product names, tolerates deleted entities, and links the recommendation', async () => {
    const product = await seedProduct(prisma, a, { name: 'Beans' });
    const rival = await seedCompetitor(prisma, a, {
      productId: product.id,
      name: 'Rival Co',
      domain: 'rival.example.com',
    });
    const withRec = await audit(a, {
      entityId: rival.id,
      score: 0.9,
      status: 'PASSED',
      checks: good,
      ageMs: 3000,
    });
    await prisma.decisionRecommendation.create({
      data: {
        tenantId: a.tenantId,
        storeId: a.storeId,
        productId: product.id,
        confidenceAuditId: withRec.id,
        type: 'PRICE_ADJUSTMENT',
        title: 'خفض السعر',
        rationale: 'r',
        payload: {},
      },
    });
    await audit(a, { entityType: 'product', entityId: product.id, score: 0.8, status: 'PASSED', checks: good, ageMs: 2000 });
    await audit(a, { entityId: randomUUID(), score: 0.7, status: 'PASSED', checks: good, ageMs: 1000 });
    // An entity of another store with the same shape must never be resolved.
    const foreign = await seedCompetitor(prisma, b, { name: 'Foreign Rival' });
    await audit(a, { entityId: foreign.id, score: 0.6, status: 'WARNING', checks: weak, ageMs: 500 });

    const { json } = await api('/api/v1/data-confidence', a);
    const items = json.items as any[];

    const byScore = (s: number) => items.find((i) => i.score === s);
    expect(byScore(90)).toMatchObject({
      entity: { name: 'Rival Co', domain: 'rival.example.com' },
      recommendation: { title: 'خفض السعر', status: 'PENDING' },
    });
    expect(byScore(80).entity).toMatchObject({ name: 'Beans', domain: null });
    expect(byScore(70).entity).toBeNull();
    expect(byScore(60).entity).toBeNull();
    expect(byScore(60).recommendation).toBeNull();
  });

  it('filters by status and paginates', async () => {
    for (let i = 0; i < 5; i++) {
      await audit(a, { score: 0.9, status: 'PASSED', checks: good, ageMs: 1000 + i });
    }
    await audit(a, { score: 0.2, status: 'FAILED', checks: weak });

    const failed = await api('/api/v1/data-confidence?status=FAILED', a);
    expect(failed.json.total).toBe(1);
    expect(failed.json.items[0].status).toBe('FAILED');
    // Summary always describes the whole window, whatever the list filter.
    expect(failed.json.summary.auditsCount).toBe(6);

    const page2 = await api('/api/v1/data-confidence?pageSize=4&page=2', a);
    expect(page2.json.items).toHaveLength(2);
    expect(page2.json.total).toBe(6);
  });

  it('is empty-safe, requires a session, and rejects bad queries', async () => {
    const empty = await api('/api/v1/data-confidence', a);
    expect(empty.json.summary).toMatchObject({
      auditsCount: 0,
      averageScore: null,
      byStatus: { PASSED: 0, WARNING: 0, FAILED: 0 },
      checks: [],
    });
    expect(empty.json.items).toEqual([]);

    expect((await api('/api/v1/data-confidence')).status).toBe(401);
    expect((await api('/api/v1/data-confidence?status=GREAT', a)).status).toBe(400);
    expect((await api('/api/v1/data-confidence?pageSize=500', a)).status).toBe(400);
  });
});
