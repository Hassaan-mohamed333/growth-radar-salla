import { Injectable } from '@nestjs/common';
import { PrismaService, type Tx } from './prisma.service';
import { currentTenant } from './tenant-context';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The only door to tenant data. Opens a transaction, pins the Postgres RLS tenant for that transaction
 * (set_config(..., is_local = true) => cannot leak to pooled connections), and hands out a client whose
 * every tenant-model query is additionally required to carry an explicit tenantId.
 */
@Injectable()
export class TenantDb {
  constructor(private readonly prisma: PrismaService) {}

  /** Request path: tenant comes from the authenticated session via AsyncLocalStorage. */
  run<T>(fn: (tx: Tx, tenantId: string) => Promise<T>): Promise<T> {
    return this.withTenant(currentTenant().tenantId, fn);
  }

  /** Worker path: tenant comes from the (trusted, server-created) job payload. */
  async withTenant<T>(tenantId: string, fn: (tx: Tx, tenantId: string) => Promise<T>): Promise<T> {
    if (!UUID_RE.test(tenantId)) throw new Error('Invalid tenant id');
    return this.prisma.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
        return fn(tx as unknown as Tx, tenantId);
      },
      { timeout: 30_000, maxWait: 5_000 },
    );
  }
}
