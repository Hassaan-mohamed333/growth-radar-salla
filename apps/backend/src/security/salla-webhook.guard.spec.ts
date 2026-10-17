import { createHmac } from 'node:crypto';
import { BadRequestException, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import {
  SallaWebhookGuard,
  SallaWebhookRequest,
  webhookIdempotencyKey,
} from './salla-webhook.guard';
import type { WebhookIdempotencyService } from './webhook-idempotency.service';

const SECRET = 'test-webhook-secret-123456';

function makeGuard(strategy: 'signature' | 'token', begin = jest.fn().mockResolvedValue(true)) {
  const values: Record<string, unknown> = {
    SALLA_WEBHOOK_SECRET: SECRET,
    SALLA_WEBHOOK_STRATEGY: strategy,
  };
  const config = { get: (k: string) => values[k] } as never;
  const idempotency = { begin } as unknown as WebhookIdempotencyService;
  return { guard: new SallaWebhookGuard(config, idempotency), begin };
}

function makeContext(headers: Record<string, string>, rawBody?: Buffer) {
  const req = {
    ip: '127.0.0.1',
    rawBody,
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as SallaWebhookRequest;
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { req, ctx };
}

const body = Buffer.from(JSON.stringify({ event: 'order.created', merchant: 1 }));
const sign = (b: Buffer) => createHmac('sha256', SECRET).update(b).digest('hex');

describe('SallaWebhookGuard', () => {
  it('accepts a valid signature and claims idempotency', async () => {
    const { guard, begin } = makeGuard('signature');
    const { ctx, req } = makeContext({ 'x-salla-signature': sign(body) }, body);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(req.sallaWebhook?.duplicate).toBe(false);
  });

  it('flags a duplicate delivery', async () => {
    const { guard } = makeGuard('signature', jest.fn().mockResolvedValue(false));
    const { ctx, req } = makeContext({ 'x-salla-signature': sign(body) }, body);
    await guard.canActivate(ctx);
    expect(req.sallaWebhook?.duplicate).toBe(true);
  });

  it('rejects a bad signature without touching Redis', async () => {
    const { guard, begin } = makeGuard('signature');
    const { ctx } = makeContext({ 'x-salla-signature': 'a'.repeat(64) }, body);
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    expect(begin).not.toHaveBeenCalled();
  });

  it('rejects a signature over a different body', async () => {
    const { guard } = makeGuard('signature');
    const { ctx } = makeContext({ 'x-salla-signature': sign(Buffer.from('other')) }, body);
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects missing/malformed signature header and missing body', async () => {
    const { guard } = makeGuard('signature');
    await expect(guard.canActivate(makeContext({}, body).ctx)).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(
      guard.canActivate(makeContext({ 'x-salla-signature': 'zz' }, body).ctx),
    ).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(makeContext({}, undefined).ctx)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('ignores a downgrade attempt via x-salla-security-strategy', async () => {
    const { guard } = makeGuard('signature');
    const { ctx } = makeContext(
      {
        'x-salla-security-strategy': 'token',
        authorization: `Bearer ${SECRET}`,
      },
      body,
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('flags a resend whose body is re-serialised with the same content', async () => {
    const seen = new Set<string>();
    const begin = jest.fn(async (key: string) => {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const { guard } = makeGuard('signature', begin);
    const first = productEvent();
    const resend = Buffer.from(JSON.stringify(JSON.parse(first.toString('utf8')), null, 2));

    const a = makeContext({ 'x-salla-signature': sign(first) }, first);
    const b = makeContext({ 'x-salla-signature': sign(resend) }, resend);
    await guard.canActivate(a.ctx);
    await guard.canActivate(b.ctx);

    expect(a.req.sallaWebhook?.duplicate).toBe(false);
    expect(b.req.sallaWebhook?.duplicate).toBe(true);
  });
});

const productEvent = (overrides: Record<string, unknown> = {}) =>
  Buffer.from(
    JSON.stringify({
      event: 'product.updated',
      merchant: 144810978,
      created_at: 'Sat Oct 17 2026 05:45:13 GMT+0300',
      data: {
        id: 1620674676,
        updated_at: '2026-10-17 05:45:13',
        name: 'ماتشا',
        price: { amount: 2000, currency: 'SAR' },
      },
      ...overrides,
    }),
  );

describe('webhookIdempotencyKey', () => {
  it('is the same for the same event with keys in another order and other whitespace', () => {
    const reordered = Buffer.from(
      '{"data":{"price":{"currency":"SAR","amount":2000},"name":"ماتشا","updated_at":"2026-10-17 05:45:13","id":1620674676},"created_at":"Sat Oct 17 2026 05:45:13 GMT+0300","merchant":144810978,"event":"product.updated"}',
    );
    expect(webhookIdempotencyKey(reordered)).toBe(webhookIdempotencyKey(productEvent()));
  });

  it('differs when created_at differs', () => {
    const later = productEvent({
      created_at: 'Sat Oct 17 2026 05:46:00 GMT+0300',
    });
    expect(webhookIdempotencyKey(later)).not.toBe(webhookIdempotencyKey(productEvent()));
  });

  it('differs for two changes to one product in the same second', () => {
    const change = (amount: number) =>
      productEvent({
        data: {
          id: 1620674676,
          updated_at: '2026-10-17 05:45:13',
          price: { amount, currency: 'SAR' },
        },
      });
    expect(webhookIdempotencyKey(change(2000))).not.toBe(webhookIdempotencyKey(change(1800)));
  });

  it('keeps a product reverted to an earlier price distinct when its timestamp moves on', () => {
    const at = (second: string, amount: number) =>
      productEvent({
        created_at: `Sat Oct 17 2026 05:45:${second} GMT+0300`,
        data: { id: 1620674676, price: { amount, currency: 'SAR' } },
      });
    expect(webhookIdempotencyKey(at('13', 2000))).not.toBe(webhookIdempotencyKey(at('20', 2000)));
  });

  it('falls back to the raw body when the payload does not have the event shape', () => {
    const odd = Buffer.from('{"hello":"world"}');
    expect(webhookIdempotencyKey(odd)).toMatch(/^salla:webhook:v2:raw:[0-9a-f]{64}$/);
    expect(webhookIdempotencyKey(Buffer.from('not json'))).toMatch(/^salla:webhook:v2:raw:/);
    expect(webhookIdempotencyKey(odd)).toBe(webhookIdempotencyKey(odd));
  });
});

describe('SallaWebhookGuard token strategy', () => {
  it('supports the token strategy', async () => {
    const { guard } = makeGuard('token');
    await expect(
      guard.canActivate(makeContext({ authorization: `Bearer ${SECRET}` }, body).ctx),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(makeContext({ authorization: 'Bearer wrong' }, body).ctx),
    ).rejects.toThrow(UnauthorizedException);
  });
});
