import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { Env } from '../config/env';

export const SESSION_COOKIE = 'gr_session';

const ISSUER = 'growth-radar';
const HEADER_B64 = encode({ alg: 'HS256', typ: 'JWT' });

/** The authenticated merchant context carried by the session. */
export interface SessionContext {
  tenantId: string;
  storeId: string;
}

interface Claims {
  iss: string;
  sub: string; // storeId
  tid: string; // tenantId
  iat: number;
  exp: number;
}

/**
 * Stateless HS256 session token, delivered in an httpOnly cookie.
 *
 * Only the algorithm we sign with is accepted (the header is compared against a
 * fixed value), so `alg: none` / algorithm-confusion tokens are rejected.
 */
@Injectable()
export class SessionService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  issue(ctx: SessionContext, now = Date.now()): string {
    const iat = Math.floor(now / 1000);
    const claims: Claims = {
      iss: ISSUER,
      sub: ctx.storeId,
      tid: ctx.tenantId,
      iat,
      exp: iat + this.ttlSeconds(),
    };
    const signingInput = `${HEADER_B64}.${encode(claims)}`;
    return `${signingInput}.${this.sign(signingInput)}`;
  }

  /** @returns the session context, or null for anything malformed/forged/expired. */
  verify(token: string | undefined, now = Date.now()): SessionContext | null {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts as [string, string, string];
    if (header !== HEADER_B64) return null;

    const expected = Buffer.from(this.sign(`${header}.${payload}`));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

    let claims: Partial<Claims>;
    try {
      claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<Claims>;
    } catch {
      return null;
    }
    if (
      claims.iss !== ISSUER ||
      typeof claims.sub !== 'string' ||
      typeof claims.tid !== 'string' ||
      typeof claims.exp !== 'number' ||
      claims.exp <= Math.floor(now / 1000)
    ) {
      return null;
    }
    return { storeId: claims.sub, tenantId: claims.tid };
  }

  setCookie(res: Response, ctx: SessionContext): void {
    res.cookie(SESSION_COOKIE, this.issue(ctx), { ...this.cookieOptions(), maxAge: this.ttlSeconds() * 1000 });
  }

  clearCookie(res: Response): void {
    res.clearCookie(SESSION_COOKIE, this.cookieOptions());
  }

  readCookie(req: Request): string | undefined {
    const header = req.headers.cookie;
    if (!header) return undefined;
    for (const part of header.split(';')) {
      const idx = part.indexOf('=');
      if (idx > 0 && part.slice(0, idx).trim() === SESSION_COOKIE) {
        try {
          return decodeURIComponent(part.slice(idx + 1).trim());
        } catch {
          return undefined;
        }
      }
    }
    return undefined;
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
      sameSite: 'lax' as const,
      path: '/',
      domain: this.config.get('SESSION_COOKIE_DOMAIN', { infer: true }),
    };
  }

  private ttlSeconds(): number {
    return this.config.get('SESSION_TTL_SECONDS', { infer: true });
  }

  private sign(input: string): string {
    return createHmac('sha256', this.config.get('SESSION_SECRET', { infer: true }))
      .update(input)
      .digest('base64url');
  }
}

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
