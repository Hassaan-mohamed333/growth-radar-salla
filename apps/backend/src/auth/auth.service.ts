import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@growth-radar/database';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';
import { SallaConnectionsService } from '../salla/salla-connections.service';
import { SallaOAuthClient, type SallaMerchant } from '../salla/salla-oauth.client';

const STATE_TTL_SECONDS = 10 * 60;
const stateKey = (state: string) => `salla:oauth:state:v1:${state}`;

export type LoginFailure = 'invalid_state' | 'exchange_failed';

export interface StartedLogin {
  authorizeUrl: string;
  /** Random nonce; the caller must bind it to the browser (cookie) and re-check on callback. */
  state: string;
}

export interface CompletedLogin {
  tenantId: string;
  storeId: string;
}

/**
 * Authorization-code flow with PKCE (S256) and a one-time `state`.
 *
 * CSRF defence is two-part: `state` must exist in Redis (single use, 10 min) AND
 * match the cookie set on the browser that started the flow — Redis alone would
 * not stop an attacker feeding their own callback URL to a victim.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly oauth: SallaOAuthClient,
    private readonly connections: SallaConnectionsService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async startLogin(): Promise<StartedLogin> {
    const state = randomBytes(32).toString('base64url');
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

    await this.redis.set(stateKey(state), codeVerifier, 'EX', STATE_TTL_SECONDS);

    return { state, authorizeUrl: this.oauth.buildAuthorizeUrl({ state, codeChallenge }) };
  }

  /**
   * @param cookieState the `state` value from the browser's cookie
   * @returns null when state validation fails (caller shows a generic error)
   */
  async consumeState(queryState: string, cookieState: string | undefined): Promise<string | null> {
    if (!cookieState || !safeEqual(queryState, cookieState)) return null;
    // GETDEL: single use even under concurrent replays.
    return this.redis.getdel(stateKey(queryState));
  }

  async completeLogin(code: string, codeVerifier: string): Promise<CompletedLogin> {
    const tokens = await this.oauth.exchangeCode(code, codeVerifier);
    const merchant = await this.oauth.fetchMerchant(tokens.accessToken);

    const { tenantId, storeId } = await this.upsertTenantAndStore(merchant);
    await this.connections.saveTokens(tenantId, storeId, tokens);

    return { tenantId, storeId };
  }

  private async upsertTenantAndStore(merchant: SallaMerchant): Promise<CompletedLogin> {
    try {
      return await this.upsertOnce(merchant);
    } catch (err) {
      // Two first-time callbacks for the same merchant raced on a unique key; the winner
      // has committed, so a second pass takes the "existing store" path.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return this.upsertOnce(merchant);
      }
      throw err;
    }
  }

  private upsertOnce(merchant: SallaMerchant): Promise<CompletedLogin> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.store.findUnique({
        where: { sallaMerchantId: merchant.id },
        select: { id: true, tenantId: true },
      });

      if (existing) {
        await tx.store.update({
          where: { id: existing.id },
          data: {
            name: merchant.name,
            domain: merchant.domain,
            status: 'ACTIVE', // reinstall after uninstall
            uninstalledAt: null,
          },
        });
        return { tenantId: existing.tenantId, storeId: existing.id };
      }

      const tenant = await tx.tenant.create({
        data: {
          name: merchant.name,
          slug: `salla-${merchant.id.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        },
        select: { id: true },
      });
      const store = await tx.store.create({
        data: {
          tenantId: tenant.id,
          sallaMerchantId: merchant.id,
          name: merchant.name,
          domain: merchant.domain,
        },
        select: { id: true },
      });
      return { tenantId: tenant.id, storeId: store.id };
    });
  }
}

function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}
