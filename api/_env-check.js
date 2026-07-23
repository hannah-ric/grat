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
  // ── AI proxy ─────────────────────────────────────────────────────────────────
  {
    key: 'ANTHROPIC_API_KEY',
    required: false,  // advisory: the app degrades to its built-in offline parser
    remedy: 'AI chat is unconfigured, so the app degrades to its built-in offline parser. Set ANTHROPIC_API_KEY to enable live AI.'
  },
  // ── Stripe ──────────────────────────────────────────────────────────────────
  {
    key: 'STRIPE_SECRET_KEY',
    required: true,
    remedy: 'Add the Stripe integration, or paste the key from Stripe Dashboard → Developers → API keys.'
  },
  // Credit packs are the current offer (api/billing.js?action=credits).
  {
    key: 'STRIPE_CREDIT_PACK_1_PRICE_ID',
    required: true,
    remedy: 'Create a one-time $9 Price ("1 blueprint credit") in the Stripe Dashboard and paste its price_... ID here.'
  },
  {
    key: 'STRIPE_CREDIT_PACK_3_PRICE_ID',
    required: true,
    remedy: 'Create a one-time Price for the 3-credit pack in the Stripe Dashboard and paste its price_... ID here.'
  },
  {
    key: 'STRIPE_CREDIT_PACK_10_PRICE_ID',
    required: true,
    remedy: 'Create a one-time Price for the 10-credit pack in the Stripe Dashboard and paste its price_... ID here.'
  },
  {
    key: 'STRIPE_CREDIT_PACK_25_PRICE_ID',
    required: true,
    remedy: 'Create a one-time Price for the 25-credit pack in the Stripe Dashboard and paste its price_... ID here.'
  },
  // Legacy subscription prices — kept configured and dormant (existing
  // subscribers are honored; the plan is no longer sold).
  {
    key: 'STRIPE_PRO_MONTHLY_PRICE_ID',
    required: false,
    remedy: 'Legacy Pro monthly price (dormant). Keep it set so grandfathered subscriptions keep working.'
  },
  {
    key: 'STRIPE_PRO_YEARLY_PRICE_ID',
    required: false,
    remedy: 'Legacy Pro yearly price (dormant). Keep it set so grandfathered subscriptions keep working.'
  },
  // The AI spend backstop (E-07a). Advisory: unset = disabled.
  {
    key: 'AI_MONTHLY_TOKEN_BUDGET',
    required: false,
    remedy: 'No monthly output-token ceiling is set for the AI proxy. Set AI_MONTHLY_TOKEN_BUDGET (e.g. 2000000) as a backstop, and ALSO set a spend limit in the Anthropic Console — the console limit is a human step nothing in this repo can perform.'
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

/* Pure evaluation of the current environment — no logging, no once-guard — so
 * it is unit-testable. Returns the missing (required) and advisory (optional but
 * recommended) checks for the process env as it stands right now. */
function evaluate() {
  const missing = [];
  const advisory = [];

  for (const check of CHECKS) {
    if (present(check.key, check.aliasKeys)) continue;
    if (check.required) missing.push(check);
    else advisory.push(check);
  }

  // Sign-in availability. Email + password (api/_passwords.js) works on
  // AUTH_SECRET + a KV store alone, so the front door is open as soon as those
  // required vars are set — even with no OAuth app. OAuth is a PAIR check (at
  // least one of Google/GitHub with BOTH id + secret) and is purely additive.
  const passwordAuthPresent = !!process.env.AUTH_SECRET &&
    (!!(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) &&
     !!(process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN));
  const oauthPresent =
    !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) ||
    !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
  if (!oauthPresent) advisory.push({
    key: 'OAuth provider (Google or GitHub)',
    remedy: passwordAuthPresent
      ? 'No OAuth client pair is configured. Email + password sign-in already works, so accounts and billing are reachable; adding GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (or the GitHub pair) offers one-click social sign-in too.'
      : 'No sign-in method is configured, so no one can sign in and billing/Pro checkout is unreachable. Either set AUTH_SECRET + a KV store (enables email + password) or add GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (or the GitHub pair).'
  });

  return { missing, advisory };
}

function audit() {
  if (checked) return;
  checked = true;

  const { missing, advisory } = evaluate();

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

module.exports = { audit, evaluate };
