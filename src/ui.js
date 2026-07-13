/* Blueprint Buddy — UI shell. All DOM wiring lives here; every design change
 * flows through commit() so AI edits, inspector edits, and history restores
 * share one spec and one history stack. */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';
  const { Spec, Parametric, Plans, Exports, History, AI, K, Gallery } = BB;
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
    history: null, engine: null,
    tab: 'cut', refTab: 'wood', refQuery: '',
    dismissed: new Set(),
    selected: null,
    playbackIndex: -1,
    compare: null,           // {aId, bId}
    busy: false,
    firstRun: true,
    previewing: false
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

  function adopt(r) {
    state.spec = r.spec; state.model = r.model; state.report = r.report;
    state.cut = Plans.cutList(r.spec, r.model);
    state.bomData = Plans.bom(r.spec, r.model);
    state.steps = Plans.assembly(r.spec, r.model);
    state.engine.setModel(r.model, r.spec);
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
  }

  function restoreTo(spec) { // undo/redo/restore: no new pipeline-blocking possible
    exitPlayback();
    const r = runPipeline(spec);
    adopt(r);
    renderAll();
  }

  function merge(patch, source, summary) {
    return commit(Spec.deepMerge(state.spec, patch), source, summary);
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
    else if (state.tab === 'bom') renderBom(inner);
    else if (state.tab === 'assembly') renderAssembly(inner);
    else renderReference(inner);
  }

  function renderCut(root) {
    root.append(el('h3', '', 'Cut list'));
    root.append(el('p', 'lede', `Lengths include joinery allowances. Stock: ${esc(K.WOOD_SPECIES[state.spec.wood.species].label)} + Baltic birch ply.`));
    if (!state.cut.length) {
      root.append(el('div', 'empty-state', '<span class="big">Nothing on the saw bench yet.</span>Describe a piece in the chat and the cut list writes itself.'));
      return;
    }
    const scroll = el('div', 'table-scroll');
    const rows = state.cut.map(r => `<tr>
      <td>${esc(r.name)}</td><td class="num">${r.qty}</td>
      <td class="num">${fmt(r.L)}</td><td class="num">${fmt(r.W)}</td><td class="num">${fmt(r.T)}</td>
      <td>${esc(K.WOOD_SPECIES[r.material] ? K.WOOD_SPECIES[r.material].label : r.material)}</td>
      <td style="color:var(--muted);font-size:12.5px">${esc(r.note || '')}</td></tr>`).join('');
    scroll.innerHTML = `<table class="data"><thead><tr><th>Part</th><th>Qty</th><th>Length</th><th>Width</th><th>Thick</th><th>Material</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table>`;
    root.append(scroll);
  }

  function renderBom(root) {
    root.append(el('h3', '', 'Bill of materials'));
    root.append(el('p', 'lede', 'Rough-sawn estimate with a 30% waste factor on solid stock.'));
    const scroll = el('div', 'table-scroll');
    const rows = state.bomData.items.map(i => `<tr>
      <td><span class="kind-tag">${esc(i.kind)}</span></td>
      <td>${esc(i.label)}</td><td class="num">${i.qty}</td>
      <td style="color:var(--muted);font-size:12.5px">${esc(i.detail || '')}</td></tr>`).join('');
    scroll.innerHTML = `<table class="data"><thead><tr><th></th><th>Item</th><th>Qty</th><th>Detail</th></tr></thead><tbody>${rows}</tbody></table>`;
    root.append(scroll);
    const tot = el('div', 'bom-total');
    tot.innerHTML = `<span>Estimated materials cost</span><strong>$${state.bomData.total}</strong>`;
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
    // tooltip toggles
    root.querySelectorAll('.why-joint > button').forEach(b => {
      b.addEventListener('click', e => {
        e.stopPropagation();
        const w = b.parentElement;
        const open = w.classList.toggle('open');
        b.setAttribute('aria-expanded', open);
      });
    });
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
    for (const [key, label] of [['wood', 'Wood species'], ['ergo', 'Ergonomics'], ['joinery', 'Joinery'], ['fast', 'Fasteners & finishes']]) {
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
      head = '<th>Species</th><th>Janka</th><th>Workability</th><th>Movement</th><th>Outdoor</th><th>Cost</th><th>Character</th>';
      rows = Object.values(K.WOOD_SPECIES).filter(s => hit(s.label, s.blurb, s.movement)).map(s => `<tr>
        <td><strong>${esc(s.label)}</strong></td><td class="num">${s.janka} lbf</td>
        <td><span class="dots">${'●'.repeat(s.workability)}${'○'.repeat(5 - s.workability)}</span></td>
        <td class="movement-${s.movement}">${s.movement}</td>
        <td>${s.outdoor ? 'yes' : 'no'}</td><td class="num">${'$'.repeat(s.costTier)}</td>
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
    let html = `<div class="bubble">${esc(text)}</div>`;
    if (chips && chips.length) {
      html += `<div class="chips">${chips.map(c => `<span class="chip">${esc(c)}</span>`).join('')}</div>`;
    } else if (opts && opts.noChange) {
      html += `<div class="chips"><span class="chip neutral">no dimensional change</span></div>`;
    }
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

  async function sendMessage(text) {
    text = text.trim();
    if (!text || state.busy) return;
    hideHints();
    chatMsg('user', `<div class="bubble">${esc(text)}</div>`);
    const typing = chatMsg('bot', '<span class="typing"><i></i><i></i><i></i></span>');
    state.busy = true;
    renderPanel();
    try {
      const reply = await AI.respond(text, state.spec);
      typing.remove();
      state.busy = false;
      if (reply.kind === 'question') {
        renderPanel();
        askQuestion(reply);
        return;
      }
      const applied = AI.apply(reply, state.spec);
      const before = state.spec;
      const okc = commit(applied.spec, 'ai');
      if (!okc) {
        botSay('That change would leave a drawer with no room to exist — I’ve left the design as it was. Try a gentler dimension.', []);
        renderPanel();
        return;
      }
      const realDiffs = Spec.diffSpecs(before, state.spec);
      const chips = Spec.describeDiff(realDiffs, state.spec.meta.units);
      botSay(reply.explain, chips, { noChange: !chips.length });
    } catch (err) {
      typing.remove();
      state.busy = false;
      renderPanel();
      botSay('The design brain slipped a gear on that one. Mind rephrasing?', []);
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
    $('inspDims').textContent = `${fmt(part.size.w)} × ${fmt(part.size.h)} × ${fmt(part.size.d)}`;
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

    body.append(dim('Width', 'overall.width', 250, 2400));
    body.append(dim('Depth', 'overall.depth', 200, 1200));
    body.append(dim('Height', 'overall.height', 120, 2400));
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
    $('playbackBar').hidden = false;
    updatePlaybackBar();
    if (state.tab !== 'assembly') { state.tab = 'assembly'; renderTabs(); }
    renderPanel();
    const active = document.querySelector(`.step-item[data-step="${i}"]`);
    if (active) active.scrollIntoView({ block: 'nearest', behavior: reduceMq.matches ? 'auto' : 'smooth' });
  }
  function updatePlaybackBar() {
    const s = state.steps[state.playbackIndex];
    $('pbCount').textContent = `${state.playbackIndex + 1}/${state.steps.length}`;
    $('pbLabel').textContent = s ? s.title : '';
    $('pbPrev').disabled = state.playbackIndex <= 0;
    $('pbNext').disabled = state.playbackIndex >= state.steps.length - 1;
  }
  function scrubPlayback(i) {
    if (i < 0 || i >= state.steps.length) return;
    state.playbackIndex = i;
    state.engine.playbackGoTo(i);
    state.engine.playbackReplay();
    updatePlaybackBar();
    renderPanel();
    const active = document.querySelector(`.step-item[data-step="${i}"]`);
    if (active) active.scrollIntoView({ block: 'nearest', behavior: reduceMq.matches ? 'auto' : 'smooth' });
  }
  function exitPlayback() {
    if (state.playbackIndex < 0) return;
    state.playbackIndex = -1;
    state.engine.playbackExit();
    $('playbackBar').hidden = true;
    renderPanel();
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
    // Newer snapshot becomes the live design; older ghosts behind at 30%.
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
      const r = runPipeline(g.spec); // real spec through the production pipeline
      const card = el('button', 'gallery-card');
      card.innerHTML = `<span class="g-emoji">${g.emoji}</span>
        <span class="g-name">${esc(r.spec.meta.name)}</span>
        <span class="g-caption">${esc(g.caption)}</span>
        <span class="g-meta">${fmt(r.spec.overall.width)} × ${fmt(r.spec.overall.depth)} × ${fmt(r.spec.overall.height)} · ${esc(K.WOOD_SPECIES[r.spec.wood.species].label)}</span>`;
      card.onclick = () => {
        closeScrim('galleryScrim');
        state.dismissed.clear();
        commit(g.spec, 'gallery', ['loaded “' + r.spec.meta.name + '”']);
        state.engine.frame();
        botSay(`Loaded ${r.spec.meta.name} — ${r.model.parts.length} parts, plans ready. Tell me what to change.`, []);
      };
      grid.append(card);
    }
  }

  /* ---------------- tabs ---------------- */
  const TABS = ['cut', 'bom', 'assembly', 'reference'];
  function renderTabs() {
    for (const t of TABS) {
      $('tab-' + t).setAttribute('aria-selected', String(state.tab === t));
      $('tab-' + t).tabIndex = state.tab === t ? 0 : -1;
    }
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
    } else if (kind === 'print') {
      $('printRoot').innerHTML = Exports.printHTML(state.spec, state.model, state.cut, state.bomData, state.steps);
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

    // Seed design: the Phase 1 seed table, straight through the pipeline.
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
    botSay('Welcome to the shop. Pick a starter from the gallery, or just describe a piece — dimensions, wood, drawers, skill level — and I’ll draw up the plans.', []);

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

    /* chat */
    $('chatForm').addEventListener('submit', e => {
      e.preventDefault();
      const t = $('chatText');
      sendMessage(t.value);
      t.value = '';
      t.style.height = 'auto';
    });
    $('chatText').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        $('chatForm').requestSubmit();
      }
    });
    $('chatText').addEventListener('input', e => {
      e.target.style.height = 'auto';
      e.target.style.height = Math.min(120, e.target.scrollHeight) + 'px';
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
        document.querySelectorAll('.scrim.open').forEach(s => s.classList.remove('open'));
        menu.classList.remove('open');
        closeHistoryDrawer();
        if (state.playbackIndex >= 0) exitPlayback();
        else closeInspector();
      }
    });

    bindTabs();

    // expose for smoke tests
    globalThis.__bb = { state, commit, merge, sendMessage, runPipeline, enterPlayback, scrubPlayback, exitPlayback, doExport };

    setTimeout(() => { const h = $('viewportHint'); if (h) h.style.opacity = '0'; }, 6000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
