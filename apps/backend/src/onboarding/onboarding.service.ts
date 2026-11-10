import { ConflictException, HttpException, Injectable } from '@nestjs/common';
import { CompetitorInsightsService, type DiscoveryDto } from '../competitor-insights/competitor-insights.service';
import { PrismaService } from '../prisma/prisma.service';
import { computeHeadline, type Headline } from './headline';

/** What the merchant should do next to reach the first comparison. */
export type OnboardingNext = 'sync' | 'find_competitors' | 'compare' | 'done';

export interface OnboardingResponse {
  next: OnboardingNext;
  steps: {
    connected: boolean;
    productsSynced: boolean;
    competitorsAdded: boolean;
    pricesCompared: boolean;
  };
  counts: { products: number; competitors: number };
  /** Null until at least one product has a competitor price. */
  headline: Headline | null;
  /** Products worth searching competitors for first (no competitor listing yet), highest price first. */
  searchTargets: Array<{ id: string; name: string }>;
}

const MAX_COMPARED_ROWS = 500;
const MAX_TARGETS = 5;
/** Competitors added automatically on the merchant's first start. */
export const MAX_AUTO_COMPETITORS = 3;

export interface StartResponse extends OnboardingResponse {
  /** Competitors added by this call. */
  discovered: number;
}

/**
 * Which suggestions to add for the merchant: best overlap first, but marketplaces last. Their
 * pages mostly refuse automated requests, so a specialist or retailer gives a real comparison
 * where a marketplace would only give "unreachable".
 */
export function pickCompetitors(suggestions: DiscoveryDto[], max = MAX_AUTO_COMPETITORS): DiscoveryDto[] {
  return suggestions
    .filter((s) => s.status === 'SUGGESTED')
    .sort((a, b) => {
      const marketplace = Number(a.kind === 'MARKETPLACE') - Number(b.kind === 'MARKETPLACE');
      return marketplace !== 0 ? marketplace : b.score - a.score || a.domain.localeCompare(b.domain);
    })
    .slice(0, max);
}

@Injectable()
export class OnboardingService {
  /** Stores with a start already running; a second click gets a 409 instead of a second batch. */
  private readonly starting = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly insights: CompetitorInsightsService,
  ) {}

  /**
   * The merchant pressed "start": when no competitor is tracked yet, discover likely ones from the
   * catalogue and add the best few, exactly as the one-click add on the insights page would. The
   * merchant can delete any of them. Idempotent: with competitors already tracked it adds nothing.
   */
  async start(ctx: { tenantId: string; storeId: string }): Promise<StartResponse> {
    if (this.starting.has(ctx.storeId)) {
      throw new ConflictException({ message: 'A start is already running', code: 'start_in_progress' });
    }
    this.starting.add(ctx.storeId);
    try {
      const before = await this.get(ctx.storeId);
      let discovered = 0;

      if (before.counts.products > 0 && before.counts.competitors === 0) {
        const overview = await this.insights.refresh(ctx);
        for (const s of pickCompetitors(overview.suggestions)) {
          try {
            await this.insights.add(ctx, s.id);
            discovered += 1;
          } catch (err) {
            if (!(err instanceof HttpException)) throw err; // not eligible / already handled: skip it
          }
        }
      }
      return { ...(await this.get(ctx.storeId)), discovered };
    } finally {
      this.starting.delete(ctx.storeId);
    }
  }

  async get(storeId: string): Promise<OnboardingResponse> {
    const live = { storeId, status: { not: 'DELETED' as const } };
    const priced = { isActive: true, lastPrice: { not: null } };

    const [products, competitors, rows, targets] = await Promise.all([
      this.prisma.product.count({ where: live }),
      this.prisma.competitor.count({ where: { storeId, isActive: true } }),
      this.prisma.product.findMany({
        where: { ...live, competitors: { some: priced } },
        take: MAX_COMPARED_ROWS,
        select: {
          price: true,
          salePrice: true,
          competitors: { where: priced, select: { id: true, lastPrice: true } },
        },
      }),
      this.prisma.product.findMany({
        where: { ...live, competitors: { none: { productUrl: { not: null } } } },
        orderBy: [{ price: 'desc' }, { id: 'asc' }],
        take: MAX_TARGETS,
        select: { id: true, name: true },
      }),
    ]);

    const headline = computeHeadline(
      rows.map((p) => ({
        ours: (p.salePrice ?? p.price).toNumber(),
        competitors: p.competitors.map((c) => ({ id: c.id, price: c.lastPrice!.toNumber() })),
      })),
    );

    const next: OnboardingNext =
      products === 0 ? 'sync' : headline ? 'done' : competitors === 0 ? 'find_competitors' : 'compare';

    return {
      next,
      steps: {
        connected: true, // reaching this route needs a session, which exists only after OAuth
        productsSynced: products > 0,
        competitorsAdded: competitors > 0,
        pricesCompared: headline !== null,
      },
      counts: { products, competitors },
      headline,
      searchTargets: targets,
    };
  }
}
