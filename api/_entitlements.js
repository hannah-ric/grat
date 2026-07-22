'use strict';

const KV = require('./_kv.js');
const Credits = require('./_credits.js');

// This is the AUTHORITY for entitlements. src/billing.js keeps a display-only
// mirror (TIERS) for pre-fetch/offline rendering — keep the two in sync.
//
// Credits pivot (2026-07): the OFFER is credits (api/_credits.js — one credit
// buys one blueprint via api/blueprint.js). aiMonthlyLimit is now an ABUSE
// CEILING only — it protects the proxy key from runaway use; it does not
// define the product and the client never sells an upgrade against it.
// premiumExports/advancedFeatures are gone as purchase gates: access to
// Build mode and exports is decided by whether the DESIGN is credited.
const FREE = Object.freeze({
  plan: 'free', label: 'Free', projectLimit: 3, aiMonthlyLimit: 200
});
// Legacy tier for grandfathered active subscriptions — the Stripe
// subscription paths stay in place and dormant (prices kept, not deleted).
const PRO = Object.freeze({
  plan: 'pro', label: 'Pro', projectLimit: null, aiMonthlyLimit: 500
});
const ACTIVE_STATUSES = new Set(['active', 'trialing']);

const subscriptionKey = uid => `bb:${uid}:subscription`;
const usageKey = (uid, month) => `bb:${uid}:usage:ai:${month}`;
const tokenUsageKey = (uid, month) => `bb:${uid}:usage:tokens:${month}`;
const monthId = (date = new Date()) => date.toISOString().slice(0, 7);
const secondsUntilMonthEnd = () => {
  const now = new Date();
  return Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) - now.getTime()) / 1000) + 86400;
};

async function getSubscription(uid) {
  const kv = KV.backend();
  if (!kv || !uid) return null;
  const raw = await kv.get(subscriptionKey(uid));
  if (!raw) return null;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (error) { return null; }
}

async function setSubscription(uid, subscription) {
  const kv = KV.backend();
  if (!kv) throw new Error('storage_unconfigured');
  await kv.set(subscriptionKey(uid), JSON.stringify(subscription));
}

async function getUsage(uid) {
  const kv = KV.backend();
  const month = monthId();
  if (!kv || !uid) return { month, aiMessages: 0 };
  return { month, aiMessages: Number(await kv.get(usageKey(uid, month)) || 0) };
}

async function incrementAI(uid) {
  const kv = KV.backend();
  if (!kv || !uid) return 0;
  const key = usageKey(uid, monthId());
  const count = Number(await kv.incr(key));
  if (count === 1 && kv.expire) await kv.expire(key, secondsUntilMonthEnd());
  return count;
}

/* Optional monthly output-token spend meter (drives api/chat's AI_MONTHLY_TOKEN_BUDGET
 * ceiling, E-07a). Keyed under the reserved usage: namespace so it is not
 * user-writable via /api/store (E-02). Expires with the calendar month like the
 * message meter. Disabled sites never call these, so no counter is written. */
async function getTokenUsage(uid) {
  const kv = KV.backend();
  const month = monthId();
  if (!kv || !uid) return { month, tokens: 0 };
  return { month, tokens: Number(await kv.get(tokenUsageKey(uid, month)) || 0) };
}

async function addTokens(uid, n) {
  const kv = KV.backend();
  const amount = Math.max(0, Math.floor(Number(n) || 0));
  if (!kv || !uid || amount === 0 || !kv.incrby) return 0;
  const key = tokenUsageKey(uid, monthId());
  const total = Number(await kv.incrby(key, amount));
  if (total === amount && kv.expire) await kv.expire(key, secondsUntilMonthEnd());
  return total;
}

async function statusFor(uid) {
  const [subscription, usage, credits] = await Promise.all([
    getSubscription(uid), getUsage(uid),
    Credits.state(uid).catch(() => ({ configured: false, balance: 0, purchased: 0 }))
  ]);
  const isPro = !!(subscription && ACTIVE_STATUSES.has(subscription.status));
  let entitlements = isPro ? PRO : FREE;
  // A paying credits customer is not project-capped: anyone who has ever
  // purchased a pack keeps unlimited saved projects (the old Pro perk moves
  // to the new paying cohort so no capability becomes unreachable).
  if (!isPro && credits.purchased > 0) entitlements = Object.freeze(Object.assign({}, FREE, { projectLimit: null }));
  return {
    plan: entitlements.plan,
    entitlements,
    usage,
    credits: { balance: credits.balance, purchased: credits.purchased },
    subscription: subscription ? {
      status: subscription.status,
      interval: subscription.interval || null,
      currentPeriodEnd: subscription.currentPeriodEnd || null,
      cancelAtPeriodEnd: !!subscription.cancelAtPeriodEnd
    } : null
  };
}

module.exports = { FREE, PRO, ACTIVE_STATUSES, getSubscription, setSubscription, getUsage, incrementAI, getTokenUsage, addTokens, statusFor };
