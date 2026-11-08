import { extractCandidates, isOnDomain, searchUrls } from './search-results';

const page = (domain: string) => new URL(`https://${domain}/search?q=x`);

describe('extractCandidates', () => {
  it('finds Shopify-style product links with their titles', () => {
    const html = `
      <a href="/products/ethiopian-coffee" title="Ethiopian Coffee 500g">img</a>
      <a href="/collections/all">All</a>
      <a href="/products/kenya-coffee">Kenya Coffee</a>`;
    expect(extractCandidates(html, page('beans.sa'), 'beans.sa')).toEqual([
      { url: 'https://beans.sa/products/ethiopian-coffee', title: 'Ethiopian Coffee 500g' },
      { url: 'https://beans.sa/products/kenya-coffee', title: 'Kenya Coffee' },
    ]);
  });

  it('finds Salla-style links (/ar/slug/p123456), including Arabic slugs', () => {
    const html = '<a href="/ar/قهوة-اثيوبية/p1234567"><span>قهوة إثيوبية <b>500غ</b></span></a>';
    const [c] = extractCandidates(html, page('store.sa'), 'store.sa');
    expect(c!.url).toContain('/p1234567');
    expect(c!.title).toBe('قهوة إثيوبية 500غ');
  });

  it('keeps the longer title when the same product is linked twice (image link and name link)', () => {
    const html = `
      <a href="/products/x"><img alt="X"></a>
      <a href="/products/x?variant=2">Full product name X</a>`;
    const out = extractCandidates(html, page('s.sa'), 's.sa');
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe('Full product name X');
  });

  it('falls back to the image alt text for image-only links', () => {
    const html = '<a href="/products/x"><img src="a.jpg" alt="Alt Name Of Product"></a>';
    expect(extractCandidates(html, page('s.sa'), 's.sa')[0]!.title).toBe('Alt Name Of Product');
  });

  it('never returns links to other sites, however product-like they look', () => {
    const html = `
      <a href="https://evil.example/products/steal" title="Sneaky product">x</a>
      <a href="https://s.sa.evil.example/products/steal" title="Lookalike product">x</a>
      <a href="//other.example/products/p" title="Protocol relative">x</a>`;
    expect(extractCandidates(html, page('s.sa'), 's.sa')).toEqual([]);
  });

  it('accepts subdomains and www of the competitor, and drops credentials, ports and odd schemes', () => {
    const html = `
      <a href="https://www.s.sa/products/a" title="Product A">x</a>
      <a href="https://shop.s.sa/products/b" title="Product B">x</a>
      <a href="https://user:pw@s.sa/products/c" title="Product C">x</a>
      <a href="https://s.sa:8443/products/d" title="Product D">x</a>
      <a href="javascript:alert(1)" title="Product E">x</a>`;
    expect(extractCandidates(html, page('s.sa'), 's.sa').map((c) => c.title)).toEqual(['Product A', 'Product B']);
  });

  it('caps the number of results', () => {
    const html = Array.from({ length: 40 }, (_, i) => `<a href="/products/p${i}" title="Product ${i}">x</a>`).join('');
    expect(extractCandidates(html, page('s.sa'), 's.sa', 5)).toHaveLength(5);
  });

  it('stays fast on hostile markup: thousands of unclosed anchors', () => {
    const html = '<a href="/products/a" '.repeat(20_000) + 'x'.repeat(200_000);
    const t = Date.now();
    extractCandidates(html, page('s.sa'), 's.sa');
    expect(Date.now() - t).toBeLessThan(2000);
  });
});

describe('isOnDomain', () => {
  it('matches the domain, www and subdomains only', () => {
    expect(isOnDomain('www.noon.com', 'noon.com')).toBe(true);
    expect(isOnDomain('shop.noon.com', 'noon.com')).toBe(true);
    expect(isOnDomain('notnoon.com', 'noon.com')).toBe(false);
    expect(isOnDomain('noon.com.evil.example', 'noon.com')).toBe(false);
  });
});

describe('searchUrls', () => {
  it('encodes the query and covers the common platforms', () => {
    const urls = searchUrls('s.sa', 'قهوة اثيوبية');
    expect(urls).toHaveLength(3);
    expect(urls[0]).toBe(`https://s.sa/search?q=${encodeURIComponent('قهوة اثيوبية')}`);
    expect(urls.every((u) => u.startsWith('https://s.sa/'))).toBe(true);
  });
});
