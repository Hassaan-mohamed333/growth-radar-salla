import type { PrismaService } from '../prisma/prisma.service';
import type { SallaApiClient, SallaProduct } from '../salla/salla-api.client';
import type { SallaConnectionsService } from '../salla/salla-connections.service';
import { ProductSyncService } from './product-sync.service';

const sp = (id: string, over: Partial<SallaProduct> = {}): SallaProduct => ({
  id,
  sku: null,
  name: `Product ${id}`,
  price: 100,
  salePrice: null,
  costPrice: null,
  currency: null,
  quantity: null,
  statusSlug: 'sale',
  url: null,
  imageUrl: null,
  ...over,
});

function setup(opts: {
  store?: { tenantId: string; currency: string; status: string } | null;
  listing?: { products: SallaProduct[]; complete: boolean; skipped: number };
  known?: string[];
}) {
  const upsert = jest.fn((args: unknown) => args);
  const updateMany = jest.fn().mockResolvedValue({ count: 0 });
  const prisma = {
    store: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          opts.store === undefined
            ? { tenantId: 't1', currency: 'SAR', status: 'ACTIVE' }
            : opts.store,
        ),
    },
    product: {
      upsert,
      updateMany,
      findMany: jest
        .fn()
        .mockResolvedValue((opts.known ?? []).map((sallaProductId) => ({ sallaProductId }))),
    },
    $transaction: jest.fn(async (ops: unknown[]) => ops),
  } as unknown as PrismaService;
  const connections = {
    getValidAccessToken: jest.fn().mockResolvedValue('tok'),
  } as unknown as SallaConnectionsService;
  const api = {
    listProducts: jest
      .fn()
      .mockResolvedValue(opts.listing ?? { products: [], complete: true, skipped: 0 }),
  } as unknown as SallaApiClient;
  return { service: new ProductSyncService(prisma, connections, api), prisma, upsert, updateMany, api };
}

describe('ProductSyncService.syncStore', () => {
  it('upserts each product scoped to the store and tenant', async () => {
    const { service, upsert } = setup({
      listing: { products: [sp('1'), sp('2', { salePrice: 80 })], complete: true, skipped: 0 },
      known: ['1', '2'],
    });

    const res = await service.syncStore('s1');

    expect(res).toEqual({ fetched: 2, skipped: 0, removed: 0 });
    expect(upsert).toHaveBeenCalledTimes(2);
    const arg = upsert.mock.calls[1]![0] as {
      where: { storeId_sallaProductId: { storeId: string; sallaProductId: string } };
      create: Record<string, unknown>;
    };
    expect(arg.where.storeId_sallaProductId).toEqual({ storeId: 's1', sallaProductId: '2' });
    expect(arg.create).toMatchObject({
      tenantId: 't1',
      storeId: 's1',
      sallaProductId: '2',
      price: 100,
      salePrice: 80,
      currency: 'SAR',
      status: 'SALE',
    });
  });

  it('soft-deletes rows missing from a complete listing', async () => {
    const { service, updateMany } = setup({
      listing: { products: [sp('1')], complete: true, skipped: 0 },
      known: ['1', '9'],
    });
    updateMany.mockResolvedValue({ count: 1 });

    const res = await service.syncStore('s1');

    expect(res.removed).toBe(1);
    expect(updateMany.mock.calls[0]![0]).toMatchObject({
      where: { storeId: 's1', sallaProductId: { in: ['9'] } },
      data: { status: 'DELETED' },
    });
  });

  it('never deletes anything when the listing was truncated', async () => {
    const { service, updateMany } = setup({
      listing: { products: [sp('1')], complete: false, skipped: 0 },
      known: ['1', '9'],
    });
    expect((await service.syncStore('s1')).removed).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('keeps existing rows when Salla returns an empty catalogue', async () => {
    const { service, updateMany } = setup({
      listing: { products: [], complete: true, skipped: 0 },
      known: ['1', '2'],
    });
    expect((await service.syncStore('s1')).removed).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('does nothing for an unknown or inactive store', async () => {
    const missing = setup({ store: null });
    expect(await missing.service.syncStore('s1')).toEqual({ fetched: 0, skipped: 0, removed: 0 });
    expect(missing.api.listProducts).not.toHaveBeenCalled();

    const inactive = setup({ store: { tenantId: 't1', currency: 'SAR', status: 'UNINSTALLED' } });
    await inactive.service.syncStore('s1');
    expect(inactive.api.listProducts).not.toHaveBeenCalled();
  });
});

describe('ProductSyncService.markDeleted', () => {
  it('is scoped to the store and idempotent', async () => {
    const { service, updateMany } = setup({});
    await service.markDeleted('s1', '77');
    expect(updateMany.mock.calls[0]![0]).toMatchObject({
      where: { storeId: 's1', sallaProductId: '77', status: { not: 'DELETED' } },
    });
  });
});
