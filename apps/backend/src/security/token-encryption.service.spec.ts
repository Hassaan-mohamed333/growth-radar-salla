import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { TokenDecryptionError, TokenEncryptionService } from './token-encryption.service';

function makeService(key = randomBytes(32).toString('base64'), version = 1) {
  const values: Record<string, unknown> = {
    TOKEN_ENCRYPTION_KEY: key,
    TOKEN_ENCRYPTION_KEY_VERSION: version,
  };
  const config = { get: (k: string) => values[k] } as unknown as ConfigService<never, true>;
  return new TokenEncryptionService(config as never);
}

describe('TokenEncryptionService', () => {
  const ctx = 'store:123:access';

  it('round-trips a token', () => {
    const svc = makeService();
    const envelope = svc.encrypt('salla-access-token', ctx);
    expect(envelope).toMatch(/^v1\./);
    expect(envelope).not.toContain('salla-access-token');
    expect(svc.decrypt(envelope, ctx)).toBe('salla-access-token');
  });

  it('uses a fresh IV for every encryption', () => {
    const svc = makeService();
    expect(svc.encrypt('same', ctx)).not.toBe(svc.encrypt('same', ctx));
  });

  it('rejects a different context (AAD mismatch)', () => {
    const svc = makeService();
    const envelope = svc.encrypt('tok', ctx);
    expect(() => svc.decrypt(envelope, 'store:999:access')).toThrow(TokenDecryptionError);
  });

  it('rejects tampered ciphertext', () => {
    const svc = makeService();
    const parts = svc.encrypt('tok', ctx).split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => svc.decrypt(parts.join('.'), ctx)).toThrow(TokenDecryptionError);
  });

  it('rejects a different key and malformed input', () => {
    const envelope = makeService().encrypt('tok', ctx);
    expect(() => makeService().decrypt(envelope, ctx)).toThrow(TokenDecryptionError);
    expect(() => makeService().decrypt('garbage', ctx)).toThrow(TokenDecryptionError);
  });
});
