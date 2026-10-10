import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { Env } from '../config/env';

const AUTHORIZE_URL = 'https://accounts.salla.sa/oauth2/auth';
const TOKEN_URL = 'https://accounts.salla.sa/oauth2/token';
const USER_INFO_URL = 'https://accounts.salla.sa/oauth2/user/info';
const HTTP_TIMEOUT_MS = 10_000;

const tokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.coerce.number().int().positive().optional(),
  scope: z.string().optional(),
});

const userInfoResponse = z.object({
  data: z.object({
    merchant: z.object({
      id: z.union([z.string(), z.number()]).transform(String),
      name: z.string().nullish(),
      username: z.string().nullish(),
      domain: z.string().nullish(),
    }),
  }),
});

export interface SallaTokenResult {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
}

export interface SallaMerchant {
  id: string;
  name: string;
  domain: string | null;
}

export class SallaOAuthError extends Error {
  constructor(
    readonly step: 'token' | 'userinfo',
    message: string,
    /** HTTP status from Salla, when the failure came from a response. */
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SallaOAuthError';
  }
}

/** Thin HTTP layer for Salla's OAuth 2.0 endpoints. Never logs request/response bodies. */
@Injectable()
export class SallaOAuthClient {
  private readonly logger = new Logger(SallaOAuthClient.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  buildAuthorizeUrl(params: { state: string; codeChallenge: string }): string {
    const url = new URL(AUTHORIZE_URL);
    url.search = new URLSearchParams({
      client_id: this.config.get('SALLA_CLIENT_ID', { infer: true }),
      response_type: 'code',
      redirect_uri: this.config.get('SALLA_REDIRECT_URI', { infer: true }),
      scope: this.config.get('SALLA_OAUTH_SCOPES', { infer: true }),
      state: params.state,
      code_challenge: params.codeChallenge,
      code_challenge_method: 'S256',
    }).toString();
    return url.toString();
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<SallaTokenResult> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.config.get('SALLA_CLIENT_ID', { infer: true }),
      client_secret: this.config.get('SALLA_CLIENT_SECRET', { infer: true }),
      redirect_uri: this.config.get('SALLA_REDIRECT_URI', { infer: true }),
      code,
      code_verifier: codeVerifier,
    });

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) {
      this.logger.warn(`Salla token endpoint responded ${res.status}`);
      throw new SallaOAuthError('token', `Token exchange failed (${res.status})`);
    }

    const parsed = tokenResponse.safeParse(await res.json());
    if (!parsed.success) throw new SallaOAuthError('token', 'Unexpected token response shape');
    const t = parsed.data;

    return {
      accessToken: t.access_token,
      refreshToken: t.refresh_token ?? null,
      expiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null,
      scopes: t.scope ? t.scope.split(/[\s,]+/).filter(Boolean) : [],
    };
  }

  /** Refresh-token grant. Salla may rotate the refresh token, so callers must persist the result. */
  async refreshAccessToken(refreshToken: string): Promise<SallaTokenResult> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.config.get('SALLA_CLIENT_ID', { infer: true }),
      client_secret: this.config.get('SALLA_CLIENT_SECRET', { infer: true }),
      refresh_token: refreshToken,
    });

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) {
      this.logger.warn(`Salla token endpoint (refresh) responded ${res.status}`);
      throw new SallaOAuthError('token', `Token refresh failed (${res.status})`, res.status);
    }

    const parsed = tokenResponse.safeParse(await res.json());
    if (!parsed.success) throw new SallaOAuthError('token', 'Unexpected token response shape');
    const t = parsed.data;

    return {
      accessToken: t.access_token,
      refreshToken: t.refresh_token ?? null,
      expiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null,
      scopes: t.scope ? t.scope.split(/[\s,]+/).filter(Boolean) : [],
    };
  }

  async fetchMerchant(accessToken: string): Promise<SallaMerchant> {
    const res = await fetch(USER_INFO_URL, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) {
      this.logger.warn(`Salla user-info endpoint responded ${res.status}`);
      throw new SallaOAuthError('userinfo', `User info failed (${res.status})`);
    }

    const parsed = userInfoResponse.safeParse(await res.json());
    if (!parsed.success) throw new SallaOAuthError('userinfo', 'Unexpected user info shape');
    const m = parsed.data.data.merchant;

    return {
      id: m.id,
      name: m.name || m.username || `Salla store ${m.id}`,
      domain: m.domain || null,
    };
  }
}
