import { tokenExpiry } from './salla-oauth.client';

describe('tokenExpiry', () => {
  const now = Date.parse('2026-10-11T00:00:00Z');

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
