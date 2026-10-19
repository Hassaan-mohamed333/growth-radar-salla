import { validateEnv } from './env';

const base = {
  DATABASE_URL: 'postgresql://u:p@db.example/radar',
  REDIS_URL: 'rediss://default:p@redis.example:6379',
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  SESSION_SECRET: 'a-session-secret-that-is-at-least-32-chars-long',
  SALLA_CLIENT_ID: 'client-id',
  SALLA_CLIENT_SECRET: 'client-secret',
  SALLA_WEBHOOK_SECRET: 'webhook-secret-0123456789',
};

const production = {
  ...base,
  NODE_ENV: 'production',
  FRONTEND_ORIGIN: 'https://app.rasid.example',
  SALLA_REDIRECT_URI: 'https://app.rasid.example/api/v1/auth/salla/callback',
};

/** The issues validateEnv reports, as "KEY: message" lines (it throws with them in the message). */
function problems(raw: Record<string, unknown>): string {
  try {
    validateEnv(raw);
    return '';
  } catch (err) {
    return (err as Error).message;
  }
}

describe('validateEnv', () => {
  it('accepts a development environment with localhost defaults', () => {
    const env = validateEnv(base);
    expect(env.FRONTEND_ORIGIN).toBe('http://localhost:3000');
    expect(env.TRUST_PROXY_HOPS).toBe(1);
  });

  it('accepts a correct production environment', () => {
    expect(problems(production)).toBe('');
  });

  describe('in production', () => {
    it('refuses to fall back to the localhost defaults', () => {
      const msg = problems({ ...base, NODE_ENV: 'production' });
      expect(msg).toMatch(/FRONTEND_ORIGIN: must use https/);
      expect(msg).toMatch(/FRONTEND_ORIGIN: must be the public address/);
      expect(msg).toMatch(/SALLA_REDIRECT_URI: must use https/);
    });

    it('requires https for the dashboard and the OAuth callback', () => {
      const msg = problems({
        ...production,
        FRONTEND_ORIGIN: 'http://app.rasid.example',
        SALLA_REDIRECT_URI: 'http://app.rasid.example/api/v1/auth/salla/callback',
      });
      expect(msg).toMatch(/FRONTEND_ORIGIN: must use https/);
      expect(msg).toMatch(/SALLA_REDIRECT_URI: must use https/);
    });

    it('requires the callback on the dashboard origin, where the state cookie lives', () => {
      // e.g. pointing Salla straight at the API host instead of going through the dashboard rewrite
      const msg = problems({
        ...production,
        SALLA_REDIRECT_URI: 'https://api.rasid.example/api/v1/auth/salla/callback',
      });
      expect(msg).toMatch(/SALLA_REDIRECT_URI: must be on the dashboard origin \(https:\/\/app\.rasid\.example\)/);
    });

    it('requires the exact callback path the API serves', () => {
      const msg = problems({
        ...production,
        SALLA_REDIRECT_URI: 'https://app.rasid.example/callback',
      });
      expect(msg).toMatch(/SALLA_REDIRECT_URI: path must be \/api\/v1\/auth\/salla\/callback/);
    });

    it('does not apply to development or test', () => {
      for (const NODE_ENV of ['development', 'test']) {
        expect(problems({ ...base, NODE_ENV })).toBe('');
      }
    });
  });

  it('bounds the proxy hop count', () => {
    expect(validateEnv({ ...base, TRUST_PROXY_HOPS: '2' }).TRUST_PROXY_HOPS).toBe(2);
    expect(problems({ ...base, TRUST_PROXY_HOPS: '-1' })).toMatch(/TRUST_PROXY_HOPS/);
    expect(problems({ ...base, TRUST_PROXY_HOPS: '50' })).toMatch(/TRUST_PROXY_HOPS/);
  });
});
