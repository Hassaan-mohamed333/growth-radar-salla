import type { SallaProduct } from '../salla/salla-api.client';
import { mapProductStatus, toProductValues } from './product-mapping';

const product = (over: Partial<SallaProduct> = {}): SallaProduct => ({
  id: '1',
  sku: null,
  name: 'Item',
  price: 100,
  salePrice: null,
  costPrice: null,
  currency: null,
  quantity: 5,
  statusSlug: 'sale',
  url: null,
  imageUrl: null,
  ...over,
});

describe('mapProductStatus', () => {
  it.each([
    ['sale', 'SALE'],
    ['out', 'OUT'],
    ['hidden', 'HIDDEN'],
    ['deleted', 'DELETED'],
  ])('maps %s -> %s', (slug, expected) => {
    expect(mapProductStatus(slug)).toBe(expected);
  });

  it('treats unknown or missing slugs as HIDDEN, never purchasable', () => {
    expect(mapProductStatus('weird')).toBe('HIDDEN');
    expect(mapProductStatus(null)).toBe('HIDDEN');
  });
});

describe('toProductValues', () => {
  it('uses the store currency when the product has none', () => {
    expect(toProductValues(product(), 'SAR').currency).toBe('SAR');
    expect(toProductValues(product({ currency: 'USD' }), 'SAR').currency).toBe('USD');
  });

  it('downgrades SALE to OUT when tracked stock is zero', () => {
    expect(toProductValues(product({ quantity: 0 }), 'SAR').status).toBe('OUT');
    expect(toProductValues(product({ quantity: null }), 'SAR').status).toBe('SALE');
  });

  it('does not resurrect a hidden product just because it has stock', () => {
    expect(toProductValues(product({ statusSlug: 'hidden', quantity: 9 }), 'SAR').status).toBe(
      'HIDDEN',
    );
  });
});
