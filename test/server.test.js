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

const S = require('../api/_session.js');
const auth = require('../api/auth.js');
const store = require('../api/store.js');

const cleanEnv = () => {
  for (const k of ['AUTH_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET',
    'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'BB_KV_FILE', 'BB_DEV_LOGIN', 'APP_ORIGIN']) {
    delete process.env[k];
  }
};

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

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
})().catch(e => { console.error('server tests crashed:', e); process.exitCode = 1; });
