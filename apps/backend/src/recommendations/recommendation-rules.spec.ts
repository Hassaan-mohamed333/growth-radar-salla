import {
  type RuleCompetitor,
  type RuleOptions,
  type RuleProduct,
  assessConfidence,
  evaluateProduct,
} from './recommendation-rules';

const NOW = new Date('2026-10-10T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const opts: RuleOptions = {
  now: NOW,
  minGapPct: 2,
  minMarginPct: 10,
  maxPriceAgeMs: 7 * 24 * 3_600_000,
};

const product = (over: Partial<RuleProduct> = {}): RuleProduct => ({
  id: 'p1',
  name: 'Beans',
  price: 100,
  salePrice: null,
  costPrice: 60,
  currency: 'SAR',
  ...over,
});

const competitor = (over: Partial<RuleCompetitor> = {}): RuleCompetitor => ({
  id: 'c1',
  name: 'Rival',
  lastPrice: 90,
  currency: 'SAR',
  lastCheckedAt: hoursAgo(2),
  scrapeFailures: 0,
  ...over,
});

describe('evaluateProduct - when nothing should be raised', () => {
  it('is silent when we are already the cheapest', () => {
    expect(evaluateProduct(product(), [competitor({ lastPrice: 100 })], opts)).toBeNull();
    expect(evaluateProduct(product(), [competitor({ lastPrice: 120 })], opts)).toBeNull();
  });

  it('ignores gaps below the noise threshold', () => {
    expect(evaluateProduct(product(), [competitor({ lastPrice: 99 })], opts)).toBeNull();
    expect(evaluateProduct(product(), [competitor({ lastPrice: 98 })], opts)).not.toBeNull();
  });

  it('ignores stale, other-currency, never-checked and non-positive prices', () => {
    const stale = competitor({ lastCheckedAt: hoursAgo(24 * 8) });
    const usd = competitor({ currency: 'USD' });
    const never = competitor({ lastCheckedAt: null });
    const zero = competitor({ lastPrice: 0 });
    expect(evaluateProduct(product(), [stale, usd, never, zero], opts)).toBeNull();
  });

  it('uses the active sale price as what the customer pays', () => {
    // Our sale price (85) already beats the competitor (90).
    expect(evaluateProduct(product({ salePrice: 85 }), [competitor()], opts)).toBeNull();
  });

  it('still raises the weakest in-window comparison, flagged as WARNING', () => {
    const shaky = competitor({ lastCheckedAt: hoursAgo(24 * 6), scrapeFailures: 5 });
    // freshness 0.5, coverage 0.7, reliability 0.4, cost missing 0.6 -> 0.55
    expect(assessConfidence(shaky, 1, null, NOW)).toMatchObject({ score: 0.55, status: 'WARNING' });
    const d = evaluateProduct(product({ costPrice: null }), [shaky], opts)!;
    expect(d.confidence.status).toBe('WARNING');
  });
});

describe('evaluateProduct - price suggestions (cost known)', () => {
  it('matches the cheapest competitor when the margin still holds', () => {
    const d = evaluateProduct(product(), [competitor({ lastPrice: 90 })], opts)!;

    expect(d.type).toBe('PRICE_ADJUSTMENT');
    expect(d.payload).toMatchObject({
      kind: 'match_competitor',
      currentPrice: 100,
      lowestPrice: 90,
      suggestedPrice: 90,
      priceChangePct: -10,
      suggestedMarginPct: 33.3,
      marginFloorPrice: 66,
      gapPct: 10,
    });
  });

  it('stops at the margin floor instead of matching below it', () => {
    // cost 60 * 1.10 = 66 floor; competitor at 50 would be a loss.
    const d = evaluateProduct(product(), [competitor({ lastPrice: 50 })], opts)!;

    expect(d.type).toBe('PRICE_ADJUSTMENT');
    expect(d.payload).toMatchObject({ kind: 'margin_floor', suggestedPrice: 66, lowestPrice: 50 });
    expect(d.payload.suggestedPrice!).toBeGreaterThanOrEqual(60 * 1.1);
  });

  it('never suggests a price below cost plus margin, whatever the competitor does', () => {
    for (const rival of [1, 30, 59.99, 60, 65, 65.99]) {
      const d = evaluateProduct(product(), [competitor({ lastPrice: rival })], opts);
      if (d?.payload.suggestedPrice != null) {
        expect(d.payload.suggestedPrice).toBeGreaterThanOrEqual(66);
      }
    }
  });

  it('rounds the floor up to the cent', () => {
    const d = evaluateProduct(
      product({ price: 100, costPrice: 33.333 }),
      [competitor({ lastPrice: 10 })],
      opts,
    )!;
    // 33.333 * 1.1 = 36.6663 -> 36.67, never 36.66
    expect(d.payload.suggestedPrice).toBe(36.67);
  });

  it('only alerts when even the floor is not below the current price', () => {
    // Already sitting at the floor (66): can't go lower, rival is cheaper.
    const d = evaluateProduct(product({ price: 66 }), [competitor({ lastPrice: 60 })], opts)!;

    expect(d.type).toBe('COMPETITOR_ALERT');
    expect(d.payload).toMatchObject({ kind: 'alert_margin_blocked', suggestedPrice: null });
    expect(d.rationale).toContain('66.00');
  });
});

describe('evaluateProduct - cost unknown', () => {
  it('alerts but never suggests a price', () => {
    for (const cost of [null, 0, -5]) {
      const d = evaluateProduct(product({ costPrice: cost }), [competitor()], opts)!;
      expect(d.type).toBe('COMPETITOR_ALERT');
      expect(d.payload).toMatchObject({
        kind: 'alert_no_cost',
        suggestedPrice: null,
        suggestedMarginPct: null,
        marginFloorPrice: null,
      });
    }
  });
});

describe('evaluateProduct - comparison details', () => {
  it('picks the cheapest of several competitors and reports coverage', () => {
    const d = evaluateProduct(
      product(),
      [
        competitor({ id: 'a', name: 'A', lastPrice: 95 }),
        competitor({ id: 'b', name: 'B', lastPrice: 88 }),
        competitor({ id: 'c', name: 'C', lastPrice: 70, lastCheckedAt: hoursAgo(24 * 30) }),
      ],
      opts,
    )!;
    expect(d.payload).toMatchObject({
      competitorId: 'b',
      competitorName: 'B',
      lowestPrice: 88,
      competitorsCompared: 2,
    });
  });

  it('gives an identical signature for an identical situation, a new one when it moves', () => {
    const a = evaluateProduct(product(), [competitor({ lastPrice: 90 })], opts)!;
    const b = evaluateProduct(product(), [competitor({ lastPrice: 90 })], opts)!;
    const c = evaluateProduct(product(), [competitor({ lastPrice: 89 })], opts)!;
    expect(a.payload.signature).toBe(b.payload.signature);
    expect(c.payload.signature).not.toBe(a.payload.signature);
  });
});

describe('assessConfidence', () => {
  it('scores a fresh, reliable, well-covered comparison as PASSED', () => {
    const r = assessConfidence(competitor(), 3, 60, NOW);
    expect(r.status).toBe('PASSED');
    expect(r.score).toBe(1);
    expect(r.checks.map((c) => c.name)).toEqual([
      'price_freshness',
      'competitor_coverage',
      'source_reliability',
      'cost_known',
    ]);
  });

  it('degrades with age and repeated scrape failures', () => {
    const fresh = assessConfidence(competitor(), 1, 60, NOW).score;
    const old = assessConfidence(competitor({ lastCheckedAt: hoursAgo(100) }), 1, 60, NOW).score;
    const failing = assessConfidence(competitor({ scrapeFailures: 3 }), 1, 60, NOW).score;
    expect(old).toBeLessThan(fresh);
    expect(failing).toBeLessThan(fresh);
  });
});
