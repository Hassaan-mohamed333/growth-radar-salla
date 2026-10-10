import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Permission } from '@radar/shared';
import { currentTenant } from '../../infra/tenant-context';

export const IS_PUBLIC = 'isPublic';
/** Opt-out of the global session guard. Every route is authenticated by default (deny by default). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const PERMISSION_KEY = 'requiredPermission';
/** Declares the RBAC permission a route needs. Routes without one are rejected by PermissionsGuard. */
export const RequirePermission = (p: Permission) => SetMetadata(PERMISSION_KEY, p);

export const AuthCtx = createParamDecorator((_: unknown, _ctx: ExecutionContext) => currentTenant());
