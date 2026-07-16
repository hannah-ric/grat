'use strict';

const KV = require('./_kv.js');

const FREE = Object.freeze({
  plan: 'free', label: 'Free', projectLimit: 3, aiMonthlyLimit: 25,
  premiumExports: false, advancedFeatures: false
});
const PRO = Object.freeze({
  plan: 'pro', label: 'Pro', projectLimit: null, aiMonthlyLimit: 500,
  premiumExports: true, advancedFeatures: true
});
const ACTIVE_STATUSES = new Set(['active', 'trialing']);

const subscriptionKey = uid => `bb:${uid}:subscription`;
const usageKey = (uid, month) => `bb:${uid}:usage:ai:${month}`;
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

async function statusFor(uid) {
  const [subscription, usage] = await Promise.all([getSubscription(uid), getUsage(uid)]);
  const isPro = !!(subscription && ACTIVE_STATUSES.has(subscription.status));
  const entitlements = isPro ? PRO : FREE;
  return {
    plan: entitlements.plan,
    entitlements,
    usage,
    subscription: subscription ? {
      status: subscription.status,
      interval: subscription.interval || null,
      currentPeriodEnd: subscription.currentPeriodEnd || null,
      cancelAtPeriodEnd: !!subscription.cancelAtPeriodEnd
    } : null
  };
}

module.exports = { FREE, PRO, ACTIVE_STATUSES, getSubscription, setSubscription, getUsage, incrementAI, statusFor };
