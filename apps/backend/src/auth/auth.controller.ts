import {
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { Env } from '../config/env';
import { CurrentSession, SessionGuard } from '../session/session.guard';
import { type SessionContext, SessionService } from '../session/session.service';
import { ProductSyncService } from '../products/product-sync.service';
import { SalesSyncService } from '../sync/sales-sync.service';
import { AuthService, type LoginFailure } from './auth.service';

const COOKIE = 'salla_oauth_state';
const COOKIE_PATH = '/api/v1/auth/salla';
const COOKIE_MAX_AGE_MS = 10 * 60 * 1000;

@Controller('api/v1/auth/salla')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
    private readonly sessions: SessionService,
    private readonly salesSync: SalesSyncService,
    private readonly productSync: ProductSyncService,
  ) {}

  /** Starts the flow: sets the state cookie and redirects to Salla's consent screen. */
  @Get('login')
  async login(@Res() res: Response): Promise<void> {
    const { authorizeUrl, state } = await this.auth.startLogin();
    res.cookie(COOKIE, state, {
      httpOnly: true,
      secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
      sameSite: 'lax', // callback is a top-level GET navigation from accounts.salla.sa
      path: COOKIE_PATH,
      maxAge: COOKIE_MAX_AGE_MS,
    });
    res.redirect(302, authorizeUrl);
  }

  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') providerError: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // One-shot cookie: clear it whatever the outcome.
    res.clearCookie(COOKIE, { path: COOKIE_PATH });

    if (providerError) return this.fail(res, 'exchange_failed');
    if (typeof code !== 'string' || typeof state !== 'string' || !code || !state) {
      return this.fail(res, 'invalid_state');
    }

    const verifier = await this.auth.consumeState(state, readCookie(req, COOKIE));
    if (!verifier) return this.fail(res, 'invalid_state');

    let login;
    try {
      login = await this.auth.completeLogin(code, verifier);
    } catch (err) {
      // Log the class/step only; error objects from the token exchange must not carry secrets.
      this.logger.error(`Salla OAuth callback failed: ${err instanceof Error ? err.name : 'error'}`);
      return this.fail(res, 'exchange_failed');
    }

    this.sessions.setCookie(res, { tenantId: login.tenantId, storeId: login.storeId });
    // Fire-and-forget first sync so the dashboard has data soon; the scheduler retries on failure.
    void this.salesSync.syncStore(login.storeId).catch((err: unknown) => {
      this.logger.warn(`Initial sales sync failed: ${err instanceof Error ? err.name : 'error'}`);
    });
    void this.productSync.syncStore(login.storeId).catch((err: unknown) => {
      this.logger.warn(`Initial product sync failed: ${err instanceof Error ? err.name : 'error'}`);
    });
    res.redirect(302, `${this.frontendOrigin()}/?connected=1`);
  }

  private fail(res: Response, reason: LoginFailure): void {
    // Fixed vocabulary only — never reflect request input into the redirect.
    res.redirect(302, `${this.frontendOrigin()}/?auth_error=${reason}`);
  }

  private frontendOrigin(): string {
    return this.config.get('FRONTEND_ORIGIN', { infer: true }).replace(/\/$/, '');
  }
}

/** Session lifecycle for the dashboard (separate from the Salla OAuth routes above). */
@Controller('api/v1/auth')
export class SessionController {
  constructor(private readonly sessions: SessionService) {}

  /** Who am I — 401 when there is no valid session. */
  @Get('session')
  @UseGuards(SessionGuard)
  current(@CurrentSession() session: SessionContext): SessionContext {
    return session;
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response): void {
    this.sessions.clearCookie(res);
  }
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0 && part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        // Broken percent-encoding. Treated as "no cookie" so the caller answers with the
        // controlled invalid_state redirect instead of a 500.
        return undefined;
      }
    }
  }
  return undefined;
}
