// Product ranking report from the catalogue's own counters. `soldQuantity` and `views` are lifetime
// totals reported by Salla (no time window is documented), so every ranking here is "all time".
// Profit is an ESTIMATE: lifetime units x today's margin, not the margin at each sale.

export interface ReportProduct {
  id: string;
  name: string;
  status: 'SALE' | 'OUT' | 'HIDDEN' | 'DELETED';
  price: number;
  salePrice: number | null;
  costPrice: number | null;
  soldQuantity: number | null;
  views: number | null;
}

export interface RankedProduct {
  id: string;
  name: string;
  value: number;
}

export interface ProfitRow extends RankedProduct {
  soldQuantity: number;
  /** Margin per unit at today's selling price. */
  unitProfit: number;
}

export interface ProductReport {
  /** Products with a sold counter / views counter at all (null counters are excluded). */
  coverage: { withSales: number; withViews: number; total: number };
  topSellers: RankedProduct[];
  /** Visible products with no recorded sales at all. */
  neverSold: { count: number; sample: Array<{ id: string; name: string }> };
  mostViewed: RankedProduct[];
  /** Many views, few purchases: the page is being seen but not convincing. */
  lowConversion: Array<RankedProduct & { soldQuantity: number; conversionPct: number }>;
  profit: {
    /** Products with known cost and at least one sale. */
    counted: number;
    most: ProfitRow[];
    least: ProfitRow[];
  };
}

const LIST = 5;
const MIN_VIEWS_FOR_CONVERSION = 100;
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const sellingPrice = (p: Pick<ReportProduct, 'price' | 'salePrice'>) =>
  p.salePrice !== null && p.salePrice > 0 && p.salePrice < p.price ? p.salePrice : p.price;

export function computeProductReport(all: ReportProduct[]): ProductReport {
  const live = all.filter((p) => p.status === 'SALE' || p.status === 'OUT');
  const withSales = live.filter((p) => p.soldQuantity !== null);
  const withViews = live.filter((p) => p.views !== null);

  const topSellers = withSales
    .filter((p) => (p.soldQuantity as number) > 0)
    .sort((a, b) => (b.soldQuantity as number) - (a.soldQuantity as number))
    .slice(0, LIST)
    .map((p) => ({ id: p.id, name: p.name, value: p.soldQuantity as number }));

  // Only products that are on sale can be "never sold" in a way the merchant can act on.
  const never = withSales.filter((p) => p.status === 'SALE' && p.soldQuantity === 0);

  const mostViewed = withViews
    .filter((p) => (p.views as number) > 0)
    .sort((a, b) => (b.views as number) - (a.views as number))
    .slice(0, LIST)
    .map((p) => ({ id: p.id, name: p.name, value: p.views as number }));

  const lowConversion = live
    .filter(
      (p) => p.views !== null && p.soldQuantity !== null && p.views >= MIN_VIEWS_FOR_CONVERSION,
    )
    .map((p) => ({
      id: p.id,
      name: p.name,
      value: p.views as number,
      soldQuantity: p.soldQuantity as number,
      conversionPct: round2(((p.soldQuantity as number) / (p.views as number)) * 100),
    }))
    .sort((a, b) => a.conversionPct - b.conversionPct || b.value - a.value)
    .slice(0, LIST);

  const profitRows: ProfitRow[] = live
    .filter(
      (p) => p.costPrice !== null && p.costPrice > 0 && p.soldQuantity !== null && p.soldQuantity > 0,
    )
    .map((p) => {
      const unit = sellingPrice(p) - (p.costPrice as number);
      return {
        id: p.id,
        name: p.name,
        soldQuantity: p.soldQuantity as number,
        unitProfit: round2(unit),
        value: round2(unit * (p.soldQuantity as number)),
      };
    });

  return {
    coverage: { withSales: withSales.length, withViews: withViews.length, total: live.length },
    topSellers,
    neverSold: {
      count: never.length,
      sample: never.slice(0, LIST).map((p) => ({ id: p.id, name: p.name })),
    },
    mostViewed,
    lowConversion: lowConversion.map((r) => ({ ...r, conversionPct: round1(r.conversionPct) })),
    profit: {
      counted: profitRows.length,
      most: [...profitRows].sort((a, b) => b.value - a.value).slice(0, LIST),
      least: [...profitRows].sort((a, b) => a.value - b.value).slice(0, LIST),
    },
  };
}
