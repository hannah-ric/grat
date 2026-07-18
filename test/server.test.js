/* Blueprint Buddy — server-side tests: sessions, auth flows, document store.
 * Plain Node, zero deps, no network — upstream calls are mocked by swapping
 * globalThis.fetch, and handlers are driven with minimal fake req/res pairs.
 * Run: node test/server.test.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗ ' + msg); }
}
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function section(name) { console.log('· ' + name); }

/* Fake req/res: enough surface for the handlers (they read url, method,
 * headers, socket, and optionally a pre-parsed body — the Vercel shape). */
function fakeReq(url, opts) {
  opts = opts || {};
  return {
    url, method: opts.method || 'GET',
    headers: Object.assign({ host: 'app.example.com', 'x-forwarded-proto': 'https' }, opts.headers || {}),
    socket: {}, body: opts.body
  };
}
function fakeRes() {
  const res = {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(s) { this.body = s || ''; this.done = true; }
  };
  return res;
}
const json = res => { try { return JSON.parse(res.body); } catch (e) { return null; } };

const crypto = require('crypto');
const S = require('../api/_session.js');
const auth = require('../api/auth.js');
const store = require('../api/store.js');
const E = require('../api/_entitlements.js');
const Stripe = require('../api/_stripe.js');
const billing = require('../api/billing.js');
const webhook = require('../api/stripe-webhook.js');
const chat = require('../api/chat.js');

const cleanEnv = () => {
  for (const k of ['AUTH_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET',
    'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'BB_KV_FILE', 'BB_DEV_LOGIN', 'APP_ORIGIN',
    'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRO_MONTHLY_PRICE_ID', 'STRIPE_PRO_YEARLY_PRICE_ID', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL']) {
    delete process.env[k];
  }
};

/* A fresh file-backed KV per call site, so entitlement/usage state never leaks
 * between sections. */
function useTempKV() {
  const file = path.join(os.tmpdir(), 'bb-test-kv-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.json');
  process.env.BB_KV_FILE = file;
  return () => { try { fs.unlinkSync(file); } catch (e) { /* already gone */ } };
}

/* Sign a webhook body exactly as Stripe does, so the hand-rolled verifier
 * (api/_stripe.js) accepts it — the same scheme the real platform uses. */
function signWebhook(payload, secret) {
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', secret).update(ts + '.' + payload).digest('hex');
  return `t=${ts},v1=${sig}`;
}

/* A request whose body was already parsed into an object with NOTHING left on
 * the wire — the shape a body-parsing runtime would hand a webhook, used to
 * prove the raw-body-unavailable diagnostic (A3). */
function objectBodyReq(url, bodyObj, headers) {
  return {
    url, method: 'POST',
    headers: Object.assign({ host: 'app.example.com', 'x-forwarded-proto': 'https' }, headers || {}),
    socket: {}, body: bodyObj,
    on(event, cb) { if (event === 'end') setImmediate(cb); }
  };
}

(async () => {
  /* ---------------- session signing ---------------- */
  section('session cookies: sign / verify / tamper / expiry');
  {
    const secret = 'test-secret-0123456789abcdef0123456789abcdef';
    const now = Math.floor(Date.now() / 1000);
    const tok = S.sign({ uid: 'github:1', name: 'A', exp: now + 60 }, secret);
    const back = S.verify(tok, secret);
    eq(back && back.uid, 'github:1', 'round-trips the payload');
    ok(S.verify(tok, 'wrong-secret') === null, 'wrong secret rejects');
    ok(S.verify(tok.slice(0, -2) + 'xx', secret) === null, 'tampered mac rejects');
    const [body] = tok.split('.');
    const forged = Buffer.from(JSON.stringify({ uid: 'github:2', exp: now + 60 })).toString('base64url') + '.' + tok.split('.')[1];
    ok(S.verify(forged, secret) === null, 'forged body with reused mac rejects');
    ok(S.verify(S.sign({ uid: 'x', exp: now - 5 }, secret), secret) === null, 'expired session rejects');
    ok(S.verify(null, secret) === null && S.verify('garbage', secret) === null, 'garbage rejects quietly');
    ok(body.indexOf('=') < 0 && tok.indexOf('+') < 0 && tok.indexOf('/') < 0, 'token is cookie-safe base64url');
  }

  /* ---------------- auth: status probe + gating ---------------- */
  section('auth: /api/auth?me=1 probe and provider gating');
  {
    cleanEnv();
    let res = fakeRes();
    await auth(fakeReq('/api/auth?me=1'), res);
    let data = json(res);
    eq(data.user, null, 'no secret → anonymous');
    eq(data.providers, [], 'no secret → zero providers even if IDs were set');
    eq(data.storage, false, 'no KV → storage false');

    process.env.AUTH_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
    process.env.GITHUB_CLIENT_ID = 'id';
    process.env.GITHUB_CLIENT_SECRET = 'sec';
    process.env.BB_KV_FILE = path.join(os.tmpdir(), 'bb-test-kv-' + Date.now() + '.json');
    res = fakeRes();
    await auth(fakeReq('/api/auth?me=1'), res);
    data = json(res);
    eq(data.providers, ['github'], 'github appears once configured');
    eq(data.storage, true, 'file KV counts as configured storage');

    // Signed-in probe reflects the cookie.
    const cookieStr = S.sessionCookieFor({ uid: 'github:7', name: 'Hana', provider: 'github' }, fakeReq('/'));
    const tok = decodeURIComponent(cookieStr.split(';')[0].split('=').slice(1).join('='));
    res = fakeRes();
    await auth(fakeReq('/api/auth?me=1', { headers: { cookie: `bb_sess=${encodeURIComponent(tok)}` } }), res);
    data = json(res);
    eq(data.user && data.user.name, 'Hana', 'me returns the signed-in user');
    ok(!JSON.stringify(data.user).includes('github:7'), 'raw uid never leaves the server');
  }

  section('auth: OAuth redirect carries CSRF state; callback enforces it');
  {
    let res = fakeRes();
    await auth(fakeReq('/api/auth?provider=github'), res);
    eq(res.statusCode, 302, 'provider start redirects');
    const loc = new URL(res.headers.location);
    eq(loc.origin + loc.pathname, 'https://github.com/login/oauth/authorize', 'to the GitHub authorize URL');
    eq(loc.searchParams.get('redirect_uri'), 'https://app.example.com/api/auth', 'redirect_uri derived from the request host');
    const state = loc.searchParams.get('state');
    ok(state && state.length >= 32, 'random state present');
    const setCookies = [].concat(res.headers['set-cookie']);
    const stateCookie = setCookies.find(c => c.startsWith('bb_oauth='));
    ok(stateCookie && /HttpOnly/.test(stateCookie) && /Secure/.test(stateCookie), 'state cookie is HttpOnly + Secure on https');

    // Callback with the WRONG state must not create a session.
    const stateTok = decodeURIComponent(stateCookie.split(';')[0].split('=').slice(1).join('='));
    res = fakeRes();
    await auth(fakeReq('/api/auth?code=abc&state=WRONG', { headers: { cookie: `bb_oauth=${encodeURIComponent(stateTok)}` } }), res);
    eq(res.statusCode, 302, 'bad state still redirects (never 500s)');
    ok(/login=failed/.test(res.headers.location), 'bad state lands on the failure marker');
    ok(!(String(res.headers['set-cookie']).includes('bb_sess='))
      || String(res.headers['set-cookie']).match(/bb_sess=;/), 'no session minted on bad state');

    // Callback with the RIGHT state + mocked upstream mints a session.
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      if (String(url).includes('access_token') || String(url).includes('login/oauth/access_token')) {
        return { json: async () => ({ access_token: 'tok123' }) };
      }
      return { json: async () => ({ id: 42, login: 'hana', name: 'Hana R', avatar_url: 'https://a/i.png' }) };
    };
    res = fakeRes();
    await auth(fakeReq(`/api/auth?code=abc&state=${state}`, { headers: { cookie: `bb_oauth=${encodeURIComponent(stateTok)}` } }), res);
    globalThis.fetch = realFetch;
    eq(res.statusCode, 302, 'good callback redirects home');
    const sess = [].concat(res.headers['set-cookie']).find(c => c.startsWith('bb_sess=') && !/bb_sess=;/.test(c));
    ok(!!sess, 'session cookie minted');
    const payload = S.verify(decodeURIComponent(sess.split(';')[0].split('=').slice(1).join('=')), process.env.AUTH_SECRET);
    eq(payload && payload.uid, 'github:42', 'session carries the provider-scoped uid');
    ok(/HttpOnly/.test(sess) && /SameSite=Lax/.test(sess), 'session cookie is HttpOnly + SameSite=Lax');
  }

  /* ---------------- store: auth gate, doc rules, file backend ---------------- */
  section('store: /api/store auth gate + document round trip');
  {
    const mkCookie = uid => {
      const c = S.sessionCookieFor({ uid, name: 'T', provider: 'dev' }, fakeReq('/'));
      return { cookie: c.split(';')[0] };
    };
    let res = fakeRes();
    await store(fakeReq('/api/store?doc=projects:index'), res);
    eq(res.statusCode, 401, 'anonymous requests are refused');

    res = fakeRes();
    await store(fakeReq('/api/store?doc=../etc/passwd', { headers: mkCookie('dev:1') }), res);
    eq(res.statusCode, 400, 'path-looking doc names are refused');

    res = fakeRes();
    await store(fakeReq('/api/store?doc=projects:index', { headers: mkCookie('dev:1'), method: 'PUT', body: { value: JSON.stringify([{ id: 'p1' }]) } }), res);
    eq(res.statusCode, 200, 'PUT stores a document');
    res = fakeRes();
    await store(fakeReq('/api/store?doc=projects:index', { headers: mkCookie('dev:1') }), res);
    eq(JSON.parse(json(res).value), [{ id: 'p1' }], 'GET returns the stored string');

    // User isolation: a different uid sees nothing.
    res = fakeRes();
    await store(fakeReq('/api/store?doc=projects:index', { headers: mkCookie('dev:2') }), res);
    eq(json(res).value, null, 'documents are namespaced per user');

    // Size cap.
    res = fakeRes();
    await store(fakeReq('/api/store?doc=big', { headers: mkCookie('dev:1'), method: 'PUT', body: { value: 'x'.repeat(401 * 1024) } }), res);
    eq(res.statusCode, 413, 'oversized documents are refused');

    // DELETE.
    res = fakeRes();
    await store(fakeReq('/api/store?doc=projects:index', { headers: mkCookie('dev:1'), method: 'DELETE' }), res);
    eq(res.statusCode, 200, 'DELETE succeeds');
    res = fakeRes();
    await store(fakeReq('/api/store?doc=projects:index', { headers: mkCookie('dev:1') }), res);
    eq(json(res).value, null, 'deleted document is gone');

    // Unconfigured storage: 503, not 500.
    const kvFile = process.env.BB_KV_FILE;
    delete process.env.BB_KV_FILE;
    res = fakeRes();
    await store(fakeReq('/api/store?doc=projects:index', { headers: mkCookie('dev:1') }), res);
    eq(res.statusCode, 503, 'no backend → 503 (client falls back to device storage)');
    process.env.BB_KV_FILE = kvFile;
    try { fs.unlinkSync(kvFile); } catch (e) { /* already gone */ }
  }

  section('store: Upstash REST backend command shape');
  {
    delete process.env.BB_KV_FILE;
    process.env.KV_REST_API_URL = 'https://kv.example.com';
    process.env.KV_REST_API_TOKEN = 'tok';
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      calls.push({ url: String(url), auth: opts.headers.Authorization, cmd: JSON.parse(opts.body) });
      return { json: async () => ({ result: calls.length === 1 ? 'OK' : '{"a":1}' }) };
    };
    const c = S.sessionCookieFor({ uid: 'google:9', name: 'G', provider: 'google' }, fakeReq('/'));
    const headers = { cookie: c.split(';')[0] };
    let res = fakeRes();
    await store(fakeReq('/api/store?doc=prefs:v2', { headers, method: 'PUT', body: { value: '{"a":1}' } }), res);
    eq(res.statusCode, 200, 'REST PUT ok');
    res = fakeRes();
    await store(fakeReq('/api/store?doc=prefs:v2', { headers }), res);
    globalThis.fetch = realFetch;
    eq(calls[0].cmd, ['SET', 'bb:google:9:prefs:v2', '{"a":1}'], 'SET command carries the namespaced key');
    eq(calls[1].cmd, ['GET', 'bb:google:9:prefs:v2'], 'GET command shape');
    ok(calls.every(x => x.auth === 'Bearer tok'), 'bearer token on every command');
    eq(json(res).value, '{"a":1}', 'REST GET returns the value');
    cleanEnv();
  }

  /* ---------------- store: reserved entitlement keys ---------------- */
  section('store: entitlement keys are not user-writable via /api/store (E-01/E-02)');
  {
    const rmkv = useTempKV();
    process.env.AUTH_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
    const cookie = uid => ({ cookie: S.sessionCookieFor({ uid, name: 'T', provider: 'google' }, fakeReq('/')).split(';')[0] });
    const is4xx = code => code >= 400 && code < 500;

    // E-01: PUT doc=subscription must NOT alias the entitlements subscription key.
    eq((await E.statusFor('google:atk')).plan, 'free', 'attacker starts on Free');
    let res = fakeRes();
    await store(fakeReq('/api/store?doc=subscription', { method: 'PUT', headers: cookie('google:atk'), body: { value: JSON.stringify({ status: 'active', interval: 'year', currentPeriodEnd: '2099-01-01' }) } }), res);
    ok(is4xx(res.statusCode), 'PUT doc=subscription is refused (4xx), not written');
    eq((await E.statusFor('google:atk')).plan, 'free', 'plan stays Free — no self-grant to Pro');

    // Reserved names are rejected identically for GET and DELETE.
    res = fakeRes();
    await store(fakeReq('/api/store?doc=subscription', { headers: cookie('google:atk') }), res);
    ok(is4xx(res.statusCode), 'GET doc=subscription is refused (4xx)');
    res = fakeRes();
    await store(fakeReq('/api/store?doc=subscription', { method: 'DELETE', headers: cookie('google:atk') }), res);
    ok(is4xx(res.statusCode), 'DELETE doc=subscription is refused (4xx)');

    // E-02: PUT doc=usage:ai:<month> must NOT reset the AI meter.
    for (let i = 0; i < 5; i++) await E.incrementAI('google:atk');
    const month = (await E.getUsage('google:atk')).month;
    res = fakeRes();
    await store(fakeReq('/api/store?doc=usage:ai:' + month, { method: 'PUT', headers: cookie('google:atk'), body: { value: '0' } }), res);
    ok(is4xx(res.statusCode), 'PUT doc=usage:* is refused (4xx)');
    eq((await E.getUsage('google:atk')).aiMessages, 5, 'AI meter unchanged — cap is not self-resettable');
    // The general form (any usage: subkey) is covered, e.g. token counters.
    res = fakeRes();
    await store(fakeReq('/api/store?doc=usage:tokens:' + month, { method: 'PUT', headers: cookie('google:atk'), body: { value: '0' } }), res);
    ok(is4xx(res.statusCode), 'PUT doc=usage:tokens:* is refused (4xx) too');

    // Legitimate colon-bearing user docs are UNAFFECTED (no colon ban, keyspace intact).
    for (const doc of ['projects:index', 'prices:v1', 'prefs:v2', 'project:p123', 'thumb:p123']) {
      res = fakeRes();
      await store(fakeReq('/api/store?doc=' + doc, { method: 'PUT', headers: cookie('google:atk'), body: { value: '[]' } }), res);
      eq(res.statusCode, 200, `user doc "${doc}" still writable`);
    }
    rmkv();
    cleanEnv();
  }

  /* ---------------- entitlements: plans + usage ---------------- */
  section('entitlements: Free/Pro plans + usage metering');
  {
    const rmkv = useTempKV();
    let st = await E.statusFor('u:free');
    eq(st.plan, 'free', 'no subscription → Free');
    eq(st.entitlements.aiMonthlyLimit, 25, 'Free AI cap');
    eq(st.entitlements.projectLimit, 3, 'Free project cap');
    await E.incrementAI('u:free'); await E.incrementAI('u:free');
    eq((await E.getUsage('u:free')).aiMessages, 2, 'incrementAI accrues usage');

    await E.setSubscription('u:pro', { customerId: 'cus_1', status: 'active', interval: 'month', currentPeriodEnd: '2026-08-01T00:00:00.000Z' });
    st = await E.statusFor('u:pro');
    eq(st.plan, 'pro', 'active subscription → Pro');
    eq(st.entitlements.aiMonthlyLimit, 500, 'Pro AI cap');
    eq(st.entitlements.projectLimit, null, 'Pro → unlimited projects');
    ok(st.subscription && st.subscription.status === 'active', 'status echoes the subscription');

    await E.setSubscription('u:pro', { customerId: 'cus_1', status: 'canceled' });
    eq((await E.statusFor('u:pro')).plan, 'free', 'canceled subscription falls back to Free');
    rmkv();
    cleanEnv();
  }

  /* ---------------- stripe webhook: signature + record ---------------- */
  section('stripe webhook: signature verify, subscription record (A3/A7)');
  {
    const rmkv = useTempKV();
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_x';
    const periodEnd = 1785000000; // unix seconds, lives on the ITEM in current API versions
    const event = JSON.stringify({
      id: 'evt_1', type: 'customer.subscription.created',
      data: { object: {
        id: 'sub_1', customer: 'cus_9', status: 'active', cancel_at_period_end: false,
        metadata: { bb_uid: 'github:55' },
        items: { data: [{ price: { id: 'price_1', recurring: { interval: 'month' } }, current_period_end: periodEnd }] }
      } }
    });

    let res = fakeRes();
    await webhook(fakeReq('/api/stripe-webhook', { method: 'POST', headers: { 'stripe-signature': signWebhook(event, 'whsec_test_x') }, body: event }), res);
    eq(res.statusCode, 200, 'a validly-signed event is accepted');
    const sub = await E.getSubscription('github:55');
    eq(sub && sub.status, 'active', 'subscription persisted under the metadata uid');
    eq(sub && sub.currentPeriodEnd, new Date(periodEnd * 1000).toISOString(), 'renewal date read from items[] (A7 fix)');

    res = fakeRes();
    await webhook(fakeReq('/api/stripe-webhook', { method: 'POST', headers: { 'stripe-signature': signWebhook(event, 'whsec_test_x') }, body: event + ' ' }), res);
    eq(res.statusCode, 400, 'a tampered body is rejected');
    eq(json(res).error, 'invalid_signature', 'rejection is a signature error');

    res = fakeRes();
    await webhook(objectBodyReq('/api/stripe-webhook', { id: 'evt_x' }, { 'stripe-signature': 't=1,v1=deadbeef' }), res);
    eq(res.statusCode, 400, 'a pre-parsed body with no raw bytes is a 400');
    eq(json(res).error, 'raw_body_unavailable', 'and it is DIAGNOSABLE, not a mystery invalid_signature (A3)');

    delete process.env.STRIPE_WEBHOOK_SECRET;
    res = fakeRes();
    await webhook(fakeReq('/api/stripe-webhook', { method: 'POST', headers: {}, body: event }), res);
    eq(res.statusCode, 503, 'missing secret → webhook_unconfigured');
    rmkv();
    cleanEnv();
  }

  /* ---------------- billing: checkout + portal (mocked Stripe) ---------------- */
  section('billing: checkout + portal via the zero-dep Stripe client');
  {
    const rmkv = useTempKV();
    process.env.AUTH_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_PRO_MONTHLY_PRICE_ID = 'price_month';
    const realFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url) => {
      const u = String(url); calls.push(u);
      if (u.includes('/v1/customers')) return { ok: true, status: 200, json: async () => ({ id: 'cus_new' }) };
      if (u.includes('/v1/checkout/sessions')) return { ok: true, status: 200, json: async () => ({ id: 'cs_1', url: 'https://checkout.stripe.test/pay' }) };
      if (u.includes('/v1/billing_portal/sessions')) return { ok: true, status: 200, json: async () => ({ url: 'https://billing.stripe.test/portal' }) };
      return { ok: false, status: 404, json: async () => ({ error: { message: 'no' } }) };
    };
    const cookie = uid => ({ cookie: S.sessionCookieFor({ uid, name: 'T', provider: 'dev' }, fakeReq('/')).split(';')[0] });

    let res = fakeRes();
    await billing(fakeReq('/api/billing?action=checkout', { method: 'POST', body: {} }), res);
    eq(res.statusCode, 401, 'billing requires a session');

    res = fakeRes();
    await billing(fakeReq('/api/billing?action=checkout', { method: 'POST', headers: cookie('github:70'), body: { interval: 'month' } }), res);
    eq(res.statusCode, 200, 'checkout returns 200');
    eq(json(res).url, 'https://checkout.stripe.test/pay', 'checkout returns the Stripe-hosted URL');
    ok(calls.some(u => u.includes('/v1/customers')), 'a Stripe customer was created');
    const saved = await E.getSubscription('github:70');
    eq(saved && saved.customerId, 'cus_new', 'the customer id is persisted for the webhook to match');

    res = fakeRes();
    await billing(fakeReq('/api/billing?action=status', { headers: cookie('github:70') }), res);
    eq(json(res).plan, 'free', 'status stays Free until the webhook activates the subscription');

    res = fakeRes();
    await billing(fakeReq('/api/billing?action=portal', { method: 'POST', headers: cookie('github:70'), body: {} }), res);
    eq(json(res).url, 'https://billing.stripe.test/portal', 'portal returns the Stripe portal URL');

    globalThis.fetch = realFetch;
    rmkv();
    cleanEnv();
  }

  /* ---------------- chat: anonymous metering + rate limit (A4b) ---------------- */
  section('chat: anonymous requests are metered and rate-limited (A4b)');
  {
    const rmkv = useTempKV();
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn' }) });
    const chatReq = ip => fakeReq('/api/chat', { method: 'POST', headers: { 'x-forwarded-for': ip }, body: { messages: [{ role: 'user', content: 'hi' }] } });

    // (a) an anonymous call is proxied AND metered by hashed IP — no more free-for-all
    let res = fakeRes();
    await chat(chatReq('203.0.113.10'), res);
    eq(res.statusCode, 200, 'anonymous chat is proxied');
    eq((await E.getUsage(chat.anonMeterId({ headers: { 'x-forwarded-for': '203.0.113.10' }, socket: {} }))).aiMessages, 1,
      'anonymous usage is metered by IP (signing out no longer resets to unlimited)');

    // (b) once an anon IP hits the Free cap, the proxy refuses with 402
    const meterB = chat.anonMeterId({ headers: { 'x-forwarded-for': '203.0.113.20' }, socket: {} });
    for (let i = 0; i < E.FREE.aiMonthlyLimit; i++) await E.incrementAI(meterB);
    res = fakeRes();
    await chat(chatReq('203.0.113.20'), res);
    eq(res.statusCode, 402, 'anonymous over the Free cap → 402, not a free bypass');

    // (c) burst guard: with NO durable meter (KV down/unset) a rapid run from one
    //     IP is still capped by the in-memory guard — "no storage" ≠ "unlimited".
    delete process.env.BB_KV_FILE;
    let got429 = false, sent = 0;
    for (; sent < 70 && !got429; sent++) { res = fakeRes(); await chat(chatReq('203.0.113.30'), res); if (res.statusCode === 429) got429 = true; }
    ok(got429, `a burst from one IP is rate-limited (429) with no KV (tripped after ${sent})`);

    // (d) no key → 503, never a crash
    delete process.env.ANTHROPIC_API_KEY;
    res = fakeRes();
    await chat(chatReq('203.0.113.40'), res);
    eq(res.statusCode, 503, 'no ANTHROPIC_API_KEY → 503');

    globalThis.fetch = realFetch;
    rmkv();
    cleanEnv();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
})().catch(e => { console.error('server tests crashed:', e); process.exitCode = 1; });
