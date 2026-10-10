import type { SallaOrder } from '../salla/salla-api.client';

/**
 * Salla stores are Saudi merchants; Salla reports order dates in the store's
 * timezone already, so this is only used to decide what "today" is.
 */
export const STORE_TIMEZONE = 'Asia/Riyadh';

/** Orders in these states never became (or no longer are) sales. */
export const EXCLUDED_STATUS_SLUGS: ReadonlySet<string> = new Set([
  'canceled',
  'cancelled',
  'restored',
]);

export interface DailyTotals {
  /** YYYY-MM-DD, store-local. */
  date: string;
  ordersCount: number;
  unitsSold: number;
  grossRevenue: number;
  refundedRevenue: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isYmd(value: string): boolean {
  return YMD.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function localToday(now = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: STORE_TIMEZONE }).format(now);
}

export function addDays(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Inclusive list of days from `from` to `to` (empty when from > to). */
export function enumerateDays(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

/**
 * Buckets orders into the requested days. Every requested day is returned (zero
 * rows included) so velocity denominators count days with no sales; orders
 * outside the requested days are ignored.
 */
export function aggregateOrders(orders: readonly SallaOrder[], days: readonly string[]): DailyTotals[] {
  // Money is accumulated in minor units (halalas) to avoid float drift.
  const buckets = new Map<
    string,
    { orders: number; units: number; gross: number; refunded: number }
  >(days.map((d) => [d, { orders: 0, units: 0, gross: 0, refunded: 0 }]));

  for (const o of orders) {
    if (o.statusSlug && EXCLUDED_STATUS_SLUGS.has(o.statusSlug)) continue;
    const b = buckets.get(o.localDate);
    if (!b) continue;
    b.orders += 1;
    b.units += o.units;
    b.gross += Math.round(o.total * 100);
    b.refunded += Math.round(o.refunded * 100);
  }

  return days.map((date) => {
    const b = buckets.get(date)!;
    return {
      date,
      ordersCount: b.orders,
      unitsSold: b.units,
      grossRevenue: b.gross / 100,
      refundedRevenue: b.refunded / 100,
    };
  });
}
