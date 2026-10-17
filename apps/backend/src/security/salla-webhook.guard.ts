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
 * Identity of one Salla event. Salla resends an event with a re-serialised body,
 * so hashing the raw bytes lets a resend through as a new event. The event's own
 * fields identify it instead. `created_at` has one-second precision, so the data
 * hash keeps two changes to one product in the same second apart; a resend carries
 * identical data and still matches. Bodies that don't fit this shape fall back to
 * a hash of the raw bytes.
 */
export function webhookIdempotencyKey(rawBody: Buffer): string {
  const rawKey = `salla:webhook:v2:raw:${sha256(rawBody)}`;

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return rawKey;
  }
  if (!isRecord(payload) || !isRecord(payload.data)) return rawKey;

  const { event, merchant, created_at: createdAt, data } = payload;
  const dataId = data.id;
  if (
    typeof event !== 'string' ||
    typeof createdAt !== 'string' ||
    !isScalarId(merchant) ||
    !isScalarId(dataId)
  ) {
    return rawKey;
  }

  const identity = JSON.stringify([
    event,
    String(merchant),
    String(dataId),
    createdAt,
    sha256(stableStringify(data)),
  ]);
  return `salla:webhook:v2:${sha256(identity)}`;
}

function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isScalarId(value: unknown): value is string | number {
  return (
    (typeof value === 'number' && Number.isFinite(value)) ||
    (typeof value === 'string' && value !== '')
  );
}

/** JSON with object keys sorted, so the same content always produces the same string. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

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
    const idempotencyKey = webhookIdempotencyKey(rawBody);
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
