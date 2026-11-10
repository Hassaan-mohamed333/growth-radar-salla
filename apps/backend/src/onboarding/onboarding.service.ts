import { Injectable } from '@nestjs/common';
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

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

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
