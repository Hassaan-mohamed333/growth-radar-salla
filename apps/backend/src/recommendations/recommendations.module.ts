import { Module } from '@nestjs/common';
import { SessionModule } from '../session/session.module';
import { RecommendationEngineService } from './recommendation-engine.service';
import { RecommendationScheduler } from './recommendation.scheduler';
import { RecommendationsController } from './recommendations.controller';
import { RecommendationsService } from './recommendations.service';

@Module({
  imports: [SessionModule],
  controllers: [RecommendationsController],
  providers: [RecommendationsService, RecommendationEngineService, RecommendationScheduler],
  exports: [RecommendationEngineService],
})
export class RecommendationsModule {}
