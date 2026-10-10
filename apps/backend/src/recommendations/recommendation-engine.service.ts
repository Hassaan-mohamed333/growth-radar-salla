import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@growth-radar/database';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { type Decision, evaluateProduct } from './recommendation-rules';

const DAY_MS = 24 * 60 * 60 * 1000;
/** A pending recommendation lapses unless the next engine run re-confirms it. */
const PENDING_TTL_MS = 7 * DAY_MS;
/** Competitor prices older than this are not used for comparisons. */
const MAX_PRICE_AGE_MS = 7 * DAY_MS;
/** A decided recommendation is not re-raised for the same situation within this window. */
const SUPPRESS_MS = 14 * DAY_MS;
/** Safety cap per store and run; beyond it nothing is expired (we could not see everything). */
const MAX_PRODUCTS = 5_000;

const ENGINE_TYPES = ['PRICE_ADJUSTMENT', 'COMPETITOR_ALERT'] as const;

export interface EngineResult {
  evaluated: number;
  created: number;
  updated: number;
  expired: number;
  suppressed: number;
}

const EMPTY: EngineResult = { evaluated: 0, created: 0, updated: 0, expired: 0, suppressed: 0 };

/**
 * Turns "a competitor is cheaper" into pending recommendations.
 *
 * One live recommendation per product. Re-running is idempotent: unchanged
 * situations only get their expiry refreshed, changed ones are updated in place,
 * and ones that no longer hold are expired.
 */
@Injectable()
export class RecommendationEngineService {
  private readonly logger = new Logger(RecommendationEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async generateForStore(storeId: string, now = new Date()): Promise<EngineResult> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { tenantId: true, status: true },
    });
    if (!store || store.status !== 'ACTIVE') return { ...EMPTY };

    const products = await this.prisma.product.findMany({
      where: {
        storeId,
        status: 'SALE',
        competitors: { some: { isActive: true, lastPrice: { not: null } } },
      },
      orderBy: { id: 'asc' },
      take: MAX_PRODUCTS,
      select: {
        id: true,
        name: true,
        price: true,
        salePrice: true,
        costPrice: true,
        currency: true,
        competitors: {
          where: { isActive: true, lastPrice: { not: null } },
          select: {
            id: true,
            name: true,
            lastPrice: true,
            currency: true,
            lastCheckedAt: true,
            scrapeFailures: true,
          },
        },
      },
    });
    const sawEverything = products.length < MAX_PRODUCTS;

    const [pending, decided] = await Promise.all([
      this.prisma.decisionRecommendation.findMany({
        where: { storeId, status: 'PENDING', type: { in: [...ENGINE_TYPES] } },
        select: { id: true, productId: true, type: true, payload: true, expiresAt: true },
      }),
      this.prisma.decisionRecommendation.findMany({
        where: {
          storeId,
          type: { in: [...ENGINE_TYPES] },
          status: { in: ['ACCEPTED', 'DISMISSED', 'APPLIED'] },
          decidedAt: { gte: new Date(now.getTime() - SUPPRESS_MS) },
        },
        select: { productId: true, payload: true },
      }),
    ]);

    const pendingByProduct = new Map(
      pending.filter((p) => p.productId !== null).map((p) => [p.productId as string, p]),
    );
    const suppressed = new Set(
      decided.flatMap((d) => {
        const sig = signatureOf(d.payload);
        return d.productId && sig ? [`${d.productId}:${sig}`] : [];
      }),
    );

    const result: EngineResult = { ...EMPTY, evaluated: products.length };
    const keepIds = new Set<string>();
    const refreshIds: string[] = [];

    for (const p of products) {
      const decision = evaluateProduct(
        {
          id: p.id,
          name: p.name,
          price: p.price.toNumber(),
          salePrice: p.salePrice?.toNumber() ?? null,
          costPrice: p.costPrice?.toNumber() ?? null,
          currency: p.currency,
        },
        p.competitors.map((c) => ({
          id: c.id,
          name: c.name,
          lastPrice: c.lastPrice!.toNumber(),
          currency: c.currency,
          lastCheckedAt: c.lastCheckedAt,
          scrapeFailures: c.scrapeFailures,
        })),
        {
          now,
          minGapPct: this.config.get('RECOMMENDATION_MIN_GAP_PCT', { infer: true }),
          minMarginPct: this.config.get('RECOMMENDATION_MIN_MARGIN_PCT', { infer: true }),
          maxPriceAgeMs: MAX_PRICE_AGE_MS,
        },
      );
      if (!decision) continue;

      if (suppressed.has(`${p.id}:${decision.payload.signature}`)) {
        result.suppressed += 1;
        continue;
      }

      const existing = pendingByProduct.get(p.id);
      if (existing) {
        keepIds.add(existing.id);
        if (existing.type === decision.type && signatureOf(existing.payload) === decision.payload.signature) {
          refreshIds.push(existing.id);
        } else {
          await this.update(existing.id, store.tenantId, storeId, decision, now);
          result.updated += 1;
        }
      } else {
        await this.create(store.tenantId, storeId, p.id, decision, now);
        result.created += 1;
      }
    }

    if (refreshIds.length > 0) {
      await this.prisma.decisionRecommendation.updateMany({
        where: { id: { in: refreshIds }, storeId, status: 'PENDING' },
        data: { expiresAt: new Date(now.getTime() + PENDING_TTL_MS) },
      });
    }

    // Anything pending that this run did not re-confirm no longer holds.
    if (sawEverything) {
      const stale = pending.filter((p) => !keepIds.has(p.id)).map((p) => p.id);
      if (stale.length > 0) {
        const res = await this.prisma.decisionRecommendation.updateMany({
          where: { id: { in: stale }, storeId, status: 'PENDING' },
          data: { status: 'EXPIRED' },
        });
        result.expired = res.count;
      }
    } else {
      this.logger.warn(`Store ${storeId} hit the ${MAX_PRODUCTS}-product cap; skipping expiry`);
    }

    return result;
  }

  private async create(
    tenantId: string,
    storeId: string,
    productId: string,
    d: Decision,
    now: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const audit = await tx.dataConfidenceAudit.create({
        data: auditData(tenantId, storeId, d),
        select: { id: true },
      });
      await tx.decisionRecommendation.create({
        data: {
          tenantId,
          storeId,
          productId,
          confidenceAuditId: audit.id,
          type: d.type,
          title: d.title,
          rationale: d.rationale,
          payload: d.payload as unknown as Prisma.InputJsonValue,
          expiresAt: new Date(now.getTime() + PENDING_TTL_MS),
        },
      });
    });
  }

  private async update(
    id: string,
    tenantId: string,
    storeId: string,
    d: Decision,
    now: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const audit = await tx.dataConfidenceAudit.create({
        data: auditData(tenantId, storeId, d),
        select: { id: true },
      });
      // Guarded on PENDING: a decision the merchant just made must not be overwritten.
      await tx.decisionRecommendation.updateMany({
        where: { id, storeId, status: 'PENDING' },
        data: {
          confidenceAuditId: audit.id,
          type: d.type,
          title: d.title,
          rationale: d.rationale,
          payload: d.payload as unknown as Prisma.InputJsonValue,
          expiresAt: new Date(now.getTime() + PENDING_TTL_MS),
        },
      });
    });
  }
}

function auditData(tenantId: string, storeId: string, d: Decision) {
  return {
    tenantId,
    storeId,
    entityType: 'competitor',
    entityId: d.payload.competitorId,
    source: 'recommendation_engine',
    confidenceScore: new Prisma.Decimal(d.confidence.score),
    status: d.confidence.status,
    checks: d.confidence.checks as unknown as Prisma.InputJsonValue,
  };
}

function signatureOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const sig = (payload as { signature?: unknown }).signature;
  return typeof sig === 'string' ? sig : null;
}
