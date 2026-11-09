import { ScrapeError } from './scrape-error';
import { TieredPageFetcher } from './tiered-page-fetcher';

const withPrice = (price: string) =>
  `<script type="application/ld+json">${JSON.stringify({
    '@type': 'Product',
    offers: { price, priceCurrency: 'SAR' },
  })}</script>`;
const NO_PRICE = '<html><body>loading…</body></html>';
const blocked = () => new ScrapeError('blocked', 'Access refused (403)');

function setup(opts: { render?: boolean; blockThreshold?: number } = {}) {
  const fetchHtml = jest.fn<Promise<string>, [string]>();
  const fetchJson = jest.fn<Promise<unknown>, [string]>();
  const fetchRendered = jest.fn<Promise<string>, [string]>();
  let clock = 1_000_000;
  const fetcher = new TieredPageFetcher({
    http: { fetchHtml, fetchJson },
    render: opts.render ? { fetchRendered } : undefined,
    blockThreshold: opts.blockThreshold ?? 3,
    cooldownMs: 60_000,
    now: () => clock,
  });
  return { fetcher, fetchHtml, fetchJson, fetchRendered, advance: (ms: number) => (clock += ms) };
}

const SHOPIFY = 'https://shop.example.com/products/x';
const PLAIN = 'https://plain.example.com/item/1';

describe('TieredPageFetcher.fetchProductHtml', () => {
  it('tier 1: returns the page when a price is readable, touching nothing else', async () => {
    const { fetcher, fetchHtml, fetchJson, fetchRendered } = setup({ render: true });
    fetchHtml.mockResolvedValue(withPrice('10'));

    await expect(fetcher.fetchProductHtml(PLAIN)).resolves.toContain('"price":"10"');
    expect(fetchJson).not.toHaveBeenCalled();
    expect(fetchRendered).not.toHaveBeenCalled();
  });

  it('tier 2: a blocked Shopify page is answered from the product JSON', async () => {
    const { fetcher, fetchHtml, fetchJson, fetchRendered } = setup({ render: true });
    fetchHtml.mockRejectedValue(blocked());
    fetchJson.mockResolvedValue({ title: 'Coffee', price: 9900, available: true });

    const html = await fetcher.fetchProductHtml(SHOPIFY);
    expect(html).toContain('99.00');
    expect(fetchJson).toHaveBeenCalledWith('https://shop.example.com/products/x.js');
    expect(fetchRendered).not.toHaveBeenCalled();
  });

  it('tier 2: a Shopify page without a readable price also falls to the JSON', async () => {
    const { fetcher, fetchHtml, fetchJson } = setup();
    fetchHtml.mockResolvedValue(NO_PRICE);
    fetchJson.mockResolvedValue({ title: 'Coffee', price: 5000, available: true });
    await expect(fetcher.fetchProductHtml(SHOPIFY)).resolves.toContain('50.00');
  });

  it('tier 3: a blocked non-platform page goes to the rendering service', async () => {
    const { fetcher, fetchHtml, fetchRendered } = setup({ render: true });
    fetchHtml.mockRejectedValue(blocked());
    fetchRendered.mockResolvedValue(withPrice('42'));

    await expect(fetcher.fetchProductHtml(PLAIN)).resolves.toContain('"price":"42"');
  });

  it('tier 3: a JavaScript-only page (loads, no price) is rendered', async () => {
    const { fetcher, fetchHtml, fetchRendered } = setup({ render: true });
    fetchHtml.mockResolvedValue(NO_PRICE);
    fetchRendered.mockResolvedValue(withPrice('7'));
    await expect(fetcher.fetchProductHtml(PLAIN)).resolves.toContain('"price":"7"');
  });

  it('does not pay for rendering when the page is simply gone or the network failed', async () => {
    const { fetcher, fetchHtml, fetchRendered } = setup({ render: true });
    fetchHtml.mockRejectedValue(new ScrapeError('http_error', 'Unexpected status 404'));
    await expect(fetcher.fetchProductHtml(PLAIN)).rejects.toMatchObject({ kind: 'http_error' });
    expect(fetchRendered).not.toHaveBeenCalled();
  });

  it('never escalates a refused target (SSRF guard)', async () => {
    const { fetcher, fetchHtml, fetchRendered } = setup({ render: true });
    fetchHtml.mockRejectedValue(new ScrapeError('forbidden_target', 'private'));
    await expect(fetcher.fetchProductHtml(PLAIN)).rejects.toMatchObject({ kind: 'forbidden_target' });
    expect(fetchRendered).not.toHaveBeenCalled();
  });

  it('hands back a loaded page with no price so the caller reports parse_failed, not blocked', async () => {
    const { fetcher, fetchHtml } = setup();
    fetchHtml.mockResolvedValue(NO_PRICE);
    await expect(fetcher.fetchProductHtml(PLAIN)).resolves.toBe(NO_PRICE);
  });

  it('keeps the original block error when every tier fails', async () => {
    const { fetcher, fetchHtml, fetchRendered } = setup({ render: true });
    fetchHtml.mockRejectedValue(blocked());
    fetchRendered.mockRejectedValue(new ScrapeError('network', 'down', { retryable: true }));
    await expect(fetcher.fetchProductHtml(PLAIN)).rejects.toMatchObject({ kind: 'blocked' });
  });

  it('does not swallow programming errors', async () => {
    const { fetcher, fetchHtml } = setup();
    fetchHtml.mockRejectedValue(new TypeError('bug'));
    await expect(fetcher.fetchProductHtml(PLAIN)).rejects.toThrow(TypeError);
  });
});

describe('TieredPageFetcher circuit breaker', () => {
  it('pauses a domain after repeated blocks and skips the network while paused', async () => {
    const { fetcher, fetchHtml } = setup({ blockThreshold: 2 });
    fetchHtml.mockRejectedValue(blocked());

    await expect(fetcher.fetchProductHtml(PLAIN)).rejects.toMatchObject({ kind: 'blocked' });
    await expect(fetcher.fetchProductHtml(PLAIN)).rejects.toMatchObject({ kind: 'blocked' });
    expect(fetchHtml).toHaveBeenCalledTimes(2);

    const paused = await fetcher.fetchProductHtml(PLAIN).catch((e: ScrapeError) => e);
    expect(paused).toMatchObject({ kind: 'blocked', retryAfterMs: 60_000 });
    expect(fetchHtml).toHaveBeenCalledTimes(2); // no request went out
  });

  it('is per domain', async () => {
    const { fetcher, fetchHtml } = setup({ blockThreshold: 1 });
    fetchHtml.mockRejectedValueOnce(blocked()).mockResolvedValue(withPrice('5'));
    await expect(fetcher.fetchProductHtml(PLAIN)).rejects.toBeDefined();
    await expect(fetcher.fetchProductHtml('https://other.example.com/p/1')).resolves.toBeDefined();
  });

  it('probes once after the cooldown and re-opens at the first new block', async () => {
    const { fetcher, fetchHtml, advance } = setup({ blockThreshold: 2 });
    fetchHtml.mockRejectedValue(blocked());
    await fetcher.fetchProductHtml(PLAIN).catch(() => undefined);
    await fetcher.fetchProductHtml(PLAIN).catch(() => undefined);

    advance(61_000);
    await expect(fetcher.fetchProductHtml(PLAIN)).rejects.toMatchObject({ kind: 'blocked' });
    expect(fetchHtml).toHaveBeenCalledTimes(3); // the probe went out
    const again = await fetcher.fetchProductHtml(PLAIN).catch((e: ScrapeError) => e);
    expect((again as ScrapeError).retryAfterMs).toBeGreaterThan(0);
    expect(fetchHtml).toHaveBeenCalledTimes(3); // and the breaker is shut again
  });

  it('a success clears the count', async () => {
    const { fetcher, fetchHtml } = setup({ blockThreshold: 2 });
    fetchHtml
      .mockRejectedValueOnce(blocked())
      .mockResolvedValueOnce(withPrice('5'))
      .mockRejectedValueOnce(blocked());
    await fetcher.fetchProductHtml(PLAIN).catch(() => undefined);
    await fetcher.fetchProductHtml(PLAIN);
    await fetcher.fetchProductHtml(PLAIN).catch(() => undefined);

    fetchHtml.mockResolvedValue(withPrice('5'));
    await expect(fetcher.fetchProductHtml(PLAIN)).resolves.toBeDefined(); // not paused
  });

  it('does not count non-block failures', async () => {
    const { fetcher, fetchHtml } = setup({ blockThreshold: 1 });
    fetchHtml.mockRejectedValue(new ScrapeError('network', 'reset', { retryable: true }));
    await fetcher.fetchProductHtml(PLAIN).catch(() => undefined);
    await fetcher.fetchProductHtml(PLAIN).catch(() => undefined);
    expect(fetchHtml).toHaveBeenCalledTimes(2);
  });
});

describe('TieredPageFetcher.fetchHtml (non-product pages)', () => {
  it('returns a price-less page as is, without escalating', async () => {
    const { fetcher, fetchHtml, fetchJson, fetchRendered } = setup({ render: true });
    fetchHtml.mockResolvedValue(NO_PRICE);
    await expect(fetcher.fetchHtml('https://shop.example.com/search?q=x')).resolves.toBe(NO_PRICE);
    expect(fetchJson).not.toHaveBeenCalled();
    expect(fetchRendered).not.toHaveBeenCalled();
  });

  it('uses the rendering service only when blocked', async () => {
    const { fetcher, fetchHtml, fetchRendered } = setup({ render: true });
    fetchHtml.mockRejectedValue(blocked());
    fetchRendered.mockResolvedValue('<html>results</html>');
    await expect(fetcher.fetchHtml('https://shop.example.com/search?q=x')).resolves.toBe('<html>results</html>');
  });
});
