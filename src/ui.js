/* Blueprint Buddy — UI shell. All DOM wiring lives here; every design change
 * flows through commit() so AI edits, inspector edits, integrity fixes, and
 * history restores share one spec and one history stack.
 * Phase 4 surfaces: Integrity tab, Stock tab, My Projects, share codes,
 * build mode, photo-to-design, diagnostics panel, provenance popovers,
 * species comparison, debounced autosave. */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';
  const { Spec, Parametric, Plans, Exports, History, AI, K, Gallery, Codec, Store, Structural, Packing, Prov, Compare } = BB;
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
    tab: 'cut', refTab: 'wood', refQuery: '',
    dismissed: new Set(),
    selected: null,
    playbackIndex: -1,
    compare: null,
    busy: false,
    firstRun: true,
    previewing: false,
    // Phase 4
    turns: [],                      // AI conversation, wire format
    loadChoices: {},                // per-surface load presets
    prices: K.defaultPrices(),
    prefs4: { climate: 'temperate', stockMode: {} },
    project: null,                  // {id, progress:{cuts:{},steps:{}}}
    buildMode: false, bmPlayback: false,
    wakeLock: null,
    speciesPick: []
  };
  const reduceMq = matchMedia('(prefers-reduced-motion: reduce)');

  function fmt(mm) { return Spec.fmtLen(mm, state.spec ? state.spec.meta.units : 'mm'); }

  /* ---------------- pipeline ---------------- */
  function runPipeline(raw) {
    const spec = Spec.correctSpec(raw);
    const model = Parametric.build(spec);
    const report = Spec.validate(spec, model);
    return { spec, model, report };
  }
  const integrityOpts = () => ({ loadChoices: state.loadChoices, defaultLoad: 'auto', climate: state.prefs4.climate });

  function adopt(r) {
    state.spec = r.spec; state.model = r.model; state.report = r.report;
    state.integrity = Structural.computeIntegrity(r.spec, r.model, integrityOpts());
    state.cut = Plans.cutList(r.spec, r.model);
    state.stockPlan = Packing.planStock(r.spec, r.model, state.cut, { prices: state.prices, stockMode: state.prefs4.stockMode });
    state.bomData = Plans.bom(r.spec, r.model, { integrity: state.integrity, stock: state.stockPlan });
    state.steps = Plans.assembly(r.spec, r.model, state.integrity);
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
    const total = countChecklistItems();
    if (!total) return 0;
    const done = Object.values(state.project.progress.cuts).filter(Boolean).length +
      Object.values(state.project.progress.steps).filter(Boolean).length;
    return Math.min(100, Math.round(100 * done / total));
  }
  function countChecklistItems() {
    let n = state.steps.length;
    if (state.stockPlan) {
      for (const b of state.stockPlan.boards) n += b.cuts.length;
      for (const s of state.stockPlan.sheets) n += s.placements.length;
      if (state.stockPlan.mode === 'rough') n += state.cut.filter(r => r.stock !== 'sheet').length;
    }
    return n;
  }
  function scheduleAutosave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(doAutosave, 700);
  }
  async function doAutosave() {
    try {
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
      flashSave(Store.isPersistent());
    } catch (e) { flashSave(false); }
  }
  let saveFlashTimer = null;
  function flashSave(persistent) {
    const elS = $('saveState');
    elS.textContent = persistent ? 'saved' : 'session only';
    elS.classList.toggle('err', !persistent);
    elS.classList.add('on');
    clearTimeout(saveFlashTimer);
    saveFlashTimer = setTimeout(() => elS.classList.remove('on'), 1600);
  }

  /* ---------------- render: top bar ---------------- */
  function renderTopbar() {
    $('designName').value = state.spec.meta.name;
    $('unitsBtn').textContent = state.spec.meta.units;
    $('levelSelect').value = state.spec.meta.level;
    $('undoBtn').disabled = !state.history.canUndo();
    $('redoBtn').disabled = !state.history.canRedo();
  }

  /* ---------------- render: advisories ---------------- */
  function renderAdvisories(report) {
    const wrap = $('advisories');
    wrap.textContent = '';
    for (const e of report.errors) {
      const chip = el('div', 'advisory error');
      chip.append(el('span', '', '🛑 ' + esc(e.text)));
      wrap.append(chip);
    }
    for (const a of report.advisories) {
      if (state.dismissed.has(a.id)) continue;
      const chip = el('div', 'advisory');
      chip.append(el('span', '', esc(a.text)));
      const x = el('button', 'dismiss', '✕');
      x.setAttribute('aria-label', 'Dismiss advisory');
      x.onclick = () => { state.dismissed.add(a.id); chip.remove(); };
      chip.append(x);
      wrap.append(chip);
    }
  }

  /* ---------------- render: panels ---------------- */
  function renderPanel() {
    hideProv();
    const p = $('panel-main');
    p.textContent = '';
    const inner = el('div', 'panel-inner');
    p.append(inner);
    if (state.busy) {
      const stack = el('div', 'skeleton-stack');
      [28, 18, 18, 18, 18, 18].forEach(h => {
        const s = el('div', 'skeleton'); s.style.height = h + 'px';
        if (h === 28) s.style.width = '40%';
        stack.append(s);
      });
      inner.append(stack);
      return;
    }
    if (state.tab === 'cut') renderCut(inner);
    else if (state.tab === 'stock') renderStock(inner);
    else if (state.tab === 'bom') renderBom(inner);
    else if (state.tab === 'assembly') renderAssembly(inner);
    else if (state.tab === 'integrity') renderIntegrity(inner);
    else renderReference(inner);
  }

  /* ---------------- provenance popover (stretch: number provenance) ---------------- */
  function showProv(row, anchor) {
    const pop = $('provPop');
    const lines = Prov.forCutRow(state.spec, state.model, row);
    pop.innerHTML = `<h5>${esc(row.name)} — where these numbers come from</h5>` +
      lines.map(l => `<div class="prov-line"><b>${esc(l.dim)}</b><span>${esc(l.formula)}</span></div>`).join('');
    pop.hidden = false;
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left)) + 'px';
    pop.style.top = (r.bottom + 8 + pop.offsetHeight > window.innerHeight ? r.top - pop.offsetHeight - 8 : r.bottom + 8) + 'px';
  }
  function hideProv() { const pop = $('provPop'); if (pop) pop.hidden = true; }
  document.addEventListener('click', e => {
    if (!e.target.closest || (!e.target.closest('.prov-btn') && !e.target.closest('.prov-pop'))) hideProv();
  });

  function renderCut(root) {
    root.append(el('h3', '', 'Cut list'));
    root.append(el('p', 'lede', `Lengths include joinery allowances — tap any dimension to see the formula behind it. Stock: ${esc(K.WOOD_SPECIES[state.spec.wood.species].label)} + Baltic birch ply.`));
    if (!state.cut.length) {
      root.append(el('div', 'empty-state', '<span class="big">Nothing on the saw bench yet.</span>Describe a piece in the chat and the cut list writes itself.'));
      return;
    }
    const scroll = el('div', 'table-scroll');
    const dim = (r, v, i) => `<button type="button" class="prov-btn num" data-prov="${i}">${fmt(v)}</button>`;
    const rows = state.cut.map((r, i) => `<tr>
      <td>${esc(r.name)}</td><td class="num">${r.qty}</td>
      <td class="num">${dim(r, r.L, i)}</td><td class="num">${dim(r, r.W, i)}</td><td class="num">${dim(r, r.T, i)}</td>
      <td>${esc(K.WOOD_SPECIES[r.material] ? K.WOOD_SPECIES[r.material].label : r.material)}</td>
      <td style="color:var(--muted);font-size:12.5px">${esc(r.note || '')}</td></tr>`).join('');
    scroll.innerHTML = `<table class="data"><thead><tr><th>Part</th><th>Qty</th><th>Length</th><th>Width</th><th>Thick</th><th>Material</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table>`;
    scroll.querySelectorAll('.prov-btn').forEach(b => {
      b.addEventListener('click', e => { e.stopPropagation(); showProv(state.cut[+b.dataset.prov], b); });
    });
    root.append(scroll);
  }

  /* ---------------- Stock tab (Phase 4 item 3) ---------------- */
  function renderStock(root) {
    const plan = state.stockPlan;
    const species = state.spec.wood.species;
    root.append(el('h3', '', 'Stock — what to buy, and how to break it down'));
    root.append(el('p', 'lede', 'Deterministic packing of the cut list onto buyable lumber: 3 mm kerf per cut, 15 mm end trim per board end, grain honored on sheets. Offcuts are hatched.'));

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
    scroll.innerHTML = `<table class="data"><thead><tr><th>Buy</th><th>Qty</th><th>Unit</th><th>Cost</th></tr></thead><tbody>${shopRows || '<tr><td colspan="4" style="color:var(--muted)">Nothing to buy — no parts.</td></tr>'}</tbody></table>`;
    root.append(scroll);
    const waste = [];
    if (plan.wasteSolidPct != null) waste.push(`solid waste ${plan.wasteSolidPct}%`);
    if (plan.wasteSheetPct != null) waste.push(`sheet waste ${plan.wasteSheetPct}%`);
    const tot = el('div', 'bom-total');
    tot.innerHTML = `<span>Purchasable stock total${waste.length ? ` <span style="color:var(--muted);font-weight:400">· ${waste.join(' · ')}</span>` : ''}</span><strong>$${plan.totalCost.toFixed(2)}</strong>`;
    root.append(tot);
    if (plan.mode === 'dimensional' && plan.bdft.exact > 0) {
      root.append(el('p', 'stock-note', `Reference: rough-sawn equivalent ≈ ${plan.bdft.withWaste} bd ft (incl. 30% waste) ≈ $${plan.bdft.cost.toFixed(2)} at $${plan.bdft.rate.toFixed(2)}/bd ft.`));
    }
    for (const g of plan.glueups) root.append(el('p', 'stock-note', `“${esc(g.name)}” is wider than any board: edge-glue ${g.n} × ${esc(g.nominal)} strips, then trim to ${fmt(g.W)}.`));
    for (const l of plan.laminations) root.append(el('p', 'stock-note', `“${esc(l.name)}” is thicker than any board: face-laminate ${l.n} × ${esc(l.nominal)} layers, then plane to ${fmt(l.T)}.`));

    // board diagrams
    if (plan.boards.length) {
      root.append(el('h3', '', 'Cutting diagrams — boards'));
      plan.boards.forEach((b, i) => {
        if (!b.stockLen) return;
        const card = el('div', 'stock-board');
        card.innerHTML = `<div class="sb-title"><span>Board ${i + 1} — ${esc(K.WOOD_SPECIES[species].label)} ${esc(b.nominal)} (${b.actual.t} × ${b.actual.w} mm) × ${b.stockLen} mm</span><span class="offcut">offcut ${fmt(Math.max(0, b.offcut))}</span></div>` + Packing.boardSVG(b, fmt);
        root.append(card);
      });
    }
    if (plan.sheets.length) {
      root.append(el('h3', '', 'Cutting diagrams — sheets'));
      plan.sheets.forEach((s, i) => {
        const card = el('div', 'stock-board');
        card.innerHTML = `<div class="sb-title"><span>Sheet ${i + 1} — Baltic birch ${s.thickness} mm · buy a ${esc(s.fractionLabel)}</span><span class="offcut">layout ${Math.round(s.extent.x)} × ${Math.round(s.extent.y)} mm</span></div>` + Packing.sheetSVG(s, fmt);
        root.append(card);
      });
    }
    if (plan.mode === 'rough') {
      root.append(el('p', 'stock-note', 'Rough lumber mode: you surface and rip your own stock, so there are no board diagrams — the board-foot total above includes a 30% waste factor.'));
    }

    // editable, persisted price table
    const details = document.createElement('details');
    details.className = 'price-editor';
    details.innerHTML = `<summary>Price table (editable — saved to your device)</summary>`;
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
    for (const nom of Object.keys(K.LUMBER.NOMINALS)) {
      grid.append(priceInput(`${K.WOOD_SPECIES[species].label} ${nom} $/m`, state.prices.dimensional[species][nom],
        v => { state.prices.dimensional[species][nom] = v; }));
    }
    for (const t of K.LUMBER.SHEET.THICKNESSES) {
      grid.append(priceInput(`Sheet ${t} mm $/full`, state.prices.sheet[t], v => { state.prices.sheet[t] = v; }));
    }
    grid.append(priceInput(`${K.WOOD_SPECIES[species].label} $/bd ft`, state.prices.bdft[species], v => { state.prices.bdft[species] = v; }));
    details.append(grid);
    root.append(details);
  }

  function renderBom(root) {
    root.append(el('h3', '', 'Bill of materials'));
    root.append(el('p', 'lede', 'Priced as actual purchasable units from the stock optimizer; board-foot math retained as a reference line.'));
    const compareBtn = el('button', 'btn small', 'Compare species side by side');
    compareBtn.onclick = openSpecies;
    root.append(compareBtn);
    root.append(el('div', '', '&nbsp;'));
    const scroll = el('div', 'table-scroll');
    const rows = state.bomData.items.map(i => `<tr>
      <td><span class="kind-tag">${esc(i.kind)}</span></td>
      <td>${esc(i.label)}</td><td class="num">${i.qty}</td>
      <td style="color:var(--muted);font-size:12.5px">${esc(i.detail || '')}</td>
      <td class="num">${i.price ? '$' + (Math.round(i.price * 100) / 100).toFixed(2) : '—'}</td></tr>`).join('');
    scroll.innerHTML = `<table class="data"><thead><tr><th></th><th>Item</th><th>Qty</th><th>Detail</th><th>Cost</th></tr></thead><tbody>${rows}</tbody></table>`;
    root.append(scroll);
    const tot = el('div', 'bom-total');
    tot.innerHTML = `<span>Estimated materials cost</span><strong>$${state.bomData.total.toFixed(2)}</strong>`;
    root.append(tot);
  }

  function whyJointHTML(type) {
    const j = K.JOINERY[type];
    if (!j) return '';
    return `<span class="why-joint"><button type="button" aria-expanded="false">Why this joint?</button>
      <span class="why-tip" role="tooltip"><strong>${esc(j.label)}</strong>
      <span class="stat">strength ${'●'.repeat(j.strength)}${'○'.repeat(5 - j.strength)}</span>
      <span class="stat">${esc(j.level)}</span><br>
      ${esc(j.bestFor)}<br><em>Watch for:</em> ${esc(j.failure)}<br>
      <em>Tools:</em> ${esc(j.tools.join(', '))}</span></span>`;
  }

  function renderAssembly(root) {
    root.append(el('h3', '', 'Assembly'));
    root.append(el('p', 'lede', 'Press play on a step to watch its parts fly into place — the joint locations glow.'));
    const list = el('ol', 'step-list');
    state.steps.forEach((s, i) => {
      const item = el('li', 'step-item' + (i === state.playbackIndex ? ' active' : ''));
      item.dataset.step = i;
      const num = el('div', 'step-num');
      const body = el('div', 'step-body');
      const jointType = s.joints && s.joints.length ? s.joints[0].type : null;
      body.innerHTML = `<h4>${esc(s.title)}</h4><p>${esc(s.text)}</p>` +
        (jointType ? `<div>${whyJointHTML(jointType)}</div>` : '');
      const play = el('button', 'btn icon step-play', '▶');
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

  /* ---------------- Integrity tab (structural engine + Phase 4 movement) ---------------- */
  function renderIntegrity(root) {
    const integ = state.integrity;
    const overall = integ.summary.fails ? 'fail' : integ.summary.advisories ? 'advisory' : 'pass';
    root.append(el('h3', '', 'Structural integrity'));
    const summary = el('div', 'integrity-summary');
    summary.innerHTML = `<span class="stamp ${overall}">${overall}</span>
      <span style="font-size:13px;color:var(--muted)">${integ.checks.length} checks · ${integ.summary.fails} fail · ${integ.summary.advisories} advisory</span>`;
    root.append(summary);

    // climate preference drives ΔMC in the movement math
    const climate = el('div', 'climate-row');
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', 'Indoor climate for seasonal movement');
    sel.innerHTML = `<option value="arid">Arid climate — ΔMC 2%</option><option value="temperate">Temperate indoor — ΔMC 4%</option><option value="humid">Humid climate — ΔMC 6%</option>`;
    sel.value = state.prefs4.climate;
    sel.onchange = () => { state.prefs4.climate = sel.value; Store.savePrefs(state.prefs4); recompute(); };
    climate.append(el('span', '', 'Seasonal movement assumes'), sel);
    root.append(climate);

    if (integ.surfaces.length) {
      root.append(el('h3', '', 'Load presets (per surface)'));
      for (const s of integ.surfaces) {
        const row = el('div', 'load-row');
        const label = el('span', '', `${esc(s.label)}<span class="span-note">${Math.round(s.span)} mm ${s.model === 'cant' ? 'cantilever' : 'span'}</span>`);
        const ls = document.createElement('select');
        ls.setAttribute('aria-label', `Load preset for ${s.label}`);
        for (const k of Structural.PRESET_KEYS) {
          const o = document.createElement('option');
          o.value = k;
          o.textContent = `${Structural.LOAD_PRESETS[k].label} — ${Structural.LOAD_PRESETS[k].detail}`;
          o.selected = k === s.presetKey;
          ls.append(o);
        }
        ls.onchange = () => { state.loadChoices[s.id] = ls.value; recompute(); };
        row.append(label, ls);
        root.append(row);
      }
      root.append(el('div', '', '&nbsp;'));
    }

    for (const c of integ.checks) {
      const card = el('div', 'check-card' + (c.status === 'fail' ? ' fail' : ''));
      card.innerHTML = `<div class="check-head"><h4>${esc(c.title)}</h4><span class="stamp ${c.status}">${c.status}</span></div>
        <div class="check-value">${esc(c.value)}</div>
        <div class="check-threshold">threshold: ${esc(c.threshold)}</div>
        <p class="check-explain">${esc(c.explain)}</p>` +
        (c.factors ? `<div class="check-factors">${c.factors.map(f => `<div><span>${esc(f.label)}</span><span>${f.mult ? '× ' + f.mult : '+' + f.pts}</span></div>`).join('')}</div>` : '');
      if (c.fixes && c.fixes.length) {
        const row = el('div', 'fix-row');
        for (const f of c.fixes) {
          const b = el('button', 'btn small primary', esc(f.label));
          b.onclick = () => {
            const before = state.integrity;
            if (merge(f.patch, 'fix', [f.label])) {
              const chips = Structural.integrityDiff(before, state.integrity);
              botSay(`Applied fix: ${f.label}.`, chips, { noChange: !chips.length });
              state.tab = 'integrity'; renderTabs(); renderPanel();
            }
          };
          row.append(b);
        }
        card.append(row);
      }
      root.append(card);
    }
    root.append(el('p', 'integrity-disclaimer', 'Estimates for hobby woodworking based on Wood Handbook material properties. Not certified structural engineering.'));
  }

  /* ---------------- shop reference ---------------- */
  function renderReference(root) {
    root.append(el('h3', '', 'Shop reference'));
    const search = el('input', 'ref-search');
    search.type = 'search';
    search.placeholder = 'Search species, joints, screws, finishes…';
    search.value = state.refQuery;
    search.setAttribute('aria-label', 'Search reference tables');
    search.oninput = () => { state.refQuery = search.value; renderRefBody(body); };
    root.append(search);

    const tabs = el('div', 'ref-tabs');
    tabs.setAttribute('role', 'tablist');
    for (const [key, label] of [['wood', 'Wood species'], ['ergo', 'Ergonomics'], ['joinery', 'Joinery'], ['fast', 'Fasteners & finishes'], ['lumber', 'Buyable lumber']]) {
      const b = el('button', 'ref-tab', esc(label));
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', state.refTab === key);
      b.onclick = () => { state.refTab = key; renderPanel(); };
      tabs.append(b);
    }
    root.append(tabs);
    const body = el('div');
    root.append(body);
    renderRefBody(body);
  }

  function renderRefBody(body) {
    body.textContent = '';
    const q = state.refQuery.trim().toLowerCase();
    const hit = (...xs) => !q || xs.join(' ').toLowerCase().includes(q);
    const scroll = el('div', 'table-scroll');
    let rows = '', head = '';
    if (state.refTab === 'wood') {
      head = '<th>Species</th><th>Janka</th><th>MOE GPa</th><th>MOR MPa</th><th>SG</th><th>Move ct/1%MC</th><th>Cost</th><th>Character</th>';
      rows = Object.values(K.WOOD_SPECIES).filter(s => hit(s.label, s.blurb, s.movement)).map(s => `<tr>
        <td><strong>${esc(s.label)}</strong></td><td class="num">${s.janka} lbf</td>
        <td class="num">${s.moe.toFixed(1)}</td><td class="num">${s.mor}</td><td class="num">${s.sg.toFixed(2)}</td>
        <td class="num movement-${s.movement}">${s.ct.toFixed(5)}</td>
        <td class="num">${'$'.repeat(s.costTier)}</td>
        <td style="font-size:12.5px;color:var(--muted)">${esc(s.blurb)}</td></tr>`).join('');
    } else if (state.refTab === 'ergo') {
      head = '<th>Measure</th><th>Range</th><th>Applies to</th><th>Note</th>';
      rows = K.ERGONOMICS.filter(r => hit(r.label, r.note)).map(r => `<tr>
        <td><strong>${esc(r.label)}</strong></td>
        <td class="num">${isFinite(r.max) ? `${fmt(r.min)} – ${fmt(r.max)}` : `≥ ${fmt(r.min)}`}</td>
        <td>${esc(r.appliesTo.join(', '))}</td>
        <td style="font-size:12.5px;color:var(--muted)">${esc(r.note)}</td></tr>`).join('');
    } else if (state.refTab === 'joinery') {
      head = '<th>Joint</th><th>Strength</th><th>Difficulty</th><th>Level</th><th>Best for</th><th>Failure to avoid</th><th>Tools</th>';
      rows = Object.values(K.JOINERY).filter(j => hit(j.label, j.bestFor, j.failure, j.tools.join(' '))).map(j => `<tr>
        <td><strong>${esc(j.label)}</strong></td>
        <td><span class="dots">${'●'.repeat(j.strength)}${'○'.repeat(5 - j.strength)}</span></td>
        <td><span class="dots">${'●'.repeat(j.difficulty)}${'○'.repeat(5 - j.difficulty)}</span></td>
        <td>${esc(j.level)}</td>
        <td style="font-size:12.5px">${esc(j.bestFor)}</td>
        <td style="font-size:12.5px;color:var(--muted)">${esc(j.failure)}</td>
        <td style="font-size:12.5px;color:var(--muted)">${esc(j.tools.join(', '))}</td></tr>`).join('');
    } else if (state.refTab === 'lumber') {
      head = '<th>Nominal</th><th>Actual (T × W)</th><th>Stock lengths</th>';
      rows = Object.entries(K.LUMBER.NOMINALS).filter(([n]) => hit(n)).map(([n, a]) => `<tr>
        <td><strong>${esc(n)}</strong></td><td class="num">${a.t} × ${a.w} mm</td>
        <td class="num">${K.LUMBER.STOCK_LENGTHS.join(' / ')} mm</td></tr>`).join('');
      rows += `<tr><td><strong>Sheet goods</strong></td><td class="num">1220 × 2440 mm · ${K.LUMBER.SHEET.THICKNESSES.join('/')} mm</td><td>sold whole, half, or quarter</td></tr>`;
    } else {
      head = '<th>Item</th><th>Pilot / spec</th><th>Use</th>';
      const f = K.FASTENERS;
      rows = [...f.screws, ...f.dowels, ...f.hardware].filter(x => hit(x.label, x.use)).map(x => `<tr>
        <td><strong>${esc(x.label)}</strong></td>
        <td class="num">${x.pilot ? x.pilot + ' mm pilot' : (x.price ? '~$' + x.price : '—')}</td>
        <td style="font-size:12.5px;color:var(--muted)">${esc(x.use)}</td></tr>`).join('');
      rows += K.FINISHES.filter(x => hit(x.label, x.blurb)).map(x => `<tr>
        <td><strong>${esc(x.label)}</strong></td>
        <td class="num">${x.coats} coats · ${x.recoatHrs} h recoat · ${x.cureDays} d cure</td>
        <td style="font-size:12.5px;color:var(--muted)">${esc(x.blurb)}</td></tr>`).join('');
    }
    if (!rows) {
      body.append(el('div', 'empty-state', `<span class="big">No matches in the reference.</span>Try a different word — “dovetail”, “walnut”, “pilot”…`));
      return;
    }
    scroll.innerHTML = `<table class="data"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
    body.append(scroll);
  }

  /* ---------------- chat ---------------- */
  function chatMsg(kind, html) {
    const log = $('chatLog');
    const m = el('div', 'msg ' + kind);
    m.innerHTML = html;
    log.append(m);
    log.scrollTop = log.scrollHeight;
    return m;
  }
  function botSay(text, chips, opts) {
    opts = opts || {};
    let html = `<div class="bubble">${esc(text)}</div>`;
    const chipHTML = [];
    if (opts.caveat) chipHTML.push(`<span class="chip caveat">${esc(opts.caveat)}</span>`);
    for (const c of chips || []) chipHTML.push(`<span class="chip">${esc(c)}</span>`);
    if (!chips || !chips.length) {
      if (opts.noChange && !opts.caveat) chipHTML.push(`<span class="chip neutral">no dimensional change</span>`);
    }
    if (chipHTML.length) html += `<div class="chips">${chipHTML.join('')}</div>`;
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
    if (res.error) { botSay(res.error, []); return null; }
    if (res.reply.kind === 'question') {
      state.turns = res.turns.slice(-24);
      askQuestion(res.reply);
      return null;
    }
    let applied = AI.apply(res.reply, state.spec);
    let turns = res.turns;
    let r = runPipeline(applied.spec);

    // One validation retry with the specific errors (truncation never lands
    // here — the continuation protocol already stitched partials together).
    if (r.report.errors.length && !res.local) {
      setStatus('Refining to clear validation errors');
      const errText = 'Your proposal failed validation: ' + r.report.errors.map(e => e.text).join(' ') + ' Return a corrected reply, minified wire JSON only.';
      const res2 = await AI.respond(errText, applied.spec, { turns, digest, onStatus: setStatus });
      if (res2.reply && res2.reply.kind !== 'question') {
        applied = AI.apply(res2.reply, applied.spec);
        turns = res2.turns;
        r = runPipeline(applied.spec);
      }
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
    return { final, failReport, explain };
  }

  async function sendMessage(text, image) {
    text = (text || '').trim();
    if ((!text && !image) || state.busy) return;
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
    state.busy = true;
    renderPanel();
    try {
      const promptText = image ? AI.VISION_PROMPT : text;
      const before = state.spec;
      const out = await aiPipeline(promptText, image, setStatus);
      typing.remove();
      state.busy = false;
      if (!out) { renderPanel(); return; }
      const okc = commit(out.final, 'ai');
      if (!okc) {
        botSay('That change would leave the design unbuildable — I’ve left it as it was. Try a gentler dimension.', []);
        renderPanel();
        return;
      }
      const realDiffs = Spec.diffSpecs(before, state.spec);
      const chips = Spec.describeDiff(realDiffs, state.spec.meta.units);
      const caveat = image ? 'Proportions estimated from photo. Verify dimensions.' : null;
      if (out.failReport) {
        botSay(`Honest report: after 3 structural refinement rounds this is my best attempt, but it still fails ${out.failReport.length} check${out.failReport.length > 1 ? 's' : ''}: ${out.failReport.slice(0, 3).map(c => c.title).join('; ')}. The Integrity tab has every number — tap a fix or ask me to change the approach.`, chips, { caveat });
        state.tab = 'integrity'; renderTabs(); renderPanel();
      } else {
        const summary = state.integrity.summary;
        const integLine = image ? ` Integrity: ${summary.fails ? summary.fails + ' fail(s)' : summary.advisories ? summary.advisories + ' advisory(ies)' : 'all checks pass'} — full report in the Integrity tab.` : '';
        botSay((out.explain || 'Updated.') + integLine, chips, { noChange: !chips.length, caveat });
      }
    } catch (err) {
      typing.remove();
      state.busy = false;
      renderPanel();
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
  function paramSlider(label, value, min, max, step, unitAware, onInput, onCommit) {
    const wrap = el('div', 'param');
    const lab = el('div', 'param-label');
    const out = el('output', '', unitAware ? fmt(value) : String(value));
    lab.append(el('span', '', esc(label)), out);
    const range = document.createElement('input');
    range.type = 'range'; range.min = min; range.max = max; range.step = step; range.value = value;
    range.setAttribute('aria-label', label);
    range.addEventListener('input', () => {
      out.textContent = unitAware ? fmt(+range.value) : range.value;
      onInput(+range.value);
    });
    range.addEventListener('change', () => onCommit(+range.value));
    range.addEventListener('keyup', e => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) onCommit(+range.value); });
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
    $('inspName').textContent = part.name;
    const dims = $('inspDims');
    dims.innerHTML = `<button type="button" class="prov-btn num">${fmt(part.size.w)} × ${fmt(part.size.h)} × ${fmt(part.size.d)}</button>`;
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
      body.append(el('p', '', '<span style="font-size:12.5px;color:var(--muted)">Novel composition: refine dimensions through the chat — code re-validates the whole structure on every change.</span>'));
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
      if (s.meta.level !== 'beginner') runnerOpts.push(['wood_runners', 'Wood runners']);
      body.append(paramSeg('Runners', runnerOpts, s.drawers.runner,
        v => { merge({ drawers: { runner: v } }, 'manual'); openInspectorById(part.id); }));
    }
    body.append(paramSelect('Species', Object.values(K.WOOD_SPECIES).filter(x => !x.sheet).map(x => [x.key, x.label]),
      s.wood.species, v => { merge({ wood: { species: v } }, 'manual'); openInspectorById(part.id); }));
    body.append(paramSelect('Finish', K.FINISHES.map(f => [f.key, f.label]), s.finish,
      v => { merge({ finish: v }, 'manual'); openInspectorById(part.id); }));
  }
  function openInspectorById(id) {
    const part = state.model.parts.find(p => p.id === id);
    if (part) openInspector(part);
    else closeInspector();
  }
  function closeInspector() {
    state.selected = null;
    state.engine.select(null);
    $('inspector').classList.remove('open');
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
      <td class="old num">${esc(Spec.fmtValue(d.path, d.from, cmp.b.spec.meta.units))}</td>
      <td class="new num">${esc(Spec.fmtValue(d.path, d.to, cmp.b.spec.meta.units))}</td></tr>`).join('') ||
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
    d.setAttribute('aria-hidden', 'false');
  }
  function closeHistoryDrawer() {
    const d = $('historyDrawer');
    d.classList.remove('open');
    d.setAttribute('aria-hidden', 'true');
  }

  /* ---------------- modals ---------------- */
  function openScrim(id) { $(id).classList.add('open'); }
  function closeScrim(id) { $(id).classList.remove('open'); }

  function renderGallery() {
    const grid = $('galleryGrid');
    grid.textContent = '';
    for (const g of Gallery.STARTERS) {
      const r = runPipeline(g.spec);
      const card = el('button', 'gallery-card');
      card.innerHTML = `<span class="g-emoji">${g.emoji}</span>
        <span class="g-name">${esc(r.spec.meta.name)}</span>
        <span class="g-caption">${esc(g.caption)}</span>
        <span class="g-meta">${fmt(r.spec.overall.width)} × ${fmt(r.spec.overall.depth)} × ${fmt(r.spec.overall.height)} · ${esc(K.WOOD_SPECIES[r.spec.wood.species].label)}</span>`;
      card.onclick = () => {
        closeScrim('galleryScrim');
        state.dismissed.clear();
        state.project = null;   // a starter begins a fresh project
        state.turns = [];
        commit(g.spec, 'gallery', ['loaded “' + r.spec.meta.name + '”']);
        state.engine.frame();
        botSay(`Loaded ${r.spec.meta.name} — ${r.model.parts.length} parts, plans ready. Tell me what to change.`, []);
      };
      grid.append(card);
    }
  }

  /* ---------------- My Projects (Phase 4 item 2) ---------------- */
  async function openProjects() {
    const grid = $('projectsGrid');
    grid.innerHTML = '<p class="sub">Loading…</p>';
    openScrim('projectsScrim');
    const idx = await Store.loadIndex();
    $('storageNote').textContent = Store.isPersistent() ? '' : 'Storage is unavailable — projects live for this session only.';
    grid.textContent = '';
    if (!idx.length) {
      grid.innerHTML = '<p class="sub">No projects yet — designs save here automatically as you work.</p>';
      return;
    }
    for (const row of idx) {
      const card = el('div', 'project-card' + (state.project && state.project.id === row.id ? ' current' : ''));
      const thumb = row.thumb
        ? `<img class="p-thumb" src="${row.thumb}" alt="">`
        : `<div class="p-thumb empty" aria-hidden="true">▦</div>`;
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
      dupB.onclick = async () => { await Store.duplicateProject(row.id); openProjects(); };
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
    if (!rec) return;
    const spec = Spec.correctSpec(Codec.decode(rec.wire));
    exitBuildMode();
    exitPlayback();
    clearCompare();
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
    const r = runPipeline(state.history.currentSpec() || spec);
    adopt(r);
    renderAll();
    state.engine.frame();
    closeScrim('projectsScrim');
    closeScrim('galleryScrim');
    botSay(`Opened “${rec.name}” — plans, history, and build progress restored. Tell me what to change.`, []);
  }

  /* ---------------- share codes (Phase 4 item 2) ---------------- */
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
  function importShare() {
    const res = Codec.fromShareCode($('importCode').value);
    if (res.error) { $('importMsg').textContent = res.error; return; }
    state.project = null; // imported design becomes a fresh project
    state.turns = [];
    state.dismissed.clear();
    const ok = commit(res.spec, 'import', ['imported from share code']);
    if (!ok) { $('importMsg').textContent = 'That design decoded but won’t build.'; return; }
    state.engine.frame();
    closeScrim('shareScrim');
    botSay(`Imported “${state.spec.meta.name}” from a share code — migrated to spec v${state.spec.specVersion} and revalidated.`, []);
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
      `<th><button type="button" class="species-col-btn" data-sp="${c.key}" title="Use ${esc(c.label)}">${esc(c.label)} →</button></th>`).join('')}</tr></thead><tbody>
      <tr><td>Purchasable cost</td>${cols.map(c => cell('$' + c.cost.toFixed(2), c.cost === bestCost)).join('')}</tr>
      <tr><td>Weight</td>${cols.map(c => cell(c.weightKg, c.weightKg === bestWeight, ' kg')).join('')}</tr>
      <tr><td>Sag margin (critical span)</td>${cols.map(c => cell(c.sagMargin == null ? '—' : c.sagMargin + '×', c.sagMargin === maxSag && maxSag > 0, c.worstSagMM != null ? ` <span style="color:var(--muted)">(${c.worstSagMM} mm/${c.span} mm)</span>` : '')).join('')}</tr>
      <tr><td>Seasonal movement (worst panel)</td>${cols.map(c => cell(c.movementMM, c.movementMM === bestMove, ' mm')).join('')}</tr>
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
    let timer = null;
    const start = e => {
      timer = setTimeout(() => { openScrim('diagScrim'); runDiagnostics(); }, 650);
    };
    const cancel = () => { clearTimeout(timer); timer = null; };
    logo.addEventListener('pointerdown', start);
    logo.addEventListener('pointerup', cancel);
    logo.addEventListener('pointerleave', cancel);
    logo.addEventListener('pointercancel', cancel);
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

  function cutKey(kind, bi, ci, name, len) { return `${kind}:${bi}:${ci}:${name}:${len}`; }

  function enterBuildMode() {
    if (!state.project) { state.project = { id: Store.newId(), progress: { cuts: {}, steps: {} } }; scheduleAutosave(); }
    state.buildMode = true;
    $('buildMode').hidden = false;
    $('bmName').textContent = state.spec.meta.name;
    renderBuildChecklists();
    requestWakeLock();
  }
  function exitBuildMode() {
    if (!state.buildMode) return;
    state.buildMode = false;
    exitBmPlayback();
    $('buildMode').hidden = true;
    releaseWakeLock();
    scheduleAutosave();
  }

  function toggleProgress(map, key, btn) {
    map[key] = !map[key];
    btn.setAttribute('aria-pressed', String(!!map[key]));
    btn.querySelector('.box').textContent = map[key] ? '✓' : '';
    $('bmProgress').textContent = progressPct() + '% built';
    scheduleAutosave();
  }

  function checkButton(label, dims, checked, onToggle) {
    const b = el('button', 'bm-check');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(!!checked));
    b.innerHTML = `<span class="box" aria-hidden="true">${checked ? '✓' : ''}</span>
      <span class="bm-check-label">${esc(label)}</span>
      ${dims ? `<span class="bm-check-dims">${esc(dims)}</span>` : ''}`;
    b.onclick = () => onToggle(b);
    return b;
  }

  function renderBuildChecklists() {
    const cuts = $('bmCuts');
    const stepsEl = $('bmSteps');
    cuts.textContent = '';
    stepsEl.textContent = '';
    const prog = state.project.progress;
    const plan = state.stockPlan;

    // Cuts grouped by stock board, straight from the optimizer diagrams —
    // the user works board by board.
    plan.boards.forEach((b, bi) => {
      if (!b.stockLen) return;
      const group = el('div', 'bm-board');
      group.append(el('div', 'bm-board-title', `Board ${bi + 1} — ${esc(b.nominal)} × ${b.stockLen} mm`));
      b.cuts.forEach((c, ci) => {
        const key = cutKey('b', bi, ci, c.name, c.len);
        group.append(checkButton(c.name, fmt(c.len), prog.cuts[key], btn => toggleProgress(prog.cuts, key, btn)));
      });
      cuts.append(group);
    });
    plan.sheets.forEach((s, si) => {
      const group = el('div', 'bm-board');
      group.append(el('div', 'bm-board-title', `Sheet ${si + 1} — ${s.thickness} mm (${esc(s.fractionLabel)})`));
      s.placements.forEach((p, pi) => {
        const key = cutKey('s', si, pi, p.name, Math.round(p.w));
        group.append(checkButton(p.name, `${fmt(p.w)} × ${fmt(p.h)}`, prog.cuts[key], btn => toggleProgress(prog.cuts, key, btn)));
      });
      cuts.append(group);
    });
    if (plan.mode === 'rough') {
      const group = el('div', 'bm-board');
      group.append(el('div', 'bm-board-title', 'Cut list (rough stock)'));
      state.cut.filter(r => r.stock !== 'sheet').forEach((r, ri) => {
        const key = cutKey('r', 0, ri, r.name, r.L);
        group.append(checkButton(`${r.qty} × ${r.name}`, `${fmt(r.L)} × ${fmt(r.W)} × ${fmt(r.T)}`, prog.cuts[key], btn => toggleProgress(prog.cuts, key, btn)));
      });
      cuts.append(group);
    }
    if (!cuts.children.length) cuts.append(el('p', 'sub', 'No cuts — the design has no parts.'));

    // Assembly steps: tap to check; ▶ opens step-synced 3D playback full screen.
    const stepsWrap = el('div', 'bm-steps');
    state.steps.forEach((s, i) => {
      const row = el('div', '');
      row.style.display = 'flex';
      row.style.gap = '8px';
      row.style.alignItems = 'stretch';
      const btn = checkButton(`${i + 1}. ${s.title}`, null, prog.steps[s.id], b => toggleProgress(prog.steps, s.id, b));
      btn.style.flex = '1';
      const play = el('button', 'bm-step-play', '▶');
      play.setAttribute('aria-label', `Play 3D animation for step ${i + 1}`);
      play.onclick = () => enterBmPlayback(i);
      row.append(btn, play);
      stepsWrap.append(row);
    });
    stepsEl.append(stepsWrap);
    $('bmProgress').textContent = progressPct() + '% built';
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
    if (state.buildMode) renderBuildChecklists();
  }

  /* ---------------- tabs ---------------- */
  const TABS = ['cut', 'stock', 'bom', 'assembly', 'integrity', 'reference'];
  function renderTabs() {
    for (const t of TABS) {
      $('tab-' + t).setAttribute('aria-selected', String(state.tab === t));
      $('tab-' + t).tabIndex = state.tab === t ? 0 : -1;
    }
    const dot = $('integrityDot');
    const sum = state.integrity ? state.integrity.summary : null;
    dot.hidden = !sum || (!sum.fails && !sum.advisories);
    dot.classList.toggle('fail', !!(sum && sum.fails));
  }
  function bindTabs() {
    const bar = $('tabBar');
    for (const t of TABS) {
      $('tab-' + t).addEventListener('click', () => { state.tab = t; renderTabs(); renderPanel(); });
    }
    bar.addEventListener('keydown', e => {
      const i = TABS.indexOf(state.tab);
      let next = null;
      if (e.key === 'ArrowRight') next = TABS[(i + 1) % TABS.length];
      if (e.key === 'ArrowLeft') next = TABS[(i + TABS.length - 1) % TABS.length];
      if (e.key === 'Home') next = TABS[0];
      if (e.key === 'End') next = TABS[TABS.length - 1];
      if (next) {
        e.preventDefault();
        state.tab = next; renderTabs(); renderPanel();
        $('tab-' + next).focus();
      }
    });
  }

  /* ---------------- exports ---------------- */
  function doExport(kind) {
    const name = Exports.slug(state.spec.meta.name);
    if (kind === 'dae') {
      Exports.download(name + '.dae', Exports.toDAE(state.spec, state.model), 'model/vnd.collada+xml');
      botSay('Exported the mesh. In SketchUp: File > Import, choose COLLADA (*.dae), pick the file. Parts arrive named and true to size.', []);
    } else if (kind === 'rb') {
      Exports.download(name + '.rb', Exports.toRuby(state.spec, state.model), 'text/x-ruby');
      botSay('Exported the build script. Paste it into SketchUp’s Ruby Console (Window > Ruby Console) — the model rebuilds as components, one undo step.', []);
    } else if (kind === 'json') {
      Exports.download(name + '.designspec.json', JSON.stringify(state.spec, null, 2), 'application/json');
    } else if (kind === 'share') {
      openShare();
    } else if (kind === 'print') {
      $('printRoot').innerHTML = Exports.printHTML(state.spec, state.model, state.cut, state.bomData, state.steps, state.stockPlan);
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
  function boot() {
    const canvas = $('view3d');
    state.engine = BB.Engine.create(canvas, {
      reducedMotion: reduceMq.matches,
      onPick(part, info) {
        if (!part) {
          if (state.engine.getIsolated()) state.engine.isolate(null);
          else closeInspector();
          return;
        }
        if (info.double) {
          state.engine.isolate(state.engine.getIsolated() === part.id ? null : part.id);
          openInspector(part);
          return;
        }
        if (part.drawer !== undefined && part.drawer !== null) state.engine.toggleDrawer(part.drawer);
        openInspector(part);
      }
    });
    reduceMq.addEventListener('change', () => state.engine.setReducedMotion(reduceMq.matches));
    new ResizeObserver(() => state.engine.resize()).observe($('viewportWrap'));

    // Seed design straight through the pipeline.
    const seed = Spec.defaultSpec('table');
    seed.meta.name = 'Seed Table';
    const r = runPipeline(seed);
    adopt(r);
    state.history = History.createHistory(r.spec, 'seed');
    state.engine.snapNow();
    renderAll();
    renderHints();
    renderGallery();
    openScrim('galleryScrim');
    botSay('Welcome to the shop. Pick a starter, open one of your projects, or describe a piece — you can even drop in a photo of furniture you want to build. Everything autosaves as you work.', []);

    // Persisted prices + prefs arrive async; recompute once they land.
    (async () => {
      try {
        state.prices = await Store.loadPrices();
        state.prefs4 = await Store.loadPrefs();
        recompute();
      } catch (e) { /* defaults are the product */ }
    })();

    /* top bar */
    $('undoBtn').onclick = () => { const s = state.history.undo(); if (s) restoreTo(s); };
    $('redoBtn').onclick = () => { const s = state.history.redo(); if (s) restoreTo(s); };
    $('historyBtn').onclick = openHistoryDrawer;
    $('historyClose').onclick = closeHistoryDrawer;
    $('compareBtn').onclick = openCompare;
    $('compareClose').onclick = showCompareOverlay;
    $('compareExit').onclick = clearCompare;
    $('unitsBtn').onclick = () => merge({ meta: { units: state.spec.meta.units === 'mm' ? 'in' : 'mm' } }, 'manual');
    $('designName').addEventListener('change', e => merge({ meta: { name: e.target.value } }, 'manual'));
    $('levelSelect').addEventListener('change', e => merge({ meta: { level: e.target.value } }, 'manual'));
    $('projectsBtn').onclick = openProjects;
    $('projectsClose').onclick = () => closeScrim('projectsScrim');
    $('shareBtn').onclick = openShare;
    $('shareClose').onclick = () => closeScrim('shareScrim');
    $('copyShare').onclick = copyShare;
    $('importShare').onclick = importShare;
    $('speciesClose').onclick = () => closeScrim('speciesScrim');
    $('diagClose').onclick = () => closeScrim('diagScrim');
    $('diagRerun').onclick = runDiagnostics;
    $('buildModeBtn').onclick = enterBuildMode;
    $('bmExit').onclick = exitBuildMode;
    $('bmPbPrev').onclick = () => scrubPlayback(state.playbackIndex - 1);
    $('bmPbNext').onclick = () => scrubPlayback(state.playbackIndex + 1);
    $('bmPbBack').onclick = exitBmPlayback;
    bindLogoLongPress();

    /* export menu */
    const menu = $('exportMenu'), exBtn = $('exportBtn');
    exBtn.onclick = () => {
      const open = menu.classList.toggle('open');
      exBtn.setAttribute('aria-expanded', String(open));
    };
    document.addEventListener('click', e => {
      if (!menu.contains(e.target) && e.target !== exBtn) {
        menu.classList.remove('open');
        exBtn.setAttribute('aria-expanded', 'false');
      }
    });
    menu.querySelectorAll('[data-export]').forEach(b => {
      b.addEventListener('click', () => {
        menu.classList.remove('open');
        doExport(b.dataset.export);
      });
    });

    /* chat — no form element (artifact rules); Enter and the button both send */
    const sendNow = () => {
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
    $('sheetHandle').onclick = () => $('chatPanel').classList.toggle('expanded');

    /* stage controls */
    $('explodeRange').addEventListener('input', e => state.engine.setExplode(e.target.value / 100));
    $('dimsToggle').onclick = () => {
      const on = $('dimsToggle').getAttribute('aria-pressed') !== 'true';
      $('dimsToggle').setAttribute('aria-pressed', String(on));
      state.engine.setDims(on, state.spec.meta.units);
    };
    $('frameBtn').onclick = () => state.engine.frame();
    $('inspClose').onclick = closeInspector;

    /* playback bar */
    $('pbPrev').onclick = () => scrubPlayback(state.playbackIndex - 1);
    $('pbNext').onclick = () => scrubPlayback(state.playbackIndex + 1);
    $('pbReplay').onclick = () => state.engine.playbackReplay();
    $('pbExit').onclick = exitPlayback;

    /* modals */
    $('galleryClose').onclick = () => closeScrim('galleryScrim');
    $('helpClose').onclick = () => closeScrim('helpScrim');
    document.querySelectorAll('.scrim').forEach(s => {
      s.addEventListener('click', e => { if (e.target === s) s.classList.remove('open'); });
    });

    /* keyboard */
    document.addEventListener('keydown', e => {
      const tag = document.activeElement && document.activeElement.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault(); $('undoBtn').click();
      } else if (((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z') || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y')) {
        if (!typing) { e.preventDefault(); $('redoBtn').click(); }
      } else if (e.key === 'Escape') {
        if (state.bmPlayback) { exitBmPlayback(); return; }
        if (state.buildMode) { exitBuildMode(); return; }
        hideProv();
        document.querySelectorAll('.scrim.open').forEach(s => s.classList.remove('open'));
        menu.classList.remove('open');
        closeHistoryDrawer();
        if (state.playbackIndex >= 0) exitPlayback();
        else closeInspector();
      }
    });

    bindTabs();

    // expose for smoke tests
    globalThis.__bb = {
      state, commit, merge, sendMessage, sendPhoto, runPipeline, enterPlayback, scrubPlayback, exitPlayback,
      doExport, recompute, enterBuildMode, exitBuildMode, enterBmPlayback, exitBmPlayback,
      openProjects, loadProjectIntoApp, openShare, importShare, openSpecies, runDiagnostics, doAutosave, progressPct
    };

    setTimeout(() => { const h = $('viewportHint'); if (h) h.style.opacity = '0'; }, 6000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
