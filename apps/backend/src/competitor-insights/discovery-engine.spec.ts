import { buildSuggestions, MAX_SUGGESTIONS, MIN_SCORE } from './discovery-engine';
import type { CatalogEntry } from './ksa-catalog';

const entry = (over: Partial<CatalogEntry> & Pick<CatalogEntry, 'key' | 'domain'>): CatalogEntry => ({
  name: over.key,
  kind: 'RETAILER',
  niches: ['electronics'],
  ...over,
});

describe('buildSuggestions', () => {
  // 10 products: 6 electronics, 2 perfumes, 2 unclassified
  const products: string[][] = [
    ...Array.from({ length: 6 }, () => ['electronics']),
    ...Array.from({ length: 2 }, () => ['perfumes']),
    [],
    [],
  ];

  it('scores by the share of the store catalogue in the competitor niches', () => {
    const [s] = buildSuggestions(products, [entry({ key: 'a', domain: 'a.sa', niches: ['electronics'] })], new Set());

    expect(s).toMatchObject({ catalogKey: 'a', score: 60, niches: ['electronics'] });
    expect(s!.reasons).toEqual([{ code: 'niche_overlap', niche: 'electronics', products: 6 }]);
  });

  it('counts a product once even when several of its niches overlap', () => {
    const multi = [['electronics', 'perfumes'], ['electronics']];
    const [s] = buildSuggestions(multi, [entry({ key: 'a', domain: 'a.sa', niches: ['electronics', 'perfumes'] })], new Set());
    expect(s!.score).toBe(100);
  });

  it('skips competitors that are already tracked, ignoring www. and case', () => {
    const catalog = [entry({ key: 'a', domain: 'a.sa' }), entry({ key: 'b', domain: 'b.sa' })];
    const out = buildSuggestions(products, catalog, new Set(['a.sa']));
    expect(out.map((s) => s.catalogKey)).toEqual(['b']);
  });

  it('drops weak overlaps and entries with no overlap at all', () => {
    const catalog = [
      entry({ key: 'none', domain: 'n.sa', niches: ['sports_outdoor'] }),
      entry({ key: 'weak', domain: 'w.sa', niches: ['perfumes'] }), // 2 of 10 = 20%
    ];
    const lowShare = Array.from({ length: 30 }, (_, i) => (i === 0 ? ['perfumes'] : ['electronics'])); // 1/30 = 3%
    expect(buildSuggestions(products, catalog, new Set()).map((s) => s.catalogKey)).toEqual(['weak']);
    expect(buildSuggestions(lowShare, [catalog[1]!], new Set())).toEqual([]);
    expect(MIN_SCORE).toBeGreaterThan(3);
  });

  it('puts specialists before marketplaces at equal overlap, and marketplaces carry that reason', () => {
    const catalog = [
      entry({ key: 'market', domain: 'm.sa', kind: 'MARKETPLACE' }),
      entry({ key: 'special', domain: 's.sa', kind: 'SPECIALIST' }),
      entry({ key: 'retail', domain: 'r.sa', kind: 'RETAILER' }),
    ];
    const out = buildSuggestions(products, catalog, new Set());

    expect(out.map((s) => s.catalogKey)).toEqual(['special', 'retail', 'market']);
    expect(out[2]!.reasons).toContainEqual({ code: 'marketplace' });
    expect(out[0]!.reasons).not.toContainEqual({ code: 'marketplace' });
  });

  it('returns nothing for an empty catalogue and caps the list', () => {
    expect(buildSuggestions([], [entry({ key: 'a', domain: 'a.sa' })], new Set())).toEqual([]);
    const many = Array.from({ length: MAX_SUGGESTIONS + 5 }, (_, i) => entry({ key: `k${i}`, domain: `d${i}.sa` }));
    expect(buildSuggestions(products, many, new Set())).toHaveLength(MAX_SUGGESTIONS);
  });
});
