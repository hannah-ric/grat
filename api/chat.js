/* Blueprint Buddy — same-origin Anthropic proxy.
 *
 * One Vercel Node.js serverless function (auto-detected from /api) that holds
 * ANTHROPIC_API_KEY server-side. The browser never sees the key: src/ai.js
 * POSTs { system, messages, max_tokens } here, and the function forwards to
 * api.anthropic.com and returns the upstream JSON verbatim, so the client
 * parses proxy replies and direct replies with the same code.
 *
 * serve.js mounts this same handler at /api/chat for local dev and for the
 * v0 sandbox preview, so AI works identically in all three hosts.
 *
 * Environment:
 *   ANTHROPIC_API_KEY  (required) — server-side only
 *   ANTHROPIC_MODEL    (optional) — defaults to claude-sonnet-5
 */
'use strict';

const crypto = require('crypto');
const S = require('./_session.js');
const E = require('./_entitlements.js');

const DEFAULT_MODEL = 'claude-sonnet-5';
const MAX_TOKENS_CAP = 1024;   // client asks for 1000; the proxy grants no more than this
const MAX_MESSAGES = 32;       // 6 verbatim turns + digest + continuations, with headroom
const MAX_BODY_BYTES = 5 * 1024 * 1024; // one downscaled photo is ~300 KB base64

/* Every request is metered — signed-in by uid, anonymous by hashed client IP —
 * so no one can burn the owner's Anthropic key unmetered or dodge the Free cap
 * by signing out (A4b). The IP hash keeps raw addresses out of KV keys. */
function anonMeterId(req) {
  // Never trust X-Forwarded-For: its leftmost hop is client-supplied, so an
  // attacker rotates it to mint fresh 25-msg + burst buckets on the owner key
  // (E-03). x-real-ip is set by Vercel to the verified client IP and is not
  // forgeable there; behind serve.js (direct connections) it is absent and the
  // socket address is authoritative. Prefer x-real-ip, then the direct socket.
  const realIp = String((req.headers && req.headers['x-real-ip']) || '').trim();
  const ip = realIp || (req.socket && req.socket.remoteAddress) || 'unknown';
  return 'ip:' + crypto.createHash('sha256').update('bb-anon:' + ip).digest('hex').slice(0, 24);
}

/* In-memory per-instance burst guard: a cheap backstop that ALWAYS applies —
 * even when KV is unconfigured (dev) or briefly down, so "no storage" degrades
 * to rate-limited, never to unlimited. The KV monthly meter (25/500) is the
 * DURABLE cap and trips first in production; this only bites when there is no KV.
 * Set high because ONE user message can fan out into several proxy calls (the
 * continuation protocol adds up to 2, and the novel-piece critique loop up to 3
 * rounds), so a legitimate complex design may issue ~12 POSTs — the limit must
 * clear that comfortably and only catch runaway flooding. */
const BURST_MAX = 60;
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

function sendJSON(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}
const errBody = message => ({ type: 'error', error: { type: 'proxy_error', message } });

/* Vercel parses JSON bodies into req.body; plain Node (serve.js) does not.
 * Accept both, with a hard size cap on the raw stream. */
function readBody(req) {
  if (req.body !== undefined) {
    return Promise.resolve(typeof req.body === 'string' ? JSON.parse(req.body) : req.body);
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJSON(res, 405, errBody('POST only'));
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return sendJSON(res, 503, errBody('AI proxy not configured: set ANTHROPIC_API_KEY in the environment.'));
  }

  const session = S.sessionFrom(req);
  const meterId = session ? session.uid : anonMeterId(req);
  if (!burstOK(meterId)) {
    return sendJSON(res, 429, { type: 'error', error: { type: 'rate_limited', message: 'Too many requests — please slow down.' } });
  }
  try {
    const account = await E.statusFor(meterId);
    if (account.usage.aiMessages >= account.entitlements.aiMonthlyLimit) {
      return sendJSON(res, 402, {
        type: 'error',
        error: { type: 'usage_limit', message: 'Monthly AI message limit reached.' },
        billing: account
      });
    }
  } catch (error) { /* storage outage must not break AI — the burst guard still applies */ }

  let body;
  try { body = await readBody(req); }
  catch (e) { return sendJSON(res, 400, errBody(e.message)); }
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    return sendJSON(res, 400, errBody('messages array required'));
  }
  if (body.messages.length > MAX_MESSAGES) {
    return sendJSON(res, 400, errBody('too many messages'));
  }

  // The proxy owns model choice and the token ceiling; the client only
  // proposes max_tokens. Everything else it sends is ignored.
  const payload = {
    model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
    max_tokens: Math.min(Math.max(1, Number(body.max_tokens) || MAX_TOKENS_CAP), MAX_TOKENS_CAP),
    system: typeof body.system === 'string' ? body.system : undefined,
    messages: body.messages
  };

  let upstream;
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    return sendJSON(res, 502, errBody('upstream unreachable: ' + e.message));
  }

  let data;
  try { data = await upstream.json(); }
  catch (e) { return sendJSON(res, 502, errBody('upstream returned non-JSON (' + upstream.status + ')')); }
  if (upstream.ok) {
    try { await E.incrementAI(meterId); } catch (error) { /* usage metering is best-effort */ }
  }
  return sendJSON(res, upstream.status, data);
};

module.exports.anonMeterId = anonMeterId; // exported for the server test suite
