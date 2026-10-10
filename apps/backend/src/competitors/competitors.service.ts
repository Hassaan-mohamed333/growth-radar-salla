import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@growth-radar/database';
import { PrismaService } from '../prisma/prisma.service';
import { ScrapeError } from '../scraper/scrape-error';
import { domainOf, parseCompetitorUrl } from '../scraper/url-guard';

export interface CompetitorDto {
  id: string;
  name: string;
  domain: string;
  productUrl: string | null;
  productId: string | null;
  currency: string;
  isActive: boolean;
  lastPrice: string | null;
  lastCheckedAt: string | null;
  scrapeFailures: number;
  /** Fixed-vocabulary reason of the last failed scrape (see ScrapeFailureKind). */
  lastScrapeError: string | null;
  nextScrapeAt: string | null;
}

export interface ListedCompetitorDto extends CompetitorDto {
  product: { id: string; name: string } | null;
}

export interface ListCompetitorsQuery {
  page: number;
  pageSize: number;
  /** Case-insensitive match on name or domain. */
  search?: string;
}

export interface CompetitorListResponse {
  items: ListedCompetitorDto[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CreateCompetitorInput {
  name: string;
  /** Required when no productUrl is given. */
  domain?: string;
  productUrl?: string;
  productId?: string;
  currency?: string;
}

export interface UpdateCompetitorInput {
  name?: string;
  /** null clears the listing URL (stops scraping). */
  productUrl?: string | null;
  isActive?: boolean;
  currency?: string;
  /** Re-link to another product of the store; null detaches it. */
  productId?: string | null;
}

export interface LinkProductCompetitorInput {
  productUrl: string;
  /** Defaults to the competitor's domain. */
  name?: string;
  currency?: string;
}

const select = {
  id: true,
  name: true,
  domain: true,
  productUrl: true,
  productId: true,
  currency: true,
  isActive: true,
  lastPrice: true,
  lastCheckedAt: true,
  scrapeFailures: true,
  lastScrapeError: true,
  nextScrapeAt: true,
} satisfies Prisma.CompetitorSelect;

const listSelect = {
  ...select,
  product: { select: { id: true, name: true } },
} satisfies Prisma.CompetitorSelect;

type Row = Prisma.CompetitorGetPayload<{ select: typeof select }>;
type ListRow = Prisma.CompetitorGetPayload<{ select: typeof listSelect }>;

/** Competitor/listing management. Every query is scoped by the session's store. */
@Injectable()
export class CompetitorsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(storeId: string, q: ListCompetitorsQuery): Promise<CompetitorListResponse> {
    const where: Prisma.CompetitorWhereInput = { storeId };
    if (q.search) {
      where.OR = [
        { name: { contains: q.search, mode: 'insensitive' } },
        { domain: { contains: q.search, mode: 'insensitive' } },
      ];
    }

    const [total, rows] = await Promise.all([
      this.prisma.competitor.count({ where }),
      this.prisma.competitor.findMany({
        where,
        orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: listSelect,
      }),
    ]);

    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((r: ListRow) => ({ ...toDto(r), product: r.product })),
    };
  }

  async create(
    ctx: { tenantId: string; storeId: string },
    input: CreateCompetitorInput,
  ): Promise<CompetitorDto> {
    const listing = resolveListing(input.productUrl, input.domain);
    if (input.productId) await this.requireProduct(ctx.storeId, input.productId);

    return this.insert({
      ...ctx,
      productId: input.productId ?? null,
      name: input.name,
      domain: listing.domain,
      productUrl: listing.productUrl,
      currency: input.currency ?? 'SAR',
    });
  }

  /** Attaches a competitor's product page to one of our products. */
  async linkToProduct(
    ctx: { tenantId: string; storeId: string },
    productId: string,
    input: LinkProductCompetitorInput,
  ): Promise<CompetitorDto> {
    const product = await this.requireProduct(ctx.storeId, productId);
    const listing = resolveListing(input.productUrl, undefined);

    return this.insert({
      ...ctx,
      productId,
      name: input.name ?? listing.domain,
      domain: listing.domain,
      productUrl: listing.productUrl,
      currency: input.currency ?? product.currency,
    });
  }

  async update(storeId: string, id: string, input: UpdateCompetitorInput): Promise<CompetitorDto> {
    const existing = await this.prisma.competitor.findFirst({
      where: { id, storeId },
      select: { productUrl: true },
    });
    if (!existing) throw new NotFoundException('Competitor not found');

    const data: Prisma.CompetitorUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.productId !== undefined) {
      if (input.productId === null) {
        data.product = { disconnect: true };
      } else {
        await this.requireProduct(storeId, input.productId);
        data.product = { connect: { id: input.productId } };
      }
    }

    if (input.productUrl !== undefined) {
      if (input.productUrl === null) {
        data.productUrl = null;
      } else {
        const listing = resolveListing(input.productUrl, undefined);
        data.productUrl = listing.productUrl;
        data.domain = listing.domain;
      }
      if (data.productUrl !== existing.productUrl) {
        // A different page: the old price/failure state no longer applies.
        data.lastPrice = null;
        data.scrapeFailures = 0;
        data.lastScrapeError = null;
        data.nextScrapeAt = null;
      }
    }

    try {
      const row = await this.prisma.competitor.update({ where: { id }, data, select });
      return toDto(row);
    } catch (err) {
      throw mapWriteError(err);
    }
  }

  private async insert(data: {
    tenantId: string;
    storeId: string;
    productId: string | null;
    name: string;
    domain: string;
    productUrl: string | null;
    currency: string;
  }): Promise<CompetitorDto> {
    try {
      return toDto(await this.prisma.competitor.create({ data, select }));
    } catch (err) {
      throw mapWriteError(err);
    }
  }

  private async requireProduct(storeId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, storeId },
      select: { id: true, currency: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }
}

/** Validates the page URL / domain and derives the normalised stored values. */
function resolveListing(
  productUrl: string | undefined,
  domain: string | undefined,
): { domain: string; productUrl: string | null } {
  try {
    if (productUrl) {
      const url = parseCompetitorUrl(productUrl);
      const derived = domainOf(url);
      if (domain && domainOf(parseCompetitorUrl(`https://${domain}`)) !== derived) {
        throw new BadRequestException('domain does not match productUrl');
      }
      return { domain: derived, productUrl: url.toString() };
    }
    if (!domain) throw new BadRequestException('Either productUrl or domain is required');
    return { domain: domainOf(parseCompetitorUrl(`https://${domain}`)), productUrl: null };
  } catch (err) {
    if (err instanceof ScrapeError) {
      // Fixed text: never echo the offending URL back or hint at internal topology.
      throw new BadRequestException(
        err.kind === 'forbidden_target' ? 'URL target is not allowed' : 'Invalid URL',
      );
    }
    throw err;
  }
}

function mapWriteError(err: unknown): unknown {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return new ConflictException('This competitor listing already exists');
  }
  return err;
}

function toDto(r: Row): CompetitorDto {
  return {
    id: r.id,
    name: r.name,
    domain: r.domain,
    productUrl: r.productUrl,
    productId: r.productId,
    currency: r.currency,
    isActive: r.isActive,
    lastPrice: r.lastPrice ? r.lastPrice.toFixed(2) : null,
    lastCheckedAt: r.lastCheckedAt?.toISOString() ?? null,
    scrapeFailures: r.scrapeFailures,
    lastScrapeError: r.lastScrapeError,
    nextScrapeAt: r.nextScrapeAt?.toISOString() ?? null,
  };
}
