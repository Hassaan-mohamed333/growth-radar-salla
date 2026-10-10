import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { REDIS } from '../../src/redis/redis.module';
import {
  SallaConnectionUnavailableError,
  SallaConnectionsService,
} from '../../src/salla/salla-connections.service';
import { SallaOAuthClient, SallaOAuthError } from '../../src/salla/salla-oauth.client';
import { SecurityModule } from '../../src/security/security.module';
import { TokenEncryptionService } from '../../src/security/token-encryption.service';
import { resetDb, seedStore, type SeededStore } from './db';
import { type SallaFake, envModule, installSallaFake, newRedis, sleep } from './support';

describe('Salla token refresh (Postgres + Redis lock emulation)', () => {
  let prisma: PrismaService;
  let redis: Redis;
  let crypto: TokenEncryptionService;
  let build: () => SallaConnectionsService;
  let close: () => Promise<void>;
  let salla: SallaFake;
  let s: SeededStore;

  beforeAll(async () => {
    redis = newRedis();
    const moduleRef = await Test.createTestingModule({
      imports: [envModule(), PrismaModule, SecurityModule],
      providers: [SallaOAuthClient, { provide: REDIS, useValue: redis }],
    }).compile();
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    crypto = moduleRef.get(TokenEncryptionService);
    const oauth = moduleRef.get(SallaOAuthClient);
    // Each call is a separate "instance": its own in-process dedupe map, shared Redis + DB.
    build = () => new SallaConnectionsService(prisma, crypto, oauth, redis);
    close = () => moduleRef.close();
  });
  afterAll(async () => {
    await close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    await redis.flushall();
    salla = installSallaFake();
    s = await seedStore(prisma);
  });
  afterEach(() => salla.restore());

  const expired = () => new Date(Date.now() - 60_000);
  const plain = async (storeId: string, kind: 'access' | 'refresh') => {
    const c = await prisma.sallaConnection.findUniqueOrThrow({ where: { storeId } });
    const enc = kind === 'access' ? c.accessTokenEnc : c.refreshTokenEnc!;
    return crypto.decrypt(enc, `store:${storeId}:${kind}`);
  };

  it('returns the stored token without touching Salla while it is still fresh', async () => {
    const svc = build();
    await svc.saveTokens(s.tenantId, s.storeId, {
      accessToken: 'fresh',
      refreshToken: 'r',
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    expect(await svc.getValidAccessToken(s.storeId)).toBe('fresh');
    expect(salla.tokenRequests).toHaveLength(0);
  });

  it('refreshes an expired token once for concurrent callers and persists the rotated pair', async () => {
    const svc = build();
    await svc.saveTokens(s.tenantId, s.storeId, {
      accessToken: 'old',
      refreshToken: 'old-refresh',
      expiresAt: expired(),
    });
    salla.token = async () => {
      await sleep(80);
      return {
        status: 200,
        body: { access_token: 'new', refresh_token: 'new-refresh', expires_in: 7200 },
      };
    };

    const tokens = await Promise.all(Array.from({ length: 6 }, () => svc.getValidAccessToken(s.storeId)));

    expect(new Set(tokens)).toEqual(new Set(['new']));
    expect(salla.tokenRequests).toHaveLength(1);
    expect(salla.tokenRequests[0]!.get('grant_type')).toBe('refresh_token');
    expect(salla.tokenRequests[0]!.get('refresh_token')).toBe('old-refresh');
    expect(await plain(s.storeId, 'access')).toBe('new');
    expect(await plain(s.storeId, 'refresh')).toBe('new-refresh');
    const conn = await prisma.sallaConnection.findUniqueOrThrow({ where: { storeId: s.storeId } });
    expect(conn.status).toBe('ACTIVE');
    expect(conn.accessTokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 3_600_000);
  });

  it('serialises refreshes across instances: the refresh token is spent exactly once', async () => {
    const a = build();
    const b = build();
    await a.saveTokens(s.tenantId, s.storeId, {
      accessToken: 'old',
      refreshToken: 'single-use',
      expiresAt: expired(),
    });
    // Rotating refresh tokens are single use: a second grant with the same token would fail.
    salla.token = async (req) => {
      await sleep(120);
      return req.get('refresh_token') === 'single-use'
        ? { status: 200, body: { access_token: 'rotated', refresh_token: 'next', expires_in: 3600 } }
        : { status: 400, body: { error: 'invalid_grant' } };
    };

    const [x, y] = await Promise.all([a.getValidAccessToken(s.storeId), b.getValidAccessToken(s.storeId)]);

    expect([x, y]).toEqual(['rotated', 'rotated']);
    expect(salla.tokenRequests).toHaveLength(1);
    expect((await prisma.sallaConnection.findUniqueOrThrow({ where: { storeId: s.storeId } })).status).toBe(
      'ACTIVE',
    );
    // The lock is released afterwards.
    expect(await redis.keys('salla:token-refresh:*')).toHaveLength(0);
  });

  it('keeps the old refresh token when Salla does not rotate it', async () => {
    const svc = build();
    await svc.saveTokens(s.tenantId, s.storeId, {
      accessToken: 'old',
      refreshToken: 'keep-me',
      expiresAt: expired(),
    });
    salla.token = async () => ({ status: 200, body: { access_token: 'new', expires_in: 3600 } });

    await svc.getValidAccessToken(s.storeId);

    expect(await plain(s.storeId, 'refresh')).toBe('keep-me');
  });

  it('marks the connection EXPIRED when Salla rejects the refresh token', async () => {
    const svc = build();
    await svc.saveTokens(s.tenantId, s.storeId, {
      accessToken: 'old',
      refreshToken: 'revoked',
      expiresAt: expired(),
    });
    salla.token = async () => ({ status: 400, body: { error: 'invalid_grant' } });

    await expect(svc.getValidAccessToken(s.storeId)).rejects.toBeInstanceOf(
      SallaConnectionUnavailableError,
    );

    const conn = await prisma.sallaConnection.findUniqueOrThrow({ where: { storeId: s.storeId } });
    expect(conn).toMatchObject({ status: 'EXPIRED', lastError: 'refresh_rejected' });
    expect(await redis.keys('salla:token-refresh:*')).toHaveLength(0);
  });

  it('leaves the connection ACTIVE on a transient Salla failure so the next run retries', async () => {
    const svc = build();
    await svc.saveTokens(s.tenantId, s.storeId, {
      accessToken: 'old',
      refreshToken: 'still-good',
      expiresAt: expired(),
    });
    salla.token = async () => ({ status: 503, body: {} });

    await expect(svc.getValidAccessToken(s.storeId)).rejects.toBeInstanceOf(SallaOAuthError);

    const conn = await prisma.sallaConnection.findUniqueOrThrow({ where: { storeId: s.storeId } });
    expect(conn.status).toBe('ACTIVE');
    expect(conn.lastError).toBeNull();
    expect(await redis.keys('salla:token-refresh:*')).toHaveLength(0);

    // ...and it recovers when Salla is back.
    salla.token = async () => ({ status: 200, body: { access_token: 'back', expires_in: 3600 } });
    expect(await build().getValidAccessToken(s.storeId)).toBe('back');
  });

  it('flags a connection with no refresh token as EXPIRED once the access token lapses', async () => {
    const svc = build();
    await svc.saveTokens(s.tenantId, s.storeId, { accessToken: 'old', expiresAt: expired() });

    await expect(svc.getValidAccessToken(s.storeId)).rejects.toBeInstanceOf(
      SallaConnectionUnavailableError,
    );

    const conn = await prisma.sallaConnection.findUniqueOrThrow({ where: { storeId: s.storeId } });
    expect(conn).toMatchObject({ status: 'EXPIRED', lastError: 'no_refresh_token' });
    expect(salla.tokenRequests).toHaveLength(0);
  });

  it('refuses a revoked or missing connection without calling Salla', async () => {
    const svc = build();
    await expect(svc.getValidAccessToken(s.storeId)).rejects.toBeInstanceOf(
      SallaConnectionUnavailableError,
    );

    await svc.saveTokens(s.tenantId, s.storeId, { accessToken: 'x', refreshToken: 'y' });
    await prisma.sallaConnection.update({ where: { storeId: s.storeId }, data: { status: 'REVOKED' } });
    await expect(svc.getValidAccessToken(s.storeId)).rejects.toBeInstanceOf(
      SallaConnectionUnavailableError,
    );
    expect(salla.tokenRequests).toHaveLength(0);
  });
});
