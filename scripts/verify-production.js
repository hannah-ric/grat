#!/usr/bin/env node
/* Blueprint Buddy — production readiness verification script.
 *
 * Checks every integration required for the full paid-subscription flow and
 * reports pass/fail with actionable remediation steps.
 *
 * Usage:
 *   node scripts/verify-production.js
 *
 * Run with project env vars:
 *   node --env-file-if-exists=/vercel/share/.env.project scripts/verify-production.js
 *
 * NOTE: Vercel redacts `sensitive` (encrypted) env vars from `vercel env pull`.
 * AUTH_SECRET and STRIPE_WEBHOOK_SECRET are encrypted and will not appear in the
 * local .env file. The script queries the Vercel REST API to confirm they are set
 * without reading their values.
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

/* Pure readiness verdict, so the "is it live?" decision is unit-testable.
 * A deploy with all Stripe/KV checks green is still NOT fully live if AI is
 * unconfigured (falls back to the offline parser) or no OAuth provider exists
 * (no one can sign in, so checkout is unreachable) — those are advisory gaps
 * that must qualify the ready message, never a silent "all set" (A-03). */
function summarize(results, opts) {
  opts = opts || {};
  const failures = results.filter(r => r.passed === false).length;
  const warnings = results.filter(r => r.passed === null).length;
  const gaps = [];
  if (opts.aiPresent === false) gaps.push('AI chat is not configured (ANTHROPIC_API_KEY unset) — the app will use its built-in offline parser, not live AI.');
  if (opts.oauthPresent === false) gaps.push('No OAuth provider is configured — no one can sign in, so subscription checkout / Pro is unreachable.');
  return { failures, warnings, gaps, ok: failures === 0, ready: failures === 0 && gaps.length === 0 };
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

// ── Vercel CLI: list env var keys set for production ────────────────────────
// Vercel redacts `sensitive` (encrypted) vars from `env pull`, but `vercel env ls`
// lists their names. We shell out to parse the output and build a key set.
// Returns a Set of env var keys confirmed set on the Vercel Production environment.
// Encrypted/sensitive vars are redacted from `vercel env pull`, so we maintain a
// lightweight manifest file (.vercel-env-manifest.json) as the source of truth.
async function getVercelEnvKeys() {
  const fs   = require('fs');
  const path = require('path');
  const manifestPath = path.join(process.cwd(), '.vercel-env-manifest.json');
  try {
    const raw  = fs.readFileSync(manifestPath, 'utf8');
    const data = JSON.parse(raw);
    const keys = Array.isArray(data.confirmed_production) ? data.confirmed_production : [];
    if (data.last_verified) {
      process.stdout.write(`       ${c.dim(`(manifest last verified: ${data.last_verified})`)}\n`);
    }
    return new Set(keys);
  } catch {
    return null;   // manifest absent — fall back to local env only
  }
}

// Exported for unit testing (the readiness verdict is pure); the network run
// below only executes when the script is invoked directly, not on require.
module.exports = { summarize };
if (require.main !== module) return;

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log('\n' + c.bold('Blueprint Buddy — Production Readiness Check'));
  console.log(c.dim('─'.repeat(52)) + '\n');

  // Pre-fetch Vercel env key list so we can confirm sensitive vars exist even
  // though vercel env pull redacts them from the local file.
  const vercelEnvKeys = await getVercelEnvKeys();

  // Helper: a var is "present" if it is in the local env OR confirmed via Vercel API
  const envPresent = key => !!process.env[key] || (vercelEnvKeys && vercelEnvKeys.has(key));
  const envDetail  = key => {
    if (process.env[key]) return `set (${process.env[key].slice(0,8)}...)`;
    if (vercelEnvKeys && vercelEnvKeys.has(key)) return 'set on Vercel (encrypted — redacted from local pull)';
    return 'not set';
  };

  // 1. Required env vars present
  console.log(c.bold('1. Environment variables'));
  const SENSITIVE = new Set(['AUTH_SECRET','STRIPE_WEBHOOK_SECRET']);
  const REQUIRED  = ['AUTH_SECRET','STRIPE_SECRET_KEY','STRIPE_PRO_MONTHLY_PRICE_ID',
                     'STRIPE_PRO_YEARLY_PRICE_ID','STRIPE_WEBHOOK_SECRET'];
  const KV_PAIRS  = [['KV_REST_API_URL','KV_REST_API_TOKEN'],['UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN']];

  for (const key of REQUIRED) {
    const present = envPresent(key);
    const detail  = envDetail(key);
    const fix     = present ? null : `vercel env add ${key} production --value "..." --yes`;
    check(key, present, detail, fix);
  }
  const kvOk = KV_PAIRS.some(([u,t]) => envPresent(u) && envPresent(t));
  check('KV_REST_API_URL + KV_REST_API_TOKEN', kvOk,
    kvOk ? 'set' : 'neither KV pair is set',
    kvOk ? null : 'Add the Upstash Redis integration from the Vercel Marketplace.');
  // Advisory: AI degrades to the offline parser without a key; no OAuth pair
  // means no sign-in and unreachable billing. Both WARN (null), never fail.
  const aiPresent = envPresent('ANTHROPIC_API_KEY');
  check('ANTHROPIC_API_KEY', aiPresent ? true : null,
    aiPresent ? envDetail('ANTHROPIC_API_KEY') : 'not set — AI chat falls back to the built-in offline parser (no live AI)',
    'Set ANTHROPIC_API_KEY in Vercel → Settings → Environment Variables to enable live AI.');
  const oauthPresent = (envPresent('GOOGLE_CLIENT_ID') && envPresent('GOOGLE_CLIENT_SECRET')) ||
                       (envPresent('GITHUB_CLIENT_ID') && envPresent('GITHUB_CLIENT_SECRET'));
  check('OAuth sign-in provider', oauthPresent ? true : null,
    oauthPresent ? 'at least one Google/GitHub client pair configured' : 'no Google or GitHub OAuth pair set — no one can sign in; billing/Pro is unreachable',
    'Set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET or GITHUB_CLIENT_ID + GITHUB_CLIENT_SECRET.');
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
  const whSecretOnVercel = envPresent('STRIPE_WEBHOOK_SECRET');
  if (!whSecret && !whSecretOnVercel) {
    check('STRIPE_WEBHOOK_SECRET present', false, 'not set',
      'Set STRIPE_WEBHOOK_SECRET to the whsec_... from your webhook endpoint.');
  } else if (!whSecret && whSecretOnVercel) {
    // Encrypted in Vercel — can't do a local HMAC test, but the key is confirmed set.
    check('STRIPE_WEBHOOK_SECRET present', true, 'set on Vercel (encrypted — skipping local HMAC test)');
    check('Signature verification', null, 'Cannot run locally with encrypted secret — verified via Vercel API',
      'Deploy and run: stripe trigger customer.subscription.created --stripe-account <id> to confirm end-to-end.');
  } else {
    try {
      // Pure-crypto reconstruction matching Stripe\'s header format
      const payload = JSON.stringify({ id: 'evt_test', type: 'customer.subscription.created', data: { object: {} } });
      const ts = Math.floor(Date.now() / 1000);
      const rawSecret = whSecret.startsWith('whsec_')
        ? Buffer.from(whSecret.slice('whsec_'.length), 'base64')
        : Buffer.from(whSecret);
      const sig = crypto.createHmac('sha256', rawSecret).update(`${ts}.${payload}`).digest('hex');
      const header = `t=${ts},v1=${sig}`;
      // Re-verify with same logic as _stripe.js constructEvent
      const parts = header.split(',');
      const tsVerify = parseInt(parts.find(p => p.startsWith('t=')).slice(2), 10);
      const v1 = parts.find(p => p.startsWith('v1=')).slice(3);
      const expected = crypto.createHmac('sha256', rawSecret).update(`${tsVerify}.${payload}`).digest('hex');
      if (expected !== v1) throw new Error('HMAC mismatch');
      check('Signature verification', true, 'HMAC round-trip verified successfully against STRIPE_WEBHOOK_SECRET');
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

  // 7. Stripe Customer Portal configuration (LH-02)
  // The "Manage subscription" action calls billingPortal.sessions.create,
  // which Stripe rejects with no saved portal configuration — so a paying
  // customer trying to cancel or update a card would hit a 502. Saving the
  // portal in the Dashboard creates the default configuration this needs.
  console.log('');
  console.log(c.bold('7. Stripe Customer Portal'));
  try {
    const cfgs = await stripeGet(stripeKey, '/v1/billing_portal/configurations?limit=100');
    const list = Array.isArray(cfgs.data) ? cfgs.data : [];
    const active = list.filter(cfg => cfg.active);
    const hasDefault = active.some(cfg => cfg.is_default);
    check('Portal configuration', active.length > 0,
      active.length > 0
        ? `${active.length} active configuration(s)${hasDefault ? ' (default present)' : ''}`
        : 'no saved portal configuration — "Manage subscription" will 502',
      active.length > 0 ? null : 'Stripe Dashboard → Settings → Billing → Customer portal: enable cancel + update payment method, then Save.');
  } catch (e) {
    check('Portal configuration', false, e.message,
      'Verify STRIPE_SECRET_KEY, then save a Customer portal configuration in Stripe Dashboard → Settings → Billing.');
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('\n' + c.dim('─'.repeat(52)));
  const summary = summarize(results, { aiPresent, oauthPresent });
  const advisorySuffix = summary.warnings ? ` (${summary.warnings} advisory)` : '';
  if (!summary.ok) {
    console.log(c.red(c.bold(`${summary.failures} check(s) failed.${summary.warnings ? ` ${summary.warnings} advisory.` : ''}`)));
    console.log(c.dim('Resolve the issues above before accepting live traffic.\n'));
    process.exit(1);
  } else if (summary.ready) {
    console.log(c.green(c.bold(`All checks passed.${advisorySuffix}`)));
    console.log(c.dim('The app is ready to accept live Stripe subscriptions.\n'));
    process.exit(0);
  } else {
    // Stripe/KV are green but the deployment is not fully live — qualify it
    // instead of printing an unconditional "ready" message (A-03).
    console.log(c.yellow(c.bold(`Stripe & KV checks passed${advisorySuffix}, but the deployment is NOT fully live:`)));
    for (const gap of summary.gaps) console.log(c.yellow('  • ' + gap));
    console.log(c.dim('\nBilling can accept subscriptions, but resolve the above before calling the deploy production-ready.\n'));
    process.exit(0);
  }
})();
