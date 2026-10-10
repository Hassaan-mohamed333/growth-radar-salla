import { Body, Controller, HttpCode, Logger, Post } from '@nestjs/common';
import { ProductWebhookHandler } from '../products/product-webhook.handler';
import { OrderWebhookHandler } from '../sync/order-webhook.handler';
import { SallaWebhook } from './salla-webhook.decorator';

interface SallaWebhookPayload {
  event: string;
  merchant?: number | string;
  created_at?: string;
  data?: unknown;
}

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly orders: OrderWebhookHandler,
    private readonly products: ProductWebhookHandler,
  ) {}

  @Post('salla')
  @HttpCode(200)
  @SallaWebhook()
  async handleSalla(@Body() payload: SallaWebhookPayload): Promise<{ status: string }> {
    // Log the event name and merchant only — payloads can contain tokens and PII.
    this.logger.log(`Salla event "${payload.event}" for merchant ${payload.merchant ?? 'n/a'}`);

    if (OrderWebhookHandler.handles(payload.event)) {
      await this.orders.handle(payload.merchant, payload.data);
    }
    if (ProductWebhookHandler.handles(payload.event)) {
      await this.products.handle(payload.event, payload.merchant, payload.data);
    }
    // TODO: app.store.authorize → SallaConnectionsService.saveTokens, app.uninstalled.
    // Keep handlers idempotent and fast; offload heavy work to a queue.
    return { status: 'ok' };
  }
}
