import { Module } from '@nestjs/common';
import { APP_ROLE_WORKER } from '../config/role';
import { ConfidenceProcessor } from './confidence.processor';
import { ConfidenceService } from './confidence.service';
import { RecommendationEngine } from './recommendation.engine';

@Module({
  providers: [ConfidenceService, RecommendationEngine, ...(APP_ROLE_WORKER ? [ConfidenceProcessor] : [])],
  exports: [ConfidenceService],
})
export class ConfidenceModule {}
