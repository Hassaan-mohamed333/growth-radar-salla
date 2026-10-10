import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { type SessionContext, SessionService } from './session.service';

type SessionRequest = Request & { session?: SessionContext };

/**
 * Requires a valid session cookie whose store still exists under the claimed
 * tenant, and exposes the context via `@CurrentSession()`. The store id is
 * therefore never taken from the request itself.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<SessionRequest>();
    const ctx = this.sessions.verify(this.sessions.readCookie(req));
    if (!ctx) throw new UnauthorizedException();

    const store = await this.prisma.store.findFirst({
      where: { id: ctx.storeId, tenantId: ctx.tenantId },
      select: { id: true },
    });
    if (!store) throw new UnauthorizedException();

    req.session = ctx;
    return true;
  }
}

export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionContext => {
    const req = context.switchToHttp().getRequest<SessionRequest>();
    if (!req.session) throw new UnauthorizedException();
    return req.session;
  },
);
