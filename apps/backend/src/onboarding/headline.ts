/** One of the merchant's products with the prices competitors are currently quoting for it. */
export interface PricedProduct {
  /** What the shopper pays today (sale price when there is one). */
  ours: number;
  competitors: Array<{ id: string; price: number }>;
}

export interface Headline {
  /** Products that have at least one competitor price. */
  comparedProducts: number;
  /** Our price is above the cheapest competitor. */
  higherProducts: number;
  /** Our price is below the cheapest competitor. */
  lowerProducts: number;
  samePriceProducts: number;
  /** Average % by which we are above the cheapest competitor, over the `higherProducts` only. */
  avgHigherPct: number | null;
  /** Distinct competitors whose prices went into the comparison. */
  competitorsCompared: number;
}

/**
 * The first-value sentence: "you are X% above competitors on Y of Z products".
 * Each product is judged against its cheapest competitor, because that is the price a shopper
 * comparing stores sees first. Null when nothing could be compared yet.
 */
export function computeHeadline(rows: PricedProduct[]): Headline | null {
  let compared = 0;
  let higher = 0;
  let lower = 0;
  let same = 0;
  let pctSum = 0;
  const competitors = new Set<string>();

  for (const row of rows) {
    const valid = row.competitors.filter((c) => Number.isFinite(c.price) && c.price > 0);
    if (valid.length === 0 || !(row.ours > 0)) continue;

    compared += 1;
    for (const c of valid) competitors.add(c.id);

    const lowest = Math.min(...valid.map((c) => c.price));
    if (row.ours > lowest) {
      higher += 1;
      pctSum += ((row.ours - lowest) / lowest) * 100;
    } else if (row.ours < lowest) {
      lower += 1;
    } else {
      same += 1;
    }
  }

  if (compared === 0) return null;
  return {
    comparedProducts: compared,
    higherProducts: higher,
    lowerProducts: lower,
    samePriceProducts: same,
    avgHigherPct: higher > 0 ? Math.round((pctSum / higher) * 10) / 10 : null,
    competitorsCompared: competitors.size,
  };
}
