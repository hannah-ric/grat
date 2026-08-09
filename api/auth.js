/* Blueprint Buddy — accounts (optional, zero-dependency).
 *
 * One serverless function owns the whole login lifecycle over standard
 * OAuth 2.0 authorization-code flows — no auth SDK, no client-side vendor
 * script (the app must stay a self-contained single file):
 *
 *   GET  /api/auth?me=1              -> { user, providers, passwordAuth, storage } (never errors)
 *   GET  /api/auth?provider=google  -> 302 to Google sign-in
 *   GET  /api/auth?provider=github  -> 302 to GitHub sign-in
 *   GET  /api/auth?code=…&state=…   -> OAuth callback: sets the session cookie
 *   GET  /api/auth?logout=1         -> clears the cookie
 *   POST /api/auth {action:register|login, email, password, name?}
 *                                   -> email+password account: sets the session cookie
 *
 * Email + password (api/_passwords.js) needs no external provider — it runs
 * on AUTH_SECRET and the KV store the app already has, and mints the exact
 * same session an OAuth login would. It is a first-class account.
 *
 * Sessions are stateless HMAC cookies (api/_session.js) — nothing stored
 * server-side. CSRF: the outbound redirect carries a random `state` echoed
 * in a short-lived signed cookie; the callback requires both to match.
 *
 * Environment (all optional — the app degrades to device-local storage):
 *   AUTH_SECRET                              enables sessions (32+ random bytes)
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET  enables "Sign in with Google"
 *   GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET  enables "Sign in with GitHub"
 *   APP_ORIGIN                               override the derived origin
 *   BB_DEV_LOGIN=1                           local-only fake provider (serve.js)
 *
 * serve.js mounts this same handler at /api/auth for local dev.
 */
'use strict';

const crypto = require('crypto');
const S = require('./_session.js');
const E = require('./_entitlements.js');
const P = require('./_passwords.js');
const Admin = require('./_admin.js');
const Credits = require('./_credits.js');
const Env = require('./_env-check.js');
const Log = require('./_log.js');
const KV = require('./_kv.js');

// Audit env vars once at cold start so missing keys surface immediately in logs.
Env.audit();

const PROVIDERS = {
  google: {
    label: 'Google',
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    userinfo: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile',
    idEnv: 'GOOGLE_CLIENT_ID', secretEnv: 'GOOGLE_CLIENT_SECRET'
  },
  github: {
    label: 'GitHub',
    authorize: 'https://github.com/login/oauth/authorize',
    token: 'https://github.com/login/oauth/access_token',
    userinfo: 'https://api.github.com/user',
    scope: 'read:user',
    idEnv: 'GITHUB_CLIENT_ID', secretEnv: 'GITHUB_CLIENT_SECRET'
  }
};

function providersAvailable() {
  if (!process.env.AUTH_SECRET) return [];
  const out = Object.keys(PROVIDERS).filter(k =>
    process.env[PROVIDERS[k].idEnv] && process.env[PROVIDERS[k].secretEnv]);
  // Dev-only provider: instant fake session for local work and integration
  // tests. Never enabled unless the environment explicitly opts in.
  if (process.env.BB_DEV_LOGIN === '1') out.push('dev');
  return out;
}

/* Mirrors api/store.js — the client shows sign-in only when signing in
 * would actually persist anything. */
function storageConfigured() {
  return !!((process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) ||
    (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ||
    process.env.BB_KV_FILE);
}

const H = require('./_http.js');
const origin = H.origin, sendJSON = H.sendJSON;
const readBody = req => H.readBody(req, { emptyOk: true });
const redirectUri = req => origin(req) + '/api/auth';

function redirect(res, to, cookies) {
  res.statusCode = 302;
  res.setHeader('Cache-Control', 'no-store');
  if (cookies && cookies.length) res.setHeader('Set-Cookie', cookies);
  res.setHeader('Location', to);
  res.end();
}

/* Email + password over POST. Both actions mint the same stateless session
 * an OAuth login does, so downstream (billing, store, gating) can't tell a
 * password account from a federated one. Errors are stable machine codes the
 * client maps to copy; login never reveals whether an address is registered. */
const PASSWORD_ERROR_STATUS = {
  email_taken: 409, too_many_attempts: 429, storage_unconfigured: 503,
  invalid_email: 400, weak_password: 400, invalid_password: 400,
  invalid_credentials: 401, unknown_action: 400, bad_request: 400
};
const EXPECTED_PASSWORD_ERROR = new Set(['email_taken', 'too_many_attempts', 'invalid_email', 'weak_password', 'invalid_password', 'invalid_credentials', 'unknown_action', 'bad_request']);

/* Account deletion (POST {action:'delete', password?}). App Store guideline
 * 5.1.1(v) requires in-app deletion wherever accounts can be created, and
 * it's the right thing to offer everywhere. The KV client has no scan, so
 * the wipe enumerates every root an account can own: client documents
 * through the projects index, credits/ledger/balance, entitlement usage
 * over a trailing window, issued blueprints through the designs index
 * (each design record lists its bphash entries and artifact), and finally
 * the credential record. Sessions are stateless, so an already-copied
 * cookie stays verifiable until it expires — with the credential record
 * and every document gone it authenticates an empty, unrecoverable account. */
const USAGE_WIPE_MONTHS = 36;

/* Every STATIC per-account document root — client docs (the /api/store
 * namespace the app writes) plus the server-side reserved roots. Dynamic
 * names (project:{id}, thumb:{id}, design:{id}, bphash:{hash},
 * artifact:{hash}, usage:*:{month}) are enumerated from their indexes and
 * the month window in wipeAccount. test/server.test.js greps the client
 * source for doc-name literals and fails if one is missing here, so a new
 * client document can never silently survive account deletion. */
const WIPE_DOCS = [
  'projects:index', 'prices:v1', 'prefs:v2', 'prefs:v1',
  'gallery:thumbs:v1', 'selftest:probe',
  'credits', 'creditbal', 'ledger', 'subscription', 'designs:index'
];

async function wipeAccount(kv, uid) {
  const pre = `bb:${uid}:`;
  const del = async doc => { try { await kv.del(pre + doc); } catch (e) { /* best effort — keep wiping */ } };
  const read = async doc => {
    try { const raw = await kv.get(pre + doc); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  };

  const projects = await read('projects:index');
  for (const row of (Array.isArray(projects) ? projects : []).slice(0, 1000)) {
    if (!row || !row.id) continue;
    await del('project:' + row.id);
    await del('thumb:' + row.id);
  }

  const designs = await read('designs:index');
  for (const row of (Array.isArray(designs) ? designs : []).slice(0, 1000)) {
    if (!row || !row.id) continue;
    const design = await read('design:' + row.id);
    const hashes = design && Array.isArray(design.specHashes) ? design.specHashes : [];
    for (const h of hashes.slice(0, 1000)) await del('bphash:' + h);
    if (design && design.artifactHash) await del('artifact:' + design.artifactHash);
    await del('design:' + row.id);
  }

  for (const doc of WIPE_DOCS) await del(doc);

  const now = new Date();
  for (let i = 0; i < USAGE_WIPE_MONTHS; i++) {
    const m = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7);
    await del('usage:ai:' + m);
    await del('usage:tokens:' + m);
  }

  if (uid.startsWith('email:')) {
    try { await kv.del('bb:cred:' + uid.slice('email:'.length)); } catch (e) { /* best effort */ }
  }
}

async function handleDelete(req, res, body) {
  let sess = S.sessionFrom(req);
  if (sess && sess.p === 'admin') {
    // Rotation is revocation (api/_admin.js): a stale fingerprint reads as
    // signed out. A LIVE admin is env vars, not data — nothing to delete.
    if (!Admin.isAdmin(sess)) sess = null;
    else return sendJSON(res, 400, { error: 'admin_account' });
  }
  if (!sess || !sess.uid) return sendJSON(res, 401, { error: 'signed_out' });
  const kv = KV.backend();
  if (!kv) return sendJSON(res, 503, { error: 'storage_unconfigured' });
  // Password accounts confirm with their password, sharing login's generic
  // error code (no oracle). OAuth accounts have no password — the HttpOnly
  // session is the proof of control.
  if (sess.uid.startsWith('email:')) {
    try {
      const raw = await kv.get('bb:cred:' + sess.uid.slice('email:'.length));
      if (raw) {
        const record = JSON.parse(raw);
        await P.login({ email: record.email, password: String((body && body.password) || '') },
          { ip: Credits.clientIp(req) });
      }
    } catch (e) {
      const code = (e && e.code) || 'invalid_credentials';
      return sendJSON(res, PASSWORD_ERROR_STATUS[code] || 401,
        { error: EXPECTED_PASSWORD_ERROR.has(code) ? code : 'invalid_credentials' });
    }
  }
  try { await wipeAccount(kv, sess.uid); }
  catch (e) {
    Log.report('auth', 'account_delete_failed', e);
    return sendJSON(res, 500, { error: 'delete_failed' });
  }
  return sendJSON(res, 200, { ok: true }, [S.clearSessionCookie(req)]);
}

async function handlePassword(req, res) {
  let body;
  try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: 'bad_request' }); }
  const action = body && body.action;
  if (action === 'delete') return handleDelete(req, res, body);
  if (!P.available() && !Admin.available()) return sendJSON(res, 404, { error: 'password auth not configured' });
  const fail = code => Object.assign(new Error(code), { code });
  try {
    let user = null;
    /* Env-configured admin login (api/_admin.js) rides the SAME form POST: the
     * shared sign-in form sends the identifier as `email` (a bare `username`
     * field is honored too). A non-match falls through to the ordinary account
     * path without a hint, so probing can't tell admin from a wrong password.
     * Failed attempts feed the in-memory throttle here AND (via the fall-
     * through) _passwords.js's durable per-IP throttle when KV exists. */
    if (action === 'login' && Admin.available()) {
      const ip = Credits.clientIp(req);
      const identifier = body.email !== undefined ? body.email : body.username;
      /* Only admin-SHAPED attempts (the admin username, or any login when no
       * ordinary accounts exist) feed or hit the in-memory admin throttle.
       * An ordinary login — successful or not — must never count as an admin
       * failure: ten coworkers signing in behind one office NAT would lock
       * the eleventh out with correct credentials. Ordinary-account brute
       * force is _passwords.js's durable per-IP throttle's job. */
      if (Admin.matchesUser(identifier) || !P.available()) {
        if (Admin.throttled(ip)) throw fail('too_many_attempts');
        if (Admin.matches(identifier, body.password)) {
          Admin.clearFailures(ip);
          user = Admin.sessionUser();
        } else {
          Admin.noteFailure(ip);
          if (!P.available()) throw fail('invalid_credentials');
        }
      }
    }
    if (!user) {
      if (action === 'register') user = await P.register(body);
      else if (action === 'login') user = await P.login(body, { ip: Credits.clientIp(req) });
      else throw fail('unknown_action');
    }
    const shape = { name: user.name, provider: user.provider, avatar: null };
    if (user.provider === 'admin') shape.admin = true;
    return sendJSON(res, 200, { ok: true, user: shape }, [S.sessionCookieFor(user, req)]);
  } catch (e) {
    const code = (e && e.code) || 'auth_failed';
    if (!EXPECTED_PASSWORD_ERROR.has(code)) Log.report('auth', 'password_' + (action || 'unknown') + '_failed', e);
    return sendJSON(res, PASSWORD_ERROR_STATUS[code] || 400, { error: code });
  }
}

async function exchangeCode(providerKey, code, req) {
  const p = PROVIDERS[providerKey];
  const form = new URLSearchParams({
    code,
    client_id: process.env[p.idEnv],
    client_secret: process.env[p.secretEnv],
    redirect_uri: redirectUri(req),
    grant_type: 'authorization_code'
  });
  const tokenRes = await fetch(p.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form.toString()
  });
  const tok = await tokenRes.json();
  if (!tok || !tok.access_token) throw new Error('token exchange failed');
  const uiRes = await fetch(p.userinfo, {
    headers: {
      Authorization: 'Bearer ' + tok.access_token,
      Accept: 'application/json',
      'User-Agent': 'blueprint-buddy' // GitHub rejects UA-less requests
    }
  });
  const ui = await uiRes.json();
  if (providerKey === 'google') {
    if (!ui || !ui.sub) throw new Error('userinfo failed');
    return { uid: 'google:' + ui.sub, name: ui.name || ui.email || 'Google user', avatar: ui.picture, provider: 'google' };
  }
  if (!ui || !ui.id) throw new Error('userinfo failed');
  return { uid: 'github:' + ui.id, name: ui.name || ui.login || 'GitHub user', avatar: ui.avatar_url, provider: 'github' };
}

module.exports = async function handler(req, res) {
  if (req.method === 'POST') return handlePassword(req, res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    return sendJSON(res, 405, { error: 'GET or POST only' });
  }
  const url = new URL(req.url, 'http://localhost');
  const q = url.searchParams;
  const secret = process.env.AUTH_SECRET;

  // Status probe — the ONE call the client always makes. Never errors.
  if (q.get('me')) {
    let sess = S.sessionFrom(req);
    // Rotation is revocation: an admin session minted under OLD credentials
    // carries a stale key fingerprint and reads as signed out (api/_admin.js).
    if (sess && sess.p === 'admin' && !Admin.isAdmin(sess)) sess = null;
    const admin = Admin.isAdmin(sess);
    let billing = null;
    if (sess) {
      try { billing = await E.statusFor(sess.uid, req, admin ? { admin: true } : undefined); } catch (error) { Log.report('auth', 'billing_lookup_failed', error); billing = null; }
    }
    let user = null;
    if (sess) {
      user = { name: sess.name, provider: sess.p, avatar: sess.av || null };
      if (admin) user.admin = true;
    }
    return sendJSON(res, 200, {
      user,
      providers: providersAvailable(),
      passwordAuth: P.available() || Admin.available(),
      storage: storageConfigured(),
      billing
    });
  }

  if (q.get('logout')) {
    return redirect(res, '/', [S.clearSessionCookie(req)]);
  }

  // Start a login: random state in a short-lived signed cookie, then out.
  const want = q.get('provider');
  if (want) {
    if (!providersAvailable().includes(want)) return sendJSON(res, 404, { error: 'provider not configured' });
    if (want === 'dev') {
      const cookieStr = S.sessionCookieFor({ uid: 'dev:local', name: 'Local Dev', provider: 'dev' }, req);
      return redirect(res, '/', [cookieStr]);
    }
    const p = PROVIDERS[want];
    const state = crypto.randomBytes(16).toString('hex');
    const stateCookie = S.cookie(S.STATE_COOKIE,
      S.sign({ p: want, s: state, exp: Math.floor(Date.now() / 1000) + 600 }, secret),
      { secure: S.isSecure(req), maxAge: 600 });
    const auth = new URL(p.authorize);
    auth.searchParams.set('client_id', process.env[p.idEnv]);
    auth.searchParams.set('redirect_uri', redirectUri(req));
    auth.searchParams.set('response_type', 'code');
    auth.searchParams.set('scope', p.scope);
    auth.searchParams.set('state', state);
    return redirect(res, auth.toString(), [stateCookie]);
  }

  // OAuth callback.
  if (q.get('code')) {
    const clearState = S.cookie(S.STATE_COOKIE, '', { secure: S.isSecure(req), maxAge: 0 });
    try {
      const cookies = S.parseCookies(req);
      const st = S.verify(cookies[S.STATE_COOKIE], secret);
      if (!st || !st.p || st.s !== q.get('state')) throw new Error('state mismatch');
      const user = await exchangeCode(st.p, q.get('code'), req);
      return redirect(res, '/', [S.sessionCookieFor(user, req), clearState]);
    } catch (e) {
      Log.report('auth', 'oauth_callback_failed', e);
      return redirect(res, '/?login=failed', [clearState]);
    }
  }

  return sendJSON(res, 400, { error: 'unknown auth request' });
};

// Exposed for test/server.test.js: the deletion coverage guard greps the
// client source and asserts every static doc root is in this list.
module.exports.WIPE_DOCS = WIPE_DOCS;
