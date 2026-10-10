import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { addDays, localToday } from '../sync/sales-aggregation';

export interface AnalyticsSummaryResponse {
  generatedAt: string;
  currency: string;
  /** null until at least one daily snapshot exists in the window. */
  salesVelocity: SalesVelocity | null;
  priceTrends: PriceTrends;
  pricingConfidence: {
    /** 0–100, mean of data-confidence audits over the window; null if none. */
    score: number | null;
    windowDays: number;
    auditsCount: number;
    failedCount: number;
  };
  competitors: {
    active: number;
    /** Active competitors whose last known price is below our current price. */
    undercutting: number;
    checkedLast24h: number;
  };
  products: { monitored: number; total: number };
  recommendations: {
    pending: number;
    items: Array<{
      id: string;
      type: string;
      title: string;
      rationale: string;
      /** 0–100 from the linked confidence audit, if any. */
      confidence: number | null;
      createdAt: string;
    }>;
  };
}

export interface SalesVelocity {
  windowDays: number;
  /** Days in the window that actually have a snapshot (the denominators below). */
  daysCovered: number;
  unitsPerDay: number;
  ordersPerDay: number;
  /** Net of refunds. */
  revenuePerDay: number;
  currency: string;
  /** Immediately preceding window; null when it has no data. */
  previous: { daysCovered: number; unitsPerDay: number; revenuePerDay: number } | null;
  /** % change vs the previous window; null when it is too thin (< 7 days) or zero. */
  unitsChangePct: number | null;
  revenueChangePct: number | null;
  /** YYYY-MM-DD of the newest snapshot for the store. */
  lastSnapshotDate: string | null;
}

export interface PriceTrends {
  windowDays: number;
  /** Observed competitor price changes in the window. */
  changes: number;
  increases: number;
  decreases: number;
  /** Mean signed % change per observed change; null when there were none. */
  avgChangePct: number | null;
  recent: Array<{
    competitorId: string;
    competitorName: string;
    productName: string | null;
    previousPrice: number;
    price: number;
    changePct: number;
    observedAt: string;
  }>;
}

const CONFIDENCE_WINDOW_DAYS = 30;
const VELOCITY_WINDOW_DAYS = 30;
const TREND_WINDOW_DAYS = 30;
/** A previous window with fewer covered days is too thin to compare against. */
const MIN_COMPARISON_DAYS = 7;

const ymdToDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /** @param storeId the authenticated merchant's store (from the session, never the request) */
  async getSummary(storeId: string): Promise<AnalyticsSummaryResponse> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { currency: true },
    });
    if (!store) throw new NotFoundException('Store not found');

    const since = new Date(Date.now() - CONFIDENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [
      confidenceAgg,
      failedCount,
      activeCompetitors,
      checkedLast24h,
      undercutRows,
      totalProducts,
      monitoredProducts,
      pending,
      recs,
      salesVelocity,
      priceTrends,
    ] = await Promise.all([
      this.prisma.dataConfidenceAudit.aggregate({
        where: { storeId, createdAt: { gte: since } },
        _avg: { confidenceScore: true },
        _count: true,
      }),
      this.prisma.dataConfidenceAudit.count({
        where: { storeId, createdAt: { gte: since }, status: 'FAILED' },
      }),
      this.prisma.competitor.count({ where: { storeId, isActive: true } }),
      this.prisma.competitor.count({
        where: { storeId, isActive: true, lastCheckedAt: { gte: dayAgo } },
      }),
      this.prisma.$queryRaw<Array<{ n: number }>>`
        SELECT COUNT(*)::int AS n
        FROM competitors c
        JOIN products p ON p.id = c.product_id
        WHERE c.store_id = ${storeId}::uuid
          AND c.is_active
          AND c.last_price IS NOT NULL
          AND c.last_price < COALESCE(p.sale_price, p.price)`,
      this.prisma.product.count({ where: { storeId, status: { not: 'DELETED' } } }),
      this.prisma.product.count({
        where: { storeId, competitors: { some: { isActive: true } } },
      }),
      this.prisma.decisionRecommendation.count({ where: { storeId, status: 'PENDING' } }),
      this.prisma.decisionRecommendation.findMany({
        where: { storeId, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          type: true,
          title: true,
          rationale: true,
          createdAt: true,
          confidenceAudit: { select: { confidenceScore: true } },
        },
      }),
      this.computeSalesVelocity(storeId, store.currency),
      this.computePriceTrends(storeId),
    ]);

    const avg = confidenceAgg._avg.confidenceScore;

    return {
      generatedAt: new Date().toISOString(),
      currency: store.currency,
      salesVelocity,
      priceTrends,
      pricingConfidence: {
        score: avg ? Math.round(avg.toNumber() * 100) : null,
        windowDays: CONFIDENCE_WINDOW_DAYS,
        auditsCount: confidenceAgg._count,
        failedCount,
      },
      competitors: {
        active: activeCompetitors,
        undercutting: undercutRows[0]?.n ?? 0,
        checkedLast24h,
      },
      products: { monitored: monitoredProducts, total: totalProducts },
      recommendations: {
        pending,
        items: recs.map((r) => ({
          id: r.id,
          type: r.type,
          title: r.title,
          rationale: r.rationale,
          confidence: r.confidenceAudit
            ? Math.round(r.confidenceAudit.confidenceScore.toNumber() * 100)
            : null,
          createdAt: r.createdAt.toISOString(),
        })),
      },
    };
  }

  /**
   * Velocity over the last VELOCITY_WINDOW_DAYS complete store-local days (today
   * is excluded because it is still filling up), compared with the window before.
   */
  private async computeSalesVelocity(
    storeId: string,
    currency: string,
  ): Promise<SalesVelocity | null> {
    const curTo = addDays(localToday(), -1);
    const curFrom = addDays(curTo, -(VELOCITY_WINDOW_DAYS - 1));
    const prevTo = addDays(curFrom, -1);
    const prevFrom = addDays(prevTo, -(VELOCITY_WINDOW_DAYS - 1));

    const sum = (from: string, to: string) =>
      this.prisma.salesSnapshot.aggregate({
        where: { storeId, date: { gte: ymdToDate(from), lte: ymdToDate(to) } },
        _sum: { ordersCount: true, unitsSold: true, grossRevenue: true, refundedRevenue: true },
        _count: true,
      });

    const [cur, prev, latest] = await Promise.all([
      sum(curFrom, curTo),
      sum(prevFrom, prevTo),
      this.prisma.salesSnapshot.aggregate({ where: { storeId }, _max: { date: true } }),
    ]);
    if (cur._count === 0) return null;

    const perDay = (agg: typeof cur) => {
      const days = agg._count;
      const net =
        (agg._sum.grossRevenue?.toNumber() ?? 0) - (agg._sum.refundedRevenue?.toNumber() ?? 0);
      return {
        orders: (agg._sum.ordersCount ?? 0) / days,
        units: (agg._sum.unitsSold ?? 0) / days,
        revenue: net / days,
      };
    };

    const c = perDay(cur);
    const p = prev._count > 0 ? perDay(prev) : null;
    const comparable = p !== null && prev._count >= MIN_COMPARISON_DAYS;
    const change = (now: number, before: number | undefined) =>
      comparable && before !== undefined && before > 0
        ? round1(((now - before) / before) * 100)
        : null;

    return {
      windowDays: VELOCITY_WINDOW_DAYS,
      daysCovered: cur._count,
      unitsPerDay: round2(c.units),
      ordersPerDay: round2(c.orders),
      revenuePerDay: round2(c.revenue),
      currency,
      previous: p
        ? {
            daysCovered: prev._count,
            unitsPerDay: round2(p.units),
            revenuePerDay: round2(p.revenue),
          }
        : null,
      unitsChangePct: change(c.units, p?.units),
      revenueChangePct: change(c.revenue, p?.revenue),
      lastSnapshotDate: latest._max.date?.toISOString().slice(0, 10) ?? null,
    };
  }

  /** Competitor price movement from history rows that carry a known previous price. */
  private async computePriceTrends(storeId: string): Promise<PriceTrends> {
    const since = new Date(Date.now() - TREND_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const [agg, recent] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{ changes: number; increases: number; decreases: number; avg: number | null }>
      >`
        SELECT COUNT(*)::int AS changes,
               (COUNT(*) FILTER (WHERE h.price > h.previous_price))::int AS increases,
               (COUNT(*) FILTER (WHERE h.price < h.previous_price))::int AS decreases,
               AVG((h.price - h.previous_price) / h.previous_price * 100)::float8 AS avg
        FROM competitor_price_history h
        WHERE h.store_id = ${storeId}::uuid
          AND h.observed_at >= ${since}
          AND h.previous_price IS NOT NULL
          AND h.previous_price > 0
          AND h.price <> h.previous_price`,
      this.prisma.$queryRaw<
        Array<{
          competitorId: string;
          competitorName: string;
          productName: string | null;
          previousPrice: number;
          price: number;
          changePct: number;
          observedAt: Date;
        }>
      >`
        SELECT h.competitor_id AS "competitorId",
               c.name AS "competitorName",
               p.name AS "productName",
               h.previous_price::float8 AS "previousPrice",
               h.price::float8 AS "price",
               ((h.price - h.previous_price) / h.previous_price * 100)::float8 AS "changePct",
               h.observed_at AS "observedAt"
        FROM competitor_price_history h
        JOIN competitors c ON c.id = h.competitor_id
        LEFT JOIN products p ON p.id = c.product_id
        WHERE h.store_id = ${storeId}::uuid
          AND h.observed_at >= ${since}
          AND h.previous_price IS NOT NULL
          AND h.previous_price > 0
          AND h.price <> h.previous_price
        ORDER BY h.observed_at DESC
        LIMIT 5`,
    ]);

    const a = agg[0];
    return {
      windowDays: TREND_WINDOW_DAYS,
      changes: a?.changes ?? 0,
      increases: a?.increases ?? 0,
      decreases: a?.decreases ?? 0,
      avgChangePct: a?.avg == null ? null : round1(a.avg),
      recent: recent.map((r) => ({
        competitorId: r.competitorId,
        competitorName: r.competitorName,
        productName: r.productName,
        previousPrice: r.previousPrice,
        price: r.price,
        changePct: round1(r.changePct),
        observedAt: r.observedAt.toISOString(),
      })),
    };
  }
}
