import type { PrismaService } from '../prisma/prisma.service';
import { SallaApiError } from '../salla/salla-api.client';
import { SallaConnectionUnavailableError } from '../salla/salla-connections.service';
import { ProductWebhookHandler } from './product-webhook.handler';
import type { ProductSyncService } from './product-sync.service';

function setup(store: { id: string } | null = { id: 's1' }) {
  const sync = {
    upsertOne: jest.fn().mockResolvedValue(true),
    syncStore: jest.fn().mockResolvedValue({ fetched: 0, skipped: 0, removed: 0 }),
    markDeleted: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    store: { findUnique: jest.fn().mockResolvedValue(store) },
  } as unknown as PrismaService;
  const handler = new ProductWebhookHandler(prisma, sync as unknown as ProductSyncService);
  return { handler, sync, prisma };
}

const payload = { id: 55, name: 'Tea', price: { amount: 30 }, status: 'sale' };

describe('ProductWebhookHandler', () => {
  it('only claims product.* events', () => {
    expect(ProductWebhookHandler.handles('product.updated')).toBe(true);
    expect(ProductWebhookHandler.handles('order.created')).toBe(false);
  });

  it('upserts straight from a complete payload without an API round-trip', async () => {
    const { handler, sync } = setup();
    await handler.handle('product.updated', 123, payload);
    expect(sync.upsertOne).toHaveBeenCalledWith('s1', expect.objectContaining({ id: '55', price: 30 }));
    expect(sync.syncStore).not.toHaveBeenCalled();
  });

  it('falls back to a full sync when the payload is partial', async () => {
    const { handler, sync } = setup();
    await handler.handle('product.price.updated', '123', { id: 55 });
    expect(sync.upsertOne).not.toHaveBeenCalled();
    expect(sync.syncStore).toHaveBeenCalledWith('s1');
  });

  it('soft-deletes on product.deleted', async () => {
    const { handler, sync } = setup();
    await handler.handle('product.deleted', 123, { id: 55 });
    expect(sync.markDeleted).toHaveBeenCalledWith('s1', '55');
  });

  it('ignores unknown merchants and events without a merchant', async () => {
    const unknown = setup(null);
    await unknown.handler.handle('product.updated', 999, payload);
    expect(unknown.sync.upsertOne).not.toHaveBeenCalled();

    const none = setup();
    await none.handler.handle('product.updated', undefined, payload);
    expect(none.prisma.store.findUnique).not.toHaveBeenCalled();
  });

  it('swallows unrecoverable errors so Salla does not retry forever', async () => {
    const a = setup();
    a.sync.syncStore.mockRejectedValue(new SallaConnectionUnavailableError('revoked'));
    await expect(a.handler.handle('product.updated', 1, { id: 1 })).resolves.toBeUndefined();

    const b = setup();
    b.sync.upsertOne.mockRejectedValue(new SallaApiError(403, 'missing scope'));
    await expect(b.handler.handle('product.updated', 1, payload)).resolves.toBeUndefined();
  });

  it('rethrows transient errors so the idempotency key is released', async () => {
    const { handler, sync } = setup();
    sync.upsertOne.mockRejectedValue(new SallaApiError(503, 'down'));
    await expect(handler.handle('product.updated', 1, payload)).rejects.toThrow('down');
  });
});
