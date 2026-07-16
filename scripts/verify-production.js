#!/usr/bin/env node
/* Blueprint Buddy — production readiness verification script.
 *
 * Checks every integration required for the full paid-subscription flow and
 * reports pass/fail with actionable remediation steps.
 *
 * Usage:
 *   node scripts/verify-production.js
 *
 * Needs STRIPE_SECRET_KEY + KV vars in the environment. Run with:
 *   node --env-file-if-exists=/vercel/share/.env.project scripts/verify-production.js
 *
 * Exit codes: 0 = all checks passed, 1 = one or more checks failed.
 */
'use strict';

const crypto = require('crypto');

// ── Colour helpers (no deps) ─────────────────────────────────────────────────
const isTTY = process.stdout.isTTY;
const c = {
  green: s => isTTY ? `\x1b[32m${s}\x1b[0m` : s,
  red:   s => isTTY ? `\x1b[31m${s}\x1b[0m` : s,
  yellow:s => isTTY ? `\x1b[33m${s}\x1b[0m` : s,
  bold:  s => isTTY ? `\x1b[1m${s}\x1b[0m`  : s,
  dim:   s => isTTY ? `\x1b[2m${s}\x1b[0m`  : s
};

const PASS = c.green('PASS');
const FAIL = c.red('FAIL');
const WARN = c.yellow('WARN');

const results = [];
function check(name, passed, detail, fix) {
  const status = passed === null ? WARN : passed ? PASS : FAIL;
  results.push({ passed, name, detail, fix });
  console.log(`  ${status}  ${name}`);
  if (detail) console.log(`       ${c.dim(detail)}`);
  if (!passed && fix) console.log(`       ${c.yellow('Fix:')} ${fix}`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const enc = (obj, prefix, out) => {
  out = out || [];
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === undefined || v === null) continue;
    const field = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => {
      if (typeof item === 'object') enc(item, `${field}[${i}]`, out);
      else out.push([`${field}[${i}]`, String(item)]);
    });
    else if (typeof v === 'object') enc(v, field, out);
    else out.push([field, String(v)]);
  }
  return out;
};
const toForm = obj => enc(obj).map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
async function stripeGet(key, path) {
  const res = await fetch('https://api.stripe.com' + path, {
    headers: { Authorization: 'Bearer ' + key }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
  return data;
}

// ── KV helper ────────────────────────────────────────────────────────────────
async function kvCommand(url, token, parts) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(parts)
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  return data.result;
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log('\n' + c.bold('Blueprint Buddy — Production Readiness Check'));
  console.log(c.dim('─'.repeat(52)) + '\n');

  // 1. Required env vars present
  console.log(c.bold('1. Environment variables'));
  const REQUIRED = ['AUTH_SECRET','STRIPE_SECRET_KEY','STRIPE_PRO_MONTHLY_PRICE_ID',
                    'STRIPE_PRO_YEARLY_PRICE_ID','STRIPE_WEBHOOK_SECRET'];
  const KV_PAIRS = [['KV_REST_API_URL','KV_REST_API_TOKEN'],['UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN']];
  for (const key of REQUIRED) {
    check(key, !!process.env[key], process.env[key] ? `set (${process.env[key].slice(0,8)}...)` : 'not set',
      `vercel env add ${key} production --value "..." --yes`);
  }
  const kvOk = KV_PAIRS.some(([u,t]) => process.env[u] && process.env[t]);
  check('KV_REST_API_URL + KV_REST_API_TOKEN', kvOk,
    kvOk ? 'KV backend is reachable' : 'neither KV pair is set',
    'Add the Upstash Redis integration from the Vercel Marketplace.');
  check('APP_ORIGIN', null,  // advisory only
    process.env.APP_ORIGIN ? `set to ${process.env.APP_ORIGIN}` : 'not set — redirect targets derived from Host header',
    'Set APP_ORIGIN=https://your-app.vercel.app in Vercel → Settings → Environment Variables.');
  console.log('');

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    console.log(c.red('Cannot run Stripe or KV checks without STRIPE_SECRET_KEY. Exiting.\n'));
    process.exit(1);
  }

  // 2. Stripe key validity
  console.log(c.bold('2. Stripe API'));
  try {
    const account = await stripeGet(stripeKey, '/v1/account');
    const mode = stripeKey.startsWith('sk_live') ? 'live' : 'test';
    check('API key valid', true, `${mode} mode · account: ${account.id}`);
    if (mode === 'test') check('Live mode', null, 'Key is test mode — swap for sk_live_... before go-live',
      'Replace STRIPE_SECRET_KEY with your live secret key from Stripe Dashboard → Developers → API keys.');
  } catch (e) {
    check('API key valid', false, e.message, 'Verify STRIPE_SECRET_KEY in Stripe Dashboard → Developers → API keys.');
  }

  // 3. Price IDs exist
  console.log('');
  console.log(c.bold('3. Stripe Prices'));
  for (const [label, envKey] of [['Monthly','STRIPE_PRO_MONTHLY_PRICE_ID'],['Yearly','STRIPE_PRO_YEARLY_PRICE_ID']]) {
    const priceId = process.env[envKey];
    if (!priceId) { check(`${label} price (${envKey})`, false, 'env var not set', `Create a recurring ${label.toLowerCase()} price and set ${envKey}.`); continue; }
    try {
      const price = await stripeGet(stripeKey, `/v1/prices/${encodeURIComponent(priceId)}`);
      const amt = `$${(price.unit_amount / 100).toFixed(2)} / ${price.recurring?.interval}`;
      check(`${label} price`, price.active, `${priceId} · ${amt}${price.active ? '' : ' · INACTIVE'}`,
        price.active ? null : 'Re-activate or replace this price in the Stripe Dashboard.');
    } catch (e) {
      check(`${label} price`, false, `${priceId} — ${e.message}`, `Verify ${envKey} matches a price in the Stripe Dashboard.`);
    }
  }

  // 4. Webhook endpoint registered
  console.log('');
  console.log(c.bold('4. Stripe Webhook'));
  const WEBHOOK_URL_SUFFIX = '/api/stripe-webhook';
  const REQUIRED_EVENTS = new Set(['customer.subscription.created','customer.subscription.updated','customer.subscription.deleted']);
  try {
    const endpoints = await stripeGet(stripeKey, '/v1/webhook_endpoints?limit=100');
    const wh = endpoints.data.find(w => w.url.endsWith(WEBHOOK_URL_SUFFIX));
    if (!wh) {
      check('Webhook endpoint', false, `No endpoint ending in ${WEBHOOK_URL_SUFFIX} found`,
        'Register https://YOUR-APP/api/stripe-webhook in Stripe Dashboard → Webhooks.');
    } else {
      const events = new Set(wh.enabled_events);
      const hasAll = [...REQUIRED_EVENTS].every(e => events.has(e) || events.has('*'));
      check('Webhook endpoint', wh.status === 'enabled', `${wh.url} · ${wh.status}`,
        wh.status !== 'enabled' ? 'Re-enable the webhook in Stripe Dashboard → Webhooks.' : null);
      check('Webhook events', hasAll,
        [...REQUIRED_EVENTS].map(e => (events.has(e) || events.has('*') ? c.green(e) : c.red(e + ' MISSING'))).join(', '),
        hasAll ? null : `Add missing events to ${wh.url} in Stripe Dashboard → Webhooks.`);
    }
  } catch (e) {
    check('Webhook endpoint', false, e.message, 'Verify STRIPE_SECRET_KEY and network connectivity.');
  }

  // 5. Webhook signature (synthetic verify)
  console.log('');
  console.log(c.bold('5. Webhook signature verification (synthetic)'));
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!whSecret) {
    check('STRIPE_WEBHOOK_SECRET present', false, 'not set', 'Set STRIPE_WEBHOOK_SECRET to the whsec_... from your webhook endpoint.');
  } else {
    try {
      const payload = JSON.stringify({ id: 'evt_test', type: 'customer.subscription.created', data: { object: {} } });
      const ts = Math.floor(Date.now() / 1000);
      const sig = crypto.createHmac('sha256', whSecret).update(`${ts}.${payload}`).digest('hex');
      const header = `t=${ts},v1=${sig}`;
      // Use our own constructEvent implementation from _stripe.js
      const createClient = require('./../api/_stripe.js');
      const stripe = createClient(stripeKey, {});
      stripe.webhooks.constructEvent(Buffer.from(payload), header, whSecret);
      check('Signature verification', true, 'HMAC verified successfully against STRIPE_WEBHOOK_SECRET');
    } catch (e) {
      check('Signature verification', false, e.message,
        'Ensure STRIPE_WEBHOOK_SECRET matches the signing secret shown in Stripe Dashboard → Webhooks → your endpoint.');
    }
  }

  // 6. KV read/write round-trip
  console.log('');
  console.log(c.bold('6. KV (Upstash Redis) round-trip'));
  const kvUrl   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!kvUrl || !kvToken) {
    check('KV connectivity', false, 'KV env vars not set', 'Add Upstash Redis integration from the Vercel Marketplace.');
  } else {
    const testKey = `bb:verify:${Date.now()}`;
    try {
      await kvCommand(kvUrl, kvToken, ['SET', testKey, 'ok', 'EX', '60']);
      const val = await kvCommand(kvUrl, kvToken, ['GET', testKey]);
      await kvCommand(kvUrl, kvToken, ['DEL', testKey]);
      check('KV connectivity', val === 'ok', val === 'ok' ? 'SET / GET / DEL round-trip succeeded' : `unexpected value: ${val}`);
    } catch (e) {
      check('KV connectivity', false, e.message, 'Verify KV_REST_API_URL and KV_REST_API_TOKEN against the Upstash console.');
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('\n' + c.dim('─'.repeat(52)));
  const failures = results.filter(r => r.passed === false);
  const warnings = results.filter(r => r.passed === null);
  if (failures.length === 0) {
    console.log(c.green(c.bold(`All checks passed.${warnings.length ? ` (${warnings.length} advisory)` : ''}`)));
    console.log(c.dim('The app is ready to accept live Stripe subscriptions.\n'));
    process.exit(0);
  } else {
    console.log(c.red(c.bold(`${failures.length} check(s) failed.${warnings.length ? ` ${warnings.length} advisory.` : ''}`)));
    console.log(c.dim('Resolve the issues above before accepting live traffic.\n'));
    process.exit(1);
  }
})();
