import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QUEUES } from '@radar/shared';

export const SYNC_RESOURCES = ['categories', 'products', 'orders'] as const;
export type SyncResource = (typeof SYNC_RESOURCES)[number];

export interface SyncJob {
  tenantId: string;
  storeId: string;
  runId: string;
  resource: SyncResource;
  page: number;
}

@Injectable()
export class SyncService {
  constructor(@InjectQueue(QUEUES.SALLA_SYNC) private readonly queue: Queue<SyncJob>) {}

  /** Kick off a full paginated sync. Each page is its own job => independently retried and resumable. */
  start(tenantId: string, storeId: string) {
    return this.enqueue({ tenantId, storeId, runId: Date.now().toString(36), resource: 'categories', page: 1 });
  }

  enqueue(job: SyncJob) {
    return this.queue.add('sync-page', job, {
      jobId: `${job.storeId}_${job.runId}_${job.resource}_${job.page}`, // dedupes accidental double-enqueue
    });
  }
}
