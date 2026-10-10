import { SallaApiClient, parseSallaProduct } from './salla-api.client';

const base = {
  id: 1001,
  sku: ' SKU-1 ',
  name: '  Coffee Beans  ',
  price: { amount: 80, currency: 'sar' },
  regular_price: { amount: 100, currency: 'SAR' },
  sale_price: { amount: 80, currency: 'SAR' },
  status: 'SALE',
  quantity: 12,
  url: 'https://store.example/p/1001',
  main_image: 'https://cdn.example/1001.jpg',
};

describe('parseSallaProduct', () => {
  it('normalises ids, text, status and money', () => {
    expect(parseSallaProduct(base)).toEqual({
      id: '1001',
      sku: 'SKU-1',
      name: 'Coffee Beans',
      price: 100,
      salePrice: 80,
      costPrice: null,
      currency: 'SAR',
      quantity: 12,
      statusSlug: 'sale',
      url: 'https://store.example/p/1001',
      imageUrl: 'https://cdn.example/1001.jpg',
    });
  });

  it('treats a zero or non-discounting sale_price as "not on sale"', () => {
    const zero = parseSallaProduct({ ...base, sale_price: { amount: 0 } });
    expect(zero?.price).toBe(100);
    expect(zero?.salePrice).toBeNull();

    const higher = parseSallaProduct({ ...base, sale_price: { amount: 120 } });
    expect(higher?.salePrice).toBeNull();
  });

  it('falls back to price when regular_price is absent', () => {
    const p = parseSallaProduct({ id: 'a', name: 'X', price: { amount: 55.5 } });
    expect(p).toMatchObject({ price: 55.5, salePrice: null, quantity: null });
  });

  it('accepts a bare-number cost_price and reads quantity null as unlimited', () => {
    const p = parseSallaProduct({ ...base, cost_price: 40, quantity: null });
    expect(p).toMatchObject({ costPrice: 40, quantity: null });
  });

  it('rejects entries without id/name or without any price (partial webhook payloads)', () => {
    expect(parseSallaProduct({ name: 'No id', price: { amount: 1 } })).toBeNull();
    expect(parseSallaProduct({ id: 1, price: { amount: 1 } })).toBeNull();
    expect(parseSallaProduct({ id: 1, name: 'No price' })).toBeNull();
    expect(parseSallaProduct(null)).toBeNull();
    expect(parseSallaProduct('nope')).toBeNull();
  });
});

describe('SallaApiClient.listProducts', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  const page = (data: unknown[], currentPage: number, totalPages: number) =>
    new Response(JSON.stringify({ data, pagination: { currentPage, totalPages } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  it('reads every page, skips malformed entries and reports completeness', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(page([base, { id: 2 }], 1, 2))
      .mockResolvedValueOnce(page([{ ...base, id: 1002 }], 2, 2));
    global.fetch = fetchMock as unknown as typeof fetch;

    const out = await new SallaApiClient().listProducts('tok');

    expect(out.complete).toBe(true);
    expect(out.skipped).toBe(1);
    expect(out.products.map((p) => p.id)).toEqual(['1001', '1002']);
    const firstUrl = String(fetchMock.mock.calls[0]![0]);
    expect(firstUrl).toContain('/products?');
    expect(fetchMock.mock.calls[0]![1].headers.authorization).toBe('Bearer tok');
  });

  it('throws a typed error carrying the HTTP status', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response('{}', { status: 403 })) as unknown as typeof fetch;

    await expect(new SallaApiClient().listProducts('tok')).rejects.toMatchObject({
      name: 'SallaApiError',
      status: 403,
    });
  });
});
