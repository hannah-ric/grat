var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';

  const FREE = { plan: 'free', projectLimit: 3, aiMonthlyLimit: 25, premiumExports: false, advancedFeatures: false };
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
          <ul><li>3 saved projects</li><li>25 AI messages per month</li><li>Core drawing and cut-list exports</li><li>Device and cloud sync</li></ul>
          <button class="btn" data-pricing-close>Keep Free</button>
        </section>
        <section class="price-card featured" aria-label="Pro plan">
          <div><span class="plan-label">Pro</span><strong data-price>$12</strong><small data-period>/ month, billed yearly</small></div>
          <ul><li>Unlimited saved projects</li><li>500 AI messages per month</li><li>Print plans, 3D and SketchUp exports</li><li>Structural reports and advanced workshop tools</li></ul>
          <button class="btn primary pricing-upgrade" data-upgrade>Upgrade to Pro</button>
        </section>
      </div>
      <p class="pricing-note" data-billing-note>Secure checkout by Stripe. Cancel or change plans anytime.</p>
    </div>`;
    document.body.append(dialog);
    dialog.addEventListener('click', event => {
      if (event.target === dialog || event.target.closest('[data-pricing-close]')) dialog.close();
      const cycle = event.target.closest('[data-cycle]');
      if (cycle) { interval = cycle.dataset.cycle; paintCycle(); }
      if (event.target.closest('[data-upgrade]')) {
        if (!account().user) { dialog.close(); openSignIn(); return; }
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
    paintCycle();
    dialog.showModal();
  }

  function openSignIn() {
    const a = account();
    const provider = a.providers && a.providers[0];
    if (provider) window.location.href = BB.Store.loginUrl(provider);
  }

  function gate(feature, reason) {
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

  BB.Billing = { status, isPro, entitled, refresh, open, gate, gateNewProject, manage: () => redirect('portal'), handleReturn };
})();
