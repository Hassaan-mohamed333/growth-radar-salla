import { Module } from '@nestjs/common';
import { SallaModule } from '../salla/salla.module';
import { SessionModule } from '../session/session.module';
import { ProductSyncScheduler } from './product-sync.scheduler';
import { ProductSyncService } from './product-sync.service';
import { ProductWebhookHandler } from './product-webhook.handler';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [SallaModule, SessionModule],
  controllers: [ProductsController],
  providers: [ProductsService, ProductSyncService, ProductSyncScheduler, ProductWebhookHandler],
  exports: [ProductSyncService, ProductWebhookHandler],
})
export class ProductsModule {}
