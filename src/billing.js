var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';

  // Mirror of api/_entitlements.js + api/_credits.js. The SERVER is the
  // authority — the client always prefers a fetched billing payload; these
  // values only drive display before/without a fetch (offline, anonymous,
  // first paint). There is no shared module across the client/server runtime
  // split, so keep the two in sync.
  //
  // Credits pivot (2026-07): the offer is CREDITS — one credit buys one
  // blueprint (a design committed at first plan issuance, refinable free for
  // 30 days, re-downloadable free forever; credits expire 12 months after
  // purchase, never monthly). premiumExports/advancedFeatures are gone as
  // purchase gates: access is decided by whether the DESIGN is credited.
  const TIERS = {
    free: { plan: 'free', label: 'Free', projectLimit: 3, aiMonthlyLimit: 200 },
    pro: { plan: 'pro', label: 'Pro', projectLimit: null, aiMonthlyLimit: 500 } // legacy, honored not sold
  };
  const FREE = TIERS.free;
  // Launch pricing (display only — the Stripe Prices are authoritative).
  const CREDIT_PACKS = [
    { n: 1, price: 9, note: '$9 per blueprint' },
    { n: 3, price: 24, note: '$8 each' },
    { n: 10, price: 69, note: '$6.90 each' },
    { n: 25, price: 149, note: '$5.96 each' }
  ];
  const WINDOW_DAYS = 30;

  const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  let dialog = null;

  function account() { return BB.Store && BB.Store.auth ? BB.Store.auth() : { user: null, billing: null }; }
  function status() { return account().billing || { plan: 'free', entitlements: FREE, usage: { aiMessages: 0 }, credits: null }; }
  function isPro() { return status().plan === 'pro'; } // legacy badge only
  /* The credit balance, or null when the server has not told us yet. */
  function credits() {
    const c = status().credits;
    return c && typeof c.balance === 'number' ? c.balance : null;
  }

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

  /* POST the design to /api/blueprint. The server validates FIRST, charges
   * second, renders third, refunds on failure — this client never decides
   * whether a charge lands; it only reports what the server said. */
  async function issue(payload) {
    const response = await fetch('/api/blueprint', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    const data = await response.json().catch(() => ({}));
    data.httpStatus = response.status;
    return data;
  }

  async function buyPack(n) {
    try {
      const data = await api('credits', { pack: n });
      if (data.url) window.location.href = data.url;
    } catch (error) {
      setNote(error.message === 'price_unconfigured'
        ? 'Credit packs are not configured on this site yet.'
        : 'Purchase is temporarily unavailable. Please try again.');
    }
  }

  function ensureDialog() {
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.className = 'pricing-dialog';
    dialog.setAttribute('aria-labelledby', 'pricingTitle');
    const packCards = CREDIT_PACKS.map(p => `
        <section class="price-card${p.n === 3 ? ' featured' : ''}" aria-label="${p.n} credit${p.n > 1 ? 's' : ''}">
          <div><span class="plan-label">${p.n} credit${p.n > 1 ? 's' : ''}</span><strong>$${p.price}</strong><small>${escapeHTML(p.note)}</small></div>
          <button class="btn${p.n === 3 ? ' primary' : ''}" data-pack="${p.n}">Buy ${p.n === 1 ? 'one credit' : p.n + ' credits'}</button>
        </section>`).join('');
    dialog.innerHTML = `<div class="pricing-shell">
      <button class="pricing-close" data-pricing-close aria-label="Close pricing">&times;</button>
      <header class="pricing-head">
        <span class="pricing-kicker">Blueprint credits</span>
        <h2 id="pricingTitle">One credit. One complete blueprint.</h2>
        <p>A credit buys this design's full blueprint: the sheet set, exact cut list, stock plan with cutting
        diagrams, joinery setout, assembly steps, every export format, and the full-screen shop companion.</p>
        <p data-credit-balance class="pricing-balance"></p>
      </header>
      <div class="pricing-grid pricing-grid-credits">${packCards}</div>
      <ul class="pricing-facts">
        <li>Refine a credited design free for ${WINDOW_DAYS} days — a single refinement can use several AI messages as the model iterates, and that iteration is included, never billed.</li>
        <li>Re-download your issued blueprints free, forever.</li>
        <li>The same design never charges twice. A failed design is never charged at all.</li>
        <li>Credits last 12 months. They never reset monthly.</li>
        <li data-free-sync>Signing up is free and includes your first credit.</li>
      </ul>
      <p class="pricing-note" data-billing-note>Secure checkout by Stripe.</p>
    </div>`;
    document.body.append(dialog);
    dialog.addEventListener('click', event => {
      if (event.target === dialog || event.target.closest('[data-pricing-close]')) dialog.close();
      const pack = event.target.closest('[data-pack]');
      if (pack) {
        if (!account().user) {
          // Never close silently: surface a visible cue in the note area, and
          // only redirect when a sign-in provider actually exists (A-02/X-03).
          const plan = signedOutUpgradeNote(account());
          setNote(plan.note);
          if (plan.redirect) openSignIn();
          return;
        }
        buyPack(Number(pack.dataset.pack));
      }
    });
    return dialog;
  }

  function open(reason) {
    ensureDialog();
    const note = dialog.querySelector('[data-billing-note]');
    note.textContent = reason ? escapeHTML(reason) : 'Secure checkout by Stripe.';
    const sync = dialog.querySelector('[data-free-sync]');
    if (sync) sync.textContent = freeSyncLabel(account()) === 'Device and cloud sync'
      ? 'Signing up is free and includes your first credit — projects follow you to any device.'
      : 'Signing up is free and includes your first credit.';
    const bal = dialog.querySelector('[data-credit-balance]');
    if (bal) {
      const b = credits();
      bal.textContent = account().user
        ? (b === null ? '' : `You have ${b} credit${b === 1 ? '' : 's'}.`)
        : 'Sign in free to claim your first credit.';
    }
    dialog.showModal();
  }

  /* Confirm-before-spend (never spend silently): names the piece, shows the
   * balance after, and states the idempotency guarantee. Resolves true only
   * on the explicit confirm. */
  function confirmIssue(opts) {
    opts = opts || {};
    return new Promise(resolve => {
      const d = document.createElement('dialog');
      d.className = 'pricing-dialog spend-confirm';
      d.setAttribute('aria-labelledby', 'spendTitle');
      const balance = typeof opts.balance === 'number' ? opts.balance : credits();
      const after = balance === null ? null : balance - 1;
      d.innerHTML = `<div class="pricing-shell">
        <header class="pricing-head">
          <span class="pricing-kicker">Issue blueprint</span>
          <h2 id="spendTitle">Issue “${escapeHTML(opts.name || 'this design')}” for 1 credit?</h2>
          <p>You get the complete sheet set, exact cut list, stock plan, joinery setout, assembly steps,
          all exports, and the shop companion — plus free refinement of this design for ${WINDOW_DAYS} days
          and free re-downloads forever.</p>
          <p class="pricing-balance">${balance === null ? '' : `Balance after: ${after} credit${after === 1 ? '' : 's'}.`}
          If this exact design was already issued, no credit is used.</p>
        </header>
        <div class="spend-actions">
          <button class="btn" data-spend-cancel>Not now</button>
          <button class="btn primary" data-spend-confirm>Issue blueprint — 1 credit</button>
        </div>
      </div>`;
      document.body.append(d);
      const done = value => { try { d.close(); } catch (e) { /* already closed */ } d.remove(); resolve(value); };
      d.addEventListener('click', event => {
        if (event.target === d || event.target.closest('[data-spend-cancel]')) done(false);
        if (event.target.closest('[data-spend-confirm]')) done(true);
      });
      d.addEventListener('cancel', () => done(false));
      d.showModal();
      const confirm = d.querySelector('[data-spend-confirm]');
      if (confirm) confirm.focus();
    });
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

  /* Signed-out purchase: decide what the dialog should say/do. Pure so the
   * honest-copy contract is unit-testable without a DOM. When a provider exists
   * we hand off to sign-in (leaving a cue so a failed redirect never vanishes);
   * with no provider configured we say so plainly instead of closing the
   * dialog with nothing happening. */
  function signedOutUpgradeNote(a) {
    const provider = a && a.providers && a.providers[0];
    return provider
      ? { redirect: true, note: 'Taking you to sign in — your first credit is free, and you can buy more once you are signed in.' }
      : { redirect: false, note: "Sign-in isn't available on this site yet, so credits can't be purchased here." };
  }

  /* Free-tier sync bullet: cloud sync needs a sign-in provider, so on a
   * providerless deployment the honest promise is device-only sync (A-08). */
  function freeSyncLabel(a) {
    return (a && a.providers && a.providers.length) ? 'Device and cloud sync' : 'Device sync';
  }

  /* Billing is "configured" only when the origin gave us evidence: a billing
   * payload or sign-in providers (mirror of ui.js billingConfigured). A static
   * or providerless host cannot sell credits — its purchase path is an honest
   * dead-end — so it must never gate anything (C-01). The SERVER stays the
   * entitlement authority whenever billing is real. */
  function configured() {
    const a = account();
    return !!(a.billing || (a.providers && a.providers.length));
  }

  async function gateNewProject() {
    const limit = status().entitlements.projectLimit;
    if (limit === null || limit === undefined) return true;
    const projects = await BB.Store.loadIndex();
    if (projects.length < limit) return true;
    open(`Free includes ${limit} saved projects. Export a share code to keep this one, or any credit purchase lifts the limit.`);
    return false;
  }

  async function handleReturn() {
    const params = new URLSearchParams(window.location.search);
    if (!params.get('billing')) return;
    await refresh();
    history.replaceState(null, '', window.location.pathname + window.location.hash);
  }

  BB.Billing = {
    status, isPro, credits, refresh, open, confirmIssue, issue, buyPack, configured,
    gateNewProject, manage: () => api('portal', {}).then(d => { if (d.url) window.location.href = d.url; }).catch(() => setNote('Billing is temporarily unavailable.')),
    handleReturn, signedOutUpgradeNote, freeSyncLabel,
    CREDIT_PACKS, WINDOW_DAYS
  };
})();
