import { computeProductReport, type ReportProduct } from './product-report';

const p = (id: string, over: Partial<ReportProduct> = {}): ReportProduct => ({
  id,
  name: `منتج ${id}`,
  status: 'SALE',
  price: 100,
  salePrice: null,
  costPrice: null,
  soldQuantity: null,
  views: null,
  ...over,
});

describe('computeProductReport', () => {
  it('handles an empty catalogue', () => {
    const r = computeProductReport([]);
    expect(r.topSellers).toEqual([]);
    expect(r.profit.counted).toBe(0);
    expect(r.coverage.total).toBe(0);
  });

  it('ranks top sellers and ignores products without a counter or with zero sales', () => {
    const r = computeProductReport([
      p('a', { soldQuantity: 5 }),
      p('b', { soldQuantity: 50 }),
      p('c', { soldQuantity: 0 }),
      p('d'),
      p('h', { status: 'HIDDEN', soldQuantity: 999 }),
    ]);
    expect(r.topSellers.map((x) => x.id)).toEqual(['b', 'a']);
    expect(r.neverSold.count).toBe(1);
    expect(r.neverSold.sample[0]?.id).toBe('c');
    expect(r.coverage).toEqual({ withSales: 3, withViews: 0, total: 4 });
  });

  it('finds pages that are viewed but rarely bought, only above a minimum of views', () => {
    const r = computeProductReport([
      p('a', { views: 1000, soldQuantity: 2 }),
      p('b', { views: 1000, soldQuantity: 100 }),
      p('c', { views: 10, soldQuantity: 0 }),
    ]);
    expect(r.mostViewed.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(r.lowConversion.map((x) => x.id)).toEqual(['a', 'b']);
    expect(r.lowConversion[0]?.conversionPct).toBe(0.2);
  });

  it('estimates profit from units x current margin, only with a known cost and sales', () => {
    const r = computeProductReport([
      p('big', { price: 100, costPrice: 40, soldQuantity: 10 }), // 600
      p('small', { price: 100, costPrice: 90, soldQuantity: 100 }), // 1000
      p('loss', { price: 100, salePrice: 70, costPrice: 80, soldQuantity: 5 }), // -50
      p('nocost', { soldQuantity: 9 }),
      p('nosales', { costPrice: 10, soldQuantity: 0 }),
    ]);
    expect(r.profit.counted).toBe(3);
    expect(r.profit.most.map((x) => x.id)).toEqual(['small', 'big', 'loss']);
    expect(r.profit.least[0]).toMatchObject({ id: 'loss', value: -50, unitProfit: -10 });
  });
});
