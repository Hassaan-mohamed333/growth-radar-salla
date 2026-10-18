import * as dns from 'node:dns';
import * as http from 'node:http';
import * as https from 'node:https';
import type { LookupFunction } from 'node:net';
import { ScrapeError } from './scrape-error';
import { type CompetitorUrlOptions, isPublicAddress, parseCompetitorUrl } from './url-guard';

/** Abstraction over "get me the HTML of this page", so a headless browser or a
 * third-party scraping API can replace the plain HTTP implementation later. */
export abstract class PageFetcher {
  abstract fetchHtml(url: string): Promise<string>;
}

export interface HttpPageFetcherOptions {
  userAgent: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Tests only: allow loopback targets. Never wired to configuration. */
  allowPrivateAddresses?: boolean;
  /** Tests only: see CompetitorUrlOptions. Production keeps the 80/443 rule. */
  allowNonStandardPorts?: boolean;
  /** Host → addresses. Defaults to the system resolver; tests inject a fake. */
  resolve?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
}

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ECONNABORTED',
  'EPIPE',
  'EAI_AGAIN',
  'UND_ERR_SOCKET',
]);

/**
 * Plain HTTP(S) GET with the safeguards needed to fetch merchant-supplied URLs:
 * public addresses only (checked on every connection, including redirects),
 * bounded time and size, HTML only, identifiable User-Agent.
 */
export class HttpPageFetcher extends PageFetcher {
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly maxRedirects: number;

  constructor(private readonly opts: HttpPageFetcherOptions) {
    super();
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
    this.maxRedirects = opts.maxRedirects ?? 3;
  }

  async fetchHtml(rawUrl: string): Promise<string> {
    const urlOptions: CompetitorUrlOptions = { allowNonStandardPorts: this.opts.allowNonStandardPorts };
    let url = parseCompetitorUrl(rawUrl, urlOptions);

    for (let hop = 0; hop <= this.maxRedirects; hop++) {
      const res = await this.get(url);

      if (res.status >= 200 && res.status < 300) return res.body;

      if (res.status >= 300 && res.status < 400 && res.headers.location) {
        // Re-validate every hop: a public URL may redirect to an internal one.
        url = parseCompetitorUrl(new URL(res.headers.location, url).toString(), urlOptions);
        continue;
      }
      throw classifyStatus(res.status, res.headers['retry-after']);
    }
    throw new ScrapeError('http_error', 'Too many redirects');
  }

  private get(url: URL): Promise<RawResponse> {
    const lib = url.protocol === 'https:' ? https : http;

    return new Promise<RawResponse>((resolve, reject) => {
      let settled = false;
      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        fn();
      };

      const req = lib.request(
        url,
        {
          method: 'GET',
          lookup: this.guardedLookup,
          headers: {
            'user-agent': this.opts.userAgent,
            accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
            'accept-language': 'ar,en;q=0.8',
            'accept-encoding': 'identity',
          },
        },
        (res) => {
          const status = res.statusCode ?? 0;
          const isOk = status >= 200 && status < 300;

          if (isOk && !/text\/html|application\/xhtml\+xml/i.test(String(res.headers['content-type'] ?? ''))) {
            res.destroy();
            return done(() => reject(new ScrapeError('not_html', 'Response is not HTML')));
          }
          if (!isOk) {
            res.resume(); // we only need status + headers
            return done(() => resolve({ status, headers: res.headers, body: '' }));
          }

          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > this.maxBytes) {
              res.destroy();
              done(() => reject(new ScrapeError('too_large', 'Response too large')));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () =>
            done(() =>
              resolve({ status, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }),
            ),
          );
          res.on('error', (err) => done(() => reject(toNetworkError(err))));
        },
      );

      // Overall deadline (socket-idle timeouts alone allow slow-drip responses).
      const deadline = setTimeout(() => {
        req.destroy();
        done(() => reject(new ScrapeError('network', 'Timed out', { retryable: true })));
      }, this.timeoutMs);

      req.on('error', (err) => done(() => reject(toNetworkError(err))));
      req.end();
    });
  }

  /**
   * Resolves the host and refuses non-public addresses at connect time, so DNS
   * rebinding between validation and connection cannot reach internal hosts.
   */
  private readonly guardedLookup: LookupFunction = (hostname, options, callback) => {
    const resolve =
      this.opts.resolve ??
      ((host: string) => dns.promises.lookup(host, { all: true, verbatim: true }));

    resolve(hostname).then(
      (addresses) => this.acceptAddresses(addresses, options, callback),
      (err: NodeJS.ErrnoException) => callback(err, '', 4),
    );
  };

  private acceptAddresses(
    addresses: Array<{ address: string; family: number }>,
    options: dns.LookupOptions,
    callback: Parameters<LookupFunction>[2],
  ): void {
    const blocked =
      !this.opts.allowPrivateAddresses &&
      (addresses.length === 0 || addresses.some((a) => !isPublicAddress(a.address)));
    if (blocked) {
      const err = new ScrapeError('forbidden_target', 'Host resolves to a non-public address');
      return callback(err as unknown as NodeJS.ErrnoException, '', 4);
    }
    if (options.all) return callback(null, addresses as dns.LookupAddress[]);
    const first = addresses[0]!;
    return callback(null, first.address, first.family);
  }
}

function classifyStatus(status: number, retryAfter: string | string[] | undefined): ScrapeError {
  const retryAfterMs = parseRetryAfter(Array.isArray(retryAfter) ? retryAfter[0] : retryAfter);
  if (status === 429) {
    return new ScrapeError('blocked', 'Rate limited (429)', { retryable: true, retryAfterMs });
  }
  if (status === 401 || status === 403 || status === 451) {
    return new ScrapeError('blocked', `Access refused (${status})`);
  }
  if (status >= 500) {
    return new ScrapeError('http_error', `Server error (${status})`, { retryable: true, retryAfterMs });
  }
  return new ScrapeError('http_error', `Unexpected status ${status}`);
}

/** Retry-After is either delay-seconds or an HTTP date. */
export function parseRetryAfter(value: string | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return Math.round(secs * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

function toNetworkError(err: unknown): ScrapeError {
  if (err instanceof ScrapeError) return err;
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  const retryable = code === undefined || RETRYABLE_NETWORK_CODES.has(code);
  return new ScrapeError('network', `Network error${code ? ` (${code})` : ''}`, { retryable });
}
