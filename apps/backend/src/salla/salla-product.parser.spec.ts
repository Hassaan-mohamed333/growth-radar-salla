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

describe('parseSallaProduct - shapes from the official docs', () => {
  const doc = {
    id: 1115785385,
    sku: '23-TD23-32',
    name: 'Product Name',
    type: 'product',
    price: { amount: 96.33, currency: 'SAR' },
    taxed_price: { amount: 100.33, currency: 'SAR' },
    pre_tax_price: { amount: 96.33, currency: 'SAR' },
    regular_price: { amount: 100.33, currency: 'SAR' },
    sale_price: { amount: 90.5, currency: 'SAR' },
    cost_price: 85.0,
    quantity: 4,
    unlimited_quantity: false,
    status: 'sale',
    is_available: true,
    url: 'https://example.com/product',
    images: [
      { url: 'https://cdn.example/other.jpg', main: false },
      { url: 'https://cdn.example/main.jpg', main: true },
    ],
  };

  it('reads the documented example', () => {
    expect(parseSallaProduct(doc)).toMatchObject({
      id: '1115785385',
      price: 100.33,
      salePrice: 90.5,
      costPrice: 85,
      quantity: 4,
      statusSlug: 'sale',
      imageUrl: 'https://cdn.example/main.jpg',
    });
  });

  it('ignores `quantity` when the product is unlimited (it can be 0 or stale)', () => {
    const p = parseSallaProduct({ ...doc, unlimited_quantity: true, quantity: 0 });
    expect(p!.quantity).toBeNull();
  });

  it('falls back to the first image when none is flagged main', () => {
    const p = parseSallaProduct({
      ...doc,
      images: [{ url: 'https://cdn.example/a.jpg' }, { url: 'https://cdn.example/b.jpg' }],
    });
    expect(p!.imageUrl).toBe('https://cdn.example/a.jpg');
  });
});

describe('SallaApiClient pagination is never silently truncated', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  const prod = (id: number) => ({ id, name: `P${id}`, price: { amount: 10 } });
  const respond = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  const mock = (...pages: unknown[]) => {
    const f = jest.fn();
    for (const p of pages) f.mockResolvedValueOnce(respond(p));
    f.mockResolvedValue(respond({ data: [] }));
    global.fetch = f as unknown as typeof fetch;
    return f;
  };

  it('stops on the documented {count,current,next:null} shape', async () => {
    const f = mock({ data: [prod(1), prod(2)], pagination: { count: 2, current: 1, next: null } });
    const out = await new SallaApiClient().listProducts('t');
    expect(out.products).toHaveLength(2);
    expect(out.complete).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('follows links.next when totalPages is absent', async () => {
    const f = mock(
      { data: [prod(1)], pagination: { links: { next: 'https://api/p?page=2' } } },
      { data: [prod(2)], pagination: { links: {} } },
    );
    const out = await new SallaApiClient().listProducts('t');
    expect(out.products.map((p) => p.id)).toEqual(['1', '2']);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('keeps going until an empty page when there is no pagination metadata at all', async () => {
    const f = mock({ data: [prod(1), prod(2)] }, { data: [prod(3)] });
    const out = await new SallaApiClient().listProducts('t');
    expect(out.products.map((p) => p.id)).toEqual(['1', '2', '3']);
    expect(out.complete).toBe(true);
    expect(f).toHaveBeenCalledTimes(3); // page 3 is the empty terminator
  });

  it('trusts totalPages when present (orders too)', async () => {
    const order = (id: number) => ({
      id,
      date: { date: '2026-10-01 10:00:00.000000' },
      total: { amount: 5, currency: 'SAR' },
      items: [{ quantity: 1 }],
    });
    const f = mock(
      { data: [order(1)], pagination: { currentPage: 1, totalPages: 2 } },
      { data: [order(2)], pagination: { currentPage: 2, totalPages: 2 } },
    );
    const orders = await new SallaApiClient().listOrders('t', {
      fromDate: '2026-10-01',
      toDate: '2026-10-02',
    });
    expect(orders.map((o) => o.id)).toEqual(['1', '2']);
    expect(f).toHaveBeenCalledTimes(2);
  });
});
