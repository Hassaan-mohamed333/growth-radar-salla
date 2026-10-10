import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    APP_URL: z.string().url(),
    WEB_URL: z.string().url(),
    APP_ROLE: z.enum(['api', 'worker', 'all']).default('all'),
    TRUST_PROXY: bool.default('false'),

    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),

    SALLA_CLIENT_ID: z.string().min(1),
    SALLA_CLIENT_SECRET: z.string().min(1),
    SALLA_AUTH_URL: z.string().url().default('https://accounts.salla.sa/oauth2/auth'),
    SALLA_TOKEN_URL: z.string().url().default('https://accounts.salla.sa/oauth2/token'),
    SALLA_API_BASE: z.string().url().default('https://api.salla.dev/admin/v2'),
    SALLA_SCOPES: z.string().default('offline_access'),
    SALLA_USE_PKCE: bool.default('true'),
    SALLA_WEBHOOK_STRATEGY: z.enum(['signature', 'token']).default('signature'),
    SALLA_WEBHOOK_SECRET: z.string().min(16, 'webhook secret too short'),

    TOKEN_ENCRYPTION_KEYS: z.string().min(1),
    SESSION_JWT_SECRET: z.string().min(32),
    /** Keyed-hash secret for customer pseudonymisation (kept separate from encryption keys; rotating it re-keys hashes). */
    PII_HASH_KEY: z.string().min(32),
    SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(7 * 86400).default(8 * 3600),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      for (const k of ['APP_URL', 'WEB_URL'] as const) {
        if (!env[k].startsWith('https://')) ctx.addIssue({ code: 'custom', path: [k], message: 'must be https in production' });
      }
    }
  });

export type Env = z.infer<typeof schema> & { encryptionKeys: ReadonlyMap<string, Buffer>; primaryKeyId: string };

/** Parses "k1:<b64>,k0:<b64>"; first entry is the primary (encrypting) key. Every key must be exactly 32 bytes. */
export function parseKeyring(raw: string): { keys: Map<string, Buffer>; primary: string } {
  const keys = new Map<string, Buffer>();
  let primary = '';
  for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const idx = part.indexOf(':');
    const id = part.slice(0, idx);
    const b64 = part.slice(idx + 1);
    if (idx < 1 || !/^[A-Za-z0-9_-]{1,16}$/.test(id)) throw new Error('TOKEN_ENCRYPTION_KEYS: invalid key id');
    const key = Buffer.from(b64, 'base64');
    if (key.length !== 32) throw new Error(`TOKEN_ENCRYPTION_KEYS: key "${id}" must decode to exactly 32 bytes`);
    if (keys.has(id)) throw new Error(`TOKEN_ENCRYPTION_KEYS: duplicate key id "${id}"`);
    keys.set(id, key);
    primary ||= id;
  }
  if (!primary) throw new Error('TOKEN_ENCRYPTION_KEYS: no keys configured');
  return { keys, primary };
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    // Print variable names + reasons only, never values.
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${msg}`);
  }
  const { keys, primary } = parseKeyring(parsed.data.TOKEN_ENCRYPTION_KEYS);
  return { ...parsed.data, encryptionKeys: keys, primaryKeyId: primary };
}

export const ENV = Symbol('ENV');
