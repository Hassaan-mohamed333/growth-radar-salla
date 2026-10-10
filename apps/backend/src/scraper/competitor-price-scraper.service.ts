import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { CompetitorPricesService } from '../competitors/competitor-prices.service';
import { PrismaService } from '../prisma/prisma.service';
import { PageFetcher } from './page-fetcher';
import { type ExtractedPrice, extractPrice } from './price-extractor';
import { type RetryOptions, withRetry } from './retry';
import { ScrapeError, type ScrapeFailureKind } from './scrape-error';
import { parseCompetitorUrl } from './url-guard';

/** Overrides the default retry policy (tests inject instant sleeps). */
export const SCRAPER_RETRY_OPTIONS = Symbol('SCRAPER_RETRY_OPTIONS');

const MINUTE_MS = 60_000;
const FAILURE_BACKOFF_BASE_MS = 15 * MINUTE_MS;
const FAILURE_BACKOFF_MAX_MS = 24 * 60 * MINUTE_MS;
/** Failures that cannot fix themselves without the merchant editing the listing. */
const PERMANENT_KINDS: ReadonlySet<ScrapeFailureKind> = new Set([
  'invalid_url',
  'forbidden_target',
]);

export interface ScrapeTarget {
  id: string;
  storeId: string;
  productUrl: string;
  /** Currency the listing is tracked in; a page quoting another currency is rejected. */
  currency: string;
  scrapeFailures: number;
}

export type ScrapeOutcome =
  | { ok: true; recorded: boolean; changed: boolean; price: string }
  | { ok: false; kind: ScrapeFailureKind; retryAfterMs?: number };

/**
 * Fetches one competitor listing, extracts its price and records it through
 * CompetitorPricesService (transaction + row lock). Fetch problems are turned
 * into scheduling state on the competitor (failure count, backoff, fixed-vocabulary
 * reason) rather than exceptions, so one bad site never aborts a batch.
 */
@Injectable()
export class CompetitorPriceScraperService {
  private readonly logger = new Logger(CompetitorPriceScraperService.name);
  private readonly retry: RetryOptions;

  constructor(
    private readonly prisma: PrismaService,
    private readonly prices: CompetitorPricesService,
    private readonly fetcher: PageFetcher,
    private readonly config: ConfigService<Env, true>,
    @Optional() @Inject(SCRAPER_RETRY_OPTIONS) retry?: RetryOptions,
  ) {
    this.retry = retry ?? {
      attempts: 3,
      baseDelayMs: 1_000,
      maxDelayMs: 8_000,
      maxRetryAfterMs: 15_000,
    };
  }

  async scrape(target: ScrapeTarget, now = new Date()): Promise<ScrapeOutcome> {
    let scraped: ExtractedPrice;
    try {
      scraped = await withRetry(() => this.fetchAndExtract(target), this.retry);
    } catch (err) {
      if (!(err instanceof ScrapeError)) throw err; // programming error: don't mask it
      await this.markFailure(target, err, now);
      return { ok: false, kind: err.kind, retryAfterMs: err.retryAfterMs };
    }

    try {
      const rec = await this.prices.record(
        target.storeId,
        target.id,
        { price: scraped.price, inStock: scraped.inStock ?? undefined, source: 'scraper' },
        now,
      );
      await this.markSuccess(target, now);
      return { ok: true, recorded: rec.recorded, changed: rec.changed, price: rec.price };
    } catch (err) {
      if (err instanceof NotFoundException) {
        // Competitor was deleted (or moved) while we were fetching.
        this.logger.debug(`Competitor ${target.id} disappeared during scrape`);
        return { ok: false, kind: 'invalid_url' };
      }
      throw err;
    }
  }

  private async fetchAndExtract(target: ScrapeTarget): Promise<ExtractedPrice> {
    parseCompetitorUrl(target.productUrl); // re-check: stored URLs predate rule changes
    const html = await this.fetcher.fetchHtml(target.productUrl);

    const extracted = extractPrice(html);
    if (!extracted) throw new ScrapeError('parse_failed', 'No price found on the page');
    if (extracted.currency && extracted.currency !== target.currency.toUpperCase()) {
      throw new ScrapeError(
        'currency_mismatch',
        `Page quotes ${extracted.currency}, listing tracks ${target.currency}`,
      );
    }
    return extracted;
  }

  private async markSuccess(target: ScrapeTarget, now: Date): Promise<void> {
    const everyMs = this.config.get('SCRAPER_INTERVAL_MINUTES', { infer: true }) * MINUTE_MS;
    await this.prisma.competitor.updateMany({
      where: { id: target.id, storeId: target.storeId },
      data: {
        scrapeFailures: 0,
        lastScrapeError: null,
        nextScrapeAt: new Date(now.getTime() + everyMs),
      },
    });
  }

  private async markFailure(target: ScrapeTarget, err: ScrapeError, now: Date): Promise<void> {
    const failures = target.scrapeFailures + 1;
    const exponential = Math.min(
      FAILURE_BACKOFF_MAX_MS,
      FAILURE_BACKOFF_BASE_MS * 2 ** Math.min(failures - 1, 10),
    );
    const delay = PERMANENT_KINDS.has(err.kind)
      ? FAILURE_BACKOFF_MAX_MS
      : Math.max(exponential, err.retryAfterMs ?? 0);

    // Log kind only: messages/URLs may carry merchant-supplied or third-party data.
    this.logger.warn(`Scrape failed for competitor ${target.id}: ${err.kind} (#${failures})`);

    await this.prisma.competitor.updateMany({
      where: { id: target.id, storeId: target.storeId },
      data: {
        scrapeFailures: failures,
        lastScrapeError: err.kind,
        nextScrapeAt: new Date(now.getTime() + delay),
      },
    });
  }
}
