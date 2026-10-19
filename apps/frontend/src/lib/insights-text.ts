// Arabic wording for the fixed codes the backend emits (apps/backend/src/competitor-insights/).
// The backend sends only codes and numbers, never prose, so everything the merchant reads here is
// written once, in this file. An unknown code (a newer backend) renders as nothing instead of
// leaking the raw identifier.

import type { CompetitorKind, DiscoveryReason, SwotItem } from './api';
import { nf } from './format';

export const kindLabel: Record<CompetitorKind, string> = {
  MARKETPLACE: 'سوق إلكتروني',
  RETAILER: 'متجر تجزئة',
  SPECIALIST: 'متجر متخصص',
};

type Params = SwotItem['params'];
type Labels = ReadonlyMap<string, string>;

const n = (v: Params[string] | undefined): string => nf.format(Number(v ?? 0));
const label = (labels: Labels, key: Params[string] | undefined): string =>
  labels.get(String(key)) ?? 'فئة غير مصنّفة';

// Counts are written as "label: number" on purpose. Arabic number-noun agreement changes with the
// count (one, two, three to ten, eleven and up), so a sentence like "N منافسين" is wrong for most N.
const SWOT_TEXT: Record<string, (p: Params, labels: Labels) => string> = {
  // Strengths
  cost_coverage_high: (p) => `تكلفة معظم منتجاتك معروفة (${n(p.pct)}٪)، فيمكن حماية هامشك عند تعديل السعر.`,
  price_competitive: (p) =>
    `سعرك أقل من أو يساوي أسعار المنافسين في ${n(p.pct)}٪ من المنتجات التي تقارنها (عددها: ${n(p.compared)}).`,
  tracking_healthy: (p) => `منافسون نشطون تتابعهم وفحصهم سليم: ${n(p.tracked)}.`,
  niche_focus: (p, l) => `متجرك مركّز: ${n(p.pct)}٪ من منتجاتك في «${label(l, p.niche)}».`,
  // Weaknesses
  missing_costs: (p) =>
    `منتجات بلا تكلفة معروفة: ${n(p.missing)} (${n(p.pct)}٪). لا يمكن اقتراح سعر آمن لها.`,
  no_competitors_tracked: () => 'لا تتابع أي منافس بعد، فلا مقارنة أسعار ولا توصيات.',
  failing_sources: (p) => `منافسون فشل آخر فحص لهم: ${n(p.count)}. قد تكون بياناتهم قديمة.`,
  thin_comparison: (p) =>
    `المنتجات التي لها سعر منافس معروف: ${n(p.compared)} من ${n(p.products)}. الصورة غير مكتملة.`,
  // Opportunities
  uncovered_niche: (p, l) =>
    `«${label(l, p.niche)}»: منتجاتك فيها ${n(p.products)} ولا تتابع فيها أي منافس${
      Number(p.suggestions) > 0 ? `. اقتراحات متاحة لها: ${n(p.suggestions)}` : ''
    }.`,
  discoveries_available: (p) => `منافسون سعوديون مقترحون يمكن إضافتهم بنقرة واحدة: ${n(p.count)}.`,
  price_headroom: (p) =>
    `منتجات سعرك فيها أقل من كل المنافسين: ${n(p.count)}. قد يتسع المجال لتجربة سعر أعلى (تحقق من هامشك أولًا).`,
  // Threats
  undercut: (p) => `منتجات فيها منافس أرخص منك: ${n(p.count)} (${n(p.pct)}٪ مما تقارنه).`,
  marketplace_overlap: (p) =>
    `أسواق كبرى تبيع في فئاتك: ${(Array.isArray(p.domains) ? p.domains : []).join('، ')}.`,
  niche_concentration: (p, l) =>
    `اعتماد كبير على فئة واحدة: ${n(p.pct)}٪ من منتجاتك في «${label(l, p.niche)}».`,
};

/** Text for a SWOT item, or null for a code this version does not know. */
export function swotText(item: SwotItem, labels: Labels): string | null {
  return SWOT_TEXT[item.code]?.(item.params, labels) ?? null;
}

export function reasonText(r: DiscoveryReason, labels: Labels): string {
  return r.code === 'niche_overlap'
    ? `${nf.format(r.products)} من منتجاتك في «${label(labels, r.niche)}»`
    : 'سوق يغطي فئات متعددة';
}
