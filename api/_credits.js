/* Blueprint Buddy — the credit ledger (server-only authority, zero-dependency).
 *
 * A credit buys a DESIGN, not a generation: it is charged at first plan
 * issuance (api/blueprint.js), the design stays open for unlimited refinement
 * for WINDOW_DAYS from commit, and re-downloads are free forever. Credits
 * never reset monthly; they expire EXPIRY_MONTHS after purchase. The free
 * tier grants SIGNUP_CREDITS once per account, lazily on first read — capped
 * per client IP (SIGNUP_IP_CAP per SIGNUP_IP_WINDOW_DAYS) so throwaway OAuth
 * accounts can't farm it. A capped account still works: it starts at zero,
 * the denial is on its ledger, and support can grant() manually. Callers with
 * no request context (webhooks, tests) grant unconditionally.
 *
 * Files starting with "_" are libraries, not deployed Vercel functions.
 *
 * KV layout, alongside the existing bb:{uid}:* namespace (every per-uid root
 * below is reserved in api/store.js — like `subscription`/`usage`, a user must
 * never be able to write their own balance through the document store):
 *
 *   bb:{uid}:credits    { v:1, grants:[{id, amount, remaining, reason, sourceId,
 *                         ts, expiresAt}] }          — grant bookkeeping (FIFO,
 *                                                      expiry, purchase totals)
 *   bb:{uid}:creditbal  integer                      — the ATOMIC balance
 *                         authority, adjusted only with INCRBY; seeded from the
 *                         doc via SETNX when absent (DEL the key to repair any
 *                         drift — the next read re-seeds it here)
 *   bb:{uid}:ledger     [{ts, type:'grant'|'charge'|'refund'|'expire'|'deny',
 *                         amount, balanceAfter, reason, sourceId?, grantId?,
 *                         specHash?, blueprintId?}]  — append-only audit log
 *   bb:ipgrant:{hash}   integer, TTL'd               — signup grants per client
 *                         IP; lives OUTSIDE every per-uid keyspace (like
 *                         bb:leads) so /api/store can never reach it
 *
 * Every charge is auditable and reversible: charges carry the corrected-spec
 * hash and blueprint id, refunds point back at the grant they restore, and
 * expiry is written down rather than silently vanishing. Grants spend FIFO
 * (oldest unexpired first) so purchased packs age out honestly.
 *
 * Concurrency: the KV REST backend has no transactions, so the grants doc
 * alone cannot stop a truly concurrent two-device charge from double-spending
 * one credit. The spend gate is therefore the creditbal counter: charge()
 * RESERVES by decrementing first and refuses on a negative result (releasing
 * the reservation), so two racing charges can never both take the last
 * credit. Balances reported to callers always come from the counter; the doc
 * keeps attribution and can lag under a race (last write wins) without ever
 * weakening the gate. The signup mint is atomic the same way: the doc is
 * created with SET NX, so two racing first reads can never both grant.
 */
'use strict';

const crypto = require('crypto');
const KV = require('./_kv.js');

const WINDOW_DAYS = 30;          // refinement window per committed design
const EXPIRY_MONTHS = 12;        // credits expire 12 months after purchase
const SIGNUP_CREDITS = 1;        // the free tier's one credit at signup
const SIGNUP_IP_CAP = 5;         // signup grants per client IP per window
const SIGNUP_IP_WINDOW_DAYS = 7; // the rolling window behind that cap
const MONTH_MS = 30.4375 * 86400e3;

const creditsKey = uid => `bb:${uid}:credits`;
const ledgerKey = uid => `bb:${uid}:ledger`;
const balKey = uid => `bb:${uid}:creditbal`;
const ipGrantKey = ip => 'bb:ipgrant:' + crypto.createHash('sha256').update('bb-signup:' + ip).digest('hex').slice(0, 24);

const newGrantId = () => 'g_' + crypto.randomBytes(8).toString('hex');

/* The client IP for the signup cap. Mirrors api/chat.js anonMeterId (E-03):
 * X-Forwarded-For is client-forgeable, so trust only x-real-ip (set by Vercel
 * to the verified client IP) or the direct socket. Returns null when unknown —
 * the cap then stands down rather than bucketing everyone as one fake IP.
 * Deployment note: behind a non-Vercel proxy that does not set x-real-ip the
 * socket is the proxy, which would pool ALL users into one cap bucket — set
 * x-real-ip at the edge before fronting this with anything but Vercel. */
function clientIp(req) {
  if (!req) return null;
  const real = String((req.headers && req.headers['x-real-ip']) || '').trim();
  return real || (req.socket && req.socket.remoteAddress) || null;
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

/* The balance callers see and charge() enforces: the atomic counter when it
 * exists, else the doc (pre-counter docs get seeded on their first load). */
async function currentBalance(kv, uid, doc) {
  const raw = await kv.get(balKey(uid));
  if (raw !== null && raw !== undefined) return Math.max(0, Number(raw));
  return balanceOf(doc);
}

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

/* First contact for a uid: mint the credits doc atomically (SET NX — two
 * racing first reads can never both grant) and apply the per-IP signup cap
 * when the caller carried request context. */
async function mintSignup(kv, uid, now, ctx) {
  const ip = ctx && ctx.ip ? String(ctx.ip) : null;
  let capped = false;
  if (ip) {
    const key = ipGrantKey(ip);
    const n = Number(await kv.incr(key));
    if (n === 1 && kv.expire) await kv.expire(key, SIGNUP_IP_WINDOW_DAYS * 86400);
    capped = n > SIGNUP_IP_CAP;
  }
  const g = capped ? null : { id: newGrantId(), amount: SIGNUP_CREDITS, remaining: SIGNUP_CREDITS, reason: 'signup', sourceId: 'signup:' + uid, ts: now, expiresAt: null };
  const doc = { v: 1, grants: g ? [g] : [] };
  const won = kv.setnx ? await kv.setnx(creditsKey(uid), JSON.stringify(doc)) : 'OK';
  if (!won) {
    // Lost to a concurrent first read: hand back our IP slot, use the winner's doc.
    if (ip && kv.incrby) await kv.incrby(ipGrantKey(ip), -1);
    return (await readDoc(kv, uid)) || { v: 1, grants: [] };
  }
  if (!kv.setnx) await writeDoc(kv, uid, doc); // injected backends without setnx
  if (g) {
    if (kv.incrby) await kv.incrby(balKey(uid), SIGNUP_CREDITS);
    await appendLedger(kv, uid, [{ ts: now, type: 'grant', amount: SIGNUP_CREDITS, balanceAfter: SIGNUP_CREDITS, reason: 'signup', sourceId: g.sourceId, grantId: g.id }]);
  } else {
    // The refusal is written down, never silent (support can grant manually).
    await appendLedger(kv, uid, [{ ts: now, type: 'deny', amount: 0, balanceAfter: 0, reason: 'signup_ip_capped', sourceId: 'signup:' + uid }]);
  }
  return doc;
}

/* Load (or mint) the doc and apply expiry. Single entry point for every
 * operation so the signup grant can never be dodged or doubled. ctx carries
 * optional request context ({ip}) for the signup cap. */
async function loadFor(kv, uid, now, ctx) {
  let doc = await readDoc(kv, uid);
  if (!doc) doc = await mintSignup(kv, uid, now, ctx);
  const expiries = applyExpiry(doc, now);
  if (expiries.length) {
    const bal = balanceOf(doc);
    expiries.forEach(e => { e.balanceAfter = bal; });
    await writeDoc(kv, uid, doc);
    await appendLedger(kv, uid, expiries);
  }
  // Keep the spend counter honest: seed absent counters from the doc (SETNX —
  // never clobbers an in-flight reservation), age existing ones with expiry.
  if (kv.incrby && kv.setnx) {
    const counter = await kv.get(balKey(uid));
    if (counter === null || counter === undefined) {
      await kv.setnx(balKey(uid), String(balanceOf(doc)));
    } else if (expiries.length) {
      const expired = expiries.reduce((s, e) => s - e.amount, 0);
      if (expired > 0) await kv.incrby(balKey(uid), -expired);
    }
  }
  return doc;
}

/* ---------------- public surface ---------------- */

async function state(uid, ctx) {
  const kv = KV.backend();
  if (!kv || !uid) return { configured: false, balance: 0, purchased: 0 };
  const doc = await loadFor(kv, uid, Date.now(), ctx);
  return {
    configured: true,
    balance: await currentBalance(kv, uid, doc),
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
  const doc = await loadFor(kv, uid, now, opts);
  if (opts.sourceId) {
    const led = await readJSON(kv, ledgerKey(uid), []);
    if (led.some(e => e.type === 'grant' && e.sourceId === opts.sourceId)) {
      return { ok: true, deduped: true, balance: await currentBalance(kv, uid, doc) };
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
  const expired = expiries.reduce((s, e) => s - e.amount, 0);
  await writeDoc(kv, uid, doc);
  const bal = kv.incrby
    ? Math.max(0, Number(await kv.incrby(balKey(uid), n - expired)))
    : balanceOf(doc);
  await appendLedger(kv, uid, [
    { ts: now, type: 'grant', amount: n, balanceAfter: bal, reason: g.reason, sourceId: g.sourceId, grantId: g.id },
    ...expiries.map(e => Object.assign(e, { balanceAfter: bal }))
  ]);
  return { ok: true, deduped: false, balance: bal, grantId: g.id };
}

async function charge(uid, opts) {
  opts = opts || {};
  const kv = KV.backend();
  if (!kv || !uid) return { ok: false, error: 'storage_unconfigured', balance: 0 };
  const now = Date.now();
  const doc = await loadFor(kv, uid, now, opts);
  // FIFO attribution: the oldest unexpired grant with anything left pays.
  const source = doc.grants
    .filter(g => g.remaining > 0)
    .sort((a, b) => a.ts - b.ts)[0];
  if (!source) return { ok: false, error: 'insufficient_credits', balance: 0 };
  // Atomic reservation: decrement FIRST; a negative result means another
  // request holds the last credit — release the reservation and refuse.
  let bal;
  if (kv.incrby) {
    const reserved = Number(await kv.incrby(balKey(uid), -1));
    if (reserved < 0) {
      await kv.incrby(balKey(uid), 1);
      return { ok: false, error: 'insufficient_credits', balance: 0 };
    }
    bal = reserved;
  }
  source.remaining -= 1;
  if (bal === undefined) bal = balanceOf(doc);
  await writeDoc(kv, uid, doc);
  await appendLedger(kv, uid, [{
    ts: now, type: 'charge', amount: -1, balanceAfter: bal,
    reason: opts.reason || 'issue', grantId: source.id,
    specHash: opts.specHash || null, blueprintId: opts.blueprintId || null
  }]);
  return { ok: true, balance: bal, grantId: source.id };
}

async function refund(uid, opts) {
  opts = opts || {};
  const kv = KV.backend();
  if (!kv || !uid) return { ok: false, error: 'storage_unconfigured', balance: 0 };
  const now = Date.now();
  const doc = await loadFor(kv, uid, now, opts);
  const target = (opts.grantId && doc.grants.find(g => g.id === opts.grantId)) || null;
  if (target) target.remaining += 1;
  else doc.grants.push({ id: newGrantId(), amount: 1, remaining: 1, reason: 'refund', sourceId: null, ts: now, expiresAt: now + EXPIRY_MONTHS * MONTH_MS });
  await writeDoc(kv, uid, doc);
  const bal = kv.incrby
    ? Math.max(0, Number(await kv.incrby(balKey(uid), 1)))
    : balanceOf(doc);
  await appendLedger(kv, uid, [{
    ts: now, type: 'refund', amount: 1, balanceAfter: bal,
    reason: opts.reason || 'refund', grantId: opts.grantId || null,
    specHash: opts.specHash || null, blueprintId: opts.blueprintId || null
  }]);
  return { ok: true, balance: bal };
}

async function ledgerFor(uid) {
  const kv = KV.backend();
  if (!kv || !uid) return [];
  return readJSON(kv, ledgerKey(uid), []);
}

module.exports = {
  WINDOW_DAYS, EXPIRY_MONTHS, SIGNUP_CREDITS, SIGNUP_IP_CAP, SIGNUP_IP_WINDOW_DAYS,
  clientIp, state, grant, charge, refund, ledgerFor
};
