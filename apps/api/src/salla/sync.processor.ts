import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Prisma } from '@prisma/client';
import type { Job, Queue } from 'bullmq';
import { QUEUES } from '@radar/shared';
import { PiiService } from '../common/crypto/pii.service';
import { TenantDb } from '../infra/tenant-db.service';
import { mapCategory, mapOrder, mapProduct, paginationSchema } from './mappers';
import { sha256Hex } from './pkce';
import { SallaApiError } from './salla-api.client';
import { SallaAuthError } from './salla-token.service';
import { SallaClientService } from './salla-client.service';
import { SYNC_RESOURCES, SyncService, type SyncJob } from './sync.service';
import { UnrecoverableError } from 'bullmq';

const PER_PAGE = 50;
const MAX_PAGES = 200; // hard stop: 10k rows per resource per run for the MVP

@Processor(QUEUES.SALLA_SYNC, { concurrency: 4, limiter: { max: 5, duration: 1000 } }) // stay well under Salla rate limits
export class SyncProcessor extends WorkerHost {
  private readonly log = new Logger(SyncProcessor.name);
  constructor(
    private readonly salla: SallaClientService,
    private readonly db: TenantDb,
    private readonly pii: PiiService,
    private readonly sync: SyncService,
    @InjectQueue(QUEUES.CONFIDENCE_AUDIT) private readonly auditQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<SyncJob>): Promise<void> {
    const { tenantId, storeId, resource, page, runId } = job.data;
    let body: unknown;
    try {
      body = await this.salla.get(tenantId, storeId, `/${resource}`, { page, per_page: PER_PAGE });
    } catch (e) {
      if (e instanceof SallaApiError) throw e.toJobError();
      if (e instanceof SallaAuthError) throw new UnrecoverableError(e.message);
      throw e;
    }
    const parsed = paginationSchema.safeParse(body);
    if (!parsed.success) throw new UnrecoverableError('Unexpected Salla response shape');
    const { data, pagination } = parsed.data;
    const totalPages = Math.min(pagination?.totalPages ?? page, MAX_PAGES);

    await this.db.withTenant(tenantId, async (tx) => {
      // 1) Immutable evidence first: the exact page we received.
      await tx.rawIngestion.create({
        data: {
          tenantId, storeId, source: 'SALLA_API', requestRef: `${resource}?page=${page}&per_page=${PER_PAGE}`,
          payload: body as Prisma.InputJsonValue, payloadSha256: sha256Hex(JSON.stringify(body)),
        },
      });
      // 2) Normalised state, validated item by item (one bad item never poisons the page).
      let skipped = 0;
      for (const raw of data) {
        if (resource === 'orders') {
          const o = mapOrder(raw);
          if (!o) { skipped++; continue; }
          const row = {
            referenceId: o.referenceId, statusSlug: o.statusSlug, countsAsRevenue: o.countsAsRevenue,
            totalAmount: o.totalAmount, currency: o.currency, paymentMethod: o.paymentMethod,
            customerHash: o.customerId ? this.pii.pseudonymize(tenantId, o.customerId) : null,
            placedAt: o.placedAt, sallaUpdatedAt: o.sallaUpdatedAt, syncedAt: new Date(),
          };
          await tx.order.upsert({
            where: { storeId_sallaId: { storeId, sallaId: o.sallaId }, tenantId },
            create: { tenantId, storeId, sallaId: o.sallaId, ...row },
            update: row,
          });
        } else if (resource === 'products') {
          const p = mapProduct(raw);
          if (!p) { skipped++; continue; }
          const { sallaId, ...row } = p;
          await tx.product.upsert({
            where: { storeId_sallaId: { storeId, sallaId }, tenantId },
            create: { tenantId, storeId, sallaId, ...row },
            update: { ...row, syncedAt: new Date() },
          });
        } else {
          const c = mapCategory(raw);
          if (!c) { skipped++; continue; }
          const { sallaId, ...row } = c;
          await tx.category.upsert({
            where: { storeId_sallaId: { storeId, sallaId }, tenantId },
            create: { tenantId, storeId, sallaId, ...row },
            update: { ...row, syncedAt: new Date() },
          });
        }
      }
      if (skipped) this.log.warn(`${resource} page ${page}: skipped ${skipped} invalid items (store ${storeId})`);
    });

    // 3) Chain the next page / next resource / final step.
    if (page < totalPages && data.length > 0) {
      await this.sync.enqueue({ tenantId, storeId, runId, resource, page: page + 1 });
      return;
    }
    const next = SYNC_RESOURCES[SYNC_RESOURCES.indexOf(resource) + 1];
    if (next) {
      await this.sync.enqueue({ tenantId, storeId, runId, resource: next, page: 1 });
      return;
    }
    await this.db.withTenant(tenantId, (tx) =>
      tx.sallaConnection.updateMany({ where: { tenantId, storeId }, data: { lastSyncAt: new Date() } }),
    );
    await this.auditQueue.add('audit', { tenantId, storeId }, { jobId: `audit_${storeId}_${runId}` });
  }
}
