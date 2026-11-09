import { Logger } from '@nestjs/common';
import { PageFetcher } from './page-fetcher';
import { platformAdapterFor } from './platform-adapters';
import { extractPrice } from './price-extractor';
import type { RenderFetcher } from './render-fetcher';
import { ScrapeError } from './scrape-error';

/** The plain HTTP tier (HttpPageFetcher satisfies this). */
export interface HttpTier {
  fetchHtml(url: string): Promise<string>;
  fetchJson(url: string): Promise<unknown>;
}

export interface TieredPageFetcherOptions {
  http: HttpTier;
  /** Tier 3. Absent = never used. */
  render?: RenderFetcher;
  /** Consecutive blocked fetches before a domain is paused. */
  blockThreshold?: number;
  /** How long a paused domain is left alone. */
  cooldownMs?: number;
  now?: () => number;
}

interface BreakerState {
  blocked: number;
  openUntil: number;
}

const MAX_TRACKED_DOMAINS = 1_000;
const NEVER_ESCALATE = new Set(['invalid_url', 'forbidden_target']);

/**
 * Fetching engine with escalating tiers, cheapest first:
 *
 *   1. plain HTTP GET of the page
 *   2. the platform's public product JSON (Shopify, WooCommerce)
 *   3. a rendering service, when the operator configured one
 *
 * A product page only counts as fetched once a price can be read from it. Each domain has a circuit
 * breaker: after repeated blocks it is left alone for a cooldown instead of being hammered, which
 * keeps us polite and avoids burning paid rendering requests on a site that will never answer.
 *
 * It does not try to defeat bot protection: the User-Agent stays honest and challenge pages are
 * not solved. When a site refuses us, the answer is "blocked", and the merchant sees that.
 */
export class TieredPageFetcher extends PageFetcher {
  private readonly logger = new Logger(TieredPageFetcher.name);
  private readonly breakers = new Map<string, BreakerState>();
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(private readonly opts: TieredPageFetcherOptions) {
    super();
    this.threshold = opts.blockThreshold ?? 3;
    this.cooldownMs = opts.cooldownMs ?? 30 * 60_000;
    this.now = opts.now ?? Date.now;
  }

  /** Any page (e.g. a search results page): plain fetch, rendering service only if blocked. */
  async fetchHtml(url: string): Promise<string> {
    const host = hostOf(url);
    this.assertOpen(host);
    try {
      const html = await this.opts.http.fetchHtml(url);
      this.succeeded(host);
      return html;
    } catch (err) {
      if (!(err instanceof ScrapeError)) throw err;
      if (err.kind === 'blocked' && this.opts.render) {
        const rendered = await this.tryRender(url);
        if (rendered !== null) {
          this.succeeded(host);
          return rendered;
        }
      }
      this.failed(host, err);
      throw err;
    }
  }

  /** A product page the caller will price: escalate until a price can be read. */
  override async fetchProductHtml(url: string): Promise<string> {
    const host = hostOf(url);
    this.assertOpen(host);

    let firstError: ScrapeError | null = null;
    let html: string | null = null;

    // Tier 1
    try {
      html = await this.opts.http.fetchHtml(url);
      if (extractPrice(html)) {
        this.succeeded(host);
        return html;
      }
    } catch (err) {
      if (!(err instanceof ScrapeError)) throw err;
      if (NEVER_ESCALATE.has(err.kind)) throw err;
      firstError = err;
    }

    // Tier 2
    const adapter = platformAdapterFor(url);
    if (adapter) {
      try {
        const page = adapter.toHtml(await this.opts.http.fetchJson(adapter.apiUrl));
        this.succeeded(host);
        return page;
      } catch (err) {
        if (!(err instanceof ScrapeError)) throw err;
        firstError ??= err;
      }
    }

    // Tier 3: only worth paying for when the site refused us or served a page with no price in it
    // (typically one that needs JavaScript).
    if (this.opts.render && (html !== null || firstError?.kind === 'blocked')) {
      const rendered = await this.tryRender(url);
      if (rendered !== null && extractPrice(rendered)) {
        this.succeeded(host);
        return rendered;
      }
    }

    // The page loaded but has no price anywhere we can read: hand it back so the caller reports
    // `parse_failed` (a layout problem, not a block).
    if (html !== null) return html;

    this.failed(host, firstError);
    throw firstError ?? new ScrapeError('http_error', 'No tier could fetch the page');
  }

  private async tryRender(url: string): Promise<string | null> {
    try {
      return await this.opts.render!.fetchRendered(url);
    } catch (err) {
      if (!(err instanceof ScrapeError)) throw err;
      this.logger.warn(`Rendering tier failed: ${err.kind}`);
      return null;
    }
  }

  // ───────────────────────── circuit breaker ─────────────────────────

  private assertOpen(host: string): void {
    const state = this.breakers.get(host);
    if (!state || state.openUntil === 0) return;
    const remaining = state.openUntil - this.now();
    if (remaining > 0) {
      throw new ScrapeError('blocked', 'Domain paused after repeated blocks', { retryAfterMs: remaining });
    }
    // Cooldown over: allow one probe. One more block re-opens the breaker immediately.
    state.openUntil = 0;
    state.blocked = this.threshold - 1;
  }

  private succeeded(host: string): void {
    this.breakers.delete(host);
  }

  private failed(host: string, err: ScrapeError | null): void {
    if (err?.kind !== 'blocked') return;
    if (this.breakers.size >= MAX_TRACKED_DOMAINS && !this.breakers.has(host)) this.breakers.clear();

    const state = this.breakers.get(host) ?? { blocked: 0, openUntil: 0 };
    state.blocked += 1;
    if (state.blocked >= this.threshold) {
      state.openUntil = this.now() + this.cooldownMs;
      this.logger.warn(`Pausing ${host} for ${Math.round(this.cooldownMs / 60_000)} min after repeated blocks`);
    }
    this.breakers.set(host, state);
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}
