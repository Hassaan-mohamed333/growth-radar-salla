import { Inject, Injectable, Logger } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { ENV, type Env } from '../config/env';

export class SallaApiError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs?: number,
  ) {
    super(`Salla API responded ${status}`); // never include the response body: it may echo credentials
  }
  /** 5xx / 429 / network are retried by BullMQ backoff; other 4xx will never succeed. */
  get retryable() {
    return this.status === 429 || this.status >= 500 || this.status === 0;
  }
  /** Wrap so BullMQ stops retrying permanent failures. */
  toJobError(): Error {
    return this.retryable ? this : new UnrecoverableError(this.message);
  }
}

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 8 * 1024 * 1024;

/** Thin, bounded HTTP client. Base URL is fixed from config; callers only pass relative paths (no SSRF surface). */
@Injectable()
export class SallaApiClient {
  private readonly log = new Logger(SallaApiClient.name);
  constructor(@Inject(ENV) private readonly env: Env) {}

  async get(accessToken: string, path: string, query: Record<string, string | number> = {}): Promise<unknown> {
    const url = new URL(this.env.SALLA_API_BASE + path);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
    return this.request(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
  }

  async postForm(url: string, form: Record<string, string>): Promise<unknown> {
    return this.request(new URL(url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(form).toString(),
    });
  }

  private async request(url: URL, init: RequestInit): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new SallaApiError(0); // network / timeout
    }
    if (!res.ok) {
      const ra = Number(res.headers.get('retry-after'));
      this.log.warn(`Salla ${init.method ?? 'GET'} ${url.pathname} -> ${res.status}`); // path only, no query/body
      throw new SallaApiError(res.status, Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined);
    }
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_BYTES) throw new SallaApiError(502);
    return res.json();
  }
}
