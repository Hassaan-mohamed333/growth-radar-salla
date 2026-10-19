import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@growth-radar/database';
import { type CompetitorDto, CompetitorsService } from '../competitors/competitors.service';
import { PrismaService } from '../prisma/prisma.service';
import { buildSuggestions, normaliseDomain, type DiscoveryReason } from './discovery-engine';
import { CATALOG, NICHES, type CompetitorKind } from './ksa-catalog';
import { COUNTRY_CODE, CURRENCY, eligibleEntries, isSupportedCurrency, ksaRejection } from './ksa-guard';
import { analyzeNiches } from './niche-analyzer';
import { buildSwot, type SwotFacts, type SwotSections } from './swot-engine';

export interface DiscoveryDto {
  id: string;
  catalogKey: string;
  name: string;
  domain: string;
  kind: CompetitorKind;
  countryCode: string;
  currency: string;
  niches: string[];
  score: number;
  reasons: DiscoveryReason[];
  status: 'SUGGESTED' | 'ADDED' | 'DISMISSED';
  competitorId: string | null;
}

export interface NicheDto {
  key: string;
  label: string;
  productCount: number;
  sharePct: number;
  trackedCompetitors: number;
  suggestedCompetitors: number;
}

export interface SwotDto extends SwotSections {
  generatedAt: string;
  /** The measured counts the report was computed from. */
  basis: SwotFacts;
}

export interface InsightsOverview {
  /** False when discovery does not apply to this store (it prices in a currency other than SAR). */
  eligible: boolean;
  currency: string;
  reason: 'currency_not_sar' | null;
  niches: NicheDto[];
  suggestions: DiscoveryDto[];
  addedCount: number;
  swot: SwotDto | null;
}

export interface AddedDiscovery {
  discovery: DiscoveryDto;
  competitor: CompetitorDto;
}

const KEEP_SWOT_REPORTS = 10;
const nicheLabel = new Map(NICHES.map((n) => [n.key, n.label]));
const catalogByDomain = new Map(CATALOG.map((e) => [normaliseDomain(e.domain), e]));

/** Competitor discovery, niche analysis and SWOT. Every query is scoped by the session's store. */
@Injectable()
export class CompetitorInsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly competitors: CompetitorsService,
  ) {}

  async overview(storeId: string): Promise<InsightsOverview> {
    const store = await this.prisma.store.findUniqueOrThrow({
      where: { id: storeId },
      select: { currency: true },
    });
    const eligible = isSupportedCurrency(store.currency);

    const [niches, suggestions, addedCount, swot] = await Promise.all([
      this.prisma.nicheInsight.findMany({
        where: { storeId },
        orderBy: [{ productCount: 'desc' }, { niche: 'asc' }],
      }),
      this.prisma.competitorDiscovery.findMany({
        where: { storeId, status: 'SUGGESTED' },
        orderBy: [{ score: 'desc' }, { name: 'asc' }],
      }),
      this.prisma.competitorDiscovery.count({ where: { storeId, status: 'ADDED' } }),
      this.prisma.swotReport.findFirst({ where: { storeId }, orderBy: { generatedAt: 'desc' } }),
    ]);

    return {
      eligible,
      currency: store.currency,
      reason: eligible ? null : 'currency_not_sar',
      niches: niches.map((n) => ({
        key: n.niche,
        label: n.label,
        productCount: n.productCount,
        sharePct: n.sharePct.toNumber(),
        trackedCompetitors: n.trackedCompetitors,
        suggestedCompetitors: n.suggestedCompetitors,
      })),
      suggestions: suggestions.map(toDiscoveryDto),
      addedCount,
      swot: swot && {
        generatedAt: swot.generatedAt.toISOString(),
        strengths: swot.strengths as unknown as SwotSections['strengths'],
        weaknesses: swot.weaknesses as unknown as SwotSections['weaknesses'],
        opportunities: swot.opportunities as unknown as SwotSections['opportunities'],
        threats: swot.threats as unknown as SwotSections['threats'],
        basis: swot.basis as unknown as SwotFacts,
      },
    };
  }

  /**
   * Re-reads the store's catalogue and tracked competitors, then recomputes niches, suggestions and
   * the SWOT. Idempotent: running it twice in a row changes nothing but the report timestamp.
   * Dismissed suggestions stay dismissed.
   */
  async refresh(ctx: { tenantId: string; storeId: string }): Promise<InsightsOverview> {
    const { tenantId, storeId } = ctx;
    const store = await this.prisma.store.findUniqueOrThrow({
      where: { id: storeId },
      select: { currency: true, domain: true },
    });

    const [products, competitors, existing] = await Promise.all([
      this.prisma.product.findMany({
        where: { storeId, status: { not: 'DELETED' } },
        select: { id: true, name: true, price: true, salePrice: true, costPrice: true },
      }),
      this.prisma.competitor.findMany({
        where: { storeId },
        select: { domain: true, isActive: true, lastPrice: true, lastScrapeError: true, productId: true },
      }),
      this.prisma.competitorDiscovery.findMany({
        where: { storeId },
        select: { domain: true, status: true },
      }),
    ]);

    const analysis = analyzeNiches(products);
    const trackedDomains = new Set(competitors.map((c) => normaliseDomain(c.domain)));
    // A suggestion marked ADDED whose competitor was since deleted is open for suggestion again.
    const dismissed = new Set(existing.filter((d) => d.status === 'DISMISSED').map((d) => d.domain));
    const skip = new Set([...trackedDomains, ...dismissed]);
    if (store.domain) skip.add(normaliseDomain(store.domain));

    const eligible = isSupportedCurrency(store.currency);
    const suggestions = eligible
      ? buildSuggestions(analysis.productNiches, eligibleEntries(CATALOG), skip)
      : [];

    // Which niches the tracked competitors cover: through the product they are linked to, or
    // through the catalogue when the competitor is a known operator added at store level.
    const nicheOfProduct = new Map(products.map((p, i) => [p.id, analysis.productNiches[i]!]));
    const trackedByNiche = new Map<string, number>();
    for (const c of competitors.filter((x) => x.isActive)) {
      const covered = new Set<string>([
        ...(c.productId ? (nicheOfProduct.get(c.productId) ?? []) : []),
        ...(catalogByDomain.get(normaliseDomain(c.domain))?.niches ?? []),
      ]);
      for (const n of covered) trackedByNiche.set(n, (trackedByNiche.get(n) ?? 0) + 1);
    }
    const suggestedByNiche = new Map<string, number>();
    for (const s of suggestions) for (const n of s.niches) suggestedByNiche.set(n, (suggestedByNiche.get(n) ?? 0) + 1);

    const facts = this.facts({ products, competitors, analysis, trackedByNiche, suggestedByNiche, suggestions });
    const swot = buildSwot(facts);

    await this.prisma.$transaction(async (tx) => {
      // Reopen ADDED suggestions whose competitor no longer exists.
      await tx.competitorDiscovery.updateMany({
        where: { storeId, status: 'ADDED', domain: { notIn: [...trackedDomains] } },
        data: { status: 'SUGGESTED', competitorId: null },
      });

      for (const s of suggestions) {
        const fields = {
          name: s.name,
          kind: s.kind,
          niches: s.niches,
          score: s.score,
          reasons: s.reasons as unknown as Prisma.InputJsonValue,
        };
        await tx.competitorDiscovery.upsert({
          where: { storeId_domain: { storeId, domain: s.domain } },
          create: { tenantId, storeId, catalogKey: s.catalogKey, domain: s.domain, countryCode: COUNTRY_CODE, currency: CURRENCY, ...fields },
          update: { ...fields, status: 'SUGGESTED' },
        });
      }
      // Suggestions that no longer apply (niche gone, now tracked) are removed; decided ones stay.
      await tx.competitorDiscovery.deleteMany({
        where: { storeId, status: 'SUGGESTED', domain: { notIn: suggestions.map((s) => s.domain) } },
      });

      for (const n of analysis.niches) {
        const fields = {
          label: nicheLabel.get(n.key) ?? n.key,
          productCount: n.productCount,
          sharePct: n.sharePct,
          trackedCompetitors: trackedByNiche.get(n.key) ?? 0,
          suggestedCompetitors: suggestedByNiche.get(n.key) ?? 0,
        };
        await tx.nicheInsight.upsert({
          where: { storeId_niche: { storeId, niche: n.key } },
          create: { tenantId, storeId, niche: n.key, ...fields },
          update: fields,
        });
      }
      await tx.nicheInsight.deleteMany({ where: { storeId, niche: { notIn: analysis.niches.map((n) => n.key) } } });

      await tx.swotReport.create({
        data: {
          tenantId,
          storeId,
          strengths: swot.strengths as unknown as Prisma.InputJsonValue,
          weaknesses: swot.weaknesses as unknown as Prisma.InputJsonValue,
          opportunities: swot.opportunities as unknown as Prisma.InputJsonValue,
          threats: swot.threats as unknown as Prisma.InputJsonValue,
          basis: facts as unknown as Prisma.InputJsonValue,
        },
      });
      const old = await tx.swotReport.findMany({
        where: { storeId },
        orderBy: { generatedAt: 'desc' },
        skip: KEEP_SWOT_REPORTS,
        select: { id: true },
      });
      if (old.length > 0) await tx.swotReport.deleteMany({ where: { id: { in: old.map((r) => r.id) } } });
    });

    return this.overview(storeId);
  }

  /**
   * One-click add. Goes through the same CompetitorsService.create as the manual form, so the
   * URL/SSRF guard applies equally. The suggestion is claimed first (SUGGESTED -> ADDED in one
   * UPDATE) so a double click cannot create two competitors, and the claim is released on failure.
   */
  async add(ctx: { tenantId: string; storeId: string }, id: string): Promise<AddedDiscovery> {
    const { storeId } = ctx;
    await this.claim(storeId, id, 'ADDED');
    const d = await this.prisma.competitorDiscovery.findFirstOrThrow({ where: { id, storeId } });

    try {
      // The catalogue may have changed since this row was stored: re-check before creating.
      if (ksaRejection({ domain: d.domain }) !== null) {
        throw new BadRequestException('This competitor is no longer eligible');
      }
      // Already tracked (added by hand after this suggestion was made): link to that row. The
      // unique index cannot catch this for competitors without a page URL (NULLs are distinct in
      // Postgres), so it is checked here rather than left to a conflict error.
      const tracked = await this.prisma.competitor.findFirst({
        where: { storeId, domain: d.domain },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      const competitor: CompetitorDto = tracked
        ? await this.competitors.update(storeId, tracked.id, {})
        : await this.competitors.create(ctx, { name: d.name, domain: d.domain });
      const updated = await this.prisma.competitorDiscovery.update({
        where: { id },
        data: { competitorId: competitor.id },
      });
      return { discovery: toDiscoveryDto(updated), competitor };
    } catch (err) {
      await this.prisma.competitorDiscovery.updateMany({
        where: { id, storeId, status: 'ADDED', competitorId: null },
        data: { status: 'SUGGESTED' },
      });
      throw err;
    }
  }

  async dismiss(storeId: string, id: string): Promise<DiscoveryDto> {
    await this.claim(storeId, id, 'DISMISSED');
    return toDiscoveryDto(await this.prisma.competitorDiscovery.findFirstOrThrow({ where: { id, storeId } }));
  }

  /** SUGGESTED -> target, atomically. 404 for another store's id, 409 when already decided. */
  private async claim(storeId: string, id: string, status: 'ADDED' | 'DISMISSED'): Promise<void> {
    const res = await this.prisma.competitorDiscovery.updateMany({
      where: { id, storeId, status: 'SUGGESTED' },
      data: { status },
    });
    if (res.count > 0) return;
    const exists = await this.prisma.competitorDiscovery.findFirst({ where: { id, storeId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Suggestion not found');
    throw new ConflictException('Suggestion was already handled');
  }

  private facts(input: {
    products: Array<{ id: string; price: Prisma.Decimal; salePrice: Prisma.Decimal | null; costPrice: Prisma.Decimal | null }>;
    competitors: Array<{ isActive: boolean; lastPrice: Prisma.Decimal | null; lastScrapeError: string | null; productId: string | null }>;
    analysis: ReturnType<typeof analyzeNiches>;
    trackedByNiche: Map<string, number>;
    suggestedByNiche: Map<string, number>;
    suggestions: Array<{ kind: CompetitorKind; domain: string }>;
  }): SwotFacts {
    const { products, competitors, analysis, trackedByNiche, suggestedByNiche, suggestions } = input;
    const active = competitors.filter((c) => c.isActive);

    const lowest = new Map<string, number>();
    for (const c of active) {
      if (!c.productId || c.lastPrice === null) continue;
      const price = c.lastPrice.toNumber();
      const prev = lowest.get(c.productId);
      if (prev === undefined || price < prev) lowest.set(c.productId, price);
    }
    let compared = 0;
    let undercut = 0;
    let cheapest = 0;
    for (const p of products) {
      const theirs = lowest.get(p.id);
      if (theirs === undefined) continue;
      const ours = (p.salePrice ?? p.price).toNumber();
      compared += 1;
      if (theirs < ours) undercut += 1;
      else cheapest += 1;
    }

    return {
      activeProducts: products.length,
      productsWithCost: products.filter((p) => p.costPrice !== null && p.costPrice.gt(0)).length,
      trackedCompetitors: active.length,
      failingCompetitors: active.filter((c) => c.lastScrapeError !== null).length,
      comparedProducts: compared,
      undercutProducts: undercut,
      cheapestProducts: cheapest,
      topNiche: analysis.niches[0] ? { key: analysis.niches[0].key, sharePct: analysis.niches[0].sharePct } : null,
      uncoveredNiches: analysis.niches
        .filter((n) => (trackedByNiche.get(n.key) ?? 0) === 0)
        .slice(0, 3)
        .map((n) => ({ key: n.key, products: n.productCount, suggestions: suggestedByNiche.get(n.key) ?? 0 })),
      suggestionCount: suggestions.length,
      overlappingMarketplaces: suggestions.filter((s) => s.kind === 'MARKETPLACE').map((s) => s.domain),
    };
  }
}

function toDiscoveryDto(d: {
  id: string;
  catalogKey: string;
  name: string;
  domain: string;
  kind: string;
  countryCode: string;
  currency: string;
  niches: string[];
  score: number;
  reasons: Prisma.JsonValue;
  status: 'SUGGESTED' | 'ADDED' | 'DISMISSED';
  competitorId: string | null;
}): DiscoveryDto {
  return {
    id: d.id,
    catalogKey: d.catalogKey,
    name: d.name,
    domain: d.domain,
    kind: d.kind as CompetitorKind,
    countryCode: d.countryCode,
    currency: d.currency,
    niches: d.niches,
    score: d.score,
    reasons: d.reasons as unknown as DiscoveryReason[],
    status: d.status,
    competitorId: d.competitorId,
  };
}
