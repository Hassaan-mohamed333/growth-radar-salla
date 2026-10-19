import type { Reflector } from '@nestjs/core';
import type { ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';
import { SessionThrottlerGuard } from './session-throttler.guard';
import type { SessionService } from './session.service';

function guardFor(verified: { storeId: string; tenantId: string } | null) {
  const sessions = {
    readCookie: jest.fn().mockReturnValue('cookie-value'),
    verify: jest.fn().mockReturnValue(verified),
  } as unknown as SessionService;
  const guard = new SessionThrottlerGuard(
    [{ ttl: 60_000, limit: 120 }] as ThrottlerModuleOptions,
    {} as ThrottlerStorage,
    {} as Reflector,
    sessions,
  );
  // getTracker is protected; the rate limiter calls it for every request.
  const tracker = (req: Record<string, unknown>) =>
    (guard as unknown as { getTracker(r: Record<string, unknown>): Promise<string> }).getTracker(req);
  return { tracker, sessions };
}

describe('SessionThrottlerGuard', () => {
  it('keys a request with a valid session by its store, whatever address it arrives from', async () => {
    const { tracker } = guardFor({ storeId: 's1', tenantId: 't1' });

    // Two merchants behind the same proxy address get the same IP but different buckets.
    const a = await tracker({ ip: '76.76.21.21', headers: {} });
    const { tracker: other } = guardFor({ storeId: 's2', tenantId: 't2' });
    const b = await other({ ip: '76.76.21.21', headers: {} });

    expect(a).toBe('store:s1');
    expect(b).toBe('store:s2');
  });

  it('falls back to the client IP when the session is missing, forged or expired', async () => {
    const { tracker, sessions } = guardFor(null);

    await expect(tracker({ ip: '203.0.113.7', headers: {} })).resolves.toBe('203.0.113.7');
    // The verifier is what decides; the guard never trusts the raw cookie value.
    expect(sessions.verify).toHaveBeenCalledWith('cookie-value');
  });
});
