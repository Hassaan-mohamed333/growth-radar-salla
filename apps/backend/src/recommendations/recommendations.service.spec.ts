import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@growth-radar/database';
import type { PrismaService } from '../prisma/prisma.service';
import { RecommendationsService } from './recommendations.service';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  type: 'PRICE_ADJUSTMENT',
  status: 'PENDING',
  title: 'خفض السعر',
  rationale: 'سبب',
  payload: { kind: 'match_competitor', currentPrice: 100, suggestedPrice: 90 },
  createdAt: new Date('2026-10-10T00:00:00Z'),
  expiresAt: new Date('2026-10-17T00:00:00Z'),
  decidedAt: null,
  product: { id: 'p1', name: 'Beans', sku: null },
  confidenceAudit: { confidenceScore: new Prisma.Decimal('0.875') },
  ...over,
});

function setup(opts: { updateCount?: number; exists?: boolean; rows?: unknown[] } = {}) {
  const updateMany = jest.fn().mockResolvedValue({ count: opts.updateCount ?? 1 });
  const findFirst = jest.fn().mockResolvedValue(opts.exists === false ? null : { id: 'r1' });
  const findFirstOrThrow = jest.fn().mockResolvedValue(row({ status: 'ACCEPTED' }));
  const findMany = jest.fn().mockResolvedValue(opts.rows ?? [row()]);
  const count = jest.fn().mockResolvedValue(1);
  const prisma = {
    decisionRecommendation: { updateMany, findFirst, findFirstOrThrow, findMany, count },
  } as unknown as PrismaService;
  return { service: new RecommendationsService(prisma), updateMany, findMany, count };
}

describe('RecommendationsService.list', () => {
  it('scopes to the store, filters by status and maps the DTO', async () => {
    const { service, findMany, count } = setup();

    const out = await service.list('s1', { status: 'PENDING', page: 2, pageSize: 10 });

    expect(findMany.mock.calls[0]![0]).toMatchObject({
      where: { storeId: 's1', status: 'PENDING' },
      skip: 10,
      take: 10,
    });
    expect(count.mock.calls[0]![0].where).toEqual({ storeId: 's1', status: 'PENDING' });
    expect(out.items[0]).toMatchObject({
      id: 'r1',
      confidence: 88,
      product: { id: 'p1', name: 'Beans' },
      details: { kind: 'match_competitor', suggestedPrice: 90 },
    });
  });

  it('does not filter on status for ALL, and tolerates non-engine payloads', async () => {
    const { service, findMany } = setup({ rows: [row({ payload: { note: 'manual' } })] });
    const out = await service.list('s1', { status: 'ALL', page: 1, pageSize: 25 });
    expect(findMany.mock.calls[0]![0].where).toEqual({ storeId: 's1' });
    expect(out.items[0]!.details).toBeNull();
  });
});

describe('RecommendationsService.exportRows', () => {
  it('scopes the export to the store, filters by status and caps the rows', async () => {
    const { service, findMany } = setup();

    await service.exportRows('s1', 'PENDING');

    expect(findMany.mock.calls[0]![0]).toMatchObject({
      where: { storeId: 's1', status: 'PENDING' },
      take: 1000,
    });
  });

  it('exports every status for ALL', async () => {
    const { service, findMany } = setup();

    await service.exportRows('s1', 'ALL');

    expect(findMany.mock.calls[0]![0].where).toEqual({ storeId: 's1' });
  });
});

describe('RecommendationsService.blockers', () => {
  it('counts store products without cost and lists the failing active competitors', async () => {
    const productCount = jest.fn().mockResolvedValue(12);
    const competitorCount = jest.fn().mockResolvedValue(2);
    const competitorFind = jest
      .fn()
      .mockResolvedValue([{ id: 'c1', name: 'Rival', scrapeFailures: 4 }]);
    const prisma = {
      product: { count: productCount },
      competitor: { count: competitorCount, findMany: competitorFind },
    } as unknown as PrismaService;
    const service = new RecommendationsService(prisma);

    const out = await service.blockers('s1');

    expect(productCount).toHaveBeenCalledWith({
      where: {
        storeId: 's1',
        status: 'SALE',
        competitors: { some: { isActive: true, lastPrice: { not: null } } },
        OR: [{ costPrice: null }, { costPrice: { lte: 0 } }],
      },
    });
    const failing = { storeId: 's1', isActive: true, lastScrapeError: { not: null } };
    expect(competitorCount).toHaveBeenCalledWith({ where: failing });
    expect(competitorFind.mock.calls[0]![0]).toMatchObject({ where: failing, take: 5 });
    expect(out).toEqual({
      productsWithoutCost: 12,
      failingCompetitorsCount: 2,
      failingCompetitors: [{ id: 'c1', name: 'Rival', scrapeFailures: 4 }],
    });
  });
});

describe('RecommendationsService.decide', () => {
  it('moves PENDING to the chosen status atomically, scoped by store', async () => {
    const { service, updateMany } = setup();

    const dto = await service.decide('s1', 'r1', 'ACCEPTED');

    expect(updateMany.mock.calls[0]![0]).toMatchObject({
      where: { id: 'r1', storeId: 's1', status: 'PENDING' },
      data: { status: 'ACCEPTED' },
    });
    expect(dto.status).toBe('ACCEPTED');
  });

  it('answers 404 for another store or unknown id, 409 for an already-decided one', async () => {
    await expect(
      setup({ updateCount: 0, exists: false }).service.decide('s1', 'r1', 'DISMISSED'),
    ).rejects.toBeInstanceOf(NotFoundException);

    await expect(
      setup({ updateCount: 0, exists: true }).service.decide('s1', 'r1', 'DISMISSED'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
