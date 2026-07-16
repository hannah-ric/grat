'use strict';

const Stripe = require('./_stripe.js');
const E = require('./_entitlements.js');
const Env = require('./_env-check.js');

// Audit env vars once at cold start so missing keys surface immediately in logs.
Env.audit();

function sendJSON(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

/* Stripe signs the EXACT bytes it sent, so signature verification needs the
 * raw body — a re-serialised parsed object will not match. Prefer whatever raw
 * form we were handed (Buffer/string), otherwise read the request stream (the
 * path taken in local dev and on any runtime that leaves the body unparsed —
 * see the bodyParser:false config at the foot of this file). If the stream is
 * empty AND the platform has already parsed the JSON into an object, the signed
 * bytes are gone: surface a DISTINCT, diagnosable error instead of a mystery
 * "invalid_signature", so a misconfigured runtime is obvious on the first test
 * event rather than silently failing every real upgrade. */
function rawBody(req) {
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
  if (typeof req.body === 'string') return Promise.resolve(Buffer.from(req.body, 'utf8'));
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      if (chunks.length) return resolve(Buffer.concat(chunks));
      if (req.body && typeof req.body === 'object') {
        const e = new Error('raw_body_unavailable');
        e.rawBodyUnavailable = true;
        return reject(e);
      }
      resolve(Buffer.alloc(0));
    });
    req.on('error', reject);
  });
}
function subscriptionRecord(subscription) {
  const item = subscription.items && subscription.items.data && subscription.items.data[0];
  const recurring = item && item.price && item.price.recurring;
  // `current_period_end` moved from the subscription to its items in recent API
  // versions (a subscription can hold items on different cadences); read the
  // item first and fall back to the subscription for older payloads.
  const periodEnd = (item && item.current_period_end) || subscription.current_period_end || null;
  return {
    customerId: String(subscription.customer),
    subscriptionId: subscription.id,
    status: subscription.status,
    priceId: item && item.price ? item.price.id : null,
    interval: recurring ? recurring.interval : null,
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancelAtPeriodEnd: !!subscription.cancel_at_period_end,
    updatedAt: new Date().toISOString()
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return sendJSON(res, 405, { error: 'POST only' });
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) return sendJSON(res, 503, { error: 'webhook_unconfigured' });
  const stripe = Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-05-27.dahlia' });
  let raw;
  try {
    raw = await rawBody(req);
  } catch (bodyError) {
    return sendJSON(res, 400, { error: bodyError.rawBodyUnavailable ? 'raw_body_unavailable' : 'invalid_body' });
  }
  let event;
  try {
    event = stripe.webhooks.constructEvent(raw, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    return sendJSON(res, 400, { error: 'invalid_signature' });
  }
  try {
    if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      let uid = subscription.metadata && subscription.metadata.bb_uid;
      if (!uid && subscription.customer) {
        const customer = await stripe.customers.retrieve(String(subscription.customer));
        uid = !customer.deleted && customer.metadata && customer.metadata.bb_uid;
      }
      if (uid) await E.setSubscription(uid, subscriptionRecord(subscription));
    }
    return sendJSON(res, 200, { received: true });
  } catch (error) {
    return sendJSON(res, 500, { error: 'webhook_processing_failed' });
  }
};

module.exports.config = { api: { bodyParser: false } };
