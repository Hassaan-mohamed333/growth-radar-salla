export const ROLES = ['OWNER', 'AGENCY_ADMIN', 'MARKETER', 'CLIENT_VIEWER'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'tenant:manage', // billing, members, delete tenant
  'members:manage',
  'store:connect', // Salla connect / disconnect
  'store:read',
  'insights:read',
  'insights:act', // accept / dismiss recommendations
  'competitors:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Single source of truth for RBAC. Deny by default: unknown role/permission => false. */
const MATRIX: Record<Role, ReadonlySet<Permission>> = {
  OWNER: new Set(PERMISSIONS),
  AGENCY_ADMIN: new Set<Permission>([
    'members:manage',
    'store:connect',
    'store:read',
    'insights:read',
    'insights:act',
    'competitors:manage',
  ]),
  MARKETER: new Set<Permission>(['store:read', 'insights:read', 'insights:act', 'competitors:manage']),
  CLIENT_VIEWER: new Set<Permission>(['store:read', 'insights:read']),
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return MATRIX[role]?.has(permission) ?? false;
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
