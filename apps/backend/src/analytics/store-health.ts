// Store health: what the merchant's own catalogue says about margins, stock and discounts.
// Pure functions over Product rows, so every number is traceable and testable. No competitor data.

export interface HealthProduct {
  id: string;
  name: string;
  status: 'SALE' | 'OUT' | 'HIDDEN' | 'DELETED';
  price: number;
  salePrice: number | null;
  costPrice: number | null;
  quantity: number | null;
}

export interface ProductRef {
  id: string;
  name: string;
}

export interface MarginRow extends ProductRef {
  /** Selling price actually charged (sale price when set). */
  sellingPrice: number;
  costPrice: number;
  marginPct: number;
}

export interface StoreHealth {
  /** Catalogue products that can be sold or are out of stock (hidden and deleted are excluded). */
  totalProducts: number;
  stock: {
    outOfStock: number;
    lowStock: number;
    lowStockThreshold: number;
    hidden: number;
    outOfStockItems: ProductRef[];
    lowStockItems: Array<ProductRef & { quantity: number }>;
  };
  margins: {
    withCost: number;
    missingCost: number;
    avgMarginPct: number | null;
    /** Sold at or below cost: the most urgent finding. */
    belowCost: MarginRow[];
    /** Lowest positive margins. */
    thinnest: MarginRow[];
  };
  discounts: {
    onSale: number;
    avgDiscountPct: number | null;
    deepest: Array<ProductRef & { discountPct: number }>;
  };
  inventory: {
    /** Cost value of stock on hand, counting only products with a known cost and quantity. */
    costValue: number | null;
    /** Retail value of the same units. */
    retailValue: number | null;
    productsCounted: number;
  };
}

export const LOW_STOCK_THRESHOLD = 5;
const LIST_SIZE = 8;
/** Below this margin a product is flagged as thin. */
const THIN_MARGIN_PCT = 15;

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

export const sellingPrice = (p: Pick<HealthProduct, 'price' | 'salePrice'>): number =>
  p.salePrice !== null && p.salePrice > 0 && p.salePrice < p.price ? p.salePrice : p.price;

export function computeStoreHealth(all: HealthProduct[]): StoreHealth {
  const catalogue = all.filter((p) => p.status === 'SALE' || p.status === 'OUT');
  const hidden = all.filter((p) => p.status === 'HIDDEN').length;

  // Out of stock = flagged OUT, or tracked quantity of zero.
  const isOut = (p: HealthProduct) => p.status === 'OUT' || (p.quantity !== null && p.quantity <= 0);
  const out = catalogue.filter(isOut);
  const low = catalogue
    .filter((p) => !isOut(p) && p.quantity !== null && p.quantity <= LOW_STOCK_THRESHOLD)
    .sort((a, b) => (a.quantity ?? 0) - (b.quantity ?? 0));

  const withCost = catalogue.filter((p) => p.costPrice !== null && p.costPrice > 0 && p.price > 0);
  const rows: MarginRow[] = withCost.map((p) => {
    const sp = sellingPrice(p);
    const cost = p.costPrice as number;
    return {
      id: p.id,
      name: p.name,
      sellingPrice: sp,
      costPrice: cost,
      marginPct: round1(((sp - cost) / sp) * 100),
    };
  });
  const belowCost = rows.filter((r) => r.marginPct <= 0).sort((a, b) => a.marginPct - b.marginPct);
  const thinnest = rows
    .filter((r) => r.marginPct > 0 && r.marginPct < THIN_MARGIN_PCT)
    .sort((a, b) => a.marginPct - b.marginPct);

  const discounted = catalogue
    .filter((p) => sellingPrice(p) < p.price && p.price > 0)
    .map((p) => ({
      id: p.id,
      name: p.name,
      discountPct: round1(((p.price - sellingPrice(p)) / p.price) * 100),
    }))
    .sort((a, b) => b.discountPct - a.discountPct);

  // Stock value needs both a known cost and a tracked quantity.
  const counted = catalogue.filter(
    (p) => p.costPrice !== null && p.costPrice > 0 && p.quantity !== null && p.quantity > 0,
  );
  const costValue = counted.reduce((s, p) => s + (p.costPrice as number) * (p.quantity as number), 0);
  const retailValue = counted.reduce((s, p) => s + sellingPrice(p) * (p.quantity as number), 0);

  return {
    totalProducts: catalogue.length,
    stock: {
      outOfStock: out.length,
      lowStock: low.length,
      lowStockThreshold: LOW_STOCK_THRESHOLD,
      hidden,
      outOfStockItems: out.slice(0, LIST_SIZE).map(({ id, name }) => ({ id, name })),
      lowStockItems: low
        .slice(0, LIST_SIZE)
        .map((p) => ({ id: p.id, name: p.name, quantity: p.quantity as number })),
    },
    margins: {
      withCost: rows.length,
      missingCost: catalogue.length - rows.length,
      avgMarginPct:
        rows.length > 0 ? round1(rows.reduce((s, r) => s + r.marginPct, 0) / rows.length) : null,
      belowCost: belowCost.slice(0, LIST_SIZE),
      thinnest: thinnest.slice(0, LIST_SIZE),
    },
    discounts: {
      onSale: discounted.length,
      avgDiscountPct:
        discounted.length > 0
          ? round1(discounted.reduce((s, d) => s + d.discountPct, 0) / discounted.length)
          : null,
      deepest: discounted.slice(0, 5),
    },
    inventory: {
      costValue: counted.length > 0 ? round2(costValue) : null,
      retailValue: counted.length > 0 ? round2(retailValue) : null,
      productsCounted: counted.length,
    },
  };
}
