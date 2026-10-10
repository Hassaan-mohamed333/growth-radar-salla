import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ENV, type Env } from '../config/env';
import { verifySallaWebhook } from './webhook-verify';

/**
 * Runs BEFORE any JSON parsing: main.ts registers a content-type parser that hands this route the untouched
 * Buffer. Failure responses are identical and body-less so they leak nothing about why verification failed.
 */
@Injectable()
export class SallaWebhookGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    if (!Buffer.isBuffer(req.body)) throw new BadRequestException();
    const ok = verifySallaWebhook({
      strategy: this.env.SALLA_WEBHOOK_STRATEGY,
      secret: this.env.SALLA_WEBHOOK_SECRET,
      rawBody: req.body,
      signatureHeader: header(req, 'x-salla-signature'),
      authorizationHeader: header(req, 'authorization'),
    });
    if (!ok) throw new UnauthorizedException();
    return true;
  }
}

const header = (req: FastifyRequest, name: string) => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};
