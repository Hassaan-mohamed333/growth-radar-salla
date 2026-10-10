import { Injectable } from '@nestjs/common';
import { Prisma } from '@growth-radar/database';
import { PrismaService } from '../prisma/prisma.service';

export type AuditStatusFilter = 'ALL' | 'PASSED' | 'WARNING' | 'FAILED';

export interface ListAuditsQuery {
  status: AuditStatusFilter;
  page: number;
  pageSize: number;
}

export interface AuditCheckDto {
  name: string;
  /** 0-100. */
  score: number;
  detail: string | null;
}

export interface AuditDto {
  id: string;
  entityType: string;
  /** Resolved display info; null when the entity is gone or of an unknown type. */
  entity: { id: string; name: string; domain: string | null } | null;
  source: string;
  /** 0-100. */
  score: number;
  status: 'PASSED' | 'WARNING' | 'FAILED';
  checks: AuditCheckDto[];
  /** Recommendation this audit fed, if any. */
  recommendation: { id: string; title: string; status: string } | null;
  createdAt: string;
}

export interface DataConfidenceResponse {
  summary: {
    windowDays: number;
    auditsCount: number;
    /** 0-100, mean over the window; null without audits. */
    averageScore: number | null;
    byStatus: { PASSED: number; WARNING: number; FAILED: number };
    /** Mean score per check name over the window, weakest first. */
    checks: Array<{ name: string; averageScore: number; count: number }>;
  };
  items: AuditDto[];
  page: number;
  pageSize: number;
  total: number;
}

const WINDOW_DAYS = 30;
const pct = (n: number) => Math.round(n * 100);

/** Read model for the "data confidence" page. Every query is scoped by the session's store. */
@Injectable()
export class DataConfidenceService {
  constructor(private readonly prisma: PrismaService) {}

  async get(storeId: string, q: ListAuditsQuery): Promise<DataConfidenceResponse> {
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const where: Prisma.DataConfidenceAuditWhereInput = { storeId };
    if (q.status !== 'ALL') where.status = q.status;

    const [total, rows, statusGroups, avg, checkRows] = await Promise.all([
      this.prisma.dataConfidenceAudit.count({ where }),
      this.prisma.dataConfidenceAudit.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true,
          entityType: true,
          entityId: true,
          source: true,
          confidenceScore: true,
          status: true,
          checks: true,
          createdAt: true,
          recommendations: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { id: true, title: true, status: true },
          },
        },
      }),
      this.prisma.dataConfidenceAudit.groupBy({
        by: ['status'],
        where: { storeId, createdAt: { gte: since } },
        _count: true,
      }),
      this.prisma.dataConfidenceAudit.aggregate({
        where: { storeId, createdAt: { gte: since } },
        _avg: { confidenceScore: true },
      }),
      // `checks` is free-form JSON written by producers; ignore anything that is not an
      // array of objects with a numeric score rather than failing the whole page.
      this.prisma.$queryRaw<Array<{ name: string; avg: number; n: number }>>`
        SELECT c->>'name' AS name,
               AVG((c->>'score')::float8) AS avg,
               COUNT(*)::int AS n
        FROM data_confidence_audits a
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(a.checks) = 'array' THEN a.checks ELSE '[]'::jsonb END
        ) AS c
        WHERE a.store_id = ${storeId}::uuid
          AND a.created_at >= ${since}
          AND jsonb_typeof(c) = 'object'
          AND jsonb_typeof(c->'name') = 'string'
          AND jsonb_typeof(c->'score') = 'number'
        GROUP BY c->>'name'
        ORDER BY AVG((c->>'score')::float8) ASC, c->>'name' ASC`,
    ]);

    const entities = await this.resolveEntities(storeId, rows);
    const byStatus = { PASSED: 0, WARNING: 0, FAILED: 0 };
    for (const g of statusGroups) byStatus[g.status] = g._count;

    return {
      summary: {
        windowDays: WINDOW_DAYS,
        auditsCount: byStatus.PASSED + byStatus.WARNING + byStatus.FAILED,
        averageScore: avg._avg.confidenceScore ? pct(avg._avg.confidenceScore.toNumber()) : null,
        byStatus,
        checks: checkRows.map((r) => ({
          name: r.name,
          averageScore: pct(r.avg),
          count: r.n,
        })),
      },
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((r) => ({
        id: r.id,
        entityType: r.entityType,
        entity: entities.get(`${r.entityType}:${r.entityId}`) ?? null,
        source: r.source,
        score: pct(r.confidenceScore.toNumber()),
        status: r.status,
        checks: parseChecks(r.checks),
        recommendation: r.recommendations[0] ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /** Audits point at competitors/products polymorphically; resolve names in one query each. */
  private async resolveEntities(
    storeId: string,
    rows: ReadonlyArray<{ entityType: string; entityId: string }>,
  ): Promise<Map<string, { id: string; name: string; domain: string | null }>> {
    const idsOf = (type: string) => [
      ...new Set(rows.filter((r) => r.entityType === type).map((r) => r.entityId)),
    ];
    const out = new Map<string, { id: string; name: string; domain: string | null }>();

    const competitorIds = idsOf('competitor');
    if (competitorIds.length > 0) {
      const found = await this.prisma.competitor.findMany({
        where: { storeId, id: { in: competitorIds } },
        select: { id: true, name: true, domain: true },
      });
      for (const c of found) out.set(`competitor:${c.id}`, c);
    }

    const productIds = idsOf('product');
    if (productIds.length > 0) {
      const found = await this.prisma.product.findMany({
        where: { storeId, id: { in: productIds } },
        select: { id: true, name: true },
      });
      for (const p of found) out.set(`product:${p.id}`, { ...p, domain: null });
    }
    return out;
  }
}

function parseChecks(raw: unknown): AuditCheckDto[] {
  if (!Array.isArray(raw)) return [];
  const out: AuditCheckDto[] = [];
  for (const c of raw) {
    if (typeof c !== 'object' || c === null) continue;
    const { name, score, detail } = c as Record<string, unknown>;
    if (typeof name !== 'string' || typeof score !== 'number' || !Number.isFinite(score)) continue;
    out.push({
      name,
      score: pct(score),
      detail: typeof detail === 'string' ? detail : null,
    });
  }
  return out;
}
