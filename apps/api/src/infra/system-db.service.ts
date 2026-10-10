import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

export interface TenantStoreRef {
  tenant_id: string;
  store_id: string;
}

/**
 * Cross-tenant lookups that must work before a tenant context exists. Each maps to ONE narrowly scoped
 * SECURITY DEFINER SQL function (migration 0002) that returns ids only — never secrets or business data.
 */
@Injectable()
export class SystemDb {
  constructor(private readonly prisma: PrismaService) {}

  async resolveMerchant(merchantId: bigint) {
    const rows = await this.prisma.raw.$queryRaw<(TenantStoreRef & { status: string })[]>`
      SELECT tenant_id, store_id, status::text AS status FROM resolve_tenant_by_merchant(${merchantId})`;
    return rows[0] ?? null;
  }

  listUserMemberships(userId: string) {
    return this.prisma.raw.$queryRaw<{ tenant_id: string; role: string; store_id: string | null }[]>`
      SELECT tenant_id, role::text AS role, store_id FROM list_user_memberships(${userId}::uuid)`;
  }

  listExpiringConnections(withinMinutes: number) {
    return this.prisma.raw.$queryRaw<TenantStoreRef[]>`
      SELECT tenant_id, store_id FROM list_expiring_connections(make_interval(mins => ${withinMinutes}::int))`;
  }

  listActiveConnections() {
    return this.prisma.raw.$queryRaw<TenantStoreRef[]>`SELECT tenant_id, store_id FROM list_active_connections()`;
  }
}
