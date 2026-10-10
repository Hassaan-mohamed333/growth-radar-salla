/**
 * Pricing policy for competitor-driven recommendations. Pure functions only: no
 * database, no clock (callers pass `now`), so every rule is unit-testable.
 *
 * Policy (agreed with the product owner):
 *  - Always alert when a fresh competitor price is below what the customer pays.
 *  - Suggest a price ONLY when the product's cost is known, and never below
 *    cost + the minimum margin. Without cost there is no safe floor, so alert only.
 *  - Suggestions are advisory: nothing is ever applied to Salla automatically.
 */

export type RecommendationKind =
  /** Suggested price matches the cheapest competitor. */
  | 'match_competitor'
  /** Matching would breach the margin floor, so the suggestion stops at the floor. */
  | 'margin_floor'
  /** Cost known, but even the floor is not below the current price. */
  | 'alert_margin_blocked'
  /** Cost unknown: no safe price can be suggested. */
  | 'alert_no_cost';

export interface RuleProduct {
  id: string;
  name: string;
  price: number;
  salePrice: number | null;
  costPrice: number | null;
  currency: string;
}

export interface RuleCompetitor {
  id: string;
  name: string;
  lastPrice: number;
  currency: string;
  lastCheckedAt: Date | null;
  scrapeFailures: number;
}

export interface RuleOptions {
  now: Date;
  /** Smaller gaps are noise, not alerts. */
  minGapPct: number;
  /** Margin over cost a suggestion must keep, e.g. 10 = cost * 1.10. */
  minMarginPct: number;
  /** Competitor prices older than this are ignored. */
  maxPriceAgeMs: number;
}

export interface ConfidenceCheck {
  name: string;
  score: number;
  detail: string;
}

export type ConfidenceStatus = 'PASSED' | 'WARNING' | 'FAILED';

export interface RecommendationPayload {
  kind: RecommendationKind;
  currency: string;
  /** What the customer pays now (sale price when one is active). */
  currentPrice: number;
  lowestPrice: number;
  competitorId: string;
  competitorName: string;
  competitorsCompared: number;
  /** How far below us the cheapest competitor is, in %. */
  gapPct: number;
  costPrice: number | null;
  suggestedPrice: number | null;
  /** Change from current to suggested, in % (negative = cheaper). */
  priceChangePct: number | null;
  suggestedMarginPct: number | null;
  /** Lowest price allowed by the margin policy (null without cost). */
  marginFloorPrice: number | null;
  /** Identity of the situation; a dismissed/accepted rec with the same one is not re-raised. */
  signature: string;
}

export interface Decision {
  type: 'PRICE_ADJUSTMENT' | 'COMPETITOR_ALERT';
  title: string;
  rationale: string;
  payload: RecommendationPayload;
  confidence: { score: number; status: ConfidenceStatus; checks: ConfidenceCheck[] };
}

const HOUR_MS = 60 * 60 * 1000;

const round2 = (n: number) => Math.round(n * 100) / 100;
/** Round UP to the cent so a floor is never undershot by rounding. */
const ceil2 = (n: number) => Math.ceil(Math.round(n * 1e6) / 1e4) / 100;
const pct1 = (n: number) => Math.round(n * 10) / 10;

export function evaluateProduct(
  product: RuleProduct,
  competitors: readonly RuleCompetitor[],
  opts: RuleOptions,
): Decision | null {
  const current = product.salePrice ?? product.price;
  if (!(current > 0)) return null;

  // Only like-for-like, fresh, positive prices are comparable.
  const comparable = competitors.filter(
    (c) =>
      c.lastPrice > 0 &&
      c.currency === product.currency &&
      c.lastCheckedAt !== null &&
      opts.now.getTime() - c.lastCheckedAt.getTime() <= opts.maxPriceAgeMs,
  );
  if (comparable.length === 0) return null;

  const lowest = comparable.reduce((min, c) => (c.lastPrice < min.lastPrice ? c : min));
  if (lowest.lastPrice >= current) return null;

  const gapPct = ((current - lowest.lastPrice) / current) * 100;
  if (gapPct < opts.minGapPct) return null;

  const confidence = assessConfidence(lowest, comparable.length, product.costPrice, opts.now);
  if (confidence.status === 'FAILED') return null;

  const cost = product.costPrice !== null && product.costPrice > 0 ? product.costPrice : null;
  const floor = cost === null ? null : ceil2(cost * (1 + opts.minMarginPct / 100));

  let kind: RecommendationKind;
  let suggested: number | null = null;
  if (floor === null) {
    kind = 'alert_no_cost';
  } else {
    const target = Math.max(lowest.lastPrice, floor);
    if (target < current) {
      suggested = round2(target);
      kind = target <= lowest.lastPrice ? 'match_competitor' : 'margin_floor';
    } else {
      kind = 'alert_margin_blocked';
    }
  }

  const payload: RecommendationPayload = {
    kind,
    currency: product.currency,
    currentPrice: round2(current),
    lowestPrice: round2(lowest.lastPrice),
    competitorId: lowest.id,
    competitorName: lowest.name,
    competitorsCompared: comparable.length,
    gapPct: pct1(gapPct),
    costPrice: cost,
    suggestedPrice: suggested,
    priceChangePct: suggested === null ? null : pct1(((suggested - current) / current) * 100),
    suggestedMarginPct:
      suggested === null || cost === null ? null : pct1(((suggested - cost) / suggested) * 100),
    marginFloorPrice: floor,
    signature: [kind, round2(current), round2(lowest.lastPrice), suggested ?? '-'].join(':'),
  };

  return { ...describe(product, payload), payload, confidence };
}

function describe(
  product: RuleProduct,
  p: RecommendationPayload,
): Pick<Decision, 'type' | 'title' | 'rationale'> {
  const cur = `${p.currentPrice.toFixed(2)} ${p.currency}`;
  const low = `${p.lowestPrice.toFixed(2)} ${p.currency}`;
  const gap = `${p.gapPct}%`;
  const who = p.competitorName;
  const base = `سعر «${who}» هو ${low} مقابل ${cur} لدى متجرك (أقل بنسبة ${gap}).`;

  switch (p.kind) {
    case 'match_competitor':
      return {
        type: 'PRICE_ADJUSTMENT',
        title: `خفض سعر «${product.name}» إلى ${p.suggestedPrice!.toFixed(2)} ${p.currency}`,
        rationale: `${base} مطابقة هذا السعر تُبقي هامشك عند ${p.suggestedMarginPct}%، أي فوق الحد الأدنى.`,
      };
    case 'margin_floor':
      return {
        type: 'PRICE_ADJUSTMENT',
        title: `خفض سعر «${product.name}» إلى ${p.suggestedPrice!.toFixed(2)} ${p.currency}`,
        rationale: `${base} مطابقته تقلّص الهامش دون الحد الأدنى، لذا يقف الاقتراح عند أدنى سعر آمن (${p.suggestedPrice!.toFixed(2)} ${p.currency}، هامش ${p.suggestedMarginPct}%).`,
      };
    case 'alert_margin_blocked':
      return {
        type: 'COMPETITOR_ALERT',
        title: `«${who}» أرخص منك على «${product.name}»`,
        rationale: `${base} لا يمكن خفض السعر دون المساس بالحد الأدنى للهامش (أدنى سعر آمن ${p.marginFloorPrice!.toFixed(2)} ${p.currency})، فالقرار بيدك.`,
      };
    case 'alert_no_cost':
      return {
        type: 'COMPETITOR_ALERT',
        title: `«${who}» أرخص منك على «${product.name}»`,
        rationale: `${base} أضف سعر التكلفة للمنتج في سلة لنقترح لك سعرًا آمنًا يحفظ هامشك.`,
      };
  }
}

/** How much to trust the comparison: freshness, breadth, reliability, and cost knowledge. */
export function assessConfidence(
  lowest: RuleCompetitor,
  comparedCount: number,
  costPrice: number | null,
  now: Date,
): { score: number; status: ConfidenceStatus; checks: ConfidenceCheck[] } {
  const ageH = lowest.lastCheckedAt
    ? Math.max(0, (now.getTime() - lowest.lastCheckedAt.getTime()) / HOUR_MS)
    : Infinity;

  const checks: ConfidenceCheck[] = [
    {
      name: 'price_freshness',
      score: ageH <= 24 ? 1 : ageH <= 72 ? 0.8 : 0.5,
      detail: Number.isFinite(ageH) ? `observed ${Math.round(ageH)}h ago` : 'never observed',
    },
    {
      name: 'competitor_coverage',
      score: comparedCount >= 2 ? 1 : 0.7,
      detail: `${comparedCount} comparable competitor price(s)`,
    },
    {
      name: 'source_reliability',
      score: lowest.scrapeFailures === 0 ? 1 : lowest.scrapeFailures === 1 ? 0.7 : 0.4,
      detail: `${lowest.scrapeFailures} consecutive failed scrape(s)`,
    },
    {
      name: 'cost_known',
      score: costPrice !== null && costPrice > 0 ? 1 : 0.6,
      detail: costPrice !== null && costPrice > 0 ? 'cost price available' : 'cost price missing',
    },
  ];

  const score = Math.round((checks.reduce((s, c) => s + c.score, 0) / checks.length) * 1000) / 1000;
  const status: ConfidenceStatus = score >= 0.75 ? 'PASSED' : score >= 0.5 ? 'WARNING' : 'FAILED';
  return { score, status, checks };
}
