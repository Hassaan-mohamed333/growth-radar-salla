/**
 * Rule-based SWOT from the store's own measured data. There is no language model and no outside
 * market data here: every item is a fixed code plus numbers taken from `SwotFacts`, so a report can
 * never state something that was not measured. The dashboard turns codes into Arabic text.
 */

export interface SwotFacts {
  activeProducts: number;
  productsWithCost: number;
  /** Active tracked competitors. */
  trackedCompetitors: number;
  failingCompetitors: number;
  /** Products that have at least one active competitor with a known price. */
  comparedProducts: number;
  /** Of those, products where a competitor's lowest price is below ours. */
  undercutProducts: number;
  /** Of those, products priced at or below every competitor. */
  cheapestProducts: number;
  topNiche: { key: string; sharePct: number } | null;
  /** Niches the store sells in with no tracked competitor. */
  uncoveredNiches: ReadonlyArray<{ key: string; products: number; suggestions: number }>;
  suggestionCount: number;
  /** Suggested marketplaces that overlap the store's niches (domains). */
  overlappingMarketplaces: readonly string[];
}

export interface SwotItem {
  code: string;
  params: Record<string, number | string | string[]>;
}

export interface SwotSections {
  strengths: SwotItem[];
  weaknesses: SwotItem[];
  opportunities: SwotItem[];
  threats: SwotItem[];
}

export const COST_COVERAGE_STRONG_PCT = 80;
export const COST_COVERAGE_WEAK_PCT = 50;
export const PRICE_LEADER_PCT = 60;
export const NICHE_FOCUS_PCT = 50;
export const NICHE_CONCENTRATION_PCT = 70;
export const THIN_COMPARISON_PCT = 30;
export const MIN_COMPARED_FOR_PRICE_CLAIMS = 3;
export const MIN_TRACKED_FOR_HEALTHY = 3;
export const MAX_FAILING_RATIO_HEALTHY = 0.2;

const pct = (part: number, whole: number): number => (whole === 0 ? 0 : Math.round((part / whole) * 100));

export function buildSwot(f: SwotFacts): SwotSections {
  const s: SwotSections = { strengths: [], weaknesses: [], opportunities: [], threats: [] };
  if (f.activeProducts === 0) return s; // nothing measured yet: say nothing

  const costPct = pct(f.productsWithCost, f.activeProducts);
  const comparedPct = pct(f.comparedProducts, f.activeProducts);

  // Strengths
  if (costPct >= COST_COVERAGE_STRONG_PCT) {
    s.strengths.push({ code: 'cost_coverage_high', params: { pct: costPct } });
  }
  if (f.comparedProducts >= MIN_COMPARED_FOR_PRICE_CLAIMS && pct(f.cheapestProducts, f.comparedProducts) >= PRICE_LEADER_PCT) {
    s.strengths.push({
      code: 'price_competitive',
      params: { pct: pct(f.cheapestProducts, f.comparedProducts), compared: f.comparedProducts },
    });
  }
  if (
    f.trackedCompetitors >= MIN_TRACKED_FOR_HEALTHY &&
    f.failingCompetitors / f.trackedCompetitors <= MAX_FAILING_RATIO_HEALTHY
  ) {
    s.strengths.push({ code: 'tracking_healthy', params: { tracked: f.trackedCompetitors } });
  }
  if (f.topNiche && f.topNiche.sharePct >= NICHE_FOCUS_PCT) {
    s.strengths.push({ code: 'niche_focus', params: { niche: f.topNiche.key, pct: f.topNiche.sharePct } });
  }

  // Weaknesses
  if (costPct < COST_COVERAGE_WEAK_PCT) {
    s.weaknesses.push({
      code: 'missing_costs',
      params: { missing: f.activeProducts - f.productsWithCost, pct: 100 - costPct },
    });
  }
  if (f.trackedCompetitors === 0) {
    s.weaknesses.push({ code: 'no_competitors_tracked', params: {} });
  } else {
    if (f.failingCompetitors > 0) s.weaknesses.push({ code: 'failing_sources', params: { count: f.failingCompetitors } });
    if (comparedPct < THIN_COMPARISON_PCT) {
      s.weaknesses.push({ code: 'thin_comparison', params: { compared: f.comparedProducts, products: f.activeProducts } });
    }
  }

  // Opportunities
  for (const n of f.uncoveredNiches) {
    s.opportunities.push({
      code: 'uncovered_niche',
      params: { niche: n.key, products: n.products, suggestions: n.suggestions },
    });
  }
  if (f.suggestionCount > 0) s.opportunities.push({ code: 'discoveries_available', params: { count: f.suggestionCount } });
  if (f.comparedProducts >= MIN_COMPARED_FOR_PRICE_CLAIMS && f.cheapestProducts > 0) {
    s.opportunities.push({ code: 'price_headroom', params: { count: f.cheapestProducts } });
  }

  // Threats
  if (f.undercutProducts > 0) {
    s.threats.push({
      code: 'undercut',
      params: { count: f.undercutProducts, pct: pct(f.undercutProducts, f.comparedProducts) },
    });
  }
  if (f.overlappingMarketplaces.length > 0) {
    s.threats.push({ code: 'marketplace_overlap', params: { domains: [...f.overlappingMarketplaces] } });
  }
  if (f.topNiche && f.topNiche.sharePct >= NICHE_CONCENTRATION_PCT) {
    s.threats.push({ code: 'niche_concentration', params: { niche: f.topNiche.key, pct: f.topNiche.sharePct } });
  }

  return s;
}
