import { createHmac } from 'node:crypto';
import { BadRequestException, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { SallaWebhookGuard, SallaWebhookRequest } from './salla-webhook.guard';
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
  const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
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
    await expect(guard.canActivate(makeContext({}, body).ctx)).rejects.toThrow(UnauthorizedException);
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
      { 'x-salla-security-strategy': 'token', authorization: `Bearer ${SECRET}` },
      body,
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

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
