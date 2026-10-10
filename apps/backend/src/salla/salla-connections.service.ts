import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';
import { TokenEncryptionService } from '../security/token-encryption.service';
import { SallaOAuthClient, SallaOAuthError } from './salla-oauth.client';

export interface SallaTokenSet {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  scopes?: string[];
}

/** Raised when a store has no usable credentials (never connected, revoked, or refresh rejected). */
export class SallaConnectionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SallaConnectionUnavailableError';
  }
}

/** Refresh when the token has less than this left. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;
const REFRESH_LOCK_TTL_SECONDS = 30;
const refreshLockKey = (storeId: string) => `salla:token-refresh:v1:${storeId}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The only place Salla tokens cross the plaintext/ciphertext boundary. */
@Injectable()
export class SallaConnectionsService {
  private readonly logger = new Logger(SallaConnectionsService.name);
  private readonly inFlight = new Map<string, Promise<string>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: TokenEncryptionService,
    private readonly oauth: SallaOAuthClient,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  // AAD context binds each ciphertext to its store and field.
  private static ctx(storeId: string, kind: 'access' | 'refresh'): string {
    return `store:${storeId}:${kind}`;
  }

  async saveTokens(tenantId: string, storeId: string, tokens: SallaTokenSet): Promise<void> {
    const data = {
      accessTokenEnc: this.crypto.encrypt(
        tokens.accessToken,
        SallaConnectionsService.ctx(storeId, 'access'),
      ),
      refreshTokenEnc: tokens.refreshToken
        ? this.crypto.encrypt(tokens.refreshToken, SallaConnectionsService.ctx(storeId, 'refresh'))
        : null,
      keyVersion: this.crypto.keyVersion,
      scopes: tokens.scopes ?? [],
      accessTokenExpiresAt: tokens.expiresAt ?? null,
      lastRefreshedAt: new Date(),
      status: 'ACTIVE' as const,
      lastError: null,
    };

    await this.prisma.sallaConnection.upsert({
      where: { storeId },
      create: { tenantId, storeId, ...data },
      update: data,
    });
  }

  /** Decrypts the stored access token as-is (no expiry check). */
  async getAccessToken(storeId: string): Promise<string> {
    const conn = await this.prisma.sallaConnection.findUnique({ where: { storeId } });
    if (!conn) throw new NotFoundException('Salla connection not found');
    return this.crypto.decrypt(conn.accessTokenEnc, SallaConnectionsService.ctx(storeId, 'access'));
  }

  /**
   * An access token that is valid for API calls, refreshing it first when it is
   * (nearly) expired. Refresh tokens may rotate, so concurrent refreshes for a
   * store are serialised: in-process by sharing one promise, across instances by
   * a short Redis lock.
   */
  async getValidAccessToken(storeId: string): Promise<string> {
    const pending = this.inFlight.get(storeId);
    if (pending) return pending;

    const run = this.resolveAccessToken(storeId).finally(() => this.inFlight.delete(storeId));
    this.inFlight.set(storeId, run);
    return run;
  }

  private async resolveAccessToken(storeId: string): Promise<string> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const conn = await this.prisma.sallaConnection.findUnique({ where: { storeId } });
      if (!conn || conn.status === 'REVOKED') {
        throw new SallaConnectionUnavailableError('No active Salla connection');
      }

      const expiresAt = conn.accessTokenExpiresAt?.getTime();
      const fresh = expiresAt === undefined || expiresAt - Date.now() > REFRESH_SKEW_MS;
      if (fresh && conn.status === 'ACTIVE') {
        return this.crypto.decrypt(
          conn.accessTokenEnc,
          SallaConnectionsService.ctx(storeId, 'access'),
        );
      }

      const locked = await this.redis.set(
        refreshLockKey(storeId),
        '1',
        'EX',
        REFRESH_LOCK_TTL_SECONDS,
        'NX',
      );
      if (locked) {
        try {
          return await this.refresh(conn.tenantId, storeId, conn.refreshTokenEnc);
        } finally {
          await this.redis.del(refreshLockKey(storeId));
        }
      }
      // Another instance is refreshing; wait, then re-read the (new) credentials.
      await sleep(500);
    }
    throw new SallaConnectionUnavailableError('Timed out waiting for token refresh');
  }

  private async refresh(
    tenantId: string,
    storeId: string,
    refreshTokenEnc: string | null,
  ): Promise<string> {
    if (!refreshTokenEnc) {
      await this.markError(storeId, 'EXPIRED', 'no_refresh_token');
      throw new SallaConnectionUnavailableError('Access token expired and no refresh token stored');
    }

    const refreshToken = this.crypto.decrypt(
      refreshTokenEnc,
      SallaConnectionsService.ctx(storeId, 'refresh'),
    );

    try {
      const tokens = await this.oauth.refreshAccessToken(refreshToken);
      await this.saveTokens(tenantId, storeId, {
        ...tokens,
        // Keep the old refresh token if Salla did not rotate it.
        refreshToken: tokens.refreshToken ?? refreshToken,
      });
      return tokens.accessToken;
    } catch (err) {
      const rejected =
        err instanceof SallaOAuthError && (err.status === 400 || err.status === 401);
      if (rejected) {
        // Refresh token no longer valid: the merchant has to re-authorize.
        await this.markError(storeId, 'EXPIRED', 'refresh_rejected');
        throw new SallaConnectionUnavailableError('Refresh token rejected');
      }
      this.logger.warn(`Token refresh failed for store ${storeId}: ${err instanceof Error ? err.name : 'error'}`);
      throw err; // transient (network/5xx): leave status alone so the next run retries
    }
  }

  private async markError(storeId: string, status: 'EXPIRED' | 'ERROR', reason: string) {
    await this.prisma.sallaConnection.updateMany({
      where: { storeId },
      data: { status, lastError: reason },
    });
  }
}
