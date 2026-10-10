import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { IS_PUBLIC } from './decorators';
import { SESSION_COOKIE, SessionService } from './session.service';
import type { TenantContext } from '../../infra/tenant-context';

export type AuthedRequest = FastifyRequest & { auth?: TenantContext };

/** Authentication: cookie (browser) or Bearer (API clients) -> verified session -> req.auth. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const token = bearer ?? (req.cookies?.[SESSION_COOKIE] as string | undefined);
    const auth = token ? await this.sessions.verify(token) : null;
    if (!auth) throw new UnauthorizedException();
    req.auth = auth;
    return true;
  }
}
