import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../infra/redis.module';
import { codeChallengeS256, newCodeVerifier, newState, safeEqual, sha256Hex } from './pkce';

export const OAUTH_NONCE_COOKIE = 'radar_oauth_nonce';
const TTL_SECONDS = 600;

interface StoredState {
  verifier: string;
  nonceHash: string;
}

/**
 * CSRF + login-CSRF defence for the OAuth dance:
 *  - `state` is random, single-use (atomic GETDEL) and expires in 10 minutes.
 *  - It is bound to the initiating browser through an HttpOnly nonce cookie, so an attacker cannot feed a
 *    victim's browser a callback URL for an authorization the attacker started.
 *  - The PKCE verifier never leaves the server; only its S256 challenge goes to Salla.
 */
@Injectable()
export class OAuthStateService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async begin() {
    const state = newState();
    const verifier = newCodeVerifier();
    const nonce = randomBytes(32).toString('base64url');
    const value: StoredState = { verifier, nonceHash: sha256Hex(nonce) };
    await this.redis.set(this.key(state), JSON.stringify(value), 'EX', TTL_SECONDS);
    return { state, nonce, challenge: codeChallengeS256(verifier), ttlSeconds: TTL_SECONDS };
  }

  /** Returns the PKCE verifier, or null if state is unknown/expired/replayed/not bound to this browser. */
  async consume(state: string, nonce: string | undefined): Promise<string | null> {
    const raw = await this.redis.getdel(this.key(state));
    if (!raw || !nonce) return null;
    const stored = JSON.parse(raw) as StoredState;
    return safeEqual(stored.nonceHash, sha256Hex(nonce)) ? stored.verifier : null;
  }

  private key(state: string) {
    return `oauth:state:${sha256Hex(state)}`; // hashed: a Redis dump does not reveal live states
  }
}
