import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { ProductSyncScheduler } from '../../src/products/product-sync.scheduler';
import type { ProductSyncService } from '../../src/products/product-sync.service';
import { RecommendationEngineService } from '../../src/recommendations/recommendation-engine.service';
import { RecommendationScheduler } from '../../src/recommendations/recommendation.scheduler';
import { SalesSyncScheduler } from '../../src/sync/sales-sync.scheduler';
import type { SalesSyncService } from '../../src/sync/sales-sync.service';
import { connect, resetDb, seedCompetitor, seedProduct, seedStore, type SeededStore } from './db';
import { TEST_ENV, newRedis } from './support';

/**
 * The schedulers run on every backend instance; the Redis lock must make exactly one of
 * them do the work per interval. "Instances" here share one database and one Redis.
 */
describe('scheduler locks across instances', () => {
  let prisma: PrismaService;
  let redis: Redis;
  const config = new ConfigService({ ...TEST_ENV }) as never;

  beforeAll(async () => {
    prisma = await connect();
    redis = newRedis();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await resetDb(prisma);
    await redis.flushall();
  });

  async function activeStore(withConnection = true): Promise<SeededStore> {
    const s = await seedStore(prisma);
    if (withConnection) {
      await prisma.sallaConnection.create({
        data: { tenantId: s.tenantId, storeId: s.storeId, accessTokenEnc: 'v1.a.b.c', status: 'ACTIVE' },
      });
    }
    return s;
  }

  describe.each([
    ['product sync', 'sync:products:lock:v1', (sync: { syncStore: jest.Mock }) =>
      [1, 2].map(() => new ProductSyncScheduler(prisma, sync as unknown as ProductSyncService, config, redis))],
    ['sales sync', 'sync:sales:lock:v1', (sync: { syncStore: jest.Mock }) =>
      [1, 2].map(() => new SalesSyncScheduler(prisma, sync as unknown as SalesSyncService, config, redis))],
  ] as const)('%s', (_name, lockKey, make) => {
    it('lets only one instance sync per interval, then runs again once the lock is gone', async () => {
      const s = await activeStore();
      const sync = { syncStore: jest.fn().mockResolvedValue(undefined) };
      const [a, b] = make(sync);

      await Promise.all([a!.tick(), b!.tick()]);

      expect(sync.syncStore).toHaveBeenCalledTimes(1);
      expect(sync.syncStore).toHaveBeenCalledWith(s.storeId);
      const ttl = await redis.ttl(lockKey);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(6 * 3600); // never longer than the longest interval

      // Still locked: nobody syncs.
      await a!.tick();
      expect(sync.syncStore).toHaveBeenCalledTimes(1);

      await redis.del(lockKey); // what TTL expiry does
      await b!.tick();
      expect(sync.syncStore).toHaveBeenCalledTimes(2);
    });

    it('skips uninstalled stores and stores without an active connection', async () => {
      const ok = await activeStore();
      const off = await activeStore();
      await prisma.store.update({ where: { id: off.storeId }, data: { status: 'UNINSTALLED' } });
      const revoked = await activeStore();
      await prisma.sallaConnection.update({
        where: { storeId: revoked.storeId },
        data: { status: 'REVOKED' },
      });
      await activeStore(false);
      const sync = { syncStore: jest.fn().mockResolvedValue(undefined) };

      await make(sync)[0]!.tick();

      expect(sync.syncStore.mock.calls.map((c) => c[0])).toEqual([ok.storeId]);
    });

    it("keeps going when one store's sync fails", async () => {
      await activeStore();
      await activeStore();
      await activeStore();
      const sync = {
        syncStore: jest
          .fn()
          .mockRejectedValueOnce(new Error('boom'))
          .mockResolvedValue(undefined),
      };

      await make(sync)[0]!.tick();

      expect(sync.syncStore).toHaveBeenCalledTimes(3);
      expect(await redis.exists(lockKey)).toBe(1); // lock held until TTL, not released early
    });
  });

  describe('recommendation engine', () => {
    it('runs once across instances and produces recommendations for active stores only', async () => {
      const make = () =>
        new RecommendationScheduler(
          prisma,
          new RecommendationEngineService(prisma, config),
          config,
          redis,
        );
      const s = await seedStore(prisma);
      const p = await seedProduct(prisma, s, { price: 100, costPrice: 60 });
      await seedCompetitor(prisma, s, {
        productId: p.id,
        lastPrice: 90,
        lastCheckedAt: new Date(),
      });
      const inactive = await seedStore(prisma);
      const ip = await seedProduct(prisma, inactive, { price: 100, costPrice: 60 });
      await seedCompetitor(prisma, inactive, {
        productId: ip.id,
        lastPrice: 90,
        lastCheckedAt: new Date(),
      });
      await prisma.store.update({ where: { id: inactive.storeId }, data: { status: 'SUSPENDED' } });

      const a = make();
      const b = make();
      await Promise.all([a.tick(), b.tick()]);

      expect(await prisma.decisionRecommendation.count({ where: { storeId: s.storeId } })).toBe(1);
      expect(await prisma.decisionRecommendation.count({ where: { storeId: inactive.storeId } })).toBe(0);
      expect(await prisma.dataConfidenceAudit.count()).toBe(1);
    });
  });
});
