import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ENV, type Env } from '../config/env';
import { TokenCryptoService } from '../common/crypto/token-crypto.service';
import { PrismaService } from '../infra/prisma.service';
import { SystemDb } from '../infra/system-db.service';
import { TenantDb } from '../infra/tenant-db.service';
import type { TenantContext } from '../infra/tenant-context';
import { SallaApiClient } from './salla-api.client';
import type { TokenResponse } from './salla-token.service';
import { SyncService } from './sync.service';
import { isRole } from '@radar/shared';

const userInfoSchema = z.object({
  data: z.object({
    id: z.coerce.bigint(),
    name: z.string().max(200).nullish(),
    email: z.string().email().max(320).nullish(),
    merchant: z.object({
      id: z.coerce.bigint(),
      name: z.string().max(200).nullish(),
      username: z.string().max(200).nullish(),
      domain: z.string().max(255).nullish(),
    }),
  }),
});
export type SallaUserInfo = z.infer<typeof userInfoSchema>['data'];

export class AccessDeniedError extends Error {}

@Injectable()
export class SallaOnboardingService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly api: SallaApiClient,
    private readonly prisma: PrismaService,
    private readonly system: SystemDb,
    private readonly db: TenantDb,
    private readonly crypto: TokenCryptoService,
    private readonly sync: SyncService,
  ) {}

  async fetchUserInfo(accessToken: string): Promise<SallaUserInfo> {
    return userInfoSchema.parse(await this.api.getAbsolute(accessToken, this.env.SALLA_USERINFO_URL)).data;
  }

  /**
   * Completes "Login with Salla / Install": creates (or re-authorises) tenant + store + connection and returns the
   * session context. A different Salla user hitting an already-claimed store is NOT auto-promoted: they must be invited.
   */
  async complete(tokens: TokenResponse, info: SallaUserInfo): Promise<TenantContext> {
    const user = await this.prisma.raw.user.upsert({
      where: { sallaUserId: info.id },
      create: { sallaUserId: info.id, name: info.name ?? null, email: info.email ?? null },
      update: { name: info.name ?? undefined },
      select: { id: true },
    });

    const existing = await this.system.resolveMerchant(info.merchant.id);
    if (existing) return this.reauthorise(existing.tenant_id, existing.store_id, user.id, tokens, info);

    try {
      return await this.install(user.id, tokens, info);
    } catch (e) {
      // Two concurrent first-time callbacks for the same merchant: the loser re-authorises the winner's tenant.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const winner = await this.system.resolveMerchant(info.merchant.id);
        if (winner) return this.reauthorise(winner.tenant_id, winner.store_id, user.id, tokens, info);
      }
      throw e;
    }
  }

  private async install(userId: string, tokens: TokenResponse, info: SallaUserInfo): Promise<TenantContext> {
    const tenantId = randomUUID();
    const storeId = randomUUID();
    const label = (info.merchant.name ?? info.merchant.username ?? `Store ${info.merchant.id}`).slice(0, 200);
    await this.db.withTenant(tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, name: label } });
      await tx.store.create({ data: { id: storeId, tenantId, name: label, domain: info.merchant.domain ?? null } });
      await tx.sallaConnection.create({
        data: {
          tenantId, storeId, sallaMerchantId: info.merchant.id,
          ...this.encryptedTokens(tenantId, storeId, tokens),
          scopes: scopes(tokens), storeMetadata: { name: label, domain: info.merchant.domain ?? null },
        },
      });
      await tx.membership.create({ data: { tenantId, userId, role: 'OWNER', storeId: null } });
    });
    await this.sync.start(tenantId, storeId);
    return { userId, tenantId, role: 'OWNER', storeScope: null };
  }

  private async reauthorise(tenantId: string, storeId: string, userId: string, tokens: TokenResponse, info: SallaUserInfo): Promise<TenantContext> {
    const ctx = await this.db.withTenant(tenantId, async (tx) => {
      const members = await tx.membership.findMany({ where: { tenantId }, select: { userId: true, role: true, storeId: true } });
      let mine = members.find((m) => m.userId === userId);
      if (!mine) {
        if (members.length > 0) throw new AccessDeniedError(); // claimed store: invitation required
        mine = await tx.membership.create({ data: { tenantId, userId, role: 'OWNER', storeId: null }, select: { userId: true, role: true, storeId: true } });
      }
      await tx.sallaConnection.updateMany({
        where: { tenantId, storeId },
        data: {
          ...this.encryptedTokens(tenantId, storeId, tokens), scopes: scopes(tokens), status: 'ACTIVE', revokedAt: null,
          lastRefreshedAt: new Date(), storeMetadata: { name: info.merchant.name ?? null, domain: info.merchant.domain ?? null },
        },
      });
      return mine;
    });
    if (!isRole(ctx.role)) throw new AccessDeniedError();
    return { userId, tenantId, role: ctx.role, storeScope: ctx.storeId };
  }

  private encryptedTokens(tenantId: string, storeId: string, t: TokenResponse) {
    return {
      accessTokenEnc: this.crypto.encrypt(t.access_token, { purpose: 'salla_access_token', tenantId, storeId }),
      refreshTokenEnc: t.refresh_token ? this.crypto.encrypt(t.refresh_token, { purpose: 'salla_refresh_token', tenantId, storeId }) : null,
      accessExpiresAt: new Date(Date.now() + t.expires_in * 1000),
    };
  }
}

const scopes = (t: TokenResponse) => (t.scope ?? '').split(/[\s,]+/).filter(Boolean);
