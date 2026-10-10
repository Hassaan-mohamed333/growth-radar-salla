import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { QUEUES, type SallaWebhookEnvelope } from '@radar/shared';
import { REDIS } from '../infra/redis.module';
import { SystemDb } from '../infra/system-db.service';
import { TenantDb } from '../infra/tenant-db.service';
import { sha256Hex } from './pkce';

const IDEMPOTENCY_TTL_S = 72 * 3600;
/** Events whose body carries credentials: we persist a redacted copy and never queue them. */
const CREDENTIAL_EVENTS = new Set(['app.store.authorize']);
const SAFE_HEADERS = ['user-agent', 'content-type', 'x-salla-security-strategy'];

export interface WebhookJob {
  tenantId: string;
  storeId: string;
  webhookEventId: string;
}

@Injectable()
export class WebhookIngestService {
  private readonly log = new Logger(WebhookIngestService.name);
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @InjectQueue(QUEUES.SALLA_WEBHOOK) private readonly queue: Queue<WebhookJob>,
    private readonly system: SystemDb,
    private readonly db: TenantDb,
  ) {}

  /**
   * Called only AFTER HMAC verification + schema validation.
   * Idempotency: key = sha256(exact body). Salla retries re-send identical bytes (body includes created_at),
   * so identical bytes == the same delivery. Layers: Redis SET NX (fast path) -> UNIQUE(idempotency_key) in
   * Postgres (durable) -> BullMQ jobId (queue-level). Any layer alone prevents double execution.
   */
  async ingest(raw: Buffer, envelope: SallaWebhookEnvelope, headers: Record<string, unknown>): Promise<'accepted' | 'duplicate' | 'unknown_merchant'> {
    const sha = sha256Hex(raw);
    const key = `salla:${sha}`;

    const owner = await this.system.resolveMerchant(envelope.merchant);
    if (!owner || owner.status === 'REVOKED') {
      this.log.warn(`Webhook for unknown/revoked merchant ${envelope.merchant}`);
      return 'unknown_merchant'; // 200 so Salla stops retrying; nothing is stored without a tenant
    }
    const { tenant_id: tenantId, store_id: storeId } = owner;

    const claimed = await this.redis.set(`idem:${key}`, '1', 'EX', IDEMPOTENCY_TTL_S, 'NX');
    if (!claimed) return 'duplicate';

    try {
      const credential = CREDENTIAL_EVENTS.has(envelope.event);
      let rowId: string;
      try {
        const row = await this.db.withTenant(tenantId, (tx) =>
          tx.webhookEvent.create({
            data: {
              tenantId,
              storeId,
              idempotencyKey: key,
              event: envelope.event,
              sallaMerchantId: envelope.merchant,
              rawBody: credential ? redact(raw.toString('utf8')) : raw.toString('utf8'),
              bodySha256: sha,
              headers: pick(headers) as Prisma.InputJsonValue,
              status: credential ? 'IGNORED' : 'RECEIVED',
            },
            select: { id: true },
          }),
        );
        rowId = row.id;
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
        // Row already exists (Redis key was lost/expired). Only re-enqueue if it never made it onto the queue.
        const existing = await this.db.withTenant(tenantId, (tx) =>
          tx.webhookEvent.findFirst({ where: { tenantId, idempotencyKey: key }, select: { id: true, status: true } }),
        );
        if (!existing || existing.status !== 'RECEIVED') return 'duplicate';
        rowId = existing.id;
      }
      if (credential) return 'accepted';

      await this.queue.add(envelope.event, { tenantId, storeId, webhookEventId: rowId }, { jobId: sha });
      await this.db.withTenant(tenantId, (tx) =>
        tx.webhookEvent.updateMany({ where: { tenantId, id: rowId, status: 'RECEIVED' }, data: { status: 'QUEUED' } }),
      );
      return 'accepted';
    } catch (e) {
      await this.redis.del(`idem:${key}`); // let Salla's retry run again; DB unique key still prevents duplicates
      throw e;
    }
  }
}

function pick(h: Record<string, unknown>) {
  return Object.fromEntries(SAFE_HEADERS.filter((k) => typeof h[k] === 'string').map((k) => [k, String(h[k]).slice(0, 200)]));
}

function redact(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), (k, v) => (/token|secret/i.test(k) ? '[REDACTED]' : v));
  } catch {
    return '[REDACTED: unparseable credential event]';
  }
}
