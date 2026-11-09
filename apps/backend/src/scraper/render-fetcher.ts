import { ScrapeError } from './scrape-error';
import { parseCompetitorUrl } from './url-guard';

/** Fetches a page through a rendering service (headless browser as a service). */
export interface RenderFetcher {
  fetchRendered(url: string): Promise<string>;
}

type FetchFn = typeof fetch;

/**
 * Tier 3, optional: a third-party rendering API for pages that need JavaScript or that refuse our
 * plain requests. It is configured by the operator with a URL template containing `{url}` (the
 * provider's API key lives inside the template and is never logged or put in an error message).
 *
 * Only public competitor pages are sent to it, after the same URL validation as every other
 * fetch. It costs money per request, so it is a last resort, not a default.
 */
export class RenderApiFetcher implements RenderFetcher {
  constructor(
    private readonly template: string,
    private readonly opts: { timeoutMs?: number; maxBytes?: number; fetchFn?: FetchFn } = {},
  ) {
    if (!template.startsWith('https://') || !template.includes('{url}')) {
      throw new Error('Render API template must be an https:// URL containing {url}');
    }
  }

  async fetchRendered(rawUrl: string): Promise<string> {
    const target = parseCompetitorUrl(rawUrl);
    // split/join, not replace(): the target URL may contain `$&`-style replacement patterns.
    const endpoint = this.template.split('{url}').join(encodeURIComponent(target.toString()));
    const doFetch = this.opts.fetchFn ?? fetch;

    let res: Response;
    try {
      res = await doFetch(endpoint, {
        method: 'GET',
        headers: { accept: 'text/html,*/*;q=0.5' },
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 45_000),
      });
    } catch {
      // Deliberately no cause: the message of a fetch error can include the endpoint (and its key).
      throw new ScrapeError('network', 'Rendering service unreachable', { retryable: true });
    }

    if (!res.ok) {
      throw new ScrapeError('http_error', `Rendering service answered ${res.status}`, {
        retryable: res.status >= 500,
      });
    }
    const html = await res.text();
    if (html.length > (this.opts.maxBytes ?? 3 * 1024 * 1024)) {
      throw new ScrapeError('too_large', 'Rendered page too large');
    }
    return html;
  }
}
