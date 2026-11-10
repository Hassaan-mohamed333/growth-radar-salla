import { Module } from '@nestjs/common';
import { CompetitorInsightsModule } from '../competitor-insights/competitor-insights.module';
import { SessionModule } from '../session/session.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

@Module({
  imports: [SessionModule, CompetitorInsightsModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
