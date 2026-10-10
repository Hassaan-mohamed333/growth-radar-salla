import { createHmac } from 'node:crypto';
import { safeEqual } from './pkce';

export interface VerifyInput {
  /** Strategy comes from OUR config, never from a request header (prevents attacker-chosen downgrade). */
  strategy: 'signature' | 'token';
  secret: string;
  rawBody: Buffer;
  signatureHeader?: string;
  authorizationHeader?: string;
}

/**
 * Salla webhook authenticity.
 *  - signature: hex HMAC-SHA256(secret, exact raw request bytes) in `X-Salla-Signature`.
 *  - token:     the shared secret in the `Authorization` header.
 * Comparison is constant-time. Nothing is parsed before this returns true.
 */
export function verifySallaWebhook(i: VerifyInput): boolean {
  if (i.strategy === 'token') {
    const t = i.authorizationHeader?.replace(/^Bearer\s+/i, '');
    return !!t && safeEqual(t, i.secret);
  }
  const sig = i.signatureHeader?.replace(/^sha256=/i, '').trim();
  if (!sig || !/^[0-9a-f]{64}$/i.test(sig)) return false;
  const expected = createHmac('sha256', i.secret).update(i.rawBody).digest();
  return safeEqual(expected, Buffer.from(sig, 'hex'));
}
