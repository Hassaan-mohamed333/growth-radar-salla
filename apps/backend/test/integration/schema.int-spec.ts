import type { PrismaService } from '../../src/prisma/prisma.service';
import { connect, resetDb, seedCompetitor, seedProduct, seedStore } from './db';

describe('database schema (real PostgreSQL + checked-in migrations)', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = await connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(() => resetDb(prisma));

  it('has every table the Prisma client expects', async () => {
    const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
    const tables = new Set(rows.map((r) => r.table_name));

    for (const t of [
      'tenants',
      'stores',
      'users',
      'encrypted_salla_connections',
      'products',
      'competitors',
      'competitor_price_history',
      'sales_snapshots',
      'data_confidence_audits',
      'decision_recommendations',
    ]) {
      expect(tables).toContain(t);
    }
  });

  it('applies the competitor scrape-state migration (columns + scheduling index)', async () => {
    const cols = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'competitors' AND column_name IN
        ('scrape_failures', 'last_scrape_error', 'next_scrape_at')`;
    expect(cols).toHaveLength(3);

    const idx = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'competitors' AND indexname = 'competitors_is_active_next_scrape_at_idx'`;
    expect(idx).toHaveLength(1);
  });

  it('round-trips a store -> product -> competitor graph through the client', async () => {
    const s = await seedStore(prisma);
    const p = await seedProduct(prisma, s, { price: 99.5 });
    const c = await seedCompetitor(prisma, s, { productId: p.id, lastPrice: 80.25 });

    const found = await prisma.competitor.findUniqueOrThrow({
      where: { id: c.id },
      include: { product: true },
    });
    expect(found.product?.price.toFixed(2)).toBe('99.50');
    expect(found.lastPrice?.toFixed(2)).toBe('80.25');
  });

  it('cascades tenant deletion through the whole graph', async () => {
    const s = await seedStore(prisma);
    const p = await seedProduct(prisma, s);
    await seedCompetitor(prisma, s, { productId: p.id });

    await prisma.tenant.delete({ where: { id: s.tenantId } });

    expect(await prisma.product.count()).toBe(0);
    expect(await prisma.competitor.count()).toBe(0);
  });
});
