/* Blueprint Buddy — the credit ledger (server-only authority, zero-dependency).
 *
 * A credit buys a DESIGN, not a generation: it is charged at first plan
 * issuance (api/blueprint.js), the design stays open for unlimited refinement
 * for WINDOW_DAYS from commit, and re-downloads are free forever. Credits
 * never reset monthly; they expire EXPIRY_MONTHS after purchase. The free
 * tier grants SIGNUP_CREDITS once per account, lazily on first read.
 *
 * Files starting with "_" are libraries, not deployed Vercel functions.
 *
 * KV layout, alongside the existing bb:{uid}:* namespace (every root below is
 * reserved in api/store.js — like `subscription`/`usage`, a user must never be
 * able to write their own balance through the document store):
 *
 *   bb:{uid}:credits  { v:1, grants:[{id, amount, remaining, reason, sourceId,
 *                       ts, expiresAt}] }            — working state
 *   bb:{uid}:ledger   [{ts, type:'grant'|'charge'|'refund'|'expire', amount,
 *                       balanceAfter, reason, sourceId?, grantId?, specHash?,
 *                       blueprintId?}]               — append-only audit log
 *   bb:{uid}:creditlock                              — mutex (SET NX EX, 10 s TTL)
 *   bb:ipgrant:{hash}                                — signup-cap counter (30-day TTL;
 *                       outside every per-uid keyspace, unreachable via /api/store)
 *
 * Every charge is auditable and reversible: charges carry the corrected-spec
 * hash and blueprint id, refunds point back at the grant they restore, and
 * expiry is written down rather than silently vanishing. Grants spend FIFO
 * (oldest unexpired first) so purchased packs age out honestly.
 *
 * Concurrency: the KV REST backend has no transactions, so every mutating
 * operation (grant/charge/refund and the lazy signup/expiry writes) serializes
 * on a per-uid mutex — SET NX EX on bb:{uid}:creditlock — closing the
 * two-device concurrent-charge double-spend on top of the spec-hash
 * idempotency in api/blueprint.js. If the lock cannot be acquired within
 * ~1 s we proceed unlocked and log it (availability over the residual race —
 * strictly no worse than the pre-lock behavior).
 *
 * Abuse: the free signup credit is capped per client IP (BB_SIGNUP_IP_CAP,
 * default 5 grants per IP per 30 days, 0 disables) so throwaway-OAuth-account
 * farming stops paying out. IPs are never stored — only a salted SHA-256
 * counter key. No IP in hand (tests, webhook-first contact) fails open to the
 * grant: the cap is an abuse damper, not an identity system.
 */
'use strict';

const crypto = require('crypto');
const KV = require('./_kv.js');
const Log = require('./_log.js');

const WINDOW_DAYS = 30;      // refinement window per committed design
const EXPIRY_MONTHS = 12;    // credits expire 12 months after purchase
const SIGNUP_CREDITS = 1;    // the free tier's one credit at signup
const MONTH_MS = 30.4375 * 86400e3;

const creditsKey = uid => `bb:${uid}:credits`;
const ledgerKey = uid => `bb:${uid}:ledger`;
const lockKey = uid => `bb:${uid}:creditlock`;

const newGrantId = () => 'g_' + crypto.randomBytes(8).toString('hex');

/* Per-uid mutex over SET NX EX. Not reentrant — take it once at the public
 * surface, never inside loadFor. Unlock is check-then-delete (not atomic
 * without server-side scripting); a mismatched delete can only follow a TTL
 * expiry, which the TTL already treats as a dead holder. */
const LOCK_TTL_S = 10, LOCK_TRIES = 25, LOCK_WAIT_MS = 40;
async function withLock(kv, uid, fn) {
  const token = crypto.randomBytes(8).toString('hex');
  let held = false;
  for (let i = 0; i < LOCK_TRIES && !held; i++) {
    if (i) await new Promise(r => setTimeout(r, LOCK_WAIT_MS));
    held = (await kv.set(lockKey(uid), token, { ex: LOCK_TTL_S, nx: true })) !== null;
  }
  if (!held) Log.report('credits', 'lock_timeout', { uid });
  try { return await fn(); }
  finally {
    if (held) {
      try { if ((await kv.get(lockKey(uid))) === token) await kv.del(lockKey(uid)); }
      catch (e) { /* TTL cleans up */ }
    }
  }
}

/* Signup-farming damper: count fresh-account grants per client IP over a
 * rolling 30 days. Atomic (INCR), privacy-preserving (salted hash, raw IP
 * never written), fail-open (any KV error grants). */
const IP_CAP_WINDOW_S = 30 * 86400;
const signupIpCap = () => {
  const raw = process.env.BB_SIGNUP_IP_CAP;
  return raw === undefined ? 5 : Math.max(0, Math.floor(Number(raw) || 0));
};
async function signupAllowedFor(kv, ip) {
  const cap = signupIpCap();
  if (!cap || !ip) return true;
  try {
    const salt = process.env.AUTH_SECRET || 'bb-signup';
    const h = crypto.createHash('sha256').update(salt + '|' + ip).digest('hex').slice(0, 24);
    const key = 'bb:ipgrant:' + h;
    const n = Number(await kv.incr(key));
    if (n === 1 && kv.expire) await kv.expire(key, IP_CAP_WINDOW_S);
    return n <= cap;
  } catch (e) { Log.report('credits', 'ip_cap_check_failed', e); return true; }
}

async function readJSON(kv, key, fallback) {
  const raw = await kv.get(key);
  if (raw === undefined || raw === null) return fallback;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return fallback; }
}

async function readDoc(kv, uid) {
  return readJSON(kv, creditsKey(uid), null);
}
async function writeDoc(kv, uid, doc) {
  await kv.set(creditsKey(uid), JSON.stringify(doc));
}
async function appendLedger(kv, uid, entries) {
  const led = await readJSON(kv, ledgerKey(uid), []);
  for (const e of entries) led.push(e);
  await kv.set(ledgerKey(uid), JSON.stringify(led));
}

const balanceOf = doc => doc.grants.reduce((sum, g) => sum + Math.max(0, g.remaining), 0);

/* Lazily write down any grants that aged past their expiry. Returns the
 * ledger entries the caller must append (expiry is never silent). */
function applyExpiry(doc, now) {
  const expired = [];
  for (const g of doc.grants) {
    if (g.remaining > 0 && g.expiresAt && g.expiresAt <= now) {
      expired.push({ ts: now, type: 'expire', amount: -g.remaining, grantId: g.id, reason: 'expired', sourceId: g.sourceId });
      g.remaining = 0;
    }
  }
  return expired;
}

/* Load (or initialize) the doc, grant the one-per-account signup credit on
 * first contact, and apply expiry. Single entry point for every operation so
 * the signup grant can never be dodged or doubled. Callers hold the uid lock
 * whenever a write is possible. */
async function loadFor(kv, uid, now, ip) {
  let doc = await readDoc(kv, uid);
  const fresh = !doc;
  if (fresh) {
    if (await signupAllowedFor(kv, ip)) {
      const g = { id: newGrantId(), amount: SIGNUP_CREDITS, remaining: SIGNUP_CREDITS, reason: 'signup', sourceId: 'signup:' + uid, ts: now, expiresAt: null };
      doc = { v: 1, grants: [g] };
      await writeDoc(kv, uid, doc);
      await appendLedger(kv, uid, [{ ts: now, type: 'grant', amount: SIGNUP_CREDITS, balanceAfter: SIGNUP_CREDITS, reason: 'signup', sourceId: g.sourceId, grantId: g.id }]);
    } else {
      // Over the per-IP cap: the account opens with an empty book, and the
      // withheld grant is written down — auditable, never silent.
      doc = { v: 1, grants: [] };
      await writeDoc(kv, uid, doc);
      await appendLedger(kv, uid, [{ ts: now, type: 'grant', amount: 0, balanceAfter: 0, reason: 'signup_ip_capped', sourceId: 'signup:' + uid, grantId: null }]);
      Log.report('credits', 'signup_ip_capped', { uid });
    }
  }
  const expiries = applyExpiry(doc, now);
  if (expiries.length) {
    const bal = balanceOf(doc);
    expiries.forEach(e => { e.balanceAfter = bal; });
    await writeDoc(kv, uid, doc);
    await appendLedger(kv, uid, expiries);
  }
  return doc;
}

/* ---------------- public surface ---------------- */

async function state(uid, opts) {
  opts = opts || {};
  const kv = KV.backend();
  if (!kv || !uid) return { configured: false, balance: 0, purchased: 0 };
  const now = Date.now();
  // Hot path (every auth?me probe): an existing doc with nothing to expire
  // needs no writes, so skip the mutex entirely.
  let doc = await readDoc(kv, uid);
  const needsWrite = !doc || doc.grants.some(g => g.remaining > 0 && g.expiresAt && g.expiresAt <= now);
  if (needsWrite) doc = await withLock(kv, uid, () => loadFor(kv, uid, now, opts.ip));
  return {
    configured: true,
    balance: balanceOf(doc),
    purchased: doc.grants.filter(g => g.reason === 'purchase').reduce((s, g) => s + g.amount, 0)
  };
}

async function grant(uid, amount, opts) {
  opts = opts || {};
  const kv = KV.backend();
  if (!kv || !uid) throw new Error('storage_unconfigured');
  const n = Math.floor(Number(amount));
  if (!(n > 0)) throw new Error('bad grant amount');
  const now = Date.now();
  return withLock(kv, uid, async () => {
    const doc = await loadFor(kv, uid, now, opts.ip);
    if (opts.sourceId) {
      const led = await readJSON(kv, ledgerKey(uid), []);
      if (led.some(e => e.type === 'grant' && e.sourceId === opts.sourceId)) {
        return { ok: true, deduped: true, balance: balanceOf(doc) };
      }
    }
    const ts = typeof opts.ts === 'number' ? opts.ts : now;
    const g = {
      id: newGrantId(), amount: n, remaining: n,
      reason: opts.reason || 'grant', sourceId: opts.sourceId || null,
      ts, expiresAt: opts.reason === 'signup' ? null : ts + EXPIRY_MONTHS * MONTH_MS
    };
    doc.grants.push(g);
    const expiries = applyExpiry(doc, now); // a back-dated grant may expire immediately
    const bal = balanceOf(doc);
    await writeDoc(kv, uid, doc);
    await appendLedger(kv, uid, [
      { ts: now, type: 'grant', amount: n, balanceAfter: bal, reason: g.reason, sourceId: g.sourceId, grantId: g.id },
      ...expiries.map(e => Object.assign(e, { balanceAfter: bal }))
    ]);
    return { ok: true, deduped: false, balance: bal, grantId: g.id };
  });
}

async function charge(uid, opts) {
  opts = opts || {};
  const kv = KV.backend();
  if (!kv || !uid) return { ok: false, error: 'storage_unconfigured', balance: 0 };
  const now = Date.now();
  return withLock(kv, uid, async () => {
    const doc = await loadFor(kv, uid, now, opts.ip);
    // FIFO: the oldest unexpired grant with anything left pays first.
    const source = doc.grants
      .filter(g => g.remaining > 0)
      .sort((a, b) => a.ts - b.ts)[0];
    if (!source) return { ok: false, error: 'insufficient_credits', balance: 0 };
    source.remaining -= 1;
    const bal = balanceOf(doc);
    await writeDoc(kv, uid, doc);
    await appendLedger(kv, uid, [{
      ts: now, type: 'charge', amount: -1, balanceAfter: bal,
      reason: opts.reason || 'issue', grantId: source.id,
      specHash: opts.specHash || null, blueprintId: opts.blueprintId || null
    }]);
    return { ok: true, balance: bal, grantId: source.id };
  });
}

async function refund(uid, opts) {
  opts = opts || {};
  const kv = KV.backend();
  if (!kv || !uid) return { ok: false, error: 'storage_unconfigured', balance: 0 };
  const now = Date.now();
  return withLock(kv, uid, async () => {
    const doc = await loadFor(kv, uid, now, opts.ip);
    const target = (opts.grantId && doc.grants.find(g => g.id === opts.grantId)) || null;
    if (target) target.remaining += 1;
    else doc.grants.push({ id: newGrantId(), amount: 1, remaining: 1, reason: 'refund', sourceId: null, ts: now, expiresAt: now + EXPIRY_MONTHS * MONTH_MS });
    const bal = balanceOf(doc);
    await writeDoc(kv, uid, doc);
    await appendLedger(kv, uid, [{
      ts: now, type: 'refund', amount: 1, balanceAfter: bal,
      reason: opts.reason || 'refund', grantId: opts.grantId || null,
      specHash: opts.specHash || null, blueprintId: opts.blueprintId || null
    }]);
    return { ok: true, balance: bal };
  });
}

async function ledgerFor(uid) {
  const kv = KV.backend();
  if (!kv || !uid) return [];
  return readJSON(kv, ledgerKey(uid), []);
}

module.exports = { WINDOW_DAYS, EXPIRY_MONTHS, SIGNUP_CREDITS, state, grant, charge, refund, ledgerFor };
