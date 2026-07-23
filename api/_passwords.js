/* Blueprint Buddy — email + password accounts (zero-dependency).
 *
 * The one sign-in method that needs no external provider: it runs on the
 * session secret (AUTH_SECRET) and the KV store the app already has, so a
 * fresh deployment can open its front door without registering any OAuth
 * app. api/auth.js mounts register/login over POST and mints the SAME
 * stateless HMAC session (api/_session.js) an OAuth login would — a
 * password account is a first-class account, not a lesser tier.
 *
 * Passwords are hashed with scrypt (node:crypto only — no bcrypt/argon
 * dependency): a random 16-byte salt per user, verified in constant time.
 * The stored form is `scrypt$<saltHex>$<hashHex>` so the parameters travel
 * with the hash and can be upgraded later without a migration.
 *
 * KV layout — credential records live OUTSIDE every per-uid keyspace, like
 * bb:leads and bb:ipgrant:* (api/store.js namespaces user documents as
 * bb:{uid}:{doc}), so a signed-in user can NEVER read or overwrite a
 * credential — not even their own hash — through the document store:
 *
 *   bb:cred:{emailHash}   { v, email, name, hash, createdAt }
 *   bb:authrate:{ipHash}  integer, TTL'd — failed-login throttle per client IP
 *
 * The uid is derived from the email (uid = "email:" + emailHash), so the
 * same address is always the same account and the credit ledger's one free
 * signup grant lands exactly once per address.
 *
 * Files starting with "_" are libraries, not deployed Vercel functions.
 */
'use strict';

const crypto = require('crypto');
const KV = require('./_kv.js');

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;
const MAX_EMAIL = 254;
const SCRYPT_KEYLEN = 64;
// N=16384,r=8,p=1 ≈ 16 MB of work — comfortably under node's 32 MB scrypt
// default while staying expensive enough to blunt offline cracking.
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

// Brute-force throttle: failed logins per client IP before a short cooldown.
const LOGIN_FAIL_CAP = 10;
const LOGIN_FAIL_WINDOW = 15 * 60; // seconds

const err = code => { const e = new Error(code); e.code = code; return e; };

const normalizeEmail = email => String(email || '').trim().toLowerCase();
const validEmail = email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= MAX_EMAIL;

const emailHash = email => crypto.createHash('sha256').update('bb-user:' + normalizeEmail(email)).digest('hex').slice(0, 32);
const credKey = email => 'bb:cred:' + emailHash(email);
const uidFor = email => 'email:' + emailHash(email);
const rateKey = ip => 'bb:authrate:' + crypto.createHash('sha256').update('bb-authrate:' + ip).digest('hex').slice(0, 24);

/* Available whenever sessions AND a store both exist — the only two things
 * password auth needs. Mirrors api/auth.js storageConfigured(). */
function available() {
  return !!(process.env.AUTH_SECRET && KV.configured());
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN, SCRYPT);
  return 'scrypt$' + salt.toString('hex') + '$' + dk.toString('hex');
}

function verifyPassword(password, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    if (!salt.length || !expected.length) return false;
    const dk = crypto.scryptSync(String(password), salt, expected.length, SCRYPT);
    return dk.length === expected.length && crypto.timingSafeEqual(dk, expected);
  } catch (e) { return false; }
}

async function readRecord(kv, email) {
  const raw = await kv.get(credKey(email));
  if (!raw) return null;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return null; }
}

/* Best-effort per-IP failed-login throttle. Fails OPEN: a KV hiccup must
 * never lock a legitimate user out (a login attempt is not a write path). */
async function loginBlocked(kv, ip) {
  if (!ip || !kv || !kv.get) return false;
  try { return Number(await kv.get(rateKey(ip))) >= LOGIN_FAIL_CAP; } catch (e) { return false; }
}
async function noteLoginFailure(kv, ip) {
  if (!ip || !kv || !kv.incr) return;
  try {
    const n = Number(await kv.incr(rateKey(ip)));
    if (n === 1 && kv.expire) await kv.expire(rateKey(ip), LOGIN_FAIL_WINDOW);
  } catch (e) { /* throttle is best-effort */ }
}
async function clearLoginFailures(kv, ip) {
  if (!ip || !kv || !kv.del) return;
  try { await kv.del(rateKey(ip)); } catch (e) { /* best-effort */ }
}

/* Create an account. Atomic against a concurrent duplicate signup via SET NX
 * (same claim primitive api/_credits.js uses) — two racing registrations for
 * one address can never both win. Returns the user shape api/_session.js wants. */
async function register(input) {
  input = input || {};
  const kv = KV.backend();
  if (!kv) throw err('storage_unconfigured');
  const email = normalizeEmail(input.email);
  const password = String(input.password || '');
  if (!validEmail(email)) throw err('invalid_email');
  if (password.length < MIN_PASSWORD) throw err('weak_password');
  if (password.length > MAX_PASSWORD) throw err('invalid_password');
  const name = String(input.name || '').trim().slice(0, 80) || email.split('@')[0];
  const record = { v: 1, email, name, hash: hashPassword(password), createdAt: Date.now() };
  if (kv.setnx) {
    const won = await kv.setnx(credKey(email), JSON.stringify(record));
    if (!won) throw err('email_taken');
  } else {
    if (await readRecord(kv, email)) throw err('email_taken');
    await kv.set(credKey(email), JSON.stringify(record));
  }
  return { uid: uidFor(email), name: record.name, provider: 'password' };
}

/* Verify a login. The throttle is checked first and cleared on success;
 * every wrong password (missing account included) reports the SAME generic
 * error so the endpoint never reveals which addresses are registered. */
async function login(input, ctx) {
  input = input || {};
  const kv = KV.backend();
  if (!kv) throw err('storage_unconfigured');
  const ip = ctx && ctx.ip ? String(ctx.ip) : null;
  if (await loginBlocked(kv, ip)) throw err('too_many_attempts');
  const email = normalizeEmail(input.email);
  const record = validEmail(email) ? await readRecord(kv, email) : null;
  if (!record || !verifyPassword(input.password, record.hash)) {
    await noteLoginFailure(kv, ip);
    throw err('invalid_credentials');
  }
  await clearLoginFailures(kv, ip);
  return { uid: uidFor(email), name: record.name, provider: 'password' };
}

module.exports = {
  MIN_PASSWORD, available, register, login, uidFor,
  // exported for tests
  hashPassword, verifyPassword, validEmail, normalizeEmail
};
