// Search links that let a merchant look for their product at competitors in their OWN browser.
// Nothing here is fetched by راصد: it only builds URLs the merchant opens, so no site is scraped.

export interface SearchLink {
  label: string;
  href: string;
}

/** Stores worth checking for most Saudi catalogues, each with its own on-site search page. */
const STORE_SEARCHES: ReadonlyArray<{
  label: string;
  url: (q: string) => string;
}> = [
  { label: 'نون', url: (q) => `https://www.noon.com/saudi-ar/search/?q=${q}` },
  { label: 'أمازون السعودية', url: (q) => `https://www.amazon.sa/s?k=${q}` },
];

const MAX_QUERY = 80;

/** Trims a product name down to something a search box handles well. */
export function searchQuery(productName: string): string {
  return productName.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY);
}

/**
 * Links for finding `productName` at competitors: Google Shopping first (many stores in one
 * result page), then the big marketplaces, then a site-restricted Google search for every
 * competitor store the merchant already follows (their own search URL formats are unknown).
 */
export function competitorSearchLinks(
  productName: string,
  followedDomains: readonly string[] = [],
): SearchLink[] {
  const raw = searchQuery(productName);
  if (!raw) return [];
  const q = encodeURIComponent(raw);

  const links: SearchLink[] = [
    {
      label: 'Google Shopping',
      href: `https://www.google.com/search?tbm=shop&q=${q}&hl=ar&gl=sa`,
    },
    ...STORE_SEARCHES.map((s) => ({ label: s.label, href: s.url(q) })),
  ];

  const seen = new Set<string>();
  for (const d of followedDomains) {
    const domain = d
      .trim()
      .toLowerCase()
      .replace(/^www\./, '');
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) || seen.has(domain)) continue;
    seen.add(domain);
    links.push({
      label: domain,
      href: `https://www.google.com/search?q=${encodeURIComponent(`${raw} site:${domain}`)}&hl=ar`,
    });
  }
  return links;
}
