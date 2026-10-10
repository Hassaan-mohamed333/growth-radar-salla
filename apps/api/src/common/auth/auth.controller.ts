import { Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { roleHasPermission, PERMISSIONS } from '@radar/shared';
import { AuthCtx, RequirePermission } from './decorators';
import { SESSION_COOKIE } from './session.service';
import type { TenantContext } from '../../infra/tenant-context';

@Controller('auth')
export class AuthController {
  /** Who am I + what may I do (UI uses `permissions` only to hide controls; the API enforces regardless). */
  @Get('me')
  @RequirePermission('store:read')
  me(@AuthCtx() auth: TenantContext) {
    return {
      userId: auth.userId,
      tenantId: auth.tenantId,
      role: auth.role,
      storeScope: auth.storeScope,
      permissions: PERMISSIONS.filter((p) => roleHasPermission(auth.role, p)),
    };
  }

  @Post('logout')
  @HttpCode(204)
  @RequirePermission('store:read')
  logout(@Res({ passthrough: true }) reply: FastifyReply) {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
  }
}
