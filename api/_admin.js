/* Blueprint Buddy — the operator's admin login (zero-dependency).
 *
 * ONE admin account, configured entirely through environment variables so the
 * credentials can be created, rotated, or revoked WITHOUT touching code:
 *
 *   BB_ADMIN_USER              the admin username (any string — not an email)
 *   BB_ADMIN_PASSWORD          the password in plaintext (8+ chars), OR
 *   BB_ADMIN_PASSWORD_SCRYPT   a scrypt hash instead of plaintext — the same
 *                              `scrypt$<salt>$<hash>` format api/_passwords.js
 *                              stores. Generate one with:
 *                              node -e "console.log(require('./api/_passwords.js').hashPassword('the password'))"
 *
 * Anyone who presents BOTH the username and the password through the normal
 * sign-in form is signed in as the admin: no AI message ceiling, no token
 * budget, no project cap, and blueprints issue without spending credits. The
 * founding rule is untouched — admin changes WHO pays, never what the
 * engineering pipeline computes.
 *
 * Rotation is revocation: the session cookie carries a fingerprint (`ak`) of
 * the credentials it was minted under, and isAdmin() re-derives the current
 * fingerprint per request. Changing either env var (a dashboard edit — no
 * deploy of code) immediately demotes every outstanding admin session; the
 * status probe then reports such a session as signed out.
 *
 * Needs only AUTH_SECRET besides its own two vars — no KV store, no OAuth
 * app — so a single-operator deployment can open an unrestricted front door
 * with three env vars. Brute force is blunted by a per-IP in-memory failure
 * throttle here (same spirit as api/chat.js's burst guard) AND, when the KV
 * store exists, by api/_passwords.js's durable throttle that every failed
 * form login also feeds.
 *
 * Files starting with "_" are libraries, not deployed Vercel functions.
 */
'use strict';

const crypto = require('crypto');
const P = require('./_passwords.js');

const MIN_PASSWORD = 8;
// Mirrors api/_passwords.js LOGIN_FAIL_CAP/WINDOW: failed admin-capable login
// attempts per client IP before a cooldown. In-memory, per instance —
// best-effort like the chat burst guard, durable throttling rides _passwords.
const FAIL_CAP = 10;
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const failures = new Map();

const normUser = value => String(value || '').trim().toLowerCase();

/* Timing-safe string equality over hashes, so length never leaks. */
function tsEq(a, b) {
  const A = crypto.createHash('sha256').update('bb-admin-eq:' + String(a)).digest();
  const B = crypto.createHash('sha256').update('bb-admin-eq:' + String(b)).digest();
  return crypto.timingSafeEqual(A, B);
}

/* The current password material — the hash when configured, else plaintext.
 * Feeds the fingerprint, so rotating EITHER form rolls every admin session. */
function passwordSource() {
  return process.env.BB_ADMIN_PASSWORD_SCRYPT || process.env.BB_ADMIN_PASSWORD || '';
}

function available() {
  if (!process.env.AUTH_SECRET || !normUser(process.env.BB_ADMIN_USER)) return false;
  const hashed = process.env.BB_ADMIN_PASSWORD_SCRYPT;
  if (hashed) return /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/i.test(hashed);
  return String(process.env.BB_ADMIN_PASSWORD || '').length >= MIN_PASSWORD;
}

/* Does the presented identifier name the admin account? Timing-safe, no
 * response ever differs on it — used by auth.js to scope the failure
 * throttle to admin-shaped attempts only. */
function matchesUser(identifier) {
  if (!available()) return false;
  return tsEq('u:' + normUser(identifier), 'u:' + normUser(process.env.BB_ADMIN_USER));
}

function matches(identifier, password) {
  if (!available()) return false;
  const userOK = tsEq('u:' + normUser(identifier), 'u:' + normUser(process.env.BB_ADMIN_USER));
  const hashed = process.env.BB_ADMIN_PASSWORD_SCRYPT;
  const passOK = hashed
    ? P.verifyPassword(String(password || ''), hashed)
    : tsEq('p:' + String(password || ''), 'p:' + String(process.env.BB_ADMIN_PASSWORD || ''));
  return userOK && passOK;
}

/* Fingerprint of the CURRENT credentials, carried in the session as `ak`. */
function fingerprint() {
  return crypto.createHash('sha256')
    .update('bb-admin-key:' + normUser(process.env.BB_ADMIN_USER) + ':' + passwordSource())
    .digest('hex').slice(0, 16);
}

/* The user shape api/_session.js signs. The uid hashes the username (key-safe
 * in the bb:{uid}:* KV namespace, unmintable by any other login path — OAuth
 * uids are google:/github:, password uids email:, dev is dev:local). */
function sessionUser() {
  return {
    uid: 'admin:' + crypto.createHash('sha256').update('bb-admin-uid:' + normUser(process.env.BB_ADMIN_USER)).digest('hex').slice(0, 16),
    name: String(process.env.BB_ADMIN_USER || 'Admin').trim().slice(0, 80),
    provider: 'admin',
    ak: fingerprint()
  };
}

/* Is this verified session the admin, under the credentials AS THEY STAND?
 * A stale fingerprint (rotated credentials) is an ordinary session at best,
 * never an admin one. */
function isAdmin(sess) {
  if (!sess || sess.p !== 'admin' || typeof sess.ak !== 'string') return false;
  if (!available()) return false;
  return tsEq(sess.ak, fingerprint());
}

/* ---- per-IP failure throttle (in-memory, best-effort) ---- */
function throttled(ip) {
  if (!ip) return false;
  const now = Date.now();
  const hits = (failures.get(ip) || []).filter(t => now - t < FAIL_WINDOW_MS);
  failures.set(ip, hits);
  return hits.length >= FAIL_CAP;
}
function noteFailure(ip) {
  if (!ip) return;
  const now = Date.now();
  const hits = (failures.get(ip) || []).filter(t => now - t < FAIL_WINDOW_MS);
  hits.push(now);
  failures.set(ip, hits);
  if (failures.size > 5000) { // bound the map on a long-lived instance
    for (const [k, v] of failures) if (!v.some(t => now - t < FAIL_WINDOW_MS)) failures.delete(k);
  }
}
function clearFailures(ip) {
  if (ip) failures.delete(ip);
}

module.exports = { available, matchesUser, matches, fingerprint, sessionUser, isAdmin, throttled, noteFailure, clearFailures };
