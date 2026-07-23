/* Blueprint Buddy — per-user cloud document store (optional, zero-dependency).
 *
 * The server half of the persistence driver chain: the client mirrors its
 * window.storage-shaped API (string values in, string values out) onto
 * per-user keys here. Documents are whole JSON strings — projects, the
 * project index, prices, prefs — never meshes or derived plans, exactly
 * like every other storage backend.
 *
 *   GET    /api/store?doc=NAME   -> { value: string|null }
 *   PUT    /api/store?doc=NAME   -> { ok: true }      body: { value: string }
 *   DELETE /api/store?doc=NAME   -> { ok: true }
 *
 * Auth: the signed session cookie (api/_session.js) — 401 without it.
 * Keys are namespaced "bb:{uid}:{doc}", so users can only ever touch their
 * own documents; doc names are validated against a strict charset.
 *
 * Backends, first configured wins:
 *   - Upstash Redis / Vercel KV over REST (fetch, no SDK):
 *       KV_REST_API_URL + KV_REST_API_TOKEN            (Vercel Marketplace)
 *       UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (Upstash native)
 *   - A local JSON file (BB_KV_FILE) — serve.js sets this for dev, so
 *     `npm run dev` has working cloud-style persistence with zero cloud.
 * Unconfigured -> 503, and the client quietly stays on device storage.
 */
'use strict';

const S = require('./_session.js');
const KV = require('./_kv.js');
const Log = require('./_log.js');
const E = require('./_entitlements.js');

const DOC_RE = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,79}$/;
// The store namespaces every document as bb:{uid}:{doc}. api/_entitlements.js
// uses that SAME per-uid keyspace for authoritative billing/usage records —
// bb:{uid}:subscription and bb:{uid}:usage:ai:<month> (and usage:tokens:<month>).
// A store write to one of those names would alias an entitlement key and let a
// signed-in user self-grant Pro or reset their own AI meter (E-01/E-02). The
// credits pivot adds the ledger family the same way: credits / creditbal /
// ledger / design:* / designs:index / bphash:* / artifact:* / bpimg:* are
// written ONLY by api/_credits.js and api/blueprint.js — a user must never be
// able to mint their own balance (creditbal is the atomic spend counter) or
// forge an issued blueprint through this endpoint. The per-IP signup counters
// (bb:ipgrant:*) live outside every per-uid keyspace, like bb:leads, so they
// need no entry here. We do NOT ban colons (client docs are projects:index /
// prices:v1 / prefs:v2 / project:* / thumb:*) nor rename the user keyspace —
// only these exact roots and their subkeys are off-limits, for reads, writes,
// and deletes alike.
const RESERVED_DOC = /^(subscription|usage|credits|creditbal|ledger|design|designs|bphash|artifact|bpimg)(:|$)/;
// A project document (src/store.js PROJECT_PREFIX = 'project:'); note this does
// NOT match 'projects:index' (the index), 'prices:v1', 'prefs:v2', or 'thumb:*'.
const PROJECT_DOC_RE = /^project:/;
const MAX_VALUE_BYTES = 400 * 1024; // biggest honest doc: project w/ 20 revisions + thumb
const MAX_BODY_BYTES = MAX_VALUE_BYTES + 4096;

/* ---------------- plumbing ---------------- */
function sendJSON(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  if (req.body !== undefined) {
    return Promise.resolve(typeof req.body === 'string' ? JSON.parse(req.body) : req.body);
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(new Error('value too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

/* The Free plan's project ceiling, or null for unlimited (Pro) / when it can't
 * be determined. Fails open: a storage hiccup must never block a user's save. */
async function projectLimitFor(uid, req) {
  try {
    const status = await E.statusFor(uid, req);
    const limit = status && status.entitlements ? status.entitlements.projectLimit : null;
    return (limit === null || limit === undefined) ? null : limit;
  } catch (e) {
    Log.report('store', 'entitlement_lookup_failed', e);
    return null;
  }
}

/* Existing project count, read from the client's own source of truth (the
 * projects:index array). The KV client exposes no key scan, and the index is
 * exactly what the client caps against, so the two agree. */
async function projectCount(kv, uid) {
  try {
    const raw = await kv.get(`bb:${uid}:projects:index`);
    if (raw === undefined || raw === null) return 0;
    const idx = JSON.parse(typeof raw === 'string' ? raw : String(raw));
    return Array.isArray(idx) ? idx.length : 0;
  } catch (e) {
    return 0;
  }
}

module.exports = async function handler(req, res) {
  const sess = S.sessionFrom(req);
  if (!sess) return sendJSON(res, 401, { error: 'auth_required' });
  const kv = KV.backend();
  if (!kv) return sendJSON(res, 503, { error: 'storage_unconfigured' });

  const url = new URL(req.url, 'http://localhost');
  const doc = url.searchParams.get('doc') || '';
  if (!DOC_RE.test(doc)) return sendJSON(res, 400, { error: 'bad doc name' });
  // Reserved entitlement keys behave as if the doc name were invalid — a plain
  // 4xx, identical for GET/PUT/POST/DELETE, before any backend access.
  if (RESERVED_DOC.test(doc)) return sendJSON(res, 400, { error: 'reserved doc name' });
  const key = `bb:${sess.uid}:${doc}`;

  try {
    if (req.method === 'GET') {
      const value = await kv.get(key);
      return sendJSON(res, 200, { value: value === undefined || value === null ? null : String(value) });
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      let body;
      try { body = await readBody(req); }
      catch (e) { return sendJSON(res, 400, { error: e.message }); }
      if (!body || typeof body.value !== 'string') return sendJSON(res, 400, { error: 'value (string) required' });
      if (Buffer.byteLength(body.value, 'utf8') > MAX_VALUE_BYTES) return sendJSON(res, 413, { error: 'value too large' });
      // A-10: enforce the Free project ceiling on NEW project docs only. Updates
      // to an existing project always succeed (a downgraded ex-Pro user never
      // loses edits); Pro/unlimited plans and non-project docs are unaffected.
      if (PROJECT_DOC_RE.test(doc)) {
        const limit = await projectLimitFor(sess.uid, req);
        if (limit !== null) {
          const existing = await kv.get(key);
          if ((existing === undefined || existing === null) && (await projectCount(kv, sess.uid)) >= limit) {
            return sendJSON(res, 403, { error: 'project_limit', limit });
          }
        }
      }
      await kv.set(key, body.value);
      return sendJSON(res, 200, { ok: true });
    }
    if (req.method === 'DELETE') {
      await kv.del(key);
      return sendJSON(res, 200, { ok: true });
    }
    res.setHeader('Allow', 'GET, PUT, POST, DELETE');
    return sendJSON(res, 405, { error: 'method not allowed' });
  } catch (e) {
    Log.report('store', 'kv_error', e);
    return sendJSON(res, 502, { error: 'storage backend error: ' + e.message });
  }
};
