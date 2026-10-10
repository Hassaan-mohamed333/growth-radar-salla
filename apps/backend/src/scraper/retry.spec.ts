import { withRetry } from './retry';
import { ScrapeError } from './scrape-error';

const transient = (retryAfterMs?: number) =>
  new ScrapeError('network', 'boom', { retryable: true, retryAfterMs });

function setup(attempts = 3) {
  const sleeps: number[] = [];
  return {
    sleeps,
    opts: {
      attempts,
      baseDelayMs: 100,
      maxDelayMs: 1_000,
      maxRetryAfterMs: 5_000,
      sleep: async (ms: number) => void sleeps.push(ms),
      random: () => 1, // full jitter → delay equals the backoff
    },
  };
}

describe('withRetry', () => {
  it('returns the first success without sleeping', async () => {
    const { opts, sleeps } = setup();
    await expect(withRetry(async () => 'ok', opts)).resolves.toBe('ok');
    expect(sleeps).toEqual([]);
  });

  it('retries transient errors with exponential backoff', async () => {
    const { opts, sleeps } = setup(4);
    const fn = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(transient())
      .mockRejectedValueOnce(transient())
      .mockResolvedValue('ok');

    await expect(withRetry(fn, opts)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([100, 200]);
  });

  it('gives up after the attempt budget', async () => {
    const { opts } = setup(3);
    const fn = jest.fn().mockRejectedValue(transient());
    await expect(withRetry(fn, opts)).rejects.toMatchObject({ kind: 'network' });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry permanent errors', async () => {
    const { opts } = setup();
    const fn = jest.fn().mockRejectedValue(new ScrapeError('parse_failed', 'no price'));
    await expect(withRetry(fn, opts)).rejects.toMatchObject({ kind: 'parse_failed' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not retry non-ScrapeErrors', async () => {
    const { opts } = setup();
    const fn = jest.fn().mockRejectedValue(new TypeError('bug'));
    await expect(withRetry(fn, opts)).rejects.toBeInstanceOf(TypeError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('honours a short Retry-After', async () => {
    const { opts, sleeps } = setup();
    const fn = jest.fn().mockRejectedValueOnce(transient(3_000)).mockResolvedValue('ok');
    await withRetry(fn, opts);
    expect(sleeps).toEqual([3_000]);
  });

  it('surfaces a Retry-After that is too long instead of waiting', async () => {
    const { opts, sleeps } = setup();
    const fn = jest.fn().mockRejectedValue(transient(60_000));
    await expect(withRetry(fn, opts)).rejects.toMatchObject({ retryAfterMs: 60_000 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });
});
