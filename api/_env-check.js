/* Blueprint Buddy — startup environment variable audit.
 *
 * Called once at cold-start from each handler that has hard dependencies on
 * specific env vars. Logs a single grouped warning to stderr so operators
 * can diagnose misconfigured deployments in the Vercel Function logs without
 * hunting through individual 503 responses.
 *
 * Design rules:
 *   - Never throw — a missing var should degrade gracefully at the call site,
 *     not crash the entire process on boot.
 *   - Log once per process (cold start only); skip on subsequent warm invocations.
 *   - Emit actionable messages: each missing var gets a one-line remedy.
 *   - Keep this file zero-dependency (no require() calls at all).
 */
'use strict';

let checked = false;

const CHECKS = [
  // ── Auth ────────────────────────────────────────────────────────────────────
  {
    key: 'AUTH_SECRET',
    required: true,
    remedy: 'Run: openssl rand -hex 32  then add as AUTH_SECRET in Vercel → Settings → Environment Variables.'
  },
  // ── KV / Redis (Upstash) ────────────────────────────────────────────────────
  {
    key: 'KV_REST_API_URL',
    aliasKeys: ['UPSTASH_REDIS_REST_URL'],
    required: true,
    remedy: 'Add the Upstash Redis integration from the Vercel Marketplace — it injects KV_REST_API_URL automatically.'
  },
  {
    key: 'KV_REST_API_TOKEN',
    aliasKeys: ['UPSTASH_REDIS_REST_TOKEN'],
    required: true,
    remedy: 'Add the Upstash Redis integration from the Vercel Marketplace — it injects KV_REST_API_TOKEN automatically.'
  },
  // ── Stripe ──────────────────────────────────────────────────────────────────
  {
    key: 'STRIPE_SECRET_KEY',
    required: true,
    remedy: 'Add the Stripe integration, or paste the key from Stripe Dashboard → Developers → API keys.'
  },
  {
    key: 'STRIPE_PRO_MONTHLY_PRICE_ID',
    required: true,
    remedy: 'Create a recurring monthly Price for Blueprint Buddy Pro in the Stripe Dashboard and paste its price_... ID here.'
  },
  {
    key: 'STRIPE_PRO_YEARLY_PRICE_ID',
    required: true,
    remedy: 'Create a recurring yearly Price for Blueprint Buddy Pro in the Stripe Dashboard and paste its price_... ID here.'
  },
  {
    key: 'STRIPE_WEBHOOK_SECRET',
    required: true,
    remedy: 'Register https://YOUR-APP/api/stripe-webhook in the Stripe Dashboard → Webhooks. The signing secret (whsec_...) appears after registration.'
  },
  // ── Origin hardening ────────────────────────────────────────────────────────
  {
    key: 'APP_ORIGIN',
    required: false,  // degrades gracefully; warn but do not mark as error
    remedy: 'Set APP_ORIGIN=https://your-app.vercel.app to lock OAuth and Stripe redirect targets. When unset they are derived from the Host header.'
  }
];

function present(key, aliases) {
  if (process.env[key]) return true;
  return !!(aliases && aliases.some(a => process.env[a]));
}

function audit() {
  if (checked) return;
  checked = true;

  const missing = [];
  const advisory = [];

  for (const check of CHECKS) {
    if (present(check.key, check.aliasKeys)) continue;
    if (check.required) missing.push(check);
    else advisory.push(check);
  }

  if (missing.length === 0 && advisory.length === 0) {
    console.log('[Blueprint Buddy] All required environment variables are set.');
    return;
  }

  if (missing.length > 0) {
    console.error(
      '\n[Blueprint Buddy] MISSING REQUIRED ENVIRONMENT VARIABLES — affected features will return 503:\n' +
      missing.map(c => `  • ${c.key}\n    Fix: ${c.remedy}`).join('\n\n') +
      '\n'
    );
  }
  if (advisory.length > 0) {
    console.warn(
      '\n[Blueprint Buddy] ADVISORY — optional but recommended for production:\n' +
      advisory.map(c => `  • ${c.key}\n    Note: ${c.remedy}`).join('\n\n') +
      '\n'
    );
  }
}

module.exports = { audit };
