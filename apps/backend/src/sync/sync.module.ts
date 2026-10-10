import { Module } from '@nestjs/common';
import { SallaModule } from '../salla/salla.module';
import { OrderWebhookHandler } from './order-webhook.handler';
import { SalesSyncScheduler } from './sales-sync.scheduler';
import { SalesSyncService } from './sales-sync.service';

@Module({
  imports: [SallaModule],
  providers: [SalesSyncService, SalesSyncScheduler, OrderWebhookHandler],
  exports: [SalesSyncService, OrderWebhookHandler],
})
export class SyncModule {}
