import { buildSwot, type SwotFacts } from './swot-engine';

const facts = (over: Partial<SwotFacts> = {}): SwotFacts => ({
  activeProducts: 10,
  productsWithCost: 5,
  trackedCompetitors: 2,
  failingCompetitors: 0,
  comparedProducts: 5,
  undercutProducts: 0,
  cheapestProducts: 0,
  topNiche: null,
  uncoveredNiches: [],
  suggestionCount: 0,
  overlappingMarketplaces: [],
  ...over,
});

const codes = (items: { code: string }[]) => items.map((i) => i.code);

describe('buildSwot', () => {
  it('says nothing for a store with no products, rather than inventing a report', () => {
    expect(buildSwot(facts({ activeProducts: 0 }))).toEqual({
      strengths: [],
      weaknesses: [],
      opportunities: [],
      threats: [],
    });
  });

  it('reports strong cost coverage, a healthy tracked set and a focused niche as strengths', () => {
    const s = buildSwot(
      facts({ productsWithCost: 9, trackedCompetitors: 4, failingCompetitors: 0, topNiche: { key: 'perfumes', sharePct: 55 } }),
    );
    expect(codes(s.strengths)).toEqual(['cost_coverage_high', 'tracking_healthy', 'niche_focus']);
    expect(s.strengths[0]!.params).toEqual({ pct: 90 });
  });

  it('claims price leadership only with enough compared products and a clear majority', () => {
    const base = { comparedProducts: 5, cheapestProducts: 4 };
    expect(codes(buildSwot(facts(base)).strengths)).toContain('price_competitive');
    expect(codes(buildSwot(facts({ comparedProducts: 2, cheapestProducts: 2 })).strengths)).not.toContain('price_competitive');
    expect(codes(buildSwot(facts({ comparedProducts: 5, cheapestProducts: 2 })).strengths)).not.toContain('price_competitive');
  });

  it('flags missing costs, absent tracking, failing sources and thin comparison as weaknesses', () => {
    expect(codes(buildSwot(facts({ productsWithCost: 2 })).weaknesses)).toContain('missing_costs');
    expect(codes(buildSwot(facts({ trackedCompetitors: 0 })).weaknesses)).toEqual(['no_competitors_tracked']);
    const w = buildSwot(facts({ productsWithCost: 9, failingCompetitors: 1, comparedProducts: 1 })).weaknesses;
    expect(codes(w)).toEqual(['failing_sources', 'thin_comparison']);
  });

  it('turns uncovered niches, pending suggestions and price headroom into opportunities', () => {
    const o = buildSwot(
      facts({
        uncoveredNiches: [{ key: 'coffee_food', products: 6, suggestions: 2 }],
        suggestionCount: 3,
        comparedProducts: 5,
        cheapestProducts: 2,
      }),
    ).opportunities;
    expect(codes(o)).toEqual(['uncovered_niche', 'discoveries_available', 'price_headroom']);
    expect(o[0]!.params).toEqual({ niche: 'coffee_food', products: 6, suggestions: 2 });
  });

  it('reports undercutting, marketplace overlap and niche concentration as threats', () => {
    const t = buildSwot(
      facts({
        comparedProducts: 5,
        undercutProducts: 2,
        overlappingMarketplaces: ['amazon.sa', 'noon.com'],
        topNiche: { key: 'coffee_food', sharePct: 80 },
      }),
    ).threats;
    expect(codes(t)).toEqual(['undercut', 'marketplace_overlap', 'niche_concentration']);
    expect(t[0]!.params).toEqual({ count: 2, pct: 40 });
  });

  it('only ever emits numbers and short codes, never free text', () => {
    const s = buildSwot(
      facts({ topNiche: { key: 'perfumes', sharePct: 80 }, undercutProducts: 1, overlappingMarketplaces: ['noon.com'] }),
    );
    for (const item of Object.values(s).flat()) {
      expect(item.code).toMatch(/^[a-z_]+$/);
    }
  });
});
