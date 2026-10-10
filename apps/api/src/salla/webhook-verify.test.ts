import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifySallaWebhook } from './webhook-verify';

const secret = 'super-secret-webhook-key';
const body = Buffer.from('{"event":"order.created","merchant":1,"data":{}}');
const sig = createHmac('sha256', secret).update(body).digest('hex');
const base = { strategy: 'signature' as const, secret, rawBody: body };

describe('verifySallaWebhook', () => {
  it('accepts a valid signature', () => expect(verifySallaWebhook({ ...base, signatureHeader: sig })).toBe(true));
  it('accepts sha256= prefix and uppercase hex', () => {
    expect(verifySallaWebhook({ ...base, signatureHeader: 'sha256=' + sig.toUpperCase() })).toBe(true);
  });
  it('rejects a modified body (signature is over the exact bytes)', () => {
    expect(verifySallaWebhook({ ...base, rawBody: Buffer.from(body.toString() + ' '), signatureHeader: sig })).toBe(false);
  });
  it('rejects missing, short, non-hex and wrong-secret signatures', () => {
    expect(verifySallaWebhook({ ...base })).toBe(false);
    expect(verifySallaWebhook({ ...base, signatureHeader: sig.slice(2) })).toBe(false);
    expect(verifySallaWebhook({ ...base, signatureHeader: 'z'.repeat(64) })).toBe(false);
    expect(verifySallaWebhook({ ...base, secret: 'other-secret-xxxxxxxx', signatureHeader: sig })).toBe(false);
  });
  it('token strategy ignores the signature header and compares the secret', () => {
    const t = { strategy: 'token' as const, secret, rawBody: body };
    expect(verifySallaWebhook({ ...t, authorizationHeader: secret })).toBe(true);
    expect(verifySallaWebhook({ ...t, authorizationHeader: 'Bearer ' + secret })).toBe(true);
    expect(verifySallaWebhook({ ...t, authorizationHeader: 'nope' })).toBe(false);
    expect(verifySallaWebhook({ ...t, signatureHeader: sig })).toBe(false);
  });
});
