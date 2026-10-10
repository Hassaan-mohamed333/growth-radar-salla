import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit nonce, the GCM standard
const TAG_BYTES = 16;
const FORMAT = /^v(\d+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;

export class TokenDecryptionError extends Error {
  constructor(message = 'Unable to decrypt token') {
    // Deliberately generic: never leak key/ciphertext details to callers or logs.
    super(message);
    this.name = 'TokenDecryptionError';
  }
}

/**
 * AES-256-GCM envelope encryption for Salla OAuth tokens.
 *
 * Envelope: `v<keyVersion>.<iv>.<authTag>.<ciphertext>` (base64url segments).
 *
 * - A fresh random 96-bit IV is generated per encryption.
 * - `context` is bound as AAD (e.g. `store:<id>:access`), so a ciphertext copied
 *   to another row/field fails authentication instead of decrypting.
 * - The key version is embedded so keys can be rotated: stored rows report
 *   which version encrypted them (see `SallaConnection.keyVersion`).
 */
@Injectable()
export class TokenEncryptionService {
  private readonly key: Buffer;
  readonly keyVersion: number;

  constructor(config: ConfigService<Env, true>) {
    this.key = Buffer.from(config.get<string>('TOKEN_ENCRYPTION_KEY'), 'base64');
    if (this.key.length !== 32) {
      throw new Error('TOKEN_ENCRYPTION_KEY must decode to 32 bytes');
    }
    this.keyVersion = config.get<number>('TOKEN_ENCRYPTION_KEY_VERSION');
  }

  encrypt(plaintext: string, context: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [
      `v${this.keyVersion}`,
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  decrypt(envelope: string, context: string): string {
    const match = FORMAT.exec(envelope);
    if (!match) throw new TokenDecryptionError();

    const [, version, ivB64, tagB64, ctB64] = match as unknown as [
      string,
      string,
      string,
      string,
      string,
    ];
    if (Number(version) !== this.keyVersion) {
      // Rotation hook: look up the historical key for `version` here.
      throw new TokenDecryptionError();
    }

    const iv = Buffer.from(ivB64, 'base64url');
    const tag = Buffer.from(tagB64, 'base64url');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new TokenDecryptionError();

    try {
      const decipher = createDecipheriv(ALGORITHM, this.key, iv, { authTagLength: TAG_BYTES });
      decipher.setAAD(Buffer.from(context, 'utf8'));
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(Buffer.from(ctB64, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new TokenDecryptionError();
    }
  }
}
