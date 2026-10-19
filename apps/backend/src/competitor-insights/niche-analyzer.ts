import { NICHES } from './ksa-catalog';

/**
 * Arabic-aware text normalisation for matching: lower case, no diacritics or tatweel, one form of
 * alef / yaa / taa marbuta. Applied to both product names and keywords so they meet in the middle.
 */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

const tokens = (normalised: string): string[] => normalised.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

interface CompiledKeyword {
  niche: string;
  text: string;
  /** Short or Latin keywords must equal a whole word: "tv" must not match "stvlen", "بن" not "ابن". */
  wholeWord: boolean;
}

const KEYWORDS: readonly CompiledKeyword[] = NICHES.flatMap((n) =>
  n.keywords.map((k) => {
    const text = normalise(k);
    return {
      niche: n.key,
      text,
      wholeWord: text.length <= 3 || /^[a-z0-9 ]+$/.test(text),
    };
  }),
);

/** Niche keys a product name belongs to (possibly several, possibly none). */
export function classify(productName: string): string[] {
  const name = normalise(productName);
  const words = new Set(tokens(name));
  const found = new Set<string>();

  for (const k of KEYWORDS) {
    if (found.has(k.niche)) continue;
    let hit: boolean;
    if (!k.wholeWord) {
      hit = name.includes(k.text);
    } else if (k.text.includes(' ')) {
      hit = ` ${name} `.includes(` ${k.text} `);
    } else {
      // Whole word, allowing the Arabic definite article and a plain English plural.
      hit =
        words.has(k.text) || words.has(`ال${k.text}`) || words.has(`${k.text}s`) || words.has(`${k.text}es`);
    }
    if (hit) found.add(k.niche);
  }
  return [...found];
}

export interface NicheCount {
  key: string;
  label: string;
  productCount: number;
  /** Share of ALL analysed products, 0-100 with one decimal. */
  sharePct: number;
}

export interface NicheAnalysis {
  total: number;
  /** Products that matched at least one niche. The rest are simply unclassified, not "no niche". */
  classified: number;
  /** One entry per analysed product, same order as the input. */
  productNiches: string[][];
  niches: NicheCount[];
}

export function analyzeNiches(products: ReadonlyArray<{ name: string }>): NicheAnalysis {
  const productNiches = products.map((p) => classify(p.name));
  const counts = new Map<string, number>();
  for (const keys of productNiches) for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);

  const total = products.length;
  const niches = NICHES.filter((n) => counts.has(n.key))
    .map((n) => ({
      key: n.key,
      label: n.label,
      productCount: counts.get(n.key)!,
      sharePct: Math.round((counts.get(n.key)! / total) * 1000) / 10,
    }))
    .sort((a, b) => b.productCount - a.productCount || a.key.localeCompare(b.key));

  return {
    total,
    classified: productNiches.filter((k) => k.length > 0).length,
    productNiches,
    niches,
  };
}
