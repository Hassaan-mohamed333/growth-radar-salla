import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@growth-radar/database';
import type { Env } from '../config/env';
import { CompetitorPricesService } from '../competitors/competitor-prices.service';
import { CompetitorsService } from '../competitors/competitors.service';
import { PrismaService } from '../prisma/prisma.service';
import { PageFetcher } from '../scraper/page-fetcher';
import { extractPrice, extractProductName } from '../scraper/price-extractor';
import { ScrapeError } from '../scraper/scrape-error';
import { domainOf, parseCompetitorUrl } from '../scraper/url-guard';
import { type Candidate, extractCandidates, searchUrls } from './search-results';
import { AUTO_LINK_SCORE, scoreMatch, searchQuery, SUGGEST_SCORE } from './title-matcher';

export type MatchStatus = 'SUGGESTED' | 'LINKED' | 'CONFIRMED' | 'REJECTED';

export interface ListingDto {
  id: string;
  name: string;
  domain: string;
  productUrl: string;
  lastPrice: string | null;
  lastCheckedAt: string | null;
  lastScrapeError: string | null;
  isActive: boolean;
}

export interface MatchDto {
  id: string;
  productId: string;
  domain: string;
  candidateUrl: string;
  candidateTitle: string;
  candidatePrice: string | null;
  currency: string;
  score: number;
  status: MatchStatus;
}

export interface MatchedProductDto {
  id: string;
  name: string;
  currency: string;
  /** Sale price when there is one, otherwise the regular price. */
  ourPrice: string;
  listings: ListingDto[];
  suggestions: MatchDto[];
  /** Lowest known price among the linked listings, null when none has a price yet. */
  lowestCompetitorPrice: string | null;
  /** How far our price is above (+) or below (-) the lowest competitor, in percent. */
  gapPct: number | null;
}

export interface MatchingOverview {
  /** False when price fetching is switched off on the server: searching is unavailable. */
  scraperEnabled: boolean;
  summary: { products: number; matched: number; pendingSuggestions: number };
  items: MatchedProductDto[];
  page: number;
  pageSize: number;
  total: number;
}

export type DomainOutcomeKind = 'linked' | 'suggested' | 'none' | 'unreachable' | 'already';

export interface DomainOutcome {
  domain: string;
  name: string;
  outcome: DomainOutcomeKind;
  score?: number;
}

export interface SearchResult {
  productId: string;
  outcomes: DomainOutcome[];
}

export interface ListMatchingQuery {
  page: number;
  pageSize: number;
  search?: string;
}

/** Competitors searched per request. More would not finish inside a request. */
const MAX_DOMAINS = 8;
/** A search on one site stops starting new requests after this long. */
const DOMAIN_BUDGET_MS = 15_000;
/** Product pages fetched per site: the best few search hits, never the whole result page. */
const MAX_PAGES_PER_DOMAIN = 3;
/** Search-result titles are often shortened, so rank loosely and decide on the product page's name. */
const TITLE_FLOOR = 30;

interface Found {
  url: string;
  title: string;
  price: number;
  currency: string | null;
  score: number;
  quantitiesAgree: boolean;
}

interface ProductRef {
  id: string;
  name: string;
  currency: string;
}

/**
 * Finds products in competitors' stores that look like ours, and compares prices.
 *
 * For each tracked competitor site it searches the site for the product's name, reads the best few
 * hits and scores each page's own product name against ours (title-matcher). A strong, same-size
 * match is linked at once by creating a normal tracked listing, so the existing scraper keeps its
 * price fresh. A weaker one is stored as a suggestion for the merchant to confirm. Nothing is ever
 * linked on a name match alone when the sizes differ.
 */
@Injectable()
export class ProductMatchingService {
  private readonly logger = new Logger(ProductMatchingService.name);
  /** One search per product at a time: a double click must not fetch every competitor twice. */
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly competitors: CompetitorsService,
    private readonly prices: CompetitorPricesService,
    private readonly fetcher: PageFetcher,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async overview(storeId: string, q: ListMatchingQuery): Promise<MatchingOverview> {
    const where: Prisma.ProductWhereInput = { storeId, status: { not: 'DELETED' } };
    if (q.search) where.name = { contains: q.search, mode: 'insensitive' };

    const [total, products, totalProducts, matchedGroups, pending] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true,
          name: true,
          price: true,
          salePrice: true,
          currency: true,
          competitors: {
            where: { productUrl: { not: null } },
            orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
            select: {
              id: true,
              name: true,
              domain: true,
              productUrl: true,
              lastPrice: true,
              lastCheckedAt: true,
              lastScrapeError: true,
              isActive: true,
            },
          },
          matches: {
            where: { status: 'SUGGESTED' },
            orderBy: [{ score: 'desc' }, { createdAt: 'asc' }],
          },
        },
      }),
      this.prisma.product.count({ where: { storeId, status: { not: 'DELETED' } } }),
      this.prisma.competitor.groupBy({
        by: ['productId'],
        where: { storeId, productId: { not: null }, productUrl: { not: null } },
      }),
      this.prisma.productMatch.count({ where: { storeId, status: 'SUGGESTED' } }),
    ]);

    return {
      scraperEnabled: this.config.get('SCRAPER_ENABLED', { infer: true }),
      summary: { products: totalProducts, matched: matchedGroups.length, pendingSuggestions: pending },
      page: q.page,
      pageSize: q.pageSize,
      total,
      items: products.map((p) => {
        const ours = p.salePrice ?? p.price;
        const known = p.competitors
          .filter((c) => c.isActive && c.lastPrice !== null)
          .map((c) => c.lastPrice!.toNumber());
        const lowest = known.length > 0 ? Math.min(...known) : null;
        return {
          id: p.id,
          name: p.name,
          currency: p.currency,
          ourPrice: ours.toFixed(2),
          listings: p.competitors.map((c) => ({
            id: c.id,
            name: c.name,
            domain: c.domain,
            productUrl: c.productUrl!,
            lastPrice: c.lastPrice ? c.lastPrice.toFixed(2) : null,
            lastCheckedAt: c.lastCheckedAt?.toISOString() ?? null,
            lastScrapeError: c.lastScrapeError,
            isActive: c.isActive,
          })),
          suggestions: p.matches.map(toMatchDto),
          lowestCompetitorPrice: lowest === null ? null : lowest.toFixed(2),
          gapPct: lowest === null || lowest === 0 ? null : Math.round(((ours.toNumber() - lowest) / lowest) * 1000) / 10,
        };
      }),
    };
  }

  /** Searches every tracked competitor site for products like this one. */
  async search(ctx: { tenantId: string; storeId: string }, productId: string): Promise<SearchResult> {
    if (!this.config.get('SCRAPER_ENABLED', { infer: true })) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'scraper_disabled',
        message: 'Price fetching is switched off on the server.',
      });
    }

    const product = await this.prisma.product.findFirst({
      where: { id: productId, storeId: ctx.storeId, status: { not: 'DELETED' } },
      select: { id: true, name: true, currency: true },
    });
    if (!product) throw new NotFoundException('Product not found');

    const query = searchQuery(product.name);
    if (!query) throw new BadRequestException('اسم المنتج لا يحتوي كلمات كافية للبحث عنه.');

    const key = `${ctx.storeId}:${productId}`;
    if (this.inFlight.has(key)) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'search_in_progress',
        message: 'A search for this product is already running.',
      });
    }
    this.inFlight.add(key);

    try {
      const sites = await this.sitesToSearch(ctx.storeId, productId);
      const outcomes = await Promise.all(sites.map((s) => this.searchSite(ctx, product, query, s)));
      return { productId, outcomes };
    } finally {
      this.inFlight.delete(key);
    }
  }

  /** Confirms a suggestion: links the page as a tracked listing for the product. */
  async confirm(ctx: { tenantId: string; storeId: string }, id: string): Promise<MatchDto> {
    const claimed = await this.prisma.productMatch.updateMany({
      where: { id, storeId: ctx.storeId, status: 'SUGGESTED' },
      data: { status: 'CONFIRMED' },
    });
    if (claimed.count === 0) await this.explainMiss(ctx.storeId, id);

    const match = await this.prisma.productMatch.findFirstOrThrow({
      where: { id, storeId: ctx.storeId },
      include: { product: { select: { id: true, name: true, currency: true } } },
    });

    try {
      const competitorId = await this.link(ctx, match.product, match.domain, match.candidateUrl, {
        price: match.candidatePrice?.toNumber() ?? null,
      });
      const row = await this.prisma.productMatch.update({ where: { id }, data: { competitorId } });
      return toMatchDto(row);
    } catch (err) {
      // Release the claim so the merchant can retry or reject.
      await this.prisma.productMatch.updateMany({
        where: { id, storeId: ctx.storeId, status: 'CONFIRMED', competitorId: null },
        data: { status: 'SUGGESTED' },
      });
      throw err;
    }
  }

  async reject(storeId: string, id: string): Promise<MatchDto> {
    const res = await this.prisma.productMatch.updateMany({
      where: { id, storeId, status: 'SUGGESTED' },
      data: { status: 'REJECTED' },
    });
    if (res.count === 0) await this.explainMiss(storeId, id);
    return toMatchDto(await this.prisma.productMatch.findFirstOrThrow({ where: { id, storeId } }));
  }

  // ───────────────────────── search internals ─────────────────────────

  /** Active competitor sites without a listing for this product yet, one entry per domain. */
  private async sitesToSearch(storeId: string, productId: string): Promise<Array<{ domain: string; name: string }>> {
    const rows = await this.prisma.competitor.findMany({
      where: { storeId, isActive: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { domain: true, name: true, productId: true, productUrl: true },
    });

    const haveListing = new Set(
      rows.filter((r) => r.productId === productId && r.productUrl !== null).map((r) => r.domain),
    );
    const sites = new Map<string, string>();
    for (const r of rows) {
      if (haveListing.has(r.domain)) continue;
      // The site-level row (no product URL) carries the name the merchant chose for the competitor.
      if (!sites.has(r.domain) || r.productUrl === null) sites.set(r.domain, r.name);
    }
    return [...sites].slice(0, MAX_DOMAINS).map(([domain, name]) => ({ domain, name }));
  }

  private async searchSite(
    ctx: { tenantId: string; storeId: string },
    product: ProductRef,
    query: string,
    site: { domain: string; name: string },
  ): Promise<DomainOutcome> {
    const base = { domain: site.domain, name: site.name };
    try {
      const found = await this.findOnSite(site.domain, query, product);
      if (found === 'unreachable') return { ...base, outcome: 'unreachable' };
      if (!found) return { ...base, outcome: 'none' };

      const prior = await this.prisma.productMatch.findUnique({
        where: {
          storeId_productId_candidateUrl: { storeId: ctx.storeId, productId: product.id, candidateUrl: found.url },
        },
        select: { status: true },
      });
      if (prior?.status === 'REJECTED') return { ...base, outcome: 'none' };
      if (prior && prior.status !== 'SUGGESTED') return { ...base, outcome: 'already', score: found.score };

      const strong = found.score >= AUTO_LINK_SCORE && found.quantitiesAgree;
      const data = {
        domain: site.domain,
        candidateTitle: found.title,
        candidatePrice: new Prisma.Decimal(found.price).toDecimalPlaces(2),
        currency: found.currency ?? product.currency,
        score: found.score,
      };
      const match = await this.prisma.productMatch.upsert({
        where: {
          storeId_productId_candidateUrl: { storeId: ctx.storeId, productId: product.id, candidateUrl: found.url },
        },
        create: { tenantId: ctx.tenantId, storeId: ctx.storeId, productId: product.id, candidateUrl: found.url, ...data },
        update: data,
      });

      if (!strong) return { ...base, outcome: 'suggested', score: found.score };

      try {
        const competitorId = await this.link(ctx, product, site.domain, found.url, { name: site.name, price: found.price });
        await this.prisma.productMatch.update({
          where: { id: match.id },
          data: { status: 'LINKED', competitorId },
        });
        return { ...base, outcome: 'linked', score: found.score };
      } catch (err) {
        // The URL guard or a conflict refused the link: keep it as a suggestion rather than lose it.
        if (err instanceof BadRequestException) {
          await this.prisma.productMatch.deleteMany({ where: { id: match.id } });
          return { ...base, outcome: 'none' };
        }
        this.logger.warn(`Auto-link failed for ${site.domain}: ${(err as Error).name}`);
        return { ...base, outcome: 'suggested', score: found.score };
      }
    } catch (err) {
      // One broken site must not fail the whole search.
      this.logger.warn(`Search on ${site.domain} failed: ${(err as Error).name}`);
      return { ...base, outcome: 'unreachable' };
    }
  }

  /** The best matching product on one site, 'unreachable' when the site never answered, or null. */
  private async findOnSite(domain: string, query: string, product: ProductRef): Promise<Found | 'unreachable' | null> {
    const deadline = Date.now() + DOMAIN_BUDGET_MS;
    const delayMs = this.config.get('SCRAPER_DOMAIN_DELAY_MS', { infer: true });
    let answered = false;
    let candidates: Candidate[] = [];
    let first = true;

    for (const url of searchUrls(domain, query)) {
      if (Date.now() > deadline) break;
      if (!first) await sleep(delayMs);
      first = false;
      try {
        const html = await this.fetcher.fetchHtml(url);
        answered = true;
        candidates = extractCandidates(html, parseCompetitorUrl(url), domain);
        if (candidates.length > 0) break;
      } catch (err) {
        if (!(err instanceof ScrapeError)) throw err;
        // A 404 on one search path just means the site uses another: try the next one.
      }
    }
    if (!answered) return 'unreachable';

    // Rank on the (often shortened) search-result title, then decide on the page's own name.
    const ranked = candidates
      .map((c) => ({ c, s: scoreMatch(product.name, c.title) }))
      .filter((x) => x.s.score >= TITLE_FLOOR && x.s.quantitiesAgree)
      .sort((a, b) => b.s.score - a.s.score)
      .slice(0, MAX_PAGES_PER_DOMAIN);

    let best: Found | null = null;
    for (const { c } of ranked) {
      if (Date.now() > deadline) break;
      await sleep(delayMs);

      let html: string;
      try {
        html = await this.fetcher.fetchHtml(c.url);
      } catch (err) {
        if (err instanceof ScrapeError) continue;
        throw err;
      }

      const price = extractPrice(html);
      if (!price) continue; // a page we could not price is of no use for a comparison
      if (price.currency && price.currency !== product.currency.toUpperCase()) continue;

      const title = extractProductName(html) ?? c.title;
      const s = scoreMatch(product.name, title);
      if (s.score < SUGGEST_SCORE) continue;

      const found: Found = {
        url: parseCompetitorUrl(c.url).toString(),
        title,
        price: price.price,
        currency: price.currency,
        score: s.score,
        quantitiesAgree: s.quantitiesAgree,
      };
      if (!best || found.score > best.score) best = found;
      if (found.score >= AUTO_LINK_SCORE && found.quantitiesAgree) break; // good enough: stop fetching
    }
    return best;
  }

  /** Creates (or finds) the tracked listing for a matched page and records its first price. */
  private async link(
    ctx: { tenantId: string; storeId: string },
    product: ProductRef,
    domain: string,
    candidateUrl: string,
    opts: { name?: string; price: number | null },
  ): Promise<string> {
    const url = parseCompetitorUrl(candidateUrl);
    const name = opts.name ?? (await this.siteName(ctx.storeId, domain));

    let competitorId: string;
    try {
      const dto = await this.competitors.linkToProduct(ctx, product.id, {
        productUrl: url.toString(),
        name,
        currency: product.currency,
      });
      competitorId = dto.id;
    } catch (err) {
      if (!(err instanceof ConflictException)) throw err;
      // The same page is already tracked: reuse that listing instead of failing.
      const existing = await this.prisma.competitor.findFirst({
        where: { storeId: ctx.storeId, domain: domainOf(url), productUrl: url.toString() },
        select: { id: true },
      });
      if (!existing) throw err;
      competitorId = existing.id;
      await this.prisma.competitor.updateMany({
        where: { id: competitorId, storeId: ctx.storeId, productId: null },
        data: { productId: product.id },
      });
    }

    if (opts.price !== null) {
      // So the comparison shows a price straight away; the scraper keeps it fresh afterwards.
      await this.prices
        .record(ctx.storeId, competitorId, { price: opts.price, source: 'match' })
        .catch((err: unknown) => this.logger.warn(`First price not recorded: ${(err as Error).name}`));
    }
    return competitorId;
  }

  private async siteName(storeId: string, domain: string): Promise<string> {
    const row = await this.prisma.competitor.findFirst({
      where: { storeId, domain, productUrl: null },
      select: { name: true },
    });
    return row?.name ?? domain;
  }

  private async explainMiss(storeId: string, id: string): Promise<never> {
    const exists = await this.prisma.productMatch.findFirst({ where: { id, storeId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Match not found');
    throw new ConflictException('Match was already handled');
  }
}

function toMatchDto(m: {
  id: string;
  productId: string;
  domain: string;
  candidateUrl: string;
  candidateTitle: string;
  candidatePrice: Prisma.Decimal | null;
  currency: string;
  score: number;
  status: MatchStatus;
}): MatchDto {
  return {
    id: m.id,
    productId: m.productId,
    domain: m.domain,
    candidateUrl: m.candidateUrl,
    candidateTitle: m.candidateTitle,
    candidatePrice: m.candidatePrice ? m.candidatePrice.toFixed(2) : null,
    currency: m.currency,
    score: m.score,
    status: m.status,
  };
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}
