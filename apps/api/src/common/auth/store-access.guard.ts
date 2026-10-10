import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import type { AuthedRequest } from './session.guard';
import { TenantDb } from '../../infra/tenant-db.service';

const uuid = z.string().uuid();

/**
 * For routes with a :storeId param. Enforces (a) the membership's store scope and (b) that the store really
 * belongs to the caller's tenant (checked under RLS + explicit tenantId). Cross-tenant ids return 404, not 403,
 * so store ids cannot be probed.
 */
@Injectable()
export class StoreAccessGuard implements CanActivate {
  constructor(private readonly db: TenantDb) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const auth = req.auth;
    const parsed = uuid.safeParse((req.params as Record<string, string> | undefined)?.['storeId']);
    if (!auth || !parsed.success) throw new NotFoundException();
    const storeId = parsed.data;
    if (auth.storeScope && auth.storeScope !== storeId) throw new ForbiddenException();
    const store = await this.db.withTenant(auth.tenantId, (tx, tenantId) =>
      tx.store.findFirst({ where: { id: storeId, tenantId }, select: { id: true } }),
    );
    if (!store) throw new NotFoundException();
    return true;
  }
}
