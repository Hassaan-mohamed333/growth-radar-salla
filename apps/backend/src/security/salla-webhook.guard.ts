import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Env } from '../config/env';
import { WebhookIdempotencyService } from './webhook-idempotency.service';

export interface SallaWebhookContext {
  idempotencyKey: string;
  /** True when this exact delivery was already processed/is in flight. */
  duplicate: boolean;
}

export type SallaWebhookRequest = Request & {
  rawBody?: Buffer;
  sallaWebhook?: SallaWebhookContext;
};

const HEX_SHA256 = /^[0-9a-f]{64}$/i;

/**
 * Verifies Salla webhooks, then claims an idempotency slot in Redis.
 *
 * - "signature" strategy: hex HMAC-SHA256 of the *raw* request body using the
 *   webhook secret, sent in `X-Salla-Signature`.
 * - "token" strategy: the shared secret is sent in `Authorization`.
 *
 * The strategy is fixed by server config. The request's own
 * `X-Salla-Security-Strategy` header is never used to pick it, so an attacker
 * can't downgrade verification.
 *
 * Requires `rawBody: true` in NestFactory.create().
 */
@Injectable()
export class SallaWebhookGuard implements CanActivate {
  private readonly logger = new Logger(SallaWebhookGuard.name);
  private readonly secret: Buffer;
  private readonly strategy: Env['SALLA_WEBHOOK_STRATEGY'];

  constructor(
    config: ConfigService<Env, true>,
    private readonly idempotency: WebhookIdempotencyService,
  ) {
    this.secret = Buffer.from(config.get<string>('SALLA_WEBHOOK_SECRET'), 'utf8');
    this.strategy = config.get('SALLA_WEBHOOK_STRATEGY', { infer: true });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<SallaWebhookRequest>();

    const rawBody = req.rawBody;
    if (!rawBody || rawBody.length === 0) {
      throw new BadRequestException('Missing request body');
    }

    if (!this.isAuthentic(req, rawBody)) {
      this.logger.warn(`Rejected webhook with invalid ${this.strategy} from ${req.ip}`);
      throw new UnauthorizedException('Invalid webhook credentials');
    }

    // Authenticity first, so unauthenticated callers can never write to Redis.
    const idempotencyKey = `salla:webhook:v1:${createHash('sha256').update(rawBody).digest('hex')}`;
    const first = await this.idempotency.begin(idempotencyKey);
    req.sallaWebhook = { idempotencyKey, duplicate: !first };

    return true;
  }

  private isAuthentic(req: SallaWebhookRequest, rawBody: Buffer): boolean {
    if (this.strategy === 'signature') {
      const header = req.header('x-salla-signature');
      if (!header || !HEX_SHA256.test(header)) return false;
      const expected = createHmac('sha256', this.secret).update(rawBody).digest();
      return timingSafeEqual(expected, Buffer.from(header, 'hex'));
    }

    const auth = req.header('authorization');
    if (!auth) return false;
    const presented = Buffer.from(auth.replace(/^Bearer\s+/i, '').trim(), 'utf8');
    // Compare fixed-length digests so length differences don't leak via timing.
    const a = createHash('sha256').update(presented).digest();
    const b = createHash('sha256').update(this.secret).digest();
    return timingSafeEqual(a, b);
  }
}
