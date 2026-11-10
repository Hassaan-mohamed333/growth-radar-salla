import type { OnboardingHeadline } from './api';
import { nf } from './format';

/**
 * The first-value sentence shown right after setup. Counts are written as "label: number" so
 * Arabic number agreement never has to be right.
 */
export function headlineText(h: OnboardingHeadline): { title: string; detail: string } {
  const detail = `منتجات قورنت: ${nf.format(h.comparedProducts)} · منافسون: ${nf.format(h.competitorsCompared)}`;

  if (h.higherProducts > 0 && h.avgHigherPct !== null) {
    return {
      title: `أسعارك أعلى من أرخص منافس بمتوسط ${nf.format(h.avgHigherPct)}٪ في ${nf.format(h.higherProducts)} من ${nf.format(h.comparedProducts)} منتجات`,
      detail,
    };
  }
  return {
    title: 'أسعارك أقل من أرخص منافس أو مساوية له في كل المنتجات المقارَنة',
    detail,
  };
}

export const onboardingStepLabels = {
  connected: 'ربط المتجر بسلة',
  productsSynced: 'مزامنة المنتجات',
  competitorsAdded: 'إضافة المنافسين',
  pricesCompared: 'مقارنة الأسعار',
} as const;
