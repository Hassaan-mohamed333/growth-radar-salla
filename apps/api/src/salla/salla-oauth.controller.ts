import { Controller, Get, Inject, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Public } from '../common/auth/decorators';
import { SESSION_COOKIE, SessionService } from '../common/auth/session.service';
import { ENV, type Env } from '../config/env';
import { OAUTH_NONCE_COOKIE, OAuthStateService } from './oauth-state.service';
import { AccessDeniedError, SallaOnboardingService } from './salla-onboarding.service';
import { SallaTokenService } from './salla-token.service';
import { Logger } from '@nestjs/common';

const callbackQuery = z.object({
  code: z.string().min(1).max(2048).optional(),
  state: z.string().min(16).max(128).optional(),
  error: z.string().max(100).optional(),
});

@Controller('salla/oauth')
export class SallaOAuthController {
  private readonly log = new Logger(SallaOAuthController.name);
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly states: OAuthStateService,
    private readonly tokens: SallaTokenService,
    private readonly onboarding: SallaOnboardingService,
    private readonly sessions: SessionService,
  ) {}

  /** Step 1: redirect the merchant to Salla's consent screen (Authorization Code + PKCE S256 + state). */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('connect')
  async connect(@Res() reply: FastifyReply) {
    const { state, nonce, challenge, ttlSeconds } = await this.states.begin();
    const url = new URL(this.env.SALLA_AUTH_URL);
    url.searchParams.set('client_id', this.env.SALLA_CLIENT_ID);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', `${this.env.APP_URL}/salla/oauth/callback`);
    url.searchParams.set('scope', this.env.SALLA_SCOPES);
    url.searchParams.set('state', state);
    if (this.env.SALLA_USE_PKCE) {
      url.searchParams.set('code_challenge', challenge);
      url.searchParams.set('code_challenge_method', 'S256');
    }
    reply
      .setCookie(OAUTH_NONCE_COOKIE, nonce, {
        httpOnly: true, secure: this.env.NODE_ENV === 'production', sameSite: 'lax', path: '/salla/oauth', maxAge: ttlSeconds,
      })
      .header('Cache-Control', 'no-store')
      .redirect(url.toString(), 302);
  }

  /** Step 2: validate state+nonce, exchange the code server-side, provision the tenant, start our own session. */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('callback')
  async callback(@Query() rawQuery: unknown, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    const fail = (reason: 'denied' | 'invalid' | 'forbidden' | 'failed') => {
      reply.clearCookie(OAUTH_NONCE_COOKIE, { path: '/salla/oauth' });
      return reply.header('Cache-Control', 'no-store').redirect(`${this.env.WEB_URL}/login?error=${reason}`, 302); // fixed codes only
    };
    const q = callbackQuery.safeParse(rawQuery);
    if (!q.success || !q.data.state) return fail('invalid');
    if (q.data.error) return fail('denied');
    if (!q.data.code) return fail('invalid');

    const verifier = await this.states.consume(q.data.state, req.cookies?.[OAUTH_NONCE_COOKIE]);
    if (!verifier) return fail('invalid'); // unknown, expired, replayed, or started in another browser

    try {
      const tokens = await this.tokens.exchangeCode(q.data.code, this.env.SALLA_USE_PKCE ? verifier : null);
      const info = await this.onboarding.fetchUserInfo(tokens.access_token);
      const ctx = await this.onboarding.complete(tokens, info);
      const jwt = await this.sessions.issue(ctx);
      reply.clearCookie(OAUTH_NONCE_COOKIE, { path: '/salla/oauth' });
      return reply
        .setCookie(SESSION_COOKIE, jwt, this.sessions.cookieOptions())
        .header('Cache-Control', 'no-store')
        .redirect(`${this.env.WEB_URL}/dashboard`, 302);
    } catch (e) {
      this.log.error(`OAuth callback failed: ${e instanceof Error ? e.name : 'unknown'}`); // class only: messages may carry data
      return fail(e instanceof AccessDeniedError ? 'forbidden' : 'failed');
    }
  }
}
