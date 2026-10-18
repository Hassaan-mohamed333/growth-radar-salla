import { extractPrice, parsePrice } from './price-extractor';

const page = (head: string) => `<html><head>${head}</head><body></body></html>`;

describe('extractPrice', () => {
  it('reads a Product offer from JSON-LD', () => {
    const html = page(`<script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'x',
      offers: {
        '@type': 'Offer',
        price: '149.50',
        priceCurrency: 'sar',
        availability: 'https://schema.org/InStock',
      },
    })}</script>`);
    expect(extractPrice(html)).toEqual({ price: 149.5, currency: 'SAR', inStock: true });
  });

  it('finds the Product inside @graph and an offers array', () => {
    const html = page(`<script type="application/ld+json">${JSON.stringify({
      '@graph': [
        { '@type': 'WebSite' },
        {
          '@type': ['Product', 'Thing'],
          offers: [{ price: 99, priceCurrency: 'SAR', availability: 'OutOfStock' }],
        },
      ],
    })}</script>`);
    expect(extractPrice(html)).toEqual({ price: 99, currency: 'SAR', inStock: false });
  });

  it('uses AggregateOffer.lowPrice', () => {
    const html = page(`<script type="application/ld+json">${JSON.stringify({
      '@type': 'Product',
      offers: { '@type': 'AggregateOffer', lowPrice: '10', priceCurrency: 'SAR' },
    })}</script>`);
    expect(extractPrice(html)?.price).toBe(10);
  });

  it('skips malformed JSON-LD and falls back to meta tags', () => {
    const html = page(`
      <script type="application/ld+json">{ not json</script>
      <meta property="product:price:amount" content="1,299.00">
      <meta property="product:price:currency" content="SAR">`);
    expect(extractPrice(html)).toEqual({ price: 1299, currency: 'SAR', inStock: null });
  });

  it('reads itemprop=price', () => {
    expect(extractPrice(page('<meta itemprop="price" content="45.00">'))?.price).toBe(45);
  });

  it('returns null when the page has no price (layout changed)', () => {
    expect(extractPrice(page('<title>Hello</title>'))).toBeNull();
    expect(
      extractPrice(page(`<script type="application/ld+json">{"@type":"Organization"}</script>`)),
    ).toBeNull();
  });
});

describe('parsePrice', () => {
  it.each([
    ['1,299.50', 1299.5],
    ['1.299,50', 1299.5],
    ['12,5', 12.5],
    ['1,299', 1299],
    ['1.299.000', 1299000],
    ['٣٤٫٥٠ ر.س', 34.5], // "٣٤٫٥٠ ر.س"
    ['١٬٢٣٤', 1234], // "١٬٢٣٤"
    ['SAR 75', 75],
    ['ر.س 120.00', 120], // dotted currency symbol before the amount
    [19.999, 20],
  ])('parses %s', (input, expected) => {
    expect(parsePrice(input)).toBe(expected);
  });

  it.each(['', 'free', '0', '-5', '99999999999', null, undefined, NaN])('rejects %p', (input) => {
    expect(parsePrice(input)).toBeNull();
  });
});

describe('extractPrice on hostile markup', () => {
  // Competitor pages are attacker-controlled, and the fetcher accepts up to 2 MB.
  // The old patterns were quadratic: 100 KB already took seconds, 2 MB took hours and
  // blocked the API process. 100 KB keeps a revert failing in seconds, not hanging.
  const SIZE = 100 * 1024;

  it.each([
    ['unclosed JSON-LD tags', '<script type="application/ld+json">x'.repeat(SIZE / 38)],
    ['bare "<" characters', '<'.repeat(SIZE)],
    ['meta tags without ">"', '<meta'.repeat(SIZE / 5)],
    ['itemprop without ">"', '<span itemprop="price"'.repeat(SIZE / 23)],
  ])('answers quickly for %s', (_name, html) => {
    const started = Date.now();
    extractPrice(html);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('keeps long separator runs linear in parsePrice', () => {
    const started = Date.now();
    expect(parsePrice(','.repeat(100_000) + '1')).toBe(1);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('extractPrice tag handling', () => {
  it('finds JSON-LD after an unrelated unclosed script tag', () => {
    const ld = JSON.stringify({ '@type': 'Product', offers: { price: '75', priceCurrency: 'SAR' } });
    const html = `<html><script>var a = 1;<script type="application/ld+json">${ld}</SCRIPT></html>`;
    expect(extractPrice(html)).toEqual({ price: 75, currency: 'SAR', inStock: null });
  });

  it('reads itemprop=price from a tag that is not the first one on the page', () => {
    const html = '<div class="a"></div><span itemprop="price" content="310.5"></span>';
    expect(extractPrice(html)).toEqual({ price: 310.5, currency: null, inStock: null });
  });
});
