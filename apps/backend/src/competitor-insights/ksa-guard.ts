import { parseCompetitorUrl, domainOf } from '../scraper/url-guard';
import { ScrapeError } from '../scraper/scrape-error';
import type { CatalogEntry } from './ksa-catalog';

/**
 * Saudi-only guardrails for discovery. A suggested competitor must be:
 *  - on a Saudi domain (`.sa` or `.com.sa`), or a named operator on a generic domain that is
 *    listed below on purpose, one entry at a time, with the reason it counts as Saudi;
 *  - a domain the competitor URL guard accepts (https, public, standard port, no credentials);
 *  - suggested only to stores that price in SAR, since the comparison is meaningless otherwise.
 *
 * Anything else is dropped before it can be shown or stored, however the catalogue came to hold it.
 */

export const COUNTRY_CODE = 'SA';
export const CURRENCY = 'SAR';

/**
 * Operators that serve Saudi customers but are not on a `.sa` domain. Each is an explicit,
 * reviewed exception: do not add a domain here just because it is popular in the region.
 */
export const KSA_GENERIC_TLD_OPERATORS: ReadonlySet<string> = new Set([
  'noon.com', // marketplace with a dedicated Saudi storefront
  'jarir.com', // Saudi retailer, Saudi-headquartered
  'extra.com', // Saudi retailer (United Electronics Co.)
  'nahdionline.com', // Saudi pharmacy chain
  'al-dawaa.com', // Saudi pharmacy chain
  'namshi.com', // fashion marketplace shipping to the Kingdom
  'ounass.com', // luxury retailer shipping to the Kingdom
]);

export function isSaudiTld(domain: string): boolean {
  return domain === 'sa' || domain.endsWith('.sa');
}

export type KsaRejection = 'not_saudi_domain' | 'invalid_domain';

/** Null when the entry may be suggested, otherwise why not. */
export function ksaRejection(entry: Pick<CatalogEntry, 'domain'>): KsaRejection | null {
  const domain = entry.domain.toLowerCase();
  let normalised: string;
  try {
    normalised = domainOf(parseCompetitorUrl(`https://${domain}`));
  } catch (err) {
    if (err instanceof ScrapeError) return 'invalid_domain';
    throw err;
  }
  if (normalised !== domain) return 'invalid_domain';
  return isSaudiTld(domain) || KSA_GENERIC_TLD_OPERATORS.has(domain) ? null : 'not_saudi_domain';
}

/** The catalogue entries that pass every guardrail. */
export function eligibleEntries<T extends Pick<CatalogEntry, 'domain'>>(entries: readonly T[]): T[] {
  return entries.filter((e) => ksaRejection(e) === null);
}

/** Discovery only makes sense for stores that price in Saudi riyals. */
export function isSupportedCurrency(storeCurrency: string): boolean {
  return storeCurrency.toUpperCase() === CURRENCY;
}
