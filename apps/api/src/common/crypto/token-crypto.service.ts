import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';

/**
 * AES-256-GCM envelope encryption for secrets at rest (Salla access/refresh tokens).
 *
 * Format:  v1.<keyId>.<iv>.<tag>.<ciphertext>      (each part base64url, no dots inside)
 *  - 96-bit random IV per message (NIST SP 800-38D recommended size).
 *  - keyId enables rotation: the first key in TOKEN_ENCRYPTION_KEYS encrypts, any listed key decrypts.
 *  - AAD binds a ciphertext to its purpose + tenant + store, so a ciphertext copied into another
 *    row/tenant/column fails authentication instead of decrypting.
 * Errors never include plaintext or key material.
 */
@Injectable()
export class TokenCryptoService {
  constructor(@Inject(ENV) private readonly env: Pick<Env, 'encryptionKeys' | 'primaryKeyId'>) {}

  encrypt(plaintext: string, aad: TokenAad): string {
    const key = this.env.encryptionKeys.get(this.env.primaryKeyId)!;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    cipher.setAAD(aadBuffer(aad));
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return ['v1', this.env.primaryKeyId, b64u(iv), b64u(cipher.getAuthTag()), b64u(ct)].join('.');
  }

  decrypt(envelope: string, aad: TokenAad): string {
    const parts = envelope.split('.');
    if (parts.length !== 5 || parts[0] !== 'v1') throw new Error('Malformed ciphertext envelope');
    const [, keyId, iv, tag, ct] = parts as [string, string, string, string, string];
    const key = this.env.encryptionKeys.get(keyId);
    if (!key) throw new Error('Unknown encryption key id');
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'), { authTagLength: 16 });
      decipher.setAAD(aadBuffer(aad));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      throw new Error('Ciphertext authentication failed'); // deliberately opaque
    }
  }

  /** True when the envelope was written with a non-primary key and should be re-encrypted. */
  needsRotation(envelope: string): boolean {
    return envelope.split('.')[1] !== this.env.primaryKeyId;
  }
}

export interface TokenAad {
  purpose: 'salla_access_token' | 'salla_refresh_token';
  tenantId: string;
  storeId: string;
}

function aadBuffer(a: TokenAad): Buffer {
  return Buffer.from(`${a.purpose}|${a.tenantId}|${a.storeId}`, 'utf8');
}
function b64u(b: Buffer): string {
  return b.toString('base64url');
}
