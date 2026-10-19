import { Module } from '@nestjs/common';
import { CompetitorsModule } from '../competitors/competitors.module';
import { SessionModule } from '../session/session.module';
import { CompetitorInsightsController } from './competitor-insights.controller';
import { CompetitorInsightsService } from './competitor-insights.service';

@Module({
  imports: [SessionModule, CompetitorsModule],
  controllers: [CompetitorInsightsController],
  providers: [CompetitorInsightsService],
})
export class CompetitorInsightsModule {}
