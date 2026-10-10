import { describe, expect, it } from 'vitest';
import { calculateDataConfidence, calculateMarketingHealth, ramp } from './confidence';
import { roleHasPermission } from './rbac';

const now = new Date('2026-10-10T12:00:00Z');
const salla = { revenue: 10_000, orderCount: 100, currency: 'SAR' };
const ga4 = (o: Partial<{ revenue: number; purchaseEvents: number; currency: string; last: Date | null }> = {}) => ({
  revenue: o.revenue ?? 10_000,
  purchaseEvents: o.purchaseEvents ?? 100,
  currency: o.currency ?? 'SAR',
  lastPurchaseEventAt: o.last === undefined ? new Date('2026-10-10T08:00:00Z') : o.last,
});

describe('calculateDataConfidence', () => {
  it('scores 100 when everything matches', () => {
    const r = calculateDataConfidence({ salla, ga4: ga4(), now });
    expect(r.score).toBe(100);
    expect(r.level).toBe('high');
  });

  it('never rewards missing GA4', () => {
    const r = calculateDataConfidence({ salla, ga4: null, now });
    expect(r.score).toBeLessThanOrEqual(15);
    expect(r.checks.find((c) => c.id === 'revenue_match')?.status).toBe('unavailable');
    expect(r.level).toBe('low');
  });

  it('penalises GA4 over-reporting (duplicate tags) like under-reporting', () => {
    const over = calculateDataConfidence({ salla, ga4: ga4({ revenue: 14_000, purchaseEvents: 140 }), now });
    const under = calculateDataConfidence({ salla, ga4: ga4({ revenue: 6_000, purchaseEvents: 60 }), now });
    expect(over.score).toBe(under.score);
    expect(over.score!).toBeLessThan(100);
  });

  it('fails purchase_event_exists when Salla has orders but GA4 has no purchases', () => {
    const r = calculateDataConfidence({ salla, ga4: ga4({ revenue: 0, purchaseEvents: 0 }), now });
    expect(r.checks.find((c) => c.id === 'purchase_event_exists')?.status).toBe('fail');
    expect(r.level).toBe('low');
  });

  it('does not compare money across currencies', () => {
    const r = calculateDataConfidence({ salla, ga4: ga4({ currency: 'USD' }), now });
    expect(r.checks.find((c) => c.id === 'currency_match')?.status).toBe('fail');
    expect(r.checks.find((c) => c.id === 'revenue_match')?.status).toBe('unavailable');
  });

  it('decays freshness between 24h and 72h', () => {
    const r = calculateDataConfidence({ salla, ga4: ga4({ last: new Date('2026-10-08T12:00:00Z') }), now }); // 48h
    const f = r.checks.find((c) => c.id === 'data_freshness')!;
    expect(f.earned).toBeCloseTo(0.5, 5);
    expect(f.status).toBe('warn');
  });

  it('returns insufficient_data when there are no orders and no GA4', () => {
    const r = calculateDataConfidence({ salla: { revenue: 0, orderCount: 0, currency: 'SAR' }, ga4: null, now });
    expect(r.score).toBeNull();
    expect(r.level).toBe('insufficient_data');
  });
});

describe('helpers', () => {
  it('ramp is bounded', () => {
    expect(ramp(0, 0.05, 0.4)).toBe(1);
    expect(ramp(1, 0.05, 0.4)).toBe(0);
    expect(ramp(NaN, 0.05, 0.4)).toBe(0);
  });
  it('health score', () => {
    expect(calculateMarketingHealth({ confidenceScore: null, revenueAtRisk: 0, revenue30d: 0 })).toBeNull();
    expect(calculateMarketingHealth({ confidenceScore: 80, revenueAtRisk: 5_000, revenue30d: 10_000 })).toBe(65);
  });
  it('RBAC is deny-by-default and least-privilege', () => {
    expect(roleHasPermission('CLIENT_VIEWER', 'insights:act')).toBe(false);
    expect(roleHasPermission('MARKETER', 'store:connect')).toBe(false);
    expect(roleHasPermission('OWNER', 'tenant:manage')).toBe(true);
    expect(roleHasPermission('AGENCY_ADMIN', 'tenant:manage')).toBe(false);
  });
});
