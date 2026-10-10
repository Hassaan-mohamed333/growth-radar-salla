import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnalyticsService } from '../../src/analytics/analytics.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { RecommendationEngineService } from '../../src/recommendations/recommendation-engine.service';
import { RecommendationsService } from '../../src/recommendations/recommendations.service';
import { connect, resetDb, seedCompetitor, seedProduct, seedStore, type SeededStore } from './db';

const HOUR = 3_600_000;

describe('recommendation engine + decisions against real PostgreSQL', () => {
  let prisma: PrismaService;
  let engine: RecommendationEngineService;
  let recs: RecommendationsService;

  beforeAll(async () => {
    prisma = await connect();
    engine = new RecommendationEngineService(
      prisma,
      new ConfigService({
        RECOMMENDATION_MIN_GAP_PCT: 2,
        RECOMMENDATION_MIN_MARGIN_PCT: 10,
      }) as never,
    );
    recs = new RecommendationsService(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(() => resetDb(prisma));

  async function scenario(opts: { cost?: number | null; rival?: number } = {}) {
    const s = await seedStore(prisma);
    const product = await seedProduct(prisma, s, {
      name: 'Beans',
      price: 100,
      costPrice: opts.cost === undefined ? 60 : opts.cost,
    });
    const rival = await seedCompetitor(prisma, s, {
      productId: product.id,
      name: 'Rival',
      lastPrice: opts.rival ?? 90,
      lastCheckedAt: new Date(Date.now() - HOUR),
    });
    return { s, product, rival };
  }

  const pending = (s: SeededStore) =>
    prisma.decisionRecommendation.findMany({ where: { storeId: s.storeId, status: 'PENDING' } });

  const setRivalPrice = (id: string, price: number) =>
    prisma.competitor.update({
      where: { id },
      data: { lastPrice: price, lastCheckedAt: new Date() },
    });

  it('creates one scoped recommendation with its confidence audit', async () => {
    const { s, product } = await scenario();

    const r = await engine.generateForStore(s.storeId);

    expect(r).toMatchObject({ evaluated: 1, created: 1 });
    const [rec] = await pending(s);
    expect(rec).toMatchObject({
      tenantId: s.tenantId,
      storeId: s.storeId,
      productId: product.id,
      type: 'PRICE_ADJUSTMENT',
    });
    expect(rec!.payload).toMatchObject({ kind: 'match_competitor', suggestedPrice: 90 });
    expect(rec!.expiresAt).not.toBeNull();
    const audit = await prisma.dataConfidenceAudit.findUniqueOrThrow({
      where: { id: rec!.confidenceAuditId! },
    });
    expect(audit).toMatchObject({ storeId: s.storeId, entityType: 'competitor', status: 'PASSED' });
    expect(audit.confidenceScore.toNumber()).toBeGreaterThan(0.9);
  });

  it('is idempotent; follows the competitor; expires when the situation no longer holds', async () => {
    const { s, rival } = await scenario();
    await engine.generateForStore(s.storeId);
    const [first] = await pending(s);

    // Same inputs: nothing created, nothing duplicated.
    expect(await engine.generateForStore(s.storeId)).toMatchObject({ created: 0, updated: 0, expired: 0 });
    expect(await pending(s)).toHaveLength(1);

    // Competitor drops again: same row updated in place with a new audit.
    await setRivalPrice(rival.id, 85);
    expect(await engine.generateForStore(s.storeId)).toMatchObject({ created: 0, updated: 1 });
    const [updated] = await pending(s);
    expect(updated!.id).toBe(first!.id);
    expect(updated!.payload).toMatchObject({ suggestedPrice: 85 });
    expect(updated!.confidenceAuditId).not.toBe(first!.confidenceAuditId);

    // Competitor goes above us: nothing to say any more.
    await setRivalPrice(rival.id, 105);
    expect(await engine.generateForStore(s.storeId)).toMatchObject({ expired: 1 });
    expect(await pending(s)).toHaveLength(0);
    const row = await prisma.decisionRecommendation.findUniqueOrThrow({ where: { id: first!.id } });
    expect(row.status).toBe('EXPIRED');
  });

  it('falls back to an alert (no price) when the cost is unknown, and respects the margin floor', async () => {
    const noCost = await scenario({ cost: null });
    await engine.generateForStore(noCost.s.storeId);
    const [alert] = await pending(noCost.s);
    expect(alert).toMatchObject({ type: 'COMPETITOR_ALERT' });
    expect(alert!.payload).toMatchObject({ kind: 'alert_no_cost', suggestedPrice: null });

    const floor = await scenario({ cost: 60, rival: 50 });
    await engine.generateForStore(floor.s.storeId);
    const [adj] = await pending(floor.s);
    expect(adj!.payload).toMatchObject({ kind: 'margin_floor', suggestedPrice: 66 });
  });

  it("does not re-raise what the merchant dismissed, but raises a changed situation", async () => {
    const { s, rival } = await scenario();
    await engine.generateForStore(s.storeId);
    const [rec] = await pending(s);

    await recs.decide(s.storeId, rec!.id, 'DISMISSED');
    const rerun = await engine.generateForStore(s.storeId);
    expect(rerun).toMatchObject({ created: 0, suppressed: 1 });
    expect(await pending(s)).toHaveLength(0);

    await setRivalPrice(rival.id, 80);
    expect(await engine.generateForStore(s.storeId)).toMatchObject({ created: 1 });
    const [fresh] = await pending(s);
    expect(fresh!.id).not.toBe(rec!.id);
    expect(fresh!.payload).toMatchObject({ suggestedPrice: 80 });
  });

  it('lets exactly one of two concurrent decisions win', async () => {
    const { s } = await scenario();
    await engine.generateForStore(s.storeId);
    const [rec] = await pending(s);

    const results = await Promise.allSettled([
      recs.decide(s.storeId, rec!.id, 'ACCEPTED'),
      recs.decide(s.storeId, rec!.id, 'DISMISSED'),
    ]);

    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
    const winner = (won[0] as PromiseFulfilledResult<{ status: string }>).value.status;
    const row = await prisma.decisionRecommendation.findUniqueOrThrow({ where: { id: rec!.id } });
    expect(row.status).toBe(winner);
    expect(row.decidedAt).not.toBeNull();
  });

  it('feeds the dashboard summary (pending count + confidence from the audit)', async () => {
    const { s } = await scenario();
    await engine.generateForStore(s.storeId);

    const summary = await new AnalyticsService(prisma).getSummary(s.storeId);

    expect(summary.recommendations.pending).toBe(1);
    expect(summary.recommendations.items[0]).toMatchObject({ type: 'PRICE_ADJUSTMENT' });
    expect(summary.recommendations.items[0]!.confidence).toBeGreaterThanOrEqual(90);
    expect(summary.pricingConfidence.auditsCount).toBe(1);
    expect(summary.competitors.undercutting).toBe(1);
  });

  it('never expires or edits another store\'s recommendations', async () => {
    const a = await scenario();
    const b = await scenario();
    await engine.generateForStore(a.s.storeId);
    await engine.generateForStore(b.s.storeId);
    // Store A's situation disappears; B must be untouched by A's run.
    await setRivalPrice(a.rival.id, 150);

    await engine.generateForStore(a.s.storeId);

    expect(await pending(a.s)).toHaveLength(0);
    expect(await pending(b.s)).toHaveLength(1);
  });
});
