import { ConfigService } from '@nestjs/config';
import { Prisma } from '@growth-radar/database';
import type { PrismaService } from '../prisma/prisma.service';
import { RecommendationEngineService } from './recommendation-engine.service';

const NOW = new Date('2026-10-10T12:00:00Z');
const D = (n: number) => new Prisma.Decimal(n);

const productRow = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: 'Beans',
  price: D(100),
  salePrice: null,
  costPrice: D(60),
  currency: 'SAR',
  competitors: [
    {
      id: 'c1',
      name: 'Rival',
      lastPrice: D(90),
      currency: 'SAR',
      lastCheckedAt: new Date(NOW.getTime() - 2 * 3_600_000),
      scrapeFailures: 0,
    },
  ],
  ...over,
});

interface Setup {
  products?: unknown[];
  pending?: unknown[];
  decided?: unknown[];
  store?: unknown;
}

function setup(s: Setup = {}) {
  const auditCreate = jest.fn().mockResolvedValue({ id: 'audit-1' });
  const recCreate = jest.fn().mockResolvedValue({});
  const recUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const findMany = jest.fn(async (args: { where: { status: unknown } }) =>
    args.where.status === 'PENDING' ? (s.pending ?? []) : (s.decided ?? []),
  );

  const tx = {
    dataConfidenceAudit: { create: auditCreate },
    decisionRecommendation: { create: recCreate, updateMany: recUpdateMany },
  };
  const prisma = {
    store: {
      findUnique: jest
        .fn()
        .mockResolvedValue(s.store === undefined ? { tenantId: 't1', status: 'ACTIVE' } : s.store),
    },
    product: { findMany: jest.fn().mockResolvedValue(s.products ?? []) },
    decisionRecommendation: { findMany, updateMany: recUpdateMany },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as PrismaService;

  const config = new ConfigService({
    RECOMMENDATION_MIN_GAP_PCT: 2,
    RECOMMENDATION_MIN_MARGIN_PCT: 10,
  });

  return {
    engine: new RecommendationEngineService(prisma, config as never),
    auditCreate,
    recCreate,
    recUpdateMany,
  };
}

describe('RecommendationEngineService.generateForStore', () => {
  it('creates a scoped recommendation with its confidence audit', async () => {
    const { engine, auditCreate, recCreate } = setup({ products: [productRow()] });

    const r = await engine.generateForStore('s1', NOW);

    expect(r).toMatchObject({ evaluated: 1, created: 1, updated: 0, expired: 0 });
    expect(auditCreate.mock.calls[0]![0].data).toMatchObject({
      tenantId: 't1',
      storeId: 's1',
      entityType: 'competitor',
      entityId: 'c1',
      status: 'PASSED',
    });
    const data = recCreate.mock.calls[0]![0].data;
    expect(data).toMatchObject({
      tenantId: 't1',
      storeId: 's1',
      productId: 'p1',
      confidenceAuditId: 'audit-1',
      type: 'PRICE_ADJUSTMENT',
    });
    expect(data.payload.suggestedPrice).toBe(90);
    expect(data.expiresAt.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('is idempotent: an unchanged situation only refreshes the expiry', async () => {
    const first = setup({ products: [productRow()] });
    await first.engine.generateForStore('s1', NOW);
    const payload = first.recCreate.mock.calls[0]![0].data.payload;

    const { engine, recCreate, recUpdateMany } = setup({
      products: [productRow()],
      pending: [{ id: 'r1', productId: 'p1', type: 'PRICE_ADJUSTMENT', payload, expiresAt: NOW }],
    });
    const r = await engine.generateForStore('s1', NOW);

    expect(r).toMatchObject({ created: 0, updated: 0, expired: 0 });
    expect(recCreate).not.toHaveBeenCalled();
    expect(recUpdateMany.mock.calls[0]![0]).toMatchObject({
      where: { id: { in: ['r1'] }, storeId: 's1', status: 'PENDING' },
    });
  });

  it('updates a pending recommendation in place when the competitor moves', async () => {
    const { engine, recCreate, recUpdateMany } = setup({
      products: [productRow()],
      pending: [
        {
          id: 'r1',
          productId: 'p1',
          type: 'PRICE_ADJUSTMENT',
          payload: { signature: 'old-signature' },
          expiresAt: NOW,
        },
      ],
    });

    const r = await engine.generateForStore('s1', NOW);

    expect(r).toMatchObject({ created: 0, updated: 1 });
    expect(recCreate).not.toHaveBeenCalled();
    const call = recUpdateMany.mock.calls.find((c) => c[0].data.title !== undefined)!;
    // Guarded on PENDING so a decision made meanwhile is never overwritten.
    expect(call[0].where).toEqual({ id: 'r1', storeId: 's1', status: 'PENDING' });
  });

  it('expires pending recommendations whose condition no longer holds', async () => {
    const { engine, recUpdateMany } = setup({
      products: [], // competitor raised price / product left the catalogue
      pending: [{ id: 'gone', productId: 'p9', type: 'COMPETITOR_ALERT', payload: {}, expiresAt: NOW }],
    });

    const r = await engine.generateForStore('s1', NOW);

    expect(r.expired).toBe(1);
    expect(recUpdateMany.mock.calls[0]![0]).toMatchObject({
      where: { id: { in: ['gone'] }, storeId: 's1', status: 'PENDING' },
      data: { status: 'EXPIRED' },
    });
  });

  it('does not re-raise a dismissed situation, but does raise a changed one', async () => {
    const probe = setup({ products: [productRow()] });
    await probe.engine.generateForStore('s1', NOW);
    const signature = probe.recCreate.mock.calls[0]![0].data.payload.signature as string;

    const same = setup({
      products: [productRow()],
      decided: [{ productId: 'p1', payload: { signature } }],
    });
    const r1 = await same.engine.generateForStore('s1', NOW);
    expect(r1).toMatchObject({ created: 0, suppressed: 1 });
    expect(same.recCreate).not.toHaveBeenCalled();

    const changed = setup({
      products: [productRow()],
      decided: [{ productId: 'p1', payload: { signature: 'older-situation' } }],
    });
    expect((await changed.engine.generateForStore('s1', NOW)).created).toBe(1);
  });

  it('raises an alert (no suggested price) when the cost is unknown', async () => {
    const { engine, recCreate } = setup({ products: [productRow({ costPrice: null })] });
    await engine.generateForStore('s1', NOW);
    const data = recCreate.mock.calls[0]![0].data;
    expect(data.type).toBe('COMPETITOR_ALERT');
    expect(data.payload.suggestedPrice).toBeNull();
  });

  it('does nothing for an unknown or inactive store', async () => {
    const missing = setup({ store: null });
    expect(await missing.engine.generateForStore('s1', NOW)).toMatchObject({ evaluated: 0 });
    const off = setup({ store: { tenantId: 't1', status: 'SUSPENDED' } });
    expect(await off.engine.generateForStore('s1', NOW)).toMatchObject({ evaluated: 0 });
  });
});
