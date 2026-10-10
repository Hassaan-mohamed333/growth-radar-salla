import { Injectable } from '@nestjs/common';
import { calculateMarketingHealth, overviewSchema, type OverviewDto } from '@radar/shared';
import { TenantDb } from '../infra/tenant-db.service';

const SEVERITY_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;

@Injectable()
export class DashboardService {
  constructor(private readonly db: TenantDb) {}

  async overview(storeId: string, lang: 'ar' | 'en'): Promise<OverviewDto> {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const { store, audit, revenue, recs } = await this.db.run(async (tx, tenantId) => ({
      store: await tx.store.findFirstOrThrow({ where: { tenantId, id: storeId }, select: { currency: true } }),
      audit: await tx.dataConfidenceAudit.findFirst({ where: { tenantId, storeId }, orderBy: { createdAt: 'desc' } }),
      revenue: await tx.order.aggregate({
        where: { tenantId, storeId, countsAsRevenue: true, placedAt: { gte: since } }, _sum: { totalAmount: true },
      }),
      recs: await tx.decisionRecommendation.findMany({ where: { tenantId, storeId, status: 'OPEN' }, take: 200 }),
    }));

    const revenue30d = Number(revenue._sum.totalAmount ?? 0);
    const atRisk = Math.min(recs.reduce((s, r) => s + Number(r.estimatedRevenueAtRisk), 0), revenue30d || Infinity);
    const score = audit?.score ?? null;
    const top = [...recs]
      .sort((a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        Number(b.estimatedRevenueAtRisk) * Number(b.confidence) - Number(a.estimatedRevenueAtRisk) * Number(a.confidence))
      .slice(0, 3);

    // Output is rebuilt field-by-field and re-validated: nothing from the DB (or upstream) is passed through raw.
    return overviewSchema.parse({
      storeId,
      currency: store.currency.trim(),
      generatedAt: new Date().toISOString(),
      confidence: {
        score,
        level: audit?.level ?? 'insufficient_data',
        checks: ((audit?.checks as { id: string; status: string; weight: number; earned: number }[] | undefined) ?? []).map((c) => ({
          id: c.id, status: c.status, weight: c.weight, earned: c.earned,
        })),
        auditedAt: audit?.createdAt.toISOString() ?? null,
      },
      revenueAtRisk: { amount: Number.isFinite(atRisk) ? atRisk : 0, revenue30d },
      marketingHealthScore: calculateMarketingHealth({ confidenceScore: score, revenueAtRisk: Number.isFinite(atRisk) ? atRisk : 0, revenue30d }),
      topDecisions: top.map((r) => ({
        id: r.id,
        title: lang === 'ar' ? r.titleAr : r.titleEn,
        summary: lang === 'ar' ? r.summaryAr : r.summaryEn,
        category: r.category,
        severity: r.severity,
        confidence: Number(r.confidence),
        estimatedRevenueAtRisk: Number(r.estimatedRevenueAtRisk),
        currency: r.currency.trim(),
        status: r.status,
      })),
    });
  }
}
