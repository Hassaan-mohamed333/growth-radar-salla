import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { URL_REJECTION_TEXT } from '../scraper/url-guard';
import { Prisma } from '@growth-radar/database';
import type { PrismaService } from '../prisma/prisma.service';
import { CompetitorsService } from './competitors.service';

const ctx = { tenantId: 'tenant-1', storeId: 'store-1' };

const dbRow = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  name: 'Rival',
  domain: 'rival.example.com',
  productUrl: 'https://rival.example.com/p/1',
  productId: null,
  currency: 'SAR',
  isActive: true,
  lastPrice: null,
  lastCheckedAt: null,
  scrapeFailures: 0,
  lastScrapeError: null,
  nextScrapeAt: null,
  ...over,
});

function setup(opts: { product?: { id: string; currency: string } | null; existing?: unknown } = {}) {
  const create = jest.fn(async (args: { data: Record<string, unknown> }) =>
    dbRow({ ...args.data, id: 'new' }),
  );
  const update = jest.fn(async (args: { data: Record<string, unknown> }) => dbRow(args.data));
  const prisma = {
    product: {
      findFirst: jest.fn().mockResolvedValue(opts.product === undefined ? { id: 'p1', currency: 'SAR' } : opts.product),
    },
    competitor: {
      create,
      update,
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.existing === undefined ? { productUrl: 'https://rival.example.com/p/1' } : opts.existing),
    },
  } as unknown as PrismaService;
  return { service: new CompetitorsService(prisma), prisma, create, update };
}

describe('CompetitorsService.create', () => {
  it('derives domain from productUrl and scopes the row to the session', async () => {
    const { service, create } = setup();

    const dto = await service.create(ctx, {
      name: 'Rival',
      productUrl: 'https://WWW.Rival.example.com/p/1',
    });

    expect(create.mock.calls[0]![0].data).toMatchObject({
      tenantId: 'tenant-1',
      storeId: 'store-1',
      domain: 'rival.example.com',
      productUrl: 'https://www.rival.example.com/p/1',
      currency: 'SAR',
    });
    expect(dto.id).toBe('new');
  });

  it('accepts a store-level competitor with only a domain', async () => {
    const { service, create } = setup();
    await service.create(ctx, { name: 'Rival', domain: 'Rival.example.com' });
    expect(create.mock.calls[0]![0].data).toMatchObject({
      domain: 'rival.example.com',
      productUrl: null,
    });
  });

  it('rejects internal URLs without echoing them', async () => {
    const { service } = setup();
    const err = await service
      .create(ctx, { name: 'x', productUrl: 'http://169.254.169.254/latest' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify((err as BadRequestException).getResponse())).not.toContain('169.254');
  });

  it('tells the merchant why a URL was refused, in fixed text', async () => {
    const { service } = setup();
    const err = await service
      .create(ctx, { name: 'x', productUrl: 'https://rival.example.com:8443/p/1' })
      .catch((e: unknown) => e);
    expect((err as BadRequestException).message).toBe(URL_REJECTION_TEXT.unsupported_port);
  });

  it('gives the merchant the local-address reason without echoing the URL', async () => {
    const { service } = setup();
    const err = await service
      .create(ctx, { name: 'x', productUrl: 'http://localhost/secret-path' })
      .catch((e: unknown) => e);
    expect((err as BadRequestException).message).toBe(URL_REJECTION_TEXT.internal_host);
    expect((err as BadRequestException).message).not.toContain('secret-path');
  });

  it('rejects a domain that disagrees with the URL', async () => {
    const { service } = setup();
    await expect(
      service.create(ctx, {
        name: 'x',
        domain: 'other.example.com',
        productUrl: 'https://rival.example.com/p/1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires the linked product to belong to the store', async () => {
    const { service, prisma } = setup({ product: null });
    await expect(
      service.create(ctx, { name: 'x', domain: 'rival.example.com', productId: 'other-store-product' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.product.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'other-store-product', storeId: 'store-1' } }),
    );
  });

  it('maps a unique violation to 409', async () => {
    const { service, create } = setup();
    create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );
    await expect(
      service.create(ctx, { name: 'x', productUrl: 'https://rival.example.com/p/1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('CompetitorsService.linkToProduct', () => {
  it('creates a competitor linked to the product, inheriting its currency', async () => {
    const { service, create } = setup({ product: { id: 'p1', currency: 'USD' } });

    await service.linkToProduct(ctx, 'p1', { productUrl: 'https://rival.example.com/p/1' });

    expect(create.mock.calls[0]![0].data).toMatchObject({
      productId: 'p1',
      name: 'rival.example.com',
      currency: 'USD',
      storeId: 'store-1',
    });
  });

  it('404s for a product outside the store', async () => {
    const { service } = setup({ product: null });
    await expect(
      service.linkToProduct(ctx, 'nope', { productUrl: 'https://rival.example.com/p/1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CompetitorsService.update', () => {
  it('404s for a competitor in another store', async () => {
    const { service } = setup({ existing: null });
    await expect(service.update('store-1', 'c1', { name: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('resets price and scrape state when the listing URL changes', async () => {
    const { service, update } = setup();

    await service.update('store-1', 'c1', { productUrl: 'https://rival.example.com/p/2' });

    expect(update.mock.calls[0]![0].data).toMatchObject({
      productUrl: 'https://rival.example.com/p/2',
      lastPrice: null,
      scrapeFailures: 0,
      lastScrapeError: null,
      nextScrapeAt: null,
    });
  });

  it('keeps scrape state for non-URL edits', async () => {
    const { service, update } = setup();

    await service.update('store-1', 'c1', { name: 'Renamed', isActive: false });

    const data = update.mock.calls[0]![0].data;
    expect(data).toEqual({ name: 'Renamed', isActive: false });
  });

  it('clears the URL when set to null', async () => {
    const { service, update } = setup();
    await service.update('store-1', 'c1', { productUrl: null });
    expect(update.mock.calls[0]![0].data.productUrl).toBeNull();
  });
});

describe('CompetitorsService.update - product link', () => {
  it('re-links to a product of the same store', async () => {
    const { service, update, prisma } = setup({ product: { id: 'p2', currency: 'SAR' } });

    await service.update('store-1', 'c1', { productId: 'p2' });

    expect(prisma.product.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p2', storeId: 'store-1' } }),
    );
    expect(update.mock.calls[0]![0].data.product).toEqual({ connect: { id: 'p2' } });
  });

  it('detaches with null without looking up a product', async () => {
    const { service, update, prisma } = setup();
    await service.update('store-1', 'c1', { productId: null });
    expect(update.mock.calls[0]![0].data.product).toEqual({ disconnect: true });
    expect(prisma.product.findFirst).not.toHaveBeenCalled();
  });

  it('404s when the product belongs to another store', async () => {
    const { service, update } = setup({ product: null });
    await expect(service.update('store-1', 'c1', { productId: 'foreign' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(update).not.toHaveBeenCalled();
  });
});

describe('CompetitorsService.remove', () => {
  it('deletes only a competitor of the session store', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const service = new CompetitorsService({ competitor: { deleteMany } } as unknown as PrismaService);

    await expect(service.remove('store-1', 'c1')).resolves.toBeUndefined();
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: 'c1', storeId: 'store-1' } });
  });

  it('404s when no competitor matches in this store', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
    const service = new CompetitorsService({ competitor: { deleteMany } } as unknown as PrismaService);

    await expect(service.remove('store-2', 'c1')).rejects.toThrow(NotFoundException);
  });
});

describe('CompetitorsService.list', () => {
  function listSetup(rows: unknown[] = []) {
    const findMany = jest.fn().mockResolvedValue(rows);
    const count = jest.fn().mockResolvedValue(rows.length);
    const prisma = { competitor: { findMany, count } } as unknown as PrismaService;
    return { service: new CompetitorsService(prisma), findMany, count };
  }

  it('is scoped to the store, paginated and searchable', async () => {
    const { service, findMany, count } = listSetup();

    await service.list('store-1', { page: 2, pageSize: 10, search: 'riv' });

    const args = findMany.mock.calls[0]![0];
    expect(args.where.storeId).toBe('store-1');
    expect(args.where.OR).toHaveLength(2);
    expect(args.skip).toBe(10);
    expect(args.take).toBe(10);
    expect(count.mock.calls[0]![0].where.storeId).toBe('store-1');
  });

  it('adds the linked product to each DTO', async () => {
    const { service } = listSetup([
      dbRow({ id: 'c1', product: { id: 'p1', name: 'Beans' } }),
      dbRow({ id: 'c2', product: null }),
    ]);

    const out = await service.list('store-1', { page: 1, pageSize: 25 });

    expect(out.items[0]).toMatchObject({ id: 'c1', product: { id: 'p1', name: 'Beans' } });
    expect(out.items[1]!.product).toBeNull();
    expect(out.total).toBe(2);
  });
});
