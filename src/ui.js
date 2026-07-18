/* Blueprint Buddy — UI shell. All DOM wiring lives here; every design change
 * flows through commit() so AI edits, inspector edits, integrity fixes, and
 * history restores share one spec and one history stack.
 * Phase 4 surfaces: Integrity tab, Stock tab, My Projects, share codes,
 * build mode, photo-to-design, diagnostics panel, provenance popovers,
 * species comparison, debounced autosave. */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';
  const { Spec, Parametric, Plans, Exports, History, AI, K, Gallery, Codec, Store, Structural, Packing, Prov, Compare, Units } = BB;
  const $ = id => document.getElementById(id);
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  };
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* ---------------- state ---------------- */
  const state = {
    spec: null, model: null, report: null,
    cut: [], bomData: { items: [], total: 0 }, steps: [],
    integrity: null, stockPlan: null,
    history: null, engine: null,
    mode: 'design',
    tab: 'overview', refTab: 'wood', refQuery: '',
    dismissed: new Set(),
    selected: null,
    playbackIndex: -1,
    compare: null,
    busy: false,
    firstRun: true,
    previewing: false,
    advisoriesExpanded: false,
    // Phase 4
    turns: [],                      // AI conversation, wire format
    loadChoices: {},                // per-surface load presets
    prices: K.defaultPrices(),
    prefs4: JSON.parse(JSON.stringify(Store.DEFAULT_PREFS)),
    project: null,                  // {id, progress:{cuts:{},steps:{}}}
    buildMode: false, bmPlayback: false,
    bmTask: null,                   // phone pager position (derived on entry)
    installPrompt: null,            // stashed beforeinstallprompt event
    wakeLock: null,
    speciesPick: [],
    capBannerDismissed: false,      // session-scoped: dismissed project-cap banner stays down
    userSplitTouched: false         // session-scoped: a touched splitter is never auto-fought (X-07)
  };
  const reduceMq = matchMedia('(prefers-reduced-motion: reduce)');
  const darkMq = matchMedia('(prefers-color-scheme: dark)');
  const mobileAdvisoryMq = matchMedia('(max-width: 880px)');
  const DEFAULT_CHAT_PEEK = 'Ask to change wood, size, or drawers...';

  // ALL displayed lengths go through BB.Units — the single mm→text boundary.
  const fmt = mm => Units.fmtLength(mm);
  const fmtS = mm => Units.fmtSmall(mm);

  /* ---------------- pipeline ---------------- */
  function runPipeline(raw) {
    const spec = Spec.correctSpec(raw);
    const model = Parametric.build(spec);
    const report = Spec.validate(spec, model);
    return { spec, model, report };
  }
  const integrityOpts = () => ({ loadChoices: state.loadChoices, defaultLoad: 'auto', climate: state.prefs4.climate });

  function adopt(r) {
    // The active design's unit choice IS the display system — sync the
    // formatter boundary before anything derived renders.
    Units.setSystem(r.spec.meta.units);
    state.spec = r.spec; state.model = r.model; state.report = r.report;
    state.integrity = Structural.computeIntegrity(r.spec, r.model, integrityOpts());
    state.cut = Plans.cutList(r.spec, r.model);
    state.stockPlan = Packing.planStock(r.spec, r.model, state.cut, { prices: state.prices, stockMode: state.prefs4.stockMode });
    state.bomData = Plans.bom(r.spec, r.model, { integrity: state.integrity, stock: state.stockPlan, prices: state.prices });
    state.steps = Plans.assembly(r.spec, r.model, state.integrity, { stockPlan: state.stockPlan, climate: state.prefs4.climate });
    // The checklist just changed shape: progress keys from an older stock
    // layout would otherwise inflate the build percentage forever.
    if (state.project) Plans.pruneProgress(state.project.progress, Plans.checklistKeys(state.stockPlan, state.cut, state.steps));
    state.engine.setModel(r.model, r.spec);
  }
  /* Recompute derived layers for the SAME spec (load presets, prices,
   * climate changed) — no history entry. */
  function recompute() {
    adopt(runPipeline(state.spec));
    renderPanel();
    renderTabs();
  }

  /* Single entry point for every accepted change. Returns false when blocked. */
  function commit(raw, source, summary) {
    const r = runPipeline(raw);
    if (r.report.errors.length) {
      renderAdvisories(r.report);
      return false;
    }
    exitPlayback();
    clearCompare();
    hideWelcome(); // a committed design is a chosen path
    state.previewing = false; // any pending slider preview is superseded by this commit
    state.advisoriesExpanded = false; // a new change re-folds the warning stack
    adopt(r);
    state.history.push(r.spec, source, summary);
    renderAll();
    scheduleAutosave();
    return true;
  }

  /* Live preview during slider drags: full pipeline, no history entry. */
  function preview(raw) {
    const r = runPipeline(raw);
    if (r.report.errors.length) return false;
    adopt(r);
    state.previewing = true;
    renderAdvisories(r.report);
    renderPanel();
    renderTopbar();
    return true;
  }
  function commitPreview(source) {
    if (!state.previewing) return;
    state.previewing = false;
    state.history.push(state.spec, source);
    renderHistory();
    renderTopbar();
    scheduleAutosave();
  }

  function restoreTo(spec) {
    exitPlayback();
    clearCompare(); // undo/redo/restore must never leave a stale ghost + banner
    state.previewing = false; // a restore discards any uncommitted preview
    const r = runPipeline(spec);
    adopt(r);
    renderAll();
    scheduleAutosave();
  }

  function merge(patch, source, summary) {
    return commit(Spec.deepMerge(state.spec, patch), source, summary);
  }

  /* ---------------- autosave (Phase 4) ----------------
   * Debounced on every accepted change; silent when storage is absent. */
  let saveTimer = null;
  function progressPct() {
    if (!state.project) return 0;
    // Count only keys that exist in the live checklist — never orphans from
    // an older stock layout, never boards the checklist can't render.
    const keys = Plans.checklistKeys(state.stockPlan, state.cut, state.steps);
    const total = keys.cuts.length + keys.steps.length;
    if (!total) return 0;
    const done = keys.cuts.filter(k => state.project.progress.cuts[k]).length +
      keys.steps.filter(k => state.project.progress.steps[k]).length;
    return Math.min(100, Math.round(100 * done / total));
  }
  function paintSavePulse(kind) {
    const dot = $('saveDot');
    if (dot) {
      dot.hidden = false;
      dot.classList.toggle('on', kind === 'on' || kind === 'pending');
      dot.classList.toggle('pending', kind === 'pending');
      dot.classList.toggle('err', kind === 'err');
    }
  }
  function scheduleAutosave() {
    clearTimeout(saveTimer);
    // Honest feedback across the debounce: "saving…" until the write lands.
    const elS = $('saveState');
    clearTimeout(saveFlashTimer);
    elS.textContent = 'saving…';
    elS.classList.remove('err');
    elS.classList.add('on', 'pending');
    paintSavePulse('pending');
    saveTimer = setTimeout(doAutosave, 700);
  }
  /* Free project cap on the AUTOSAVE path (A-04): the pricing dialog opens at
   * most once per session from here — every later blocked save paints only the
   * passive indicator + banner, and nothing is ever lost silently: the state
   * names the share-code way out. (Interactive paths like Duplicate keep the
   * ordinary BB.Billing.gateNewProject dialog — those are user-initiated.) */
  let capModalShown = false;
  function projectCapBlocked(limit) {
    paintSaveBlocked(limit);
    if (!capModalShown) {
      capModalShown = true;
      BB.Billing.open(`Free includes ${limit} saved projects, so this design isn't being saved. Export a share code to keep it, or upgrade for unlimited projects.`);
    }
  }
  function paintSaveBlocked(limit) {
    clearTimeout(saveFlashTimer);
    const elS = $('saveState');
    elS.textContent = 'not saved — project limit';
    elS.title = `You're at the Free limit of ${limit} saved projects, so this design is not being saved. Export a share code (Share) to keep it, or upgrade for unlimited projects.`;
    elS.classList.remove('pending');
    elS.classList.add('on', 'err');
    paintSavePulse('err');
    const banner = $('capBanner');
    if (banner && !state.capBannerDismissed) banner.hidden = false;
  }
  async function autosaveCapAllows() {
    const limit = BB.Billing.status().entitlements.projectLimit;
    if (limit === null || limit === undefined) return true;
    const projects = await Store.loadIndex();
    if (projects.length < limit) return true;
    projectCapBlocked(limit);
    return false;
  }
  async function doAutosave() {
    try {
      if (!state.project && !(await autosaveCapAllows())) return;
      if (!state.project) state.project = { id: Store.newId(), progress: { cuts: {}, steps: {} } };
      const revisions = state.history.snapshots.slice(-Store.MAX_REVISIONS).map(s => ({
        ts: s.ts, source: s.source, summary: (s.summary || []).slice(0, 3), wire: Codec.encode(s.spec)
      }));
      const thumb = Store.makeThumb(state.engine.renderNow());
      await Store.saveProject({
        id: state.project.id, name: state.spec.meta.name,
        wire: Codec.encode(state.spec), revisions,
        progress: state.project.progress, thumb,
        dims: `${fmt(state.spec.overall.width)} × ${fmt(state.spec.overall.depth)} × ${fmt(state.spec.overall.height)}`,
        progressPct: progressPct()
      });
      // The cloud rung may have refused the doc by policy (server-side Free
      // cap, A-10) while the local mirror landed — never report that as a
      // clean save: same visible state as the client-side cap (A-04).
      const denial = Store.consumeWriteDenial ? Store.consumeWriteDenial() : null;
      if (denial && denial.error === 'project_limit') {
        projectCapBlocked(denial.limit || BB.Billing.status().entitlements.projectLimit || 3);
        return;
      }
      flashSave(Store.isPersistent());
    } catch (e) { flashSave(false); }
  }
  let saveFlashTimer = null;
  function flashSave(persistent) {
    // A save landed: the project-cap block (if any) has resolved.
    const banner = $('capBanner');
    if (banner) banner.hidden = true;
    state.capBannerDismissed = false;
    const elS = $('saveState');
    const mode = Store.persistenceMode();
    elS.textContent = !persistent ? 'session only' : mode === 'cloud' ? 'saved · cloud' : 'saved';
    elS.title = !persistent
      ? 'Storage is unavailable — this design lives for this session only. Export a share code to keep it.'
      : mode === 'cloud'
        ? 'Autosaved to your account — projects follow you to any device.'
        : 'Autosaved to this device — find it under More › Projects';
    elS.classList.toggle('err', !persistent);
    elS.classList.remove('pending');
    elS.classList.add('on');
    paintSavePulse(!persistent ? 'err' : 'on');
    clearTimeout(saveFlashTimer);
    saveFlashTimer = setTimeout(() => {
      elS.classList.remove('on');
      const dot = $('saveDot');
      if (dot) { dot.classList.remove('on', 'pending', 'err'); dot.hidden = true; }
    }, 1600);
  }

  /* ---------------- account (optional cloud persistence) ----------------
   * Rendered inside the More menu. The section exists only when the origin
   * actually offers accounts (providers configured server-side) — a static
   * host or claude.ai shows nothing at all. */
  const PROVIDER_LABELS = { google: 'Google', github: 'GitHub', dev: 'Dev (local)' };
  /* Billing is "configured" when the origin gave us any billing evidence: a
   * billing payload (fetched or pushed by the chat proxy) or sign-in
   * providers. Static hosts and claude.ai stay quiet as before (A-05). */
  function billingConfigured(a) {
    return !!(a.billing || (a.providers && a.providers.length));
  }
  /* Compact AI-allowance meter (A-05): rendered only when billing is real AND
   * usage is known (> 0) — Free users see the wall coming instead of slamming
   * into it. Lives under the chat input, the quietest surface next to where
   * the messages are spent. */
  function renderUsageMeter() {
    const box = $('aiUsage');
    if (!box) return;
    const b = BB.Billing.status();
    const limit = b.entitlements && b.entitlements.aiMonthlyLimit;
    const used = b.usage && b.usage.aiMessages;
    const show = billingConfigured(Store.auth()) && typeof used === 'number' && used > 0 && !!limit;
    box.hidden = !show;
    if (!show) { box.textContent = ''; return; }
    const left = Math.max(0, limit - used);
    box.innerHTML = `<span class="ai-usage-count">${left} of ${limit}</span> AI messages left this month` +
      (b.plan === 'free' ? ` · <button type="button" class="learn-link" id="aiUsageUpgrade">Upgrade</button>` : '');
    box.title = 'AI messages are metered per calendar month. A single design refinement can use several messages as the model iterates.';
    const up = $('aiUsageUpgrade');
    if (up) up.onclick = () => BB.Billing.open();
  }
  function renderAccount() {
    const area = $('accountArea'), sep = $('accountSep');
    if (!area) return;
    renderUsageMeter();
    renderReadiness(); // the Build lock (X-04) follows the same billing evidence
    const a = Store.auth();
    const configured = billingConfigured(a);
    const show = !!(a.user || (a.providers.length && a.storage) || configured);
    area.hidden = !show;
    sep.hidden = !show;
    area.textContent = '';
    if (!show) return;
    if (a.user) {
      const row = el('div', 'menu-account');
      const plan = a.billing && a.billing.plan === 'pro' ? 'Pro' : 'Free';
      row.innerHTML = `${a.user.avatar ? `<img class="account-avatar" src="${esc(a.user.avatar)}" alt="" referrerpolicy="no-referrer">` : `<span class="account-avatar fallback" aria-hidden="true">${BB.Icons.svg('user', 14)}</span>`}
        <span class="account-name">${esc(a.user.name)}</span>
        <span class="plan-badge">${plan}</span>`;
      area.append(row);
      const billingBtn = el('button', '', plan === 'Pro'
        ? '<span>Manage subscription</span><span class="hint">billing & plan</span>'
        : '<span>Upgrade to Pro</span><span class="hint">unlock everything</span>');
      billingBtn.setAttribute('role', 'menuitem');
      billingBtn.onclick = () => plan === 'Pro' ? BB.Billing.manage() : BB.Billing.open();
      area.append(billingBtn);
      const out = el('button', '', '<span>Sign out</span><span class="hint">this device</span>');
      out.setAttribute('role', 'menuitem');
      out.onclick = () => { window.location.href = Store.logoutUrl; };
      area.append(out);
    } else {
      for (const p of a.providers) {
        const b = el('button', '', `<span>Sign in with ${esc(PROVIDER_LABELS[p] || p)}</span><span class="hint">sync projects</span>`);
        b.setAttribute('role', 'menuitem');
        b.onclick = () => { window.location.href = Store.loginUrl(p); };
        area.append(b);
      }
      // Persistent plans surface (A-05): upgrading must be findable before
      // the paywall, not only at it.
      if (configured) {
        const plans = el('button', '', '<span>Plans &amp; pricing</span><span class="hint">upgrade</span>');
        plans.setAttribute('role', 'menuitem');
        plans.onclick = () => BB.Billing.open();
        area.append(plans);
      }
    }
  }

  /* ---------------- render: top bar ---------------- */
  function updateChatPlaceholder() {
    const designed = !!state.project || (state.history && state.history.snapshots.length > 1);
    const t = $('chatText');
    if (t) t.placeholder = designed ? 'Ask for a change…' : 'Describe your piece…';
  }
  function renderTopbar() {
    updateChatPlaceholder();
    $('designName').value = state.spec.meta.name;
    const imperial = state.spec.meta.units !== 'mm';
    $('unitsIn').setAttribute('aria-pressed', String(imperial));
    $('unitsMm').setAttribute('aria-pressed', String(!imperial));
    $('dualBtn').setAttribute('aria-pressed', String(!!Units.get().dual));
    $('precisionRow').hidden = !imperial; // fractions are an imperial concept
    $('precisionSelect').value = String(state.prefs4.units.precision);
    $('levelSelect').value = state.spec.meta.level;
    $('undoBtn').disabled = !state.history.canUndo();
    $('redoBtn').disabled = !state.history.canRedo();
  }

  /* Theme rides prefs: auto follows the OS, light/dark pin the palette via
   * the :root[data-theme] overrides. The 3D scene follows the same choice —
   * engine.setTheme retunes ink lines, labels, bounce light, and regenerates
   * the environment map. */
  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
    for (const [id, val] of [['themeAuto', 'auto'], ['themeLight', 'light'], ['themeDark', 'dark']]) {
      $(id).setAttribute('aria-pressed', String((t || 'auto') === val));
    }
    const dark = t === 'dark' || (t !== 'light' && darkMq.matches);
    if (state.engine) state.engine.setTheme(dark ? 'dark' : 'light');
  }

  /* Render quality rides prefs the same way; the flat tier is one switch for
   * both textures and shadows (grain without grounding looks worse, not better). */
  function applyRender() {
    const textured = !state.prefs4.render || state.prefs4.render.textured !== false;
    $('renderRich').setAttribute('aria-pressed', String(textured));
    $('renderFlat').setAttribute('aria-pressed', String(!textured));
    if (state.engine) state.engine.setQuality({ textured, shadows: textured });
  }

  /* ---------------- render: advisories ----------------
   * Errors first, then live advisories. Past the cap the stack folds into a
   * "+N more" row so warnings never wallpaper the model. */
  const ADVISORY_CAP = 3;
  function renderAdvisories(report) {
    const wrap = $('advisories');
    wrap.textContent = '';
    const items = [];
    for (const e of report.errors) items.push({ error: true, text: e.text });
    for (const a of report.advisories) {
      if (!state.dismissed.has(a.id)) items.push({ error: false, text: a.text, id: a.id });
    }
    if (mobileAdvisoryMq.matches && items.length && !state.advisoriesExpanded) {
      const pill = el('button', 'advisory-more advisory-pill',
        `${BB.Icons.svg(items.some(it => it.error) ? 'stop' : 'warn', 14)} ${items.length}`);
      pill.setAttribute('aria-expanded', 'false');
      pill.setAttribute('aria-label', `Show ${items.length} advisory message${items.length === 1 ? '' : 's'}`);
      pill.onclick = () => { state.advisoriesExpanded = true; renderAdvisories(report); };
      wrap.append(pill);
      return;
    }
    const visible = state.advisoriesExpanded ? items : items.slice(0, ADVISORY_CAP);
    for (const it of visible) {
      const chip = el('div', 'advisory' + (it.error ? ' error' : ''));
      chip.append(el('span', 'adv-icon', BB.Icons.svg(it.error ? 'stop' : 'warn', 14)));
      chip.append(el('span', '', esc(it.text)));
      if (!it.error) {
        const x = el('button', 'dismiss', BB.Icons.svg('close', 13));
        x.setAttribute('aria-label', 'Dismiss advisory');
        x.onclick = () => { state.dismissed.add(it.id); renderAdvisories(report); renderReadiness(); };
        chip.append(x);
      }
      wrap.append(chip);
    }
    if (mobileAdvisoryMq.matches && items.length) {
      const less = el('button', 'advisory-more', 'Show fewer');
      less.setAttribute('aria-expanded', 'true');
      less.onclick = () => { state.advisoriesExpanded = false; renderAdvisories(report); };
      wrap.append(less);
    } else if (items.length > ADVISORY_CAP) {
      const more = el('button', 'advisory-more',
        state.advisoriesExpanded ? 'Show fewer' : `+${items.length - ADVISORY_CAP} more`);
      more.setAttribute('aria-expanded', String(!!state.advisoriesExpanded));
      more.onclick = () => { state.advisoriesExpanded = !state.advisoriesExpanded; renderAdvisories(report); };
      wrap.append(more);
    }
  }

  /* ---------------- render: panels ---------------- */
  function syncScrollableTable(box) {
    if (!box) return;
    box.classList.toggle('scrollable', box.scrollWidth > box.clientWidth + 1);
  }
  const tableScrollObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
      const box = entry.target.classList && entry.target.classList.contains('table-scroll')
        ? entry.target
        : entry.target.closest && entry.target.closest('.table-scroll');
      if (box) syncScrollableTable(box);
    }
  });
  function wireScrollableTables(root) {
    root.querySelectorAll('.table-scroll').forEach(box => {
      syncScrollableTable(box);
      if (!box.dataset.scrollObserved) {
        box.dataset.scrollObserved = '1';
        tableScrollObserver.observe(box);
      }
      const table = box.querySelector('table');
      if (table && !table.dataset.scrollObserved) {
        table.dataset.scrollObserved = '1';
        tableScrollObserver.observe(table);
      }
    });
  }
  function focusPanelHeading() {
    const heading = $('panel-main').querySelector('h1, h2, h3');
    if (!heading) return;
    heading.setAttribute('tabindex', '-1');
    heading.focus();
  }
  function renderPanel() {
    hideProv();
    const p = $('panel-main');
    p.textContent = '';
    const inner = el('div', 'panel-inner');
    p.append(inner);
    if (state.tab === 'overview') renderOverview(inner);
    else if (state.tab === 'cut') renderCut(inner);
    else if (state.tab === 'stock') { renderStock(inner); renderBom(inner); }
    else if (state.tab === 'assembly') renderAssembly(inner);
    else if (state.tab === 'integrity') renderIntegrity(inner);
    else renderReference(inner);
    wireScrollableTables(inner);
  }

  /* ---------------- Plan overview ----------------
   * Four honest numbers straight from the computed state, then ONE next
   * action. Everything here is a pure read of what the pipeline already
   * derived — no new math, no stored copies. */
  function renderOverview(root) {
    if (!state.cut.length) {
      emptyState(root, 'No design yet.', 'Describe a piece in the chat or pick a starter — the plan builds itself.');
      return;
    }
    const sum = state.integrity.summary;
    const plan = state.stockPlan;
    const boards = plan ? plan.boards.length + plan.sheets.length : 0;
    const partCount = state.cut.reduce((n, r) => n + r.qty, 0);
    // Rollup tier from the engine (audit M-18): fail > anchor > advisory > pass.
    const verdict = sum.verdict;
    const verdictText = verdict === 'fail'
      ? 'This design does not yet pass the required strength checks.'
      : verdict === 'anchor'
        ? 'This design is safe only when anchored to the wall — the anti-tip anchor is in the BOM and the assembly steps, not optional.'
        : verdict === 'advisory'
          ? 'This design passes the required strength checks, with notes worth reading.'
          : 'This design passes the required strength checks.';
    const cards = [
      { label: 'Parts to cut', value: String(partCount), go: 'cut', aria: 'Open the cut list' },
      { label: 'Boards to buy', value: plan && plan.errors.length ? '—' : String(boards), go: 'stock', aria: 'Open the buying plan' },
      { label: 'Estimated cost', value: plan ? '$' + plan.totalCost.toFixed(0) : '—', go: 'stock', aria: 'Open buying and pricing' },
      { label: 'Safety', value: verdict === 'anchor' ? 'ANCHOR REQUIRED' : verdict.toUpperCase(), stamp: verdict, go: 'integrity', aria: 'Open the safety report' }
    ];
    const grid = el('div', 'overview-grid');
    for (const c of cards) {
      const b = el('button', 'overview-card' + (c.stamp ? ' verdict-' + c.stamp : ''));
      b.type = 'button';
      b.setAttribute('aria-label', `${c.label}: ${c.value}. ${c.aria}`);
      b.innerHTML = `<span class="ov-value${c.stamp ? ' stamp ' + c.stamp : ''}">${esc(c.value)}</span><span class="ov-label">${esc(c.label)}</span>`;
      b.onclick = () => selectTab(c.go);
      grid.append(b);
    }
    root.append(el('h3', '', 'Overview'));
    root.append(el('p', 'lede', verdictText + (sum.fails ? '' : ' Every number below comes from the same engineering pass.')));
    root.append(grid);
    // One clear next action, derived from where the project actually stands.
    const pct = progressPct();
    const next = sum.fails
      ? { label: 'Review safety first', go: () => selectTab('integrity') }
      : pct > 0 && pct < 100
        ? { label: `Keep building — ${pct}% done`, go: enterBuildMode }
        : pct >= 100
          ? { label: 'Build complete — review or share it', go: () => { openShareSheet(); } }
          : { label: 'Check the cut list, then head to the shop', go: () => selectTab('cut') };
    const row = el('div', 'overview-next');
    const nb = el('button', 'btn primary', esc(next.label));
    nb.onclick = next.go;
    row.append(nb);
    root.append(row);
  }

  /* ---------------- provenance dialog (stretch: number provenance) ---------------- */
  let provAnchor = null;
  function showProv(row, anchor) {
    const pop = $('provPop');
    const lines = Prov.forCutRow(state.spec, state.model, row);
    pop.innerHTML = `<div class="prov-head"><h5>${esc(row.name)} — where these numbers come from</h5>
      <button type="button" class="prov-close" aria-label="Close provenance">${BB.Icons.svg('close', 13)}</button></div>` +
      lines.map(l => `<div class="prov-line"><b>${esc(l.dim)}</b><span>${esc(l.formula)}</span></div>`).join('') +
      `<div class="prov-foot">computed internally in metric</div>`;
    pop.hidden = false;
    provAnchor = anchor;
    pop.querySelector('.prov-close').onclick = hideProv;
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left)) + 'px';
    pop.style.top = (r.bottom + 8 + pop.offsetHeight > window.innerHeight ? r.top - pop.offsetHeight - 8 : r.bottom + 8) + 'px';
    pop.querySelector('.prov-close').focus();
  }
  function hideProv() {
    const pop = $('provPop');
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    if (provAnchor && document.contains(provAnchor)) provAnchor.focus();
    provAnchor = null;
  }
  document.addEventListener('click', e => {
    if (!e.target.closest || (!e.target.closest('.prov-btn') && !e.target.closest('.prov-pop'))) hideProv();
  });

  /* Empty panels point at the two ways forward instead of dead-ending. */
  function emptyState(root, big, text) {
    const box = el('div', 'empty-state', `<span class="big">${big}</span>${text}`);
    const row = el('div', 'empty-actions');
    const describe = el('button', 'btn primary', 'Describe a piece');
    describe.onclick = () => focusChat();
    const starters = el('button', 'btn', 'Browse starters');
    starters.onclick = () => { renderGallery(); openScrim('galleryScrim'); };
    row.append(describe, starters);
    box.append(row);
    root.append(box);
  }

  function ensureDiagramScrim() {
    let scrim = $('diagramScrim');
    if (scrim) return scrim;
    scrim = el('div', 'scrim');
    scrim.id = 'diagramScrim';
    scrim.inert = true;
    scrim.setAttribute('role', 'dialog');
    scrim.setAttribute('aria-modal', 'true');
    scrim.setAttribute('aria-labelledby', 'diagramTitle');
    scrim.innerHTML = `<div class="modal modal-wide">
      <div class="drawer-head" style="margin-bottom:var(--s3)">
        <h2 id="diagramTitle">Cutting diagram</h2>
        <button class="btn icon ghost" id="diagramClose" aria-label="Close diagram">${BB.Icons.svg('close')}</button>
      </div>
      <div class="diagram-zoom-body" id="diagramZoomBody" style="overflow:auto;-webkit-overflow-scrolling:touch"></div>
      <p class="sub" style="margin-top:var(--s2)">Pinch or scroll to pan. Tap outside or press Esc to close.</p>
    </div>`;
    document.body.append(scrim);
    const close = scrim.querySelector('#diagramClose');
    if (close) close.onclick = () => closeScrim(scrim);
    scrim.addEventListener('click', e => { if (e.target === scrim) closeScrim(scrim); });
    return scrim;
  }
  function openDiagramZoom(svgHtml, title) {
    const scrim = ensureDiagramScrim();
    scrim.querySelector('#diagramTitle').textContent = title || 'Cutting diagram';
    const body = scrim.querySelector('#diagramZoomBody');
    body.innerHTML = svgHtml;
    body.scrollTop = 0;
    body.scrollLeft = 0;
    openScrim(scrim.id);
  }
  function wireDiagramZoom(container, getLargeSvg) {
    if (!container || container.dataset.zoomWired) return;
    container.dataset.zoomWired = '1';
    container.classList.add('diagram-zoom-trigger');
    container.tabIndex = 0;
    container.setAttribute('role', 'button');
    container.setAttribute('aria-label', 'Enlarge diagram');
    container.style.cursor = 'zoom-in';
    container.style.touchAction = 'manipulation';
    const open = () => openDiagramZoom(getLargeSvg(), container.dataset.diagramTitle || 'Cutting diagram');
    container.addEventListener('click', open);
    container.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
  }

  function renderCut(root) {
    root.append(el('h3', '', 'Cut list'));
    root.append(el('p', 'lede', `Every part, ready for the saw. Tap a dimension to see where it comes from. Stock: ${esc(K.WOOD_SPECIES[state.spec.wood.species].label)} + ${esc((K.WOOD_SPECIES[state.spec.wood.sheetSpecies] || K.WOOD_SPECIES.baltic_birch).label)}.`));
    if (!state.cut.length) {
      emptyState(root, 'Nothing on the saw bench yet.', 'Describe a piece and the cut list writes itself.');
      return;
    }
    const dim = (r, v, i, what) => `<button type="button" class="prov-btn num" data-prov="${i}" aria-label="${esc(r.name)} ${what} ${esc(fmt(v))} — show the formula">${fmt(v)}</button>`;
    const wireProv = box => box.querySelectorAll('.prov-btn').forEach(b => {
      b.addEventListener('click', e => { e.stopPropagation(); showProv(state.cut[+b.dataset.prov], b); });
    });
    if (mobileAdvisoryMq.matches) {
      // Phones read cards, not seven-column tables: name, qty, dimensions,
      // material — and "Why this length?" opens the same provenance dialog.
      const list = el('div', 'cut-cards');
      list.innerHTML = state.cut.map((r, i) => `<div class="cut-card">
        <div class="cut-card-head"><span class="cc-name">${esc(r.name)}</span><span class="cc-qty">× ${r.qty}</span></div>
        <div class="cc-dims">${dim(r, r.L, i, 'length')} × ${dim(r, r.W, i, 'width')} × ${dim(r, r.T, i, 'thickness')}</div>
        <div class="cc-meta">${esc(K.WOOD_SPECIES[r.material] ? K.WOOD_SPECIES[r.material].label : r.material)}${r.note ? ' · ' + esc(r.note) : ''}</div>
        <button type="button" class="learn-link cc-why" data-prov="${i}">Why this length?</button>
      </div>`).join('');
      wireProv(list);
      list.querySelectorAll('.cc-why').forEach(b => {
        b.addEventListener('click', e => { e.stopPropagation(); showProv(state.cut[+b.dataset.prov], b); });
      });
      root.append(list);
      return;
    }
    const scroll = el('div', 'table-scroll');
    const rows = state.cut.map((r, i) => `<tr>
      <td>${esc(r.name)}</td><td class="num">${r.qty}</td>
      <td class="num">${dim(r, r.L, i, 'length')}</td><td class="num">${dim(r, r.W, i, 'width')}</td><td class="num">${dim(r, r.T, i, 'thickness')}</td>
      <td>${esc(K.WOOD_SPECIES[r.material] ? K.WOOD_SPECIES[r.material].label : r.material)}</td>
      <td style="color:var(--muted);font-size:var(--text-s)">${esc(r.note || '')}</td></tr>`).join('');
    scroll.innerHTML = `<table class="data"><thead><tr><th scope="col">Part</th><th scope="col" class="num">Qty</th><th scope="col" class="num">Length</th><th scope="col" class="num">Width</th><th scope="col" class="num">Thick</th><th scope="col">Material</th><th scope="col">Notes</th></tr></thead><tbody>${rows}</tbody></table>`;
    wireProv(scroll);
    root.append(scroll);
  }

  /* ---------------- Stock tab (Phase 4 item 3) ---------------- */
  function renderStock(root) {
    const plan = state.stockPlan;
    const species = state.spec.wood.species;
    root.append(el('h3', '', 'Stock — what to buy, and how to break it down'));
    root.append(el('p', 'lede', 'Here is what to buy at the lumber yard, and how to break each board down. Kerf and end trim are already included.'));

    const controls = el('div', 'stock-controls');
    const modeSel = document.createElement('select');
    modeSel.setAttribute('aria-label', 'Stock buying mode for this species');
    modeSel.innerHTML = `<option value="dimensional">Dimensional lumber (packed boards)</option><option value="rough">Rough lumber by board foot</option>`;
    modeSel.value = state.prefs4.stockMode[species] === 'rough' ? 'rough' : 'dimensional';
    modeSel.onchange = () => {
      state.prefs4.stockMode[species] = modeSel.value;
      Store.savePrefs(state.prefs4);
      recompute();
    };
    controls.append(el('span', '', `${esc(K.WOOD_SPECIES[species].label)} bought as`), modeSel);
    root.append(controls);

    if (plan.errors.length) {
      const err = el('div', 'advisory error');
      err.textContent = plan.errors.join(' ');
      err.style.position = 'static';
      root.append(err);
    }

    // shopping list
    const scroll = el('div', 'table-scroll');
    const shopRows = plan.shopping.map(s => `<tr><td>${esc(s.label)}</td><td class="num">${s.qty}</td><td class="num">${esc(s.unit)}</td><td class="num">$${s.cost.toFixed(2)}</td></tr>`).join('');
    scroll.innerHTML = `<table class="data"><thead><tr><th scope="col">Buy</th><th scope="col" class="num">Qty</th><th scope="col" class="num">Unit</th><th scope="col" class="num">Cost</th></tr></thead><tbody>${shopRows || '<tr><td colspan="4" style="color:var(--muted)">Nothing to buy — no parts.</td></tr>'}</tbody></table>`;
    root.append(scroll);
    const waste = [];
    if (plan.wasteSolidPct != null) waste.push(`solid waste ${plan.wasteSolidPct}%`);
    if (plan.wasteSheetPct != null) waste.push(`sheet waste ${plan.wasteSheetPct}%`);
    const tot = el('div', 'bom-total');
    tot.innerHTML = `<span>Purchasable stock total${waste.length ? ` <span style="color:var(--muted);font-weight:400">· ${waste.join(' · ')}</span>` : ''}</span><strong>$${plan.totalCost.toFixed(2)}</strong>`;
    root.append(tot);
    if (plan.mode === 'dimensional' && plan.bdft.exact > 0) {
      root.append(el('p', 'stock-note', `Reference: rough-sawn equivalent ≈ ${Units.fmtBoardFeet(plan.bdft.withWaste)} (incl. 30% waste) ≈ $${plan.bdft.cost.toFixed(2)} at $${plan.bdft.rate.toFixed(2)}/bd ft.`));
    }
    for (const g of plan.glueups) root.append(el('p', 'stock-note', `“${esc(g.name)}” is wider than any board: edge-glue ${g.n} × ${esc(g.nominal)} strips, then trim to ${fmt(g.W)}.`));
    for (const l of plan.laminations) root.append(el('p', 'stock-note', `“${esc(l.name)}” is thicker than any board: face-laminate ${l.n} × ${esc(l.nominal)} layers, then plane to ${fmt(l.T)}.`));

    // board diagrams
    if (plan.boards.length) {
      root.append(el('h3', '', 'Cutting diagrams — boards'));
      plan.boards.forEach((b, i) => {
        if (!b.stockLen) return;
        const card = el('div', 'stock-board');
        const title = `Board ${i + 1} — ${K.WOOD_SPECIES[species].label} ${Units.fmtNominal(b.nominal, b.actual, b.stockLen)}`;
        card.innerHTML = `<div class="sb-title"><span>${esc(title)}</span><span class="offcut">offcut ${fmt(Math.max(0, b.offcut))}</span></div>`;
        const diagram = el('div', 'cut-diagram-wrap');
        diagram.dataset.diagramTitle = title;
        diagram.innerHTML = Packing.boardSVG(b, fmt);
        wireDiagramZoom(diagram, () => Packing.boardSVG(b, fmt, { large: true }));
        card.append(diagram);
        root.append(card);
      });
    }
    if (plan.sheets.length) {
      root.append(el('h3', '', 'Cutting diagrams — sheets'));
      plan.sheets.forEach((s, i) => {
        const card = el('div', 'stock-board');
        const title = `Sheet ${i + 1} — ${(K.WOOD_SPECIES[state.spec.wood.sheetSpecies] || K.WOOD_SPECIES.baltic_birch).label} ${fmt(s.thickness)} · buy a ${s.fractionLabel}`;
        card.innerHTML = `<div class="sb-title"><span>${esc(title)}</span><span class="offcut">layout ${fmt(s.extent.x)} × ${fmt(s.extent.y)}</span></div>`;
        const diagram = el('div', 'cut-diagram-wrap');
        diagram.dataset.diagramTitle = title;
        diagram.innerHTML = Packing.sheetSVG(s, fmt);
        wireDiagramZoom(diagram, () => Packing.sheetSVG(s, fmt, { large: true }));
        card.append(diagram);
        root.append(card);
      });
    }
    if (plan.mode === 'rough') {
      root.append(el('p', 'stock-note', 'Rough lumber mode: you surface and rip your own stock, so there are no board diagrams — the board-foot total above includes a 30% waste factor.'));
    }

    // editable, persisted price table
    const details = document.createElement('details');
    details.className = 'price-editor';
    details.innerHTML = `<summary>Edit lumber &amp; hardware prices (optional)</summary><p class="sub price-editor-note">Saved on this device and used only for your cost estimates.</p>`;
    const grid = el('div', 'price-grid');
    const priceInput = (labelText, value, onChange) => {
      const lab = el('label', '', `<span>${esc(labelText)}</span>`);
      const inp = document.createElement('input');
      inp.type = 'number'; inp.min = '0'; inp.step = '0.1'; inp.value = value;
      inp.setAttribute('aria-label', labelText);
      inp.addEventListener('change', () => {
        const v = parseFloat(inp.value);
        if (isFinite(v) && v >= 0) { onChange(v); Store.savePrices(state.prices); recompute(); }
      });
      lab.append(inp);
      return lab;
    };
    // Prices are stored per metre (internal SI, like every number); imperial
    // mode DISPLAYS and EDITS them per lineal foot — converted at this
    // boundary only, in both directions.
    const imperialPrices = Units.get().system === 'imperial';
    const M_PER_FT = 0.3048;
    const rateLabel = imperialPrices ? '$/ft' : '$/m';
    const toDisplay = perM => Math.round((imperialPrices ? perM * M_PER_FT : perM) * 100) / 100;
    const fromDisplay = v => (imperialPrices ? v / M_PER_FT : v);
    for (const nom of Object.keys(K.LUMBER.NOMINALS)) {
      grid.append(priceInput(`${K.WOOD_SPECIES[species].label} ${nom} ${rateLabel}`, toDisplay(state.prices.dimensional[species][nom]),
        v => { state.prices.dimensional[species][nom] = fromDisplay(v); }));
    }
    for (const sk of K.sheetSpeciesKeys()) {
      if (!state.prices.sheet[sk]) state.prices.sheet[sk] = Object.assign({}, K.SHEET_BASE_PRICES[sk]);
      for (const t of K.LUMBER.SHEET.THICKNESSES) {
        grid.append(priceInput(`${K.WOOD_SPECIES[sk].label} ${fmt(t)} $/full`, state.prices.sheet[sk][t], v => { state.prices.sheet[sk][t] = v; }));
      }
    }
    grid.append(priceInput(`${K.WOOD_SPECIES[species].label} $/bd ft`, state.prices.bdft[species], v => { state.prices.bdft[species] = v; }));
    // Hardware & consumables (2026): the WHOLE bill of materials is now
    // editable — slides, pulls, glue, finish, fasteners — not just lumber.
    if (!state.prices.hardware) state.prices.hardware = K.hardwarePriceDefaults();
    const hwKeys = Object.keys(state.prices.hardware)
      .sort((a, b) => K.hardwarePriceLabel(a).localeCompare(K.hardwarePriceLabel(b)));
    if (hwKeys.length) {
      grid.append(el('div', 'price-group', 'Hardware, glue, finish &amp; fasteners ($)'));
      for (const k of hwKeys) {
        grid.append(priceInput(K.hardwarePriceLabel(k), state.prices.hardware[k], v => { state.prices.hardware[k] = v; }));
      }
    }
    details.append(grid);
    root.append(details);
  }

  function renderBom(root) {
    root.append(el('h3', '', 'Materials & cost'));
    root.append(el('p', 'lede', 'Priced as actual purchasable units from the stock optimizer; board-foot math retained as a reference line.'));
    if (!state.bomData.items.length) {
      emptyState(root, 'Nothing to buy yet.', 'Describe a piece and the shopping list prices itself.');
      return;
    }
    const compareBtn = el('button', 'btn small', 'Compare species side by side');
    compareBtn.onclick = openSpecies;
    root.append(compareBtn);
    root.append(el('div', '', '&nbsp;'));
    const scroll = el('div', 'table-scroll');
    const rows = state.bomData.items.map(i => `<tr>
      <td><span class="kind-tag">${esc(i.kind)}</span></td>
      <td>${esc(i.label)}</td><td class="num">${i.qty}</td>
      <td style="color:var(--muted);font-size:var(--text-s)">${esc(i.detail || '')}</td>
      <td class="num">${i.price ? '$' + (Math.round(i.price * 100) / 100).toFixed(2) : '—'}</td></tr>`).join('');
    scroll.innerHTML = `<table class="data"><thead><tr><th scope="col"><span class="sr-only">Kind</span></th><th scope="col">Item</th><th scope="col" class="num">Qty</th><th scope="col">Detail</th><th scope="col" class="num">Cost</th></tr></thead><tbody>${rows}</tbody></table>`;
    root.append(scroll);
    const tot = el('div', 'bom-total');
    tot.innerHTML = `<span>Estimated materials cost</span><strong>$${state.bomData.total.toFixed(2)}</strong>`;
    root.append(tot);
  }

  /* ---------------- Joint Inspector (Phase 5) ----------------
   * Opens the transient 3D close-up for one joint. From assembly steps it
   * carries the REAL member parts; from the Shop Reference it demos the
   * joint on typical members so every joint is learnable before it's used. */
  const DEMO_MEMBERS = {
    frame: [{ id: 'demo_apron', name: 'Apron' , size: { w: 600, h: 89, d: 19 } }, { id: 'demo_leg', name: 'Leg', size: { w: 60, h: 700, d: 60 } }],
    case: [{ id: 'demo_shelf', name: 'Shelf', size: { w: 800, h: 19, d: 280 } }, { id: 'demo_side', name: 'Case side', size: { w: 18, h: 900, d: 280 } }],
    box: [{ id: 'demo_side', name: 'Drawer side', size: { w: 400, h: 120, d: 12 } }, { id: 'demo_front', name: 'Drawer front', size: { w: 450, h: 120, d: 19 } }],
    panel: [{ id: 'demo_board_a', name: 'Board A', size: { w: 600, h: 19, d: 140 } }, { id: 'demo_board_b', name: 'Board B', size: { w: 600, h: 19, d: 140 } }]
  };
  /* Qualitative location for a joint position — enough to point a hand at
   * the piece ("front left, up top"). +z faces the viewer (drawer travel). */
  function jointWhere(pos, b) {
    const t = 0.18, side = [];
    if (pos.z > b.d * t) side.push('front'); else if (pos.z < -b.d * t) side.push('back');
    if (pos.x < -b.w * t) side.push('left'); else if (pos.x > b.w * t) side.push('right');
    const band = pos.y < b.h * 0.3 ? 'near the floor' : pos.y > b.h * 0.7 ? 'up top' : 'at mid-height';
    return (side.length ? side.join(' ') + ', ' : '') + band;
  }
  function openJointInspector(type, partA, partB, opts) {
    if (!partA || !partB) {
      const kind = (K.JOINERY[type] && K.JOINERY[type].kinds[0]) || 'frame';
      const demo = DEMO_MEMBERS[kind] || DEMO_MEMBERS.frame;
      partA = { ...demo[0], material: state.spec.wood.species };
      partB = { ...demo[1], material: state.spec.wood.species };
    }
    BB.JointView.bindControls();
    openScrim('jointScrim'); // before open(): the viewer self-disposes when the scrim is closed
    const data = BB.JointView.open(type, partA, partB, { fmt, reducedMotion: reduceMq.matches });
    $('jointTitle').textContent = data.title;
    const j = K.JOINERY[type];
    $('jointNotes').innerHTML =
      ((opts && opts.context) ? `<p class="joint-where">${esc(opts.context)}</p>` : '') +
      data.labels.map(l => `<p class="joint-rule">${esc(l)}</p>`).join('') +
      (j ? `<p class="joint-know"><em>Watch for:</em> ${esc(j.failure)}<br><em>Tools:</em> ${esc(j.tools.join(', '))}</p>` : '');
    $('jointExplode').value = 0;
    $('jointCutaway').setAttribute('aria-pressed', 'false');
  }

  function whyJointHTML(type) {
    const j = K.JOINERY[type];
    if (!j) return '';
    return `<span class="why-joint"><button type="button" aria-expanded="false">Why this joint?</button>
      <span class="why-tip" role="tooltip"><strong>${esc(j.label)}</strong>
      <span class="stat">strength ${'●'.repeat(j.strength)}${'○'.repeat(5 - j.strength)}</span>
      <span class="stat">${esc(j.level)}</span><br>
      ${esc(j.bestFor)}<br><em>Watch for:</em> ${esc(j.failure)}<br>
      <em>Tools:</em> ${esc(j.tools.join(', '))}<br>
      <button type="button" class="learn-link" data-reflink="joinery" data-refquery="${esc(j.label)}">Learn why in the Shop reference</button></span></span>`;
  }

  function renderAssembly(root) {
    root.append(el('h3', '', 'Assembly'));
    root.append(el('p', 'lede', 'Press play on a step to watch its parts fly into place — the joint locations glow. Tap any glowing dot for a 3D close-up of exactly what to cut and where.'));
    if (!state.steps.length) {
      emptyState(root, 'No steps to walk yet.', 'Once a design has parts, assembly writes itself in build order.');
      return;
    }
    // Shop-truth header: honest time estimate + the consolidated tool wall,
    // both derived from the real plan (joints, cuts, glue-ups, finish).
    const t = Plans.timeEstimate(state.spec, state.model, state.cut, state.steps, state.stockPlan);
    const tools = Plans.toolList(state.spec, state.model, state.stockPlan);
    const facts = el('div', 'shop-facts');
    const wait = t.finishWait ? ` · finish: ${t.finishWait.coats} coats, recoat ${t.finishWait.recoatHrs} h, cure ${t.finishWait.cureDays} d` : '';
    facts.innerHTML = `<div class="shop-time" title="${esc(t.breakdown.map(b => `${b.label} — ${b.min} min`).join('\n') + `\n× ${t.factor} ${state.spec.meta.level} pace`)}">
        <strong>≈ ${t.hoursLow}–${t.hoursHigh} h</strong> bench time · ${t.sessions} session${t.sessions === 1 ? '' : 's'} of ~4 h${wait}</div>
      <details class="tool-wall"><summary>Tools for this build (${tools.length})</summary><ul>${tools.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>`;
    root.append(facts);
    const list = el('ol', 'step-list');
    state.steps.forEach((s, i) => {
      const item = el('li', 'step-item' + (i === state.playbackIndex ? ' active' : ''));
      item.dataset.step = i;
      const num = el('div', 'step-num');
      const body = el('div', 'step-body');
      const jointType = s.joints && s.joints.length ? s.joints[0].type : null;
      body.innerHTML = `<h4>${esc(s.title)}</h4><p>${esc(s.text)}</p>` +
        (jointType ? `<div>${whyJointHTML(jointType)}</div>` : '');
      if (jointType) {
        const j0 = s.joints[0];
        const inspect = el('button', 'btn small ghost joint-inspect', BB.Icons.svg('ruler', 13) + '<span>Inspect joint in 3D</span>');
        inspect.onclick = e => {
          e.stopPropagation();
          openJointInspector(jointType,
            state.model.parts.find(p => p.id === j0.a),
            state.model.parts.find(p => p.id === j0.b));
        };
        body.append(inspect);
      }
      const play = el('button', 'btn icon step-play', BB.Icons.svg('play', 15));
      play.setAttribute('aria-label', 'Play step ' + (i + 1));
      play.onclick = () => enterPlayback(i);
      item.append(num, body, play);
      list.append(item);
    });
    root.append(list);
    root.querySelectorAll('.why-joint > button').forEach(b => {
      b.addEventListener('click', e => {
        e.stopPropagation();
        const w = b.parentElement;
        const open = w.classList.toggle('open');
        b.setAttribute('aria-expanded', open);
      });
    });
  }

  /* ---------------- Safety tab (structural engine + movement) ----------------
   * Plain language leads for everyone: one sentence, one stamp. Anything that
   * FAILS surfaces immediately with its fixes in plain terms. The full
   * engineering report (creep factors, ΔMC, load presets, every passing
   * check) lives behind "See engineering details" — open by default for
   * intermediate/advanced, closed for beginners so jargon is never the
   * first layer while fixes stay one glance away. */
  function renderIntegrity(root) {
    const integ = state.integrity;
    const overall = integ.summary.verdict; // engine rollup (audit M-18): fail > anchor > advisory > pass
    const beginner = state.spec.meta.level === 'beginner';
    root.append(el('h3', '', 'Safety'));
    const summary = el('div', 'integrity-summary');
    summary.innerHTML = `<span class="stamp ${overall}">${overall === 'anchor' ? 'anchor required' : overall}</span>
      <span class="integrity-plain">${overall === 'pass'
        ? 'This design passes the required strength checks.'
        : overall === 'advisory'
          ? 'This design passes the required strength checks, with notes worth reading below.'
          : overall === 'anchor'
            ? 'This design is safe only when anchored to the wall. The anti-tip anchor is mandatory — it is in the BOM and the assembly steps, not optional.'
            : 'This design does not yet pass the required strength checks — fix it before you build.'}</span>`;
    root.append(summary);
    // Failing checks never hide — and neither does a check that mandates the
    // wall anchor (audit M-18): plain card, above the fold, at every level.
    for (const c of integ.checks.filter(x => x.status === 'fail' || x.anchor)) {
      root.append(checkCard(c, { full: !beginner }));
    }
    const details = document.createElement('details');
    details.className = 'integrity-details';
    details.innerHTML = '<summary>See engineering details</summary>';
    details.open = !beginner;
    root.append(details);
    const target = details;
    target.append(el('p', 'lede', `${integ.checks.length} checks · ${integ.summary.fails} fail · ${integ.summary.advisories} advisory — exact numbers, thresholds, and the design basis.`));

    // climate preference drives ΔMC in the movement math
    const climate = el('div', 'climate-row');
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', 'Indoor climate for seasonal movement');
    sel.innerHTML = `<option value="arid">Arid climate — ΔMC 2%</option><option value="temperate">Temperate indoor — ΔMC 4%</option><option value="humid">Humid climate — ΔMC 6%</option>`;
    sel.value = state.prefs4.climate;
    sel.onchange = () => { state.prefs4.climate = sel.value; Store.savePrefs(state.prefs4); recompute(); };
    climate.append(el('span', '', 'Seasonal movement assumes'), sel,
      el('button', 'learn-link', 'Learn why wood moves'));
    const learnMove = climate.querySelector('.learn-link');
    learnMove.type = 'button';
    learnMove.dataset.reflink = 'wood';
    learnMove.dataset.refquery = 'movement';
    target.append(climate);

    if (integ.surfaces.length) {
      target.append(el('h3', '', 'Load presets (per surface)'));
      for (const s of integ.surfaces) {
        const row = el('div', 'load-row');
        const label = el('span', '', `${esc(s.label)}<span class="span-note">${fmt(s.span)} ${s.model === 'cant' ? 'cantilever' : 'span'}</span>`);
        const ls = document.createElement('select');
        ls.setAttribute('aria-label', `Load preset for ${s.label}`);
        for (const k of Structural.PRESET_KEYS) {
          const o = document.createElement('option');
          o.value = k;
          o.textContent = `${Structural.LOAD_PRESETS[k].label} — ${Structural.presetDetail(k)}`;
          o.selected = k === s.presetKey;
          ls.append(o);
        }
        ls.onchange = () => { state.loadChoices[s.id] = ls.value; recompute(); };
        row.append(label, ls);
        target.append(row);
      }
      target.append(el('div', '', '&nbsp;'));
    }

    for (const c of integ.checks) target.append(checkCard(c, { full: true }));
    // Design-value basis disclosed in full (audit F-S3-7): what the numbers
    // rest on, what the safety factor absorbs, and the clear-stock rule.
    target.append(el('p', 'integrity-disclaimer', esc(K.DESIGN_BASIS)));
  }

  /* One check, two depths: plain (title + what it means + fixes) for the
   * surfaced beginner card; full adds the exact value, threshold, and creep/
   * duty factors. The fix buttons are identical in both. */
  function checkCard(c, opts) {
    const full = !opts || opts.full !== false;
    const card = el('div', 'check-card' + (c.status === 'fail' ? ' fail' : ''));
    // The plain tier speaks builder, not engineer: what went wrong and that a
    // one-tap fix exists. The engine's full explanation (creep factors, exact
    // values, thresholds) stays one fold away in "See engineering details".
    // Anchor-mandating tipping checks (audit M-18) already explain themselves
    // in plain language — the generic load sentence would be wrong for them.
    const plainLine = c.anchor
      ? c.explain
      : 'This part would not safely carry its expected load as designed. '
      + (c.fixes && c.fixes.length ? 'Any fix below solves it, or ask the chat for a different approach.' : 'Ask the chat for a different approach.');
    card.innerHTML = `<div class="check-head"><h4>${esc(c.title)}</h4><span class="stamp ${c.status}">${c.status}</span></div>` +
      (full ? `<div class="check-value">${esc(c.value)}</div>
        <div class="check-threshold">threshold: ${esc(c.threshold)}</div>` : '') +
      `<p class="check-explain">${full ? esc(c.explain) : esc(plainLine)}</p>` +
      (full && c.factors ? `<div class="check-factors">${c.factors.map(f => `<div><span>${esc(f.label)}</span><span>${f.mult ? '× ' + f.mult : '+' + f.pts}</span></div>`).join('')}</div>` : '');
    if (c.fixes && c.fixes.length) {
      const row = el('div', 'fix-row');
      for (const f of c.fixes) {
        const b = el('button', 'btn small primary', esc(f.label));
        b.onclick = () => {
          const before = state.integrity;
          if (merge(f.patch, 'fix', [f.label])) {
            const chips = Structural.integrityDiff(before, state.integrity);
            botSay(`Applied fix: ${f.label}.`, chips, { noChange: !chips.length });
            selectTab('integrity'); focusPanelHeading();
          }
        };
        row.append(b);
      }
      card.append(row);
    }
    return card;
  }

  /* ---------------- shop reference ---------------- */
  function referenceHit(q, ...xs) {
    return !q || xs.join(' ').toLowerCase().includes(q);
  }
  function referenceTabHasHits(tab, q) {
    q = (q || '').trim().toLowerCase();
    const hit = (...xs) => referenceHit(q, ...xs);
    if (tab === 'wood') {
      return Object.values(K.WOOD_SPECIES).some(s => hit(s.label, s.blurb, s.movement));
    } else if (tab === 'ergo') {
      return K.ERGONOMICS.some(r => hit(r.label, r.note));
    } else if (tab === 'joinery') {
      return Object.values(K.JOINERY).some(j => hit(j.label, j.bestFor, j.failure, j.tools.join(' ')));
    } else if (tab === 'hardware') {
      const HW = BB.HW;
      const groups = [
        Object.values(HW.HINGES), Object.values(HW.PULLS), Object.values(HW.SLIDES), Object.values(HW.LIFTS),
        Object.values(HW.CATCHES), Object.values(HW.LOCKS), Object.values(HW.SHELF_SUPPORT), Object.values(HW.TABLE_BED),
        Object.values(HW.WALL_HANG), Object.values(HW.FEET_MISC), Object.values(HW.TRADITIONAL)
      ];
      return groups.some(list => list.some(x => hit(x.label, x.bestFor || '', x.failure || '', (x.setout || []).join(' '))));
    } else if (tab === 'lumber') {
      return Object.entries(K.LUMBER.NOMINALS).some(([n]) => hit(n)) || hit('sheet goods');
    }
    const f = K.FASTENERS;
    return [...f.screws, ...f.dowels, ...f.hardware].some(x => hit(x.label, x.use)) ||
      K.FINISHES.some(x => hit(x.label, x.blurb)) ||
      K.GLUES.some(x => hit(x.label, x.blurb, x.water));
  }
  function syncReferenceTabForQuery() {
    const q = state.refQuery.trim().toLowerCase();
    if (!q || referenceTabHasHits(state.refTab, q)) return false;
    const next = REF_TABS.find(tab => referenceTabHasHits(tab, q));
    if (!next || next === state.refTab) return false;
    state.refTab = next;
    return true;
  }
  function renderReference(root) {
    syncReferenceTabForQuery();
    root.append(el('h3', '', 'Shop reference'));
    const search = el('input', 'ref-search');
    search.type = 'search';
    search.placeholder = 'Search species, joints, screws, finishes…';
    search.value = state.refQuery;
    search.setAttribute('aria-label', 'Search reference tables');
    const body = el('div');
    const tabs = el('div', 'ref-tabs');
    const syncTabButtons = () => {
      tabs.querySelectorAll('.ref-tab').forEach((b, i) => {
        const key = REF_ENTRIES[i][0];
        b.setAttribute('aria-selected', String(state.refTab === key));
        b.tabIndex = state.refTab === key ? 0 : -1;
      });
    };
    search.oninput = () => {
      state.refQuery = search.value;
      syncReferenceTabForQuery();
      syncTabButtons();
      syncHash();
      renderRefBody(body);
    };
    root.append(search);

    tabs.setAttribute('role', 'tablist');
    for (const [key, label] of REF_ENTRIES) {
      const b = el('button', 'ref-tab', esc(label));
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', state.refTab === key);
      b.tabIndex = state.refTab === key ? 0 : -1; // roving tabindex
      b.onclick = () => { state.refTab = key; syncHash(); renderPanel(); };
      tabs.append(b);
    }
    // Same arrow-key pattern as the main plan tabs.
    tabs.addEventListener('keydown', e => {
      const order = REF_TABS;
      const i = order.indexOf(state.refTab);
      let next = null;
      if (e.key === 'ArrowRight') next = order[(i + 1) % order.length];
      if (e.key === 'ArrowLeft') next = order[(i + order.length - 1) % order.length];
      if (e.key === 'Home') next = order[0];
      if (e.key === 'End') next = order[order.length - 1];
      if (next) {
        e.preventDefault();
        state.refTab = next;
        syncHash();
        renderPanel(); // rebuilds the tablist — refocus the selected tab
        const nb = document.querySelectorAll('.ref-tab')[order.indexOf(next)];
        if (nb) nb.focus();
      }
    });
    root.append(tabs);
    syncTabButtons();
    root.append(body);
    renderRefBody(body);
  }

  function renderRefBody(body) {
    body.textContent = '';
    const q = state.refQuery.trim().toLowerCase();
    const hit = (...xs) => referenceHit(q, ...xs);
    const scroll = el('div', 'table-scroll');
    let rows = '', head = '';
    if (state.refTab === 'wood') {
      head = '<th>Species</th><th class="num">Janka</th><th class="num">MOE GPa</th><th class="num">MOR MPa</th><th class="num">SG</th><th class="num">Move ct/1%MC</th><th class="num">Cost</th><th>Character</th>';
      // Sheet goods are badged, and their Janka/movement cells dash (audit
      // M-12): face hardness is not comparable across a ply/fiber face, and
      // the movement engine exempts sheet stock — showing solid-wood numbers
      // there would be dishonest.
      rows = Object.values(K.WOOD_SPECIES).filter(s => hit(s.label, s.blurb, s.movement)).map(s => `<tr>
        <td><strong>${esc(s.label)}</strong>${s.sheet ? ' <span class="sheet-badge">sheet</span>' : ''}</td><td class="num">${s.sheet ? '—' : s.janka + ' lbf'}</td>
        <td class="num">${s.moe.toFixed(1)}</td><td class="num">${s.mor}</td><td class="num">${s.sg.toFixed(2)}</td>
        <td class="num${s.sheet ? '' : ' movement-' + s.movement}">${s.sheet ? '—' : s.ct.toFixed(5)}</td>
        <td class="num">${'$'.repeat(s.costTier)}</td>
        <td style="font-size:var(--text-s);color:var(--muted)">${esc(s.blurb)}</td></tr>`).join('');
    } else if (state.refTab === 'ergo') {
      head = '<th>Measure</th><th class="num">Range</th><th>Applies to</th><th>Note</th>';
      rows = K.ERGONOMICS.filter(r => hit(r.label, r.note)).map(r => `<tr>
        <td><strong>${esc(r.label)}</strong></td>
        <td class="num">${isFinite(r.max) ? `${fmt(r.min)} – ${fmt(r.max)}` : `≥ ${fmt(r.min)}`}</td>
        <td>${esc(r.appliesTo.join(', '))}</td>
        <td style="font-size:var(--text-s);color:var(--muted)">${esc(Units.fmtTemplate(r.note))}</td></tr>`).join('');
    } else if (state.refTab === 'joinery') {
      head = '<th>Joint</th><th></th><th>Strength</th><th>Difficulty</th><th>Level</th><th>Best for</th><th>Failure to avoid</th><th>Tools</th>';
      rows = Object.values(K.JOINERY).filter(j => hit(j.label, j.bestFor, j.failure, j.tools.join(' '))).map(j => `<tr>
        <td><strong>${esc(j.label)}</strong></td>
        <td><button type="button" class="btn small ghost joint-demo" data-joint="${esc(j.key)}" title="See this joint in 3D">${BB.Icons.svg('ruler', 13)} 3D</button></td>
        <td><span class="dots">${'●'.repeat(j.strength)}${'○'.repeat(5 - j.strength)}</span></td>
        <td><span class="dots">${'●'.repeat(j.difficulty)}${'○'.repeat(5 - j.difficulty)}</span></td>
        <td>${esc(j.level)}</td>
        <td style="font-size:var(--text-s)">${esc(j.bestFor)}</td>
        <td style="font-size:var(--text-s);color:var(--muted)">${esc(j.failure)}</td>
        <td style="font-size:var(--text-s);color:var(--muted)">${esc(j.tools.join(', '))}</td></tr>`).join('');
    } else if (state.refTab === 'hardware') {
      // The hardware repository: when, why, how, where — quantities and
      // ratings are computed by code (BB.HW rules), the table teaches the
      // rest. Rows with a 3D button open a dimensioned inspector view.
      head = '<th>Hardware</th><th></th><th>Class / spec</th><th>When &amp; why</th><th>Watch for</th>';
      const HW = BB.HW;
      const view3d = { euro_cup: 'hw_cup_hinge', drop_leaf: 'hw_rule_joint', rule_joint_ref: 'hw_rule_joint', pivot_pin_hinge: 'hw_pivot_pin', tambour: 'hw_tambour', sawtooth_supports: 'hw_sawtooth', sawtooth: 'hw_sawtooth', undermount_45: 'hw_undermount' };
      const groups = [
        ['Hinges', Object.values(HW.HINGES)], ['Pulls', Object.values(HW.PULLS)],
        ['Slides', Object.values(HW.SLIDES)], ['Lifts & stays', Object.values(HW.LIFTS)],
        ['Catches', Object.values(HW.CATCHES)], ['Locks', Object.values(HW.LOCKS)],
        ['Shelf support', Object.values(HW.SHELF_SUPPORT)], ['Table & bed', Object.values(HW.TABLE_BED)],
        ['Wall hanging', Object.values(HW.WALL_HANG)], ['Feet & pass-throughs', Object.values(HW.FEET_MISC)],
        ['Traditional (no hardware)', Object.values(HW.TRADITIONAL)]
      ];
      const classOf = x => {
        const bits = [];
        if (x.capacityKg) bits.push(`${x.capacityKg} kg`);
        if (x.capacityKgPair) bits.push(`${x.capacityKgPair} kg/pair`);
        if (x.holdKg) bits.push(`holds ${x.holdKg} kg`);
        if (x.holdKgEach) bits.push(`${x.holdKgEach} kg each`);
        if (x.holdKgPair) bits.push(`${x.holdKgPair} kg/pair`);
        if (x.forceClassesN) bits.push(x.forceClassesN.join('/') + ' N');
        if (x.torqueClassesNm) bits.push(x.torqueClassesNm.join('/') + ' N·m');
        if (x.opening) bits.push(`opens ${x.opening}°`);
        if (x.extension) bits.push(x.extension === 1 ? 'full ext.' : Math.round(x.extension * 100) + '% ext.');
        if (x.replaces) bits.push('replaces ' + x.replaces);
        if (x.price) bits.push('~$' + x.price);
        if (x.price === 0) bits.push('shop-made, $0');
        return bits.join(' · ');
      };
      rows = groups.map(([gLabel, list]) => {
        const body2 = list.filter(x => hit(x.label, x.bestFor || '', x.failure || '', (x.setout || []).join(' '))).map(x => `<tr>
          <td><strong>${esc(Units.fmtTemplate(x.label))}</strong><br><span class="kind-tag">${esc(gLabel)}</span></td>
          <td>${view3d[x.key] ? `<button type="button" class="btn small ghost joint-demo" data-joint="${esc(view3d[x.key])}" title="See it in 3D">${BB.Icons.svg('ruler', 13)} 3D</button>` : ''}</td>
          <td class="num" style="font-size:var(--text-s)">${esc(classOf(x))}</td>
          <td style="font-size:var(--text-s)">${esc(Units.fmtTemplate(x.bestFor || ''))}${x.setout ? `<br><span style="color:var(--muted)">${esc(Units.fmtTemplate(x.setout.join(' ')))}</span>` : ''}</td>
          <td style="font-size:var(--text-s);color:var(--muted)">${esc(Units.fmtTemplate(x.failure || ''))}</td></tr>`).join('');
        return body2;
      }).join('');
    } else if (state.refTab === 'lumber') {
      head = '<th>Nominal</th><th class="num">Actual (T × W)</th><th class="num">Stock lengths</th>';
      rows = Object.entries(K.LUMBER.NOMINALS).filter(([n]) => hit(n)).map(([n, a]) => `<tr>
        <td><strong>${esc(n)}</strong></td><td class="num">${esc(`${fmt(a.t)} × ${fmt(a.w)}`)}</td>
        <td class="num">${esc(K.LUMBER.STOCK_LENGTHS.map(l => Units.fmtBoardLength(l)).join(' / '))}</td></tr>`).join('');
      rows += `<tr><td><strong>Sheet goods</strong></td><td class="num">${esc(Units.fmtSheet(K.LUMBER.SHEET.W, K.LUMBER.SHEET.L))} · ${esc(K.LUMBER.SHEET.THICKNESSES.map(t => fmt(t)).join(' / '))}</td><td>sold whole, half, or quarter</td></tr>`;
    } else {
      head = '<th>Item</th><th class="num">Pilot / spec</th><th>Use</th>';
      const f = K.FASTENERS;
      rows = [...f.screws, ...f.dowels, ...f.hardware].filter(x => hit(x.label, x.use)).map(x => `<tr>
        <td><strong>${esc(Units.fmtTemplate(x.label))}</strong></td>
        <td class="num">${x.pilot ? esc(fmtS(x.pilot)) + ' pilot' : (x.price ? '~$' + x.price : '—')}</td>
        <td style="font-size:var(--text-s);color:var(--muted)">${esc(Units.fmtTemplate(x.use))}</td></tr>`).join('');
      rows += K.FINISHES.filter(x => hit(x.label, x.blurb)).map(x => `<tr>
        <td><strong>${esc(x.label)}</strong>${x.foodContact ? ' <span class="kind-tag">food-contact</span>' : ''}${x.exterior ? ' <span class="kind-tag">exterior</span>' : ''}</td>
        <td class="num">${x.coats} coats · ${x.recoatHrs} h recoat · ${x.cureDays} d cure</td>
        <td style="font-size:var(--text-s);color:var(--muted)">${esc(x.blurb)}</td></tr>`).join('');
      rows += K.GLUES.filter(x => hit(x.label, x.blurb, x.water)).map(x => `<tr>
        <td><strong>${esc(x.label)}</strong>${x.foodContact ? ' <span class="kind-tag">food-contact</span>' : ''}</td>
        <td class="num">open ${x.openMin} min · clamp ${x.clampMin} min · ${x.cureHrs} h full</td>
        <td style="font-size:var(--text-s);color:var(--muted)">${esc(x.water)} — ${esc(x.blurb)}</td></tr>`).join('');
    }
    if (!rows) {
      body.append(el('div', 'empty-state', `<span class="big">No matches in the reference.</span>Try a different word — “dovetail”, “walnut”, “pilot”…`));
      return;
    }
    scroll.innerHTML = `<table class="data"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
    body.append(scroll);
    // Joinery rows carry a 3D demo button — the learning moment on demand.
    scroll.querySelectorAll('.joint-demo').forEach(b => {
      b.addEventListener('click', () => openJointInspector(b.dataset.joint));
    });
  }

  /* ---------------- chat ---------------- */
  /* The AI round-trip is busy state for the CHAT, not the plans: panels keep
   * their content (the last valid design is still true), while Send and
   * Photo disable and the chat reports aria-busy. */
  function setBusy(b) {
    state.busy = b;
    $('sendBtn').disabled = b;
    $('sendBtn').textContent = b ? '…' : 'Send';
    $('photoBtn').disabled = b;
    $('chatPanel').setAttribute('aria-busy', String(b));
  }
  function chatMsg(kind, html) {
    const log = $('chatLog');
    const m = el('div', 'msg ' + kind);
    m.innerHTML = html;
    log.append(m);
    log.scrollTop = log.scrollHeight;
    // The collapsed mobile sheet shows the tail of the conversation —
    // the sentence only, never the diff-card ledger squeezed into one line.
    const bubble = m.querySelector('.bubble');
    const peekText = (bubble ? bubble.textContent : m.textContent).trim();
    setChatPeek(peekText, kind);
    // A reply landing while the desktop chat is folded lights the rail dot.
    if (kind === 'bot' && state.prefs4.ui.chatCollapsed) $('chatRailDot').hidden = false;
    return m;
  }
  function setChatPeek(text, kind) {
    const raw = (text || '').trim();
    let next = DEFAULT_CHAT_PEEK;
    if (kind === 'user' && raw) next = 'You: ' + raw;
    else if (raw && !/^Welcome to the shop\./i.test(raw) && !/^Updated\.?$/i.test(raw) &&
      !/^Loaded .+ plans ready\./i.test(raw) && !/^Opened “.+”/i.test(raw) && !/^Imported “.+”/i.test(raw)) {
      next = raw;
    }
    $('chatPeek').textContent = next;
  }

  /* ---------------- AI connection badge ----------------
   * Persistent, and TRUTHFUL: states change only on evidence — a zero-token
   * probe of the same-origin proxy (`POST {}` → 400 means the route exists
   * AND holds a key, because the key check precedes body validation; 503
   * means unconfigured), the presence of window.claude, or the observed
   * outcome of a real send. Never an optimistic guess. */
  function setAIState(mode, detail) {
    const label = mode === 'online' ? 'AI online'
      : mode === 'offline' ? 'Offline · basic edits'
        : mode === 'unconfigured' ? 'AI not configured'
          : 'AI · checking…';
    const barLabel = mode === 'online' ? 'Online'
      : mode === 'offline' ? 'Offline'
        : mode === 'unconfigured' ? 'AI not configured'
          : '…';
    const title = detail || (mode === 'online'
      ? 'Connected to the design service — full natural-language design and photo input.'
      : mode === 'offline'
        ? 'No AI connection. Plain-language edits (sizes, wood, drawers) still work through the built-in parser; photos need the service.'
        : mode === 'unconfigured'
          ? 'The server has no AI key configured — a deploy issue, not your connection. Plain-language edits (sizes, wood, drawers) still work through the built-in parser.'
          : 'Checking the design service…');
    const badge = $('aiBadge');
    if (badge) {
      badge.dataset.state = mode;
      badge.title = title;
      badge.hidden = false;
      const lab = $('aiBadgeLabel');
      if (lab) lab.textContent = label;
    }
    const bar = $('aiBadgeBar');
    if (bar) {
      bar.dataset.state = mode;
      bar.title = title;
      bar.hidden = state.buildMode;
      const blab = $('aiBadgeBarLabel');
      if (blab) blab.textContent = barLabel;
    }
  }
  async function probeAI() {
    setAIState('checking');
    const claudeHost = typeof window.claude !== 'undefined' && window.claude && typeof window.claude.complete === 'function';
    if (navigator.onLine === false) { setAIState('offline', 'You are offline. Basic edits keep working.'); return; }
    try {
      const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (r.status === 400) { setAIState('online'); return; }               // proxy present, key configured
      if (r.status === 503) {                                               // proxy present, no key (L-14)
        setAIState(claudeHost ? 'online' : 'unconfigured');
        return;
      }
      setAIState(claudeHost ? 'online' : 'offline');                        // 404/405: no proxy here
    } catch (e) {
      setAIState(claudeHost ? 'online' : 'offline');
    }
  }
  function botSay(text, chips, opts) {
    opts = opts || {};
    let html = `<div class="bubble">${esc(text)}</div>`;
    const chipHTML = [];
    for (const c of chips || []) chipHTML.push(`<span class="chip">${esc(c)}</span>`);
    if (!chips || !chips.length) {
      if (opts.noChange && !opts.caveat) chipHTML.push(`<span class="chip neutral">no dimensional change</span>`);
    }
    if (opts.caveat) chipHTML.push(`<span class="chip caveat">${esc(opts.caveat)}</span>`);
    const hasDiff = (chips || []).length > 0;
    if (chipHTML.length) html += `<div class="chips${hasDiff ? ' diff-card' : ''}">${hasDiff ? '<span class="diff-title">Changed</span>' : ''}${chipHTML.join('')}</div>`;
    return chatMsg('bot', html);
  }
  function askQuestion(q) {
    const m = chatMsg('bot', `<div class="bubble">${esc(q.question)}</div>`);
    if (q.options && q.options.length) {
      const row = el('div', 'answer-row');
      for (const opt of q.options) {
        const b = el('button', 'btn small', esc(opt));
        b.onclick = () => { row.remove(); sendMessage(opt); };
        row.append(b);
      }
      m.append(row);
    }
  }

  /* The AI round-trip: wire protocol, continuation status, single validation
   * retry, and the propose–validate–revise loop for novel pieces. */
  async function aiPipeline(text, image, setStatus) {
    const digest = Codec.buildDigest(state.history.snapshots);
    let res = await AI.respond(text, state.spec, { turns: state.turns, digest, onStatus: setStatus, image });
    // Server said the AI budget is spent (402) or requests are coming too fast
    // (429) — act on it instead of pretending we went offline.
    if (res.usageLimit) {
      if (res.billing) Store.setBilling(res.billing);
      renderAccount(); // meter + plans surface reflect the fresh numbers (A-05)
      const limit = (res.billing && res.billing.entitlements && res.billing.entitlements.aiMonthlyLimit) || BB.Billing.status().entitlements.aiMonthlyLimit;
      BB.Billing.open(`You’ve used this month’s ${limit} AI messages. Upgrade to keep designing with AI.`);
      return null;
    }
    if (res.rateLimited) { botSay('Too many messages in a row — give it a few seconds, then try again.', []); return null; }
    if (res.error) { botSay(res.error, []); return null; }
    if (res.reply.kind === 'question') {
      state.turns = res.turns.slice(-24);
      askQuestion(res.reply);
      return null;
    }
    if (res.reply.kind === 'info') {
      // A thorough answer that changes nothing: show it, keep the design.
      state.turns = res.turns.slice(-24);
      botSay(res.reply.text, [], { noChange: true });
      return null;
    }
    let applied = AI.apply(res.reply, state.spec);
    let turns = res.turns;
    let r = runPipeline(applied.spec);

    // Up to three validation-refinement rounds with the specific errors
    // (truncation never lands here — the continuation protocol already
    // stitched partials together). Geometric impossibilities — parts through
    // the floor, outside the envelope, rogue overlaps, joints that never
    // touch — are validation ERRORS, so a design that still fails after
    // these rounds is never presented; the last valid design stays.
    for (let round = 1; r.report.errors.length && !res.local && round <= 3; round++) {
      setStatus(round === 1 ? 'Refining to clear validation errors' : `Refining to clear validation errors, round ${round} of 3`);
      const errText = 'Your proposal failed validation: ' + r.report.errors.slice(0, 8).map(e => e.text).join(' ') + ' Return a corrected reply, minified wire JSON only.';
      const res2 = await AI.respond(errText, applied.spec, { turns, digest, onStatus: setStatus });
      if (!res2.reply || res2.reply.kind === 'question') break;
      applied = AI.apply(res2.reply, applied.spec);
      turns = res2.turns;
      r = runPipeline(applied.spec);
    }
    if (r.report.errors.length) {
      state.turns = turns.slice(-24);
      botSay(`I couldn't get a buildable design from that: ${r.report.errors.slice(0, 2).map(e => e.text).join(' ')} Your last valid design is untouched.`, []);
      return null;
    }

    // Novel pieces run the structural critique loop (max 3 rounds); the best
    // attempt is presented honestly, failing report and all.
    let final = applied.spec;
    let failReport = null;
    let explain = res.reply.explain;
    if (final.meta.template === 'custom' && !res.local) {
      let best = null, curTurns = turns;
      for (let round = 1; round <= 3; round++) {
        const built = runPipeline(final);
        const integ = Structural.computeIntegrity(built.spec, built.model, integrityOpts());
        const fails = integ.checks.filter(c => c.status === 'fail');
        if (!best || fails.length < best.fails.length) best = { spec: final, fails, turns: curTurns };
        if (!fails.length || round === 3) break;
        setStatus(`Novel piece — refining structure, round ${round + 1} of 3`);
        const res3 = await AI.respond(AI.buildCritique(fails), final, { turns: curTurns, digest, onStatus: setStatus });
        if (!res3.reply || res3.reply.kind === 'question') break;
        const a3 = AI.apply(res3.reply, final);
        const r3 = runPipeline(a3.spec);
        if (r3.report.errors.length) break;
        final = r3.spec;
        curTurns = res3.turns;
      }
      final = best.spec;
      turns = best.turns;
      if (best.fails.length) failReport = best.fails;
    }
    state.turns = turns.slice(-24);
    return { final, failReport, explain, local: !!res.local, unconfigured: !!res.unconfigured };
  }

  async function sendMessage(text, image) {
    text = (text || '').trim();
    if ((!text && !image) || state.busy) return;
    const billing = BB.Billing.status();
    if (Store.auth().user && billing.usage.aiMessages >= billing.entitlements.aiMonthlyLimit) {
      BB.Billing.open(`You’ve used this month’s ${billing.entitlements.aiMonthlyLimit} AI messages. Upgrade to keep designing with AI.`);
      return;
    }
    hideHints();
    if (image) {
      chatMsg('user', `<img class="photo-thumb" src="${image.dataUrl}" alt="Uploaded furniture photo"><div class="bubble">${esc(text || 'Design this piece from my photo.')}</div>`);
    } else {
      chatMsg('user', `<div class="bubble">${esc(text)}</div>`);
    }
    const typing = chatMsg('bot', '<span class="typing"><i></i><i></i><i></i></span><span class="bubble" style="display:none"></span>');
    const setStatus = t => {
      const b = typing.querySelector('.bubble');
      b.style.display = 'block';
      b.textContent = t + '…';
    };
    setBusy(true);
    try {
      const promptText = image ? AI.VISION_PROMPT : text;
      const before = state.spec;
      const out = await aiPipeline(promptText, image, setStatus);
      typing.remove();
      setBusy(false);
      if (!out) return;
      const okc = commit(out.final, 'ai');
      if (!okc) {
        botSay('That change would leave the design unbuildable — I’ve left it as it was. Try a gentler dimension.', []);
        return;
      }
      const realDiffs = Spec.diffSpecs(before, state.spec);
      const chips = Spec.describeDiff(realDiffs);
      // The badge reflects what actually just happened — the strongest
      // evidence there is about the connection state. A keyless proxy (503)
      // reads "AI not configured", never plain offline (audit L-14).
      setAIState(out.local ? (out.unconfigured ? 'unconfigured' : 'offline') : 'online');
      if (!out.local && Store.auth().user) BB.Billing.refresh().then(() => renderAccount());
      const caveat = [
        image ? 'Proportions estimated from photo. Verify dimensions.' : null,
        out.local ? 'Working offline - plain-language edits still work.' : null
      ].filter(Boolean).join(' ') || null;
      if (out.failReport) {
        botSay(`Honest report: after 3 structural refinement rounds this is my best attempt, but it still fails ${out.failReport.length} check${out.failReport.length > 1 ? 's' : ''}: ${out.failReport.slice(0, 3).map(c => c.title).join('; ')}. The Safety tab has every number — tap a fix or ask me to change the approach.`, chips, { caveat });
        selectTab('integrity');
      } else {
        const summary = state.integrity.summary;
        const integLine = image ? ` Integrity: ${summary.fails ? summary.fails + ' fail(s)' : summary.advisories ? summary.advisories + ' advisory(ies)' : 'all checks pass'} — full report in the Safety tab.` : '';
        botSay((out.explain || 'Updated.') + integLine, chips, { noChange: !chips.length, caveat });
        // Offline and nothing changed: offer the edits the built-in parser is
        // actually good at, instead of leaving a dead end.
        if (out.local && !chips.length) {
          const m = chatMsg('bot', '<div class="bubble">Offline, I follow sizes, drawers, and wood species best. Try one:</div>');
          const row = el('div', 'answer-row');
          for (const sp of ['walnut', 'white_oak', 'cherry', 'pine']) {
            const b = el('button', 'btn small', esc(K.WOOD_SPECIES[sp].label));
            b.onclick = () => { row.remove(); sendMessage('make it ' + K.WOOD_SPECIES[sp].label.toLowerCase()); };
            row.append(b);
          }
          m.append(row);
        }
      }
    } catch (err) {
      typing.remove();
      setBusy(false);
      botSay('The design brain slipped a gear on that one. Mind rephrasing?', []);
    }
  }

  async function sendPhoto(file) {
    if (!file || state.busy) return;
    if (!AI.supportsImages()) {
      botSay('Photo-to-design needs the hosted design service, which isn’t reachable right now. Text refinements still work.', []);
      return;
    }
    try {
      // 1d: downscale client-side BEFORE anything reaches the API.
      const image = await AI.downscaleImage(file);
      await sendMessage('Design this piece from my photo.', image);
    } catch (e) {
      botSay('I couldn’t read that image — try a JPEG or PNG.', []);
    }
  }

  function hideHints() {
    hideWelcome(); // any design action outgrows the welcome card
    if (!state.firstRun) return;
    state.firstRun = false;
    $('hintPrompts').textContent = '';
  }
  function renderHints() {
    const wrap = $('hintPrompts');
    wrap.textContent = '';
    for (const p of Gallery.FIRST_RUN_PROMPTS) {
      const b = el('button', 'btn small ghost', '“' + esc(p) + '”');
      b.onclick = () => sendMessage(p);
      wrap.append(b);
    }
  }

  /* ---------------- inspector ---------------- */
  /* Unit-aware sliders run in the DISPLAY domain — integer 1/16 in ticks in
   * imperial, 1 mm ticks in metric — and convert back to millimetres exactly
   * once (Units.sliderDomain.toMM), so edits round-trip without drift. */
  function paramSlider(label, value, min, max, step, unitAware, onInput, onCommit) {
    const wrap = el('div', 'param');
    const lab = el('div', 'param-label');
    const out = el('output', '', unitAware ? fmt(value) : String(value));
    lab.append(el('span', '', esc(label)), out);
    const range = document.createElement('input');
    const dom = unitAware ? Units.sliderDomain(min, max, value) : { min, max, value, step, toMM: v => v };
    range.type = 'range'; range.min = dom.min; range.max = dom.max; range.step = dom.step; range.value = dom.value;
    range.setAttribute('aria-label', label);
    range.addEventListener('input', () => {
      const mm = dom.toMM(+range.value);
      out.textContent = unitAware ? fmt(mm) : String(mm);
      onInput(mm);
    });
    range.addEventListener('change', () => onCommit(dom.toMM(+range.value)));
    range.addEventListener('keyup', e => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) onCommit(dom.toMM(+range.value)); });
    wrap.append(lab, range);
    return wrap;
  }
  function paramSeg(label, options, current, onPick) {
    const wrap = el('div', 'param');
    wrap.append(el('div', 'param-label', `<span>${esc(label)}</span>`));
    const seg = el('div', 'seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', label);
    for (const [val, lab] of options) {
      const b = el('button', '', esc(lab));
      b.setAttribute('aria-pressed', String(val === current));
      b.onclick = () => onPick(val);
      seg.append(b);
    }
    wrap.append(seg);
    return wrap;
  }
  function paramSelect(label, options, current, onPick) {
    const wrap = el('div', 'param');
    wrap.append(el('div', 'param-label', `<span>${esc(label)}</span>`));
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', label);
    for (const [val, lab] of options) {
      const o = document.createElement('option');
      o.value = val; o.textContent = lab; o.selected = val === current;
      sel.append(o);
    }
    sel.onchange = () => onPick(sel.value);
    wrap.append(sel);
    return wrap;
  }

  function openInspector(part) {
    state.selected = part.id;
    state.engine.select(part.id);
    const insp = $('inspector');
    insp.classList.add('open');
    insp.inert = false;
    $('inspName').textContent = part.name;
    const dims = $('inspDims');
    dims.innerHTML = `<button type="button" class="prov-btn num" aria-label="${esc(part.name)} dimensions ${esc(fmt(part.size.w))} by ${esc(fmt(part.size.h))} by ${esc(fmt(part.size.d))} — show the formulas">${fmt(part.size.w)} × ${fmt(part.size.h)} × ${fmt(part.size.d)}</button>`;
    dims.querySelector('.prov-btn').onclick = e => {
      e.stopPropagation();
      const groupName = part.name.replace(/^Drawer \d+ /, 'Drawer ');
      const row = state.cut.find(r => r.name === groupName) ||
        { name: part.name, L: Math.max(part.size.w, part.size.h, part.size.d), W: 0, T: 0, allowance: 0, angles: BB.Geo.cutAngles(part.rot) };
      showProv(row, e.target);
    };
    const body = $('inspBody');
    body.textContent = '';
    const s = state.spec;

    const live = patch => preview(Spec.deepMerge(state.spec, patch));
    const done = () => commitPreview('manual');
    const dim = (label, path, min, max) => {
      const get = o => path.split('.').reduce((x, k) => x[k], o);
      return paramSlider(label, get(s), min, max, 5, true,
        v => { const p = {}; let o = p; const ks = path.split('.'); ks.slice(0, -1).forEach(k => o = o[k] = {}); o[ks[ks.length - 1]] = v; live(p); },
        () => done());
    };

    if (s.meta.template !== 'custom') {
      body.append(dim('Width', 'overall.width', 250, 2400));
      body.append(dim('Depth', 'overall.depth', 200, 1200));
      body.append(dim('Height', 'overall.height', 120, 2400));
    } else {
      body.append(el('p', '', '<span style="font-size:var(--text-s);color:var(--muted)">Novel composition: refine dimensions through the chat — code re-validates the whole structure on every change.</span>'));
    }
    if (part.role === 'leg') body.append(dim('Leg thickness', 'structure.legThickness', 32, 100));
    if (part.role === 'apron' || part.role === 'rail') body.append(dim('Apron height', 'structure.apronHeight', 60, 160));
    if (part.role === 'top' || part.role === 'seat') body.append(dim('Top thickness', 'structure.topThickness', 12, 45));
    if (part.role === 'shelf' || s.meta.template === 'bookshelf') {
      body.append(paramSlider('Shelf count', s.structure.shelfCount, 0, 8, 1, false,
        v => live({ structure: { shelfCount: v } }), () => done()));
    }
    if (part.drawer !== undefined && part.drawer !== null && s.drawers) {
      body.append(paramSlider('Drawer count', s.drawers.count, 1, 4, 1, false,
        v => live({ drawers: { count: v } }), () => done()));
      body.append(paramSeg('Front style', [['inset', 'Inset'], ['overlay', 'Overlay']], s.drawers.frontStyle,
        v => { merge({ drawers: { frontStyle: v } }, 'manual'); openInspectorById(part.id); }));
      const runnerOpts = [['side_mount_slides', 'Slides']];
      if (s.meta.level !== 'beginner') runnerOpts.push(['undermount_slides', 'Undermount'], ['wood_runners', 'Wood runners']);
      body.append(paramSeg('Runners', runnerOpts, s.drawers.runner,
        v => { merge({ drawers: { runner: v } }, 'manual'); openInspectorById(part.id); }));
      body.append(paramSelect('Pull style', Object.values(BB.HW.PULLS).map(p => [p.key, p.label]),
        s.hardware.pull, v => { merge({ hardware: { pull: v } }, 'manual'); openInspectorById(part.id); }));
    }
    body.append(paramSelect('Species', Object.values(K.WOOD_SPECIES).filter(x => !x.sheet).map(x => [x.key, x.label]),
      s.wood.species, v => { merge({ wood: { species: v } }, 'manual'); openInspectorById(part.id); }));
    body.append(paramSelect('Sheet stock', Object.values(K.WOOD_SPECIES).filter(x => x.sheet).map(x => [x.key, x.label]),
      s.wood.sheetSpecies, v => { merge({ wood: { sheetSpecies: v } }, 'manual'); openInspectorById(part.id); }));
    body.append(paramSelect('Finish', K.FINISHES.map(f => [f.key, f.label]), s.finish,
      v => { merge({ finish: v }, 'manual'); openInspectorById(part.id); }));
  }
  function openInspectorById(id) {
    const part = state.model.parts.find(p => p.id === id);
    if (part) openInspector(part);
    else closeInspector();
  }
  function closeInspector() {
    // Closing mid-drag commits the pending preview: the model on screen
    // already shows it, and the slider's own change event commits the same
    // way — the design must never silently diverge from history.
    commitPreview('manual');
    state.selected = null;
    state.engine.select(null);
    $('inspector').classList.remove('open');
    $('inspector').inert = true;
  }

  /* ---------------- playback ---------------- */
  function enterPlayback(i) {
    clearCompare();
    closeInspector();
    state.playbackIndex = i;
    state.engine.playbackEnter(state.steps);
    state.engine.playbackGoTo(i);
    state.engine.playbackReplay();
    $('playbackBar').hidden = state.bmPlayback;
    updatePlaybackBar();
    if (!state.bmPlayback) {
      if (state.tab !== 'assembly') { state.tab = 'assembly'; renderTabs(); }
      renderPanel();
      const active = document.querySelector(`.step-item[data-step="${i}"]`);
      if (active) active.scrollIntoView({ block: 'nearest', behavior: reduceMq.matches ? 'auto' : 'smooth' });
    }
  }
  function updatePlaybackBar() {
    const s = state.steps[state.playbackIndex];
    $('pbCount').textContent = `${state.playbackIndex + 1}/${state.steps.length}`;
    $('pbLabel').textContent = s ? s.title : '';
    $('pbPrev').disabled = state.playbackIndex <= 0;
    $('pbNext').disabled = state.playbackIndex >= state.steps.length - 1;
    if (state.bmPlayback) {
      $('bmPbLabel').textContent = s ? `${state.playbackIndex + 1}/${state.steps.length} — ${s.title}` : '';
      $('bmPbPrev').disabled = state.playbackIndex <= 0;
      $('bmPbNext').disabled = state.playbackIndex >= state.steps.length - 1;
    }
  }
  function scrubPlayback(i) {
    if (i < 0 || i >= state.steps.length) return;
    state.playbackIndex = i;
    state.engine.playbackGoTo(i);
    state.engine.playbackReplay();
    updatePlaybackBar();
    if (!state.bmPlayback) {
      renderPanel();
      const active = document.querySelector(`.step-item[data-step="${i}"]`);
      if (active) active.scrollIntoView({ block: 'nearest', behavior: reduceMq.matches ? 'auto' : 'smooth' });
    }
  }
  function exitPlayback() {
    if (state.playbackIndex < 0) return;
    state.playbackIndex = -1;
    state.engine.playbackExit();
    $('playbackBar').hidden = true;
    if (!state.bmPlayback) renderPanel();
  }

  /* ---------------- history ---------------- */
  function renderHistory() {
    const list = $('historyList');
    list.textContent = '';
    const snaps = [...state.history.snapshots].reverse();
    const checked = new Set(state.compare ? [state.compare.aId, state.compare.bId].filter(x => x !== undefined) : []);
    for (const snap of snaps) {
      const item = el('div', 'snap' + (snap === state.history.current() ? ' current' : ''));
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = checked.has(snap.id);
      cb.setAttribute('aria-label', 'Select snapshot for comparison');
      cb.dataset.snapId = snap.id;
      cb.onchange = updateCompareSelection;
      const info = el('div', 'snap-info');
      info.innerHTML = `<div class="snap-title">${esc(state.history.label(snap))} <span class="snap-source">${esc(snap.source)}</span></div>
        <div class="snap-summary">${esc(snap.summary.slice(0, 3).join(' · '))}${snap.summary.length > 3 ? ' · …' : ''}</div>`;
      const restore = el('button', 'btn small', 'Restore');
      restore.onclick = () => {
        const spec = state.history.restore(snap.id);
        if (spec) { restoreTo(spec); }
      };
      if (snap === state.history.current()) restore.disabled = true;
      item.append(cb, info, restore);
      list.append(item);
    }
  }
  function updateCompareSelection() {
    const boxes = [...document.querySelectorAll('#historyList input[type="checkbox"]:checked')];
    if (boxes.length > 2) { this.checked = false; return; }
    $('compareBtn').disabled = boxes.length !== 2;
  }
  function openCompare() {
    const boxes = [...document.querySelectorAll('#historyList input[type="checkbox"]:checked')];
    if (boxes.length !== 2) return;
    let [a, b] = boxes.map(x => +x.dataset.snapId).sort((x, y) => x - y);
    const cmp = state.history.compare(a, b);
    if (!cmp) return;
    state.compare = { aId: a, bId: b };
    $('compareTitle').textContent = `${state.history.label(cmp.a)} → ${state.history.label(cmp.b)}`;
    $('compareSub').textContent = cmp.diffs.length
      ? `${cmp.diffs.length} parameter${cmp.diffs.length > 1 ? 's' : ''} differ${cmp.diffs.length > 1 ? '' : 's'}.`
      : 'These two snapshots are dimensionally identical.';
    const rows = $('compareRows');
    rows.innerHTML = cmp.diffs.map(d => `<tr>
      <td>${esc(Spec.PATH_LABELS[d.path] || d.path)}</td>
      <td class="old num">${esc(Spec.fmtValue(d.path, d.from))}</td>
      <td class="new num">${esc(Spec.fmtValue(d.path, d.to))}</td></tr>`).join('') ||
      '<tr><td colspan="3" style="color:var(--muted)">No differences.</td></tr>';
    openScrim('compareScrim');
  }
  function showCompareOverlay() {
    if (!state.compare) return;
    const cmp = state.history.compare(state.compare.aId, state.compare.bId);
    restoreToWithoutClearingCompare(cmp.b.spec);
    const ghostModel = Parametric.build(Spec.correctSpec(Spec.clone(cmp.a.spec)));
    state.engine.setGhost(ghostModel);
    $('compareBanner').hidden = false;
    $('compareLabel').textContent = `Ghost: ${state.history.label(cmp.a)} behind ${state.history.label(cmp.b)}`;
    closeScrim('compareScrim');
    closeHistoryDrawer();
  }
  function restoreToWithoutClearingCompare(spec) {
    const r = runPipeline(spec);
    adopt(r);
    renderAdvisories(r.report);
    renderPanel();
    renderTopbar();
  }
  function clearCompare() {
    if (!state.compare) return;
    state.compare = null;
    state.engine.setGhost(null);
    $('compareBanner').hidden = true;
    $('compareBtn').disabled = true;
  }

  function openHistoryDrawer() {
    renderHistory();
    const d = $('historyDrawer');
    d.classList.add('open');
    d.inert = false;
    d.setAttribute('aria-hidden', 'false');
    $('historyBackdrop').hidden = false;
    // Everything behind the drawer goes inert: clicks and focus stay inside.
    document.querySelector('.topbar').inert = true;
    document.querySelector('.bench').inert = true;
    trapFocus(d);
  }
  function closeHistoryDrawer() {
    const d = $('historyDrawer');
    d.classList.remove('open');
    d.inert = true;
    d.setAttribute('aria-hidden', 'true');
    $('historyBackdrop').hidden = true;
    document.querySelector('.topbar').inert = false;
    document.querySelector('.bench').inert = false;
    releaseFocus(d);
  }

  /* ---------------- focus management ----------------
   * Every scrim and the history drawer trap Tab inside themselves while
   * open and hand focus back to the opener on close. Traps stack, so a
   * modal opened over the drawer restores into the drawer first. */
  const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
  const trapStack = [];
  function trapFocus(container) {
    if (trapStack.some(t => t.container === container)) return;
    const restoreTo = document.activeElement;
    const handler = e => {
      if (e.key !== 'Tab') return;
      const items = [...container.querySelectorAll(FOCUSABLE)].filter(x => x.getClientRects().length);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      const inside = container.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === first)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (!inside || document.activeElement === last)) { e.preventDefault(); first.focus(); }
    };
    container.addEventListener('keydown', handler);
    trapStack.push({ container, restoreTo, handler });
    const target = container.querySelector(FOCUSABLE);
    if (target) target.focus();
  }
  function releaseFocus(container) {
    const i = trapStack.findIndex(t => t.container === container);
    if (i < 0) return;
    const [t] = trapStack.splice(i, 1);
    t.container.removeEventListener('keydown', t.handler);
    if (t.restoreTo && document.contains(t.restoreTo)) {
      t.restoreTo.focus();
      if (document.activeElement !== t.restoreTo) {
        // Opener went inert with its closed menu — its menu button stands in.
        const wrap = t.restoreTo.closest('.menu-wrap');
        const btn = wrap && wrap.querySelector('[aria-haspopup="menu"]');
        if (btn) btn.focus();
      }
    }
  }

  /* ---------------- modals ----------------
   * Closed overlays carry `inert` so their controls leave the tab order and
   * the accessibility tree entirely — inert flips synchronously, so focus
   * can move in on the same tick the overlay opens. */
  function openScrim(id) {
    const s = $(id);
    if (s.classList.contains('open')) return;
    s.classList.add('open');
    s.inert = false;
    trapFocus(s);
  }
  function closeScrim(id) {
    const s = typeof id === 'string' ? $(id) : id;
    if (!s.classList.contains('open')) return;
    s.classList.remove('open');
    s.inert = true;
    releaseFocus(s);
  }

  const galleryCards = []; // [{card, model, spec}] — the idle thumbnail pass reads these
  const heroCards = [];    // [{card, starterIndex}] — hero starters share the same thumbs
  let galleryThumbs = null; // rendered thumbs, kept so every re-render gets them back
  function loadStarter(g, r) {
    hideHints(); // a loaded design replaces the first-run prompts
    state.dismissed.clear();
    state.project = null;   // a starter begins a fresh project
    state.turns = [];
    commit(g.spec, 'gallery', ['loaded “' + r.spec.meta.name + '”']);
    state.engine.frame();
    // First starter ever: the piece assembles itself once — the pipeline
    // dramatized in one shot. Reduced motion snaps it (engine-side).
    if (!state.prefs4.seenHero) {
      state.prefs4.seenHero = true;
      Store.savePrefs(state.prefs4);
      state.engine.heroAssemble();
    }
    botSay(`Loaded ${r.spec.meta.name} — ${r.model.parts.length} parts, plans ready. Tell me what to change.`, []);
    if (!state.prefs4.seenCoach) {
      state.prefs4.seenCoach = true;
      Store.savePrefs(state.prefs4);
      botSay('First build tips: 1) Check the Buy tab before you shop. 2) Use Build mode in the shop for cut-by-cut checkoffs. 3) If the Safety tab shows red, fix that before you build.', []);
    }
  }
  function renderGallery() {
    const grid = $('galleryGrid');
    grid.textContent = '';
    galleryCards.length = 0;
    for (const g of Gallery.STARTERS) {
      const r = runPipeline(g.spec);
      const card = el('button', 'gallery-card');
      card.innerHTML = `<span class="g-fallback" aria-hidden="true">${BB.Icons.svg('board', 26)}</span>
        <span class="g-name">${esc(r.spec.meta.name)}</span>
        <span class="g-caption">${esc(g.caption)}</span>
        <span class="g-meta">${fmt(r.spec.overall.width)} × ${fmt(r.spec.overall.depth)} × ${fmt(r.spec.overall.height)} · ${esc(K.WOOD_SPECIES[r.spec.wood.species].label)}</span>`;
      card.onclick = () => {
        closeScrim('galleryScrim');
        loadStarter(g, r);
      };
      grid.append(card);
      galleryCards.push({ card, model: r.model, spec: r.spec });
    }
    // The grid rebuilds on every open; without this the idle pass's work
    // would vanish after the first close (the new shell opens on demand).
    if (galleryThumbs) patchGalleryThumbs(galleryThumbs);
  }

  /* Three polished starters ride the hero — the same specs, pipeline, and
   * idle-rendered thumbnails as the gallery; skeletons until the thumbs land
   * (an honest empty sheet, never fabricated imagery). */
  const HERO_STARTER_INDEXES = [0, 3, 4]; // dining table, bookshelf, nightstand
  function renderHeroStarters() {
    const wrap = $('heroStarters');
    if (!wrap) return;
    wrap.textContent = '';
    heroCards.length = 0;
    for (const i of HERO_STARTER_INDEXES) {
      const g = Gallery.STARTERS[i];
      if (!g) continue;
      const r = runPipeline(g.spec);
      const card = el('button', 'hero-starter');
      card.innerHTML = `<span class="g-fallback" aria-hidden="true">${BB.Icons.svg('board', 22)}</span>
        <span class="hs-name">${esc(r.spec.meta.name)}</span>`;
      card.setAttribute('aria-label', `Start from the ${r.spec.meta.name}`);
      card.onclick = () => loadStarter(g, r);
      wrap.append(card);
      heroCards.push({ card, starterIndex: i });
    }
    if (galleryThumbs) patchGalleryThumbs(galleryThumbs);
  }

  /* Real 3D thumbnails for the starter cards, rendered by a throwaway
   * mini-engine after boot settles. Cached in storage keyed by a hash of the
   * starter specs, so repeat boots skip GL work entirely. Failures leave the
   * skeleton cards — this pass is decoration, never load-bearing. */
  const THUMBS_KEY = 'gallery:thumbs:v1';
  function startersHash() {
    const s = JSON.stringify(Gallery.STARTERS.map(g => g.spec));
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }
  function patchGalleryThumbs(thumbs) {
    galleryThumbs = thumbs;
    const swap = (card, thumb) => {
      if (!thumb) return;
      const fallback = card.querySelector('.g-fallback');
      if (!fallback) return;
      const img = document.createElement('img');
      img.className = 'g-thumb';
      img.alt = '';
      img.src = thumb;
      fallback.replaceWith(img);
      requestAnimationFrame(() => img.classList.add('on'));
    };
    galleryCards.forEach(({ card }, i) => swap(card, thumbs[i]));
    heroCards.forEach(({ card, starterIndex }) => swap(card, thumbs[starterIndex]));
  }
  async function galleryThumbsPass() {
    try {
      const hash = startersHash();
      const cached = await Store.get(THUMBS_KEY);
      if (cached && cached.hash === hash && Array.isArray(cached.thumbs)) {
        patchGalleryThumbs(cached.thumbs);
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:fixed;left:-9999px;top:0;width:256px;height:192px;';
      document.body.append(canvas);
      const mini = BB.Engine.create(canvas, { reducedMotion: true });
      const thumbs = [];
      for (const { model, spec } of galleryCards) {
        mini.setModel(model, spec, { snap: true });
        mini.frame();
        mini.snapNow();
        thumbs.push(Store.makeThumb(mini.renderNow()));
      }
      mini.dispose();
      canvas.remove();
      patchGalleryThumbs(thumbs);
      await Store.set(THUMBS_KEY, { hash, thumbs });
    } catch (e) { /* skeleton cards remain */ }
  }

  /* ---------------- My Projects (Phase 4 item 2) ---------------- */
  async function openProjects() {
    const grid = $('projectsGrid');
    grid.innerHTML = '<p class="sub">Loading…</p>';
    openScrim('projectsScrim');
    const idx = await Store.loadIndex();
    const mode = Store.persistenceMode();
    const a = Store.auth();
    $('storageNote').textContent = mode === 'session'
      ? 'Storage is unavailable — projects live for this session only.'
      : mode === 'device' && a.providers.length && a.storage
        ? 'Saved on this device. Sign in (More menu) to sync projects across devices.'
        : mode === 'cloud' ? `Synced to your account${a.user ? ` (${a.user.name})` : ''}.` : '';
    grid.textContent = '';
    if (!idx.length) {
      grid.innerHTML = '<p class="sub">No projects yet — designs save here automatically as you work.</p>';
      return;
    }
    // Thumbnails are stored as their own per-project docs (A5); load them in
    // parallel. `row.thumb` is the legacy embedded fallback for an index not yet
    // migrated by a save.
    const thumbList = await Promise.all(idx.map(r => Store.loadThumb(r.id).catch(() => null)));
    const thumbById = {};
    idx.forEach((r, i) => { thumbById[r.id] = thumbList[i] || r.thumb || null; });
    for (const row of idx) {
      const card = el('div', 'project-card' + (state.project && state.project.id === row.id ? ' current' : ''));
      const thumbSrc = thumbById[row.id];
      const thumb = thumbSrc
        ? `<img class="p-thumb" src="${esc(thumbSrc)}" alt="">`
        : `<div class="p-thumb empty" aria-hidden="true">${BB.Icons.svg('board', 22)}</div>`;
      card.innerHTML = `${thumb}
        <span class="p-name">${esc(row.name)}</span>
        <span class="p-meta">${esc(row.dims || '')}</span>
        <span class="p-meta">${new Date(row.updated).toLocaleDateString()} ${new Date(row.updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${row.progressPct ? ` · built ${row.progressPct}%` : ''}</span>
        ${row.progressPct ? `<span class="p-progress"><i style="width:${row.progressPct}%"></i></span>` : ''}`;
      const actions = el('div', 'p-actions');
      const openB = el('button', 'btn primary', 'Open');
      openB.onclick = () => loadProjectIntoApp(row.id);
      const renameB = el('button', 'btn', 'Rename');
      renameB.onclick = () => {
        const nameEl = card.querySelector('.p-name');
        const input = document.createElement('input');
        input.value = row.name;
        input.className = 'design-name';
        input.style.width = '100%';
        input.setAttribute('aria-label', 'New project name');
        nameEl.replaceWith(input);
        input.focus(); input.select();
        const finish = async () => {
          const name = input.value.trim().slice(0, 60) || row.name;
          await Store.renameProject(row.id, name);
          if (state.project && state.project.id === row.id) {
            merge({ meta: { name } }, 'manual', ['renamed to “' + name + '”']);
          }
          openProjects();
        };
        input.addEventListener('keydown', e => { if (e.key === 'Enter') finish(); if (e.key === 'Escape') openProjects(); });
        input.addEventListener('blur', finish);
      };
      const dupB = el('button', 'btn', 'Duplicate');
      dupB.onclick = async () => { if (await BB.Billing.gateNewProject()) { await Store.duplicateProject(row.id); openProjects(); } };
      const delB = el('button', 'btn', 'Delete');
      delB.onclick = () => {
        const confirmRow = el('div', 'confirm-row');
        confirmRow.append(el('span', '', 'Delete forever?'));
        const yes = el('button', 'btn small', 'Delete');
        yes.style.color = 'var(--brick)';
        yes.onclick = async () => {
          await Store.deleteProject(row.id);
          if (state.project && state.project.id === row.id) state.project = null;
          openProjects();
        };
        const no = el('button', 'btn small ghost', 'Keep');
        no.onclick = () => openProjects();
        confirmRow.append(yes, no);
        actions.replaceWith(confirmRow);
      };
      actions.append(openB, renameB, dupB, delB);
      card.append(actions);
      grid.append(card);
    }
  }

  async function loadProjectIntoApp(id) {
    const rec = await Store.loadProject(id);
    if (!rec) return false;
    const spec = Spec.correctSpec(Codec.decode(rec.wire));
    exitBuildMode();
    exitPlayback();
    clearCompare();
    hideHints(); // an opened project replaces the first-run prompts
    // Rebuild the revision history from the stored snapshots.
    let hist = null;
    for (const rev of rec.revisions || []) {
      const revSpec = Spec.correctSpec(Codec.decode(rev.wire));
      if (!hist) hist = History.createHistory(revSpec, rev.source || 'project');
      else hist.push(revSpec, rev.source || 'project', rev.summary);
    }
    if (!hist) hist = History.createHistory(spec, 'project');
    state.history = hist;
    state.project = { id, progress: rec.progress || { cuts: {}, steps: {} } };
    state.turns = [];
    state.dismissed.clear();
    state.previewing = false; // the loaded project replaces any pending preview
    const r = runPipeline(state.history.currentSpec() || spec);
    adopt(r);
    renderAll();
    state.engine.frame();
    closeScrim('projectsScrim');
    closeScrim('galleryScrim');
    botSay(`Opened “${rec.name}” — plans, history, and build progress restored. Tell me what to change.`, []);
    return true;
  }

  /* ---------------- share codes (Phase 4 item 2) ---------------- */
  function openShareSheet() {
    const link = shareLink();
    const row = $('shareLinkRow');
    if (row) {
      row.hidden = !link;
      if (link) $('shareLinkText').value = link;
      $('shareLinkNote').hidden = !!link;
    }
    openShare();
  }
  function openShare() {
    const code = Codec.toShareCode(state.spec);
    $('shareCode').value = code;
    $('shareMeta').textContent = `${code.length} chars · ~${Codec.estimateTokens(code)} tokens`;
    $('importMsg').textContent = '';
    $('importCode').value = '';
    openScrim('shareScrim');
  }
  async function copyShare() {
    const ta = $('shareCode');
    ta.select();
    let ok = false;
    try { await navigator.clipboard.writeText(ta.value); ok = true; }
    catch (e) { try { ok = document.execCommand('copy'); } catch (e2) { /* leave selected */ } }
    $('copyShare').textContent = ok ? 'Copied ✓' : 'Copy manually (selected)';
    setTimeout(() => { $('copyShare').textContent = 'Copy code'; }, 1600);
  }
  function importCodeText(text, sourceLabel) {
    const res = Codec.fromShareCode(text);
    if (res.error) return { error: res.error };
    state.project = null; // imported design becomes a fresh project
    state.turns = [];
    state.dismissed.clear();
    const ok = commit(res.spec, 'import', ['imported from ' + (sourceLabel || 'share code')]);
    if (!ok) return { error: 'That design decoded but won’t build.' };
    state.engine.frame();
    botSay(`Imported “${state.spec.meta.name}” from a ${sourceLabel || 'share code'} — migrated to spec v${state.spec.specVersion} and revalidated.`, []);
    return { ok: true };
  }
  function importShare() {
    const res = importCodeText($('importCode').value);
    if (res.error) { $('importMsg').textContent = res.error; return; }
    closeScrim('shareScrim');
  }
  /* The app's own URL for export footers and share links (audit A-11).
   * Runtime state stays HERE — the exporters receive it as an argument and
   * remain pure. Empty on file:// and sandboxed hosts. */
  function appOrigin() {
    return location.origin && location.origin !== 'null'
      ? (location.origin + location.pathname).replace(/index\.html?$/, '')
      : '';
  }
  /* The share LINK is the same self-contained code riding the URL hash —
   * no server, works wherever the app is hosted. The ref marker attributes
   * shared-link arrivals; import tolerates and strips it (Codec). */
  function shareLink() {
    return location.origin && location.origin !== 'null'
      ? location.origin + location.pathname + '#d=' + encodeURIComponent(Codec.toShareCode(state.spec)) + '&ref=share'
      : null; // file:// has no shareable origin — the sheet says so honestly
  }

  /* ---------------- species comparison (stretch) ---------------- */
  function openSpecies() {
    if (!state.speciesPick.length) {
      const cur = state.spec.wood.species;
      state.speciesPick = [cur, ...['hard_maple', 'walnut', 'pine'].filter(s => s !== cur)].slice(0, 3);
    }
    renderSpeciesPick();
    renderSpeciesTable();
    openScrim('speciesScrim');
  }
  function renderSpeciesPick() {
    const wrap = $('speciesPick');
    wrap.textContent = '';
    for (const sp of Object.values(K.WOOD_SPECIES)) {
      if (sp.sheet) continue;
      const b = el('button', '', esc(sp.label));
      b.setAttribute('aria-pressed', String(state.speciesPick.includes(sp.key)));
      b.onclick = () => {
        if (state.speciesPick.includes(sp.key)) state.speciesPick = state.speciesPick.filter(k => k !== sp.key);
        else if (state.speciesPick.length < 3) state.speciesPick.push(sp.key);
        renderSpeciesPick();
        renderSpeciesTable();
      };
      wrap.append(b);
    }
  }
  function renderSpeciesTable() {
    const wrap = $('speciesTableWrap');
    const cols = Compare.compareSpecies(state.spec, state.speciesPick, {
      prices: state.prices, stockMode: state.prefs4.stockMode,
      loadChoices: state.loadChoices, defaultLoad: 'auto', climate: state.prefs4.climate
    });
    if (!cols.length) { wrap.innerHTML = '<p class="sub">Pick up to three species above.</p>'; return; }
    const best = fn => {
      const vals = cols.map(fn).filter(v => v != null);
      return vals.length ? Math.min(...vals) : null;
    };
    const bestCost = best(c => c.cost), bestMove = best(c => c.movementMM), bestWeight = best(c => c.weightKg);
    const maxSag = Math.max(...cols.map(c => c.sagMargin || 0));
    const cell = (v, isBest, suffix) => `<td class="num${isBest ? ' species-best' : ''}">${v}${suffix || ''}</td>`;
    wrap.innerHTML = `<table class="data"><thead><tr><th></th>${cols.map(c =>
      `<th><button type="button" class="species-col-btn" data-sp="${c.key}" title="Use ${esc(c.label)}">${esc(c.label)} ${BB.Icons.svg('arrow', 12)}</button></th>`).join('')}</tr></thead><tbody>
      <tr><td>Purchasable cost</td>${cols.map(c => cell('$' + c.cost.toFixed(2), c.cost === bestCost)).join('')}</tr>
      <tr><td>Weight</td>${cols.map(c => cell(esc(Units.fmtWeight(c.weightKg)), c.weightKg === bestWeight)).join('')}</tr>
      <tr><td>Sag margin (critical span)</td>${cols.map(c => cell(c.sagMargin == null ? '—' : c.sagMargin + '×', c.sagMargin === maxSag && maxSag > 0, c.worstSagMM != null ? ` <span style="color:var(--muted)">(${esc(fmtS(c.worstSagMM))} over ${esc(fmt(c.span))})</span>` : '')).join('')}</tr>
      <tr><td>Seasonal movement (worst panel)</td>${cols.map(c => cell(esc(fmtS(c.movementMM)), c.movementMM === bestMove)).join('')}</tr>
      <tr><td>Janka surface duty</td>${cols.map(c => cell(c.janka + ' lbf', false, ` <span style="color:var(--muted)">${esc(c.duty)}</span>`)).join('')}</tr>
      <tr><td>Failing checks</td>${cols.map(c => cell(c.fails, c.fails === 0)).join('')}</tr>
    </tbody></table>`;
    wrap.querySelectorAll('.species-col-btn').forEach(b => {
      b.onclick = () => {
        merge({ wood: { species: b.dataset.sp } }, 'compare', ['species → ' + K.WOOD_SPECIES[b.dataset.sp].label]);
        closeScrim('speciesScrim');
        botSay(`Switched to ${K.WOOD_SPECIES[b.dataset.sp].label} from the comparison.`, []);
      };
    });
  }

  /* ---------------- diagnostics panel (long-press the logo) ---------------- */
  async function runDiagnostics() {
    const body = $('diagBody');
    body.innerHTML = '<p class="sub">Running the assertion suite…</p>';
    $('diagSummary').textContent = '';
    const results = await BB.SelfTest.run();
    const groups = [...new Set(results.map(r => r.group))];
    body.textContent = '';
    for (const g of groups) {
      body.append(el('div', 'diag-group', esc(g)));
      for (const r of results.filter(x => x.group === g)) {
        const row = el('div', 'diag-row' + (r.pass ? '' : ' fail'));
        row.innerHTML = `<span class="diag-dot" aria-hidden="true"></span>
          <span style="flex:1">${esc(r.name)}${r.pass ? '' : `<div class="diag-detail">actual: ${esc(r.actual)} · expected: ${esc(r.expected)}</div>`}</span>`;
        body.append(row);
      }
    }
    const fails = results.filter(r => !r.pass).length;
    $('diagSummary').textContent = `${results.length - fails}/${results.length} green${fails ? ` · ${fails} RED` : ''}`;
    $('diagSummary').style.color = fails ? 'var(--brick)' : 'var(--green)';
  }
  function bindLogoLongPress() {
    const logo = $('brandLogo');
    const openDiag = () => { openScrim('diagScrim'); runDiagnostics(); };
    let timer = null;
    const start = e => {
      timer = setTimeout(openDiag, 650);
    };
    const cancel = () => { clearTimeout(timer); timer = null; };
    logo.addEventListener('pointerdown', start);
    logo.addEventListener('pointerup', cancel);
    logo.addEventListener('pointerleave', cancel);
    logo.addEventListener('pointercancel', cancel);
    // Keyboard reachability (M-16): the logo is a real button, so Enter and
    // Space arrive as a click with detail 0 — those open directly. Pointer
    // taps (detail ≥ 1) keep the deliberate long-press requirement.
    logo.addEventListener('click', e => { if (e.detail === 0) openDiag(); });
    logo.addEventListener('contextmenu', e => e.preventDefault());
  }

  /* ---------------- build mode (Phase 4 item 5) ---------------- */
  async function requestWakeLock() {
    try {
      state.wakeLock = await navigator.wakeLock.request('screen');
      $('bmWake').textContent = 'screen staying awake';
      state.wakeLock.addEventListener('release', () => { if (state.buildMode) $('bmWake').textContent = ''; });
    } catch (e) {
      state.wakeLock = null;
      $('bmWake').textContent = ''; // silent fallback
    }
  }
  function releaseWakeLock() {
    try { if (state.wakeLock) state.wakeLock.release(); } catch (e) { /* silent */ }
    state.wakeLock = null;
  }
  document.addEventListener('visibilitychange', () => {
    if (state.buildMode && document.visibilityState === 'visible') requestWakeLock();
  });

  const cutKey = Plans.cutKey; // shared with checklistKeys so keys, pruning, and progress agree

  function enterBuildMode() {
    if (!BB.Billing.gate('advancedFeatures', 'The full-screen workshop companion and advanced build tools are included with Pro.')) return;
    if (!state.project) { state.project = { id: Store.newId(), progress: { cuts: {}, steps: {} } }; scheduleAutosave(); }
    state.buildMode = true;
    state.bmTask = null; // pager re-lands on the first unfinished task
    $('buildMode').hidden = false;
    $('bmName').textContent = state.spec.meta.name;
    renderBuildChecklists();
    trapFocus($('buildMode')); // keyboard users land on the shop surface
    requestWakeLock();
    renderReadiness(); // Build takes aria-current in the mode nav
  }
  function exitBuildMode() {
    if (!state.buildMode) return;
    state.buildMode = false;
    exitBmPlayback();
    $('buildMode').hidden = true;
    releaseFocus($('buildMode'));
    releaseWakeLock();
    scheduleAutosave();
    renderReadiness(); // the underlying mode resumes aria-current
  }

  function toggleProgress(map, key, btn, src) {
    map[key] = !map[key];
    btn.setAttribute('aria-pressed', String(!!map[key]));
    btn.querySelector('.box').innerHTML = map[key] ? BB.Icons.svg('check', 20) : '';
    $('bmProgress').textContent = progressPct() + '% built';
    renderReadiness(); // the Build step tracks shop progress live
    scheduleAutosave();
    // The two build surfaces stay in step: checking on one re-renders the
    // OTHER (never the one holding focus).
    if (src === 'pager') renderBuildChecklists({ columnsOnly: true });
    else renderBmTask();
    // First fully-built project: one quiet install suggestion (see nudge).
    if (progressPct() >= 100) maybeInstallNudge();
  }

  function checkButton(label, dims, checked, onToggle) {
    const b = el('button', 'bm-check');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(!!checked));
    b.innerHTML = `<span class="box" aria-hidden="true">${checked ? BB.Icons.svg('check', 20) : ''}</span>
      <span class="bm-check-label">${esc(label)}</span>
      ${dims ? `<span class="bm-check-dims">${esc(dims)}</span>` : ''}`;
    b.onclick = () => onToggle(b);
    return b;
  }

  /* One derivation of the build work-list feeds BOTH surfaces (wide two-
   * column checklist and the phone one-task pager), so progress keys can
   * never drift between them. */
  function checksForBoard(b, bi) {
    return b.cuts.map((c, ci) => ({ key: cutKey('b', bi, ci, c.name, c.len), label: c.name, dims: fmt(c.len) }));
  }
  function checksForSheet(s, si) {
    return s.placements.map((p, pi) => ({ key: cutKey('s', si, pi, p.name, Math.round(p.w)), label: p.name, dims: `${fmt(p.w)} × ${fmt(p.h)}` }));
  }
  function checksForRough() {
    const out = [];
    state.cut.filter(r => r.stock !== 'sheet').forEach((r, ri) => {
      for (let qi = 0; qi < r.qty; qi++) {
        out.push({
          key: cutKey('r', ri, qi, r.name, r.L),
          label: r.qty > 1 ? `${r.name} (${qi + 1} of ${r.qty})` : r.name,
          dims: `${fmt(r.L)} × ${fmt(r.W)} × ${fmt(r.T)}`
        });
      }
    });
    return out;
  }
  function buildTasks() {
    const plan = state.stockPlan;
    const tasks = [];
    plan.boards.forEach((b, bi) => {
      if (!b.stockLen) return;
      tasks.push({
        kind: 'board', title: `Board ${bi + 1} — ${Units.fmtNominal(b.nominal, b.actual, b.stockLen)}`,
        svg: () => Packing.boardSVG(b, fmt), largeSvg: () => Packing.boardSVG(b, fmt, { large: true }),
        checks: checksForBoard(b, bi)
      });
    });
    plan.sheets.forEach((s, si) => {
      tasks.push({
        kind: 'sheet', title: `Sheet ${si + 1} — ${fmt(s.thickness)} (${s.fractionLabel})`,
        svg: () => Packing.sheetSVG(s, fmt), largeSvg: () => Packing.sheetSVG(s, fmt, { large: true }),
        checks: checksForSheet(s, si)
      });
    });
    if (plan.mode === 'rough') {
      tasks.push({ kind: 'rough', title: 'Cut list (rough stock)', checks: checksForRough() });
    }
    state.steps.forEach((s, i) => {
      tasks.push({ kind: 'step', title: `Step ${i + 1} — ${s.title}`, stepIndex: i, stepId: s.id, text: s.text });
    });
    return tasks;
  }

  function renderBuildChecklists(opts) {
    const cuts = $('bmCuts');
    const stepsEl = $('bmSteps');
    cuts.textContent = '';
    stepsEl.textContent = '';
    const prog = state.project.progress;
    const plan = state.stockPlan;

    // Cuts grouped by stock board, straight from the optimizer diagrams —
    // the user works board by board.
    const diagram = (title, svg, getLargeSvg) => {
      const d = el('div', 'bm-diagram');
      d.dataset.diagramTitle = title;
      d.innerHTML = svg;
      wireDiagramZoom(d, getLargeSvg);
      return d;
    };
    const checkRows = (group, checks) => {
      for (const c of checks) {
        group.append(checkButton(c.label, c.dims, prog.cuts[c.key], btn => toggleProgress(prog.cuts, c.key, btn)));
      }
    };
    plan.boards.forEach((b, bi) => {
      if (!b.stockLen) return;
      const group = el('div', 'bm-board');
      const title = `Board ${bi + 1} — ${Units.fmtNominal(b.nominal, b.actual, b.stockLen)}`;
      group.append(el('div', 'bm-board-title', esc(title)));
      // The same drafting diagram as the Buy tab, at the saw: which piece
      // comes out of which end of this exact board.
      group.append(diagram(title, Packing.boardSVG(b, fmt), () => Packing.boardSVG(b, fmt, { large: true })));
      checkRows(group, checksForBoard(b, bi));
      cuts.append(group);
    });
    plan.sheets.forEach((s, si) => {
      const group = el('div', 'bm-board');
      const title = `Sheet ${si + 1} — ${fmt(s.thickness)} (${s.fractionLabel})`;
      group.append(el('div', 'bm-board-title', esc(title)));
      group.append(diagram(title, Packing.sheetSVG(s, fmt), () => Packing.sheetSVG(s, fmt, { large: true })));
      checkRows(group, checksForSheet(s, si));
      cuts.append(group);
    });
    if (plan.mode === 'rough') {
      const group = el('div', 'bm-board');
      group.append(el('div', 'bm-board-title', 'Cut list (rough stock)'));
      // One check per physical piece, not per quantity batch — you cut them
      // one at a time, you check them one at a time.
      checkRows(group, checksForRough());
      cuts.append(group);
    }
    if (!cuts.children.length) cuts.append(el('p', 'sub', 'No cuts — the design has no parts.'));

    // Assembly steps: tap to check; play opens step-synced 3D full screen.
    const stepsWrap = el('div', 'bm-steps');
    state.steps.forEach((s, i) => {
      const row = el('div', '');
      row.style.display = 'flex';
      row.style.gap = '8px';
      row.style.alignItems = 'stretch';
      const btn = checkButton(`${i + 1}. ${s.title}`, null, prog.steps[s.id], b => toggleProgress(prog.steps, s.id, b));
      btn.style.flex = '1';
      const play = el('button', 'bm-step-play', BB.Icons.svg('play', 20));
      play.setAttribute('aria-label', `Play 3D animation for step ${i + 1}`);
      play.onclick = () => enterBmPlayback(i);
      row.append(btn, play);
      stepsWrap.append(row);
    });
    stepsEl.append(stepsWrap);
    $('bmProgress').textContent = progressPct() + '% built';
    if (!(opts && opts.columnsOnly)) renderBmTask();
  }

  /* ---------------- phone pager: one board or one step at a time ---------- */
  function taskDone(t, prog) {
    if (t.kind === 'step') return !!prog.steps[t.stepId];
    return t.checks.length > 0 && t.checks.every(c => prog.cuts[c.key]);
  }
  function renderBmTask() {
    const pager = $('bmPager');
    if (!pager) return;
    pager.textContent = '';
    const tasks = buildTasks();
    if (!tasks.length) { pager.append(el('p', 'sub', 'No cuts or steps — the design has no parts.')); return; }
    const prog = state.project.progress;
    if (state.bmTask == null) {
      const firstOpen = tasks.findIndex(t => !taskDone(t, prog));
      state.bmTask = firstOpen < 0 ? 0 : firstOpen;
    }
    state.bmTask = Math.max(0, Math.min(tasks.length - 1, state.bmTask));
    const t = tasks[state.bmTask];
    const card = el('section', 'bm-task');
    card.setAttribute('aria-label', t.title);
    card.append(el('div', 'bm-board-title', esc(t.title)));
    if (t.svg) {
      const d = el('div', 'bm-diagram bm-diagram-hero');
      d.dataset.diagramTitle = t.title;
      d.innerHTML = t.largeSvg();
      wireDiagramZoom(d, t.largeSvg);
      card.append(d);
      card.append(el('p', 'bm-zoom-hint', 'Tap the diagram to enlarge · drag sideways to see the whole board'));
    }
    if (t.kind === 'step') {
      if (t.text) card.append(el('p', 'bm-step-text', esc(t.text)));
      const row = el('div', 'bm-step-row');
      const btn = checkButton('Done — ' + t.title.replace(/^Step \d+ — /, ''), null, prog.steps[t.stepId],
        b => toggleProgress(prog.steps, t.stepId, b, 'pager'));
      btn.style.flex = '1';
      const play = el('button', 'bm-step-play', BB.Icons.svg('play', 20));
      play.setAttribute('aria-label', `Play 3D animation for this step`);
      play.onclick = () => enterBmPlayback(t.stepIndex);
      row.append(btn, play);
      card.append(row);
    } else {
      for (const c of t.checks) {
        card.append(checkButton(c.label, c.dims, prog.cuts[c.key], btn => toggleProgress(prog.cuts, c.key, btn, 'pager')));
      }
    }
    pager.append(card);
    $('bmTaskPos').textContent = `${state.bmTask + 1} of ${tasks.length}`;
    $('bmTaskPrev').disabled = state.bmTask === 0;
    $('bmTaskNext').textContent = state.bmTask === tasks.length - 1 ? 'Done' : 'Next';
  }
  function bmTaskGo(delta) {
    const tasks = buildTasks();
    if (!tasks.length) return;
    const next = (state.bmTask || 0) + delta;
    if (next >= tasks.length) { exitBuildMode(); return; } // "Done" walks out of the shop
    state.bmTask = Math.max(0, next);
    renderBmTask();
    $('bmPager').scrollTop = 0;
  }

  /* ---------------- install nudge (once, after the first finished build) --- */
  function maybeInstallNudge() {
    if (state.prefs4.installNudged || !state.buildMode) return;
    state.prefs4.installNudged = true;
    Store.savePrefs(state.prefs4);
    const box = $('bmInstall');
    box.hidden = false;
    $('bmInstallGo').hidden = !state.installPrompt;
    if (!state.installPrompt) {
      // No install event on this browser (iOS Safari, or already installed):
      // say the honest thing instead of a dead button.
      $('bmInstallText').textContent = /iPhone|iPad/.test(navigator.userAgent)
        ? 'Nice build. For next time: Share → Add to Home Screen keeps Blueprint Buddy one tap from the shop.'
        : 'Nice build. Bookmark or install this page and the next project opens straight from the shop.';
    }
  }

  function enterBmPlayback(i) {
    state.bmPlayback = true;
    document.body.classList.add('bm-playback');
    $('bmPlaybar').hidden = false;
    enterPlayback(i);
    state.engine.resize();
  }
  function exitBmPlayback() {
    if (!state.bmPlayback) return;
    state.bmPlayback = false;
    document.body.classList.remove('bm-playback');
    $('bmPlaybar').hidden = true;
    exitPlayback();
    state.engine.resize();
    if (state.buildMode) {
      renderBuildChecklists();
      $('bmExit').focus(); // hand focus back into the checklist surface
    }
  }

  /* ---------------- shell: chat collapse (pointer layouts) ----------------
   * The mobile sheet keeps its own handle; this fold only means anything at
   * ≥881px, where the chat is a column. State persists across sessions. */
  function setChatCollapsed(on, opts) {
    on = !!on;
    state.prefs4.ui.chatCollapsed = on;
    $('chatPanel').classList.toggle('collapsed', on);
    $('chatRail').hidden = !on;
    $('chatCollapse').setAttribute('aria-expanded', String(!on));
    if (!on) $('chatRailDot').hidden = true;
    if (!opts || opts.persist !== false) {
      Store.savePrefs(state.prefs4);
      if (state.spec) syncHash();
    }
  }
  /* Bring the chat input into reach whatever the layout: unfold the desktop
   * rail or raise the mobile sheet, then focus the box. */
  function focusChat() {
    if (matchMedia('(max-width: 880px)').matches) {
      const panel = $('chatPanel');
      if (!panel.classList.contains('expanded')) $('sheetHandle').click();
    } else if (state.prefs4.ui.chatCollapsed) {
      setChatCollapsed(false);
    }
    $('chatText').focus();
  }

  /* ---------------- shell: viewport/plans splitter ----------------
   * --vp-split is the viewport's share of the stage height (%). Pointer drag,
   * arrow keys, PageUp/Down, Home/End, Enter-to-reset — all one code path. */
  const SPLIT_MIN = 24, SPLIT_MAX = 78, SPLIT_DEFAULT = 58;
  function setSplit(pct, opts) {
    pct = Math.round(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, pct)));
    state.prefs4.ui.split = pct;
    $('stage').style.setProperty('--vp-split', pct);
    // Belt and braces: the inline basis guarantees a layout pass even where
    // a var()-inside-calc() change fails to invalidate flex layout.
    $('viewportWrap').style.flexBasis = pct + '%';
    const sp = $('vpSplitter');
    sp.setAttribute('aria-valuenow', String(pct));
    sp.setAttribute('aria-valuetext', `3D viewport ${pct}% of the stage`);
    if (!opts || opts.persist !== false) {
      Store.savePrefs(state.prefs4);
      if (state.spec) syncHash();
    }
  }
  function bindSplitter() {
    const sp = $('vpSplitter'), stage = $('stage');
    let dragging = false;
    let moved = false;
    let lastTouchTapAt = 0;
    let dragStartY = 0;
    sp.addEventListener('pointerdown', e => {
      dragging = true;
      moved = false;
      dragStartY = e.clientY;
      sp.classList.add('dragging');
      sp.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    sp.addEventListener('pointermove', e => {
      if (!dragging) return;
      if (Math.abs(e.clientY - dragStartY) > 3) moved = true;
      const r = stage.getBoundingClientRect();
      if (r.height > 0) setSplit(((e.clientY - r.top) / r.height) * 100, { persist: false });
    });
    const endDrag = e => {
      const touchTap = e && e.pointerType === 'touch' && !moved;
      if (!dragging) return;
      dragging = false;
      sp.classList.remove('dragging');
      if (moved) state.userSplitTouched = true; // their split now (X-07)
      Store.savePrefs(state.prefs4);
      syncHash();
      if (touchTap) {
        const now = performance.now();
        if (now - lastTouchTapAt <= 300) {
          lastTouchTapAt = 0;
          state.userSplitTouched = true;
          setSplit(SPLIT_DEFAULT);
        } else {
          lastTouchTapAt = now;
        }
      }
    };
    sp.addEventListener('pointerup', endDrag);
    sp.addEventListener('pointercancel', endDrag);
    sp.addEventListener('dblclick', () => { state.userSplitTouched = true; setSplit(SPLIT_DEFAULT); });
    sp.addEventListener('keydown', e => {
      const cur = state.prefs4.ui.split;
      let next = null;
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = cur - 3;
      else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = cur + 3;
      else if (e.key === 'PageUp') next = cur - 10;
      else if (e.key === 'PageDown') next = cur + 10;
      else if (e.key === 'Home') next = SPLIT_MIN;
      else if (e.key === 'End') next = SPLIT_MAX;
      else if (e.key === 'Enter') next = SPLIT_DEFAULT;
      if (next !== null) { e.preventDefault(); state.userSplitTouched = true; setSplit(next); }
    });
  }

  /* ---------------- shell: modes ----------------
   * The journey IS the navigation: Design → Plan → Build. Each mode button
   * carries a state dot DERIVED from what the pipeline already knows —
   * nothing stored, nothing to get stale. Build stays the existing
   * full-screen surface layered over whichever mode it was entered from. */
  /* Plan mode on a phone must show real plan content (X-07): entering Plan
   * at ≤560px auto-shifts the splitter so the panel holds at least 40% of
   * the viewport height. A splitter the user touched this session always
   * wins — the shift never fights a live choice, and it is session-visual
   * only (persist:false), exactly like a hash-carried split. */
  function autoSplitForPlanPhone() {
    if (state.userSplitTouched || !matchMedia('(max-width: 560px)').matches) return;
    const stageH = $('stage').getBoundingClientRect().height;
    if (stageH <= 0) return;
    const want = Math.round(window.innerHeight * 0.4);
    const tabsH = $('tabBar').offsetHeight || 44;
    const maxPct = Math.floor(((stageH - tabsH - 9 - want) / stageH) * 100);
    const target = Math.max(SPLIT_MIN, Math.min(state.prefs4.ui.split, maxPct));
    if (target < state.prefs4.ui.split) setSplit(target, { persist: false });
  }
  function setMode(m, opts) {
    if (m === 'build') { enterBuildMode(); return; }
    state.mode = m === 'plan' ? 'plan' : 'design';
    document.body.dataset.mode = state.mode;
    if (state.mode === 'plan') autoSplitForPlanPhone();
    if (!(opts && opts.silent)) syncHash();
    renderReadiness();
    if (state.mode === 'plan') { renderTabs(); renderPanel(); }
  }
  function modeStates() {
    const sum = state.integrity.summary;
    const designed = !!state.project || state.history.snapshots.length > 1;
    const stockTrouble = state.stockPlan && state.stockPlan.errors.length > 0;
    const pct = progressPct();
    return {
      design: {
        state: designed ? 'done' : 'todo',
        aria: designed ? 'Design mode — the 3D model and chat' : 'Start here — describe a piece, or pick a starter'
      },
      plan: {
        state: sum.fails ? 'fail' : sum.advisories || stockTrouble ? 'attn' : state.cut.length ? 'done' : 'todo',
        aria: sum.fails ? `Plan mode — ${sum.fails} failing safety check${sum.fails > 1 ? 's' : ''}`
          : sum.verdict === 'anchor' ? 'Plan mode — safe only when anchored to the wall'
            : sum.advisories ? `Plan mode — checks pass with ${sum.advisories} advisory note${sum.advisories > 1 ? 's' : ''}`
              : `Plan mode — cut list, buying, assembly, safety`
      },
      build: {
        state: pct >= 100 ? 'done' : pct > 0 ? 'attn' : 'todo',
        aria: pct >= 100 ? 'Build complete' : pct > 0 ? `Build mode — ${pct}% built` : 'Build mode — the full-screen shop companion'
      }
    };
  }
  function renderReadiness() {
    if (!state.integrity) return;
    const states = modeStates();
    // Build is Pro-gated: the lock glyph + aria announce the paywall BEFORE
    // the tap (X-04) — activation still opens the pricing dialog.
    const buildLocked = !BB.Billing.entitled('advancedFeatures');
    const lockEl = $('buildModeLock');
    if (lockEl) lockEl.hidden = !buildLocked;
    for (const m of ['design', 'plan', 'build']) {
      const b = $(m === 'build' ? 'buildModeBtn' : 'mode-' + m);
      if (!b) continue;
      const s = states[m];
      b.dataset.state = s.state;
      const current = m === 'build' ? state.buildMode : (!state.buildMode && state.mode === m);
      if (current) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
      const aria = m === 'build' && buildLocked ? s.aria + ' — included with Pro' : s.aria;
      b.setAttribute('aria-label', aria);
      b.title = aria;
    }
  }

  /* ---------------- shell: first-run hero (never blocking) ---------------- */
  function showWelcome(hasProjects) {
    $('welcomeResumeName').textContent = hasProjects ? 'Open a saved design' : 'Open a saved design';
    $('welcomeResumeCaption').textContent = hasProjects
      ? 'Pick up where you left off — plans and build progress included.'
      : 'Paste a BB4: share code to pick up a design from anywhere.';
    $('welcomeOverlay').dataset.mode = hasProjects ? 'projects' : 'import';
    renderHeroStarters();
    $('welcomeOverlay').hidden = false;
  }
  function hideWelcome() {
    $('welcomeOverlay').hidden = true;
  }

  /* ---------------- shell: URL-restorable tabs ----------------
   * The active plan tab (and reference subtab) mirrors into location.hash via
   * replaceState — deep-linkable and reload-safe, with no history spam. */
  const REF_ENTRIES = [['wood', 'Wood species'], ['ergo', 'Ergonomics'], ['joinery', 'Joinery'], ['fast', 'Fasteners & finishes'], ['hardware', 'Hardware'], ['lumber', 'Buyable lumber']];
  const REF_TABS = REF_ENTRIES.map(x => x[0]);
  function syncHash() {
    const path = state.mode === 'design'
      ? 'design'
      : state.tab + (state.tab === 'reference' && state.refTab !== 'wood' ? '/' + state.refTab : '');
    const h = '#' + path + `;split=${state.prefs4.ui.split};chat=${state.prefs4.ui.chatCollapsed ? 1 : 0}`;
    if (location.hash !== h) {
      try { history.replaceState(null, '', h); } catch (e) { /* sandboxed frame: tabs still work, hash doesn't */ }
    }
  }
  function applyHash() {
    const raw = (location.hash || '').replace(/^#/, '');
    if (raw.startsWith('d=')) {
      // A share link: the design itself rides the hash. Import through the
      // exact same gate as a pasted code, then hand the hash back to the app.
      const res = importCodeText(decodeURIComponent(raw.slice(2)), 'share link');
      if (res.error) botSay('That share link didn\u2019t decode: ' + res.error, []);
      else state.importedFromLink = true;
      syncHash();
      return true;
    }
    const bits = raw.split(';');
    const parts = (bits.shift() || '').split('/');
    if (parts[0] === 'design') {
      setMode('design', { silent: true });
    } else if (parts[0] === 'bom') {
      // Materials merged into Buy — old links keep working
      state.mode = 'plan';
      document.body.dataset.mode = 'plan';
      state.tab = 'stock';
    } else if (TABS.includes(parts[0])) {
      state.mode = 'plan';
      document.body.dataset.mode = 'plan';
      state.tab = parts[0];
      if (parts[0] === 'reference' && REF_TABS.includes(parts[1])) state.refTab = parts[1];
    } else return false;
    bits.forEach(bit => {
      const eq = bit.indexOf('=');
      if (eq < 0) return;
      const key = bit.slice(0, eq);
      const value = bit.slice(eq + 1);
      if (key === 'split') {
        const pct = +value;
        if (isFinite(pct)) setSplit(pct, { persist: false });
      } else if (key === 'chat' && (value === '0' || value === '1')) {
        setChatCollapsed(value === '1', { persist: false });
      }
    });
    return true;
  }

  /* ---------------- tabs (Plan sub-navigation) ----------------
   * Reference is deliberately not a peer destination: its tab stays hidden
   * until a "Learn why" link or the More menu opens it. */
  const TABS = ['overview', 'cut', 'stock', 'assembly', 'integrity', 'reference'];
  function selectTab(t) {
    state.tab = t;
    if (state.mode !== 'plan') setMode('plan');
    renderTabs();
    renderPanel();
  }
  function renderTabs() {
    $('tab-reference').hidden = state.tab !== 'reference';
    for (const t of TABS) {
      $('tab-' + t).setAttribute('aria-selected', String(state.tab === t));
      $('tab-' + t).tabIndex = state.tab === t ? 0 : -1;
    }
    $('panel-main').setAttribute('aria-labelledby', 'tab-' + state.tab);
    const dot = $('integrityDot');
    const sum = state.integrity ? state.integrity.summary : null;
    dot.hidden = !sum || (!sum.fails && !sum.advisories);
    dot.classList.toggle('fail', !!(sum && sum.fails));
    // The dot alone is invisible to a screen reader: the tab's accessible
    // name carries the same state.
    const integTab = $('tab-integrity');
    if (sum && sum.fails) integTab.setAttribute('aria-label', `Integrity — ${sum.fails} failing check${sum.fails > 1 ? 's' : ''}`);
    else if (sum && sum.verdict === 'anchor') integTab.setAttribute('aria-label', 'Integrity — safe only when anchored to the wall');
    else if (sum && sum.advisories) integTab.setAttribute('aria-label', `Integrity — ${sum.advisories} advisory note${sum.advisories > 1 ? 's' : ''}`);
    else integTab.removeAttribute('aria-label');
    syncHash();
    renderReadiness();
  }
  function bindTabs() {
    const bar = $('tabBar');
    for (const t of TABS) {
      $('tab-' + t).addEventListener('click', () => selectTab(t));
    }
    bar.addEventListener('keydown', e => {
      // Hidden reference never enters the arrow-key cycle.
      const cycle = state.tab === 'reference' ? TABS : TABS.filter(t => t !== 'reference');
      const i = cycle.indexOf(state.tab);
      let next = null;
      if (e.key === 'ArrowRight') next = cycle[(i + 1) % cycle.length];
      if (e.key === 'ArrowLeft') next = cycle[(i + cycle.length - 1) % cycle.length];
      if (e.key === 'Home') next = cycle[0];
      if (e.key === 'End') next = cycle[cycle.length - 1];
      if (next) {
        e.preventDefault();
        selectTab(next);
        $('tab-' + next).focus();
      }
    });
    window.addEventListener('hashchange', () => {
      if (applyHash()) { renderTabs(); renderPanel(); }
    });
  }

  /* ---------------- exports ---------------- */
  function doExport(kind) {
    const premium = ['print', 'glb', 'rb', 'dae'];
    if (premium.includes(kind) && !BB.Billing.gate('premiumExports', 'Production print plans, 3D models, and SketchUp exports are included with Pro.')) return;
    const name = Exports.slug(state.spec.meta.name);
    if (kind === 'dae') {
      Exports.download(name + '.dae', Exports.toDAE(state.spec, state.model), 'model/vnd.collada+xml');
      botSay('Exported the mesh. In SketchUp: File > Import, choose COLLADA (*.dae), pick the file. Parts arrive named and true to size.', []);
    } else if (kind === 'rb') {
      Exports.download(name + '.rb', Exports.toRuby(state.spec, state.model), 'text/x-ruby');
      botSay('Exported the build script. Paste it into SketchUp’s Ruby Console (Window > Ruby Console) — the model rebuilds as components, one undo step.', []);
    } else if (kind === 'glb') {
      Exports.download(name + '.glb', BB.GLTF.toGLB(state.spec, state.model), 'model/gltf-binary');
      botSay('Exported the 3D model as .glb — the universal format. On Android, opening it offers "View in your space" (AR); on desktop, any glTF viewer or the three.js editor reads it; on iOS, convert with Reality Converter for AR Quick Look.', []);
    } else if (kind === 'json') {
      Exports.download(name + '.designspec.json', JSON.stringify(state.spec, null, 2), 'application/json');
    } else if (kind === 'csv') {
      Exports.download(name + '.cutlist.csv', Exports.toCSV(state.spec, state.cut, { origin: appOrigin() }), 'text/csv');
      botSay('Exported the cut list as CSV — display units and raw millimetres side by side, ready for a spreadsheet.', []);
    } else if (kind === 'svg') {
      Exports.download(name + '.drawing.svg', Exports.printSVG(BB.Drafting.sheetSVG(state.spec, state.model, fmt, { origin: appOrigin() })), 'image/svg+xml');
      botSay('Exported the drawing sheet — front, side, and plan elevations with dimensions, plus a title block. Opens in any browser or vector editor.', []);
    } else if (kind === 'share') {
      openShareSheet();
    } else if (kind === 'print') {
      const root = $('printRoot');
      root.innerHTML = Exports.printHTML(state.spec, state.model, state.cut, state.bomData, state.steps, state.stockPlan, { origin: appOrigin() });
      // Release the sheet's inline-SVG DOM (~26 KB) once the dialog closes,
      // rather than leaving it parked in the document until the next print.
      const cleanup = () => { root.textContent = ''; window.removeEventListener('afterprint', cleanup); };
      window.addEventListener('afterprint', cleanup);
      window.print();
    } else if (kind === 'help') {
      openScrim('helpScrim');
    }
  }

  /* ---------------- global render ---------------- */
  function renderAll() {
    renderTopbar();
    renderAdvisories(state.report);
    renderTabs();
    renderPanel();
    renderHistory();
    if (state.selected) openInspectorById(state.selected);
    if (state.buildMode) { $('bmName').textContent = state.spec.meta.name; renderBuildChecklists(); }
  }

  /* ---------------- boot ---------------- */
  /* One drafting-instrument icon set (BB.Icons) replaces the platform
   * Unicode glyphs in the chrome — consistent weight and metrics everywhere. */
  function applyIcons() {
    const icon = BB.Icons.svg;
    const set = (id, name, text, textFirst) => {
      const b = $(id);
      if (b) b.innerHTML = textFirst ? `<span>${text}</span>${icon(name)}` : icon(name) + (text ? `<span>${text}</span>` : '');
    };
    set('undoBtn', 'undo');
    set('redoBtn', 'redo');
    set('dualBtn', 'dual');
    set('inspClose', 'close', undefined);
    set('historyClose', 'close', undefined);
    set('jointClose', 'close', undefined);
    set('diagramClose', 'close', undefined);
    set('welcomeClose', 'close', undefined);
    set('frameBtn', 'fit', 'Fit');
    set('pbPrev', 'prev');
    set('pbNext', 'next');
    set('pbReplay', 'replay');
    set('bmPbPrev', 'prev', 'Prev');
    set('bmPbNext', 'next', 'Next', true);
    set('capBannerClose', 'close', undefined);
    if ($('buildModeLock')) $('buildModeLock').innerHTML = icon('lock', 12);
    $('moreBtn').innerHTML = `More ${icon('caret', 13)}`;
  }

  async function boot() {
    applyIcons();
    const canvas = $('view3d');
    state.engine = BB.Engine.create(canvas, {
      reducedMotion: reduceMq.matches,
      onPick(part, info) {
        if (!part) {
          if (state.engine.getIsolated()) { state.engine.isolate(null); state.engine.clearFocus(); }
          else closeInspector();
          return;
        }
        if (info.double) {
          const clearing = state.engine.getIsolated() === part.id;
          state.engine.isolate(clearing ? null : part.id);
          // Isolation also frames (design §4b): the camera glides to the part
          // and one stored pose brings it back when isolation ends.
          if (clearing) state.engine.clearFocus();
          else state.engine.focusPart(part.id);
          openInspector(part);
          return;
        }
        if (part.drawer !== undefined && part.drawer !== null) state.engine.toggleDrawer(part.drawer);
        openInspector(part);
      },
      onJointPick(joint) {
        // A glowing dot in step playback is a door: open the 3D close-up of
        // THAT joint on its real members, captioned with where it sits.
        if (!joint || !joint.type || !state.model) return;
        const partA = state.model.parts.find(p => p.id === joint.a);
        const partB = state.model.parts.find(p => p.id === joint.b);
        const s = state.steps[state.playbackIndex];
        openJointInspector(joint.type, partA, partB, {
          context: (s ? `Step ${state.playbackIndex + 1} — ${s.title}: ` : '') +
            `the dot you tapped sits ${jointWhere(joint.pos, state.model.bounds)}.`
        });
      }
    });
    reduceMq.addEventListener('change', () => state.engine.setReducedMotion(reduceMq.matches));
    mobileAdvisoryMq.addEventListener('change', () => {
      renderAdvisories(state.report);
      if (state.mode === 'plan') renderPanel(); // cut cards <-> table swap
    });
    // In auto theme, the 3D scene follows the OS the same way the CSS does.
    darkMq.addEventListener('change', () => {
      if ((state.prefs4.theme || 'auto') === 'auto') applyTheme('auto');
    });
    new ResizeObserver(() => state.engine.resize()).observe($('viewportWrap'));
    $('viewportWrap').addEventListener('animationend', e => {
      if (e.animationName === 'inkwash') $('viewportWrap').classList.remove('inkwash');
    });

    // Accounts + cloud persistence: probe /api/auth once, racing a short
    // timeout so first paint NEVER waits on the network. A late-resolving
    // probe upgrades the storage chain mid-session and re-renders the
    // account section — boot itself stays untouched.
    try {
      await Promise.race([
        Store.init({ timeoutMs: 4000 }).then(() => { renderAccount(); }),
        new Promise(r => setTimeout(r, 1200))
      ]);
    } catch (e) { /* device storage is the product */ }
    Store.onModeChange(() => renderAccount());
    await BB.Billing.handleReturn();
    renderAccount();

    // Persisted prices + prefs load BEFORE the first paint, so units,
    // precision, dual display, and the shell layout never flash from defaults.
    try {
      state.prices = await Store.loadPrices();
      state.prefs4 = await Store.loadPrefs();
    } catch (e) { /* defaults are the product */ }
    Units.set(state.prefs4.units);
    applyTheme(state.prefs4.theme);
    applyRender();
    document.body.dataset.mode = state.mode; // design until a hash says otherwise
    setChatCollapsed(state.prefs4.ui.chatCollapsed, { persist: false });
    setSplit(state.prefs4.ui.split, { persist: false });
    bindSplitter();
    // The AI badge earns its state from a zero-token probe, then from every
    // real send; connectivity flips re-probe.
    probeAI();
    window.addEventListener('online', probeAI);
    window.addEventListener('offline', probeAI);

    // Seed design straight through the pipeline, in the preferred system.
    const seed = Spec.defaultSpec('table');
    seed.meta.name = 'Seed Table';
    seed.meta.units = state.prefs4.units.system === 'metric' ? 'mm' : 'in';
    const r = runPipeline(seed);
    adopt(r);
    state.history = History.createHistory(r.spec, 'seed');
    state.engine.snapNow();
    applyHash(); // a deep-linked tab survives the reload
    if (state.mode === 'plan') autoSplitForPlanPhone(); // deep-linked Plan gets the phone floor too (X-07)
    renderAll();
    renderHints();
    renderGallery();
    setChatPeek();

    // Returning users land in the studio with their latest project. First
    // runs get a welcome card with the three ways in — floating over a live,
    // fully working bench: nothing blocks, everything behind it responds.
    let opened = !!state.importedFromLink, projectCount = 0;
    try {
      const idx = await Store.loadIndex();
      projectCount = idx.length;
      if (!opened && idx.length) opened = !!(await loadProjectIntoApp(idx[0].id));
    } catch (e) { /* storage unavailable: fresh session */ }
    if (!opened) {
      showWelcome(projectCount > 0);
      botSay('Welcome to the shop. Describe a piece (or drop in a photo), pick a starter, or bring in a saved design — the seed table behind the welcome card is live right now. Everything autosaves as you work.', []);
    }

    // Gallery thumbnails render off the critical path once boot settles.
    // The render loop's rAF keeps the page from ever reporting truly idle,
    // so the timeout is the realistic trigger.
    if (globalThis.requestIdleCallback) requestIdleCallback(() => galleryThumbsPass(), { timeout: 1200 });
    else setTimeout(() => galleryThumbsPass(), 1200);

    /* top bar */
    $('undoBtn').onclick = () => { const s = state.history.undo(); if (s) restoreTo(s); };
    $('redoBtn').onclick = () => { const s = state.history.redo(); if (s) restoreTo(s); };
    $('historyBtn').onclick = openHistoryDrawer;
    $('historyClose').onclick = closeHistoryDrawer;
    $('historyBackdrop').onclick = closeHistoryDrawer;
    $('compareBtn').onclick = openCompare;
    $('compareClose').onclick = showCompareOverlay;
    $('compareExit').onclick = clearCompare;
    /* Units: a two-state in|mm control. Switching re-renders every surface in
     * one pass (all text flows from BB.Units) and persists the choice so the
     * next fresh session starts the same way. */
    const setUnits = u => {
      state.prefs4.units.system = u === 'mm' ? 'metric' : 'imperial';
      Store.savePrefs(state.prefs4);
      if (state.spec.meta.units !== u) merge({ meta: { units: u } }, 'manual');
      else renderTopbar();
    };
    $('unitsIn').onclick = () => setUnits('in');
    $('unitsMm').onclick = () => setUnits('mm');
    $('dualBtn').onclick = () => {
      const dual = !Units.get().dual;
      Units.set({ dual });
      state.prefs4.units.dual = dual;
      Store.savePrefs(state.prefs4);
      // Same spec, new display prefs: rebuild derived text + every surface.
      adopt(runPipeline(state.spec));
      renderAll();
      state.engine.unitsChanged();
    };
    $('precisionSelect').onchange = () => {
      const precision = +$('precisionSelect').value;
      Units.set({ precision });
      state.prefs4.units.precision = precision;
      Store.savePrefs(state.prefs4);
      adopt(runPipeline(state.spec));
      renderAll();
      state.engine.unitsChanged();
    };
    const setTheme = t => {
      state.prefs4.theme = t;
      Store.savePrefs(state.prefs4);
      applyTheme(t);
    };
    $('themeAuto').onclick = () => setTheme('auto');
    $('themeLight').onclick = () => setTheme('light');
    $('themeDark').onclick = () => setTheme('dark');
    const setRender = textured => {
      state.prefs4.render = { textured };
      Store.savePrefs(state.prefs4);
      applyRender();
    };
    $('renderRich').onclick = () => setRender(true);
    $('renderFlat').onclick = () => setRender(false);
    $('designName').addEventListener('change', e => merge({ meta: { name: e.target.value } }, 'manual'));
    $('levelSelect').addEventListener('change', e => merge({ meta: { level: e.target.value } }, 'manual'));
    $('projectsBtn').onclick = openProjects;
    $('projectsClose').onclick = () => closeScrim('projectsScrim');
    renderAccount();
    $('galleryBtn').onclick = () => { renderGallery(); openScrim('galleryScrim'); };
    /* chat fold + hero paths */
    $('chatCollapse').onclick = () => setChatCollapsed(true);
    $('chatRail').onclick = () => { setChatCollapsed(false); $('chatText').focus(); };
    $('welcomeClose').onclick = hideWelcome;
    /* The hero prompt IS the chat pipeline — one path for every input. */
    const heroSubmit = () => {
      const t = $('heroText').value.trim();
      if (!t) { hideWelcome(); focusChat(); return; }
      hideWelcome();
      sendMessage(t);
    };
    $('heroSend').onclick = heroSubmit;
    $('heroText').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); heroSubmit(); }
    });
    $('welcomePhoto').onclick = () => $('photoInput').click();
    $('welcomeStarter').onclick = () => { renderGallery(); openScrim('galleryScrim'); };
    $('welcomeResume').onclick = () => {
      hideWelcome();
      if ($('welcomeOverlay').dataset.mode === 'projects') openProjects();
      else { openShareSheet(); $('importCode').focus(); }
    };
    $('shareBtn').onclick = openShareSheet;
    $('menuShareBtn').onclick = openShareSheet; // phone-width Share/Import entry (X-05)
    /* project-cap banner (A-04): passive, dismissible, share-code way out */
    $('capBannerShare').onclick = () => openShareSheet();
    $('capBannerUpgrade').onclick = () => BB.Billing.open();
    $('capBannerClose').onclick = () => { state.capBannerDismissed = true; $('capBanner').hidden = true; };
    $('copyShareLink').onclick = async () => {
      const ta = $('shareLinkText');
      ta.select();
      let done = false;
      try { await navigator.clipboard.writeText(ta.value); done = true; }
      catch (e) { try { done = document.execCommand('copy'); } catch (e2) { /* stays selected */ } }
      $('copyShareLink').textContent = done ? 'Copied' : 'Copy manually';
      setTimeout(() => { $('copyShareLink').textContent = 'Copy link'; }, 1600);
    };
    $('shareGlb').onclick = () => doExport('glb');
    $('sharePrint').onclick = () => doExport('print');
    $('shareClose').onclick = () => closeScrim('shareScrim');
    $('copyShare').onclick = copyShare;
    $('importShare').onclick = importShare;
    $('speciesClose').onclick = () => closeScrim('speciesScrim');
    if ($('diagramClose')) $('diagramClose').onclick = () => closeScrim('diagramScrim');
    $('diagClose').onclick = () => closeScrim('diagScrim');
    $('jointClose').onclick = () => { closeScrim('jointScrim'); BB.JointView.close(); };
    $('jointExplode').addEventListener('input', e => BB.JointView.setExplode(e.target.value / 100));
    $('jointCutaway').onclick = () => {
      const on = $('jointCutaway').getAttribute('aria-pressed') !== 'true';
      $('jointCutaway').setAttribute('aria-pressed', String(on));
      BB.JointView.setCutaway(on);
    };
    $('diagRerun').onclick = runDiagnostics;
    $('buildModeBtn').onclick = enterBuildMode;
    $('bmExit').onclick = exitBuildMode;
    $('bmTaskPrev').onclick = () => bmTaskGo(-1);
    $('bmTaskNext').onclick = () => bmTaskGo(1);
    /* swipe between tasks; vertical scrolling stays native */
    const swipe = { x: 0, y: 0, id: null };
    $('bmPager').addEventListener('pointerdown', e => { swipe.id = e.pointerId; swipe.x = e.clientX; swipe.y = e.clientY; });
    $('bmPager').addEventListener('pointerup', e => {
      if (e.pointerId !== swipe.id) return;
      const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
      if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.4) bmTaskGo(dx < 0 ? 1 : -1);
      swipe.id = null;
    });
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault(); // saved for the post-build nudge — never unprompted
      state.installPrompt = e;
    });
    $('bmInstallGo').onclick = async () => {
      const p = state.installPrompt;
      $('bmInstall').hidden = true;
      if (p) { try { p.prompt(); await p.userChoice; } catch (e) { /* declined */ } state.installPrompt = null; }
    };
    $('bmInstallDismiss').onclick = () => { $('bmInstall').hidden = true; };
    $('bmPbPrev').onclick = () => scrubPlayback(state.playbackIndex - 1);
    $('bmPbNext').onclick = () => scrubPlayback(state.playbackIndex + 1);
    $('bmPbBack').onclick = exitBmPlayback;
    bindLogoLongPress();

    /* export + More menus */
    const closeMenu = (btnId, m) => {
      m.classList.remove('open');
      m.inert = true;
      $(btnId).setAttribute('aria-expanded', 'false');
    };
    const bindMenu = (btnId, menuId) => {
      const b = $(btnId), m = $(menuId);
      b.onclick = () => {
        const open = m.classList.toggle('open');
        m.inert = !open;
        b.setAttribute('aria-expanded', String(open));
      };
      document.addEventListener('click', e => {
        if (!m.contains(e.target) && e.target !== b) closeMenu(btnId, m);
      });
      // Menu-button keyboard pattern: ArrowDown opens and enters the menu,
      // arrows cycle the items, Escape (global handler) closes topmost.
      // Width-hidden entries (e.g. the phone-only Share/Import item) must not
      // catch keyboard focus: only items with a rendered box participate.
      const items = () => [...m.querySelectorAll('[role="menuitem"]')].filter(x => x.getClientRects().length);
      b.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (!m.classList.contains('open')) b.click();
          const list = items();
          if (list.length) (e.key === 'ArrowDown' ? list[0] : list[list.length - 1]).focus();
        }
      });
      m.addEventListener('keydown', e => {
        const list = items();
        if (!list.length) return;
        const i = list.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); (list[i + 1] || list[0]).focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); (list[i - 1] || list[list.length - 1]).focus(); }
        else if (e.key === 'Home') { e.preventDefault(); list[0].focus(); }
        else if (e.key === 'End') { e.preventDefault(); list[list.length - 1].focus(); }
      });
      return m;
    };
    // One menu owns everything quiet: dialogs, export, reference, settings.
    // Share and Build stay out as the only strong actions (with the mode nav).
    const moreMenu = bindMenu('moreBtn', 'moreMenu');
    /* View popover: camera presets, explode, and help live one press away */
    const viewMenu = bindMenu('viewBtn', 'viewMenu');
    // Picking a dialog from More closes the menu; the units row stays open
    // so the seg gives instant feedback.
    moreMenu.querySelectorAll('[role="menuitem"]').forEach(b => {
      b.addEventListener('click', () => {
        closeMenu('moreBtn', moreMenu);
        if (b.dataset.export) { doExport(b.dataset.export); return; }
        if (!trapStack.length) $('moreBtn').focus(); // unless a dialog already took focus
      });
    });
    $('referenceBtn').onclick = () => selectTab('reference');
    /* mode navigation */
    $('mode-design').onclick = () => setMode('design');
    $('mode-plan').onclick = () => setMode('plan');
    $('skipToPlans').addEventListener('click', () => { if (state.mode !== 'plan') setMode('plan'); });
    /* "Learn why" links anywhere in the app open the reference on the right
     * shelf — the Shop Reference relocated from peer tab to contextual door. */
    document.addEventListener('click', e => {
      const link = e.target.closest('[data-reflink]');
      if (!link) return;
      state.refTab = link.dataset.reflink;
      if (link.dataset.refquery !== undefined) state.refQuery = link.dataset.refquery;
      selectTab('reference');
    });

    /* chat — no form element (artifact rules); Enter and the button both send */
    const sendNow = () => {
      if (state.busy) return; // Enter during a round-trip must not eat the draft
      const t = $('chatText');
      sendMessage(t.value);
      t.value = '';
      t.style.height = 'auto';
    };
    $('sendBtn').addEventListener('click', sendNow);
    $('chatText').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendNow();
      }
    });
    $('chatText').addEventListener('input', e => {
      e.target.style.height = 'auto';
      e.target.style.height = Math.min(120, e.target.scrollHeight) + 'px';
    });
    $('photoBtn').addEventListener('click', () => $('photoInput').click());
    $('photoInput').addEventListener('change', e => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (file) sendPhoto(file);
    });
    /* Sheet gesture physics (roadmap #5 / interaction design §3a): the handle
     * follows the finger and a release snaps by position + velocity. Tap
     * still toggles; the drag is gated to the handle so chat-log scrolling is
     * untouched; reduced motion keeps the tap-only behavior. */
    const sheet = { drag: null, suppressTap: false };
    const sheetSet = expanded => {
      $('chatPanel').classList.toggle('expanded', expanded);
      $('sheetHandle').setAttribute('aria-expanded', String(expanded));
      $('sheetHandle').setAttribute('aria-label', expanded ? 'Collapse chat' : 'Expand chat');
    };
    $('sheetHandle').onclick = () => {
      if (sheet.suppressTap) { sheet.suppressTap = false; return; }
      sheetSet(!$('chatPanel').classList.contains('expanded'));
    };
    $('sheetHandle').style.touchAction = 'none';
    $('sheetHandle').addEventListener('pointerdown', e => {
      if (reduceMq.matches) return;
      $('sheetHandle').setPointerCapture(e.pointerId);
      const panel = $('chatPanel');
      const m = new DOMMatrixReadOnly(getComputedStyle(panel).transform);
      const h = panel.getBoundingClientRect().height;
      // Collapsed travel: measured when starting collapsed; estimated from
      // the peek height when starting expanded (release logic uses halves,
      // so ±safe-area error is immaterial).
      const collapsedTy = panel.classList.contains('expanded') ? Math.max(60, h - 150) : m.m42;
      sheet.drag = { id: e.pointerId, y0: e.clientY, ty0: m.m42, collapsedTy, moved: 0, v: 0, last: e.clientY, lastT: performance.now() };
    });
    $('sheetHandle').addEventListener('pointermove', e => {
      const d = sheet.drag;
      if (!d || e.pointerId !== d.id) return;
      const dy = e.clientY - d.y0;
      d.moved = Math.max(d.moved, Math.abs(dy));
      const now = performance.now();
      d.v = d.v * 0.6 + ((e.clientY - d.last) / (Math.max(8, now - d.lastT) / 1000)) * 0.4; // px/s EMA
      d.last = e.clientY; d.lastT = now;
      const panel = $('chatPanel');
      panel.style.transition = 'none';
      panel.style.transform = `translateY(${Math.max(0, Math.min(d.collapsedTy, d.ty0 + dy))}px)`;
    });
    const sheetRelease = e => {
      const d = sheet.drag;
      if (!d || e.pointerId !== d.id) return;
      sheet.drag = null;
      const panel = $('chatPanel');
      if (d.moved < 6) { // a tap: restore and let the click handler toggle
        panel.style.transition = '';
        panel.style.transform = '';
        return;
      }
      sheet.suppressTap = true; // the drag already chose a state
      const ty = Math.max(0, Math.min(d.collapsedTy, d.ty0 + (d.last - d.y0)));
      const expand = Math.abs(d.v) > 240 ? d.v < 0 : ty < d.collapsedTy / 2;
      sheetSet(expand);
      panel.style.transition = '';
      panel.style.transform = ''; // transitions from the drag pose to the class pose
    };
    $('sheetHandle').addEventListener('pointerup', sheetRelease);
    $('sheetHandle').addEventListener('pointercancel', sheetRelease);

    /* stage controls */
    $('explodeRange').addEventListener('input', e => state.engine.setExplode(e.target.value / 100));
    $('dimsToggle').onclick = () => {
      const on = $('dimsToggle').getAttribute('aria-pressed') !== 'true';
      $('dimsToggle').setAttribute('aria-pressed', String(on));
      state.engine.setDims(on);
    };
    /* Blueprint mode: the interactive technical drawing — orthographic
     * projection, ink-line rendering, dimensions on. One toggle. */
    const setView = name => {
      state.engine.setProjection(name === 'iso' ? 'persp' : 'ortho');
      state.engine.setView(name);
      for (const [id, v] of [['viewFront', 'front'], ['viewSide', 'side'], ['viewTop', 'top'], ['viewIso', 'iso']]) {
        $(id).setAttribute('aria-pressed', String(v === name));
      }
    };
    $('viewFront').onclick = () => setView('front');
    $('viewSide').onclick = () => setView('side');
    $('viewTop').onclick = () => setView('top');
    $('viewIso').onclick = () => setView('iso');
    $('draftToggle').onclick = () => {
      const on = $('draftToggle').getAttribute('aria-pressed') !== 'true';
      $('draftToggle').setAttribute('aria-pressed', String(on));
      document.body.classList.toggle('drafting', on);
      // One-beat ink-wash on the canvas sells the flip to/from the drawing.
      // CSS-only; the global reduced-motion kill switch flattens it.
      const vw = $('viewportWrap');
      vw.classList.remove('inkwash');
      void vw.offsetWidth;
      vw.classList.add('inkwash');
      state.engine.setDrafting(on);
      if (on) {
        // Entering the drawing: front elevation with dimensions showing.
        if (!state.engine.inPlayback()) setView('front');
        $('dimsToggle').setAttribute('aria-pressed', 'true');
        state.engine.setDims(true);
      } else {
        setView('iso');
      }
    };
    $('frameBtn').onclick = () => state.engine.frame();
    $('inspClose').onclick = closeInspector;
    /* viewport help: a small non-modal card under the toolbar */
    const setVpHelp = open => {
      $('vpHelp').hidden = !open;
      $('vpHelpBtn').setAttribute('aria-expanded', String(open));
    };
    $('vpHelpBtn').onclick = () => setVpHelp($('vpHelp').hidden);
    document.addEventListener('click', e => {
      if (!$('vpHelp').hidden && !e.target.closest('.stage-controls')) setVpHelp(false);
    });

    /* playback bar */
    $('pbPrev').onclick = () => scrubPlayback(state.playbackIndex - 1);
    $('pbNext').onclick = () => scrubPlayback(state.playbackIndex + 1);
    $('pbReplay').onclick = () => state.engine.playbackReplay();
    $('pbExit').onclick = exitPlayback;

    /* modals */
    $('galleryClose').onclick = () => closeScrim('galleryScrim');
    $('helpClose').onclick = () => closeScrim('helpScrim');
    document.querySelectorAll('.scrim').forEach(s => {
      s.addEventListener('click', e => { if (e.target === s) closeScrim(s); });
    });

    /* keyboard */
    document.addEventListener('keydown', e => {
      const tag = document.activeElement && document.activeElement.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault(); $('undoBtn').click();
      } else if (((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z') || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y')) {
        if (!typing) { e.preventDefault(); $('redoBtn').click(); }
      } else if (!typing && e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        focusChat();
      } else if (!typing && state.buildMode && !state.bmPlayback && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        bmTaskGo(e.key === 'ArrowRight' ? 1 : -1);
      } else if (!typing && (e.key === '[' || e.key === ']') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        // Bracket keys walk the Plan sub-tabs (and pull you into Plan mode
        // first); the hidden reference tab stays out of the cycle.
        if (state.mode !== 'plan') { setMode('plan'); }
        else {
          const cycle = TABS.filter(t => t !== 'reference' || state.tab === 'reference');
          const i = cycle.indexOf(state.tab);
          const next = e.key === ']' ? cycle[(i + 1) % cycle.length] : cycle[(i - 1 + cycle.length) % cycle.length];
          selectTab(next);
        }
      } else if (e.key === 'Escape') {
        // Close the topmost overlay only — one layer per press. Build mode
        // is the bottom layer: it exits last, never before an open modal.
        const prov = $('provPop');
        if (prov && !prov.hidden) { hideProv(); return; }
        if (!$('vpHelp').hidden) { setVpHelp(false); $('vpHelpBtn').focus(); return; }
        if (viewMenu.classList.contains('open')) { closeMenu('viewBtn', viewMenu); return; }
        if (moreMenu.classList.contains('open')) { closeMenu('moreBtn', moreMenu); return; }
        const scrims = [...document.querySelectorAll('.scrim.open')];
        if (scrims.length) { closeScrim(scrims[scrims.length - 1]); return; }
        if ($('historyDrawer').classList.contains('open')) { closeHistoryDrawer(); return; }
        if (state.bmPlayback) { exitBmPlayback(); return; }
        if (state.playbackIndex >= 0) { exitPlayback(); return; }
        if (state.selected) { closeInspector(); return; }
        if (state.buildMode) exitBuildMode();
      }
    });

    bindTabs();

    // expose for smoke tests
    globalThis.__bb = {
      state, commit, merge, sendMessage, sendPhoto, runPipeline, enterPlayback, scrubPlayback, exitPlayback,
      doExport, recompute, enterBuildMode, exitBuildMode, enterBmPlayback, exitBmPlayback,
      openProjects, loadProjectIntoApp, openShare, importShare, openSpecies, runDiagnostics, doAutosave, progressPct,
      preview, commitPreview, closeInspector, openInspectorById, applyTheme, applyRender,
      setChatCollapsed, setSplit, selectTab, focusChat, showWelcome, hideWelcome, renderReadiness,
      setMode, probeAI, setAIState, renderAccount
    };

    // Viewport guidance speaks the input language it sees, and steps aside
    // the moment the user proves they don't need it (or after 8 s).
    const hint = $('viewportHint');
    if (matchMedia('(pointer: coarse)').matches) {
      hint.textContent = 'one finger to orbit · pinch to zoom · tap a part to tune it';
    }
    const dismissHint = () => {
      hint.style.opacity = '0';
      canvas.removeEventListener('pointerdown', dismissHint);
    };
    canvas.addEventListener('pointerdown', dismissHint);
    setTimeout(dismissHint, 8000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
