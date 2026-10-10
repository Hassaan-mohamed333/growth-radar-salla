import { Prisma } from '@growth-radar/database';
import type { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from './products.service';

const D = (n: number | string) => new Prisma.Decimal(n);

const row = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  sallaProductId: '1001',
  sku: 'SKU',
  name: 'Beans',
  price: D(100),
  salePrice: null,
  currency: 'SAR',
  quantity: 4,
  status: 'SALE',
  url: null,
  imageUrl: null,
  competitors: [] as Array<{ lastPrice: Prisma.Decimal | null }>,
  ...over,
});

function setup(rows: unknown[], total = rows.length) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const count = jest.fn().mockResolvedValue(total);
  const prisma = { product: { findMany, count } } as unknown as PrismaService;
  return { service: new ProductsService(prisma), findMany, count };
}

describe('ProductsService.list', () => {
  it('always scopes to the store and hides deleted products', async () => {
    const { service, findMany, count } = setup([]);
    await service.list('s1', { page: 1, pageSize: 25 });

    expect(findMany.mock.calls[0]![0].where).toEqual({
      storeId: 's1',
      status: { not: 'DELETED' },
    });
    expect(count.mock.calls[0]![0].where.storeId).toBe('s1');
  });

  it('paginates and applies search / monitored filters', async () => {
    const { service, findMany } = setup([], 0);
    await service.list('s1', { page: 3, pageSize: 10, search: 'bean', monitored: true });

    const args = findMany.mock.calls[0]![0];
    expect(args.skip).toBe(20);
    expect(args.take).toBe(10);
    expect(args.where.OR).toHaveLength(2);
    expect(args.where.competitors).toEqual({ some: { isActive: true } });
  });

  it('summarises competitor pricing against the effective price', async () => {
    const { service } = setup([
      row({ competitors: [{ lastPrice: D(95) }, { lastPrice: D(110) }, { lastPrice: null }] }),
      row({ id: 'p2', salePrice: D(80), competitors: [{ lastPrice: D(90) }] }),
      row({ id: 'p3' }),
    ]);

    const out = await service.list('s1', { page: 1, pageSize: 25 });

    expect(out.items[0]).toMatchObject({
      price: '100.00',
      salePrice: null,
      competitors: { active: 3, lowestPrice: '95.00', undercut: true },
    });
    // Our sale price (80) is already below the competitor (90).
    expect(out.items[1]!.competitors).toMatchObject({ lowestPrice: '90.00', undercut: false });
    expect(out.items[2]!.competitors).toEqual({ active: 0, lowestPrice: null, undercut: false });
  });
});
