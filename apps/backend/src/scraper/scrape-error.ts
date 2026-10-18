/** Fixed vocabulary: stored in `competitors.last_scrape_error`, so never free text. */
export type ScrapeFailureKind =
  | 'invalid_url' // not a usable http(s) URL
  | 'forbidden_target' // resolves to a private/internal address (SSRF guard)
  | 'network' // connection reset / timeout / DNS hiccup
  | 'blocked' // 401/403/429/captcha: the site is refusing us
  | 'http_error' // other non-2xx
  | 'not_html' // wrong content type
  | 'too_large' // body over the size cap
  | 'parse_failed' // page fetched, no price found (layout changed?)
  | 'currency_mismatch'; // price found in a currency other than the listing's

/**
 * Why a merchant-supplied competitor URL was refused. Fixed vocabulary, so it can be
 * shown to the merchant without leaking internal topology (see URL_REJECTION_TEXT).
 */
export type UrlRejectionReason =
  | 'too_long'
  | 'malformed'
  | 'unsupported_scheme'
  | 'has_credentials'
  | 'internal_host'
  | 'private_address'
  | 'single_label_host'
  | 'unsupported_port';

export class ScrapeError extends Error {
  constructor(
    readonly kind: ScrapeFailureKind,
    message: string,
    readonly options: {
      /** Worth another immediate attempt (transient). */
      retryable?: boolean;
      /** Server-requested wait (Retry-After), in ms. */
      retryAfterMs?: number;
      /** Set only when a URL is refused up front (kind `invalid_url` / `forbidden_target`). */
      reason?: UrlRejectionReason;
    } = {},
  ) {
    super(message);
    this.name = 'ScrapeError';
  }

  get retryable(): boolean {
    return this.options.retryable ?? false;
  }

  get retryAfterMs(): number | undefined {
    return this.options.retryAfterMs;
  }

  get reason(): UrlRejectionReason | undefined {
    return this.options.reason;
  }
}
