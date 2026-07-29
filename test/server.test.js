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
    'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRO_MONTHLY_PRICE_ID', 'STRIPE_PRO_YEARLY_PRICE_ID', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL',
    'BB_ADMIN_USER', 'BB_ADMIN_PASSWORD', 'BB_ADMIN_PASSWORD_SCRYPT']) {
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

  section('auth: email + password register / login (POST) mints the same session');
  {
    cleanEnv();
    // passwordAuth needs AUTH_SECRET + a KV store, and NO OAuth provider — this
    // is the sign-in-less-provider deployment the feature exists to unlock.
    process.env.AUTH_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
    const cleanup = useTempKV();

    // Probe advertises password auth even with zero OAuth providers.
    let res = fakeRes();
    await auth(fakeReq('/api/auth?me=1'), res);
    let data = json(res);
    eq(data.providers, [], 'no OAuth provider configured');
    eq(data.passwordAuth, true, 'password auth available on AUTH_SECRET + KV alone');

    const post = body => fakeReq('/api/auth', { method: 'POST', body });
    const sessOf = r => [].concat(r.headers['set-cookie'] || []).find(c => c.startsWith('bb_sess=') && !/bb_sess=;/.test(c));

    // Register mints a session carrying an email-scoped uid.
    res = fakeRes();
    await auth(post({ action: 'register', email: 'Maker@Example.com', password: 'goodpassword1', name: 'Mak' }), res);
    data = json(res);
    eq(res.statusCode, 200, 'register returns 200');
    ok(data.ok && data.user && data.user.provider === 'password', 'register returns a password-provider user');
    const regSess = sessOf(res);
    ok(!!regSess, 'register mints a session cookie');
    const payload = S.verify(decodeURIComponent(regSess.split(';')[0].split('=').slice(1).join('=')), process.env.AUTH_SECRET);
    ok(payload && /^email:/.test(payload.uid), 'session carries an email-scoped uid');

    // The new account gets its free signup credit (freemium hook). The grant
    // is lazy on first read with IP context, exactly like the OAuth path.
    const st = await E.statusFor(payload.uid, fakeReq('/', { headers: { 'x-forwarded-for': '203.0.113.9' } })).catch(() => null);
    ok(st && st.credits && st.credits.balance >= 1, 'new account receives a free signup credit');

    // Duplicate registration is rejected without leaking a stack.
    res = fakeRes();
    await auth(post({ action: 'register', email: 'maker@example.com', password: 'goodpassword1' }), res);
    eq(res.statusCode, 409, 'duplicate email → 409');
    eq(json(res).error, 'email_taken', 'duplicate email → email_taken code');

    // Wrong password is a generic 401 — never reveals the address exists.
    res = fakeRes();
    await auth(post({ action: 'login', email: 'maker@example.com', password: 'wrongpassword' }), res);
    eq(res.statusCode, 401, 'bad password → 401');
    eq(json(res).error, 'invalid_credentials', 'bad password → generic invalid_credentials');

    // Unknown address is the SAME generic 401 (no user enumeration).
    res = fakeRes();
    await auth(post({ action: 'login', email: 'nobody@example.com', password: 'whatever12' }), res);
    eq(json(res).error, 'invalid_credentials', 'unknown email → identical invalid_credentials code');

    // Correct login (case-insensitive email) mints a session for the same uid.
    res = fakeRes();
    await auth(post({ action: 'login', email: 'MAKER@example.com', password: 'goodpassword1' }), res);
    eq(res.statusCode, 200, 'correct login → 200');
    const loginSess = sessOf(res);
    ok(!!loginSess, 'login mints a session cookie');
    const p2 = S.verify(decodeURIComponent(loginSess.split(';')[0].split('=').slice(1).join('=')), process.env.AUTH_SECRET);
    eq(p2 && p2.uid, payload.uid, 'login resolves to the same account uid as register');

    // Weak password on register is rejected up front.
    res = fakeRes();
    await auth(post({ action: 'register', email: 'weak@example.com', password: 'short' }), res);
    eq(res.statusCode, 400, 'weak password → 400');
    eq(json(res).error, 'weak_password', 'weak password → weak_password code');

    cleanup();
  }

  /* ---------------- auth: the env-configured admin login ---------------- */
  section('admin: env vars mint an unrestricted account; rotation revokes with no code change');
  {
    cleanEnv();
    process.env.AUTH_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
    process.env.BB_ADMIN_USER = 'Shopkeeper';
    process.env.BB_ADMIN_PASSWORD = 'open-sesame-9';
    const cleanup = useTempKV();
    const Admin = require('../api/_admin.js');
    const P = require('../api/_passwords.js');
    const post = body => fakeReq('/api/auth', { method: 'POST', body });
    const sessOf = r => [].concat(r.headers['set-cookie'] || []).find(c => c.startsWith('bb_sess=') && !/bb_sess=;/.test(c));
    const me = async cookie => { const r = fakeRes(); await auth(fakeReq('/api/auth?me=1', { headers: { cookie } }), r); return json(r); };

    // Login rides the SAME form POST a password account uses — the username
    // goes where the email would (case-insensitive), no dedicated endpoint.
    let res = fakeRes();
    await auth(post({ action: 'login', email: 'shopkeeper', password: 'open-sesame-9' }), res);
    eq(res.statusCode, 200, 'admin login via the shared form → 200');
    let data = json(res);
    ok(data.ok && data.user && data.user.provider === 'admin' && data.user.admin === true, 'the response names the admin account');
    const adminSess = sessOf(res);
    ok(!!adminSess, 'admin login mints a session cookie');
    const cookie = adminSess.split(';')[0];
    const payload = S.verify(decodeURIComponent(cookie.split('=').slice(1).join('=')), process.env.AUTH_SECRET);
    ok(payload && /^admin:/.test(payload.uid), 'session carries an admin-scoped uid no other login path can mint');
    eq(payload && payload.ak, Admin.fingerprint(), 'session carries the credential fingerprint');

    // Wrong password: the same generic 401 as any bad login — no admin hint.
    res = fakeRes();
    await auth(post({ action: 'login', email: 'shopkeeper', password: 'wrong-password-1' }), res);
    eq(res.statusCode, 401, 'wrong admin password → 401');
    eq(json(res).error, 'invalid_credentials', 'wrong admin password → generic invalid_credentials');

    // Status probe: the admin plan has no caps at all.
    data = await me(cookie);
    ok(data.user && data.user.admin === true, 'me probe reports the admin flag');
    eq(data.billing && data.billing.plan, 'admin', 'the entitlement authority reports the admin plan');
    eq(data.billing.entitlements.projectLimit, null, 'no project cap');
    eq(data.billing.entitlements.aiMonthlyLimit, null, 'no AI message ceiling');

    // Chat: over the Free message ceiling AND over the token budget, the
    // admin still reaches the model (metering is skipped as a gate).
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    process.env.AI_MONTHLY_TOKEN_BUDGET = '1000';
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn', usage: { output_tokens: 5 } }) });
    for (let i = 0; i < E.FREE.aiMonthlyLimit + 5; i++) await E.incrementAI(payload.uid);
    await E.addTokens(payload.uid, 5000);
    res = fakeRes();
    await chat(fakeReq('/api/chat', { method: 'POST', headers: { cookie }, body: { messages: [{ role: 'user', content: 'hi' }] } }), res);
    eq(res.statusCode, 200, 'admin chat sails past the message ceiling and token budget');

    // Store: the admin is never project-capped.
    const putDoc = async (c, doc, value) => { const r = fakeRes(); await store(fakeReq('/api/store?doc=' + doc, { method: 'PUT', headers: { cookie: c }, body: { value } }), r); return r; };
    await putDoc(cookie, 'projects:index', JSON.stringify([{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }, { id: 'a4' }]));
    eq((await putDoc(cookie, 'project:a5', '{"id":"a5"}')).statusCode, 200, 'admin creates projects beyond the Free cap');

    // The scrypt variant verifies the same password with no plaintext in env.
    process.env.BB_ADMIN_PASSWORD_SCRYPT = P.hashPassword('open-sesame-9');
    delete process.env.BB_ADMIN_PASSWORD;
    res = fakeRes();
    await auth(post({ action: 'login', email: 'SHOPKEEPER', password: 'open-sesame-9' }), res);
    eq(res.statusCode, 200, 'login verifies against BB_ADMIN_PASSWORD_SCRYPT');
    const cookie2 = sessOf(res).split(';')[0];

    // Rotation is revocation: the credential material changed, so the FIRST
    // session's fingerprint is stale — it reads signed out on the probe, is
    // metered like any account on chat, and hits the project cap on store.
    data = await me(cookie);
    eq(data.user, null, 'a pre-rotation admin session reads as signed out');
    res = fakeRes();
    await chat(fakeReq('/api/chat', { method: 'POST', headers: { cookie }, body: { messages: [{ role: 'user', content: 'hi' }] } }), res);
    eq(res.statusCode, 402, 'a stale admin session is metered like any account (over the ceiling → 402)');
    eq((await putDoc(cookie, 'project:a6', '{"id":"a6"}')).statusCode, 403, 'a stale admin session hits the Free project cap');
    data = await me(cookie2);
    ok(data.user && data.user.admin === true && data.billing.plan === 'admin', 'the post-rotation session holds full admin access');

    // Half-configured (username without any password) means DISABLED — the
    // right credentials 401 like anything else, and the env audit says why.
    delete process.env.BB_ADMIN_PASSWORD_SCRYPT;
    res = fakeRes();
    await auth(post({ action: 'login', email: 'shopkeeper', password: 'open-sesame-9' }), res);
    eq(res.statusCode, 401, 'admin login is refused when the password env var is unset');
    const Env = require('../api/_env-check.js');
    ok(Env.evaluate().advisory.some(c => /BB_ADMIN/.test(c.key)), 'half-configured admin creds surface an env-audit advisory');

    globalThis.fetch = realFetch;
    cleanup();
    // Leave AUTH_SECRET as the surrounding sections expect; drop only ours.
    for (const k of ['BB_ADMIN_USER', 'BB_ADMIN_PASSWORD', 'BB_ADMIN_PASSWORD_SCRYPT', 'ANTHROPIC_API_KEY', 'AI_MONTHLY_TOKEN_BUDGET']) delete process.env[k];
  }

  section('admin: ordinary logins never feed the admin throttle (office-NAT lockout regression)');
  {
    process.env.BB_ADMIN_USER = 'gatekeeper';
    process.env.BB_ADMIN_PASSWORD = 'open-sesame-9';
    const cleanup = useTempKV();
    const Admin = require('../api/_admin.js');
    const IP = '203.0.113.77';
    const post = body => fakeReq('/api/auth', { method: 'POST', body, headers: { 'x-real-ip': IP } });
    let res = fakeRes();
    await auth(post({ action: 'register', email: 'crew@example.com', password: 'goodpassword1' }), res);
    eq(res.statusCode, 200, 'ordinary account registers');
    const crewLogin = async () => { const r = fakeRes(); await auth(post({ action: 'login', email: 'crew@example.com', password: 'goodpassword1' }), r); return r.statusCode; };

    // A whole office of correct-credential logins behind one NAT: none of
    // them may count as an admin failure.
    for (let i = 0; i < 12; i++) eq(await crewLogin(), 200, 'correct ordinary login #' + (i + 1) + ' from one IP succeeds');

    // Admin-SHAPED failures (the admin username, wrong password) DO throttle.
    // Interleave successful crew logins so the durable per-IP throttle in
    // _passwords.js (cleared on success) stays out of the way and the
    // in-memory admin throttle is what's measured.
    for (let i = 0; i < 10; i++) {
      res = fakeRes();
      await auth(post({ action: 'login', email: 'gatekeeper', password: 'wrong-' + i }), res);
      eq(res.statusCode, 401, 'admin-shaped failure #' + (i + 1) + ' → 401');
      if (i % 3 === 2) eq(await crewLogin(), 200, 'crew login between admin failures still succeeds');
    }
    res = fakeRes();
    await auth(post({ action: 'login', email: 'gatekeeper', password: 'open-sesame-9' }), res);
    eq(res.statusCode, 429, 'the throttled admin attempt is refused even with the right password');
    eq(await crewLogin(), 200, 'the ordinary account from the SAME IP is untouched by the admin throttle');

    Admin.clearFailures(IP);
    cleanup();
    for (const k of ['BB_ADMIN_USER', 'BB_ADMIN_PASSWORD']) delete process.env[k];
  }

  section('session: a malformed cookie is an anonymous request, never a throw');
  {
    const bad = S.sessionFrom(fakeReq('/', { headers: { cookie: 'foo=%E0%A4%A; bb_sess=%' } }));
    eq(bad, null, 'lone-percent cookie values degrade to anonymous');
    const good = S.sessionCookieFor({ uid: 'dev:cookie', name: 'T', provider: 'dev' }, fakeReq('/')).split(';')[0];
    const sess = S.sessionFrom(fakeReq('/', { headers: { cookie: 'junk=%; ' + good } }));
    ok(sess && sess.uid === 'dev:cookie', 'a valid session beside a malformed cookie still signs in');
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

  /* ---------------- store: server-side Free project cap ---------------- */
  section('store: server-side Free project cap on NEW project docs only (A-10)');
  {
    const rmkv = useTempKV();
    process.env.AUTH_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
    const cookie = uid => ({ cookie: S.sessionCookieFor({ uid, name: 'T', provider: 'google' }, fakeReq('/')).split(';')[0] });
    const putDoc = async (uid, doc, value) => {
      const res = fakeRes();
      await store(fakeReq('/api/store?doc=' + doc, { method: 'PUT', headers: cookie(uid), body: { value } }), res);
      return res;
    };
    // Save a project the way the client does: project doc first, then the index grows.
    const seedProject = async (uid, id) => {
      const r = await putDoc(uid, 'project:' + id, JSON.stringify({ id }));
      const g = fakeRes(); await store(fakeReq('/api/store?doc=projects:index', { headers: cookie(uid) }), g);
      const idx = JSON.parse(json(g).value || '[]'); idx.push({ id });
      await putDoc(uid, 'projects:index', JSON.stringify(idx));
      return r;
    };

    const free = 'google:free1';
    for (const id of ['pA', 'pB', 'pC']) eq((await seedProject(free, id)).statusCode, 200, `creating ${id} under the Free cap is allowed`);

    // A NEW project doc beyond the cap is rejected with a machine-readable error.
    let r = await putDoc(free, 'project:pD', JSON.stringify({ id: 'pD' }));
    eq(r.statusCode, 403, 'new project doc beyond the Free cap → 403');
    eq(json(r).error, 'project_limit', 'the rejection is a distinct machine-readable error');

    // Updating an EXISTING project doc always succeeds, even at/over the cap
    // (a downgraded ex-Pro user must never lose edits).
    eq((await putDoc(free, 'project:pA', JSON.stringify({ id: 'pA', edited: true }))).statusCode, 200,
      'updating an existing project at the cap is allowed');

    // Non-project docs are never capped.
    eq((await putDoc(free, 'prefs:v2', '{"x":1}')).statusCode, 200, 'prefs unaffected by the cap');
    eq((await putDoc(free, 'prices:v1', '{}')).statusCode, 200, 'prices unaffected by the cap');
    eq((await putDoc(free, 'thumb:pD', '"data"')).statusCode, 200, 'thumbnails unaffected by the cap');
    eq((await putDoc(free, 'projects:index', JSON.stringify([{ id: 'pA' }, { id: 'pB' }, { id: 'pC' }]))).statusCode, 200, 'index write unaffected by the cap');

    // Pro (unlimited) can create well beyond the Free cap.
    const pro = 'google:pro1';
    await E.setSubscription(pro, { customerId: 'c', status: 'active' });
    await putDoc(pro, 'projects:index', JSON.stringify([{ id: 'x1' }, { id: 'x2' }, { id: 'x3' }, { id: 'x4' }, { id: 'x5' }]));
    eq((await putDoc(pro, 'project:x6', JSON.stringify({ id: 'x6' }))).statusCode, 200, 'Pro (unlimited) creates beyond the Free cap');

    // Anonymous requests never reach the cap — they are 401 before any check.
    const anon = fakeRes();
    await store(fakeReq('/api/store?doc=project:pZ', { method: 'PUT', body: { value: '{}' } }), anon);
    eq(anon.statusCode, 401, 'anonymous project PUT is 401 (cap needs a uid)');

    rmkv();
    cleanEnv();
  }

  /* ---------------- entitlements: plans + usage ---------------- */
  section('entitlements: Free/Pro plans + usage metering');
  {
    const rmkv = useTempKV();
    let st = await E.statusFor('u:free');
    eq(st.plan, 'free', 'no subscription → Free');
    // Credits pivot: the monthly AI meter is an abuse ceiling, not the offer.
    eq(st.entitlements.aiMonthlyLimit, 200, 'Free AI ceiling (abuse guard, not the 25-message offer)');
    eq(st.entitlements.projectLimit, 3, 'Free project cap');
    ok(st.credits && typeof st.credits.balance === 'number', 'status carries the credit balance (the real offer)');
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

  /* ---------------- chat: sign-in gate + per-uid metering + burst (A4b → credits pivot) ---------------- */
  section('chat: AI is behind sign-in; per-uid metering is an abuse ceiling; burst guard holds (A4b)');
  {
    const rmkv = useTempKV();
    process.env.AUTH_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn' }) });
    const mkC = uid => S.sessionCookieFor({ uid, name: 'T', provider: 'dev' }, fakeReq('/')).split(';')[0];
    const chatReq = uid => fakeReq('/api/chat', { method: 'POST', headers: uid ? { cookie: mkC(uid) } : {}, body: { messages: [{ role: 'user', content: 'hi' }] } });

    // (E-03) The anon meter identity stays non-forgeable (kept for any future
    // anonymous preview path): rotating X-Forwarded-For must never mint buckets.
    {
      const spoofA = chat.anonMeterId({ headers: { 'x-real-ip': '198.51.100.7', 'x-forwarded-for': '1.1.1.1' }, socket: { remoteAddress: '10.0.0.9' } });
      const spoofB = chat.anonMeterId({ headers: { 'x-real-ip': '198.51.100.7', 'x-forwarded-for': '2.2.2.2' }, socket: { remoteAddress: '10.0.0.9' } });
      eq(spoofA, spoofB, 'rotating X-Forwarded-For cannot mint a fresh bucket — x-real-ip is the identity');
      const sockA = chat.anonMeterId({ headers: { 'x-forwarded-for': '1.1.1.1' }, socket: { remoteAddress: '10.9.8.7' } });
      const sockB = chat.anonMeterId({ headers: { 'x-forwarded-for': '9.9.9.9' }, socket: { remoteAddress: '10.9.8.7' } });
      eq(sockA, sockB, 'with no x-real-ip, the direct socket address is the identity, not XFF');
      ok(spoofA !== chat.anonMeterId({ headers: { 'x-real-ip': '198.51.100.8' }, socket: {} }), 'genuinely different real IPs still get distinct buckets');
    }

    // (a) anonymous chat is refused — AI is behind sign-in (credits pivot).
    let res = fakeRes();
    await chat(chatReq(null), res);
    eq(res.statusCode, 401, 'anonymous chat → 401 auth_required');
    eq(json(res).error && json(res).error.type, 'auth_required', 'with a branchable error type');

    // (b) signed-in chat is proxied AND metered per uid.
    res = fakeRes();
    await chat(chatReq('dev:meter1'), res);
    eq(res.statusCode, 200, 'signed-in chat is proxied');
    eq((await E.getUsage('dev:meter1')).aiMessages, 1, 'signed-in usage is metered per uid');

    // (c) over the monthly abuse ceiling → 402 (a guard, not an upsell).
    for (let i = 0; i < E.FREE.aiMonthlyLimit; i++) await E.incrementAI('dev:meter2');
    res = fakeRes();
    await chat(chatReq('dev:meter2'), res);
    eq(res.statusCode, 402, 'over the abuse ceiling → 402');
    ok(!/upgrade/i.test((json(res).error || {}).message || ''), 'the ceiling message never sells an upgrade');

    // (d) burst guard: with NO durable meter (KV down/unset) a rapid run from
    //     one uid is still capped in-memory — "no storage" ≠ "unlimited".
    delete process.env.BB_KV_FILE;
    let got429 = false, sent = 0;
    for (; sent < 70 && !got429; sent++) { res = fakeRes(); await chat(chatReq('dev:burst'), res); if (res.statusCode === 429) got429 = true; }
    ok(got429, `a burst from one uid is rate-limited (429) with no KV (tripped after ${sent})`);

    // (e) no key → 503, never a crash
    delete process.env.ANTHROPIC_API_KEY;
    res = fakeRes();
    await chat(chatReq('dev:meter3'), res);
    eq(res.statusCode, 503, 'no ANTHROPIC_API_KEY → 503');

    globalThis.fetch = realFetch;
    rmkv();
    cleanEnv();
  }

  /* ---------------- billing client: signed-out Upgrade honesty (A-02/X-03) ---------------- */
  section('billing: signed-out Upgrade shows an honest state, never a silent close (A-02/X-03)');
  {
    const vm = require('vm');
    const src = fs.readFileSync(path.join(__dirname, '../src/billing.js'), 'utf8');
    const sandbox = {}; sandbox.globalThis = sandbox; // pure load: no DOM touched until open()
    vm.runInNewContext(src, sandbox);
    const B = sandbox.BB && sandbox.BB.Billing;
    ok(B && typeof B.signedOutUpgradeNote === 'function', 'signedOutUpgradeNote is exposed for the signed-out path');
    if (B && typeof B.signedOutUpgradeNote === 'function') {
      const none = B.signedOutUpgradeNote({ user: null, providers: [] });
      eq(none.redirect, false, 'no providers → no redirect (a redirect would dead-end)');
      ok(/available|isn't|not/i.test(none.note || ''), 'no providers → an explicit honest note is surfaced');
      const withP = B.signedOutUpgradeNote({ user: null, providers: ['github'] });
      eq(withP.redirect, true, 'providers present → hand off to sign-in');
      ok((withP.note || '').length > 0, 'providers present → a cue is set before the redirect');
    }
    // The old silent-close-then-noop pattern must be gone from the signed-out branch.
    ok(!/!account\(\)\.user\)\s*\{\s*dialog\.close\(\);\s*openSignIn\(\)/.test(src),
      'signed-out upgrade no longer closes the dialog before (maybe) redirecting');
  }

  /* ---------------- billing client: the credits dialog matches the real offer (A-08) ---------------- */
  section('billing: the client pricing surface sells credits, honestly (A-08, credits pivot)');
  {
    const vm = require('vm');
    const src = fs.readFileSync(path.join(__dirname, '../src/billing.js'), 'utf8');

    // The subscription is no longer sold client-side (the server paths stay dormant).
    ok(!/Upgrade to Pro/.test(src), 'the client no longer sells the Pro subscription');
    ok(!/data-upgrade/.test(src), 'the old subscription upgrade button is gone');
    // Honest facts the dialog must state: the refinement window, free
    // re-downloads, never-charge-twice, and 12-month expiry.
    ok(/free re-?download|re-download/i.test(src), 'copy states re-downloads are free');
    ok(/never charges twice/i.test(src), 'copy states the idempotency guarantee');
    ok(/12 months/.test(src), 'copy states the 12-month expiry');
    ok(/first credit/i.test(src), 'copy states the free signup credit');

    // Confirm-before-spend exists and names the cost.
    ok(/confirmIssue/.test(src) && /1 credit/i.test(src), 'a confirm-before-spend dialog names the 1-credit cost');

    const sandbox = {}; sandbox.globalThis = sandbox;
    vm.runInNewContext(src, sandbox);
    const B = sandbox.BB && sandbox.BB.Billing;
    ok(B && typeof B.freeSyncLabel === 'function', 'freeSyncLabel is exposed for the provider-conditional bullet');
    if (B && typeof B.freeSyncLabel === 'function') {
      eq(B.freeSyncLabel({ providers: [] }), 'Device sync', 'no providers → device-only sync copy (honest)');
      eq(B.freeSyncLabel({ providers: ['github'] }), 'Device and cloud sync', 'providers present → cloud sync copy');
    }
    ok(B && typeof B.confirmIssue === 'function' && typeof B.issue === 'function', 'issue + confirmIssue ride BB.Billing');
    // The offer is credits: all four launch packs are purchasable ($9 flat single).
    const packs = (B && B.CREDIT_PACKS || []).map(p => p.n);
    eq(packs, [1, 3, 10, 25], 'all four launch packs are offered');
    const single = (B && B.CREDIT_PACKS || []).find(p => p.n === 1);
    eq(single && single.price, 9, 'launch pricing is $9 flat for a single credit');
    // The display mirror agrees with the server authority on the ceilings.
    ok(src.includes(`aiMonthlyLimit: ${E.FREE.aiMonthlyLimit}`), 'client TIERS mirror matches the server FREE ceiling');
  }

  /* ---------------- observability: structured error reporting (E-08) ---------------- */
  section('observability: a backend failure emits one structured error line (E-08)');
  {
    process.env.AUTH_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
    process.env.KV_REST_API_URL = 'https://kv.example.com';
    process.env.KV_REST_API_TOKEN = 'tok';
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED kv down'); }; // KV outage
    const captured = [];
    const realErr = console.error;
    console.error = (...a) => { captured.push(a.map(String).join(' ')); };
    const c = S.sessionCookieFor({ uid: 'google:obs', name: 'O', provider: 'google' }, fakeReq('/')).split(';')[0];
    const res = fakeRes();
    try { await store(fakeReq('/api/store?doc=projects:index', { headers: { cookie: c } }), res); }
    finally { console.error = realErr; globalThis.fetch = realFetch; }
    eq(res.statusCode, 502, 'a KV outage surfaces as 502, not a crash');
    const lines = captured.map(s => { try { return JSON.parse(s); } catch (e) { return null; } }).filter(Boolean);
    const line = lines.find(o => o && o.scope === 'store');
    ok(!!line, 'a structured JSON error line was emitted to stderr on the KV failure');
    ok(line && typeof line.ts === 'string' && !!line.event && ('detail' in line),
      'the line carries ts + scope + event + detail');
    cleanEnv();
  }

  /* ---------------- chat: optional monthly token spend ceiling (E-07a) ---------------- */
  section('chat: optional monthly token spend ceiling (E-07a)');
  {
    const rmkv = useTempKV();
    process.env.AUTH_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    process.env.AI_MONTHLY_TOKEN_BUDGET = '150';
    const realFetch = globalThis.fetch;
    let upstreamCalls = 0;
    globalThis.fetch = async () => { upstreamCalls++; return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 100 } }) }; };
    const mkC = uid => S.sessionCookieFor({ uid, name: 'T', provider: 'dev' }, fakeReq('/')).split(';')[0];
    const chatReq = uid => fakeReq('/api/chat', { method: 'POST', headers: { cookie: mkC(uid) }, body: { messages: [{ role: 'user', content: 'hi' }] } });
    const meter = 'dev:budget1';

    // First call under budget → proxied AND meters the 100 output tokens.
    let res = fakeRes();
    await chat(chatReq(meter), res);
    eq(res.statusCode, 200, 'first call under the token budget is proxied');
    eq((await E.getTokenUsage(meter)).tokens, 100, 'output tokens from the Anthropic response are metered');

    // Second call still under budget → proxied, counter accrues to 200.
    res = fakeRes();
    await chat(chatReq(meter), res);
    eq(res.statusCode, 200, 'second call still under budget is proxied');
    eq((await E.getTokenUsage(meter)).tokens, 200, 'token counter accrues across calls');

    // Third call: 200 >= 150 → refused PRE-upstream with a distinct 429.
    upstreamCalls = 0;
    res = fakeRes();
    await chat(chatReq(meter), res);
    eq(res.statusCode, 429, 'over the token budget → 429 (client tolerates it as rate-limited)');
    eq(upstreamCalls, 0, 'the ceiling is enforced PRE-upstream — no Anthropic call is made');
    ok(json(res).error && /budget|limit/i.test(json(res).error.message || ''), 'the 429 carries a distinct budget message');

    // Disabled by default: unset env var → no ceiling, no token counting.
    delete process.env.AI_MONTHLY_TOKEN_BUDGET;
    res = fakeRes();
    await chat(chatReq('dev:budget2'), res);
    eq(res.statusCode, 200, 'unset budget → disabled (current behavior)');
    eq((await E.getTokenUsage('dev:budget2')).tokens, 0, 'no token counting when the budget is unset');

    // Honest copy: the pricing dialog states a request can span several messages.
    const billingSrc = fs.readFileSync(path.join(__dirname, '../src/billing.js'), 'utf8');
    ok(/several AI messages|use several|several messages/i.test(billingSrc), 'pricing copy states a complex request may use several AI messages');

    globalThis.fetch = realFetch;
    rmkv();
    cleanEnv();
  }

  /* ---------------- chat: upstream fetch carries an abort timeout (C6) ---------------- */
  section('chat: the upstream fetch carries an abort timeout (C6)');
  {
    const rmkv = useTempKV();
    process.env.AUTH_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const realFetch = globalThis.fetch;
    const mkC = uid => ({ cookie: S.sessionCookieFor({ uid, name: 'T', provider: 'dev' }, fakeReq('/')).split(';')[0] });
    let seenOpts = null;
    globalThis.fetch = async (url, opts) => { seenOpts = opts; return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn' }) }; };
    let res = fakeRes();
    await chat(fakeReq('/api/chat', { method: 'POST', headers: mkC('dev:abort1'), body: { messages: [{ role: 'user', content: 'hi' }] } }), res);
    eq(res.statusCode, 200, 'stubbed upstream still proxies');
    ok(seenOpts && seenOpts.signal instanceof AbortSignal, 'the upstream fetch receives an AbortSignal timeout');
    // An abort rejection rides the existing 502 unreachable path — the
    // request resolves instead of hanging forever.
    globalThis.fetch = async () => { const e = new Error('The operation was aborted'); e.name = 'TimeoutError'; throw e; };
    res = fakeRes();
    await chat(fakeReq('/api/chat', { method: 'POST', headers: mkC('dev:abort2'), body: { messages: [{ role: 'user', content: 'hi' }] } }), res);
    eq(res.statusCode, 502, 'a timed-out upstream resolves into the 502 unreachable path');
    globalThis.fetch = realFetch;
    rmkv();
    cleanEnv();
  }

  /* ---------------- chat: prompt caching via system split (C14) ---------------- */
  section('chat: system prompt splits into a cached prefix + per-call tail (C14)');
  {
    const rmkv = useTempKV();
    process.env.AUTH_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const realFetch = globalThis.fetch;
    let seenPayload = null;
    globalThis.fetch = async (url, opts) => { seenPayload = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn' }) }; };
    const cacheCookie = { cookie: S.sessionCookieFor({ uid: 'dev:cache1', name: 'T', provider: 'dev' }, fakeReq('/')).split(';')[0] };
    const send = async system => {
      const res = fakeRes();
      const body = { messages: [{ role: 'user', content: 'hi' }] };
      if (system !== undefined) body.system = system;
      await chat(fakeReq('/api/chat', { method: 'POST', headers: cacheCookie, body }), res);
      return res;
    };

    // The real client shape: byte-stable prefix (schema doc + digests), then
    // the marker line isolating the per-call wire spec (src/ai.js systemPrompt).
    const prefix = 'WIRE FORMAT schema doc + knowledge digests (byte-stable)';
    const tail = '\n--- current spec (wire format) ---\n{"v":4,"t":4}';
    await send(prefix + tail);
    ok(Array.isArray(seenPayload.system) && seenPayload.system.length === 2, 'system with the spec marker becomes two blocks');
    eq(seenPayload.system[0], { type: 'text', text: prefix, cache_control: { type: 'ephemeral' } }, 'first block = byte-stable prefix with cache_control ephemeral');
    eq(seenPayload.system[1], { type: 'text', text: tail }, 'second block = per-call tail (marker + wire spec), uncached');
    eq(seenPayload.system.map(b => b.text).join(''), prefix + tail, 'the split loses no bytes');

    await send('no marker in this system prompt');
    eq(seenPayload.system, 'no marker in this system prompt', 'marker absent → plain string passes through unchanged');
    await send(undefined);
    ok(seenPayload.system === undefined, 'no system at all → undefined, exactly as before');

    // The split only pays off if the marker still matches what the client
    // emits — pin the marker line in src/ai.js systemPrompt.
    const aiSrc = fs.readFileSync(path.join(__dirname, '../src/ai.js'), 'utf8');
    ok(aiSrc.includes("'--- current spec (wire format) ---'"), 'src/ai.js systemPrompt still carries the split marker line');

    globalThis.fetch = realFetch;
    rmkv();
    cleanEnv();
  }

  /* ---------------- env audit + production readiness (A-03) ---------------- */
  section('env audit: AI + OAuth advisories and qualified readiness (A-03)');
  {
    const Env = require('../api/_env-check.js');
    cleanEnv();
    ok(typeof Env.evaluate === 'function', '_env-check exposes a pure evaluate()');
    if (typeof Env.evaluate === 'function') {
      let ev = Env.evaluate();
      const advKeys = ev.advisory.map(a => a.key);
      ok(advKeys.includes('ANTHROPIC_API_KEY'), 'missing ANTHROPIC_API_KEY is flagged advisory');
      ok(advKeys.some(k => /OAuth/i.test(k)), 'zero OAuth pairs is flagged advisory');
      const aiAdv = ev.advisory.find(a => a.key === 'ANTHROPIC_API_KEY');
      ok(aiAdv && /offline parser/i.test(aiAdv.remedy), 'AI advisory says the app degrades to the offline parser');
      const oauthAdv = ev.advisory.find(a => /OAuth/i.test(a.key));
      ok(oauthAdv && /sign in|sign-in|billing/i.test(oauthAdv.remedy), 'OAuth advisory says no one can sign in / billing unreachable');

      process.env.GITHUB_CLIENT_ID = 'id'; process.env.GITHUB_CLIENT_SECRET = 'sec';
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      ev = Env.evaluate();
      const advKeys2 = ev.advisory.map(a => a.key);
      ok(!advKeys2.includes('ANTHROPIC_API_KEY'), 'ANTHROPIC set → no AI advisory');
      ok(!advKeys2.some(k => /OAuth/i.test(k)), 'one OAuth pair set → no OAuth advisory');
      cleanEnv();
    }

    // verify-production's readiness verdict is a pure, testable function (the
    // network run is guarded behind require.main, so requiring it is side-effect-free).
    const verify = require('../scripts/verify-production.js');
    ok(typeof verify.summarize === 'function', 'verify-production exposes summarize()');
    if (typeof verify.summarize === 'function') {
      const green = [{ passed: true }, { passed: null }];
      eq(verify.summarize(green, { aiPresent: true, oauthPresent: true }).ready, true, 'all green + AI + OAuth → ready');
      const noAi = verify.summarize(green, { aiPresent: false, oauthPresent: true });
      eq(noAi.ready, false, 'missing AI key → NOT an unqualified ready');
      ok(noAi.ok === true && noAi.gaps.some(g => /offline parser/i.test(g)), 'AI gap is listed but not a hard failure');
      eq(verify.summarize(green, { aiPresent: true, oauthPresent: false }).ready, false, 'no OAuth provider → NOT ready');
      eq(verify.summarize([{ passed: false }], { aiPresent: true, oauthPresent: true }).ok, false, 'a hard failure → not ok');
    }
    cleanEnv();
  }

  /* ---------------- clientlog: the browser half of the error log (V-02) ---------------- */
  section('clientlog: a browser crash becomes one structured line — privacy-capped, burst-capped, never a failure surface (V-02)');
  {
    cleanEnv(); // no AUTH_SECRET, no KV, no anything — a crash must report regardless
    const clientlog = require('../api/clientlog.js');
    /* Drive the handler with console.error captured, exactly like the E-08
     * section: api/_log.js writes its one line to stderr. */
    const post = async (body, ip) => {
      const lines = [];
      const realErr = console.error;
      console.error = (...a) => { lines.push(a.map(String).join(' ')); };
      const res = fakeRes();
      try { await clientlog(fakeReq('/api/clientlog', { method: 'POST', headers: ip ? { 'x-real-ip': ip } : {}, body }), res); }
      finally { console.error = realErr; }
      return { res, logged: lines.map(s => { try { return JSON.parse(s); } catch (e) { return null; } }).filter(Boolean) };
    };

    // (a) One report in, exactly one structured line out, in the _log.js shape.
    let r = await post({
      kind: 'error', message: 'boot failed: WebGL context lost',
      source: 'https://app.example.com/index.html', line: 4210, col: 17,
      stack: 'Error: boot failed\n at boot (index.html:4210:17)'
    }, '198.51.100.10');
    eq(r.res.statusCode, 204, 'a report is accepted with 204');
    eq(r.res.body, '', 'the 204 carries no body');
    eq(r.logged.length, 1, 'exactly one structured line per report');
    const line = r.logged[0];
    eq(line.scope, 'client', 'scope names the client half of the product');
    eq(line.event, 'error', 'event is the crash kind');
    ok(typeof line.ts === 'string' && 'detail' in line, 'the line carries ts + scope + event + detail (the _log.js shape)');
    const detail = JSON.parse(line.detail);
    eq(detail.message, 'boot failed: WebGL context lost', 'the message survives');
    eq(detail.line, 4210, 'line rides along as a number');
    eq(detail.col, 17, 'col rides along as a number');
    ok(/boot \(index/.test(detail.stack), 'the stack survives');

    // (b) kind is an enum of two, normalised server-side.
    r = await post({ kind: 'unhandledrejection', message: 'storage chain gave up' }, '198.51.100.11');
    eq(r.logged[0].event, 'unhandledrejection', 'the rejection kind is preserved');
    r = await post({ kind: 'something-else', message: 'x' }, '198.51.100.11');
    eq(r.logged[0].event, 'error', 'any other kind normalises to error');

    // (c) PRIVACY: the envelope is an allowlist, and every field is capped.
    r = await post({
      kind: 'error', message: 'm'.repeat(1000), stack: 's'.repeat(5000), source: 'u'.repeat(1000),
      spec: { meta: { name: 'Walnut dining table for Hana' } }, shareCode: 'BB4:AAAA', cookie: 'bb_sess=secret'
    }, '198.51.100.12');
    const d = JSON.parse(r.logged[0].detail);
    eq(d.message.length, 300, 'message truncates at 300 chars');
    eq(d.stack.length, 2000, 'stack truncates at 2000 chars');
    eq(d.source.length, 200, 'other fields truncate at 200 chars');
    eq(Object.keys(d).sort(), ['col', 'line', 'message', 'source', 'stack'], 'the detail is an allowlist — nothing else survives');
    ok(!/Walnut dining table|BB4:|bb_sess/.test(r.logged[0].detail), 'design content and credentials in the body never reach the log');

    // (d) Wrong method is the only non-204 this endpoint can produce.
    const wrong = fakeRes();
    await clientlog(fakeReq('/api/clientlog'), wrong);
    eq(wrong.statusCode, 405, 'GET → 405');
    eq(wrong.headers.allow, 'POST', 'with an Allow header');

    // (e) A body it cannot use is accepted and dropped — never an error back.
    r = await post('{not json', '198.51.100.13');
    eq(r.res.statusCode, 204, 'an unparseable body is still 204');
    eq(r.logged.length, 0, 'and logs nothing');
    r = await post(JSON.stringify({ kind: 'error', message: 'x'.repeat(20000) }), '198.51.100.13');
    eq(r.res.statusCode, 204, 'an oversized body is still 204');
    eq(r.logged.length, 0, 'and logs nothing');
    r = await post({ kind: 'error' }, '198.51.100.13');
    eq(r.res.statusCode, 204, 'an empty envelope is still 204');
    eq(r.logged.length, 0, 'an envelope with nothing to say is accepted, not written');

    // (f) A crash-looping tab cannot flood the log — and is never told so.
    const loopIp = '198.51.100.99';
    const statuses = new Set();
    let written = 0;
    for (let i = 0; i < 60; i++) {
      const x = await post({ kind: 'error', message: 'crash loop #' + i }, loopIp);
      statuses.add(x.res.statusCode);
      written += x.logged.length;
    }
    eq([...statuses], [204], 'every request in a crash loop still answers 204 — the reporter never becomes a failure surface');
    ok(written > 0 && written < 60, `a crash loop stops being logged (${written}/60 lines written)`);
    eq(written, clientlog.BURST_MAX, 'the cap is exactly the per-IP burst budget');
    eq((await post({ kind: 'error', message: 'still looping' }, loopIp)).logged.length, 0,
      'once over the cap, further reports are accepted and dropped');

    // (g) The whole section ran on an unconfigured deployment.
    ok(!process.env.AUTH_SECRET && !process.env.BB_KV_FILE, 'all of the above ran with no session secret and no storage configured');
    cleanEnv();
  }

  /* ---------------- blueprint: the ownership probe (G-02) ---------------- */
  section('blueprint: the ownership probe answers “already paid for?” as a pure read — it can never charge (G-02)');
  {
    cleanEnv();
    const drop = useTempKV();
    const blueprint = require('../api/blueprint.js');
    const Credits = require('../api/_credits.js');
    const Pipeline = require('../api/_pipeline.js');
    process.env.AUTH_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
    const cookie = uid => ({ cookie: S.sessionCookieFor({ uid, name: 'T', provider: 'dev' }, fakeReq('/')).split(';')[0] });

    const SPEC = { meta: { name: 'Probe Table', template: 'table', level: 'beginner', units: 'mm' }, overall: { width: 1200, depth: 700, height: 750 } };
    // The client always holds a share code for its CURRENT (corrected) spec —
    // that is exactly what the probe takes.
    const shareCode = spec => Pipeline.load().Codec.toShareCode(Pipeline.evaluate(spec).spec);
    const probe = async (uid, code) => {
      const res = fakeRes();
      await blueprint(fakeReq('/api/blueprint?owned=' + encodeURIComponent(code), uid ? { headers: cookie(uid) } : {}), res);
      return res;
    };
    const uid = 'dev:probe1';
    const code = shareCode(SPEC);

    // Anonymous probes are refused like every other authed route on this file.
    let res = await probe(null, code);
    eq(res.statusCode, 401, 'no session → 401');
    eq(json(res).error, 'auth_required', 'with a branchable code');

    // Never issued → an honest no, and the signup credit is untouched.
    res = await probe(uid, code);
    eq(res.statusCode, 200, 'a probe for an unissued design is a clean 200');
    eq(json(res), { owned: false }, 'unknown charge hash → { owned:false }');
    eq((await Credits.state(uid)).balance, 1, 'the probe did not spend the signup credit');

    // Issue it for real — issuance is the only thing here that costs anything.
    const issued = fakeRes();
    await blueprint(fakeReq('/api/blueprint', { method: 'POST', headers: cookie(uid), body: { spec: SPEC } }), issued);
    eq(issued.statusCode, 200, 'setup: issuance succeeds');
    const design = json(issued);
    ok(design.charged === true, 'setup: issuance is what charges the credit');
    const balanceAfterIssue = (await Credits.state(uid)).balance;
    const ledgerAfterIssue = (await Credits.ledgerFor(uid)).length;

    // The probe now recognises the design, and returns the record the client
    // needs to unlock it on a fresh device.
    res = await probe(uid, code);
    eq(res.statusCode, 200, 'an issued design probes 200');
    eq(json(res), { owned: true, id: design.id, revision: design.revision, windowEndsAt: design.windowEndsAt },
      'owned:true carries exactly id + revision + windowEndsAt from the design record');

    // THE assertion: probing is free, forever, however many times.
    for (let i = 0; i < 5; i++) await probe(uid, code);
    eq((await Credits.state(uid)).balance, balanceAfterIssue, 'repeated probes never move the credit balance');
    eq((await Credits.ledgerFor(uid)).length, ledgerAfterIssue, 'repeated probes never append a ledger entry');
    eq((await Credits.ledgerFor(uid)).filter(e => e.type === 'charge').length, 1, 'the only charge on the ledger is the one issuance');

    // Ownership is owner-scoped, exactly like artifact download.
    res = await probe('dev:probe2', code);
    eq(json(res), { owned: false }, 'a stranger owns nothing, even with the same share code');
    eq((await Credits.state('dev:probe2')).balance, 1, 'and their balance is untouched too');

    // Material identity is the charge hash: a resize is a different design, a
    // rename is not (meta.name / meta.units are display-only).
    const refined = JSON.parse(JSON.stringify(SPEC)); refined.overall.width = 1400;
    res = await probe(uid, shareCode(refined));
    eq(json(res), { owned: false }, 'a materially different spec is a different design → owned:false');
    const renamed = JSON.parse(JSON.stringify(SPEC)); renamed.meta.name = 'Renamed Table';
    res = await probe(uid, shareCode(renamed));
    ok(json(res).owned === true && json(res).id === design.id, 'a rename still probes as owned (name is display-only)');

    // Junk in is a clean 400 — never a 500, never a charge.
    res = await probe(uid, 'BB4:notacode');
    eq(res.statusCode, 400, 'an undecodable code → 400');
    eq(json(res).error, 'bad_code', 'with a branchable code');
    res = await probe(uid, '');
    eq(res.statusCode, 400, 'an empty probe → 400, not a 500');
    eq((await Credits.state(uid)).balance, balanceAfterIssue, 'malformed probes never touch the balance either');

    // Unconfigured storage degrades like the rest of the route.
    const kvFile = process.env.BB_KV_FILE;
    delete process.env.BB_KV_FILE;
    res = await probe(uid, code);
    eq(res.statusCode, 503, 'no storage configured → 503, never a crash');
    process.env.BB_KV_FILE = kvFile;

    drop();
    cleanEnv();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
})().catch(e => { console.error('server tests crashed:', e); process.exitCode = 1; });
