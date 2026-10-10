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
