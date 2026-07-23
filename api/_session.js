/* Blueprint Buddy — stateless session helper shared by api/auth.js and
 * api/store.js. Zero dependencies (node:crypto only). Files starting with
 * "_" are NOT deployed as Vercel functions — this is a library, not an
 * endpoint.
 *
 * Sessions are HMAC-SHA256-signed cookies: base64url(JSON payload) + "." +
 * base64url(mac), keyed by AUTH_SECRET. Nothing is stored server-side, so
 * a session is valid on every instance and survives deploys; expiry rides
 * inside the signed payload. Verification is timing-safe and every parse
 * failure returns null — a bad cookie is an anonymous request, never a 500.
 */
'use strict';

const crypto = require('crypto');

const SESSION_COOKIE = 'bb_sess';
const STATE_COOKIE = 'bb_oauth';
const SESSION_DAYS = 30;

const b64u = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function sign(payload, secret) {
  const body = b64u(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', secret).update(body).digest();
  return body + '.' + b64u(mac);
}

function verify(token, secret) {
  if (!token || !secret) return null;
  const i = String(token).lastIndexOf('.');
  if (i < 1) return null;
  const body = String(token).slice(0, i);
  let mac;
  try { mac = unb64u(String(token).slice(i + 1)); } catch (e) { return null; }
  const want = crypto.createHmac('sha256', secret).update(body).digest();
  if (mac.length !== want.length || !crypto.timingSafeEqual(mac, want)) return null;
  let payload;
  try { payload = JSON.parse(unb64u(body).toString('utf8')); } catch (e) { return null; }
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return null;
  return payload;
}

function parseCookies(req) {
  const out = {};
  const raw = (req.headers && req.headers.cookie) || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/* Honest scheme detection behind Vercel's proxy: x-forwarded-proto wins;
 * plain-HTTP localhost dev gets non-Secure cookies so login works there. */
function isSecure(req) {
  const proto = String((req.headers && req.headers['x-forwarded-proto']) || '').split(',')[0].trim();
  if (proto) return proto === 'https';
  return !!(req.socket && req.socket.encrypted);
}

/* Best-effort client IP behind Vercel's proxy. x-vercel-forwarded-for is set
 * by Vercel's edge and cannot be client-supplied; the generic headers are
 * proxy-controlled on Vercel too but spoofable on a bare deployment — callers
 * must treat the result as an abuse signal, never an identity. */
function clientIP(req) {
  const h = (req && req.headers) || {};
  const pick = v => String(v || '').split(',')[0].trim();
  return pick(h['x-vercel-forwarded-for']) || pick(h['x-forwarded-for']) ||
    pick(h['x-real-ip']) || (req && req.socket && req.socket.remoteAddress) || null;
}

function cookie(name, value, opts) {
  opts = opts || {};
  const bits = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (opts.secure) bits.push('Secure');
  if (opts.maxAge !== undefined) bits.push(`Max-Age=${opts.maxAge}`);
  return bits.join('; ');
}

/* The verified session for a request, or null. */
function sessionFrom(req) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  const c = parseCookies(req);
  const s = verify(c[SESSION_COOKIE], secret);
  return s && typeof s.uid === 'string' && s.uid ? s : null;
}

function sessionCookieFor(user, req) {
  const now = Math.floor(Date.now() / 1000);
  const token = sign({
    v: 1, uid: user.uid, name: String(user.name || '').slice(0, 80),
    p: user.provider, av: user.avatar ? String(user.avatar).slice(0, 300) : undefined,
    iat: now, exp: now + SESSION_DAYS * 86400
  }, process.env.AUTH_SECRET);
  return cookie(SESSION_COOKIE, token, { secure: isSecure(req), maxAge: SESSION_DAYS * 86400 });
}

const clearSessionCookie = req => cookie(SESSION_COOKIE, '', { secure: isSecure(req), maxAge: 0 });

module.exports = {
  SESSION_COOKIE, STATE_COOKIE, SESSION_DAYS,
  sign, verify, parseCookies, isSecure, clientIP, cookie,
  sessionFrom, sessionCookieFor, clearSessionCookie, b64u, unb64u
};
