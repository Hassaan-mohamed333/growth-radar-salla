import { describe, expect, it } from 'vitest';
import { classifyEvent } from './webhook-events';

describe('classifyEvent', () => {
  it('upserts full order snapshots as revenue-eligible', () => {
    expect(classifyEvent('order.created')).toEqual({ kind: 'order_upsert', revenue: true });
    expect(classifyEvent('order.status.updated')).toEqual({ kind: 'order_upsert', revenue: true });
  });
  it('never counts cancelled / refunded / deleted orders as revenue', () => {
    for (const e of ['order.cancelled', 'order.refunded', 'order.deleted'])
      expect(classifyEvent(e)).toEqual({ kind: 'order_upsert', revenue: false });
  });
  it('does not try to parse partial order events (shipments) as orders', () => {
    expect(classifyEvent('order.shipment.created').kind).toBe('ignore');
    expect(classifyEvent('order.shipping.address.updated').kind).toBe('ignore');
  });
  it('re-fetches products on partial events instead of overwriting fields', () => {
    expect(classifyEvent('product.price.updated').kind).toBe('product_refetch');
    expect(classifyEvent('product.updated').kind).toBe('product_refetch');
    expect(classifyEvent('product.created').kind).toBe('product_upsert');
  });
  it('ignores unknown events safely', () => {
    expect(classifyEvent('customer.login').kind).toBe('ignore');
    expect(classifyEvent('totally.new.event').kind).toBe('ignore');
  });
});
