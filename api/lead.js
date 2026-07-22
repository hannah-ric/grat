/* Blueprint Buddy — lead capture (zero-dependency, optional).
 *
 * The porch's build-vs-buy calculator and the anonymous "email me this
 * preview" flow both produce qualified intent that used to be discarded.
 * This endpoint writes it down — nothing more. Sending the actual email is
 * a human/provider step (no email service is configured in this repo; see
 * docs/audit/09-launch-human-inputs.md).
 *
 *   POST /api/lead   { email, kind: 'preview' | 'calculator', context? }
 *     -> 200 { ok: true }    (or 503 when no KV is configured)
 *
 * Storage: bb:leads (a global append list, NOT under any bb:{uid}: keyspace,
 * so it is unreachable through /api/store by construction). The context
 * payload is size-capped and stored verbatim for a human to read.
 */
'use strict';

const crypto = require('crypto');
const KV = require('./_kv.js');
const Log = require('./_log.js');

const LEADS_KEY = 'bb:leads';
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,24}$/;
const MAX_CONTEXT = 2000;
const MAX_LEADS = 5000; // bound the list; oldest drop first past this

/* Cheap per-instance burst guard, same shape as api/chat.js. */
const burst = new Map();
function burstOK(id) {
  const now = Date.now();
  const hits = (burst.get(id) || []).filter(t => now - t < 60000);
  hits.push(now);
  burst.set(id, hits);
  return hits.length <= 10;
}

function sendJSON(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  if (req.body !== undefined) return Promise.resolve(typeof req.body === 'string' ? JSON.parse(req.body) : req.body);
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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJSON(res, 405, { error: 'method_not_allowed' });
  }
  const kv = KV.backend();
  if (!kv) return sendJSON(res, 503, { error: 'storage_unconfigured' });
  const ip = String((req.headers && req.headers['x-real-ip']) || '').trim() || (req.socket && req.socket.remoteAddress) || 'unknown';
  if (!burstOK('lead:' + crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16))) {
    return sendJSON(res, 429, { error: 'rate_limited' });
  }
  let body;
  try { body = await readBody(req); }
  catch (e) { return sendJSON(res, 400, { error: e.message }); }
  const email = String(body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return sendJSON(res, 400, { error: 'bad_email' });
  const kind = body.kind === 'calculator' ? 'calculator' : 'preview';
  const context = typeof body.context === 'string' ? body.context.slice(0, MAX_CONTEXT) : null;
  try {
    const raw = await kv.get(LEADS_KEY);
    let leads = [];
    try { leads = raw ? JSON.parse(typeof raw === 'string' ? raw : String(raw)) : []; } catch (e) { leads = []; }
    if (!Array.isArray(leads)) leads = [];
    leads.push({ ts: Date.now(), email, kind, context });
    if (leads.length > MAX_LEADS) leads = leads.slice(-MAX_LEADS);
    await kv.set(LEADS_KEY, JSON.stringify(leads));
    return sendJSON(res, 200, { ok: true });
  } catch (e) {
    Log.report('lead', 'kv_error', e);
    return sendJSON(res, 502, { error: 'storage_error' });
  }
};
