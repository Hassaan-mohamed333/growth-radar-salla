import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import { AuthController, SessionController } from '../../src/auth/auth.controller';
import { AuthService } from '../../src/auth/auth.service';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ProductSyncService } from '../../src/products/product-sync.service';
import { REDIS } from '../../src/redis/redis.module';
import { SallaConnectionsService } from '../../src/salla/salla-connections.service';
import { SallaOAuthClient } from '../../src/salla/salla-oauth.client';
import { SecurityModule } from '../../src/security/security.module';
import { TokenEncryptionService } from '../../src/security/token-encryption.service';
import { SessionModule } from '../../src/session/session.module';
import { SalesSyncService } from '../../src/sync/sales-sync.service';
import { resetDb } from './db';
import { type SallaFake, envModule, installSallaFake, newRedis, sleep } from './support';

const STATE_COOKIE = 'salla_oauth_state';

describe('Salla OAuth login flow (HTTP + Postgres + Redis emulation)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;
  let crypto: TokenEncryptionService;
  let base: string;
  let salla: SallaFake;
  const salesSync = { syncStore: jest.fn() };
  const productSync = { syncStore: jest.fn() };

  beforeAll(async () => {
    redis = newRedis();
    const moduleRef = await Test.createTestingModule({
      imports: [envModule(), PrismaModule, SecurityModule, SessionModule],
      controllers: [AuthController, SessionController],
      providers: [
        AuthService,
        SallaConnectionsService,
        SallaOAuthClient,
        { provide: REDIS, useValue: redis },
        { provide: SalesSyncService, useValue: salesSync },
        { provide: ProductSyncService, useValue: productSync },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    prisma = moduleRef.get(PrismaService);
    crypto = moduleRef.get(TokenEncryptionService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    await redis.flushall();
    salesSync.syncStore.mockReset().mockResolvedValue(undefined);
    productSync.syncStore.mockReset().mockResolvedValue(undefined);
    salla = installSallaFake();
  });
  afterEach(() => salla.restore());

  async function get(path: string, cookie?: string) {
    const res = await fetch(`${base}${path}`, {
      redirect: 'manual',
      headers: cookie ? { cookie } : {},
    });
    return {
      status: res.status,
      location: res.headers.get('location'),
      setCookie: res.headers.getSetCookie(),
      json: res.headers.get('content-type')?.includes('json') ? await res.json() : null,
    };
  }

  /** Starts a login; returns what a browser would hold afterwards. */
  async function startLogin() {
    const r = await get('/api/v1/auth/salla/login');
    const url = new URL(r.location!);
    const state = url.searchParams.get('state')!;
    return { r, url, state, cookie: `${STATE_COOKIE}=${state}` };
  }

  const sessionCookieOf = (setCookie: string[]) =>
    setCookie.find((c) => c.startsWith('gr_session='))?.split(';')[0];

  it('redirects to Salla with PKCE (S256), a fresh state, and the configured scopes', async () => {
    const { r, url, state } = await startLogin();

    expect(r.status).toBe(302);
    expect(`${url.origin}${url.pathname}`).toBe('https://accounts.salla.sa/oauth2/auth');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')!.split(' ')).toEqual(
      expect.arrayContaining(['offline_access', 'orders.read', 'products.read']),
    );
    expect(state.length).toBeGreaterThanOrEqual(40);

    const cookie = r.setCookie.find((c) => c.startsWith(`${STATE_COOKIE}=`))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth\/salla/);
    expect(await redis.exists(`salla:oauth:state:v1:${state}`)).toBe(1);
  });

  it('completes login: PKCE verifier matches, tokens are stored encrypted, session cookie works', async () => {
    const { url, state, cookie } = await startLogin();

    const cb = await get(`/api/v1/auth/salla/callback?code=auth-code&state=${state}`, cookie);

    expect(cb.status).toBe(302);
    expect(cb.location).toBe('http://localhost:3000/?connected=1');

    // PKCE: the verifier sent to Salla must hash to the challenge we published.
    const tokenReq = salla.tokenRequests[0]!;
    expect(tokenReq.get('grant_type')).toBe('authorization_code');
    expect(tokenReq.get('code')).toBe('auth-code');
    const challenge = createHash('sha256').update(tokenReq.get('code_verifier')!).digest('base64url');
    expect(challenge).toBe(url.searchParams.get('code_challenge'));

    // Tenant + store were created for the merchant, tokens never stored in plaintext.
    const store = await prisma.store.findUniqueOrThrow({
      where: { sallaMerchantId: '555' },
      include: { connection: true },
    });
    expect(store).toMatchObject({ name: 'متجر القهوة', domain: 'coffee.example', status: 'ACTIVE' });
    const conn = store.connection!;
    expect(conn.accessTokenEnc).toMatch(/^v1\./);
    expect(conn.accessTokenEnc).not.toContain('access-1');
    expect(conn.refreshTokenEnc).not.toContain('refresh-1');
    expect(conn.scopes).toEqual(['offline_access', 'orders.read', 'products.read']);
    expect(crypto.decrypt(conn.accessTokenEnc, `store:${store.id}:access`)).toBe('access-1');
    expect(crypto.decrypt(conn.refreshTokenEnc!, `store:${store.id}:refresh`)).toBe('refresh-1');
    // Ciphertext is bound to its store/field: it must not decrypt anywhere else.
    expect(() => crypto.decrypt(conn.accessTokenEnc, `store:other:access`)).toThrow();

    // The session cookie is HttpOnly and identifies exactly this merchant.
    const setCookie = cb.setCookie.find((c) => c.startsWith('gr_session='))!;
    expect(setCookie).toMatch(/HttpOnly/i);
    const me = await get('/api/v1/auth/session', sessionCookieOf(cb.setCookie));
    expect(me.json).toEqual({ tenantId: store.tenantId, storeId: store.id });

    // First syncs are kicked off for this store.
    await sleep(20);
    expect(salesSync.syncStore).toHaveBeenCalledWith(store.id);
    expect(productSync.syncStore).toHaveBeenCalledWith(store.id);
  });

  it('treats the state as single-use: a replayed callback is rejected without a second exchange', async () => {
    const { state, cookie } = await startLogin();
    await get(`/api/v1/auth/salla/callback?code=c1&state=${state}`, cookie);

    const replay = await get(`/api/v1/auth/salla/callback?code=c1&state=${state}`, cookie);

    expect(replay.location).toBe('http://localhost:3000/?auth_error=invalid_state');
    expect(sessionCookieOf(replay.setCookie)).toBeUndefined();
    expect(salla.tokenRequests).toHaveLength(1);
  });

  it('binds the flow to the browser: wrong or missing cookie fails and does not burn the state', async () => {
    const { state, cookie } = await startLogin();

    const wrong = await get(`/api/v1/auth/salla/callback?code=c&state=${state}`, `${STATE_COOKIE}=attacker`);
    const missing = await get(`/api/v1/auth/salla/callback?code=c&state=${state}`);
    expect(wrong.location).toBe('http://localhost:3000/?auth_error=invalid_state');
    expect(missing.location).toBe('http://localhost:3000/?auth_error=invalid_state');
    expect(salla.tokenRequests).toHaveLength(0);

    // The real browser (holding the right cookie) can still finish.
    const ok = await get(`/api/v1/auth/salla/callback?code=c&state=${state}`, cookie);
    expect(ok.location).toBe('http://localhost:3000/?connected=1');
  });

  it('rejects unknown states and never reflects request input into the redirect', async () => {
    const r = await get(
      `/api/v1/auth/salla/callback?code=c&state=%3Cscript%3Ealert(1)%3C/script%3E`,
      `${STATE_COOKIE}=%3Cscript%3Ealert(1)%3C/script%3E`,
    );
    expect(r.location).toBe('http://localhost:3000/?auth_error=invalid_state');
    expect((await get('/api/v1/auth/salla/callback')).location).toBe(
      'http://localhost:3000/?auth_error=invalid_state',
    );
  });

  it('maps provider errors and failed exchanges to a fixed error and writes nothing', async () => {
    const denied = await get('/api/v1/auth/salla/callback?error=access_denied&state=x');
    expect(denied.location).toBe('http://localhost:3000/?auth_error=exchange_failed');

    salla.token = async () => ({ status: 400, body: { error: 'invalid_grant' } });
    const { state, cookie } = await startLogin();
    const failed = await get(`/api/v1/auth/salla/callback?code=bad&state=${state}`, cookie);

    expect(failed.location).toBe('http://localhost:3000/?auth_error=exchange_failed');
    expect(sessionCookieOf(failed.setCookie)).toBeUndefined();
    expect(await prisma.store.count()).toBe(0);
    expect(await prisma.sallaConnection.count()).toBe(0);
  });

  it('reuses the tenant/store on re-authorization, reactivates it and rotates the tokens', async () => {
    const first = await startLogin();
    await get(`/api/v1/auth/salla/callback?code=c1&state=${first.state}`, first.cookie);
    const before = await prisma.store.findUniqueOrThrow({
      where: { sallaMerchantId: '555' },
      include: { connection: true },
    });
    await prisma.store.update({ where: { id: before.id }, data: { status: 'UNINSTALLED' } });

    salla.token = async () => ({
      status: 200,
      body: { access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600, scope: 'offline_access' },
    });
    const second = await startLogin();
    await get(`/api/v1/auth/salla/callback?code=c2&state=${second.state}`, second.cookie);

    const after = await prisma.store.findUniqueOrThrow({
      where: { sallaMerchantId: '555' },
      include: { connection: true },
    });
    expect(after.id).toBe(before.id);
    expect(after.tenantId).toBe(before.tenantId);
    expect(after.status).toBe('ACTIVE');
    expect(await prisma.tenant.count()).toBe(1);
    expect(after.connection!.accessTokenEnc).not.toBe(before.connection!.accessTokenEnc);
    expect(crypto.decrypt(after.connection!.accessTokenEnc, `store:${after.id}:access`)).toBe('access-2');
  });

  it('survives two simultaneous first-time callbacks for the same merchant (unique-key race)', async () => {
    const a = await startLogin();
    const b = await startLogin();

    const [ra, rb] = await Promise.all([
      get(`/api/v1/auth/salla/callback?code=c&state=${a.state}`, a.cookie),
      get(`/api/v1/auth/salla/callback?code=c&state=${b.state}`, b.cookie),
    ]);

    expect(ra.location).toBe('http://localhost:3000/?connected=1');
    expect(rb.location).toBe('http://localhost:3000/?connected=1');
    expect(await prisma.store.count()).toBe(1);
    expect(await prisma.tenant.count()).toBe(1);
    expect(await prisma.sallaConnection.count()).toBe(1);
  });

  it('answers 401 without a session and clears the cookie on logout', async () => {
    expect((await get('/api/v1/auth/session')).status).toBe(401);

    const res = await fetch(`${base}/api/v1/auth/logout`, { method: 'POST' });
    expect(res.status).toBe(204);
    expect(res.headers.getSetCookie().join(';')).toMatch(/gr_session=;/);
  });
});
