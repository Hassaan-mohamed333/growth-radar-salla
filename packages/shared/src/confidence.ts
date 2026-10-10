/**
 * Data Confidence Score (0-100): "can the merchant trust the numbers that drive decisions?"
 *
 * Pure & deterministic (no I/O) so it is unit-testable and auditable. Principles:
 *  - Missing evidence NEVER counts as a pass. A check we cannot run is `unavailable` and earns 0.
 *  - A check that is logically meaningless (e.g. revenue match when Salla shows no orders) is
 *    `not_applicable` and is excluded from the denominator.
 *  - Over-reporting in GA4 (duplicate purchase tags) is penalised exactly like under-reporting.
 */

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'unavailable' | 'not_applicable';

export interface SallaWindowTotals {
  /** Revenue of paid/completed orders in the window, in `currency` major units. */
  revenue: number;
  orderCount: number;
  currency: string;
}

export interface Ga4WindowTotals {
  /** GA4 `purchaseRevenue` for the window. */
  revenue: number;
  /** GA4 `ecommercePurchases` (count of `purchase` events). */
  purchaseEvents: number;
  currency: string;
  /** Timestamp of the most recent `purchase` event GA4 has seen, if known. */
  lastPurchaseEventAt: Date | null;
}

export interface ConfidenceInput {
  salla: SallaWindowTotals;
  /** null => GA4 is not connected / the report could not be fetched. */
  ga4: Ga4WindowTotals | null;
  now: Date;
}

export type CheckId =
  | 'ga4_connected'
  | 'purchase_event_exists'
  | 'revenue_match'
  | 'order_count_match'
  | 'data_freshness'
  | 'currency_match';

export interface CheckResult {
  id: CheckId;
  status: CheckStatus;
  weight: number;
  /** 0..1 fraction of `weight` earned. */
  earned: number;
  details: Record<string, number | string | null>;
}

export interface ConfidenceResult {
  /** Integer 0..100. null when there is not enough evidence to score at all. */
  score: number | null;
  level: 'high' | 'medium' | 'low' | 'insufficient_data';
  checks: CheckResult[];
}

export const CHECK_WEIGHTS: Record<CheckId, number> = {
  ga4_connected: 15,
  purchase_event_exists: 25,
  revenue_match: 30,
  order_count_match: 15,
  data_freshness: 10,
  currency_match: 5,
};

/** Revenue deviation <= 5% is full marks; >= 40% is zero; linear in between. */
export const REVENUE_TOLERANCE = { full: 0.05, zero: 0.4 } as const;
export const ORDER_COUNT_TOLERANCE = { full: 0.1, zero: 0.5 } as const;
export const FRESHNESS_HOURS = { full: 24, zero: 72 } as const;

/** Linear ramp: 1 at/below `full`, 0 at/above `zero`. */
export function ramp(value: number, full: number, zero: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= full) return 1;
  if (value >= zero) return 0;
  return 1 - (value - full) / (zero - full);
}

function statusFromEarned(earned: number): CheckStatus {
  if (earned >= 0.999) return 'pass';
  if (earned >= 0.5) return 'warn';
  return 'fail';
}

export function relativeDeviation(expected: number, actual: number): number {
  if (expected <= 0) return actual > 0 ? Number.POSITIVE_INFINITY : 0;
  return Math.abs(actual - expected) / expected;
}

export function calculateDataConfidence(input: ConfidenceInput): ConfidenceResult {
  const { salla, ga4, now } = input;
  const hasSallaOrders = salla.orderCount > 0 && salla.revenue > 0;
  const checks: CheckResult[] = [];

  const push = (
    id: CheckId,
    status: CheckStatus,
    earned: number,
    details: CheckResult['details'] = {},
  ) => checks.push({ id, status, weight: CHECK_WEIGHTS[id], earned, details });

  // 1. GA4 connected
  push('ga4_connected', ga4 ? 'pass' : 'fail', ga4 ? 1 : 0);

  if (!ga4) {
    // Without GA4 evidence nothing else can be verified: record as unavailable (earn 0).
    for (const id of ['purchase_event_exists', 'revenue_match', 'order_count_match', 'data_freshness', 'currency_match'] as const) {
      push(id, hasSallaOrders || id === 'data_freshness' || id === 'currency_match' ? 'unavailable' : 'not_applicable', 0);
    }
    return finalize(checks, hasSallaOrders);
  }

  // 2. purchase event exists
  if (!hasSallaOrders) {
    push('purchase_event_exists', 'not_applicable', 0);
  } else {
    const ok = ga4.purchaseEvents > 0;
    push('purchase_event_exists', ok ? 'pass' : 'fail', ok ? 1 : 0, { ga4Purchases: ga4.purchaseEvents, sallaOrders: salla.orderCount });
  }

  // 3. currency match (must hold before comparing money)
  const sameCurrency = ga4.currency.toUpperCase() === salla.currency.toUpperCase();
  push('currency_match', sameCurrency ? 'pass' : 'fail', sameCurrency ? 1 : 0, { salla: salla.currency, ga4: ga4.currency });

  // 4. revenue match
  if (!hasSallaOrders) {
    push('revenue_match', 'not_applicable', 0);
  } else if (!sameCurrency) {
    push('revenue_match', 'unavailable', 0, { reason: 'currency_mismatch' });
  } else {
    const dev = relativeDeviation(salla.revenue, ga4.revenue);
    const earned = ramp(dev, REVENUE_TOLERANCE.full, REVENUE_TOLERANCE.zero);
    push('revenue_match', statusFromEarned(earned), earned, {
      sallaRevenue: round2(salla.revenue),
      ga4Revenue: round2(ga4.revenue),
      deviationPct: Number.isFinite(dev) ? round2(dev * 100) : null,
      direction: ga4.revenue > salla.revenue ? 'ga4_over' : ga4.revenue < salla.revenue ? 'ga4_under' : 'equal',
    });
  }

  // 5. order count match
  if (!hasSallaOrders) {
    push('order_count_match', 'not_applicable', 0);
  } else {
    const dev = relativeDeviation(salla.orderCount, ga4.purchaseEvents);
    const earned = ramp(dev, ORDER_COUNT_TOLERANCE.full, ORDER_COUNT_TOLERANCE.zero);
    push('order_count_match', statusFromEarned(earned), earned, {
      sallaOrders: salla.orderCount,
      ga4Purchases: ga4.purchaseEvents,
      deviationPct: Number.isFinite(dev) ? round2(dev * 100) : null,
    });
  }

  // 6. freshness
  if (!ga4.lastPurchaseEventAt) {
    push('data_freshness', hasSallaOrders ? 'fail' : 'not_applicable', 0);
  } else {
    const ageH = Math.max(0, (now.getTime() - ga4.lastPurchaseEventAt.getTime()) / 3_600_000);
    const earned = ramp(ageH, FRESHNESS_HOURS.full, FRESHNESS_HOURS.zero);
    push('data_freshness', statusFromEarned(earned), earned, { ageHours: round2(ageH) });
  }

  return finalize(checks, hasSallaOrders);
}

function finalize(checks: CheckResult[], hasSallaOrders: boolean): ConfidenceResult {
  const applicable = checks.filter((c) => c.status !== 'not_applicable');
  const totalWeight = applicable.reduce((s, c) => s + c.weight, 0);
  const earnedWeight = applicable.reduce((s, c) => s + c.weight * c.earned, 0);

  // Only "GA4 connected" (+ freshness/currency) applicable and zero orders => nothing meaningful to score.
  if (!hasSallaOrders && checks.find((c) => c.id === 'ga4_connected')?.status !== 'pass') {
    return { score: null, level: 'insufficient_data', checks };
  }
  if (totalWeight === 0) return { score: null, level: 'insufficient_data', checks };

  const score = Math.round((earnedWeight / totalWeight) * 100);
  const level = score >= 85 ? 'high' : score >= 60 ? 'medium' : 'low';
  return { score, level, checks };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Marketing Health Score (0-100). Deliberately simple & explainable:
 * 50% data trust + 50% (100 - share of 30d revenue currently flagged at risk).
 */
export function calculateMarketingHealth(args: {
  confidenceScore: number | null;
  revenueAtRisk: number;
  revenue30d: number;
}): number | null {
  if (args.confidenceScore === null) return null;
  const riskShare = args.revenue30d > 0 ? Math.min(1, args.revenueAtRisk / args.revenue30d) : 0;
  return Math.round(0.5 * args.confidenceScore + 0.5 * (1 - riskShare) * 100);
}
