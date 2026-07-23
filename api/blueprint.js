/* Blueprint Buddy — blueprint issuance (the unit of sale, zero-dependency).
 *
 * A blueprint is a server-issued, versioned artifact: the client sends the
 * design spec, this function runs the SAME engineering pipeline the browser
 * runs (api/_pipeline.js — the loader pattern proven by test/audit.test.js),
 * and stores/serves the complete sheet set. The credit ledger
 * (api/_credits.js) is the authority on whether it costs anything.
 *
 * Order of operations is load-bearing: VALIDATE first (a plan that fails
 * validation is never charged), CHARGE second, RENDER third, and REFUND
 * automatically on any failure after the charge.
 *
 * Charging model (decided, not re-litigated here):
 *   - a credit buys a DESIGN, committed at first issuance;
 *   - the corrected-spec hash is the idempotency key — the same corrected
 *     spec never charges twice (reloads, retries, re-exports, re-downloads);
 *   - refinements within WINDOW_DAYS of commit are free (pass designId);
 *     the window is per DESIGN ID with no material-change threshold — a
 *     committed design may legitimately be refined into an entirely
 *     different piece on its one credit (deliberate launch simplicity;
 *     this is the pricing rule to revisit first if it gets gamed);
 *   - meta.name / meta.units are display-only and never a material change;
 *   - a material change after the window closes charges a fresh credit.
 *
 *   POST /api/blueprint                     { spec | wire, designId?, hero?, exploded? }
 *     -> 200 { ok, id, specHash, revision, charged, cached, balance,
 *              windowEndsAt, formats, validation:{advisories} }
 *     -> 401 auth_required · 402 insufficient_credits · 422 validation_failed
 *     -> 500 render_failed (refunded:true when a charge had landed)
 *   GET  /api/blueprint?list=1              -> { designs: [...] , balance }
 *   GET  /api/blueprint?id=…&format=sheets|csv|svg|json   (owner only, free forever)
 *   GET  /api/blueprint?share=BB4:…         -> public read-only preview page (free, never charges)
 *
 * KV keys (all roots reserved in api/store.js):
 *   bb:{uid}:design:{id}     { id, name, committedAt, windowEndsAt, revision, specHashes:[…] }
 *   bb:{uid}:designs:index   [ {id, name, committedAt, revision} ]
 *   bb:{uid}:bphash:{chargeHash}   design id   — idempotency lookup
 *   bb:{uid}:artifact:{artifactHash}  { sheets, csv, svg, spec, meta }
 */
'use strict';

const crypto = require('crypto');
const S = require('./_session.js');
const KV = require('./_kv.js');
const Credits = require('./_credits.js');
const Pipeline = require('./_pipeline.js');
const Sheets = require('./_sheets.js');
const Log = require('./_log.js');

const MAX_BODY_BYTES = 2 * 1024 * 1024;   // two downscaled renders + a wire spec
const MAX_IMAGE_BYTES = 600 * 1024;       // per posted render (hero / exploded)
const DATA_IMG_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

const designKey = (uid, id) => `bb:${uid}:design:${id}`;
const designIndexKey = uid => `bb:${uid}:designs:index`;
const hashKey = (uid, h) => `bb:${uid}:bphash:${h}`;
const artifactKey = (uid, h) => `bb:${uid}:artifact:${h}`;

const _test = { failRender: false }; // injectable failure for the refund-path test

function sendJSON(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}
function sendText(res, status, type, body, cache) {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', cache || 'private, max-age=0');
  res.end(body);
}
function readBody(req) {
  if (req.body !== undefined) return Promise.resolve(typeof req.body === 'string' ? JSON.parse(req.body) : req.body);
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}
function origin(req) {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN.replace(/\/$/, '');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  return (S.isSecure(req) ? 'https' : 'http') + '://' + host;
}
async function readJSON(kv, key, fallback) {
  const raw = await kv.get(key);
  if (raw === undefined || raw === null) return fallback;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return fallback; }
}
const cleanImage = v => (typeof v === 'string' && v.length <= MAX_IMAGE_BYTES && DATA_IMG_RE.test(v)) ? v : null;

/* Render the artifact set for a valid evaluated spec. Pure of the ledger. */
function renderArtifacts(evaluated, meta) {
  if (_test.failRender) throw new Error('injected render failure');
  const { BB, spec, model } = evaluated;
  const derived = Pipeline.derive(BB, spec, model);
  const full = Object.assign({ BB, spec, model }, derived);
  const sheets = Sheets.sheetSet(full, meta);
  const templates = Sheets.templateSet(full, meta);
  const csv = BB.Exports.toCSV(spec, derived.cut, { origin: meta.origin });
  const svg = BB.Exports.printSVG(BB.Drafting.sheetSVG(spec, model, BB.Units.fmtLength, { origin: meta.origin }));
  return { sheets, templates, csv, svg, derived };
}

/* The public read-only preview page for a shared design (Phase 5): the
 * shape, the verdict, the cost — never the cut dimensions or step text. */
function sharePage(evaluated, meta) {
  const { BB, spec, model } = evaluated;
  const derived = Pipeline.derive(BB, spec, model);
  const U = BB.Units;
  const dim = v => U.fmtLength(v);
  const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sp = BB.K.WOOD_SPECIES[spec.wood.species];
  const verdict = derived.integ.summary.verdict;
  const verdictText = verdict === 'fail' ? 'Fails structural checks as designed'
    : verdict === 'anchor' ? 'Safe only when anchored to the wall'
      : verdict === 'advisory' ? 'Passes structural checks, with notes' : 'Passes all structural checks';
  const partCount = derived.cut.reduce((s, r) => s + r.qty, 0);
  const openUrl = meta.origin + '/#d=' + encodeURIComponent(meta.code);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(spec.meta.name)} — a Blueprint Buddy design</title>
<meta name="description" content="${esc(spec.meta.name)}: ${esc(dim(spec.overall.width))} × ${esc(dim(spec.overall.depth))} × ${esc(dim(spec.overall.height))} in ${esc(sp.label)} — ${esc(verdictText)}. Open it live in the Blueprint Buddy studio.">
<style>
  body { font: 15px/1.6 "Helvetica Neue", Arial, sans-serif; color: #1c1a14; background: #efeade; margin: 0; }
  main { max-width: 860px; margin: 0 auto; padding: 32px 20px 64px; }
  .kicker { font-size: 12px; text-transform: uppercase; letter-spacing: .14em; color: #8a4a2b; }
  h1 { font-size: 34px; margin: 6px 0 4px; }
  .facts { display: flex; flex-wrap: wrap; gap: 10px; margin: 18px 0; }
  .facts div { background: #fff; border: 1px solid #d8d4c8; padding: 10px 14px; }
  .facts strong { display: block; font-size: 18px; }
  .verdict { display: inline-block; border: 1.5px solid #8a5a1c; color: #8a5a1c; padding: 4px 12px; font-weight: 700; }
  .drawing { background: #fff; border: 1px solid #d8d4c8; padding: 12px; margin: 18px 0; }
  .drawing svg { width: 100%; height: auto; }
  .cta { display: inline-block; background: #8a4a2b; color: #fff; padding: 12px 22px; font-weight: 700;
         text-decoration: none; margin-top: 10px; }
  .fine { color: #666; font-size: 13px; }
</style></head><body><main>
  <p class="kicker">Shared from Blueprint Buddy</p>
  <h1>${esc(spec.meta.name)}</h1>
  <p>${esc(dim(spec.overall.width))} W × ${esc(dim(spec.overall.depth))} D × ${esc(dim(spec.overall.height))} H · ${esc(sp.label)} · ${esc(spec.meta.level)} build</p>
  <p class="verdict">${esc(verdictText)}</p>
  <div class="facts">
    <div><strong>${partCount}</strong>parts</div>
    <div><strong>$${derived.bom.total}</strong>estimated materials</div>
    <div><strong>≈ ${derived.time.hoursLow}–${derived.time.hoursHigh} h</strong>bench time</div>
  </div>
  <div class="drawing">${Sheets.sheetSet ? BB.Exports.printSVG(BB.Drafting.sheetSVG(spec, model, dim, { origin: meta.origin })) : ''}</div>
  <a class="cta" href="${esc(openUrl)}">Open this design in the studio</a>
  <p class="fine">Free to view and refine. The full blueprint — exact cut dimensions, stock plan, and step-by-step assembly — is issued in the studio.</p>
</main></body></html>`;
}

module.exports = async function handler(req, res) {
  const kv = KV.backend();
  const url = new URL(req.url, 'http://localhost');

  /* ---- public share preview: free, session-less, never charges ---- */
  if (req.method === 'GET' && url.searchParams.get('share')) {
    try {
      const decoded = Pipeline.decodeShareCode(url.searchParams.get('share'));
      const spec = decoded && (decoded.spec || (decoded.meta ? decoded : null));
      if (!spec) return sendText(res, 404, 'text/html; charset=utf-8', '<!doctype html><p>That share code didn’t decode.</p>');
      const evaluated = Pipeline.evaluate(spec);
      if (evaluated.report.errors.length) return sendText(res, 404, 'text/html; charset=utf-8', '<!doctype html><p>This shared design doesn’t validate.</p>');
      const html = sharePage(evaluated, { origin: origin(req), code: url.searchParams.get('share') });
      return sendText(res, 200, 'text/html; charset=utf-8', html, 'public, max-age=3600');
    } catch (e) {
      Log.report('blueprint', 'share_render_failed', e);
      return sendText(res, 404, 'text/html; charset=utf-8', '<!doctype html><p>That share code didn’t decode.</p>');
    }
  }

  const session = S.sessionFrom(req);
  if (!session) return sendJSON(res, 401, { error: 'auth_required' });
  if (!kv) return sendJSON(res, 503, { error: 'storage_unconfigured' });
  const uid = session.uid;
  const ip = Credits.clientIp(req); // rides every ledger call: signup-cap context

  try {
    if (req.method === 'GET') {
      if (url.searchParams.get('list')) {
        const [index, credits] = await Promise.all([readJSON(kv, designIndexKey(uid), []), Credits.state(uid, { ip })]);
        return sendJSON(res, 200, { designs: index, balance: credits.balance });
      }
      const id = url.searchParams.get('id');
      if (!id || !/^bp_[a-z0-9]+$/.test(id)) return sendJSON(res, 400, { error: 'bad_request' });
      const design = await readJSON(kv, designKey(uid, id), null);
      if (!design) return sendJSON(res, 404, { error: 'not_found' });
      const artifact = await readJSON(kv, artifactKey(uid, design.artifactHash), null);
      if (!artifact) return sendJSON(res, 404, { error: 'artifact_missing' });
      const format = url.searchParams.get('format') || 'sheets';
      if (format === 'sheets') return sendText(res, 200, 'text/html; charset=utf-8', artifact.sheets);
      if (format === 'templates') return sendText(res, 200, 'text/html; charset=utf-8', artifact.templates || '<!doctype html><p>No templates in this artifact — re-issue to add them.</p>');
      if (format === 'csv') return sendText(res, 200, 'text/csv; charset=utf-8', artifact.csv);
      if (format === 'svg') return sendText(res, 200, 'image/svg+xml', artifact.svg);
      if (format === 'json') return sendJSON(res, 200, { spec: artifact.spec, meta: artifact.meta });
      return sendJSON(res, 400, { error: 'unknown_format' });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return sendJSON(res, 405, { error: 'method_not_allowed' });
    }

    /* ---------------- issuance ---------------- */
    let body;
    try { body = await readBody(req); }
    catch (e) { return sendJSON(res, 400, { error: e.message }); }
    let raw = null;
    if (body && body.wire && typeof body.wire === 'object') {
      try { raw = Pipeline.decodeWire(body.wire); } catch (e) { return sendJSON(res, 400, { error: 'bad_wire' }); }
    } else if (body && body.spec && typeof body.spec === 'object') {
      raw = body.spec;
    }
    if (!raw) return sendJSON(res, 400, { error: 'spec_required' });

    // 1) VALIDATE FIRST — a plan that fails validation is never charged.
    let evaluated;
    try { evaluated = Pipeline.evaluate(raw); }
    catch (e) { Log.report('blueprint', 'pipeline_error', e); return sendJSON(res, 422, { error: 'validation_failed', errors: [{ id: 'pipeline', text: 'The engineering pipeline could not build this spec.' }] }); }
    if (evaluated.report.errors.length) {
      return sendJSON(res, 422, {
        error: 'validation_failed',
        errors: evaluated.report.errors.map(e => ({ id: e.id, text: e.text }))
      });
    }

    const cHash = Pipeline.chargeHash(evaluated.spec);
    const aHash = Pipeline.artifactHash(evaluated.spec);
    const now = Date.now();
    const appOrigin = origin(req);
    const hero = cleanImage(body.hero);
    const exploded = cleanImage(body.exploded);

    // 2) IDEMPOTENCY — the same corrected spec never charges twice.
    const boundId = await kv.get(hashKey(uid, cHash));
    let design = boundId ? await readJSON(kv, designKey(uid, String(boundId)), null) : null;
    let charged = false, cached = false, grantId = null, balance = null;

    if (design) {
      cached = true;
    } else {
      // Refinement of a committed design inside its window is free.
      const claimedId = typeof body.designId === 'string' && /^bp_[a-z0-9]+$/.test(body.designId) ? body.designId : null;
      const openDesign = claimedId ? await readJSON(kv, designKey(uid, claimedId), null) : null;
      if (openDesign && openDesign.windowEndsAt > now) {
        design = openDesign;
      } else {
        // 3) CHARGE — a fresh design commit.
        const chargeRes = await Credits.charge(uid, { specHash: cHash, blueprintId: null, reason: 'issue', ip });
        if (!chargeRes.ok) {
          return sendJSON(res, 402, { error: chargeRes.error || 'insufficient_credits', balance: chargeRes.balance });
        }
        charged = true;
        grantId = chargeRes.grantId;
        balance = chargeRes.balance;
        design = {
          id: 'bp_' + crypto.randomBytes(6).toString('hex'),
          name: evaluated.spec.meta.name,
          template: evaluated.spec.meta.template || 'custom',
          committedAt: now,
          windowEndsAt: now + Credits.WINDOW_DAYS * 86400e3,
          revision: 0,
          specHashes: []
        };
      }
    }

    // 4) RENDER — and refund on ANY failure after a charge landed.
    try {
      const haveArtifact = !!(await kv.get(artifactKey(uid, aHash)));
      if (!haveArtifact) {
        const revision = cached ? design.revision : design.revision + 1;
        const meta = {
          id: design.id, revision,
          specHash: cHash.slice(0, 16),
          issued: new Date(now).toISOString().slice(0, 10),
          origin: appOrigin,
          link: appOrigin + '/?bp=' + design.id,
          heroDataUrl: hero, explodedDataUrl: exploded
        };
        const artifacts = renderArtifacts(evaluated, meta);
        await kv.set(artifactKey(uid, aHash), JSON.stringify({
          sheets: artifacts.sheets, templates: artifacts.templates, csv: artifacts.csv, svg: artifacts.svg,
          spec: evaluated.spec,
          meta: { id: design.id, revision, specHash: cHash, issued: now }
        }));
      }
      if (!cached) {
        // Pricing telemetry, not pricing logic: the no-threshold window rule
        // above lets a committed table legally morph into a bench on one
        // credit. Write each piece-type hop onto the design record and the
        // logs so the "revisit first if it gets gamed" call is made on data.
        const tpl = evaluated.spec.meta.template || 'custom';
        if (!design.template) {
          design.template = tpl;
        } else if (design.template !== tpl) {
          design.morphs = (design.morphs || []).slice(-19);
          design.morphs.push({ ts: now, from: design.template, to: tpl });
          Log.report('blueprint', 'window_morph', { id: design.id, from: design.template, to: tpl });
          design.template = tpl;
        }
        design.revision += 1;
        if (!design.specHashes.includes(cHash)) design.specHashes.push(cHash);
        design.artifactHash = aHash;
        design.name = evaluated.spec.meta.name;
        await kv.set(designKey(uid, design.id), JSON.stringify(design));
        await kv.set(hashKey(uid, cHash), design.id);
        const index = await readJSON(kv, designIndexKey(uid), []);
        const row = { id: design.id, name: design.name, committedAt: design.committedAt, revision: design.revision, windowEndsAt: design.windowEndsAt };
        const i = index.findIndex(r => r.id === design.id);
        if (i >= 0) index[i] = row; else index.unshift(row);
        await kv.set(designIndexKey(uid), JSON.stringify(index));
      } else if (design.artifactHash !== aHash) {
        // Same material design, new display identity (rename / unit flip):
        // re-point at the fresh render — no revision bump, never a charge.
        design.artifactHash = aHash;
        design.name = evaluated.spec.meta.name;
        await kv.set(designKey(uid, design.id), JSON.stringify(design));
      }
    } catch (renderError) {
      Log.report('blueprint', 'render_failed', renderError);
      if (charged) {
        try { await Credits.refund(uid, { specHash: cHash, blueprintId: design.id, grantId, reason: 'render_failed' }); }
        catch (refundError) { Log.report('blueprint', 'refund_failed', refundError); }
      }
      return sendJSON(res, 500, { error: 'render_failed', refunded: charged });
    }

    if (balance === null) balance = (await Credits.state(uid, { ip })).balance;
    return sendJSON(res, 200, {
      ok: true,
      id: design.id,
      specHash: cHash,
      revision: design.revision,
      charged, cached, balance,
      windowEndsAt: design.windowEndsAt,
      formats: ['sheets', 'templates', 'csv', 'svg', 'json'],
      validation: { advisories: evaluated.report.advisories.map(a => a.id) }
    });
  } catch (e) {
    Log.report('blueprint', 'handler_error', e);
    return sendJSON(res, 502, { error: 'blueprint_error' });
  }
};

module.exports._test = _test;
