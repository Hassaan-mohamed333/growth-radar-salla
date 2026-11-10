import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentSession, SessionGuard } from '../session/session.guard';
import type { SessionContext } from '../session/session.service';
import { type OnboardingResponse, OnboardingService } from './onboarding.service';

@Controller('api/v1/onboarding')
@UseGuards(SessionGuard)
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  get(@CurrentSession() s: SessionContext): Promise<OnboardingResponse> {
    return this.onboarding.get(s.storeId);
  }
}
