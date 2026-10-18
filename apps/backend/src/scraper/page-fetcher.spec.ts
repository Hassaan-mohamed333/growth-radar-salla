import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { HttpPageFetcher, type HttpPageFetcherOptions, parseRetryAfter } from './page-fetcher';
import { ScrapeError } from './scrape-error';

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

let server: http.Server;
let origin: string;
let handler: Handler;

beforeAll(async () => {
  server = http.createServer((req, res) => handler(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  // `shop.test` is a public-looking name that the fake resolver maps to the loopback server.
  origin = `http://shop.test:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const toLoopback = async () => [{ address: '127.0.0.1', family: 4 }];

const html = (res: http.ServerResponse, body: string, status = 200) => {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body);
};

// Loopback is reachable only because the test opts in; production never does.
// The server listens on an ephemeral port, so the 80/443 rule is opted out here as well.
const fetcher = (over: Partial<HttpPageFetcherOptions> = {}) =>
  new HttpPageFetcher({
    userAgent: 'TestBot/1.0',
    allowPrivateAddresses: true,
    allowNonStandardPorts: true,
    resolve: toLoopback,
    ...over,
  });

const failureOf = async (p: Promise<unknown>): Promise<ScrapeError> => {
  try {
    await p;
  } catch (err) {
    if (err instanceof ScrapeError) return err;
    throw err;
  }
  throw new Error('expected a ScrapeError');
};

describe('HttpPageFetcher', () => {
  it('returns the body and sends the configured User-Agent', async () => {
    let ua: string | undefined;
    handler = (req, res) => {
      ua = req.headers['user-agent'];
      html(res, '<p>hello</p>');
    };
    await expect(fetcher().fetchHtml(`${origin}/p/1`)).resolves.toBe('<p>hello</p>');
    expect(ua).toBe('TestBot/1.0');
  });

  it('follows redirects', async () => {
    handler = (req, res) => {
      if (req.url === '/start') {
        res.writeHead(302, { location: '/final' });
        return res.end();
      }
      html(res, 'final page');
    };
    await expect(fetcher().fetchHtml(`${origin}/start`)).resolves.toBe('final page');
  });

  it('gives up on redirect loops', async () => {
    handler = (_req, res) => {
      res.writeHead(302, { location: '/again' });
      res.end();
    };
    const err = await failureOf(fetcher().fetchHtml(`${origin}/again`));
    expect(err).toMatchObject({ kind: 'http_error', retryable: false });
  });

  it('refuses a redirect to an internal address', async () => {
    handler = (_req, res) => {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' });
      res.end();
    };
    const err = await failureOf(fetcher().fetchHtml(`${origin}/`));
    expect(err.kind).toBe('forbidden_target');
  });

  it('classifies 429 as retryable blocked with Retry-After', async () => {
    handler = (_req, res) => {
      res.writeHead(429, { 'retry-after': '7' });
      res.end();
    };
    const err = await failureOf(fetcher().fetchHtml(`${origin}/`));
    expect(err).toMatchObject({ kind: 'blocked', retryable: true, retryAfterMs: 7_000 });
  });

  it('classifies 403 as blocked but not immediately retryable', async () => {
    handler = (_req, res) => {
      res.writeHead(403);
      res.end();
    };
    const err = await failureOf(fetcher().fetchHtml(`${origin}/`));
    expect(err).toMatchObject({ kind: 'blocked', retryable: false });
  });

  it('classifies 5xx as retryable and 404 as permanent', async () => {
    handler = (_req, res) => {
      res.writeHead(503);
      res.end();
    };
    expect(await failureOf(fetcher().fetchHtml(`${origin}/`))).toMatchObject({
      kind: 'http_error',
      retryable: true,
    });

    handler = (_req, res) => {
      res.writeHead(404);
      res.end();
    };
    expect(await failureOf(fetcher().fetchHtml(`${origin}/`))).toMatchObject({
      kind: 'http_error',
      retryable: false,
    });
  });

  it('rejects non-HTML responses', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/pdf' });
      res.end('%PDF');
    };
    expect((await failureOf(fetcher().fetchHtml(`${origin}/`))).kind).toBe('not_html');
  });

  it('aborts oversized bodies', async () => {
    handler = (_req, res) => html(res, 'x'.repeat(50_000));
    const err = await failureOf(fetcher({ maxBytes: 1_000 }).fetchHtml(`${origin}/`));
    expect(err.kind).toBe('too_large');
  });

  it('times out slow servers as a retryable network error', async () => {
    handler = () => {
      /* never respond */
    };
    const err = await failureOf(fetcher({ timeoutMs: 150 }).fetchHtml(`${origin}/`));
    expect(err).toMatchObject({ kind: 'network', retryable: true });
  });

  it('blocks a public-looking host that resolves to loopback (DNS rebinding)', async () => {
    handler = (_req, res) => html(res, 'secret');
    const strict = new HttpPageFetcher({
      userAgent: 'TestBot/1.0',
      resolve: toLoopback,
      allowNonStandardPorts: true, // the test server's port; the DNS check is what is under test
    });
    expect((await failureOf(strict.fetchHtml(`${origin}/`))).kind).toBe('forbidden_target');
  });

  it('blocks when any resolved address is private', async () => {
    const mixed = new HttpPageFetcher({
      userAgent: 'TestBot/1.0',
      allowNonStandardPorts: true,
      resolve: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.5', family: 4 },
      ],
    });
    expect((await failureOf(mixed.fetchHtml(`${origin}/`))).kind).toBe('forbidden_target');
  });

  it('rejects literal internal URLs before any request', async () => {
    const err = await failureOf(new HttpPageFetcher({ userAgent: 'x' }).fetchHtml('http://127.0.0.1:1/'));
    expect(err.kind).toBe('forbidden_target');
  });

  it('refuses a non-standard port in production, before any request', async () => {
    const err = await failureOf(
      new HttpPageFetcher({ userAgent: 'x', resolve: toLoopback }).fetchHtml('https://shop.example.com:8443/'),
    );
    expect(err.kind).toBe('invalid_url');
  });
});

describe('parseRetryAfter', () => {
  it('parses seconds and HTTP dates', () => {
    expect(parseRetryAfter('30')).toBe(30_000);
    const now = Date.parse('2026-10-10T12:00:00Z');
    expect(parseRetryAfter('Sat, 10 Oct 2026 12:01:00 GMT', now)).toBe(60_000);
    expect(parseRetryAfter(undefined)).toBeUndefined();
    expect(parseRetryAfter('soon')).toBeUndefined();
  });
});
