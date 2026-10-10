import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { OAuthStateService } from './oauth-state.service';
import { SallaApiClient } from './salla-api.client';
import { SallaClientService } from './salla-client.service';
import { SallaOAuthController } from './salla-oauth.controller';
import { SallaOnboardingService } from './salla-onboarding.service';
import { MAINTENANCE_QUEUE, MaintenanceProcessor, SallaSchedulerService } from './salla-scheduler.service';
import { SallaTokenService } from './salla-token.service';
import { SyncProcessor } from './sync.processor';
import { SyncService } from './sync.service';
import { SallaWebhookGuard } from './webhook.guard';
import { WebhookController } from './webhook.controller';
import { WebhookIngestService } from './webhook-ingest.service';
import { WebhookProcessor } from './webhook.processor';
import { APP_ROLE_WORKER } from '../config/role';
/** Workers are registered only when APP_ROLE is `worker` or `all`, so API pods can run with zero queue consumers. */
const workers = APP_ROLE_WORKER ? [SyncProcessor, WebhookProcessor, MaintenanceProcessor, SallaSchedulerService] : [];

@Module({
  imports: [BullModule.registerQueue({ name: MAINTENANCE_QUEUE })],
  controllers: [SallaOAuthController, WebhookController],
  providers: [
    OAuthStateService, SallaApiClient, SallaTokenService, SallaClientService,
    SallaOnboardingService, SyncService, WebhookIngestService, SallaWebhookGuard, ...workers,
  ],
  exports: [SyncService, SallaClientService],
})
export class SallaModule {}
