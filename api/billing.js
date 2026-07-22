'use strict';

const Stripe = require('./_stripe.js');
const S = require('./_session.js');
const E = require('./_entitlements.js');
const Env = require('./_env-check.js');
const Log = require('./_log.js');

// Audit env vars once at cold start so missing keys surface immediately in logs.
Env.audit();

function stripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  return Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-05-27.dahlia' });
}
function origin(req) {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN.replace(/\/$/, '');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  return (S.isSecure(req) ? 'https' : 'http') + '://' + host;
}
function sendJSON(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}
function readBody(req) {
  if (req.body !== undefined) return Promise.resolve(typeof req.body === 'string' ? JSON.parse(req.body) : req.body);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > 16384) { reject(new Error('body too large')); req.destroy(); } else chunks.push(chunk); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (error) { reject(new Error('invalid JSON')); } });
    req.on('error', reject);
  });
}
function priceFor(interval) {
  return interval === 'year' ? process.env.STRIPE_PRO_YEARLY_PRICE_ID : process.env.STRIPE_PRO_MONTHLY_PRICE_ID;
}

module.exports = async function handler(req, res) {
  const session = S.sessionFrom(req);
  if (!session) return sendJSON(res, 401, { error: 'auth_required' });
  const stripe = stripeClient();
  if (!stripe) return sendJSON(res, 503, { error: 'billing_unconfigured' });
  const url = new URL(req.url, 'http://localhost');
  const action = url.searchParams.get('action') || 'status';

  try {
    if (req.method === 'GET' && action === 'status') {
      return sendJSON(res, 200, await E.statusFor(session.uid));
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return sendJSON(res, 405, { error: 'method_not_allowed' });
    }
    const body = await readBody(req);
    const saved = await E.getSubscription(session.uid);

    if (action === 'checkout') {
      const interval = body.interval === 'year' ? 'year' : 'month';
      const price = priceFor(interval);
      if (!price) return sendJSON(res, 503, { error: 'price_unconfigured' });
      if (saved && E.ACTIVE_STATUSES.has(saved.status)) return sendJSON(res, 409, { error: 'already_subscribed' });

      let customerId = saved && saved.customerId;
      if (!customerId) {
        const customer = await stripe.customers.create({ name: session.name || undefined, metadata: { bb_uid: session.uid } });
        customerId = customer.id;
        await E.setSubscription(session.uid, { customerId, status: 'incomplete', updatedAt: new Date().toISOString() });
      }
      const checkout = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        client_reference_id: session.uid,
        line_items: [{ price, quantity: 1 }],
        allow_promotion_codes: true,
        // Stripe Tax (LH-13): let Stripe compute and add the correct tax at
        // checkout instead of billing the bare price. Checkout collects the
        // buyer's address; customer_update.address=auto saves it back to the
        // (pre-created) customer so tax is calculated and future invoices stay
        // correct. Requires tax registrations + a tax_behavior on each price
        // in the Stripe Dashboard — until then Stripe simply adds $0 tax, so
        // this is safe to ship ahead of registration.
        automatic_tax: { enabled: true },
        customer_update: { address: 'auto' },
        subscription_data: { metadata: { bb_uid: session.uid } },
        metadata: { bb_uid: session.uid, interval },
        success_url: `${origin(req)}/?billing=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin(req)}/?billing=canceled`
      });
      return sendJSON(res, 200, { url: checkout.url });
    }

    if (action === 'portal') {
      if (!saved || !saved.customerId) return sendJSON(res, 404, { error: 'customer_not_found' });
      const portal = await stripe.billingPortal.sessions.create({ customer: saved.customerId, return_url: `${origin(req)}/?billing=returned` });
      return sendJSON(res, 200, { url: portal.url });
    }
    return sendJSON(res, 404, { error: 'unknown_action' });
  } catch (error) {
    // Never leak the raw upstream message to the browser. `error.code` (when
    // present) is Stripe's enum-like code, not free text, so it is safe and
    // useful for the client to branch on; the human-readable detail stays server-side.
    Log.report('billing', 'stripe_error', error);
    return sendJSON(res, 502, { error: 'billing_error', code: error.code || null });
  }
};
