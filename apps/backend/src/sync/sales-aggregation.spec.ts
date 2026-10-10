import type { SallaOrder } from '../salla/salla-api.client';
import { addDays, aggregateOrders, enumerateDays, isYmd, localToday } from './sales-aggregation';

const order = (over: Partial<SallaOrder>): SallaOrder => ({
  id: '1',
  localDate: '2026-10-05',
  statusSlug: 'completed',
  total: 100,
  currency: 'SAR',
  units: 1,
  refunded: 0,
  ...over,
});

describe('aggregateOrders', () => {
  const days = ['2026-10-04', '2026-10-05', '2026-10-06'];

  it('returns a zero row for every requested day', () => {
    const out = aggregateOrders([], days);
    expect(out.map((d) => d.date)).toEqual(days);
    expect(out.every((d) => d.ordersCount === 0 && d.grossRevenue === 0)).toBe(true);
  });

  it('sums orders, units, revenue and refunds per local day', () => {
    const out = aggregateOrders(
      [
        order({ id: 'a', units: 2, total: 150.5 }),
        order({ id: 'b', units: 3, total: 49.5, refunded: 20.25 }),
        order({ id: 'c', localDate: '2026-10-06', total: 10 }),
      ],
      days,
    );
    expect(out[1]).toMatchObject({
      date: '2026-10-05',
      ordersCount: 2,
      unitsSold: 5,
      grossRevenue: 200,
      refundedRevenue: 20.25,
    });
    expect(out[2]).toMatchObject({ ordersCount: 1, grossRevenue: 10 });
  });

  it('does not drift on float money', () => {
    const orders = Array.from({ length: 10 }, (_, i) => order({ id: String(i), total: 0.1 }));
    expect(aggregateOrders(orders, days)[1]!.grossRevenue).toBe(1);
  });

  it('skips cancelled/restored orders and days outside the range', () => {
    const out = aggregateOrders(
      [
        order({ id: 'a', statusSlug: 'canceled' }),
        order({ id: 'b', statusSlug: 'restored' }),
        order({ id: 'c', localDate: '2026-09-01' }),
        order({ id: 'd', statusSlug: null }),
      ],
      days,
    );
    expect(out[1]!.ordersCount).toBe(1); // only the status-less order counts
    expect(out.reduce((n, d) => n + d.ordersCount, 0)).toBe(1);
  });
});

describe('day helpers', () => {
  it('adds days across month boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('enumerates an inclusive range', () => {
    expect(enumerateDays('2026-10-01', '2026-10-03')).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
    ]);
    expect(enumerateDays('2026-10-03', '2026-10-01')).toEqual([]);
  });

  it('uses the Riyadh calendar day for "today"', () => {
    // 22:00 UTC is already the next day in Riyadh (UTC+3).
    expect(localToday(new Date('2026-10-10T22:00:00Z'))).toBe('2026-10-11');
    expect(localToday(new Date('2026-10-10T12:00:00Z'))).toBe('2026-10-10');
  });

  it('validates YYYY-MM-DD', () => {
    expect(isYmd('2026-10-10')).toBe(true);
    expect(isYmd('2026-13-40')).toBe(false);
    expect(isYmd('10/10/2026')).toBe(false);
  });
});
