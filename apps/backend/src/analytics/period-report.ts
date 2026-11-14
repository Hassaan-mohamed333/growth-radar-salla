// Store performance for a calendar window versus the window right before it, from daily snapshots.

export interface DayRow {
  /** YYYY-MM-DD, store-local. */
  date: string;
  ordersCount: number;
  unitsSold: number;
  grossRevenue: number;
  refundedRevenue: number;
}

export interface PeriodTotals {
  from: string;
  to: string;
  /** Days that have a snapshot row inside the window. */
  daysCovered: number;
  orders: number;
  units: number;
  netRevenue: number;
  refunded: number;
  avgOrderValue: number | null;
  bestDay: { date: string; netRevenue: number } | null;
}

export interface PeriodReport {
  period: 'week' | 'month';
  current: PeriodTotals;
  previous: PeriodTotals;
  /** % change of net revenue / orders vs the previous window; null when it cannot be compared. */
  revenueChangePct: number | null;
  ordersChangePct: number | null;
}

const DAY_MS = 86_400_000;
const addDays = (ymd: string, n: number) =>
  new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

export const PERIOD_DAYS = { week: 7, month: 30 } as const;

function totals(rows: DayRow[], from: string, to: string): PeriodTotals {
  const inside = rows.filter((r) => r.date >= from && r.date <= to);
  const net = (r: DayRow) => r.grossRevenue - r.refundedRevenue;
  const orders = inside.reduce((s, r) => s + r.ordersCount, 0);
  const netRevenue = inside.reduce((s, r) => s + net(r), 0);
  let best: PeriodTotals['bestDay'] = null;
  for (const r of inside) {
    if (net(r) > 0 && (!best || net(r) > best.netRevenue)) {
      best = { date: r.date, netRevenue: round2(net(r)) };
    }
  }
  return {
    from,
    to,
    daysCovered: inside.length,
    orders,
    units: inside.reduce((s, r) => s + r.unitsSold, 0),
    netRevenue: round2(netRevenue),
    refunded: round2(inside.reduce((s, r) => s + r.refundedRevenue, 0)),
    avgOrderValue: orders > 0 ? round2(netRevenue / orders) : null,
    bestDay: best,
  };
}

/** `today` is excluded: it is still filling up. */
export function computePeriodReport(
  rows: DayRow[],
  period: 'week' | 'month',
  today: string,
): PeriodReport {
  const n = PERIOD_DAYS[period];
  const curTo = addDays(today, -1);
  const curFrom = addDays(curTo, -(n - 1));
  const prevTo = addDays(curFrom, -1);
  const prevFrom = addDays(prevTo, -(n - 1));

  const current = totals(rows, curFrom, curTo);
  const previous = totals(rows, prevFrom, prevTo);
  // A previous window with under half its days covered is too thin to compare against.
  const comparable = previous.daysCovered >= Math.ceil(n / 2) && current.daysCovered > 0;
  const pct = (now: number, before: number) =>
    comparable && before > 0 ? round1(((now - before) / before) * 100) : null;

  return {
    period,
    current,
    previous,
    revenueChangePct: pct(current.netRevenue, previous.netRevenue),
    ordersChangePct: pct(current.orders, previous.orders),
  };
}
