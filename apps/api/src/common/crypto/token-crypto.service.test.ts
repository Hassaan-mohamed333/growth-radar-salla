import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TokenCryptoService, type TokenAad } from './token-crypto.service';
import { parseKeyring } from '../../config/env';

const k1 = randomBytes(32);
const k0 = randomBytes(32);
const svc = (primary: string, ring: Record<string, Buffer>) =>
  new TokenCryptoService({ encryptionKeys: new Map(Object.entries(ring)), primaryKeyId: primary });
const aad: TokenAad = { purpose: 'salla_access_token', tenantId: 't1', storeId: 's1' };

describe('TokenCryptoService', () => {
  it('round-trips and never stores plaintext', () => {
    const s = svc('k1', { k1 });
    const env = s.encrypt('secret-token-123', aad);
    expect(env).toMatch(/^v1\.k1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(env).not.toContain('secret-token-123');
    expect(s.decrypt(env, aad)).toBe('secret-token-123');
  });
  it('uses a fresh IV every time', () => {
    const s = svc('k1', { k1 });
    expect(s.encrypt('x', aad)).not.toBe(s.encrypt('x', aad));
  });
  it('rejects tampering', () => {
    const s = svc('k1', { k1 });
    const parts = s.encrypt('abc', aad).split('.');
    parts[4] = Buffer.from('zzzz').toString('base64url');
    expect(() => s.decrypt(parts.join('.'), aad)).toThrow('authentication failed');
  });
  it('binds ciphertext to tenant, store and purpose via AAD', () => {
    const s = svc('k1', { k1 });
    const env = s.encrypt('abc', aad);
    expect(() => s.decrypt(env, { ...aad, tenantId: 't2' })).toThrow();
    expect(() => s.decrypt(env, { ...aad, storeId: 's2' })).toThrow();
    expect(() => s.decrypt(env, { ...aad, purpose: 'salla_refresh_token' })).toThrow();
  });
  it('supports key rotation', () => {
    const old = svc('k0', { k0 }).encrypt('abc', aad);
    const rotated = svc('k1', { k1, k0 });
    expect(rotated.decrypt(old, aad)).toBe('abc');
    expect(rotated.needsRotation(old)).toBe(true);
    expect(rotated.needsRotation(rotated.encrypt('abc', aad))).toBe(false);
  });
  it('keyring parser enforces 32-byte keys', () => {
    expect(() => parseKeyring('k1:' + randomBytes(16).toString('base64'))).toThrow('32 bytes');
    expect(parseKeyring(`a:${k1.toString('base64')},b:${k0.toString('base64')}`).primary).toBe('a');
  });
});
