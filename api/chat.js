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
const Log = require('./_log.js');

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

/* C14: prompt caching. The client's system prompt (src/ai.js systemPrompt) is
 * a byte-stable prefix — schema doc + generated digests, ~1.8k tokens — with
 * only the current wire spec varying per call, isolated after this marker
 * line. Split there into two blocks and mark the prefix ephemeral-cached so
 * Anthropic re-reads it from cache (~90% cheaper) instead of re-paying it on
 * every call. The client keeps sending one plain string; splitting is proxy-
 * only. Marker absent (foreign client, future prompt shape) → pass through
 * unchanged. */
const SPEC_MARKER = '\n--- current spec (wire format) ---';
function systemBlocks(system) {
  if (typeof system !== 'string') return undefined;
  const at = system.indexOf(SPEC_MARKER);
  if (at <= 0) return system;
  return [
    { type: 'text', text: system.slice(0, at), cache_control: { type: 'ephemeral' } },
    { type: 'text', text: system.slice(at) }
  ];
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

  /* Credits pivot: AI is behind sign-in (anonymous users get the live
   * example + inspector edits, never the model). The hashed-IP anonymous
   * meter (anonMeterId) stays in place for any future anonymous preview
   * path and still backs the burst guard below. */
  const session = S.sessionFrom(req);
  if (!session) {
    return sendJSON(res, 401, { type: 'error', error: { type: 'auth_required', message: 'Sign in to design with AI — your first blueprint credit is free.' } });
  }
  const meterId = session.uid;
  const tokenBudget = parseInt(process.env.AI_MONTHLY_TOKEN_BUDGET, 10) || 0; // 0 / unset = disabled
  if (!burstOK(meterId)) {
    return sendJSON(res, 429, { type: 'error', error: { type: 'rate_limited', message: 'Too many requests — please slow down.' } });
  }
  /* The monthly message meter is an ABUSE CEILING only (credits pivot): it
   * protects the proxy key, it is not the offer, and the client no longer
   * opens an upgrade dialog on this 402 — refinement must feel free. */
  try {
    const account = await E.statusFor(meterId);
    if (account.usage.aiMessages >= account.entitlements.aiMonthlyLimit) {
      return sendJSON(res, 402, {
        type: 'error',
        error: { type: 'usage_limit', message: 'This month’s AI usage ceiling is reached — it resets with the calendar month. Your designs, plans, and credits are unaffected.' },
        billing: account
      });
    }
  } catch (error) { Log.report('chat', 'status_lookup_failed', error); /* storage outage must not break AI — the burst guard still applies */ }

  // Optional monthly output-token spend ceiling (E-07a). Enforced PRE-upstream on
  // the same durable KV meter pattern, so a runaway spend can't reach Anthropic.
  // A distinct 429 that src/ai.js already surfaces gracefully (rate-limited) —
  // never a silent drop to the offline parser. Fails open on a storage hiccup.
  if (tokenBudget > 0) {
    try {
      const spent = await E.getTokenUsage(meterId);
      if (spent.tokens >= tokenBudget) {
        return sendJSON(res, 429, { type: 'error', error: { type: 'token_budget', message: 'Monthly AI usage limit reached — please try again next month.' } });
      }
    } catch (error) { Log.report('chat', 'token_budget_lookup_failed', error); }
  }

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
    system: systemBlocks(body.system),
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
      body: JSON.stringify(payload),
      // C6: a hung upstream must resolve into the 502 path, not pin the
      // request forever. 55 s < the client's own 60 s bound (src/ai.js).
      signal: AbortSignal.timeout ? AbortSignal.timeout(55000) : undefined
    });
  } catch (e) {
    Log.report('chat', 'upstream_unreachable', e);
    return sendJSON(res, 502, errBody('upstream unreachable: ' + e.message));
  }

  let data;
  try { data = await upstream.json(); }
  catch (e) { Log.report('chat', 'upstream_non_json', upstream.status); return sendJSON(res, 502, errBody('upstream returned non-JSON (' + upstream.status + ')')); }
  if (upstream.ok) {
    try { await E.incrementAI(meterId); } catch (error) { Log.report('chat', 'meter_increment_failed', error); /* usage metering is best-effort */ }
    if (tokenBudget > 0) {
      // Count actual output tokens when the response reports them; otherwise fall
      // back to the granted ceiling so an untracked response still spends budget.
      const spent = (data && data.usage && Number(data.usage.output_tokens)) || payload.max_tokens;
      try { await E.addTokens(meterId, spent); } catch (error) { Log.report('chat', 'token_meter_failed', error); }
    }
  } else {
    Log.report('chat', 'upstream_error', upstream.status);
  }
  return sendJSON(res, upstream.status, data);
};

module.exports.anonMeterId = anonMeterId; // exported for the server test suite
