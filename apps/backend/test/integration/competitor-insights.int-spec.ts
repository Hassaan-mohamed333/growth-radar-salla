import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { CompetitorInsightsController } from '../../src/competitor-insights/competitor-insights.controller';
import { CompetitorInsightsService } from '../../src/competitor-insights/competitor-insights.service';
import { CompetitorsService } from '../../src/competitors/competitors.service';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SessionModule } from '../../src/session/session.module';
import { SESSION_COOKIE, SessionService } from '../../src/session/session.service';
import { resetDb, seedProduct, seedStore, type SeededStore } from './db';

describe('Competitor insights over HTTP against real PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sessions: SessionService;
  let competitors: CompetitorsService;
  let base: string;
  let a: SeededStore;
  let b: SeededStore;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              NODE_ENV: 'test',
              SESSION_SECRET: 'integration-test-secret-integration-test-secret',
              SESSION_TTL_SECONDS: 3600,
            }),
          ],
        }),
        PrismaModule,
        SessionModule,
      ],
      controllers: [CompetitorInsightsController],
      providers: [CompetitorInsightsService, CompetitorsService],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    prisma = moduleRef.get(PrismaService);
    sessions = moduleRef.get(SessionService);
    competitors = moduleRef.get(CompetitorsService);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    a = await seedStore(prisma);
    b = await seedStore(prisma);
    // Store A: three coffee/food products and one perfume.
    for (const name of ['قهوة إثيوبية', 'عسل سدر', 'تمر سكري', 'عطر عود']) {
      await seedProduct(prisma, a, { name, price: 100, costPrice: 40 });
    }
  });

  const cookieFor = (s: SeededStore) =>
    `${SESSION_COOKIE}=${encodeURIComponent(sessions.issue({ tenantId: s.tenantId, storeId: s.storeId }))}`;

  async function call(method: 'GET' | 'POST', path: string, as?: SeededStore) {
    const res = await fetch(`${base}/api/v1/competitor-insights${path}`, {
      method,
      headers: as ? { cookie: cookieFor(as) } : {},
    });
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  }

  const refresh = (s: SeededStore = a) => call('POST', '/refresh', s);
  const domains = (json: any) => json.suggestions.map((x: any) => x.domain);

  describe('refresh', () => {
    it('derives niches and Saudi-only suggestions from the store catalogue', async () => {
      const { status, json } = await refresh();

      expect(status).toBe(200);
      expect(json).toMatchObject({ eligible: true, currency: 'SAR', reason: null });
      expect(json.niches.map((n: any) => [n.key, n.productCount, n.sharePct])).toEqual([
        ['coffee_food', 3, 75],
        ['perfumes', 1, 25],
      ]);

      const ds = domains(json);
      expect(ds).toEqual(expect.arrayContaining(['amazon.sa', 'noon.com', 'ounass.com']));
      // Beauty/health and electronics-only operators have no overlap with this catalogue.
      expect(ds).not.toContain('nahdionline.com');
      expect(ds).not.toContain('jarir.com');
      for (const s of json.suggestions) {
        expect(s).toMatchObject({ countryCode: 'SA', currency: 'SAR', status: 'SUGGESTED' });
      }
      // Best overlap first.
      const scores = json.suggestions.map((s: any) => s.score);
      expect(scores).toEqual([...scores].sort((x: number, y: number) => y - x));
    });

    it('never suggests a competitor that is already tracked', async () => {
      await competitors.create(a, { name: 'نون', domain: 'noon.com' });

      const { json } = await refresh();

      expect(domains(json)).not.toContain('noon.com');
      expect(domains(json)).toContain('amazon.sa');
    });

    it('builds a SWOT from measured data only, with the counts it used', async () => {
      const { json } = await refresh();

      expect(json.swot.basis).toMatchObject({ activeProducts: 4, productsWithCost: 4, trackedCompetitors: 0 });
      const codes = (items: any[]) => items.map((i) => i.code);
      expect(codes(json.swot.strengths)).toContain('cost_coverage_high');
      expect(codes(json.swot.weaknesses)).toContain('no_competitors_tracked');
      expect(codes(json.swot.opportunities)).toEqual(
        expect.arrayContaining(['uncovered_niche', 'discoveries_available']),
      );
      expect(codes(json.swot.threats)).toContain('marketplace_overlap');
    });

    it('is idempotent: refreshing twice keeps the same suggestions and prunes old reports', async () => {
      const first = await refresh();
      const second = await refresh();

      expect(domains(second.json)).toEqual(domains(first.json));
      expect(await prisma.competitorDiscovery.count({ where: { storeId: a.storeId } })).toBe(first.json.suggestions.length);
      expect(await prisma.swotReport.count({ where: { storeId: a.storeId } })).toBe(2);
      for (let i = 0; i < 11; i++) await refresh();
      expect(await prisma.swotReport.count({ where: { storeId: a.storeId } })).toBe(10);
    });

    it('offers nothing to a store that does not price in SAR, but still reports', async () => {
      await prisma.store.update({ where: { id: a.storeId }, data: { currency: 'AED' } });

      const { json } = await refresh();

      expect(json).toMatchObject({ eligible: false, reason: 'currency_not_sar', suggestions: [] });
      expect(json.swot).not.toBeNull();
    });

    it('answers sensibly for a store with no products', async () => {
      const { status, json } = await refresh(b);

      expect(status).toBe(200);
      expect(json).toMatchObject({ eligible: true, niches: [], suggestions: [] });
      expect(json.swot).toMatchObject({ strengths: [], weaknesses: [], opportunities: [], threats: [] });
    });
  });

  describe('one-click add', () => {
    async function suggestion(domain: string) {
      const { json } = await refresh();
      return json.suggestions.find((s: any) => s.domain === domain);
    }

    it('adds the suggestion to the tracked list through the same guarded path as a manual add', async () => {
      const s = await suggestion('amazon.sa');

      const res = await call('POST', `/discoveries/${s.id}/add`, a);

      expect(res.status).toBe(200);
      expect(res.json.discovery).toMatchObject({ status: 'ADDED', competitorId: res.json.competitor.id });
      expect(res.json.competitor).toMatchObject({ domain: 'amazon.sa', isActive: true, productUrl: null });
      expect(await prisma.competitor.count({ where: { storeId: a.storeId, domain: 'amazon.sa' } })).toBe(1);
      // The overview no longer lists it, and the next refresh does not bring it back.
      expect(domains((await call('GET', '', a)).json)).not.toContain('amazon.sa');
      expect(domains((await refresh()).json)).not.toContain('amazon.sa');
    });

    it('creates exactly one competitor when the button is pressed twice at once', async () => {
      const s = await suggestion('amazon.sa');

      const [x, y] = await Promise.all([
        call('POST', `/discoveries/${s.id}/add`, a),
        call('POST', `/discoveries/${s.id}/add`, a),
      ]);

      expect([x.status, y.status].sort()).toEqual([200, 409]);
      expect(await prisma.competitor.count({ where: { storeId: a.storeId, domain: 'amazon.sa' } })).toBe(1);
    });

    it('links to the competitor when the merchant already added the same one by hand', async () => {
      const s = await suggestion('amazon.sa');
      const manual = await competitors.create(a, { name: 'أمازون (يدوي)', domain: 'amazon.sa' });

      const res = await call('POST', `/discoveries/${s.id}/add`, a);

      expect(res.status).toBe(200);
      expect(res.json.competitor.id).toBe(manual.id);
      expect(await prisma.competitor.count({ where: { storeId: a.storeId, domain: 'amazon.sa' } })).toBe(1);
    });

    it('releases the suggestion again when the competitor cannot be created', async () => {
      const s = await suggestion('amazon.sa');
      // The catalogue changed under a stored row: it now points at a non-Saudi domain.
      await prisma.competitorDiscovery.update({ where: { id: s.id }, data: { domain: 'example.com' } });

      const res = await call('POST', `/discoveries/${s.id}/add`, a);

      expect(res.status).toBe(400);
      expect(await prisma.competitor.count({ where: { storeId: a.storeId } })).toBe(0);
      expect((await prisma.competitorDiscovery.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('SUGGESTED');
    });

    it('offers a competitor again after the merchant deletes the one they added', async () => {
      const s = await suggestion('amazon.sa');
      const added = await call('POST', `/discoveries/${s.id}/add`, a);
      await competitors.remove(a.storeId, added.json.competitor.id);

      const { json } = await refresh();

      expect(domains(json)).toContain('amazon.sa');
    });

    it('keeps manual add, edit and delete fully working next to discovery', async () => {
      await suggestion('amazon.sa');
      const manual = await competitors.create(a, { name: 'منافس يدوي', domain: 'rival.example' });
      await competitors.update(a.storeId, manual.id, { name: 'منافس (معدّل)' });
      expect((await prisma.competitor.findUniqueOrThrow({ where: { id: manual.id } })).name).toBe('منافس (معدّل)');
      await competitors.remove(a.storeId, manual.id);
      expect(await prisma.competitor.count({ where: { id: manual.id } })).toBe(0);
    });
  });

  describe('dismiss', () => {
    it('hides a suggestion for good, even across refreshes', async () => {
      const first = await refresh();
      const target = first.json.suggestions.find((s: any) => s.domain === 'noon.com');

      const res = await call('POST', `/discoveries/${target.id}/dismiss`, a);
      expect(res.status).toBe(200);
      expect(res.json.status).toBe('DISMISSED');

      expect(domains((await call('GET', '', a)).json)).not.toContain('noon.com');
      expect(domains((await refresh()).json)).not.toContain('noon.com');
      expect((await call('POST', `/discoveries/${target.id}/dismiss`, a)).status).toBe(409);
    });
  });

  describe('access control', () => {
    it('requires a session on every route', async () => {
      for (const [m, p] of [
        ['GET', ''],
        ['POST', '/refresh'],
        ['POST', '/discoveries/5c0e5fcb-3a4a-4f3e-9d4c-2f9a1a8b7c11/add'],
        ['POST', '/discoveries/5c0e5fcb-3a4a-4f3e-9d4c-2f9a1a8b7c11/dismiss'],
      ] as const) {
        expect((await call(m, p)).status).toBe(401);
      }
    });

    it("answers 404 for another store's suggestion and never touches it", async () => {
      await prisma.product.create({
        data: { tenantId: b.tenantId, storeId: b.storeId, sallaProductId: 'x', name: 'قهوة', price: 10, status: 'SALE' },
      });
      const theirs = (await refresh(b)).json.suggestions[0];

      expect((await call('POST', `/discoveries/${theirs.id}/add`, a)).status).toBe(404);
      expect((await call('POST', `/discoveries/${theirs.id}/dismiss`, a)).status).toBe(404);
      expect((await prisma.competitorDiscovery.findUniqueOrThrow({ where: { id: theirs.id } })).status).toBe('SUGGESTED');
      expect(await prisma.competitor.count({ where: { storeId: a.storeId } })).toBe(0);
    });

    it('rejects malformed ids', async () => {
      expect((await call('POST', '/discoveries/not-a-uuid/add', a)).status).toBe(400);
    });

    it("never mixes stores' data in the overview", async () => {
      await refresh();
      const other = await call('GET', '', b);
      expect(other.json).toMatchObject({ niches: [], suggestions: [], swot: null });
    });
  });
});
