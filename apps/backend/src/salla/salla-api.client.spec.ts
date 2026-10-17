import { describeShape, parseSallaProduct, SallaApiClient } from './salla-api.client';

const product = (id: string) => ({ id, name: `P ${id}`, price: { amount: 10, currency: 'SAR' } });
const order = (id: string) => ({ id, date: { date: '2026-10-01 10:00:00' } });

/** Serves one scripted response per `page` query value; records every requested page. */
function mockPages(pages: (page: number) => unknown) {
  const requested: number[] = [];
  global.fetch = jest.fn(async (input: string | URL | Request) => {
    const page = Number(new URL(String(input)).searchParams.get('page'));
    requested.push(page);
    return new Response(JSON.stringify(pages(page)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return requested;
}

describe('SallaApiClient pagination', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('keeps paging when totalPages is null and links.next is set', async () => {
    const requested = mockPages((page) =>
      page === 1
        ? {
            data: [product('1')],
            pagination: { totalPages: null, links: { next: 'https://x/page=2' } },
          }
        : { data: [], pagination: { totalPages: null, links: { next: null } } },
    );

    const res = await new SallaApiClient().listProducts('tok');

    expect(requested).toEqual([1, 2]);
    expect(res).toEqual({ products: expect.any(Array), complete: true, skipped: 0 });
    expect(res.products).toHaveLength(1);
  });

  it('stops orders at a page that adds no new ids, and never counts an order twice', async () => {
    const requested = mockPages(() => ({ data: [order('1'), order('2')] }));

    const orders = await new SallaApiClient().listOrders('tok', {
      fromDate: '2026-10-01',
      toDate: '2026-10-02',
    });

    expect(requested).toEqual([1, 2]);
    expect(orders.map((o) => o.id)).toEqual(['1', '2']);
  });

  it('caps a listing with no pagination metadata and reports it incomplete', async () => {
    // Every page is new, but nothing says where the listing ends.
    const requested = mockPages((page) => ({
      data: [product(`${page}`)],
    }));

    const res = await new SallaApiClient().listProducts('tok');

    expect(requested).toHaveLength(20);
    expect(res.complete).toBe(false);
  });

  it('reports a products listing incomplete when a page only repeats earlier entries', async () => {
    mockPages(() => ({ data: [product('1')] }));

    const res = await new SallaApiClient().listProducts('tok');

    expect(res.complete).toBe(false);
    expect(res.products).toHaveLength(1);
  });
});

describe('SallaApiClient products pagination shape', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('pages a products listing that uses {count, current, next} instead of currentPage/totalPages', async () => {
    const requested = mockPages((page) =>
      page === 1
        ? { data: [product('1')], pagination: { count: 2, current: 1, next: 'https://x/page=2' } }
        : { data: [product('2')], pagination: { count: 2, current: 2, next: null } },
    );

    const res = await new SallaApiClient().listProducts('tok');

    expect(requested).toEqual([1, 2]);
    expect(res.products.map((p) => p.id)).toEqual(['1', '2']);
    expect(res.complete).toBe(true);
  });
});

describe('describeShape', () => {
  it('reports key names and value types, never the values', () => {
    const shape = describeShape({
      data: [{ id: 'secret-id', name: 'Customer Name' }],
      pagination: { count: 1, next: 'https://x?token=abc' },
    });

    expect(shape).toBe(
      '{data:array(1) of object, pagination:{count:number, next:string}}',
    );
    expect(shape).not.toContain('secret-id');
    expect(shape).not.toContain('Customer');
    expect(shape).not.toContain('token=abc');
  });
});

describe('parseSallaProduct image fallback', () => {
  it('uses the first image that has a url when no image is flagged main', () => {
    const p = parseSallaProduct({
      ...product('1'),
      images: [{ url: null }, { url: 'https://cdn/x.jpg' }],
    });
    expect(p?.imageUrl).toBe('https://cdn/x.jpg');
  });
});
