var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';

  // Mirror of api/_entitlements.js. The SERVER is the authority — the client
  // always prefers a fetched billing payload; these values only drive display
  // before/without a fetch (offline, anonymous, first paint). There is no shared
  // module across the client/server runtime split, so keep the two in sync.
  const PLANS = {
    free: { plan: 'free', label: 'Free', projectLimit: 3, aiMonthlyLimit: 25, premiumExports: false, advancedFeatures: false },
    pro: { plan: 'pro', label: 'Pro', projectLimit: null, aiMonthlyLimit: 500, premiumExports: true, advancedFeatures: true }
  };
  const FREE = PLANS.free;
  const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  let dialog = null;
  let interval = 'year';

  function account() { return BB.Store && BB.Store.auth ? BB.Store.auth() : { user: null, billing: null }; }
  function status() { return account().billing || { plan: 'free', entitlements: FREE, usage: { aiMessages: 0 } }; }
  function isPro() { return status().plan === 'pro'; }
  function entitled(feature) { return !!status().entitlements[feature]; }

  async function api(action, body) {
    const response = await fetch('/api/billing?action=' + encodeURIComponent(action), {
      method: action === 'status' ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: action === 'status' ? undefined : JSON.stringify(body || {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Billing request failed');
    return data;
  }

  async function refresh() {
    if (!account().user) return status();
    try { BB.Store.setBilling(await api('status')); } catch (error) { /* keep last-known entitlements */ }
    return status();
  }

  async function redirect(action, body) {
    try {
      const data = await api(action, body);
      if (data.url) window.location.href = data.url;
    } catch (error) {
      const note = dialog && dialog.querySelector('[data-billing-note]');
      if (note) note.textContent = error.message === 'price_unconfigured' ? 'Billing prices are not configured yet.' : 'Billing is temporarily unavailable. Please try again.';
    }
  }

  function ensureDialog() {
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.className = 'pricing-dialog';
    dialog.setAttribute('aria-labelledby', 'pricingTitle');
    dialog.innerHTML = `<div class="pricing-shell">
      <button class="pricing-close" data-pricing-close aria-label="Close pricing">&times;</button>
      <header class="pricing-head">
        <span class="pricing-kicker">Blueprint Buddy Pro</span>
        <h2 id="pricingTitle">From idea to build day, without limits.</h2>
        <p>Keep every design, use the full AI workshop, and export production-ready plans.</p>
        <div class="billing-cycle" role="group" aria-label="Billing cycle">
          <button data-cycle="month" aria-pressed="false">Monthly</button>
          <button data-cycle="year" aria-pressed="true">Yearly <span>best value</span></button>
        </div>
      </header>
      <div class="pricing-grid">
        <section class="price-card" aria-label="Free plan">
          <div><span class="plan-label">Free</span><strong>$0</strong><small>forever</small></div>
          <ul><li>${FREE.projectLimit} saved projects</li><li>${FREE.aiMonthlyLimit} AI messages per month</li><li>Core drawing and cut-list exports</li><li data-free-sync>Device sync</li></ul>
          <button class="btn" data-pricing-close>Keep Free</button>
        </section>
        <section class="price-card featured" aria-label="Pro plan">
          <div><span class="plan-label">Pro</span><strong data-price>$12</strong><small data-period>/ month, billed yearly</small></div>
          <ul><li>Unlimited saved projects</li><li>${PLANS.pro.aiMonthlyLimit} AI messages per month</li><li>Print plans, 3D and SketchUp exports</li><li>Full-screen Build mode</li></ul>
          <button class="btn primary pricing-upgrade" data-upgrade>Upgrade to Pro</button>
        </section>
      </div>
      <p class="pricing-note">A single design refinement can use several AI messages as the model iterates.</p>
      <p class="pricing-note" data-billing-note>Secure checkout by Stripe. Cancel or change plans anytime.</p>
    </div>`;
    document.body.append(dialog);
    dialog.addEventListener('click', event => {
      if (event.target === dialog || event.target.closest('[data-pricing-close]')) dialog.close();
      const cycle = event.target.closest('[data-cycle]');
      if (cycle) { interval = cycle.dataset.cycle; paintCycle(); }
      if (event.target.closest('[data-upgrade]')) {
        if (!account().user) {
          // Never close silently: surface a visible cue in the note area, and
          // only redirect when a sign-in provider actually exists (A-02/X-03).
          const plan = signedOutUpgradeNote(account());
          setNote(plan.note);
          if (plan.redirect) openSignIn();
          return;
        }
        redirect('checkout', { interval });
      }
    });
    return dialog;
  }

  function paintCycle() {
    if (!dialog) return;
    for (const button of dialog.querySelectorAll('[data-cycle]')) button.setAttribute('aria-pressed', String(button.dataset.cycle === interval));
    dialog.querySelector('[data-price]').textContent = interval === 'year' ? '$12' : '$15';
    dialog.querySelector('[data-period]').textContent = interval === 'year' ? '/ month, billed yearly' : '/ month';
  }

  function open(reason) {
    ensureDialog();
    const note = dialog.querySelector('[data-billing-note]');
    note.textContent = reason ? escapeHTML(reason) : 'Secure checkout by Stripe. Cancel or change plans anytime.';
    // Reflect the current sign-in reality every time the dialog opens (the auth
    // probe may have resolved after the dialog was first built).
    const sync = dialog.querySelector('[data-free-sync]');
    if (sync) sync.textContent = freeSyncLabel(account());
    paintCycle();
    dialog.showModal();
  }

  function openSignIn() {
    const a = account();
    const provider = a.providers && a.providers[0];
    if (provider) window.location.href = BB.Store.loginUrl(provider);
  }

  function setNote(message) {
    const note = dialog && dialog.querySelector('[data-billing-note]');
    if (note) note.textContent = message;
  }

  /* Signed-out Upgrade: decide what the dialog should say/do. Pure so the
   * honest-copy contract is unit-testable without a DOM. When a provider exists
   * we hand off to sign-in (leaving a cue so a failed redirect never vanishes);
   * with no provider configured (the current production state) we say so plainly
   * instead of closing the dialog with nothing happening. */
  function signedOutUpgradeNote(a) {
    const provider = a && a.providers && a.providers[0];
    return provider
      ? { redirect: true, note: 'Taking you to sign in — you can upgrade once you are signed in.' }
      : { redirect: false, note: "Sign-in isn't available on this site yet, so upgrading isn't possible here." };
  }

  /* Free-plan sync bullet: cloud sync needs a sign-in provider, so on a
   * providerless deployment the honest promise is device-only sync (A-08). */
  function freeSyncLabel(a) {
    return (a && a.providers && a.providers.length) ? 'Device and cloud sync' : 'Device sync';
  }

  /* Billing is "configured" only when the origin gave us evidence: a billing
   * payload or sign-in providers (mirror of ui.js billingConfigured). A static
   * or providerless host cannot sell Pro — its Upgrade path is an honest
   * dead-end — so it must never gate either (C-01). The SERVER stays the
   * entitlement authority whenever billing is real. */
  function configured() {
    const a = account();
    return !!(a.billing || (a.providers && a.providers.length));
  }

  function gate(feature, reason) {
    if (!configured()) return true;
    if (isPro() || entitled(feature)) return true;
    open(reason || 'This is a Pro feature.');
    return false;
  }

  async function gateNewProject() {
    const limit = status().entitlements.projectLimit;
    if (limit === null || limit === undefined) return true;
    const projects = await BB.Store.loadIndex();
    if (projects.length < limit) return true;
    open(`Free includes ${limit} saved projects. Upgrade for unlimited projects.`);
    return false;
  }

  async function handleReturn() {
    const params = new URLSearchParams(window.location.search);
    if (!params.get('billing')) return;
    await refresh();
    history.replaceState(null, '', window.location.pathname + window.location.hash);
  }

  BB.Billing = { status, isPro, entitled, refresh, open, gate, gateNewProject, manage: () => redirect('portal'), handleReturn, signedOutUpgradeNote, freeSyncLabel };
})();
