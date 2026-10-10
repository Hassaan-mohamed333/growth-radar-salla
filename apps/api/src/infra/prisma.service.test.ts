import { describe, expect, it } from 'vitest';
import { assertTenantScoped } from './prisma.service';

describe('assertTenantScoped (explicit tenant_id enforcement)', () => {
  it('rejects reads/writes without tenantId on tenant models', () => {
    expect(() => assertTenantScoped('Order', 'findMany', { where: { storeId: 'x' } })).toThrow('explicit tenantId');
    expect(() => assertTenantScoped('Order', 'findMany', {})).toThrow();
    expect(() => assertTenantScoped('Product', 'deleteMany', { where: {} })).toThrow();
    expect(() => assertTenantScoped('Order', 'create', { data: { storeId: 'x' } })).toThrow();
    expect(() => assertTenantScoped('Order', 'createMany', { data: [{ tenantId: 't' }, { storeId: 'x' }] })).toThrow();
    expect(() => assertTenantScoped('Order', 'upsert', { where: { storeId_sallaId: {} } })).toThrow();
  });
  it('accepts queries that pin tenantId', () => {
    expect(() => assertTenantScoped('Order', 'findMany', { where: { tenantId: 't', storeId: 'x' } })).not.toThrow();
    expect(() => assertTenantScoped('Order', 'create', { data: { tenantId: 't' } })).not.toThrow();
  });
  it('ignores non-tenant (global) models', () => {
    expect(() => assertTenantScoped('User', 'findMany', { where: {} })).not.toThrow();
  });
});
