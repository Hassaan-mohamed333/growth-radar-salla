import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@growth-radar/database';
import type { PrismaService } from '../prisma/prisma.service';
import { CompetitorPricesService, HEARTBEAT_MS } from './competitor-prices.service';

interface State {
  competitor: { tenantId: string; lastPrice: Prisma.Decimal | null; currency: string } | null;
  lastHistoryAt: Date | null;
}

function setup(state: State) {
  const created: Array<Record<string, unknown>> = [];
  const updated: Array<Record<string, unknown>> = [];
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    competitor: {
      findFirst: jest.fn().mockResolvedValue(state.competitor),
      update: jest.fn(async (args: { data: Record<string, unknown> }) => {
        updated.push(args.data);
      }),
    },
    competitorPriceHistory: {
      findFirst: jest
        .fn()
        .mockResolvedValue(state.lastHistoryAt ? { observedAt: state.lastHistoryAt } : null),
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        created.push(args.data);
      }),
    },
  };
  const prisma = {
    $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
  } as unknown as PrismaService;
  return { service: new CompetitorPricesService(prisma), created, updated };
}

const NOW = new Date('2026-10-10T12:00:00Z');
const dec = (n: number) => new Prisma.Decimal(n);

describe('CompetitorPricesService.record', () => {
  it('writes history with previousPrice and updates lastPrice when the price changed', async () => {
    const { service, created, updated } = setup({
      competitor: { tenantId: 't', lastPrice: dec(100), currency: 'SAR' },
      lastHistoryAt: new Date(NOW.getTime() - 60_000),
    });

    const res = await service.record('s', 'c', { price: 90, source: 'manual' }, NOW);

    expect(res).toMatchObject({ recorded: true, changed: true, price: '90.00', previousPrice: '100.00' });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ storeId: 's', competitorId: 'c', source: 'manual' });
    expect(String(created[0]!.previousPrice)).toBe('100');
    expect(String(updated[0]!.lastPrice)).toBe('90');
  });

  it('skips history for an unchanged price seen recently but still bumps lastCheckedAt', async () => {
    const { service, created, updated } = setup({
      competitor: { tenantId: 't', lastPrice: dec(100), currency: 'SAR' },
      lastHistoryAt: new Date(NOW.getTime() - 60_000),
    });

    const res = await service.record('s', 'c', { price: 100, source: 'scraper' }, NOW);

    expect(res).toMatchObject({ recorded: false, changed: false });
    expect(created).toHaveLength(0);
    expect(updated[0]).toMatchObject({ lastCheckedAt: NOW });
  });

  it('writes a heartbeat row for an unchanged price after 24h', async () => {
    const { service, created } = setup({
      competitor: { tenantId: 't', lastPrice: dec(100), currency: 'SAR' },
      lastHistoryAt: new Date(NOW.getTime() - HEARTBEAT_MS - 1),
    });

    const res = await service.record('s', 'c', { price: 100, source: 'scraper' }, NOW);

    expect(res).toMatchObject({ recorded: true, changed: false });
    expect(created).toHaveLength(1);
  });

  it('records the first observation with a null previousPrice', async () => {
    const { service, created } = setup({
      competitor: { tenantId: 't', lastPrice: null, currency: 'SAR' },
      lastHistoryAt: null,
    });

    const res = await service.record('s', 'c', { price: 55.5, source: 'manual' }, NOW);

    expect(res).toMatchObject({ recorded: true, changed: true, previousPrice: null });
    expect(created[0]!.previousPrice).toBeNull();
  });

  it('rejects a competitor that is not in the store', async () => {
    const { service } = setup({ competitor: null, lastHistoryAt: null });
    await expect(service.record('s', 'c', { price: 1, source: 'manual' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
