/* Blueprint Buddy — zero-dependency Stripe client.
 *
 * The founding rule is "the deliverable stays runnable on nothing but Node ≥ 18"
 * — so we hand-roll the handful of Stripe REST calls this app actually uses
 * (fetch + node:crypto), exactly as api/_kv.js hand-rolls the KV REST client,
 * instead of taking on the `stripe` npm dependency. Files starting with "_" are
 * NOT deployed as Vercel functions — this is a library, not an endpoint.
 *
 * Surface deliberately mirrors the `stripe` SDK so the call sites in
 * api/billing.js and api/stripe-webhook.js read the same:
 *   const stripe = Stripe(secret, { apiVersion });
 *   stripe.customers.create({ name, metadata })          -> POST /v1/customers
 *   stripe.customers.retrieve(id)                         -> GET  /v1/customers/:id
 *   stripe.checkout.sessions.create({ ... })             -> POST /v1/checkout/sessions
 *   stripe.billingPortal.sessions.create({ ... })        -> POST /v1/billing_portal/sessions
 *   stripe.webhooks.constructEvent(rawBody, sig, secret) -> verified event (no network)
 *
 * Errors throw an Error carrying { status, code, type } so callers map them to
 * fixed, non-leaky client responses (never the raw upstream message).
 */
'use strict';

const crypto = require('crypto');

const API_BASE = 'https://api.stripe.com';
const SIGNATURE_TOLERANCE_S = 300; // Stripe's default replay window

/* Stripe expects application/x-www-form-urlencoded with PHP-style bracket
 * nesting: metadata[bb_uid]=x, line_items[0][price]=y. Flatten recursively. */
function toForm(obj, prefix, out) {
  out = out || [];
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (value === undefined || value === null) continue;
    const field = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item !== null && typeof item === 'object') toForm(item, `${field}[${i}]`, out);
        else out.push([`${field}[${i}]`, String(item)]);
      });
    } else if (value !== null && typeof value === 'object') {
      toForm(value, field, out);
    } else {
      out.push([field, String(value)]);
    }
  }
  return out;
}
function encodeForm(obj) {
  return toForm(obj).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

function createClient(secretKey, opts) {
  opts = opts || {};
  if (!secretKey) throw new Error('stripe secret key required');

  async function request(method, pathname, params) {
    const headers = {
      Authorization: 'Bearer ' + secretKey,
      Accept: 'application/json'
    };
    if (opts.apiVersion) headers['Stripe-Version'] = opts.apiVersion;
    let url = API_BASE + pathname;
    const init = { method, headers };
    if (params && method === 'GET') {
      const qs = encodeForm(params);
      if (qs) url += '?' + qs;
    } else if (params) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      init.body = encodeForm(params);
    }
    let response;
    try {
      response = await fetch(url, init);
    } catch (networkError) {
      const e = new Error('stripe unreachable: ' + networkError.message);
      e.status = 502; e.code = 'network_error';
      throw e;
    }
    let data;
    try { data = await response.json(); }
    catch (parseError) { data = null; }
    if (!response.ok) {
      const err = (data && data.error) || {};
      const e = new Error(err.message || `stripe request failed (${response.status})`);
      e.status = response.status; e.code = err.code || 'stripe_error'; e.type = err.type;
      throw e;
    }
    return data;
  }

  return {
    customers: {
      create: params => request('POST', '/v1/customers', params || {}),
      retrieve: id => request('GET', '/v1/customers/' + encodeURIComponent(id))
    },
    checkout: {
      sessions: {
        create: params => request('POST', '/v1/checkout/sessions', params || {})
      }
    },
    billingPortal: {
      sessions: {
        create: params => request('POST', '/v1/billing_portal/sessions', params || {})
      }
    },
    webhooks: {
      /* Verify per Stripe's scheme: header is "t=<ts>,v1=<hex>[,v1=<hex>...]";
       * the signed payload is `${t}.${rawBody}`, HMAC-SHA256 with the endpoint
       * secret. Constant-time compare against every v1 (secret rotation sends
       * more than one), and reject stale timestamps. Pure — no network. */
      constructEvent(rawBody, signatureHeader, endpointSecret) {
        if (!endpointSecret) throw new Error('webhook secret required');
        const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
        const parts = {};
        const v1 = [];
        for (const piece of String(signatureHeader || '').split(',')) {
          const i = piece.indexOf('=');
          if (i < 0) continue;
          const k = piece.slice(0, i).trim();
          const val = piece.slice(i + 1).trim();
          if (k === 'v1') v1.push(val);
          else parts[k] = val;
        }
        const timestamp = Number(parts.t);
        if (!timestamp || !v1.length) throw new Error('missing signature components');
        const expected = crypto.createHmac('sha256', endpointSecret)
          .update(`${timestamp}.${payload}`, 'utf8').digest('hex');
        const expectedBuf = Buffer.from(expected, 'utf8');
        const matched = v1.some(candidate => {
          const candidateBuf = Buffer.from(candidate, 'utf8');
          return candidateBuf.length === expectedBuf.length &&
            crypto.timingSafeEqual(candidateBuf, expectedBuf);
        });
        if (!matched) throw new Error('signature verification failed');
        if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > SIGNATURE_TOLERANCE_S) {
          throw new Error('timestamp outside tolerance');
        }
        try { return JSON.parse(payload); }
        catch (parseError) { throw new Error('invalid webhook payload'); }
      }
    }
  };
}

module.exports = createClient;
module.exports.encodeForm = encodeForm; // exported for the server test suite
