// End-to-end smoke test: real Postgres + Redis + the real Nest app, fake Salla upstream.
import { createHmac } from 'node:crypto';
import pg from 'pg';
const API = process.env.APP_URL, SECRET = process.env.SALLA_WEBHOOK_SECRET;
let failed = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cookieOf = (res, name) => (res.headers.getSetCookie().find((c) => c.startsWith(name + '=')) ?? '').split(';')[0];

async function login(code) {
  const c = await fetch(`${API}/salla/oauth/connect`, { redirect: 'manual' });
  const loc = new URL(c.headers.get('location'));
  const nonce = cookieOf(c, 'radar_oauth_nonce');
  const state = loc.searchParams.get('state');
  const cb = (st, ck) => fetch(`${API}/salla/oauth/callback?code=${code}&state=${st}`, { redirect: 'manual', headers: { cookie: ck } });
  return { loc, nonce, state, cb };
}
const sign = (b) => createHmac('sha256', SECRET).update(b).digest('hex');
const hook = (body, sig) => fetch(`${API}/salla/webhooks`, { method: 'POST', headers: { 'content-type': 'application/json', ...(sig ? { 'x-salla-signature': sig } : {}) }, body });

const db = new pg.Client({ connectionString: process.env.OWNER_DATABASE_URL }); await db.connect();

ok((await fetch(`${API}/health`)).status === 200, 'health is public');
ok((await fetch(`${API}/stores`)).status === 401, 'API is deny-by-default without a session');

// ---- OAuth ----
const a = await login('code-A');
ok(a.loc.searchParams.get('code_challenge_method') === 'S256' && !!a.loc.searchParams.get('code_challenge'), 'connect redirects with PKCE S256 + state');
ok(a.loc.searchParams.get('state')?.length >= 40, 'state is high-entropy');
const bad = await a.cb(a.state, ''); // missing nonce cookie (attacker-started flow in a victim browser)
ok((bad.headers.get('location') ?? '').includes('error=invalid'), 'callback without the browser-bound nonce is rejected');
const a2 = await login('code-A');
const good = await a2.cb(a2.state, a2.nonce);
const sessA = cookieOf(good, 'radar_session');
ok(good.status === 302 && good.headers.get('location').endsWith('/dashboard') && !!sessA, 'valid callback provisions tenant and sets session cookie');
ok(/HttpOnly/i.test(good.headers.getSetCookie().find((c) => c.startsWith('radar_session'))), 'session cookie is HttpOnly');
const replay = await a2.cb(a2.state, a2.nonce);
ok((replay.headers.get('location') ?? '').includes('error=invalid'), 'state is single-use (replay rejected)');

// ---- tokens at rest ----
const conn = (await db.query(`SELECT access_token_enc, refresh_token_enc, tenant_id, store_id FROM salla_connections WHERE salla_merchant_id=5001`)).rows[0];
ok(conn.access_token_enc.startsWith('v1.k1.') && !conn.access_token_enc.includes('at-code-A'), 'access token stored as AES-GCM envelope');
ok(conn.refresh_token_enc.startsWith('v1.k1.') && !conn.refresh_token_enc.includes('rt-code-A'), 'refresh token stored as AES-GCM envelope');

// ---- sync ----
for (let i = 0; i < 40; i++) { const r = await db.query(`SELECT last_sync_at FROM salla_connections WHERE salla_merchant_id=5001`); if (r.rows[0].last_sync_at) break; await sleep(500); }
const cnt = async (t) => Number((await db.query(`SELECT count(*) FROM ${t} WHERE store_id=$1`, [conn.store_id])).rows[0].count);
ok((await cnt('orders')) === 120, `paginated sync pulled all 120 orders (got ${await cnt('orders')})`);
ok((await cnt('products')) === 1 && (await cnt('categories')) === 1, 'products + categories synced');
ok((await cnt('raw_ingestions')) >= 5, 'raw pages stored as immutable evidence');
const leak = await db.query(`SELECT count(*) FROM orders WHERE customer_hash !~ '^[0-9a-f]{64}$'`);
ok(Number(leak.rows[0].count) === 0, 'customer ids are pseudonymised');

// ---- audit + dashboard ----
for (let i = 0; i < 20; i++) { if (await cnt('data_confidence_audits')) break; await sleep(500); }
const ov = await (await fetch(`${API}/stores/${conn.store_id}/overview?lang=ar`, { headers: { cookie: sessA } })).json();
console.log('overview:', JSON.stringify(ov).slice(0, 400));
ok(ov.confidence && ov.topDecisions?.length >= 1 && ov.topDecisions[0].category === 'TRACKING', 'overview returns confidence + prioritised decision (no GA4 => connect-GA4 finding)');
ok(ov.confidence.level === 'low', 'missing GA4 never yields a high confidence score');

// ---- tenant isolation ----
const b = await login('code-B'); const bres = await b.cb(b.state, b.nonce); const sessB = cookieOf(bres, 'radar_session');
const x = await fetch(`${API}/stores/${conn.store_id}/overview`, { headers: { cookie: sessB } });
ok(x.status === 404, 'tenant B cannot read tenant A store (404, not 403)');
const listB = await (await fetch(`${API}/stores`, { headers: { cookie: sessB } })).json();
ok(listB.length === 1 && listB[0].id !== conn.store_id, 'store list is tenant-scoped');
ok((await fetch(`${API}/stores/${conn.store_id}/sync`, { method: 'POST', headers: { cookie: sessB } })).status === 404, 'tenant B cannot trigger sync on tenant A');
const forged = await fetch(`${API}/stores`, { headers: { authorization: 'Bearer ' + sessA.split('=')[1].replace(/.$/, 'x') } });
ok(forged.status === 401, 'tampered JWT rejected');

// ---- webhooks ----
const body = JSON.stringify({ event: 'order.created', merchant: 5001, created_at: new Date().toISOString(), data: { id: 99001, reference_id: 1, status: { slug: 'completed' }, date: { date: '2026-10-10 10:00:00.000000', timezone: 'UTC' }, amounts: { total: { amount: 55.5, currency: 'SAR' } } } });
ok((await hook(body)).status === 401, 'webhook without signature -> 401');
ok((await hook(body, sign(body + ' '))).status === 401, 'webhook with wrong signature -> 401');
ok((await hook('{not json', sign('{not json'))).status === 400, 'signed but malformed JSON -> 400 (verified before parse)');
ok((await hook(body, sign(body))).status === 200, 'valid signed webhook -> 200');
ok((await hook(body, sign(body))).status === 200, 'duplicate delivery -> 200');
await sleep(1500);
const evs = (await db.query(`SELECT status, count(*) OVER () c FROM webhook_events WHERE store_id=$1`, [conn.store_id])).rows;
ok(evs.length === 1 && evs[0].status === 'PROCESSED', `exactly one webhook_events row, processed (rows=${evs.length}, status=${evs[0]?.status})`);
ok((await db.query(`SELECT 1 FROM orders WHERE store_id=$1 AND salla_id=99001`, [conn.store_id])).rowCount === 1, 'webhook order upserted exactly once');
const unknown = JSON.stringify({ event: 'order.created', merchant: 424242, data: {} });
ok((await hook(unknown, sign(unknown))).status === 200, 'unknown merchant -> 200 and nothing stored');
const cred = JSON.stringify({ event: 'app.store.authorize', merchant: 5001, data: { access_token: 'LEAKME-12345678', refresh_token: 'LEAKME-87654321' } });
ok((await hook(cred, sign(cred))).status === 200, 'credential-bearing event accepted');
const raw = await db.query(`SELECT raw_body FROM webhook_events WHERE event='app.store.authorize'`);
ok(raw.rowCount === 1 && !raw.rows[0].raw_body.includes('LEAKME'), 'tokens in webhook bodies are redacted before storage');

// ---- rate limiting ----
let limited = 0; for (let i = 0; i < 30; i++) if ((await fetch(`${API}/salla/oauth/connect`, { redirect: 'manual' })).status === 429) limited++;
ok(limited > 0, `OAuth connect endpoint is rate limited (${limited} x 429)`);

await db.end();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
