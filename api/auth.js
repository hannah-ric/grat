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
const Credits = require('./_credits.js');
const Env = require('./_env-check.js');
const Log = require('./_log.js');

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

function origin(req) {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN.replace(/\/$/, '');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  return (S.isSecure(req) ? 'https' : 'http') + '://' + host;
}
const redirectUri = req => origin(req) + '/api/auth';

function sendJSON(res, status, obj, cookies) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  if (cookies && cookies.length) res.setHeader('Set-Cookie', cookies);
  res.end(JSON.stringify(obj));
}
function redirect(res, to, cookies) {
  res.statusCode = 302;
  res.setHeader('Cache-Control', 'no-store');
  if (cookies && cookies.length) res.setHeader('Set-Cookie', cookies);
  res.setHeader('Location', to);
  res.end();
}

/* Mirrors the readBody in api/store.js / api/billing.js: prefer a body the
 * platform already parsed, else read the stream with a small size cap. */
function readBody(req) {
  if (req.body !== undefined) {
    return Promise.resolve(typeof req.body === 'string' ? JSON.parse(req.body) : req.body);
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > 16384) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(new Error('invalid JSON')); } });
    req.on('error', reject);
  });
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

async function handlePassword(req, res) {
  if (!P.available()) return sendJSON(res, 404, { error: 'password auth not configured' });
  let body;
  try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: 'bad_request' }); }
  const action = body && body.action;
  try {
    let user;
    if (action === 'register') user = await P.register(body);
    else if (action === 'login') user = await P.login(body, { ip: Credits.clientIp(req) });
    else throw Object.assign(new Error('unknown_action'), { code: 'unknown_action' });
    return sendJSON(res, 200, { ok: true, user: { name: user.name, provider: user.provider, avatar: null } }, [S.sessionCookieFor(user, req)]);
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
    const sess = S.sessionFrom(req);
    let billing = null;
    if (sess) {
      try { billing = await E.statusFor(sess.uid, req); } catch (error) { Log.report('auth', 'billing_lookup_failed', error); billing = null; }
    }
    return sendJSON(res, 200, {
      user: sess ? { name: sess.name, provider: sess.p, avatar: sess.av || null } : null,
      providers: providersAvailable(),
      passwordAuth: P.available(),
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
