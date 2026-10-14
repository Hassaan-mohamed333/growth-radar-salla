import type { PrismaService } from '../../src/prisma/prisma.service';
import { ProductSyncService } from '../../src/products/product-sync.service';
import { ProductWebhookHandler } from '../../src/products/product-webhook.handler';
import type { SallaApiClient, SallaProduct } from '../../src/salla/salla-api.client';
import type { SallaConnectionsService } from '../../src/salla/salla-connections.service';
import { connect, resetDb, seedProduct, seedStore } from './db';

const sp = (id: string, over: Partial<SallaProduct> = {}): SallaProduct => ({
  id,
  sku: `SKU-${id}`,
  name: `Product ${id}`,
  price: 100,
  salePrice: null,
  costPrice: null,
  currency: null,
  quantity: 10,
  statusSlug: 'sale',
  url: `https://store.example/p/${id}`,
  imageUrl: null,
  ...over,
});

describe('catalogue sync against real PostgreSQL', () => {
  let prisma: PrismaService;
  let listProducts: jest.Mock;
  let service: ProductSyncService;

  beforeAll(async () => {
    prisma = await connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await resetDb(prisma);
    listProducts = jest.fn();
    service = new ProductSyncService(
      prisma,
      { getValidAccessToken: async () => 'tok' } as unknown as SallaConnectionsService,
      { listProducts } as unknown as SallaApiClient,
    );
  });

  const listing = (products: SallaProduct[], complete = true) =>
    listProducts.mockResolvedValue({ products, complete, skipped: 0 });

  it('inserts the catalogue with tenant/store ids, normalised money and status', async () => {
    const s = await seedStore(prisma, { currency: 'SAR' });
    listing([
      sp('1', { price: 120.5, salePrice: 99.99, costPrice: 60 }),
      sp('2', { quantity: 0 }),
      sp('3', { statusSlug: 'hidden', currency: 'USD' }),
    ]);

    const res = await service.syncStore(s.storeId);

    expect(res).toEqual({ fetched: 3, skipped: 0, removed: 0 });
    const rows = await prisma.product.findMany({ where: { storeId: s.storeId }, orderBy: { sallaProductId: 'asc' } });
    expect(rows.map((r) => r.status)).toEqual(['SALE', 'OUT', 'HIDDEN']);
    expect(rows[0]).toMatchObject({ tenantId: s.tenantId, storeId: s.storeId, currency: 'SAR' });
    expect(rows[0]!.price.toFixed(2)).toBe('120.50');
    expect(rows[0]!.salePrice?.toFixed(2)).toBe('99.99');
    expect(rows[0]!.costPrice?.toFixed(2)).toBe('60.00');
    expect(rows[0]!.syncedAt).not.toBeNull();
    expect(rows[2]!.currency).toBe('USD');
  });

  it('is idempotent and updates in place (no duplicates, ids stay stable)', async () => {
    const s = await seedStore(prisma);
    listing([sp('1', { price: 100 })]);
    await service.syncStore(s.storeId);
    const before = await prisma.product.findFirstOrThrow({ where: { storeId: s.storeId } });

    listing([sp('1', { price: 80, name: 'Renamed' })]);
    await service.syncStore(s.storeId);
    await service.syncStore(s.storeId);

    const rows = await prisma.product.findMany({ where: { storeId: s.storeId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: before.id, name: 'Renamed' });
    expect(rows[0]!.price.toFixed(2)).toBe('80.00');
  });

  it('soft-deletes products that left the catalogue and revives them if they return', async () => {
    const s = await seedStore(prisma);
    listing([sp('1'), sp('2')]);
    await service.syncStore(s.storeId);

    listing([sp('1')]);
    expect((await service.syncStore(s.storeId)).removed).toBe(1);
    const gone = await prisma.product.findFirstOrThrow({
      where: { storeId: s.storeId, sallaProductId: '2' },
    });
    expect(gone.status).toBe('DELETED');

    listing([sp('1'), sp('2')]);
    await service.syncStore(s.storeId);
    const back = await prisma.product.findFirstOrThrow({
      where: { storeId: s.storeId, sallaProductId: '2' },
    });
    expect(back).toMatchObject({ id: gone.id, status: 'SALE' });
  });

  it('never deletes on a truncated listing or an empty one', async () => {
    const s = await seedStore(prisma);
    listing([sp('1'), sp('2')]);
    await service.syncStore(s.storeId);

    listing([sp('1')], false);
    expect((await service.syncStore(s.storeId)).removed).toBe(0);
    listing([]);
    expect((await service.syncStore(s.storeId)).removed).toBe(0);

    expect(await prisma.product.count({ where: { storeId: s.storeId, status: 'DELETED' } })).toBe(0);
  });

  it('refuses to soft-delete most of a large catalogue from a single listing', async () => {
    const s = await seedStore(prisma);
    const all = Array.from({ length: 40 }, (_, i) => sp(String(i + 1)));
    listing(all);
    await service.syncStore(s.storeId);

    // Only 10 of 40 come back: looks like a partial/misparsed listing, not 30 deletions.
    listing(all.slice(0, 10));
    expect((await service.syncStore(s.storeId)).removed).toBe(0);
    expect(await prisma.product.count({ where: { storeId: s.storeId, status: 'DELETED' } })).toBe(0);

    // 10 of 40 missing (25%) is plausible: those are removed.
    listing(all.slice(0, 30));
    expect((await service.syncStore(s.storeId)).removed).toBe(10);
  });

  it('handles a catalogue larger than one transaction chunk', async () => {
    const s = await seedStore(prisma);
    listing(Array.from({ length: 250 }, (_, i) => sp(String(i + 1))));

    const res = await service.syncStore(s.storeId);

    expect(res.fetched).toBe(250);
    expect(await prisma.product.count({ where: { storeId: s.storeId } })).toBe(250);
  });

  it('keeps two stores with the same Salla product id fully separate', async () => {
    const a = await seedStore(prisma);
    const b = await seedStore(prisma);
    listing([sp('42', { price: 10 })]);
    await service.syncStore(a.storeId);
    listing([sp('42', { price: 20 })]);
    await service.syncStore(b.storeId);

    const pa = await prisma.product.findFirstOrThrow({ where: { storeId: a.storeId } });
    const pb = await prisma.product.findFirstOrThrow({ where: { storeId: b.storeId } });
    expect(pa.price.toFixed(2)).toBe('10.00');
    expect(pb.price.toFixed(2)).toBe('20.00');
    expect(pa.id).not.toBe(pb.id);
  });

  it('does not touch an uninstalled store', async () => {
    const s = await seedStore(prisma);
    await prisma.store.update({ where: { id: s.storeId }, data: { status: 'UNINSTALLED' } });
    listing([sp('1')]);

    expect(await service.syncStore(s.storeId)).toEqual({ fetched: 0, skipped: 0, removed: 0 });
    expect(await prisma.product.count()).toBe(0);
  });

  it('writes nothing once the store is uninstalled while Salla is still being read', async () => {
    const s = await seedStore(prisma);
    listProducts.mockImplementation(async () => {
      // The uninstall webhook lands during the slow Salla call.
      await prisma.store.update({ where: { id: s.storeId }, data: { status: 'UNINSTALLED' } });
      return { products: [sp('1'), sp('2')], complete: true, skipped: 0 };
    });

    const res = await service.syncStore(s.storeId);

    expect(res.removed).toBe(0);
    expect(await prisma.product.count({ where: { storeId: s.storeId } })).toBe(0);
  });

  describe('product webhooks', () => {
    it('upserts from the payload and soft-deletes on product.deleted, resolving the store by merchant', async () => {
      const s = await seedStore(prisma);
      const store = await prisma.store.findUniqueOrThrow({ where: { id: s.storeId } });
      const handler = new ProductWebhookHandler(prisma, service);

      await handler.handle('product.created', store.sallaMerchantId, {
        id: 777,
        name: 'Fresh',
        price: { amount: 55, currency: 'SAR' },
        status: 'sale',
        quantity: 3,
      });
      let p = await prisma.product.findFirstOrThrow({ where: { storeId: s.storeId, sallaProductId: '777' } });
      expect(p).toMatchObject({ name: 'Fresh', status: 'SALE' });
      expect(listProducts).not.toHaveBeenCalled();

      await handler.handle('product.deleted', store.sallaMerchantId, { id: 777 });
      p = await prisma.product.findFirstOrThrow({ where: { id: p.id } });
      expect(p.status).toBe('DELETED');
    });

    it("ignores a merchant it does not know and never writes to another store's catalogue", async () => {
      const mine = await seedStore(prisma);
      const other = await seedStore(prisma);
      await seedProduct(prisma, other, { sallaProductId: '777', name: 'Theirs' });
      const handler = new ProductWebhookHandler(prisma, service);

      await handler.handle('product.updated', 'no-such-merchant', {
        id: 777,
        name: 'Hijack',
        price: { amount: 1 },
      });

      const theirs = await prisma.product.findFirstOrThrow({ where: { storeId: other.storeId } });
      expect(theirs.name).toBe('Theirs');
      expect(await prisma.product.count({ where: { storeId: mine.storeId } })).toBe(0);
    });
  });
});
