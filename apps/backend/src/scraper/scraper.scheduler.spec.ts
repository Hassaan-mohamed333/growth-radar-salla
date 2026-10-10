import type { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import type { Env } from '../config/env';
import type { PrismaService } from '../prisma/prisma.service';
import type { CompetitorPriceScraperService, ScrapeOutcome } from './competitor-price-scraper.service';
import { ScraperScheduler } from './scraper.scheduler';

const row = (id: string, domain: string) => ({
  id,
  storeId: 's1',
  domain,
  productUrl: `https://${domain}/p/${id}`,
  currency: 'SAR',
  scrapeFailures: 0,
});

function setup(rows: ReturnType<typeof row>[], lockAcquired = true) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const scrape = jest.fn<Promise<ScrapeOutcome>, [{ id: string }]>();
  const set = jest.fn().mockResolvedValue(lockAcquired ? 'OK' : null);
  const del = jest.fn().mockResolvedValue(1);
  const sleeps: number[] = [];

  const scheduler = new ScraperScheduler(
    { competitor: { findMany } } as unknown as PrismaService,
    { scrape } as unknown as CompetitorPriceScraperService,
    {
      get: (k: string) => ({ SCRAPER_BATCH_SIZE: 50, SCRAPER_DOMAIN_DELAY_MS: 2000 })[k],
    } as unknown as ConfigService<Env, true>,
    { set, del } as unknown as Redis,
  );
  const sleep = async (ms: number) => void sleeps.push(ms);
  return { scheduler, findMany, scrape, set, del, sleeps, sleep };
}

const ok: ScrapeOutcome = { ok: true, recorded: true, changed: false, price: '1.00' };

describe('ScraperScheduler.tick', () => {
  it('scrapes due listings, pausing between requests to the same domain', async () => {
    const { scheduler, scrape, sleeps, sleep } = setup([
      row('a1', 'a.example'),
      row('a2', 'a.example'),
      row('b1', 'b.example'),
    ]);
    scrape.mockResolvedValue(ok);

    const attempted = await scheduler.tick(sleep);

    expect(attempted).toBe(3);
    expect(scrape.mock.calls.map((c) => c[0].id).sort()).toEqual(['a1', 'a2', 'b1']);
    expect(sleeps).toEqual([2000]); // only the second a.example request waits
  });

  it('only selects active, due listings of active stores', async () => {
    const { scheduler, findMany, sleep } = setup([]);
    await scheduler.tick(sleep, new Date('2026-10-10T12:00:00Z'));

    const args = findMany.mock.calls[0]![0];
    expect(args.where).toMatchObject({
      isActive: true,
      productUrl: { not: null },
      store: { status: 'ACTIVE' },
      OR: [{ nextScrapeAt: null }, { nextScrapeAt: { lte: new Date('2026-10-10T12:00:00Z') } }],
    });
    expect(args.take).toBe(50);
  });

  it('stops hitting a domain that blocks us but continues with others', async () => {
    const { scheduler, scrape, sleep } = setup([
      row('a1', 'a.example'),
      row('a2', 'a.example'),
      row('b1', 'b.example'),
    ]);
    scrape.mockImplementation(async (t) =>
      t.id === 'a1' ? { ok: false, kind: 'blocked', retryAfterMs: 60_000 } : ok,
    );

    await scheduler.tick(sleep);

    const ids = scrape.mock.calls.map((c) => c[0].id);
    expect(ids).toContain('a1');
    expect(ids).not.toContain('a2');
    expect(ids).toContain('b1');
  });

  it('keeps going when one scrape crashes', async () => {
    const { scheduler, scrape, sleep } = setup([row('a1', 'a.example'), row('a2', 'a.example')]);
    scrape.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(ok);

    await expect(scheduler.tick(sleep)).resolves.toBe(2);
  });

  it('does nothing when another instance holds the lock', async () => {
    const { scheduler, findMany, scrape, del, sleep } = setup([row('a1', 'a.example')], false);

    await expect(scheduler.tick(sleep)).resolves.toBe(0);
    expect(findMany).not.toHaveBeenCalled();
    expect(scrape).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled(); // never release a lock we do not own
  });

  it('releases the lock after a run', async () => {
    const { scheduler, scrape, del, sleep } = setup([row('a1', 'a.example')]);
    scrape.mockResolvedValue(ok);

    await scheduler.tick(sleep);

    expect(del).toHaveBeenCalledWith('scraper:lock:v1');
  });
});
