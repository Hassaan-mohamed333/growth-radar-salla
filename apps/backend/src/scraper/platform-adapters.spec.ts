import { extractPrice, extractProductName } from './price-extractor';
import { platformAdapterFor } from './platform-adapters';
import { ScrapeError } from './scrape-error';

describe('platformAdapterFor', () => {
  it('maps a Shopify product URL (with locale prefix and collection path) to its .js endpoint', () => {
    expect(platformAdapterFor('https://shop.example.com/products/ethiopian-coffee')?.apiUrl).toBe(
      'https://shop.example.com/products/ethiopian-coffee.js',
    );
    expect(platformAdapterFor('https://shop.example.com/ar/products/ethiopian-coffee?variant=1')?.apiUrl).toBe(
      'https://shop.example.com/ar/products/ethiopian-coffee.js',
    );
    expect(platformAdapterFor('https://shop.example.com/collections/coffee/products/ethiopian-coffee')?.apiUrl).toBe(
      'https://shop.example.com/collections/coffee/products/ethiopian-coffee.js',
    );
  });

  it('maps a WooCommerce product URL to the Store API', () => {
    const a = platformAdapterFor('https://woo.example.com/product/green-tea/');
    expect(a?.platform).toBe('woocommerce');
    expect(a?.apiUrl).toBe('https://woo.example.com/wp-json/wc/store/v1/products?slug=green-tea');
  });

  it('returns null for other URL shapes and for garbage', () => {
    expect(platformAdapterFor('https://salla.example.com/p123456')).toBeNull();
    expect(platformAdapterFor('https://example.com/')).toBeNull();
    expect(platformAdapterFor('not a url')).toBeNull();
  });
});

describe('Shopify adapter output', () => {
  const adapter = platformAdapterFor('https://shop.example.com/products/x')!;

  it('turns integer minor units into a page the extractor can read', () => {
    const html = adapter.toHtml({ title: 'قهوة إثيوبية 500غ', price: 9900, available: true });
    expect(extractPrice(html)).toEqual({ price: 99, currency: null, inStock: true });
    expect(extractProductName(html)).toBe('قهوة إثيوبية 500غ');
  });

  it('reports out of stock', () => {
    const html = adapter.toHtml({ title: 'x', price: 5000, available: false });
    expect(extractPrice(html)?.inStock).toBe(false);
  });

  it('keeps a product name from closing the script element', () => {
    const html = adapter.toHtml({ title: '</script><b>x', price: 100, available: true });
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(extractProductName(html)).toBe('</script><b>x');
  });

  it('rejects an unexpected shape', () => {
    expect(() => adapter.toHtml({ nope: true })).toThrow(ScrapeError);
    expect(() => adapter.toHtml(null)).toThrow(ScrapeError);
  });
});

describe('WooCommerce adapter output', () => {
  const adapter = platformAdapterFor('https://woo.example.com/product/x')!;

  it('applies the currency minor unit and carries the currency', () => {
    const html = adapter.toHtml([
      { name: 'Green tea', prices: { price: '1550', currency_code: 'SAR', currency_minor_unit: 2 }, is_in_stock: true },
    ]);
    expect(extractPrice(html)).toEqual({ price: 15.5, currency: 'SAR', inStock: true });
  });

  it('rejects an empty result (slug not found) and bad prices', () => {
    expect(() => adapter.toHtml([])).toThrow(ScrapeError);
    expect(() => adapter.toHtml([{ name: 'x', prices: { price: 'abc' } }])).toThrow(ScrapeError);
  });
});
