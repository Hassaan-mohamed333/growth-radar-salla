import { NotFoundException } from '@nestjs/common';
import {
  CompetitorPricesService,
  HEARTBEAT_MS,
} from '../../src/competitors/competitor-prices.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { connect, resetDb, seedCompetitor, seedStore } from './db';

describe('CompetitorPricesService against real PostgreSQL (row lock + history)', () => {
  let prisma: PrismaService;
  let service: CompetitorPricesService;

  beforeAll(async () => {
    prisma = await connect();
    service = new CompetitorPricesService(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(() => resetDb(prisma));

  const rows = (competitorId: string) =>
    prisma.competitorPriceHistory.findMany({
      where: { competitorId },
      orderBy: { observedAt: 'asc' },
    });

  it('writes history and the denormalised last price in one step', async () => {
    const s = await seedStore(prisma);
    const c = await seedCompetitor(prisma, s);

    const first = await service.record(s.storeId, c.id, { price: 80.5, source: 'manual' });

    expect(first).toMatchObject({ recorded: true, changed: true, price: '80.50', previousPrice: null });
    const comp = await prisma.competitor.findUniqueOrThrow({ where: { id: c.id } });
    expect(comp.lastPrice?.toFixed(2)).toBe('80.50');
    expect(comp.lastCheckedAt).not.toBeNull();
    const h = await rows(c.id);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ tenantId: s.tenantId, storeId: s.storeId, source: 'manual' });
    expect(h[0]!.previousPrice).toBeNull();
  });

  it('skips unchanged prices inside the heartbeat window but still refreshes lastCheckedAt', async () => {
    const s = await seedStore(prisma);
    const c = await seedCompetitor(prisma, s);
    const t0 = new Date();
    await service.record(s.storeId, c.id, { price: 50, source: 'scraper' }, t0);

    const t1 = new Date(t0.getTime() + 60_000);
    const again = await service.record(s.storeId, c.id, { price: 50, source: 'scraper' }, t1);

    expect(again).toMatchObject({ recorded: false, changed: false });
    expect(await rows(c.id)).toHaveLength(1);
    const comp = await prisma.competitor.findUniqueOrThrow({ where: { id: c.id } });
    expect(comp.lastCheckedAt?.getTime()).toBe(t1.getTime());
  });

  it('records a heartbeat row once the window has passed, and chains previous prices', async () => {
    const s = await seedStore(prisma);
    const c = await seedCompetitor(prisma, s);
    const t0 = new Date();
    await service.record(s.storeId, c.id, { price: 50, source: 'scraper' }, t0);
    const later = new Date(t0.getTime() + HEARTBEAT_MS + 1);
    const hb = await service.record(s.storeId, c.id, { price: 50, source: 'scraper' }, later);
    const moved = await service.record(
      s.storeId,
      c.id,
      { price: 45, source: 'scraper' },
      new Date(later.getTime() + 1000),
    );

    expect(hb).toMatchObject({ recorded: true, changed: false });
    expect(moved).toMatchObject({ changed: true, previousPrice: '50.00' });
    const h = await rows(c.id);
    expect(h.map((r) => [r.price.toFixed(2), r.previousPrice?.toFixed(2) ?? null])).toEqual([
      ['50.00', null],
      ['50.00', '50.00'],
      ['45.00', '50.00'],
    ]);
  });

  it('serialises concurrent observations: the previous-price chain never forks', async () => {
    const s = await seedStore(prisma);
    const c = await seedCompetitor(prisma, s);
    const prices = [101, 102, 103, 104, 105, 106, 107, 108];

    await Promise.all(
      prices.map((price) => service.record(s.storeId, c.id, { price, source: 'scraper' })),
    );

    const h = await rows(c.id);
    expect(h).toHaveLength(prices.length);
    // Every observation saw a distinct predecessor: exactly one first row, no two rows
    // claiming the same previous price (that would mean they raced past the row lock).
    const previous = h.map((r) => r.previousPrice?.toFixed(2) ?? null);
    expect(previous.filter((p) => p === null)).toHaveLength(1);
    const nonNull = previous.filter((p): p is string => p !== null);
    expect(new Set(nonNull).size).toBe(nonNull.length);
    // And the last price equals whichever observation actually ran last.
    const comp = await prisma.competitor.findUniqueOrThrow({ where: { id: c.id } });
    const lastInChain = prices
      .map((p) => p.toFixed(2))
      .find((p) => !nonNull.includes(p));
    expect(comp.lastPrice?.toFixed(2)).toBe(lastInChain);
  });

  it("refuses another store's competitor and writes nothing", async () => {
    const a = await seedStore(prisma);
    const b = await seedStore(prisma);
    const theirs = await seedCompetitor(prisma, b);

    await expect(
      service.record(a.storeId, theirs.id, { price: 10, source: 'manual' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(await rows(theirs.id)).toHaveLength(0);
    const comp = await prisma.competitor.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(comp.lastPrice).toBeNull();
  });
});
