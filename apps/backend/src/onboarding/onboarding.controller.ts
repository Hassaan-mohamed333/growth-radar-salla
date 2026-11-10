import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentSession, SessionGuard } from '../session/session.guard';
import type { SessionContext } from '../session/session.service';
import { type OnboardingResponse, OnboardingService, type StartResponse } from './onboarding.service';

@Controller('api/v1/onboarding')
@UseGuards(SessionGuard)
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  /** Adds the best few competitors when none are tracked yet; the page then compares prices. */
  @Post('start')
  @HttpCode(200)
  @Throttle({ default: { limit: 4, ttl: 60_000 } })
  start(@CurrentSession() s: SessionContext): Promise<StartResponse> {
    return this.onboarding.start(s);
  }

  @Get()
  get(@CurrentSession() s: SessionContext): Promise<OnboardingResponse> {
    return this.onboarding.get(s.storeId);
  }
}
