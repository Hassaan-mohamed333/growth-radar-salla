import { createHmac } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { SessionService } from './session.service';

const SECRET = 'x'.repeat(48);
const ctx = { tenantId: 'tenant-1', storeId: 'store-1' };

function makeService(ttl = 3600, secret = SECRET): SessionService {
  const values: Record<string, unknown> = {
    SESSION_SECRET: secret,
    SESSION_TTL_SECONDS: ttl,
    NODE_ENV: 'test',
  };
  const config = { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;
  return new SessionService(config);
}

describe('SessionService', () => {
  it('round-trips the merchant context', () => {
    const svc = makeService();
    expect(svc.verify(svc.issue(ctx))).toEqual(ctx);
  });

  it('rejects missing, malformed and tampered tokens', () => {
    const svc = makeService();
    const token = svc.issue(ctx);
    const [h, p, s] = token.split('.') as [string, string, string];
    const forgedPayload = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), sub: 'store-2' }),
    ).toString('base64url');

    expect(svc.verify(undefined)).toBeNull();
    expect(svc.verify('garbage')).toBeNull();
    expect(svc.verify(`${h}.${forgedPayload}.${s}`)).toBeNull();
  });

  it('rejects tokens signed with a different secret', () => {
    const token = makeService(3600, 'y'.repeat(48)).issue(ctx);
    expect(makeService().verify(token)).toBeNull();
  });

  it('rejects expired tokens', () => {
    const svc = makeService(60);
    const token = svc.issue(ctx, Date.now() - 120_000);
    expect(svc.verify(token)).toBeNull();
  });

  it('rejects alg:none and other header substitutions', () => {
    const svc = makeService();
    const [, p] = svc.issue(ctx).split('.') as [string, string, string];
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    expect(svc.verify(`${header}.${p}.`)).toBeNull();

    const hs512 = Buffer.from(JSON.stringify({ alg: 'HS512', typ: 'JWT' })).toString('base64url');
    const sig = createHmac('sha256', SECRET).update(`${hs512}.${p}`).digest('base64url');
    expect(svc.verify(`${hs512}.${p}.${sig}`)).toBeNull();
  });
});
