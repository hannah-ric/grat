/* Blueprint Buddy — client crash reporting (zero-dependency, no env needed).
 *
 * api/_log.js gives the SERVER one structured line per failure. The browser
 * had no reporting at all, so a total client-side crash — boot dying on a GPU
 * fault, an unhandled rejection in the storage chain — produced exactly zero
 * signal (audit V-02). This is the receiving end: the client's window.onerror
 * and unhandledrejection handlers POST a tiny envelope, and it lands as one
 * line in the SAME one-line JSON format every server failure uses, so both
 * halves of the product read out of one log.
 *
 *   POST /api/clientlog   { message, source, line, col, stack, kind }
 *     -> 204, always      (kind: 'error' | 'unhandledrejection')
 *
 * Three properties are load-bearing:
 *
 * PRIVACY — the envelope is an ALLOWLIST, not a filter. Only the six fields
 * above are read; a spec, a share code, a design name, anything else a page
 * might attach is dropped untouched, and every surviving field is hard-
 * truncated. Design content never reaches the logs. The client IP buckets the
 * rate limiter and is hashed to do it (the precedent set by the signup cap in
 * _credits.js and the anon AI meter in chat.js); it is never a log field,
 * raw or hashed.
 *
 * NEVER A FAILURE SURFACE — the answer is 204 whether or not we logged:
 * unparseable body, oversized body, over the rate cap, all 204. A reporting
 * endpoint that can itself fail — or that tells an already-crashing page it
 * failed — only makes a bad day worse. Nothing here throws.
 *
 * NO SESSION, NO ENV — a crash can land before sign-in, before the auth probe
 * resolves, or on a deployment with nothing configured at all. This endpoint
 * needs neither a cookie nor a single environment variable.
 */
'use strict';

const crypto = require('crypto');
const Credits = require('./_credits.js'); // only for clientIp — the one client-IP helper in the codebase
const Log = require('./_log.js');

const MAX_BODY_BYTES = 8 * 1024; // ~2.7 KB survives truncation; the rest is slack for a fat stack on the wire
const MAX_MESSAGE = 300;
const MAX_STACK = 2000;
const MAX_FIELD = 200;           // source — and any other short field

/* In-memory per-instance burst cap, the same shape as api/chat.js and
 * api/lead.js: it ALWAYS applies, needs no KV, and degrades to "logged less"
 * rather than to an error. Sized off the failure it exists for — a crash-
 * looping tab reloading once a second. One broken page load produces a handful
 * of distinct reports (the boot error, then the rejections it cascades into),
 * so 20/minute leaves room for a genuinely messy failure, and for a few makers
 * behind one NAT, while a loop is cut off after 20 lines instead of writing the
 * same stack into the log forever. */
const BURST_MAX = 20;
const BURST_WINDOW_MS = 60 * 1000;
const burst = new Map();
function burstOK(id) {
  const now = Date.now();
  const hits = (burst.get(id) || []).filter(t => now - t < BURST_WINDOW_MS);
  hits.push(now);
  burst.set(id, hits);
  if (burst.size > 5000) { // bound the map on a long-lived instance
    for (const [k, v] of burst) if (!v.some(t => now - t < BURST_WINDOW_MS)) burst.delete(k);
  }
  return hits.length <= BURST_MAX;
}

/* The rate-limit bucket. An unknown IP shares one bucket rather than escaping
 * the cap — for a log endpoint, "capped together" is the safe direction. */
function bucketFor(req) {
  const ip = Credits.clientIp(req) || 'unknown';
  return crypto.createHash('sha256').update('bb-clientlog:' + ip).digest('hex').slice(0, 24);
}

/* Truncation is the privacy backstop: even a field the browser filled with
 * something it shouldn't have can only spend so many characters. */
function clip(v, n) {
  if (v === undefined || v === null || v === '') return null;
  return String(v).slice(0, n);
}
/* line/col are positions, not prose: coerce, or drop. Nothing unbounded rides
 * in on a numeric field. */
function num(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function noContent(res) {
  res.statusCode = 204;
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

/* Vercel pre-parses JSON bodies into req.body; plain Node (serve.js) does not.
 * Accept both, with a hard size cap on either. A pre-parsed OBJECT can't be
 * sized cheaply — field truncation is the cap that always holds. */
function readBody(req) {
  if (req.body !== undefined) {
    if (typeof req.body === 'string') {
      if (req.body.length > MAX_BODY_BYTES) throw new Error('body too large');
      return Promise.resolve(JSON.parse(req.body));
    }
    return Promise.resolve(req.body);
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      if (size > MAX_BODY_BYTES) return; // already over: drop the rest, keep draining
      size += c.length;
      // Deliberately NOT the req.destroy() the other handlers use on an
      // oversized body: destroying the socket hands a crashing page a network
      // error instead of the 204 this endpoint promises. Stop buffering, answer,
      // let the rest drain into the bin.
      if (size > MAX_BODY_BYTES) { chunks.length = 0; resolve(null); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify({ error: 'method_not_allowed' }));
  }
  try {
    if (burstOK(bucketFor(req))) {
      const body = await readBody(req).catch(() => null);
      if (body && typeof body === 'object') {
        // One line, one crash. Everything not named here is dropped silently.
        const detail = {
          message: clip(body.message, MAX_MESSAGE),
          source: clip(body.source, MAX_FIELD),
          line: num(body.line),
          col: num(body.col),
          stack: clip(body.stack, MAX_STACK)
        };
        // An envelope with nothing to say is noise, not signal — accepted, not written.
        if (detail.message || detail.source || detail.stack) {
          Log.report('client', body.kind === 'unhandledrejection' ? 'unhandledrejection' : 'error', detail);
        }
      }
    }
  } catch (e) { /* a reporter that crashes is worse than silence (api/_log.js) */ }
  return noContent(res);
};

module.exports.BURST_MAX = BURST_MAX; // exported for the server test suite
