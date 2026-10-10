import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { roleHasPermission, type Permission } from '@radar/shared';
import { IS_PUBLIC, PERMISSION_KEY } from './decorators';
import type { AuthedRequest } from './session.guard';

/**
 * Authorization (RBAC). Deny-by-default: an authenticated route that forgets @RequirePermission is a 403,
 * so a missing annotation can never silently expose data.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const required = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION_KEY, targets);
    const auth = context.switchToHttp().getRequest<AuthedRequest>().auth;
    if (!required || !auth || !roleHasPermission(auth.role, required)) throw new ForbiddenException();
    return true;
  }
}
