import type { ErrorEvent } from '@sentry/node';
import { initSentry, scrubEvent } from './sentry';

describe('scrubEvent', () => {
  it('removes cookies, headers, bodies, query strings and user data but keeps the route', () => {
    const event = {
      type: undefined,
      request: {
        url: 'https://api.example.com/api/v1/products',
        method: 'GET',
        cookies: { gr_session: 'jwt' },
        headers: { authorization: 'Bearer x', 'x-salla-signature': 'sig' },
        data: { name: 'secret' },
        query_string: 'token=abc',
      },
      user: { id: 'store-1', ip_address: '1.2.3.4' },
    } as unknown as ErrorEvent;

    const out = scrubEvent(event);

    expect(out.request).toEqual({ url: 'https://api.example.com/api/v1/products', method: 'GET' });
    expect(out.user).toBeUndefined();
  });

  it('handles an event without a request', () => {
    expect(scrubEvent({ type: undefined } as unknown as ErrorEvent)).toEqual({ type: undefined });
  });
});

describe('initSentry', () => {
  it('stays off without a DSN', () => {
    expect(initSentry({ dsn: undefined, environment: 'test' })).toBe(false);
  });
});
