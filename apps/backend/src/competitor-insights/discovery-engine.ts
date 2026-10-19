import type { CatalogEntry, CompetitorKind } from './ksa-catalog';

/** A reason is a fixed code plus numbers, rendered to text by the dashboard. Never free text. */
export type DiscoveryReason =
  | { code: 'niche_overlap'; niche: string; products: number }
  | { code: 'marketplace' };

export interface Suggestion {
  catalogKey: string;
  name: string;
  domain: string;
  kind: CompetitorKind;
  /** The niches of the store this competitor also sells in. */
  niches: string[];
  /** 0-100: share of the store's products that sit in a niche this competitor covers. */
  score: number;
  reasons: DiscoveryReason[];
}

/** Below this overlap a suggestion is noise rather than a competitor. */
export const MIN_SCORE = 10;
export const MAX_SUGGESTIONS = 12;

const KIND_RANK: Record<CompetitorKind, number> = { SPECIALIST: 0, RETAILER: 1, MARKETPLACE: 2 };

export function normaliseDomain(domain: string): string {
  return domain.toLowerCase().replace(/^www\./, '');
}

/**
 * Scores catalogue entries against the store's catalogue.
 *
 * @param productNiches niche keys per product (see analyzeNiches)
 * @param catalog       entries that already passed the KSA guardrails
 * @param skipDomains   domains not to suggest (already tracked, or the store's own)
 */
export function buildSuggestions(
  productNiches: ReadonlyArray<readonly string[]>,
  catalog: readonly CatalogEntry[],
  skipDomains: ReadonlySet<string>,
): Suggestion[] {
  const total = productNiches.length;
  if (total === 0) return [];

  const out: Suggestion[] = [];
  for (const entry of catalog) {
    if (skipDomains.has(normaliseDomain(entry.domain))) continue;

    const covers = new Set(entry.niches);
    const overlapping = productNiches.filter((keys) => keys.some((k) => covers.has(k))).length;
    const score = Math.round((overlapping / total) * 100);
    if (overlapping === 0 || score < MIN_SCORE) continue;

    const perNiche = new Map<string, number>();
    for (const keys of productNiches) {
      for (const k of keys) if (covers.has(k)) perNiche.set(k, (perNiche.get(k) ?? 0) + 1);
    }
    const reasons: DiscoveryReason[] = [...perNiche.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([niche, products]) => ({ code: 'niche_overlap' as const, niche, products }));
    if (entry.kind === 'MARKETPLACE') reasons.push({ code: 'marketplace' });

    out.push({
      catalogKey: entry.key,
      name: entry.name,
      domain: entry.domain,
      kind: entry.kind,
      niches: [...perNiche.keys()],
      score,
      reasons,
    });
  }

  // Best overlap first; at equal overlap a specialist is a sharper comparison than a marketplace.
  return out
    .sort((a, b) => b.score - a.score || KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.name.localeCompare(b.name))
    .slice(0, MAX_SUGGESTIONS);
}
