import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { CompetitorsService } from '../../src/competitors/competitors.service';
import { CompetitorInsightsService } from '../../src/competitor-insights/competitor-insights.service';
import { OnboardingController } from '../../src/onboarding/onboarding.controller';
import { OnboardingService } from '../../src/onboarding/onboarding.service';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SessionModule } from '../../src/session/session.module';
import { SESSION_COOKIE, SessionService } from '../../src/session/session.service';
import { resetDb, seedCompetitor, seedProduct, seedStore, type SeededStore } from './db';

describe('Onboarding summary over HTTP against real PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sessions: SessionService;
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
      controllers: [OnboardingController],
      providers: [OnboardingService, CompetitorInsightsService, CompetitorsService],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    prisma = moduleRef.get(PrismaService);
    sessions = moduleRef.get(SessionService);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    a = await seedStore(prisma);
    b = await seedStore(prisma);
  });

  async function get(as?: SeededStore) {
    const cookie = as
      ? `${SESSION_COOKIE}=${encodeURIComponent(sessions.issue({ tenantId: as.tenantId, storeId: as.storeId }))}`
      : undefined;
    const res = await fetch(`${base}/api/v1/onboarding`, { headers: cookie ? { cookie } : {} });
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  }

  async function start(as?: SeededStore) {
    const cookie = as
      ? `${SESSION_COOKIE}=${encodeURIComponent(sessions.issue({ tenantId: as.tenantId, storeId: as.storeId }))}`
      : undefined;
    const res = await fetch(`${base}/api/v1/onboarding/start`, {
      method: 'POST',
      headers: cookie ? { cookie } : {},
    });
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  }

  it('requires a session', async () => {
    expect((await get()).status).toBe(401);
  });

  it('asks a store with no products to sync first', async () => {
    const res = await get(a);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      next: 'sync',
      steps: { connected: true, productsSynced: false, competitorsAdded: false, pricesCompared: false },
      headline: null,
      searchTargets: [],
    });
  });

  it('asks for competitors when there are products but no competitors', async () => {
    await seedProduct(prisma, a, { name: 'رخيص', price: 50 });
    const expensive = await seedProduct(prisma, a, { name: 'غالي', price: 300 });

    const res = await get(a);
    expect(res.json.next).toBe('find_competitors');
    expect(res.json.counts).toEqual({ products: 2, competitors: 0 });
    expect(res.json.searchTargets[0]).toEqual({ id: expensive.id, name: 'غالي' }); // highest price first
  });

  it('asks to compare when competitors exist but none has a price yet', async () => {
    await seedProduct(prisma, a, { price: 100 });
    await seedCompetitor(prisma, a, { productUrl: null, lastPrice: null });

    const res = await get(a);
    expect(res.json.next).toBe('compare');
    expect(res.json.steps).toMatchObject({ competitorsAdded: true, pricesCompared: false });
  });

  it('reports the first-value headline once prices are in, using the sale price as ours', async () => {
    const p1 = await seedProduct(prisma, a, { name: 'p1', price: 130, salePrice: 120 });
    const p2 = await seedProduct(prisma, a, { name: 'p2', price: 90 });
    await seedCompetitor(prisma, a, { productId: p1.id, lastPrice: 100 }); // ours 120: +20%
    await seedCompetitor(prisma, a, { productId: p2.id, lastPrice: 100 }); // ours 90: below
    await seedCompetitor(prisma, a, { productId: p2.id, lastPrice: 95, isActive: false }); // ignored

    const res = await get(a);
    expect(res.json.next).toBe('done');
    expect(res.json.headline).toEqual({
      comparedProducts: 2,
      higherProducts: 1,
      lowerProducts: 1,
      samePriceProducts: 0,
      avgHigherPct: 20,
      competitorsCompared: 2,
    });
    expect(res.json.searchTargets).toEqual([]); // both already have listings
  });

  it("never mixes in another store's data", async () => {
    const mine = await seedProduct(prisma, a, { price: 100 });
    const theirs = await seedProduct(prisma, b, { price: 100 });
    await seedCompetitor(prisma, b, { productId: theirs.id, lastPrice: 50 });

    const res = await get(a);
    expect(res.json.headline).toBeNull();
    expect(res.json.counts).toEqual({ products: 1, competitors: 0 });
    expect(res.json.searchTargets).toEqual([{ id: mine.id, name: expect.any(String) }]);
  });

  describe('POST /start', () => {
    const seedNiche = async (s: SeededStore) => {
      for (const name of ['قهوة إثيوبية', 'عسل سدر', 'تمر سكري', 'عطر عود']) {
        await seedProduct(prisma, s, { name, price: 100, costPrice: 40 });
      }
    };

    it('requires a session', async () => {
      expect((await start()).status).toBe(401);
    });

    it('does nothing for a store without products', async () => {
      const res = await start(a);
      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({ next: 'sync', discovered: 0 });
      expect(await prisma.competitor.count({ where: { storeId: a.storeId } })).toBe(0);
    });

    it('discovers and adds up to three competitors, then asks to compare', async () => {
      await seedNiche(a);

      const res = await start(a);

      expect(res.status).toBe(200);
      expect(res.json.discovered).toBeGreaterThan(0);
      expect(res.json.discovered).toBeLessThanOrEqual(3);
      expect(res.json.counts.competitors).toBe(res.json.discovered);
      expect(res.json.next).toBe('compare');
      expect(await prisma.competitor.count({ where: { storeId: a.storeId, isActive: true } })).toBe(res.json.discovered);
    });

    it('is idempotent: with competitors already tracked it adds nothing', async () => {
      await seedNiche(a);
      const first = await start(a);
      const second = await start(a);

      expect(second.json.discovered).toBe(0);
      expect(second.json.counts.competitors).toBe(first.json.counts.competitors);
    });

    it('leaves a store that already tracks someone alone', async () => {
      await seedNiche(a);
      await seedCompetitor(prisma, a, { productUrl: null });
      const res = await start(a);
      expect(res.json.discovered).toBe(0);
      expect(res.json.counts.competitors).toBe(1);
    });

    it('never touches another store', async () => {
      await seedNiche(a);
      await start(a);
      expect(await prisma.competitor.count({ where: { storeId: b.storeId } })).toBe(0);
    });
  });
});
