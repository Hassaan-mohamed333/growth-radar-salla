import { ConfigModule } from '@nestjs/config';
import RedisMock from 'ioredis-mock';
import type Redis from 'ioredis';

/** Every env key the code under test reads; mirrors `.env.example`. */
export const TEST_ENV = {
  NODE_ENV: 'test',
  FRONTEND_ORIGIN: 'http://localhost:3000',
  SESSION_SECRET: 'integration-test-secret-integration-test-secret',
  SESSION_TTL_SECONDS: 3600,
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  TOKEN_ENCRYPTION_KEY_VERSION: 1,
  SALLA_CLIENT_ID: 'client-id',
  SALLA_CLIENT_SECRET: 'client-secret',
  SALLA_REDIRECT_URI: 'http://localhost:4000/api/v1/auth/salla/callback',
  SALLA_OAUTH_SCOPES: 'offline_access orders.read products.read',
  SALLA_WEBHOOK_SECRET: 'webhook-secret-0123456789',
  SALLA_WEBHOOK_STRATEGY: 'signature',
  SALES_BACKFILL_DAYS: 90,
  SALES_SYNC_ENABLED: false,
  SALES_SYNC_INTERVAL_MINUTES: 60,
  PRODUCT_SYNC_ENABLED: false,
  PRODUCT_SYNC_INTERVAL_MINUTES: 360,
  RECOMMENDATIONS_ENABLED: false,
  RECOMMENDATIONS_INTERVAL_MINUTES: 60,
  RECOMMENDATION_MIN_GAP_PCT: 2,
  RECOMMENDATION_MIN_MARGIN_PCT: 10,
} as const;

export function envModule(extra: Record<string, unknown> = {}) {
  return ConfigModule.forRoot({
    isGlobal: true,
    ignoreEnvFile: true,
    load: [() => ({ ...TEST_ENV, ...extra })],
  });
}

/**
 * In-memory Redis emulation (ioredis-mock). The code under test only uses
 * SET [EX] [NX], GETDEL and DEL, whose semantics it implements faithfully; it is
 * still an emulation, not a real server.
 */
export function newRedis(): Redis {
  return new RedisMock() as unknown as Redis;
}

const realFetch = global.fetch;

export interface SallaFake {
  tokenRequests: URLSearchParams[];
  userInfoRequests: number;
  /** Decide the token endpoint's answer (default: success). */
  token: (req: URLSearchParams) => Promise<{ status: number; body: unknown }>;
  merchant: { id: number | string; name: string; domain: string };
  userInfoStatus: number;
  restore: () => void;
}

/** Intercepts only accounts.salla.sa; every other request (our own HTTP server) passes through. */
export function installSallaFake(): SallaFake {
  const fake: SallaFake = {
    tokenRequests: [],
    userInfoRequests: 0,
    token: async () => ({
      status: 200,
      body: {
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        expires_in: 3600,
        scope: 'offline_access orders.read products.read',
      },
    }),
    merchant: { id: 555, name: 'متجر القهوة', domain: 'coffee.example' },
    userInfoStatus: 200,
    restore: () => spy.mockRestore(),
  };

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  const spy = jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;

    if (url.startsWith('https://accounts.salla.sa/oauth2/token')) {
      const params = new URLSearchParams(String(init?.body ?? ''));
      fake.tokenRequests.push(params);
      const r = await fake.token(params);
      return json(r.status, r.body);
    }
    if (url.startsWith('https://accounts.salla.sa/oauth2/user/info')) {
      fake.userInfoRequests += 1;
      return json(fake.userInfoStatus, { data: { merchant: fake.merchant } });
    }
    return realFetch(input, init);
  });

  return fake;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
