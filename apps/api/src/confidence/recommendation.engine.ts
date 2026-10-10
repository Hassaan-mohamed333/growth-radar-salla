import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ConfidenceResult, Ga4WindowTotals, SallaWindowTotals } from '@radar/shared';
import type { Tx } from '../infra/prisma.service';

interface Candidate {
  code: string;
  category: 'TRACKING';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  titleAr: string; titleEn: string; summaryAr: string; summaryEn: string;
  confidence: number;
  revenueAtRisk: number;
}

/** Turns failed tracking checks into actionable, evidence-linked recommendations (MVP: tracking category only). */
@Injectable()
export class RecommendationEngine {
  async generate(
    tx: Tx,
    a: { tenantId: string; storeId: string; auditId: string; result: ConfidenceResult; salla: SallaWindowTotals; ga4: Ga4WindowTotals | null; windowDays: number },
  ) {
    const { tenantId, storeId, auditId, result, salla, ga4, windowDays } = a;
    const to30d = 30 / windowDays;
    const status = (id: string) => result.checks.find((c) => c.id === id)?.status;
    const found: Candidate[] = [];
    // How sure we are the finding is real grows with the evidence we had (orders observed in the window).
    const evidence = Math.min(1, salla.orderCount / 30);

    if (!ga4) {
      found.push({
        code: 'TRACKING_GA4_NOT_CONNECTED', category: 'TRACKING', severity: 'HIGH',
        titleAr: 'اربط Google Analytics 4 للتحقق من أرقامك', titleEn: 'Connect Google Analytics 4 to verify your numbers',
        summaryAr: 'لا توجد بيانات GA4 لهذا المتجر، لذلك لا يمكن التحقق من دقة الإيرادات والمشتريات.',
        summaryEn: 'No GA4 data exists for this store, so revenue and purchases cannot be verified.',
        confidence: 0.95, revenueAtRisk: 0,
      });
    } else {
      if (status('purchase_event_exists') === 'fail') {
        found.push({
          code: 'TRACKING_NO_PURCHASE_EVENT', category: 'TRACKING', severity: 'CRITICAL',
          titleAr: 'حدث الشراء غير مسجَّل في GA4', titleEn: 'GA4 is not recording purchase events',
          summaryAr: 'سلة تسجّل طلبات مدفوعة لكن GA4 لم يستلم أي حدث purchase. قرارات الإعلانات تُبنى على بيانات ناقصة.',
          summaryEn: 'Salla shows paid orders but GA4 received no purchase events. Ad decisions are being made on missing data.',
          confidence: round3(0.5 + 0.5 * evidence), revenueAtRisk: salla.revenue * to30d,
        });
      }
      const rev = result.checks.find((c) => c.id === 'revenue_match');
      if (rev && (rev.status === 'fail' || rev.status === 'warn')) {
        const over = rev.details['direction'] === 'ga4_over';
        found.push({
          code: 'TRACKING_REVENUE_MISMATCH', category: 'TRACKING', severity: rev.status === 'fail' ? 'HIGH' : 'MEDIUM',
          titleAr: over ? 'GA4 يضخّم الإيرادات (احتمال تكرار الوسم)' : 'GA4 يفوّت جزءاً من الإيرادات',
          titleEn: over ? 'GA4 over-reports revenue (possible duplicate tag)' : 'GA4 is missing part of your revenue',
          summaryAr: `الفرق بين إيراد سلة وGA4 ${String(rev.details['deviationPct'] ?? '?')}% خلال ${windowDays} أيام.`,
          summaryEn: `Salla and GA4 revenue differ by ${String(rev.details['deviationPct'] ?? '?')}% over ${windowDays} days.`,
          confidence: round3(0.5 + 0.5 * evidence),
          revenueAtRisk: Math.abs(salla.revenue - ga4.revenue) * to30d,
        });
      }
    }

    const codes = found.map((f) => f.code);
    // Findings that no longer hold are expired, never silently deleted (decisions stay auditable).
    await tx.decisionRecommendation.updateMany({
      where: { tenantId, storeId, status: 'OPEN', category: 'TRACKING', code: { notIn: codes } },
      data: { status: 'EXPIRED' },
    });
    for (const f of found) {
      const data = {
        severity: f.severity, titleAr: f.titleAr, titleEn: f.titleEn, summaryAr: f.summaryAr, summaryEn: f.summaryEn,
        confidence: f.confidence, estimatedRevenueAtRisk: Math.round(f.revenueAtRisk * 100) / 100,
        currency: salla.currency, evidence: { auditId } as Prisma.InputJsonValue,
      };
      const open = await tx.decisionRecommendation.findFirst({ where: { tenantId, storeId, code: f.code, status: 'OPEN' }, select: { id: true } });
      if (open) {
        await tx.decisionRecommendation.updateMany({ where: { tenantId, id: open.id }, data });
      } else {
        await tx.decisionRecommendation.create({ data: { tenantId, storeId, code: f.code, category: f.category, ...data } });
      }
    }
  }
}
const round3 = (n: number) => Math.round(n * 1000) / 1000;
