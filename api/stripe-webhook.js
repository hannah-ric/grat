'use strict';

const Stripe = require('stripe');
const E = require('./_entitlements.js');

function sendJSON(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}
function rawBody(req) {
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
  if (typeof req.body === 'string') return Promise.resolve(Buffer.from(req.body));
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function subscriptionRecord(subscription) {
  const item = subscription.items && subscription.items.data && subscription.items.data[0];
  const recurring = item && item.price && item.price.recurring;
  return {
    customerId: String(subscription.customer),
    subscriptionId: subscription.id,
    status: subscription.status,
    priceId: item && item.price ? item.price.id : null,
    interval: recurring ? recurring.interval : null,
    currentPeriodEnd: subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
    cancelAtPeriodEnd: !!subscription.cancel_at_period_end,
    updatedAt: new Date().toISOString()
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return sendJSON(res, 405, { error: 'POST only' });
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) return sendJSON(res, 503, { error: 'webhook_unconfigured' });
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-05-27.dahlia' });
  let event;
  try {
    event = stripe.webhooks.constructEvent(await rawBody(req), req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
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
