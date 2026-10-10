import { Module } from '@nestjs/common';
import { SallaWebhookGuard } from '../security/salla-webhook.guard';
import { WebhookIdempotencyInterceptor } from './webhook-idempotency.interceptor';
import { WebhookIdempotencyService } from '../security/webhook-idempotency.service';
import { ProductsModule } from '../products/products.module';
import { SyncModule } from '../sync/sync.module';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [SyncModule, ProductsModule],
  controllers: [WebhooksController],
  providers: [WebhookIdempotencyService, SallaWebhookGuard, WebhookIdempotencyInterceptor],
})
export class WebhooksModule {}
