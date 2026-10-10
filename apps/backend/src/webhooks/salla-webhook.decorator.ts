import { UseGuards, UseInterceptors, applyDecorators } from '@nestjs/common';
import { SallaWebhookGuard } from '../security/salla-webhook.guard';
import { WebhookIdempotencyInterceptor } from './webhook-idempotency.interceptor';

/** Apply to a route that receives Salla webhooks: HMAC verification + idempotency. */
export const SallaWebhook = () =>
  applyDecorators(UseGuards(SallaWebhookGuard), UseInterceptors(WebhookIdempotencyInterceptor));
