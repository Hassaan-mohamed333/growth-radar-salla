import { RenderApiFetcher } from './render-fetcher';

const TEMPLATE = 'https://render.example.com/v1/?key=SECRETKEY&render_js=true&url={url}';

const okResponse = (body: string, status = 200) => new Response(body, { status });

describe('RenderApiFetcher', () => {
  it('refuses a template that is not https or has no {url}', () => {
    expect(() => new RenderApiFetcher('http://x.example.com/?u={url}')).toThrow();
    expect(() => new RenderApiFetcher('https://x.example.com/?u=')).toThrow();
  });

  it('puts the encoded target into the template and returns the body', async () => {
    const fetchFn = jest.fn().mockResolvedValue(okResponse('<html>ok</html>'));
    const r = new RenderApiFetcher(TEMPLATE, { fetchFn });

    await expect(r.fetchRendered('https://shop.example.com/p/1?a=b&c=d')).resolves.toBe('<html>ok</html>');
    expect(fetchFn.mock.calls[0][0]).toBe(
      'https://render.example.com/v1/?key=SECRETKEY&render_js=true&url=https%3A%2F%2Fshop.example.com%2Fp%2F1%3Fa%3Db%26c%3Dd',
    );
  });

  it('does not send private targets to the provider', async () => {
    const fetchFn = jest.fn();
    const r = new RenderApiFetcher(TEMPLATE, { fetchFn });
    await expect(r.fetchRendered('http://127.0.0.1/admin')).rejects.toMatchObject({ kind: 'forbidden_target' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('maps provider failures and never leaks the key', async () => {
    const down = new RenderApiFetcher(TEMPLATE, {
      fetchFn: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED https://render.example.com/v1/?key=SECRETKEY')),
    });
    const err = await down.fetchRendered('https://shop.example.com/p/1').catch((e: Error) => e);
    expect(err).toMatchObject({ kind: 'network', retryable: true });
    expect(String((err as Error).message)).not.toContain('SECRETKEY');

    const bad = new RenderApiFetcher(TEMPLATE, { fetchFn: jest.fn().mockResolvedValue(okResponse('x', 502)) });
    await expect(bad.fetchRendered('https://shop.example.com/p/1')).rejects.toMatchObject({
      kind: 'http_error',
      retryable: true,
    });
  });

  it('rejects oversized pages', async () => {
    const r = new RenderApiFetcher(TEMPLATE, { maxBytes: 10, fetchFn: jest.fn().mockResolvedValue(okResponse('x'.repeat(50))) });
    await expect(r.fetchRendered('https://shop.example.com/p/1')).rejects.toMatchObject({ kind: 'too_large' });
  });
});
