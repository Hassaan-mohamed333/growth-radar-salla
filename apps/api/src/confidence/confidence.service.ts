import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { calculateDataConfidence, type ConfidenceResult, type Ga4WindowTotals } from '@radar/shared';
import { TenantDb } from '../infra/tenant-db.service';
import { RecommendationEngine } from './recommendation.engine';

const WINDOW_DAYS = 7;

@Injectable()
export class ConfidenceService {
  private readonly log = new Logger(ConfidenceService.name);
  constructor(private readonly db: TenantDb, private readonly recs: RecommendationEngine) {}

  /**
   * Evaluates tracking health for one store over the trailing window and persists an immutable audit row.
   * Inputs are read only from our own validated tables (orders, analytics_snapshots), all filtered by tenant+store.
   */
  async audit(tenantId: string, storeId: string, now = new Date()) {
    const windowEnd = now;
    const windowStart = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);

    return this.db.withTenant(tenantId, async (tx) => {
      const store = await tx.store.findFirst({ where: { tenantId, id: storeId }, select: { currency: true } });
      if (!store) throw new Error('Store not found for tenant');

      // Salla side: realised revenue only, in the window. Group by currency so a currency mix can't be summed blindly.
      const byCurrency = await tx.order.groupBy({
        by: ['currency'],
        where: { tenantId, storeId, countsAsRevenue: true, placedAt: { gte: windowStart, lt: windowEnd } },
        _sum: { totalAmount: true },
        _count: { _all: true },
      });
      const primary = byCurrency.sort((a, b) => b._count._all - a._count._all)[0];
      const salla = {
        currency: primary?.currency ?? store.currency,
        revenue: Number(primary?._sum.totalAmount ?? 0),
        orderCount: primary?._count._all ?? 0,
      };

      // GA4 side: populated by the GA4 ingestion worker (Google OAuth is a separate connector; see docs).
      const snaps = await tx.analyticsSnapshot.findMany({
        where: { tenantId, storeId, source: 'GA4', day: { gte: windowStart, lt: windowEnd } },
      });
      const ga4: Ga4WindowTotals | null = snaps.length
        ? {
            revenue: snaps.reduce((s, r) => s + Number(r.revenue), 0),
            purchaseEvents: snaps.reduce((s, r) => s + r.purchases, 0),
            currency: snaps[0]!.currency.trim(),
            lastPurchaseEventAt: snaps.map((r) => r.lastPurchaseEventAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
          }
        : null;

      const result: ConfidenceResult = calculateDataConfidence({ salla, ga4, now });

      const audit = await tx.dataConfidenceAudit.create({
        data: {
          tenantId, storeId, windowStart, windowEnd, score: result.score, level: result.level,
          checks: result.checks as unknown as Prisma.InputJsonValue,
          sallaRevenue: salla.revenue, sallaOrderCount: salla.orderCount,
          ga4Revenue: ga4?.revenue ?? null, ga4Purchases: ga4?.purchaseEvents ?? null, currency: salla.currency,
        },
        select: { id: true },
      });
      await this.recs.generate(tx, { tenantId, storeId, auditId: audit.id, result, salla, ga4, windowDays: WINDOW_DAYS });
      this.log.log(`Audit ${audit.id} store=${storeId} score=${result.score} level=${result.level}`);
      return { auditId: audit.id, result };
    });
  }
}
