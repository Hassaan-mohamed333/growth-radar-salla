import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@growth-radar/database';
import { PrismaService } from '../prisma/prisma.service';
import type { RecommendationPayload } from './recommendation-rules';

export type RecommendationFilter = 'PENDING' | 'ACCEPTED' | 'DISMISSED' | 'ALL';
export type MerchantDecision = 'ACCEPTED' | 'DISMISSED';

export interface ListRecommendationsQuery {
  status: RecommendationFilter;
  page: number;
  pageSize: number;
}

export interface RecommendationDto {
  id: string;
  type: string;
  status: string;
  title: string;
  rationale: string;
  /** 0-100 from the linked confidence audit, if any. */
  confidence: number | null;
  /** Engine-produced details; null for recommendations created by other means. */
  details: RecommendationPayload | null;
  product: { id: string; name: string; sku: string | null } | null;
  createdAt: string;
  expiresAt: string | null;
  decidedAt: string | null;
}

export interface RecommendationListResponse {
  items: RecommendationDto[];
  page: number;
  pageSize: number;
  total: number;
}

const select = {
  id: true,
  type: true,
  status: true,
  title: true,
  rationale: true,
  payload: true,
  createdAt: true,
  expiresAt: true,
  decidedAt: true,
  product: { select: { id: true, name: true, sku: true } },
  confidenceAudit: { select: { confidenceScore: true } },
} satisfies Prisma.DecisionRecommendationSelect;

type Row = Prisma.DecisionRecommendationGetPayload<{ select: typeof select }>;

/** Reads and merchant decisions. Every query is scoped by the session's store. */
@Injectable()
export class RecommendationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(storeId: string, q: ListRecommendationsQuery): Promise<RecommendationListResponse> {
    const where: Prisma.DecisionRecommendationWhereInput = { storeId };
    if (q.status !== 'ALL') where.status = q.status;

    const [total, rows] = await Promise.all([
      this.prisma.decisionRecommendation.count({ where }),
      this.prisma.decisionRecommendation.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select,
      }),
    ]);

    return { total, page: q.page, pageSize: q.pageSize, items: rows.map(toDto) };
  }

  /**
   * PENDING -> ACCEPTED | DISMISSED. The status guard is part of the UPDATE, so two
   * concurrent decisions cannot both win. Accepting records intent only: the
   * merchant applies the price in Salla themselves.
   */
  async decide(storeId: string, id: string, decision: MerchantDecision): Promise<RecommendationDto> {
    const res = await this.prisma.decisionRecommendation.updateMany({
      where: { id, storeId, status: 'PENDING' },
      data: { status: decision, decidedAt: new Date() },
    });

    if (res.count === 0) {
      const exists = await this.prisma.decisionRecommendation.findFirst({
        where: { id, storeId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('Recommendation not found');
      throw new ConflictException('Recommendation is no longer pending');
    }

    const row = await this.prisma.decisionRecommendation.findFirstOrThrow({
      where: { id, storeId },
      select,
    });
    return toDto(row);
  }
}

function toDto(r: Row): RecommendationDto {
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    title: r.title,
    rationale: r.rationale,
    confidence: r.confidenceAudit
      ? Math.round(r.confidenceAudit.confidenceScore.toNumber() * 100)
      : null,
    details: isPayload(r.payload) ? r.payload : null,
    product: r.product,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt?.toISOString() ?? null,
    decidedAt: r.decidedAt?.toISOString() ?? null,
  };
}

function isPayload(v: unknown): v is RecommendationPayload {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  return typeof p.kind === 'string' && typeof p.currentPrice === 'number';
}
