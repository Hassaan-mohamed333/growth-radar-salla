import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { AnalyticsController } from '../../src/analytics/analytics.controller';
import { AnalyticsService } from '../../src/analytics/analytics.service';
import { CompetitorPricesService } from '../../src/competitors/competitor-prices.service';
import {
  CompetitorsController,
  ProductCompetitorsController,
} from '../../src/competitors/competitors.controller';
import { CompetitorsService } from '../../src/competitors/competitors.service';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ProductsController } from '../../src/products/products.controller';
import { ProductsService } from '../../src/products/products.service';
import { RecommendationEngineService } from '../../src/recommendations/recommendation-engine.service';
import { RecommendationsController } from '../../src/recommendations/recommendations.controller';
import { RecommendationsService } from '../../src/recommendations/recommendations.service';
import { SessionModule } from '../../src/session/session.module';
import { SESSION_COOKIE, SessionService } from '../../src/session/session.service';
import { resetDb, seedProduct, seedStore, type SeededStore } from './db';

const SECRET = 'integration-test-secret-integration-test-secret';

/**
 * The real HTTP surface: Express + Nest routing + SessionGuard + zod validation +
 * services + PostgreSQL. Only Salla/Redis-facing providers are left out.
 */
describe('HTTP API against real PostgreSQL', () => {
  let prisma: PrismaService;
  let app: INestApplication;
  let sessions: SessionService;
  let engine: RecommendationEngineService;
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
              SESSION_SECRET: SECRET,
              SESSION_TTL_SECONDS: 3600,
              RECOMMENDATION_MIN_GAP_PCT: 2,
              RECOMMENDATION_MIN_MARGIN_PCT: 10,
            }),
          ],
        }),
        PrismaModule,
        SessionModule,
      ],
      controllers: [
        ProductsController,
        CompetitorsController,
        ProductCompetitorsController,
        RecommendationsController,
        AnalyticsController,
      ],
      providers: [
        ProductsService,
        CompetitorsService,
        CompetitorPricesService,
        RecommendationsService,
        RecommendationEngineService,
        AnalyticsService,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1'); // runs PrismaService.onModuleInit -> $connect
    prisma = moduleRef.get(PrismaService);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    sessions = moduleRef.get(SessionService);
    engine = moduleRef.get(RecommendationEngineService);
  });

  afterAll(async () => {
    await app.close(); // PrismaService.onModuleDestroy -> $disconnect
  });

  beforeEach(async () => {
    await resetDb(prisma);
    a = await seedStore(prisma);
    b = await seedStore(prisma);
  });

  const cookieFor = (s: SeededStore) =>
    `${SESSION_COOKIE}=${encodeURIComponent(sessions.issue({ tenantId: s.tenantId, storeId: s.storeId }))}`;

  async function call(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    opts: { as?: SeededStore; cookie?: string; body?: unknown } = {},
  ) {
    const cookie = opts.cookie ?? (opts.as ? cookieFor(opts.as) : undefined);
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, json: json as any, text };
  }

  describe('authentication', () => {
    const endpoints: Array<['GET' | 'POST', string]> = [
      ['GET', '/api/v1/products'],
      ['GET', '/api/v1/competitors'],
      ['GET', '/api/v1/recommendations'],
      ['GET', '/api/v1/analytics/summary'],
      ['POST', '/api/v1/competitors'],
    ];

    it.each(endpoints)('%s %s answers 401 without a session', async (method, path) => {
      const res = await call(method, path, method === 'POST' ? { body: {} } : {});
      expect(res.status).toBe(401);
    });

    it('rejects forged, tampered and mismatched-tenant tokens', async () => {
      const good = sessions.issue({ tenantId: a.tenantId, storeId: a.storeId });
      const [h, p, sig] = good.split('.') as [string, string, string];
      const evil = Buffer.from(
        JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), sub: b.storeId }),
      ).toString('base64url');

      const tampered = `${SESSION_COOKIE}=${h}.${evil}.${sig}`;
      const noneAlg = `${SESSION_COOKIE}=${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${p}.`;
      // Correctly signed, but the store does not belong to the claimed tenant.
      const crossTenant = `${SESSION_COOKIE}=${encodeURIComponent(
        sessions.issue({ tenantId: a.tenantId, storeId: b.storeId }),
      )}`;

      for (const cookie of [tampered, noneAlg, crossTenant]) {
        expect((await call('GET', '/api/v1/products', { cookie })).status).toBe(401);
      }
    });

    it('rejects an expired session', async () => {
      const old = sessions.issue(
        { tenantId: a.tenantId, storeId: a.storeId },
        Date.now() - 2 * 3600 * 1000,
      );
      const res = await call('GET', '/api/v1/products', {
        cookie: `${SESSION_COOKIE}=${encodeURIComponent(old)}`,
      });
      expect(res.status).toBe(401);
    });
  });

  describe('scoping and validation', () => {
    it('serves only the session store, ignoring any storeId the client sends', async () => {
      await seedProduct(prisma, a, { name: 'Mine' });
      await seedProduct(prisma, b, { name: 'Theirs' });

      const res = await call('GET', `/api/v1/products?storeId=${b.storeId}`, { as: a });

      expect(res.status).toBe(200);
      expect(res.json.items.map((p: { name: string }) => p.name)).toEqual(['Mine']);
    });

    it.each([
      '/api/v1/products?page=0',
      '/api/v1/products?pageSize=101',
      '/api/v1/products?monitored=maybe',
      '/api/v1/competitors?pageSize=abc',
      '/api/v1/recommendations?status=EVERYTHING',
    ])('rejects bad query %s with 400', async (path) => {
      expect((await call('GET', path, { as: a })).status).toBe(400);
    });

    it('validates competitor bodies and never echoes internal targets', async () => {
      const strict = await call('POST', '/api/v1/competitors', {
        as: a,
        body: { name: 'x', productUrl: 'https://rival.example.com/p', isAdmin: true },
      });
      expect(strict.status).toBe(400);

      const ssrf = await call('POST', '/api/v1/competitors', {
        as: a,
        body: { name: 'x', productUrl: 'http://169.254.169.254/latest/meta-data' },
      });
      expect(ssrf.status).toBe(400);
      expect(ssrf.text).not.toContain('169.254');
    });

    it('creates, rejects duplicates, and 404s foreign products with distinct statuses', async () => {
      const mine = await seedProduct(prisma, a, { name: 'Beans' });
      const theirs = await seedProduct(prisma, b, { name: 'Other' });
      const url = 'https://rival.example.com/p/1';

      const created = await call('POST', `/api/v1/products/${mine.id}/competitors`, {
        as: a,
        body: { productUrl: url },
      });
      expect(created.status).toBe(201);
      expect(created.json).toMatchObject({ domain: 'rival.example.com', productId: mine.id });

      const dup = await call('POST', `/api/v1/products/${mine.id}/competitors`, {
        as: a,
        body: { productUrl: url },
      });
      expect(dup.status).toBe(409);

      const foreign = await call('POST', `/api/v1/products/${theirs.id}/competitors`, {
        as: a,
        body: { productUrl: 'https://rival.example.com/p/2' },
      });
      expect(foreign.status).toBe(404);

      const badId = await call('POST', '/api/v1/products/not-a-uuid/competitors', {
        as: a,
        body: { productUrl: url },
      });
      expect(badId.status).toBe(400);
    });

    it('rejects non-positive manual prices and unknown competitors', async () => {
      const comp = await call('POST', '/api/v1/competitors', {
        as: a,
        body: { name: 'Rival', productUrl: 'https://rival.example.com/p/1' },
      });
      const id = comp.json.id as string;

      expect((await call('POST', `/api/v1/competitors/${id}/prices`, { as: a, body: { price: -5 } })).status).toBe(400);
      expect((await call('POST', `/api/v1/competitors/${id}/prices`, { as: a, body: { price: 0 } })).status).toBe(400);
      // Another store cannot price this competitor.
      expect((await call('POST', `/api/v1/competitors/${id}/prices`, { as: b, body: { price: 10 } })).status).toBe(404);
    });
  });

  describe('end to end: competitor -> manual price -> recommendation -> decision', () => {
    it('walks the whole merchant flow over HTTP', async () => {
      const product = await seedProduct(prisma, a, { name: 'Beans', price: 100, costPrice: 60 });

      // 1. Link a competitor listing to the product.
      const linked = await call('POST', `/api/v1/products/${product.id}/competitors`, {
        as: a,
        body: { productUrl: 'https://rival.example.com/beans', name: 'Rival' },
      });
      expect(linked.status).toBe(201);
      const competitorId = linked.json.id as string;

      // 2. Record what the competitor charges.
      const priced = await call('POST', `/api/v1/competitors/${competitorId}/prices`, {
        as: a,
        body: { price: 90 },
      });
      expect(priced).toMatchObject({ status: 200 });
      expect(priced.json).toMatchObject({ price: '90.00', changed: true });

      // 3. The dashboard already sees the undercut.
      const summary = await call('GET', '/api/v1/analytics/summary', { as: a });
      expect(summary.json.competitors).toMatchObject({ active: 1, undercutting: 1 });

      // 4. The engine turns it into a recommendation, visible over the API.
      await engine.generateForStore(a.storeId);
      const list = await call('GET', '/api/v1/recommendations', { as: a });
      expect(list.json.total).toBe(1);
      const rec = list.json.items[0];
      expect(rec).toMatchObject({
        type: 'PRICE_ADJUSTMENT',
        status: 'PENDING',
        product: { id: product.id, name: 'Beans' },
        details: { kind: 'match_competitor', suggestedPrice: 90, currentPrice: 100 },
      });
      expect(rec.confidence).toBeGreaterThanOrEqual(90);

      // 5. The other store sees none of it.
      expect((await call('GET', '/api/v1/recommendations', { as: b })).json.total).toBe(0);
      expect((await call('POST', `/api/v1/recommendations/${rec.id}/decision`, { as: b, body: { decision: 'ACCEPTED' } })).status).toBe(404);

      // 6. Decide: invalid body, then accept, then a second decision conflicts.
      expect((await call('POST', `/api/v1/recommendations/${rec.id}/decision`, { as: a, body: { decision: 'APPLIED' } })).status).toBe(400);
      const accepted = await call('POST', `/api/v1/recommendations/${rec.id}/decision`, {
        as: a,
        body: { decision: 'ACCEPTED' },
      });
      expect(accepted.status).toBe(200);
      expect(accepted.json).toMatchObject({ status: 'ACCEPTED' });
      expect(
        (await call('POST', `/api/v1/recommendations/${rec.id}/decision`, { as: a, body: { decision: 'DISMISSED' } })).status,
      ).toBe(409);

      // 7. Pending is empty, accepted shows it, and the dashboard count follows.
      expect((await call('GET', '/api/v1/recommendations', { as: a })).json.total).toBe(0);
      expect((await call('GET', '/api/v1/recommendations?status=ACCEPTED', { as: a })).json.total).toBe(1);
      expect((await call('GET', '/api/v1/analytics/summary', { as: a })).json.recommendations.pending).toBe(0);
    });
  });
});
