import type { OverviewDto } from '@radar/shared';

/** Dev-only fixture (guarded in api.ts; never used in production builds). */
export function demoOverview(lang: 'ar' | 'en'): OverviewDto {
  const t = (ar: string, en: string) => (lang === 'ar' ? ar : en);
  return {
    storeId: '00000000-0000-4000-8000-000000000001',
    currency: 'SAR',
    generatedAt: new Date().toISOString(),
    confidence: {
      score: 62,
      level: 'medium',
      auditedAt: new Date().toISOString(),
      checks: [
        { id: 'ga4_connected', status: 'pass', weight: 15, earned: 1 },
        { id: 'purchase_event_exists', status: 'pass', weight: 25, earned: 1 },
        { id: 'revenue_match', status: 'fail', weight: 30, earned: 0.2 },
        { id: 'order_count_match', status: 'warn', weight: 15, earned: 0.6 },
        { id: 'data_freshness', status: 'pass', weight: 10, earned: 1 },
        { id: 'currency_match', status: 'pass', weight: 5, earned: 1 },
      ],
    },
    revenueAtRisk: { amount: 48200, revenue30d: 312000 },
    marketingHealthScore: 73,
    topDecisions: [
      { id: '10000000-0000-4000-8000-000000000001', title: t('GA4 يضخّم الإيرادات (احتمال تكرار الوسم)', 'GA4 over-reports revenue (possible duplicate tag)'),
        summary: t('الفرق بين إيراد سلة وGA4 31% خلال 7 أيام.', 'Salla and GA4 revenue differ by 31% over 7 days.'),
        category: 'TRACKING', severity: 'HIGH', confidence: 0.86, estimatedRevenueAtRisk: 31200, currency: 'SAR', status: 'OPEN' },
      { id: '10000000-0000-4000-8000-000000000002', title: t('منافس خفّض سعر منتج الأكثر مبيعاً 12%', 'A competitor cut your best-seller price by 12%'),
        summary: t('رصدنا انخفاضاً في سعر المنتج لدى منافس رئيسي خلال 48 ساعة.', 'We observed a price drop at a main competitor within 48 hours.'),
        category: 'COMPETITOR', severity: 'MEDIUM', confidence: 0.71, estimatedRevenueAtRisk: 12400, currency: 'SAR', status: 'OPEN' },
      { id: '10000000-0000-4000-8000-000000000003', title: t('3 منتجات رائجة على وشك النفاد', '3 trending products are about to sell out'),
        summary: t('المخزون يكفي أقل من 5 أيام بمعدل البيع الحالي.', 'Stock covers fewer than 5 days at the current sales rate.'),
        category: 'INVENTORY', severity: 'MEDIUM', confidence: 0.64, estimatedRevenueAtRisk: 4600, currency: 'SAR', status: 'OPEN' },
    ],
  };
}
