import { AnalyticsService } from '../../src/analytics/analytics.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { addDays, localToday } from '../../src/sync/sales-aggregation';
import { connect, resetDb, seedCompetitor, seedProduct, seedStore, type SeededStore } from './db';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(Date.now() - ms);

describe('AnalyticsService against real PostgreSQL (raw SQL paths)', () => {
  let prisma: PrismaService;
  let service: AnalyticsService;

  beforeAll(async () => {
    prisma = await connect();
    service = new AnalyticsService(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(() => resetDb(prisma));

  async function history(
    s: SeededStore,
    competitorId: string,
    price: number,
    previousPrice: number | null,
    observedAt: Date,
  ) {
    await prisma.competitorPriceHistory.create({
      data: {
        tenantId: s.tenantId,
        storeId: s.storeId,
        competitorId,
        price,
        previousPrice,
        source: 'seed',
        observedAt,
      },
    });
  }

  async function snapshots(s: SeededStore, endDay: string, days: number, units: number, gross: number) {
    for (let i = 0; i < days; i++) {
      await prisma.salesSnapshot.create({
        data: {
          tenantId: s.tenantId,
          storeId: s.storeId,
          date: new Date(`${addDays(endDay, -i)}T00:00:00.000Z`),
          ordersCount: 2,
          unitsSold: units,
          grossRevenue: gross,
          refundedRevenue: gross / 10,
        },
      });
    }
  }

  it('counts only active, product-linked competitors that undercut the effective price', async () => {
    const s = await seedStore(prisma);
    const p1 = await seedProduct(prisma, s, { name: 'P1', price: 100 });
    const p2 = await seedProduct(prisma, s, { name: 'P2', price: 50, salePrice: 40 });

    await seedCompetitor(prisma, s, { productId: p1.id, lastPrice: 90, lastCheckedAt: ago(HOUR) }); // undercuts
    await seedCompetitor(prisma, s, { productId: p2.id, lastPrice: 45, lastCheckedAt: ago(HOUR) }); // above sale price
    await seedCompetitor(prisma, s, { productId: p1.id, lastPrice: 10, isActive: false }); // paused
    await seedCompetitor(prisma, s, { productId: null, lastPrice: 1 }); // not linked
    await seedCompetitor(prisma, s, { productId: p1.id, lastPrice: null }); // never priced

    const summary = await service.getSummary(s.storeId);

    expect(summary.competitors.undercutting).toBe(1);
    expect(summary.competitors.active).toBe(4);
    expect(summary.competitors.checkedLast24h).toBe(2);
    expect(summary.products).toEqual({ monitored: 2, total: 2 });
  });

  it('summarises competitor price movement from history, ignoring non-changes and old rows', async () => {
    const s = await seedStore(prisma);
    const p1 = await seedProduct(prisma, s, { name: 'Beans', price: 100 });
    const c1 = await seedCompetitor(prisma, s, { productId: p1.id, lastPrice: 95 });
    const c2 = await seedCompetitor(prisma, s, { productId: p1.id, lastPrice: 45 });

    await history(s, c1.id, 90, 100, ago(2 * DAY)); // -10%
    await history(s, c1.id, 95, 90, ago(HOUR)); // +5.56%
    await history(s, c1.id, 100, null, ago(3 * DAY)); // first observation: no baseline
    await history(s, c2.id, 45, 45, ago(DAY)); // unchanged (heartbeat)
    await history(s, c1.id, 60, 70, ago(40 * DAY)); // outside the 30-day window

    const { priceTrends } = await service.getSummary(s.storeId);

    expect(priceTrends).toMatchObject({ changes: 2, increases: 1, decreases: 1, avgChangePct: -2.2 });
    expect(priceTrends.recent).toHaveLength(2);
    expect(priceTrends.recent[0]).toMatchObject({
      competitorName: c1.name,
      productName: 'Beans',
      previousPrice: 90,
      price: 95,
      changePct: 5.6,
    });
  });

  it('computes sales velocity per covered day and the change vs the previous window', async () => {
    const s = await seedStore(prisma);
    const yesterday = addDays(localToday(), -1);
    // Current window: 10 covered days, 3 units and 300 gross (270 net) per day.
    await snapshots(s, yesterday, 10, 3, 300);
    // Previous window: 8 covered days (>= 7 so it is comparable), 2 units and 100 gross (90 net).
    await snapshots(s, addDays(yesterday, -30), 8, 2, 100);

    const v = (await service.getSummary(s.storeId)).salesVelocity!;

    expect(v.daysCovered).toBe(10);
    expect(v.unitsPerDay).toBe(3);
    expect(v.revenuePerDay).toBe(270);
    expect(v.previous).toMatchObject({ daysCovered: 8, unitsPerDay: 2, revenuePerDay: 90 });
    expect(v.unitsChangePct).toBe(50);
    expect(v.revenueChangePct).toBe(200);
    expect(v.lastSnapshotDate).toBe(yesterday);
  });

  it('returns null velocity without snapshots and never mixes in another store', async () => {
    const a = await seedStore(prisma);
    const b = await seedStore(prisma);
    await snapshots(b, addDays(localToday(), -1), 5, 9, 900);
    const pb = await seedProduct(prisma, b, { price: 100 });
    await seedCompetitor(prisma, b, { productId: pb.id, lastPrice: 10 });

    const summary = await service.getSummary(a.storeId);

    expect(summary.salesVelocity).toBeNull();
    expect(summary.competitors).toEqual({ active: 0, undercutting: 0, checkedLast24h: 0 });
    expect(summary.priceTrends.changes).toBe(0);
    expect(summary.products.total).toBe(0);
  });
});
