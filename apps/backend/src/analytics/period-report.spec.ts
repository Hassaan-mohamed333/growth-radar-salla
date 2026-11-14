import { computePeriodReport, type DayRow } from './period-report';

const day = (date: string, orders: number, gross: number, refunded = 0): DayRow => ({
  date,
  ordersCount: orders,
  unitsSold: orders * 2,
  grossRevenue: gross,
  refundedRevenue: refunded,
});

// today = 2026-11-15, so the current week is 11-08..11-14 and the previous 11-01..11-07.
const TODAY = '2026-11-15';
const range = (from: number, to: number, gross: number, orders = 1) =>
  Array.from({ length: to - from + 1 }, (_, i) =>
    day(`2026-11-${String(from + i).padStart(2, '0')}`, orders, gross),
  );

describe('computePeriodReport', () => {
  it('compares the last complete week with the one before and excludes today', () => {
    const rows = [...range(1, 7, 100), ...range(8, 14, 150), day('2026-11-15', 99, 99999)];
    const r = computePeriodReport(rows, 'week', TODAY);
    expect(r.current).toMatchObject({ from: '2026-11-08', to: '2026-11-14', orders: 7, netRevenue: 1050 });
    expect(r.previous.netRevenue).toBe(700);
    expect(r.revenueChangePct).toBe(50);
    expect(r.ordersChangePct).toBe(0);
    expect(r.current.avgOrderValue).toBe(150);
  });

  it('subtracts refunds and picks the best day by net revenue', () => {
    const rows = [day('2026-11-08', 2, 500, 400), day('2026-11-09', 1, 300)];
    const r = computePeriodReport(rows, 'week', TODAY);
    expect(r.current.netRevenue).toBe(400);
    expect(r.current.refunded).toBe(400);
    expect(r.current.bestDay).toEqual({ date: '2026-11-09', netRevenue: 300 });
  });

  it('gives no percentage when the previous window is too thin to compare', () => {
    const rows = [...range(8, 14, 100), day('2026-11-07', 1, 100)];
    const r = computePeriodReport(rows, 'week', TODAY);
    expect(r.revenueChangePct).toBeNull();
  });

  it('reports an empty store without dividing by zero', () => {
    const r = computePeriodReport([], 'month', TODAY);
    expect(r.current.avgOrderValue).toBeNull();
    expect(r.current.bestDay).toBeNull();
    expect(r.revenueChangePct).toBeNull();
  });
});
