import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import type { Request } from 'express';
import { SessionService } from './session.service';

/**
 * Rate limit per merchant store when the request carries a valid session, per client IP otherwise.
 *
 * Why not IP alone: the dashboard's server calls the API on the merchant's behalf and its browser
 * traffic is rewritten through Vercel, so on the API side many merchants can arrive from the same
 * few addresses. One IP bucket would then be shared by everyone, and one busy merchant (or one
 * script) would lock everybody out. A verified session names the caller exactly.
 *
 * The cookie is only trusted after its signature is verified, so a forged or random value cannot
 * pick a bucket: it falls back to the IP bucket like any anonymous request.
 */
@Injectable()
export class SessionThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly sessions: SessionService,
  ) {
    super(options, storageService, reflector);
  }

  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const session = this.sessions.verify(this.sessions.readCookie(req as unknown as Request));
    return session ? `store:${session.storeId}` : super.getTracker(req);
  }
}
