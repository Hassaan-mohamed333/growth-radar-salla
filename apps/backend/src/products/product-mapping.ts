import type { ProductStatus } from '@growth-radar/database';
import type { SallaProduct } from '../salla/salla-api.client';

export interface ProductValues {
  sku: string | null;
  name: string;
  price: number;
  salePrice: number | null;
  costPrice: number | null;
  currency: string;
  quantity: number | null;
  status: ProductStatus;
  url: string | null;
  imageUrl: string | null;
}

/**
 * Salla slug -> our status. Anything unrecognised is treated as HIDDEN so an
 * unknown state never makes a product look purchasable.
 */
export function mapProductStatus(slug: string | null): ProductStatus {
  switch (slug) {
    case 'sale':
      return 'SALE';
    case 'out':
      return 'OUT';
    case 'hidden':
      return 'HIDDEN';
    case 'deleted':
      return 'DELETED';
    default:
      return 'HIDDEN';
  }
}

export function toProductValues(p: SallaProduct, storeCurrency: string): ProductValues {
  const status = mapProductStatus(p.statusSlug);
  return {
    sku: p.sku,
    name: p.name.slice(0, 500),
    price: p.price,
    salePrice: p.salePrice,
    costPrice: p.costPrice,
    currency: p.currency ?? storeCurrency,
    quantity: p.quantity,
    // A tracked quantity of 0 means out of stock even if the slug still says "sale".
    status: status === 'SALE' && p.quantity === 0 ? 'OUT' : status,
    url: p.url,
    imageUrl: p.imageUrl,
  };
}
