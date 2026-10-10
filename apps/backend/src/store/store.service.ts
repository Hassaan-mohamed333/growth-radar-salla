import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

export type ConnectionState = 'connected' | 'expiring' | 'disconnected';

export interface StoreStatusResponse {
  connected: boolean;
  status: ConnectionState;
  store: {
    id: string;
    name: string;
    domain: string | null;
    currency: string;
    locale: string;
    installedAt: string;
  } | null;
  connection: {
    scopes: string[];
    accessTokenExpiresAt: string | null;
    lastRefreshedAt: string | null;
    lastError: string | null;
  } | null;
  lastSyncAt: string | null;
  webhooks: {
    /** Path Salla must be configured to call (Partners portal > app > Webhooks). */
    endpoint: string;
    verification: Env['SALLA_WEBHOOK_STRATEGY'];
  };
}

/**
 * Store status for the authenticated merchant. `storeId` comes from the session
 * (SessionGuard), never from client input.
 */
@Injectable()
export class StoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async getStatus(storeId: string): Promise<StoreStatusResponse> {
    const webhooks: StoreStatusResponse['webhooks'] = {
      endpoint: '/webhooks/salla',
      verification: this.config.get('SALLA_WEBHOOK_STRATEGY', { infer: true }),
    };
    const empty: StoreStatusResponse = {
      connected: false,
      status: 'disconnected',
      store: null,
      connection: null,
      lastSyncAt: null,
      webhooks,
    };

    // Explicit selects: token ciphertext columns must never leave the service.
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: {
        id: true,
        name: true,
        domain: true,
        currency: true,
        locale: true,
        installedAt: true,
        status: true,
        connection: {
          select: {
            status: true,
            scopes: true,
            accessTokenExpiresAt: true,
            lastRefreshedAt: true,
            lastError: true,
          },
        },
      },
    });
    if (!store) return empty;

    const lastSync = await this.prisma.product.aggregate({
      where: { storeId },
      _max: { syncedAt: true },
    });

    const conn = store.connection;
    let status: ConnectionState = 'disconnected';
    if (conn && conn.status === 'ACTIVE' && store.status === 'ACTIVE') {
      const expired = conn.accessTokenExpiresAt && conn.accessTokenExpiresAt <= new Date();
      status = expired ? 'expiring' : 'connected';
    }

    return {
      connected: status !== 'disconnected',
      status,
      store: {
        id: store.id,
        name: store.name,
        domain: store.domain,
        currency: store.currency,
        locale: store.locale,
        installedAt: store.installedAt.toISOString(),
      },
      connection: conn && {
        scopes: conn.scopes,
        accessTokenExpiresAt: conn.accessTokenExpiresAt?.toISOString() ?? null,
        lastRefreshedAt: conn.lastRefreshedAt?.toISOString() ?? null,
        lastError: conn.lastError,
      },
      lastSyncAt: lastSync._max.syncedAt?.toISOString() ?? null,
      webhooks,
    };
  }
}
