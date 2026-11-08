import { normalise } from '../competitor-insights/niche-analyzer';

/**
 * Scores how likely two product titles name the same product. Pure and rule-based: no language
 * model and no network, so the same two titles always give the same score and a wrong match can be
 * explained from the numbers below.
 *
 * Two signals decide it:
 *   1. Shared descriptive words (Arabic-aware: alef/yaa/taa-marbuta forms, the definite article).
 *   2. Sizes and quantities. "500 g" against "1 kg" is a different product even with identical
 *      words, and a price comparison across sizes is worse than no comparison.
 */

/** At or above this a match is linked without asking. Deliberately high. */
export const AUTO_LINK_SCORE = 85;
/** At or above this a match is shown to the merchant to confirm. */
export const SUGGEST_SCORE = 55;

const STOP_WORDS = new Set([
  // Arabic function words and marketing filler
  'من', 'في', 'مع', 'و', 'او', 'على', 'الى', 'عن', 'جديد', 'اصلي', 'حصري', 'افضل', 'مميز',
  // English
  'the', 'for', 'with', 'and', 'of', 'by', 'in', 'new', 'original', 'best', 'a', 'an',
]);

const UNIT_ALIASES: Record<string, { unit: 'g' | 'ml' | 'pcs'; factor: number }> = {
  g: { unit: 'g', factor: 1 }, gm: { unit: 'g', factor: 1 }, gram: { unit: 'g', factor: 1 }, grams: { unit: 'g', factor: 1 },
  kgs: { unit: 'g', factor: 1000 }, kilo: { unit: 'g', factor: 1000 },
  liter: { unit: 'ml', factor: 1000 }, litre: { unit: 'ml', factor: 1000 },
  غ: { unit: 'g', factor: 1 }, جم: { unit: 'g', factor: 1 }, جرام: { unit: 'g', factor: 1 }, غرام: { unit: 'g', factor: 1 },
  kg: { unit: 'g', factor: 1000 }, كجم: { unit: 'g', factor: 1000 }, كغ: { unit: 'g', factor: 1000 }, كيلو: { unit: 'g', factor: 1000 },
  ml: { unit: 'ml', factor: 1 }, مل: { unit: 'ml', factor: 1 },
  l: { unit: 'ml', factor: 1000 }, ltr: { unit: 'ml', factor: 1000 }, لتر: { unit: 'ml', factor: 1000 }, ل: { unit: 'ml', factor: 1000 },
  pcs: { unit: 'pcs', factor: 1 }, قطعه: { unit: 'pcs', factor: 1 }, حبه: { unit: 'pcs', factor: 1 },
};

const QUANTITY = /(\d+(?:\.\d+)?)\s*([a-zء-ي]{1,6})?(?![a-zء-ي])/g;

export interface MatchScore {
  /** 0-100. */
  score: number;
  /** False when both titles state a size/quantity and they differ. Blocks auto-linking. */
  quantitiesAgree: boolean;
  /** Descriptive words found in both titles. */
  sharedWords: number;
}

export function scoreMatch(ours: string, theirs: string): MatchScore {
  const a = analyse(ours);
  const b = analyse(theirs);

  const shared = countShared(a.words, b.words);
  const quantitiesAgree = agree(a.sized, b.sized) && agree(a.plain, b.plain);

  if (a.words.length === 0 || b.words.length === 0 || shared === 0) {
    return { score: 0, quantitiesAgree, sharedWords: shared };
  }

  // Coverage of OUR name matters most (a competitor title is usually longer than ours); the Dice
  // term keeps a short generic title from scoring as high as an exact one.
  const coverage = shared / a.words.length;
  const dice = (2 * shared) / (a.words.length + b.words.length);
  let score = 100 * (0.65 * coverage + 0.35 * dice);

  // One shared word is weak evidence unless our whole name is that word.
  if (shared < 2 && a.words.length >= 3) score = Math.min(score, 50);
  // A one-word name ("قهوة") matches anything in the category.
  if (a.words.length === 1) score = Math.min(score, 60);
  // Same words, different size: not the same product to compare prices against.
  if (!quantitiesAgree) score = Math.min(score, 35);

  return { score: Math.round(score), quantitiesAgree, sharedWords: shared };
}

/** The words worth sending to a store's search box: descriptive, no sizes, in the original order. */
export function searchQuery(productName: string, maxWords = 5): string {
  const seen = new Set<string>();
  const out: string[] = [];
  // Words are matched on their normalised form but sent as typed: a store's search may not fold ة/ه.
  for (const raw of toLatinDigits(productName).split(/[^\p{L}\p{N}]+/u)) {
    const w = stripArticle(normalise(raw));
    if (w.length < 2 || STOP_WORDS.has(w) || /^\d/.test(w) || UNIT_ALIASES[w] || seen.has(w)) continue;
    seen.add(w);
    out.push(raw);
    if (out.length >= maxWords) break;
  }
  return out.join(' ');
}

interface Analysed {
  words: string[];
  /** Canonical sizes such as "500g", "1000ml". */
  sized: Set<string>;
  /** Bare numbers with no unit (model numbers). */
  plain: Set<string>;
}

function analyse(text: string): Analysed {
  const t = normalise(toLatinDigits(text));
  const sized = new Set<string>();
  const plain = new Set<string>();

  for (const m of t.matchAll(QUANTITY)) {
    const value = Number(m[1]);
    if (!Number.isFinite(value) || value <= 0) continue;
    const alias = m[2] ? UNIT_ALIASES[m[2]] : undefined;
    // A number followed by a known unit is a size; any other number ("15", "15 pro") is a model number.
    if (alias) sized.add(`${Math.round(value * alias.factor * 100) / 100}${alias.unit}`);
    else plain.add(String(value));
  }

  const words: string[] = [];
  const seen = new Set<string>();
  for (const raw of t.split(/[^\p{L}\p{N}]+/u)) {
    const w = stripArticle(raw);
    if (w.length < 2 || STOP_WORDS.has(w) || /^\d/.test(w) || UNIT_ALIASES[w] || seen.has(w)) continue;
    seen.add(w);
    words.push(w);
  }
  return { words, sized, plain };
}

/** Two sets disagree only when both have entries and share none. No evidence is not disagreement. */
function agree(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size === 0 || b.size === 0) return true;
  for (const x of a) if (b.has(x)) return true;
  return false;
}

function countShared(a: readonly string[], b: readonly string[]): number {
  const used = new Set<number>();
  let shared = 0;
  for (const x of a) {
    const at = b.findIndex((y, i) => !used.has(i) && sameWord(x, y));
    if (at >= 0) {
      used.add(at);
      shared += 1;
    }
  }
  return shared;
}

/** Equal, or one typo apart for words long enough that a single edit is not a different word. */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  return withinOneEdit(a, b);
}

function withinOneEdit(a: string, b: string): boolean {
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** "ال" is dropped from longer words so "القهوة" meets "قهوة" (the text is already normalised). */
function stripArticle(w: string): string {
  return w.length > 4 && w.startsWith('ال') ? w.slice(2) : w;
}

function toLatinDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.');
}
