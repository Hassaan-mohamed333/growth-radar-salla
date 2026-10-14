import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { SallaOAuthClient, tokenExpiry } from './salla-oauth.client';

describe('tokenExpiry', () => {
  const now = Date.parse('2026-10-11T00:00:00Z');

  it('reads a millisecond timestamp as-is, not as seconds', () => {
    const ms = Date.parse('2026-10-25T00:00:00Z');
    expect(tokenExpiry({ expires: ms }, now)?.toISOString()).toBe('2026-10-25T00:00:00.000Z');
  });

  it('treats null fields as absent', () => {
    expect(tokenExpiry({ expires_in: null, expires: null }, now)).toBeNull();
    expect(tokenExpiry({ expires_in: null, expires: 60 }, now)?.toISOString()).toBe(
      '2026-10-11T00:01:00.000Z',
    );
  });

  it('uses expires_in as seconds from now', () => {
    expect(tokenExpiry({ expires_in: 3600 }, now)?.toISOString()).toBe('2026-10-11T01:00:00.000Z');
  });

  it('reads `expires` as an absolute unix timestamp (Easy mode shape)', () => {
    const ts = Math.floor(Date.parse('2026-10-25T00:00:00Z') / 1000);
    expect(tokenExpiry({ expires: ts }, now)?.toISOString()).toBe('2026-10-25T00:00:00.000Z');
  });

  it('treats a small `expires` as a duration, and prefers expires_in when both exist', () => {
    expect(tokenExpiry({ expires: 60 }, now)?.toISOString()).toBe('2026-10-11T00:01:00.000Z');
    expect(tokenExpiry({ expires_in: 10, expires: 9_999_999_999 }, now)?.getTime()).toBe(now + 10_000);
  });

  it('is null when Salla sent no expiry', () => {
    expect(tokenExpiry({}, now)).toBeNull();
  });
});

describe('SallaOAuthClient token responses', () => {
  const config = {
    get: (key: string) =>
      ({
        SALLA_CLIENT_ID: 'cid',
        SALLA_CLIENT_SECRET: 'secret',
        SALLA_REDIRECT_URI: 'http://localhost/cb',
      })[key],
  } as unknown as ConfigService<Env, true>;
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function respondWith(body: unknown) {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
    ) as unknown as typeof fetch;
  }

  it('accepts a usable token whose optional fields are null', async () => {
    respondWith({ access_token: 'a', refresh_token: null, expires_in: null, expires: null, scope: null });

    const t = await new SallaOAuthClient(config).exchangeCode('code', 'verifier');

    expect(t).toEqual({ accessToken: 'a', refreshToken: null, expiresAt: null, scopes: [] });
  });
});
