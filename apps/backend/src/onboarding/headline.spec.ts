import { computeHeadline } from './headline';

describe('computeHeadline', () => {
  it('returns null when nothing can be compared', () => {
    expect(computeHeadline([])).toBeNull();
    expect(computeHeadline([{ ours: 100, competitors: [] }])).toBeNull();
    expect(computeHeadline([{ ours: 100, competitors: [{ id: 'a', price: 0 }] }])).toBeNull();
    expect(computeHeadline([{ ours: 0, competitors: [{ id: 'a', price: 50 }] }])).toBeNull();
  });

  it('judges each product against its cheapest competitor and averages the gap over higher ones', () => {
    const h = computeHeadline([
      { ours: 120, competitors: [{ id: 'a', price: 100 }, { id: 'b', price: 150 }] }, // +20%
      { ours: 110, competitors: [{ id: 'a', price: 100 }] }, // +10%
      { ours: 80, competitors: [{ id: 'b', price: 100 }] }, // below
      { ours: 50, competitors: [{ id: 'c', price: 50 }] }, // same
    ]);

    expect(h).toEqual({
      comparedProducts: 4,
      higherProducts: 2,
      lowerProducts: 1,
      samePriceProducts: 1,
      avgHigherPct: 15,
      competitorsCompared: 3,
    });
  });

  it('has no average when we are never higher', () => {
    const h = computeHeadline([{ ours: 80, competitors: [{ id: 'a', price: 100 }] }]);
    expect(h).toMatchObject({ higherProducts: 0, lowerProducts: 1, avgHigherPct: null });
  });

  it('ignores unusable competitor prices but keeps the product when another is valid', () => {
    const h = computeHeadline([
      { ours: 110, competitors: [{ id: 'a', price: Number.NaN }, { id: 'b', price: 100 }] },
    ]);
    expect(h).toMatchObject({ comparedProducts: 1, higherProducts: 1, avgHigherPct: 10, competitorsCompared: 1 });
  });
});
