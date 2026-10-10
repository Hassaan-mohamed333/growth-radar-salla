import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QUEUES } from '@radar/shared';
import { SystemDb } from '../infra/system-db.service';
import { SallaTokenService } from './salla-token.service';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';

export const MAINTENANCE_QUEUE = 'maintenance';

/** Repeatable jobs: proactively refresh Salla tokens, and run the nightly Data Confidence audit. */
@Injectable()
export class SallaSchedulerService implements OnModuleInit {
  constructor(@InjectQueue(MAINTENANCE_QUEUE) private readonly queue: Queue) {}
  async onModuleInit() {
    await this.queue.upsertJobScheduler('refresh-tokens', { every: 15 * 60_000 }, { name: 'refresh-tokens' });
    await this.queue.upsertJobScheduler('nightly-audit', { pattern: '0 2 * * *', tz: 'Asia/Riyadh' }, { name: 'nightly-audit' });
  }
}

@Processor(MAINTENANCE_QUEUE, { concurrency: 1 })
export class MaintenanceProcessor extends WorkerHost {
  private readonly log = new Logger(MaintenanceProcessor.name);
  constructor(
    private readonly system: SystemDb,
    private readonly tokens: SallaTokenService,
    @InjectQueue(QUEUES.CONFIDENCE_AUDIT) private readonly audits: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === 'refresh-tokens') {
      for (const c of await this.system.listExpiringConnections(60)) {
        try {
          await this.tokens.getAccessToken(c.tenant_id, c.store_id, false); // refreshes only if inside the skew window
        } catch (e) {
          this.log.warn(`Proactive refresh failed for store ${c.store_id}: ${e instanceof Error ? e.name : 'error'}`);
        }
      }
    } else if (job.name === 'nightly-audit') {
      const day = new Date().toISOString().slice(0, 10);
      for (const c of await this.system.listActiveConnections()) {
        await this.audits.add('audit', { tenantId: c.tenant_id, storeId: c.store_id }, { jobId: `audit_${c.store_id}_${day}` });
      }
    }
  }
}
