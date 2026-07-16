/* Blueprint Buddy — accounts (optional, zero-dependency).
 *
 * One serverless function owns the whole login lifecycle over standard
 * OAuth 2.0 authorization-code flows — no auth SDK, no client-side vendor
 * script (the app must stay a self-contained single file):
 *
 *   GET /api/auth?me=1               -> { user, providers, storage } (never errors)
 *   GET /api/auth?provider=google    -> 302 to Google sign-in
 *   GET /api/auth?provider=github    -> 302 to GitHub sign-in
 *   GET /api/auth?code=…&state=…     -> OAuth callback: sets the session cookie
 *   GET /api/auth?logout=1           -> clears the cookie
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
const Env = require('./_env-check.js');

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
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJSON(res, 405, { error: 'GET only' });
  }
  const url = new URL(req.url, 'http://localhost');
  const q = url.searchParams;
  const secret = process.env.AUTH_SECRET;

  // Status probe — the ONE call the client always makes. Never errors.
  if (q.get('me')) {
    const sess = S.sessionFrom(req);
    let billing = null;
    if (sess) {
      try { billing = await E.statusFor(sess.uid); } catch (error) { billing = null; }
    }
    return sendJSON(res, 200, {
      user: sess ? { name: sess.name, provider: sess.p, avatar: sess.av || null } : null,
      providers: providersAvailable(),
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
      return redirect(res, '/?login=failed', [clearState]);
    }
  }

  return sendJSON(res, 400, { error: 'unknown auth request' });
};
