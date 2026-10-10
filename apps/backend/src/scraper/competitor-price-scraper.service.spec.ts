import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { CompetitorPricesService } from '../competitors/competitor-prices.service';
import type { Env } from '../config/env';
import type { PrismaService } from '../prisma/prisma.service';
import {
  CompetitorPriceScraperService,
  type ScrapeTarget,
} from './competitor-price-scraper.service';
import type { PageFetcher } from './page-fetcher';
import { ScrapeError } from './scrape-error';

const NOW = new Date('2026-10-10T12:00:00Z');
const MIN = 60_000;

const target: ScrapeTarget = {
  id: 'comp-1',
  storeId: 'store-1',
  productUrl: 'https://rival.example.com/p/1',
  currency: 'SAR',
  scrapeFailures: 0,
};

const pageWithPrice = (price: string, currency = 'SAR') =>
  `<script type="application/ld+json">${JSON.stringify({
    '@type': 'Product',
    offers: { price, priceCurrency: currency, availability: 'https://schema.org/InStock' },
  })}</script>`;

function setup() {
  const fetchHtml = jest.fn<Promise<string>, [string]>();
  const record = jest.fn();
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });

  const service = new CompetitorPriceScraperService(
    { competitor: { updateMany } } as unknown as PrismaService,
    { record } as unknown as CompetitorPricesService,
    { fetchHtml } as unknown as PageFetcher,
    { get: () => 360 } as unknown as ConfigService<Env, true>,
    // Instant retries so tests don't wait.
    { attempts: 3, baseDelayMs: 0, maxDelayMs: 0, maxRetryAfterMs: 15_000, sleep: async () => {} },
  );
  return { service, fetchHtml, record, updateMany };
}

describe('CompetitorPriceScraperService.scrape', () => {
  it('records the scraped price through CompetitorPricesService and schedules the next run', async () => {
    const { service, fetchHtml, record, updateMany } = setup();
    fetchHtml.mockResolvedValue(pageWithPrice('89.90'));
    record.mockResolvedValue({ recorded: true, changed: true, price: '89.90', previousPrice: '99.00' });

    const out = await service.scrape(target, NOW);

    expect(out).toEqual({ ok: true, recorded: true, changed: true, price: '89.90' });
    expect(record).toHaveBeenCalledWith(
      'store-1',
      'comp-1',
      { price: 89.9, inStock: true, source: 'scraper' },
      NOW,
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'comp-1', storeId: 'store-1' },
      data: {
        scrapeFailures: 0,
        lastScrapeError: null,
        nextScrapeAt: new Date(NOW.getTime() + 360 * MIN),
      },
    });
  });

  it('retries a transient network failure and then succeeds', async () => {
    const { service, fetchHtml, record } = setup();
    fetchHtml
      .mockRejectedValueOnce(new ScrapeError('network', 'reset', { retryable: true }))
      .mockRejectedValueOnce(new ScrapeError('http_error', '503', { retryable: true }))
      .mockResolvedValue(pageWithPrice('10'));
    record.mockResolvedValue({ recorded: true, changed: false, price: '10.00', previousPrice: '10.00' });

    const out = await service.scrape(target, NOW);

    expect(out.ok).toBe(true);
    expect(fetchHtml).toHaveBeenCalledTimes(3);
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('records a failure with exponential backoff once retries are exhausted', async () => {
    const { service, fetchHtml, record, updateMany } = setup();
    fetchHtml.mockRejectedValue(new ScrapeError('network', 'reset', { retryable: true }));

    const out = await service.scrape({ ...target, scrapeFailures: 2 }, NOW);

    expect(out).toMatchObject({ ok: false, kind: 'network' });
    expect(fetchHtml).toHaveBeenCalledTimes(3);
    expect(record).not.toHaveBeenCalled();
    // third consecutive failure: 15min * 2^2 = 60min
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'comp-1', storeId: 'store-1' },
      data: {
        scrapeFailures: 3,
        lastScrapeError: 'network',
        nextScrapeAt: new Date(NOW.getTime() + 60 * MIN),
      },
    });
  });

  it('defers by Retry-After when the site rate-limits us, without hammering it', async () => {
    const { service, fetchHtml, updateMany } = setup();
    fetchHtml.mockRejectedValue(
      new ScrapeError('blocked', '429', { retryable: true, retryAfterMs: 2 * 60 * MIN }),
    );

    const out = await service.scrape(target, NOW);

    expect(out).toMatchObject({ ok: false, kind: 'blocked', retryAfterMs: 2 * 60 * MIN });
    expect(fetchHtml).toHaveBeenCalledTimes(1); // Retry-After too long to wait in-process
    const data = updateMany.mock.calls[0]![0].data;
    expect(data.nextScrapeAt).toEqual(new Date(NOW.getTime() + 2 * 60 * MIN));
    expect(data.lastScrapeError).toBe('blocked');
  });

  it('treats a page without a price as a parse failure and does not record anything', async () => {
    const { service, fetchHtml, record, updateMany } = setup();
    fetchHtml.mockResolvedValue('<html><body>redesigned!</body></html>');

    const out = await service.scrape(target, NOW);

    expect(out).toMatchObject({ ok: false, kind: 'parse_failed' });
    expect(fetchHtml).toHaveBeenCalledTimes(1); // not retryable
    expect(record).not.toHaveBeenCalled();
    expect(updateMany.mock.calls[0]![0].data).toMatchObject({
      scrapeFailures: 1,
      lastScrapeError: 'parse_failed',
    });
  });

  it('rejects a price quoted in another currency', async () => {
    const { service, fetchHtml, record } = setup();
    fetchHtml.mockResolvedValue(pageWithPrice('25', 'USD'));

    const out = await service.scrape(target, NOW);

    expect(out).toMatchObject({ ok: false, kind: 'currency_mismatch' });
    expect(record).not.toHaveBeenCalled();
  });

  it('re-validates stored URLs and parks permanently-bad ones for a day', async () => {
    const { service, fetchHtml, updateMany } = setup();

    const out = await service.scrape({ ...target, productUrl: 'http://10.0.0.1/admin' }, NOW);

    expect(out).toMatchObject({ ok: false, kind: 'forbidden_target' });
    expect(fetchHtml).not.toHaveBeenCalled();
    expect(updateMany.mock.calls[0]![0].data.nextScrapeAt).toEqual(
      new Date(NOW.getTime() + 24 * 60 * MIN),
    );
  });

  it('does not count a deleted competitor as a site failure', async () => {
    const { service, fetchHtml, record, updateMany } = setup();
    fetchHtml.mockResolvedValue(pageWithPrice('10'));
    record.mockRejectedValue(new NotFoundException());

    const out = await service.scrape(target, NOW);

    expect(out.ok).toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('propagates unexpected errors from recording instead of hiding them', async () => {
    const { service, fetchHtml, record } = setup();
    fetchHtml.mockResolvedValue(pageWithPrice('10'));
    record.mockRejectedValue(new Error('db down'));

    await expect(service.scrape(target, NOW)).rejects.toThrow('db down');
  });
});
