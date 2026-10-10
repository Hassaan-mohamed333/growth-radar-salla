import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUES, sallaWebhookEnvelopeSchema } from '@radar/shared';
import { PiiService } from '../common/crypto/pii.service';
import { TenantDb } from '../infra/tenant-db.service';
import type { Tx } from '../infra/prisma.service';
import { mapCategory, mapOrder, mapProduct } from './mappers';
import type { WebhookJob } from './webhook-ingest.service';

/** Placeholder that satisfies the envelope CHECK but can never decrypt: used to destroy tokens on uninstall. */
const DEAD_ENVELOPE = 'v1.revoked.AAAA.AAAA.AAAA';

@Processor(QUEUES.SALLA_WEBHOOK, { concurrency: 10 })
export class WebhookProcessor extends WorkerHost {
  private readonly log = new Logger(WebhookProcessor.name);
  constructor(private readonly db: TenantDb, private readonly pii: PiiService) {
    super();
  }

  async process(job: Job<WebhookJob>): Promise<void> {
    const { tenantId, storeId, webhookEventId } = job.data;
    const maxAttempts = job.opts.attempts ?? 1;
    try {
      await this.db.withTenant(tenantId, async (tx) => {
        const ev = await tx.webhookEvent.findFirst({ where: { tenantId, id: webhookEventId } });
        if (!ev || ev.status === 'PROCESSED') return; // idempotent re-delivery
        await tx.webhookEvent.updateMany({ where: { tenantId, id: ev.id }, data: { attempts: { increment: 1 } } });

        const env = sallaWebhookEnvelopeSchema.parse(JSON.parse(ev.rawBody));
        const handled = await this.dispatch(tx, tenantId, storeId, env.event, env.data);
        await tx.webhookEvent.updateMany({
          where: { tenantId, id: ev.id },
          data: { status: handled ? 'PROCESSED' : 'IGNORED', processedAt: new Date(), lastError: null },
        });
      });
    } catch (e) {
      if (job.attemptsMade + 1 >= maxAttempts) {
        // Final failure: record a short, payload-free reason for operators.
        await this.db.withTenant(tenantId, (tx) =>
          tx.webhookEvent.updateMany({
            where: { tenantId, id: webhookEventId },
            data: { status: 'FAILED', lastError: (e instanceof Error ? e.name + ': ' + e.message : 'error').slice(0, 500) },
          }),
        );
      }
      throw e;
    }
  }

  private async dispatch(tx: Tx, tenantId: string, storeId: string, event: string, data: unknown): Promise<boolean> {
    if (event.startsWith('order.')) {
      const o = mapOrder(data);
      if (!o) throw new Error('order payload failed validation');
      const existing = await tx.order.findFirst({ where: { tenantId, storeId, sallaId: o.sallaId }, select: { sallaUpdatedAt: true } });
      // Webhooks can arrive out of order: never let an older snapshot overwrite a newer one.
      if (existing?.sallaUpdatedAt && o.sallaUpdatedAt && o.sallaUpdatedAt < existing.sallaUpdatedAt) return true;
      const row = {
        referenceId: o.referenceId, statusSlug: o.statusSlug,
        countsAsRevenue: event === 'order.deleted' ? false : o.countsAsRevenue,
        totalAmount: o.totalAmount, currency: o.currency, paymentMethod: o.paymentMethod,
        customerHash: o.customerId ? this.pii.pseudonymize(tenantId, o.customerId) : null,
        placedAt: o.placedAt, sallaUpdatedAt: o.sallaUpdatedAt, syncedAt: new Date(),
      };
      await tx.order.upsert({
        where: { storeId_sallaId: { storeId, sallaId: o.sallaId }, tenantId },
        create: { tenantId, storeId, sallaId: o.sallaId, ...row }, update: row,
      });
      return true;
    }
    if (event.startsWith('product.')) {
      const p = mapProduct(data);
      if (!p) throw new Error('product payload failed validation');
      if (event === 'product.deleted') {
        await tx.product.deleteMany({ where: { tenantId, storeId, sallaId: p.sallaId } });
        return true;
      }
      const { sallaId, ...row } = p;
      await tx.product.upsert({
        where: { storeId_sallaId: { storeId, sallaId }, tenantId },
        create: { tenantId, storeId, sallaId, ...row }, update: { ...row, syncedAt: new Date() },
      });
      return true;
    }
    if (event.startsWith('category.')) {
      const c = mapCategory(data);
      if (!c) throw new Error('category payload failed validation');
      if (event === 'category.deleted') {
        await tx.category.deleteMany({ where: { tenantId, storeId, sallaId: c.sallaId } });
        return true;
      }
      const { sallaId, ...row } = c;
      await tx.category.upsert({
        where: { storeId_sallaId: { storeId, sallaId }, tenantId },
        create: { tenantId, storeId, sallaId, ...row }, update: { ...row, syncedAt: new Date() },
      });
      return true;
    }
    if (event === 'app.uninstalled') {
      await tx.sallaConnection.updateMany({
        where: { tenantId, storeId },
        data: { status: 'REVOKED', revokedAt: new Date(), accessTokenEnc: DEAD_ENVELOPE, refreshTokenEnc: null },
      });
      this.log.log(`Store ${storeId} uninstalled the app; tokens destroyed`);
      return true;
    }
    return false; // unsubscribed/unknown event: kept as evidence, not processed
  }
}
