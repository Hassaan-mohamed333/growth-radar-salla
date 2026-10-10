import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/** Models that hold tenant data. Every operation on them MUST carry an explicit tenantId. */
const TENANT_MODELS = new Set([
  'Store', 'Membership', 'SallaConnection', 'Category', 'Product', 'Order', 'WebhookEvent', 'RawIngestion',
  'AnalyticsSnapshot', 'DataConfidenceAudit', 'Competitor', 'CompetitorObservation', 'DecisionRecommendation',
]);
const WHERE_OPS = new Set([
  'findMany', 'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow', 'count', 'aggregate',
  'groupBy', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert',
]);
const DATA_OPS = new Set(['create', 'createMany', 'createManyAndReturn']);

type Args = { where?: Record<string, unknown>; data?: unknown };

/** Throws unless the query pins tenantId. Exported for unit tests. */
export function assertTenantScoped(model: string, operation: string, args: Args | undefined): void {
  if (!TENANT_MODELS.has(model)) return;
  const fail = () => {
    throw new Error(`Tenant isolation: ${model}.${operation} must include an explicit tenantId`);
  };
  if (WHERE_OPS.has(operation)) {
    if (typeof args?.where?.['tenantId'] !== 'string') fail();
  }
  if (DATA_OPS.has(operation)) {
    const rows = Array.isArray(args?.data) ? args.data : [args?.data];
    if (!rows.length || rows.some((r) => typeof (r as Record<string, unknown> | undefined)?.['tenantId'] !== 'string')) fail();
  }
}

function extend(client: PrismaClient) {
  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          assertTenantScoped(model, operation, args as Args);
          return query(args);
        },
      },
    },
  });
}

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  /** Raw client — only for global (non-tenant) tables and SECURITY DEFINER lookups. */
  readonly raw = new PrismaClient({ log: [{ emit: 'event', level: 'error' }] });
  /** Guarded client: tenant models reject queries lacking an explicit tenantId. */
  readonly db = extend(this.raw);

  async onModuleInit() {
    await this.raw.$connect();
  }
  async onModuleDestroy() {
    await this.raw.$disconnect();
  }
}

export type Tx = Prisma.TransactionClient;
