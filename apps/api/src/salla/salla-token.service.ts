import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { ENV, type Env } from '../config/env';
import { REDIS } from '../infra/redis.module';
import { TenantDb } from '../infra/tenant-db.service';
import { TokenCryptoService } from '../common/crypto/token-crypto.service';
import { SallaApiClient, SallaApiError } from './salla-api.client';

export const tokenResponseSchema = z.object({
  access_token: z.string().min(10),
  refresh_token: z.string().min(10).optional(),
  expires_in: z.coerce.number().int().positive(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
});
export type TokenResponse = z.infer<typeof tokenResponseSchema>;

export class SallaAuthError extends Error {}

const REFRESH_SKEW_MS = 5 * 60_000;
const UNLOCK = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;

@Injectable()
export class SallaTokenService {
  private readonly log = new Logger(SallaTokenService.name);
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly db: TenantDb,
    private readonly crypto: TokenCryptoService,
    private readonly api: SallaApiClient,
  ) {}

  async exchangeCode(code: string, codeVerifier: string | null): Promise<TokenResponse> {
    const form: Record<string, string> = {
      grant_type: 'authorization_code',
      client_id: this.env.SALLA_CLIENT_ID,
      client_secret: this.env.SALLA_CLIENT_SECRET,
      code,
      redirect_uri: `${this.env.APP_URL}/salla/oauth/callback`,
    };
    if (codeVerifier) form['code_verifier'] = codeVerifier;
    return tokenResponseSchema.parse(await this.api.postForm(this.env.SALLA_TOKEN_URL, form));
  }

  /** Always returns a non-expired access token (refreshing under a distributed lock if needed). */
  async getAccessToken(tenantId: string, storeId: string, forceRefresh = false): Promise<string> {
    const conn = await this.load(tenantId, storeId);
    if (conn.status !== 'ACTIVE') throw new SallaAuthError(`Connection is ${conn.status}`);
    const aad = { tenantId, storeId };
    const fresh = conn.accessExpiresAt.getTime() - Date.now() > REFRESH_SKEW_MS;
    if (fresh && !forceRefresh) return this.crypto.decrypt(conn.accessTokenEnc, { purpose: 'salla_access_token', ...aad });
    return this.refresh(tenantId, storeId, forceRefresh ? conn.accessTokenEnc : null);
  }

  /**
   * Salla refresh tokens are single-use: two concurrent refreshes would invalidate each other. A Redis lock
   * serialises them per store; whoever loses the race re-reads the winner's result.
   * @param staleEnvelope when forcing (after a 401) the token we know is bad, so we don't re-use a sibling's fresh one.
   */
  private async refresh(tenantId: string, storeId: string, staleEnvelope: string | null): Promise<string> {
    const lockKey = `lock:salla-refresh:${storeId}`;
    const owner = randomUUID();
    const deadline = Date.now() + 10_000;
    while (!(await this.redis.set(lockKey, owner, 'PX', 30_000, 'NX'))) {
      if (Date.now() > deadline) throw new SallaApiError(503); // retryable
      await new Promise((r) => setTimeout(r, 250));
      const c = await this.load(tenantId, storeId);
      if (c.status === 'ACTIVE' && c.accessTokenEnc !== staleEnvelope && c.accessExpiresAt.getTime() - Date.now() > REFRESH_SKEW_MS) {
        return this.crypto.decrypt(c.accessTokenEnc, { purpose: 'salla_access_token', tenantId, storeId });
      }
    }
    try {
      const conn = await this.load(tenantId, storeId);
      const stillFresh = conn.accessExpiresAt.getTime() - Date.now() > REFRESH_SKEW_MS;
      if (stillFresh && conn.accessTokenEnc !== staleEnvelope) {
        return this.crypto.decrypt(conn.accessTokenEnc, { purpose: 'salla_access_token', tenantId, storeId });
      }
      if (!conn.refreshTokenEnc) {
        await this.markFailed(tenantId, storeId);
        throw new SallaAuthError('No refresh token (was offline_access granted?)');
      }
      const refreshToken = this.crypto.decrypt(conn.refreshTokenEnc, { purpose: 'salla_refresh_token', tenantId, storeId });

      let tokens: TokenResponse;
      try {
        tokens = tokenResponseSchema.parse(
          await this.api.postForm(this.env.SALLA_TOKEN_URL, {
            grant_type: 'refresh_token',
            client_id: this.env.SALLA_CLIENT_ID,
            client_secret: this.env.SALLA_CLIENT_SECRET,
            refresh_token: refreshToken,
          }),
        );
      } catch (e) {
        if (e instanceof SallaApiError && (e.status === 400 || e.status === 401)) {
          await this.markFailed(tenantId, storeId); // merchant must re-authorise
          throw new SallaAuthError('Refresh token rejected');
        }
        throw e;
      }
      await this.store(tenantId, storeId, tokens);
      return tokens.access_token;
    } finally {
      await this.redis.eval(UNLOCK, 1, lockKey, owner);
    }
  }

  /** Persist a fresh token pair, encrypted. Used by the OAuth callback and by refresh. */
  async store(tenantId: string, storeId: string, t: TokenResponse): Promise<void> {
    const accessTokenEnc = this.crypto.encrypt(t.access_token, { purpose: 'salla_access_token', tenantId, storeId });
    const refreshTokenEnc = t.refresh_token
      ? this.crypto.encrypt(t.refresh_token, { purpose: 'salla_refresh_token', tenantId, storeId })
      : undefined;
    await this.db.withTenant(tenantId, (tx) =>
      tx.sallaConnection.updateMany({
        where: { tenantId, storeId },
        data: {
          accessTokenEnc,
          ...(refreshTokenEnc ? { refreshTokenEnc } : {}),
          accessExpiresAt: new Date(Date.now() + t.expires_in * 1000),
          ...(t.scope ? { scopes: t.scope.split(/[\s,]+/).filter(Boolean) } : {}),
          status: 'ACTIVE',
          lastRefreshedAt: new Date(),
        },
      }),
    );
  }

  private markFailed(tenantId: string, storeId: string) {
    this.log.warn(`Salla refresh failed for store ${storeId}; marking REFRESH_FAILED`);
    return this.db.withTenant(tenantId, (tx) =>
      tx.sallaConnection.updateMany({ where: { tenantId, storeId }, data: { status: 'REFRESH_FAILED' } }),
    );
  }

  private async load(tenantId: string, storeId: string) {
    const c = await this.db.withTenant(tenantId, (tx) => tx.sallaConnection.findFirst({ where: { tenantId, storeId } }));
    if (!c) throw new SallaAuthError('No Salla connection');
    return c;
  }
}
