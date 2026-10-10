import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** RFC 7636 verifier: 43-128 chars from the unreserved set. 48 random bytes => 64 base64url chars. */
export const newCodeVerifier = () => randomBytes(48).toString('base64url');
export const codeChallengeS256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');
/** 256-bit unguessable OAuth `state` (CSRF defence). */
export const newState = () => randomBytes(32).toString('base64url');
export const sha256Hex = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');

export function safeEqual(a: string | Buffer, b: string | Buffer): boolean {
  const ba = Buffer.isBuffer(a) ? a : Buffer.from(a);
  const bb = Buffer.isBuffer(b) ? b : Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
