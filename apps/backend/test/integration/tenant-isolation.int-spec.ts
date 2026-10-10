import { NotFoundException } from '@nestjs/common';
import { CompetitorsService } from '../../src/competitors/competitors.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { ProductsService } from '../../src/products/products.service';
import { RecommendationsService } from '../../src/recommendations/recommendations.service';
import { connect, resetDb, seedCompetitor, seedProduct, seedStore, type SeededStore } from './db';

/**
 * There is no Postgres RLS yet: isolation is enforced by scoping every query with the
 * session's storeId. These tests prove that scoping holds on a real database.
 */
describe('tenant isolation (query-level scoping)', () => {
  let prisma: PrismaService;
  let products: ProductsService;
  let competitors: CompetitorsService;
  let recs: RecommendationsService;
  let a: SeededStore;
  let b: SeededStore;
  let bProductId: string;
  let bCompetitorId: string;
  let bRecId: string;

  beforeAll(async () => {
    prisma = await connect();
    products = new ProductsService(prisma);
    competitors = new CompetitorsService(prisma);
    recs = new RecommendationsService(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    a = await seedStore(prisma);
    b = await seedStore(prisma);
    await seedProduct(prisma, a, { name: 'Coffee Beans' });
    const bp = await seedProduct(prisma, b, { name: 'Coffee Grinder' });
    bProductId = bp.id;
    const bc = await seedCompetitor(prisma, b, { productId: bp.id, lastPrice: 5 });
    bCompetitorId = bc.id;
    const br = await prisma.decisionRecommendation.create({
      data: {
        tenantId: b.tenantId,
        storeId: b.storeId,
        productId: bp.id,
        type: 'COMPETITOR_ALERT',
        title: 'B only',
        rationale: 'r',
        payload: {},
      },
    });
    bRecId = br.id;
  });

  it('lists only the caller\'s own products, case-insensitively searchable', async () => {
    const all = await products.list(a.storeId, { page: 1, pageSize: 50 });
    expect(all.items.map((p) => p.name)).toEqual(['Coffee Beans']);

    const hit = await products.list(a.storeId, { page: 1, pageSize: 50, search: 'COFFEE' });
    expect(hit.total).toBe(1);
    const miss = await products.list(a.storeId, { page: 1, pageSize: 50, search: 'grinder' });
    expect(miss.total).toBe(0);
  });

  it('lists only own competitors and recommendations', async () => {
    expect((await competitors.list(a.storeId, { page: 1, pageSize: 50 })).total).toBe(0);
    expect((await competitors.list(b.storeId, { page: 1, pageSize: 50 })).total).toBe(1);
    expect((await recs.list(a.storeId, { status: 'ALL', page: 1, pageSize: 50 })).total).toBe(0);
    expect((await recs.list(b.storeId, { status: 'ALL', page: 1, pageSize: 50 })).total).toBe(1);
  });

  it("cannot link, edit or re-link another store's rows", async () => {
    const aCompetitor = await seedCompetitor(prisma, a);

    await expect(
      competitors.linkToProduct(a, bProductId, { productUrl: 'https://rival.example.com/p/9' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(competitors.update(a.storeId, bCompetitorId, { name: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      competitors.update(a.storeId, aCompetitor.id, { productId: bProductId }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const untouched = await prisma.competitor.findUniqueOrThrow({ where: { id: bCompetitorId } });
    expect(untouched.name).not.toBe('x');
  });

  it("cannot decide another store's recommendation", async () => {
    await expect(recs.decide(a.storeId, bRecId, 'ACCEPTED')).rejects.toBeInstanceOf(NotFoundException);

    const row = await prisma.decisionRecommendation.findUniqueOrThrow({ where: { id: bRecId } });
    expect(row.status).toBe('PENDING');
    expect(row.decidedAt).toBeNull();
  });

  it('enforces uniqueness per store, not globally', async () => {
    const dupUrl = 'https://shared-rival.example.com/p/1';
    await competitors.create(a, { name: 'R', productUrl: dupUrl });
    await expect(competitors.create(b, { name: 'R', productUrl: dupUrl })).resolves.toBeDefined();
    await expect(competitors.create(a, { name: 'R', productUrl: dupUrl })).rejects.toMatchObject({
      status: 409,
    });
  });
});
