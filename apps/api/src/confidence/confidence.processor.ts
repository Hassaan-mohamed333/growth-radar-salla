import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { QUEUES } from '@radar/shared';
import { ConfidenceService } from './confidence.service';

@Processor(QUEUES.CONFIDENCE_AUDIT, { concurrency: 4 })
export class ConfidenceProcessor extends WorkerHost {
  constructor(private readonly svc: ConfidenceService) {
    super();
  }
  async process(job: Job<{ tenantId: string; storeId: string }>): Promise<void> {
    await this.svc.audit(job.data.tenantId, job.data.storeId);
  }
}
