/**
 * How each Salla store event is handled. Based on Salla's published event list: many events carry a PARTIAL
 * payload ("product.price.updated", "order.shipment.*" ...), so blindly mapping them onto our tables would
 * null-out fields or fail validation forever. Strategy per class:
 *  - full snapshot  -> validate strictly and upsert
 *  - partial/product -> re-fetch the authoritative object from the Salla API (one retryable job)
 *  - everything else -> keep as evidence, mark IGNORED (never "FAILED")
 */
export type EventAction =
  | { kind: 'order_upsert'; revenue: boolean }
  | { kind: 'product_upsert' }
  | { kind: 'product_delete' }
  | { kind: 'product_refetch' }
  | { kind: 'category_upsert' }
  | { kind: 'category_delete' }
  | { kind: 'uninstall' }
  | { kind: 'ignore' };

const ORDER_FULL = new Set([
  'order.created', 'order.updated', 'order.status.updated', 'order.payment.updated',
  'order.total.price.updated', 'order.products.updated', 'order.coupon.updated',
]);
/** After these the order must never count as revenue, whatever status slug the payload carries. */
const ORDER_NO_REVENUE = new Set(['order.cancelled', 'order.refunded', 'order.deleted']);
const PRODUCT_PARTIAL = new Set([
  'product.price.updated', 'product.status.updated', 'product.quantity.low', 'product.category.updated',
  'product.brand.updated', 'product.tags.updated', 'product.image.updated',
  'product.updated', 'product.available', // deprecated by Salla but may still be delivered
]);

export function classifyEvent(event: string): EventAction {
  if (ORDER_FULL.has(event)) return { kind: 'order_upsert', revenue: true };
  if (ORDER_NO_REVENUE.has(event)) return { kind: 'order_upsert', revenue: false };
  if (event === 'product.created') return { kind: 'product_upsert' };
  if (event === 'product.deleted') return { kind: 'product_delete' };
  if (PRODUCT_PARTIAL.has(event)) return { kind: 'product_refetch' };
  if (event === 'category.created' || event === 'category.updated') return { kind: 'category_upsert' };
  if (event === 'category.deleted') return { kind: 'category_delete' };
  if (event === 'app.uninstalled') return { kind: 'uninstall' };
  return { kind: 'ignore' }; // shipments, customers, brands, coupons, reviews, other order.shipment.* ...
}
