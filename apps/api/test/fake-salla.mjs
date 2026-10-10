// Minimal fake of Salla's OAuth + Admin API for local/e2e use. NOT part of the production build.
import http from 'node:http';
const port = Number(process.env.FAKE_SALLA_PORT ?? 4999);
let n = 0;
const users = { 'code-A': { uid: 1001, mid: 5001, name: 'Store A' }, 'code-B': { uid: 1002, mid: 5002, name: 'Store B' } };
const byToken = new Map();
const iso = (d) => ({ date: d.toISOString().replace('T', ' ').replace('Z', '000'), timezone: 'UTC' });
const orders = Array.from({ length: 120 }, (_, i) => ({
  id: 9000 + i, reference_id: 100 + i, status: { slug: i % 10 === 0 ? 'canceled' : 'completed' },
  date: iso(new Date(Date.now() - (i % 6) * 86_400_000 - 3_600_000)),
  amounts: { total: { amount: 100, currency: 'SAR' } }, customer: { id: 7000 + (i % 40) },
}));
const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    if (u.pathname === '/token') {
      const f = new URLSearchParams(body); const code = f.get('code');
      if (f.get('grant_type') === 'authorization_code' && users[code]) {
        const t = `at-${code}-${++n}-xxxxxxxx`; byToken.set(t, users[code]);
        return send(res, 200, { access_token: t, refresh_token: `rt-${code}-${n}-xxxxxxxx`, expires_in: 1209600, scope: 'offline_access orders.read', token_type: 'bearer' });
      }
      return send(res, 400, { error: 'invalid_grant' });
    }
    const user = byToken.get((req.headers.authorization ?? '').replace('Bearer ', ''));
    if (!user) return send(res, 401, {});
    if (u.pathname === '/admin/v2/oauth2/user/info')
      return send(res, 200, { data: { id: user.uid, name: user.name, email: `${user.uid}@example.com`, merchant: { id: user.mid, name: user.name, domain: `https://s${user.mid}.example` } } });
    const page = Number(u.searchParams.get('page') ?? 1), per = Number(u.searchParams.get('per_page') ?? 50);
    const list = { '/admin/v2/orders': orders, '/admin/v2/products': [{ id: 1, name: 'Widget', sku: 'W1', price: { amount: 100, currency: 'SAR' }, quantity: 5, status: 'sale' }], '/admin/v2/categories': [{ id: 3, name: 'Cat' }] }[u.pathname];
    if (!list) return send(res, 404, {});
    const totalPages = Math.max(1, Math.ceil(list.length / per));
    send(res, 200, { data: list.slice((page - 1) * per, page * per), pagination: { currentPage: page, totalPages, total: list.length } });
  });
}).listen(port, () => console.log('fake salla on', port));
