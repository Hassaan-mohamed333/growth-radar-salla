import { computeStoreHealth, type HealthProduct } from './store-health';

const p = (over: Partial<HealthProduct> & { id: string }): HealthProduct => ({
  name: `منتج ${over.id}`,
  status: 'SALE',
  price: 100,
  salePrice: null,
  costPrice: null,
  quantity: 20,
  ...over,
});

describe('computeStoreHealth', () => {
  it('handles an empty catalogue', () => {
    const h = computeStoreHealth([]);
    expect(h.totalProducts).toBe(0);
    expect(h.margins.avgMarginPct).toBeNull();
    expect(h.inventory.costValue).toBeNull();
    expect(h.discounts.avgDiscountPct).toBeNull();
  });

  it('counts out-of-stock (flag or zero quantity), low stock and hidden separately', () => {
    const h = computeStoreHealth([
      p({ id: 'a', status: 'OUT' }),
      p({ id: 'b', quantity: 0 }),
      p({ id: 'c', quantity: 3 }),
      p({ id: 'd', quantity: 1 }),
      p({ id: 'e', quantity: null }),
      p({ id: 'f', status: 'HIDDEN' }),
      p({ id: 'g', status: 'DELETED' }),
    ]);
    expect(h.totalProducts).toBe(5);
    expect(h.stock.outOfStock).toBe(2);
    expect(h.stock.lowStock).toBe(2);
    expect(h.stock.lowStockItems.map((i) => i.id)).toEqual(['d', 'c']); // lowest first
    expect(h.stock.hidden).toBe(1);
  });

  it('flags products sold at or below cost, using the sale price', () => {
    const h = computeStoreHealth([
      p({ id: 'loss', price: 100, salePrice: 70, costPrice: 80 }),
      p({ id: 'zero', price: 50, costPrice: 50 }),
      p({ id: 'thin', price: 100, costPrice: 90 }),
      p({ id: 'good', price: 100, costPrice: 40 }),
      p({ id: 'nocost' }),
    ]);
    expect(h.margins.belowCost.map((r) => r.id)).toEqual(['loss', 'zero']);
    expect(h.margins.belowCost[0]?.marginPct).toBe(-14.3);
    expect(h.margins.thinnest.map((r) => r.id)).toEqual(['thin']);
    expect(h.margins.withCost).toBe(4);
    expect(h.margins.missingCost).toBe(1);
    expect(h.margins.avgMarginPct).toBe(
      Math.round(((-14.3 + 0 + 10 + 60) / 4) * 10) / 10,
    );
  });

  it('reports discounts and ignores a sale price that is not lower', () => {
    const h = computeStoreHealth([
      p({ id: 'a', price: 100, salePrice: 80 }),
      p({ id: 'b', price: 100, salePrice: 50 }),
      p({ id: 'c', price: 100, salePrice: 100 }),
      p({ id: 'd', price: 100, salePrice: 0 }),
    ]);
    expect(h.discounts.onSale).toBe(2);
    expect(h.discounts.avgDiscountPct).toBe(35);
    expect(h.discounts.deepest[0]?.id).toBe('b');
  });

  it('values stock only for products with both cost and quantity', () => {
    const h = computeStoreHealth([
      p({ id: 'a', price: 100, costPrice: 40, quantity: 10 }),
      p({ id: 'b', price: 200, salePrice: 150, costPrice: 100, quantity: 2 }),
      p({ id: 'c', price: 100, costPrice: 40, quantity: null }),
      p({ id: 'd', price: 100, quantity: 5 }),
    ]);
    expect(h.inventory.productsCounted).toBe(2);
    expect(h.inventory.costValue).toBe(600);
    expect(h.inventory.retailValue).toBe(1300);
  });
});
