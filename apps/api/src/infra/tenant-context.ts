import { AsyncLocalStorage } from 'node:async_hooks';
import type { Role } from '@radar/shared';

export interface TenantContext {
  userId: string;
  tenantId: string;
  role: Role;
  /** null => all stores in the tenant; otherwise the single store this membership is restricted to. */
  storeScope: string | null;
}

export const tenantStorage = new AsyncLocalStorage<TenantContext>();

export function currentTenant(): TenantContext {
  const ctx = tenantStorage.getStore();
  if (!ctx) throw new Error('No tenant context: route is missing authentication or TenantInterceptor');
  return ctx;
}
