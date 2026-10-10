import { ScrapeError } from './scrape-error';

export interface RetryOptions {
  /** Total attempts including the first. */
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** A server-requested wait longer than this is not waited out in-process. */
  maxRetryAfterMs: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests; returns [0,1). */
  random?: () => number;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Runs `fn`, retrying only errors that declare themselves retryable.
 * Backoff is exponential with jitter; a Retry-After hint is honoured when it is
 * short enough, otherwise the error is surfaced so the scheduler can defer.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? realSleep;
  const random = opts.random ?? Math.random;

  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const retryable = err instanceof ScrapeError && err.retryable;
      if (!retryable || attempt >= opts.attempts) throw err;

      const hinted = err.retryAfterMs;
      if (hinted !== undefined && hinted > opts.maxRetryAfterMs) throw err;

      const backoff = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** (attempt - 1));
      const jittered = backoff / 2 + random() * (backoff / 2);
      await sleep(hinted !== undefined ? Math.max(hinted, jittered) : jittered);
    }
  }
}
