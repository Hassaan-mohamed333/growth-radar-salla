import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import { isRole, type Role } from '@radar/shared';
import { ENV, type Env } from '../../config/env';
import type { TenantContext } from '../../infra/tenant-context';

export const SESSION_COOKIE = 'radar_session';
const ISSUER = 'growth-radar';
const AUDIENCE = 'growth-radar-web';

/**
 * Session JWT = OUR credential for OUR API. It is completely separate from Salla OAuth tokens:
 * different secret, different audience, never contains a Salla token, and Salla tokens never reach the browser.
 */
@Injectable()
export class SessionService {
  private readonly key: Uint8Array;
  constructor(@Inject(ENV) private readonly env: Env) {
    this.key = new TextEncoder().encode(env.SESSION_JWT_SECRET);
  }

  async issue(ctx: TenantContext): Promise<string> {
    return new SignJWT({ tid: ctx.tenantId, role: ctx.role, scope: ctx.storeScope })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(ctx.userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(`${this.env.SESSION_TTL_SECONDS}s`)
      .sign(this.key);
  }

  async verify(token: string): Promise<TenantContext | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'], // pin: blocks alg=none / algorithm confusion
      });
      const { sub, tid, role, scope } = payload as Record<string, unknown>;
      if (typeof sub !== 'string' || typeof tid !== 'string' || !isRole(role)) return null;
      if (scope !== null && typeof scope !== 'string') return null;
      return { userId: sub, tenantId: tid, role: role as Role, storeScope: (scope as string | null) ?? null };
    } catch {
      return null;
    }
  }

  cookieOptions() {
    return {
      httpOnly: true,
      secure: this.env.NODE_ENV === 'production',
      sameSite: 'lax' as const, // 'lax': the session must survive the top-level redirect back from Salla
      path: '/',
      maxAge: this.env.SESSION_TTL_SECONDS,
    };
  }
}
