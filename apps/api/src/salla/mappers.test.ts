import { describe, expect, it } from 'vitest';
import { mapOrder, parseSallaDate } from './mappers';

describe('mapOrder', () => {
  const base = {
    id: 123, reference_id: 5001, status: { slug: 'completed' },
    date: { date: '2026-10-01 13:45:00.000000', timezone: 'Asia/Riyadh' },
    amounts: { total: { amount: 199.5, currency: 'SAR' } }, customer: { id: 9 }, evil: '<script>',
  };
  it('maps and drops unknown fields', () => {
    const o = mapOrder(base)!;
    expect(o.sallaId).toBe(123n);
    expect(o.totalAmount).toBe(199.5);
    expect(o.countsAsRevenue).toBe(true);
    expect(o.placedAt.toISOString()).toBe('2026-10-01T10:45:00.000Z');
    expect('evil' in o).toBe(false);
  });
  it('does not count cancelled orders as revenue', () => {
    expect(mapOrder({ ...base, status: { slug: 'canceled' } })!.countsAsRevenue).toBe(false);
  });
  it('rejects malformed input instead of guessing', () => {
    expect(mapOrder({ ...base, amounts: undefined })).toBeNull();
    expect(mapOrder({ ...base, id: 'abc' })).toBeNull();
    expect(mapOrder({ ...base, amounts: { total: { amount: -5, currency: 'SAR' } } })).toBeNull();
  });
});
describe('parseSallaDate', () => {
  it('handles iso, unix and garbage', () => {
    expect(parseSallaDate('2026-10-01T00:00:00Z')?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(parseSallaDate(1_790_000_000)).toBeInstanceOf(Date);
    expect(parseSallaDate('nope')).toBeNull();
  });
});
