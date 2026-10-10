import { BadRequestException, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { sallaWebhookEnvelopeSchema } from '@radar/shared';
import { Public } from '../common/auth/decorators';
import { SallaWebhookGuard } from './webhook.guard';
import { WebhookIngestService } from './webhook-ingest.service';

export const WEBHOOK_PATH = '/salla/webhooks';

@Controller('salla/webhooks')
export class WebhookController {
  constructor(private readonly ingest: WebhookIngestService) {}

  // Global ThrottlerGuard runs first (per-IP, Redis-backed) so unauthenticated floods are cut before HMAC work.
  @Public()
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @UseGuards(SallaWebhookGuard) // verifies HMAC over the raw bytes
  @Post()
  @HttpCode(200)
  async receive(@Req() req: FastifyRequest): Promise<{ ok: true }> {
    const raw = req.body as Buffer; // guard guarantees a Buffer; JSON has NOT been parsed until this line
    let json: unknown;
    try {
      json = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new BadRequestException();
    }
    const envelope = sallaWebhookEnvelopeSchema.safeParse(json);
    if (!envelope.success) throw new BadRequestException();
    await this.ingest.ingest(raw, envelope.data, req.headers);
    return { ok: true }; // identical response for accepted / duplicate / unknown merchant
  }
}
