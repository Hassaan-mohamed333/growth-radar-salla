import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ProductSyncService } from '../../src/products/product-sync.service';
import { ProductWebhookHandler } from '../../src/products/product-webhook.handler';
import { REDIS } from '../../src/redis/redis.module';
import { SallaApiClient, SallaApiError } from '../../src/salla/salla-api.client';
import { SallaConnectionsService } from '../../src/salla/salla-connections.service';
import { SallaWebhookGuard } from '../../src/security/salla-webhook.guard';
import { WebhookIdempotencyService } from '../../src/security/webhook-idempotency.service';
import { OrderWebhookHandler } from '../../src/sync/order-webhook.handler';
import { SalesSyncService } from '../../src/sync/sales-sync.service';
import { AppLifecycleHandler } from '../../src/webhooks/app-lifecycle.handler';
import { WebhookIdempotencyInterceptor } from '../../src/webhooks/webhook-idempotency.interceptor';
import { WebhooksController } from '../../src/webhooks/webhooks.controller';
import { resetDb, seedStore, type SeededStore } from './db';
import { TEST_ENV, envModule, newRedis } from './support';

describe('Salla webhooks over HTTP (signature + idempotency + handlers)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;
  let base: string;
  let productSync: ProductSyncService;
  const salesSync = { syncRange: jest.fn() };
  let s: SeededStore;
  let merchantId: string;

  beforeAll(async () => {
    redis = newRedis();
    const moduleRef = await Test.createTestingModule({
      imports: [envModule(), PrismaModule],
      controllers: [WebhooksController],
      providers: [
        SallaWebhookGuard,
        WebhookIdempotencyInterceptor,
        WebhookIdempotencyService,
        OrderWebhookHandler,
        ProductWebhookHandler,
        AppLifecycleHandler,
        ProductSyncService,
        { provide: REDIS, useValue: redis },
        { provide: SalesSyncService, useValue: salesSync },
        // No Salla access in this suite: payload-complete events never need the API.
        { provide: SallaConnectionsService, useValue: { getValidAccessToken: jest.fn() } },
        { provide: SallaApiClient, useValue: { listProducts: jest.fn() } },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    prisma = moduleRef.get(PrismaService);
    productSync = moduleRef.get(ProductSyncService);
  });
  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await resetDb(prisma);
    await redis.flushall();
    salesSync.syncRange.mockReset().mockResolvedValue({ days: 1, orders: 0 });
    s = await seedStore(prisma);
    merchantId = (await prisma.store.findUniqueOrThrow({ where: { id: s.storeId } })).sallaMerchantId;
  });

  const sign = (raw: string, secret: string = TEST_ENV.SALLA_WEBHOOK_SECRET) =>
    createHmac('sha256', secret).update(raw).digest('hex');

  async function post(raw: string, headers: Record<string, string> = {}) {
    const res = await fetch(`${base}/webhooks/salla`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: raw,
    });
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  }
  const signed = (event: string, data: unknown, extra: Record<string, unknown> = {}) => {
    const raw = JSON.stringify({ event, merchant: merchantId, data, ...extra });
    return { raw, headers: { 'x-salla-signature': sign(raw) } };
  };
  const productPayload = (id: number, name = 'Tea') => ({
    id,
    name,
    price: { amount: 30, currency: 'SAR' },
    status: 'sale',
    quantity: 4,
  });
  const webhookKeys = () => redis.keys('salla:webhook:*');

  it('accepts a correctly signed delivery and applies the product event', async () => {
    const { raw, headers } = signed('product.created', productPayload(9001));

    const res = await post(raw, headers);

    expect(res).toMatchObject({ status: 200, json: { status: 'ok' } });
    const p = await prisma.product.findFirstOrThrow({
      where: { storeId: s.storeId, sallaProductId: '9001' },
    });
    expect(p).toMatchObject({ name: 'Tea', status: 'SALE', tenantId: s.tenantId });
    expect(await webhookKeys()).toHaveLength(1);
  });

  it('ignores an exact duplicate delivery without re-running the handler', async () => {
    const upsert = jest.spyOn(productSync, 'upsertOne');
    const { raw, headers } = signed('product.created', productPayload(9002));

    const first = await post(raw, headers);
    const second = await post(raw, headers);

    expect(first.json).toEqual({ status: 'ok' });
    expect(second).toMatchObject({ status: 200, json: { status: 'duplicate' } });
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('processes concurrent identical deliveries exactly once', async () => {
    const upsert = jest.spyOn(productSync, 'upsertOne');
    const { raw, headers } = signed('product.updated', productPayload(9003));

    const results = await Promise.all(Array.from({ length: 5 }, () => post(raw, headers)));

    expect(results.filter((r) => r.json?.status === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r.json?.status === 'duplicate')).toHaveLength(4);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('rejects bad credentials before touching Redis or the database', async () => {
    const good = signed('product.created', productPayload(9004));
    const wrongSecret = { 'x-salla-signature': sign(good.raw, 'some-other-secret-value') };
    const tampered = JSON.stringify({ ...JSON.parse(good.raw), data: productPayload(9004, 'Evil') });

    const cases = [
      await post(good.raw), // no signature
      await post(good.raw, { 'x-salla-signature': 'not-hex' }),
      await post(good.raw, wrongSecret),
      await post(tampered, good.headers), // valid signature of a different body
      // Attacker-chosen strategy header must not downgrade verification.
      await post(good.raw, { 'x-salla-security-strategy': 'token', authorization: 'Bearer anything' }),
    ];

    for (const c of cases) expect(c.status).toBe(401);
    expect(await webhookKeys()).toHaveLength(0);
    expect(await prisma.product.count()).toBe(0);
  });

  it('rejects an empty body', async () => {
    const res = await post('', { 'x-salla-signature': sign('') });
    expect(res.status).toBe(400);
  });

  it('releases the key when the handler fails so Salla\'s retry is processed', async () => {
    jest.spyOn(productSync, 'upsertOne').mockRejectedValueOnce(new SallaApiError(503, 'down'));
    const { raw, headers } = signed('product.created', productPayload(9005));

    const failed = await post(raw, headers);
    expect(failed.status).toBe(500);
    expect(await webhookKeys()).toHaveLength(0);
    expect(await prisma.product.count()).toBe(0);

    const retry = await post(raw, headers);
    expect(retry).toMatchObject({ status: 200, json: { status: 'ok' } });
    expect(await prisma.product.count()).toBe(1);
  });

  it('soft-deletes on product.deleted and never touches other stores', async () => {
    const other = await seedStore(prisma);
    await prisma.product.create({
      data: {
        tenantId: other.tenantId,
        storeId: other.storeId,
        sallaProductId: '9006',
        name: 'Other store item',
        price: 10,
      },
    });
    const created = signed('product.created', productPayload(9006));
    await post(created.raw, created.headers);

    const del = signed('product.deleted', { id: 9006 });
    expect((await post(del.raw, del.headers)).status).toBe(200);

    const mine = await prisma.product.findFirstOrThrow({
      where: { storeId: s.storeId, sallaProductId: '9006' },
    });
    const theirs = await prisma.product.findFirstOrThrow({
      where: { storeId: other.storeId, sallaProductId: '9006' },
    });
    expect(mine.status).toBe('DELETED');
    expect(theirs.status).toBe('SALE');
  });

  it('routes order.* events to a sales re-sync of the right store', async () => {
    const { raw, headers } = signed('order.created', { date: { date: '2026-10-09 10:00:00.000000' } });

    const res = await post(raw, headers);

    expect(res.status).toBe(200);
    expect(salesSync.syncRange).toHaveBeenCalledTimes(1);
    expect(salesSync.syncRange.mock.calls[0]![0]).toBe(s.storeId);
  });

  it('switches the store off on app.uninstalled and leaves other stores alone', async () => {
    const other = await seedStore(prisma);
    for (const x of [s, other]) {
      await prisma.sallaConnection.create({
        data: { tenantId: x.tenantId, storeId: x.storeId, accessTokenEnc: 'v1.a.b.c', status: 'ACTIVE' },
      });
      await prisma.decisionRecommendation.create({
        data: {
          tenantId: x.tenantId,
          storeId: x.storeId,
          type: 'COMPETITOR_ALERT',
          title: 't',
          rationale: 'r',
          payload: {},
        },
      });
    }

    const ev = signed('app.uninstalled', {});
    expect((await post(ev.raw, ev.headers)).status).toBe(200);
    // Salla retries / duplicates must be harmless.
    expect((await post(ev.raw, ev.headers)).json).toEqual({ status: 'duplicate' });

    const store = await prisma.store.findUniqueOrThrow({ where: { id: s.storeId } });
    expect(store.status).toBe('UNINSTALLED');
    expect(store.uninstalledAt).not.toBeNull();
    const conn = await prisma.sallaConnection.findUniqueOrThrow({ where: { storeId: s.storeId } });
    expect(conn).toMatchObject({ status: 'REVOKED', lastError: 'app_uninstalled' });
    expect(
      await prisma.decisionRecommendation.count({ where: { storeId: s.storeId, status: 'PENDING' } }),
    ).toBe(0);

    const kept = await prisma.store.findUniqueOrThrow({ where: { id: other.storeId } });
    expect(kept.status).toBe('ACTIVE');
    expect(
      (await prisma.sallaConnection.findUniqueOrThrow({ where: { storeId: other.storeId } })).status,
    ).toBe('ACTIVE');
    expect(
      await prisma.decisionRecommendation.count({ where: { storeId: other.storeId, status: 'PENDING' } }),
    ).toBe(1);
  });

  it('re-syncs sales for status changes but not for shipment events', async () => {
    const status = signed('order.status.updated', { date: { date: '2026-10-09 10:00:00.000000' } });
    expect((await post(status.raw, status.headers)).status).toBe(200);
    expect(salesSync.syncRange).toHaveBeenCalledTimes(1);

    for (const event of ['order.shipment.creating', 'order.shipment.cancelled']) {
      const ev = signed(event, { id: 1 });
      expect((await post(ev.raw, ev.headers)).json).toEqual({ status: 'ok' });
    }
    expect(salesSync.syncRange).toHaveBeenCalledTimes(1); // unchanged
  });

  it('handles the product events Salla documents (available / unavailable)', async () => {
    const off = signed('product.unavailable', { ...productPayload(9100), status: 'out', quantity: 0 });
    await post(off.raw, off.headers);
    let p = await prisma.product.findFirstOrThrow({ where: { storeId: s.storeId, sallaProductId: '9100' } });
    expect(p.status).toBe('OUT');

    const on = signed('product.available', { ...productPayload(9100), status: 'sale', quantity: 5 });
    await post(on.raw, on.headers);
    p = await prisma.product.findFirstOrThrow({ where: { id: p.id } });
    expect(p).toMatchObject({ status: 'SALE', quantity: 5 });
  });

  it.each([
    ['an object without an event', JSON.stringify({ merchant: 1, data: {} })],
    ['a non-string event', JSON.stringify({ event: 42, merchant: 1 })],
    ['an array', '[]'],
  ])('acknowledges and ignores a correctly signed body that is %s', async (_name, raw) => {
    // Answering 500 here would make Salla retry a body that can never be processed.
    const res = await post(raw, { 'x-salla-signature': sign(raw) });

    expect(res.status).toBe(200);
    expect(res.json).toEqual({ status: 'ignored' });
    expect(await prisma.product.count()).toBe(0);
  });

  it('answers 200 for unrelated events and for merchants we do not know', async () => {
    const unrelated = signed('customer.created', { id: 1 });
    expect((await post(unrelated.raw, unrelated.headers)).status).toBe(200);

    const raw = JSON.stringify({ event: 'product.created', merchant: 'nobody', data: productPayload(1) });
    expect((await post(raw, { 'x-salla-signature': sign(raw) })).status).toBe(200);
    expect(await prisma.product.count()).toBe(0);
  });
});
