/* Blueprint Buddy — credit-spine tests: ledger, blueprint issuance, packs.
 * Written failing-first (repo protocol): these sections define the contract
 * for the credits pivot — a credit buys a DESIGN, committed at first plan
 * issuance, refinable free for 30 days, re-downloadable free forever.
 * Plain Node, zero deps, no network — upstream calls are mocked by swapping
 * globalThis.fetch, and handlers are driven with minimal fake req/res pairs.
 * Run: node test/credits.test.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗ ' + msg); }
}
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function section(name) { console.log('· ' + name); }

function fakeReq(url, opts) {
  opts = opts || {};
  return {
    url, method: opts.method || 'GET',
    headers: Object.assign({ host: 'app.example.com', 'x-forwarded-proto': 'https' }, opts.headers || {}),
    socket: {}, body: opts.body
  };
}
function fakeRes() {
  return {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(s) { this.body = s || ''; this.done = true; }
  };
}
const json = res => { try { return JSON.parse(res.body); } catch (e) { return null; } };

const S = require('../api/_session.js');
const Credits = require('../api/_credits.js');
const E = require('../api/_entitlements.js');
const blueprint = require('../api/blueprint.js');
const store = require('../api/store.js');
const chat = require('../api/chat.js');
const billing = require('../api/billing.js');
const webhook = require('../api/stripe-webhook.js');

const cleanEnv = () => {
  for (const k of ['AUTH_SECRET', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN',
    'BB_KV_FILE', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'ANTHROPIC_API_KEY', 'APP_ORIGIN',
    'STRIPE_CREDIT_PACK_1_PRICE_ID', 'STRIPE_CREDIT_PACK_3_PRICE_ID', 'STRIPE_CREDIT_PACK_10_PRICE_ID', 'STRIPE_CREDIT_PACK_25_PRICE_ID',
    'STRIPE_PRO_MONTHLY_PRICE_ID', 'STRIPE_PRO_YEARLY_PRICE_ID']) delete process.env[k];
};
function useTempKV() {
  const file = path.join(os.tmpdir(), 'bb-credit-kv-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.json');
  process.env.BB_KV_FILE = file;
  return () => { try { fs.unlinkSync(file); } catch (e) { /* already gone */ } };
}
const SECRET = 'credit-test-secret-0123456789abcdef';
function mkCookie(uid) {
  process.env.AUTH_SECRET = SECRET;
  const c = S.sessionCookieFor({ uid, name: 'T', provider: 'dev' }, fakeReq('/'));
  return { cookie: c.split(';')[0] };
}
function signWebhook(payload, secret) {
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', secret).update(ts + '.' + payload).digest('hex');
  return `t=${ts},v1=${sig}`;
}

/* A spec the pipeline validates clean (template pieces always correct to a
 * buildable design) and one that can never validate (a one-part custom). */
const VALID_SPEC = { meta: { name: 'Credit Test Table', template: 'table', level: 'beginner', units: 'mm' }, overall: { width: 1200, depth: 700, height: 750 } };
const INVALID_SPEC = { meta: { name: 'Broken', template: 'custom', level: 'beginner', units: 'mm' }, custom: { parts: [{ id: 'a', role: 'post', at: [0, 0, 0], dim: { w: 50, d: 50, h: 400 } }], connections: [] } };
const issue = (uid, body) => {
  const res = fakeRes();
  return blueprint(fakeReq('/api/blueprint', { method: 'POST', headers: mkCookie(uid), body }), res).then(() => res);
};

(async () => {
  /* ---------------- the ledger library ---------------- */
  section('credits: signup grant, purchase grant, charge, refund, audit trail');
  {
    cleanEnv();
    const drop = useTempKV();
    const uid = 'dev:led1';
    let st = await Credits.state(uid);
    eq(st.balance, 1, 'first read grants the signup credit');
    let led = await Credits.ledgerFor(uid);
    ok(led.length === 1 && led[0].type === 'grant' && led[0].reason === 'signup', 'signup grant is on the ledger');

    const g = await Credits.grant(uid, 3, { reason: 'purchase', sourceId: 'cs_test_1' });
    eq(g.balance, 4, 'purchased pack lands on the balance');
    const g2 = await Credits.grant(uid, 3, { reason: 'purchase', sourceId: 'cs_test_1' });
    ok(g2.deduped === true && g2.balance === 4, 'same sourceId never grants twice (webhook replay)');

    const c = await Credits.charge(uid, { specHash: 'h1', blueprintId: 'bp_1', reason: 'issue' });
    ok(c.ok === true && c.balance === 3, 'charge spends exactly one credit');
    const r = await Credits.refund(uid, { specHash: 'h1', blueprintId: 'bp_1', grantId: c.grantId, reason: 'render_failed' });
    ok(r.ok === true && r.balance === 4, 'refund restores the credit');
    led = await Credits.ledgerFor(uid);
    const kinds = led.map(e => e.type);
    eq(kinds, ['grant', 'grant', 'charge', 'refund'], 'ledger is append-only and complete');
    ok(led.every(e => typeof e.ts === 'number' && e.amount !== undefined), 'every entry carries amount + timestamp');
    ok(led[2].specHash === 'h1' && led[2].blueprintId === 'bp_1', 'charge entries carry spec hash + blueprint id');
    drop();
  }

  section('credits: expiry is 12 months from purchase, FIFO spend');
  {
    cleanEnv();
    const drop = useTempKV();
    const uid = 'dev:led2';
    const past = Date.now() - (13 * 30.4375 * 86400e3); // ~13 months ago
    await Credits.grant(uid, 2, { reason: 'purchase', sourceId: 'cs_old', ts: past });
    await Credits.grant(uid, 2, { reason: 'purchase', sourceId: 'cs_new' });
    const st = await Credits.state(uid);
    eq(st.balance, 3, 'expired pack is gone; signup + fresh pack remain');
    const led = await Credits.ledgerFor(uid);
    ok(led.some(e => e.type === 'expire' && e.amount === -2), 'expiry is written to the ledger, never silent');
    const c = await Credits.charge(uid, { specHash: 'h2', blueprintId: 'bp_2', reason: 'issue' });
    ok(c.ok, 'charge succeeds from the oldest unexpired grant');
    drop();
  }

  /* ---------------- blueprint issuance ---------------- */
  section('blueprint: sign-in is required to issue any plan');
  {
    cleanEnv();
    const drop = useTempKV();
    const res = fakeRes();
    await blueprint(fakeReq('/api/blueprint', { method: 'POST', body: { spec: VALID_SPEC } }), res);
    eq(res.statusCode, 401, 'anonymous issuance is refused');
    eq(json(res).error, 'auth_required', 'with a branchable error code');
    drop();
  }

  section('blueprint: a plan that fails validation is never charged');
  {
    cleanEnv();
    const drop = useTempKV();
    const uid = 'dev:bp-invalid';
    const res = await issue(uid, { spec: INVALID_SPEC });
    eq(res.statusCode, 422, 'validation failure is a 422');
    const body = json(res);
    eq(body.error, 'validation_failed', 'named error');
    ok(Array.isArray(body.errors) && body.errors.length > 0 && body.errors[0].id, 'the specific validation errors ride the response');
    const st = await Credits.state(uid);
    eq(st.balance, 1, 'the signup credit is untouched');
    const led = await Credits.ledgerFor(uid);
    ok(!led.some(e => e.type === 'charge'), 'no charge ever lands on the ledger');
    drop();
  }

  section('blueprint: first issuance charges one credit and returns the artifact set');
  {
    cleanEnv();
    const drop = useTempKV();
    const uid = 'dev:bp1';
    const res = await issue(uid, { spec: VALID_SPEC, hero: 'data:image/jpeg;base64,/9j/AAAA' });
    eq(res.statusCode, 200, 'issuance succeeds');
    const body = json(res);
    ok(body.charged === true && body.balance === 0, 'exactly one credit spent');
    ok(/^bp_/.test(body.id), 'a blueprint id is minted');
    ok(typeof body.specHash === 'string' && body.specHash.length >= 16, 'the corrected-spec hash is returned');
    eq(body.revision, 1, 'first issuance is revision 1');
    ok(typeof body.windowEndsAt === 'number' && body.windowEndsAt > Date.now(), '30-day refinement window is open');
    ok(Array.isArray(body.formats) && body.formats.includes('sheets') && body.formats.includes('csv'), 'artifact formats are listed');

    // Re-download: the stored artifact is served, styled as a full sheet set.
    let dl = fakeRes();
    await blueprint(fakeReq('/api/blueprint?id=' + body.id + '&format=sheets', { headers: mkCookie(uid) }), dl);
    eq(dl.statusCode, 200, 'sheet set downloads');
    ok(/text\/html/.test(dl.headers['content-type']), 'sheets are html');
    ok(dl.body.includes('Credit Test Table'), 'sheet set names the piece');
    ok(/SHEET|Sheet/.test(dl.body) && dl.body.includes('data:image/jpeg;base64'), 'title blocks + posted hero render are in the set');
    dl = fakeRes();
    await blueprint(fakeReq('/api/blueprint?id=' + body.id + '&format=csv', { headers: mkCookie(uid) }), dl);
    ok(dl.statusCode === 200 && /text\/csv/.test(dl.headers['content-type']), 'cut-list CSV downloads');
    dl = fakeRes();
    await blueprint(fakeReq('/api/blueprint?id=' + body.id + '&format=templates', { headers: mkCookie(uid) }), dl);
    ok(dl.statusCode === 200 && /width="\d+(\.\d+)?mm"/.test(dl.body) && /100% scale|Actual size/i.test(dl.body),
      'full-size (1:1) templates download with real-millimetre SVG units');
    // Another user can never fetch it.
    dl = fakeRes();
    await blueprint(fakeReq('/api/blueprint?id=' + body.id + '&format=sheets', { headers: mkCookie('dev:other') }), dl);
    eq(dl.statusCode, 404, 'artifacts are owner-scoped');
    drop();
  }

  section('blueprint: the same corrected spec never charges twice');
  {
    cleanEnv();
    const drop = useTempKV();
    const uid = 'dev:bp2';
    const first = json(await issue(uid, { spec: VALID_SPEC }));
    ok(first.charged === true, 'first issuance charges');
    const again = json(await issue(uid, { spec: VALID_SPEC }));
    ok(again.charged === false && again.cached === true, 'identical spec serves the stored blueprint free');
    eq(again.id, first.id, 'same design identity');
    eq((await Credits.state(uid)).balance, 0, 'balance unchanged by the retry');
    // A name-only change is not a material spec change.
    const renamed = json(await issue(uid, { spec: Object.assign({}, VALID_SPEC, { meta: Object.assign({}, VALID_SPEC.meta, { name: 'Renamed Table' }) }) }));
    ok(renamed.charged === false, 'renaming the piece is never a new charge');
    drop();
  }

  section('blueprint: refinement inside the 30-day window is free; a second design needs a second credit');
  {
    cleanEnv();
    const drop = useTempKV();
    const uid = 'dev:bp3';
    const first = json(await issue(uid, { spec: VALID_SPEC }));
    const refined = JSON.parse(JSON.stringify(VALID_SPEC));
    refined.overall.width = 1400;
    const second = json(await issue(uid, { spec: refined, designId: first.id }));
    ok(second.charged === false && second.id === first.id, 'refinement of the committed design is free');
    eq(second.revision, 2, 'revision advances');
    const other = JSON.parse(JSON.stringify(VALID_SPEC));
    other.overall.width = 900; other.meta.name = 'Second piece';
    const res3 = await issue(uid, { spec: other });
    eq(res3.statusCode, 402, 'a new design with zero credits is refused');
    eq(json(res3).error, 'insufficient_credits', 'with a branchable code');
    drop();
  }

  section('blueprint: a failure after the charge refunds automatically');
  {
    cleanEnv();
    const drop = useTempKV();
    const uid = 'dev:bp4';
    blueprint._test.failRender = true;
    const res = await issue(uid, { spec: VALID_SPEC });
    blueprint._test.failRender = false;
    eq(res.statusCode, 500, 'render failure is a 500');
    ok(json(res).refunded === true, 'the response says the charge was returned');
    eq((await Credits.state(uid)).balance, 1, 'balance restored');
    const led = await Credits.ledgerFor(uid);
    ok(led.some(e => e.type === 'charge') && led.some(e => e.type === 'refund'), 'charge and refund are both auditable');
    drop();
  }

  /* ---------------- pricing edges: concurrency + farming guards ---------------- */
  section('credits: concurrent charges never double-spend (atomic reservation)');
  {
    cleanEnv();
    const drop = useTempKV();
    const uid = 'dev:race1';
    await Credits.grant(uid, 2, { reason: 'purchase', sourceId: 'cs_race' }); // + signup = 3
    const results = await Promise.all([1, 2, 3, 4, 5].map(i =>
      Credits.charge(uid, { specHash: 'race' + i, blueprintId: 'bp_r' + i, reason: 'issue' })));
    eq(results.filter(r => r.ok).length, 3, 'exactly as many concurrent charges land as there are credits');
    eq(results.filter(r => !r.ok && r.error === 'insufficient_credits').length, 2, 'the racing losers are refused, not double-spent');
    eq((await Credits.state(uid)).balance, 0, 'the balance is exactly zero afterwards');
    const again = await Credits.charge(uid, { specHash: 'race6', reason: 'issue' });
    ok(again.ok === false && again.error === 'insufficient_credits', 'a later charge on the drained account is still refused');
    drop();
  }

  section('credits: concurrent first reads mint exactly one signup grant');
  {
    cleanEnv();
    const drop = useTempKV();
    const uid = 'dev:race2';
    await Promise.all([Credits.state(uid), Credits.state(uid), Credits.state(uid)]);
    eq((await Credits.state(uid)).balance, 1, 'the signup credit lands exactly once');
    const led = await Credits.ledgerFor(uid);
    eq(led.filter(e => e.type === 'grant' && e.reason === 'signup').length, 1, 'one signup grant on the ledger, not three');
    drop();
  }

  section('credits: the signup grant is capped per client IP (farming guard)');
  {
    cleanEnv();
    const drop = useTempKV();
    const farmIp = '203.0.113.9';
    for (let i = 0; i < Credits.SIGNUP_IP_CAP; i++) {
      const st = await Credits.state('dev:farm' + i, { ip: farmIp });
      eq(st.balance, 1, `signup grant ${i + 1} within the cap lands`);
    }
    const over = await Credits.state('dev:farm-over', { ip: farmIp });
    eq(over.balance, 0, 'the grant past the cap is refused');
    const led = await Credits.ledgerFor('dev:farm-over');
    ok(led.length === 1 && led[0].type === 'deny' && led[0].reason === 'signup_ip_capped',
      'the refusal is written to the ledger, never silent');
    eq((await Credits.state('dev:farm-over', { ip: '198.51.100.7' })).balance, 0,
      'a capped account stays at zero — the denial is per account, not per request');
    eq((await Credits.state('dev:farm-fresh', { ip: '198.51.100.7' })).balance, 1,
      'a different IP still gets the signup credit');
    eq((await Credits.state('dev:farm-noip')).balance, 1,
      'callers with no request context (webhooks, tests) are unaffected');
    await Credits.grant('dev:farm-over', 3, { reason: 'purchase', sourceId: 'cs_capped' });
    eq((await Credits.state('dev:farm-over')).balance, 3, 'a capped account can still buy credits');
    drop();
  }

  /* ---------------- the ledger is not user-writable ---------------- */
  section('store: credit/ledger/blueprint namespaces are reserved (never user-writable)');
  {
    cleanEnv();
    const drop = useTempKV();
    for (const doc of ['credits', 'creditbal', 'ledger', 'design:bp_1', 'designs:index', 'bphash:abc', 'artifact:abc', 'bpimg:abc']) {
      const res = fakeRes();
      await store(fakeReq('/api/store?doc=' + encodeURIComponent(doc), { headers: mkCookie('dev:evil'), method: 'PUT', body: { value: '{"balance":999}' } }), res);
      eq(res.statusCode, 400, `PUT ${doc} is refused`);
      const g = fakeRes();
      await store(fakeReq('/api/store?doc=' + encodeURIComponent(doc), { headers: mkCookie('dev:evil') }), g);
      eq(g.statusCode, 400, `GET ${doc} is refused`);
    }
    drop();
  }

  /* ---------------- AI metering demoted to an abuse ceiling ---------------- */
  section('chat: sign-in required; the monthly meter is an abuse ceiling, not the offer');
  {
    cleanEnv();
    const drop = useTempKV();
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    let res = fakeRes();
    await chat(fakeReq('/api/chat', { method: 'POST', body: { messages: [{ role: 'user', content: 'hi' }] } }), res);
    eq(res.statusCode, 401, 'anonymous chat is refused (AI is behind sign-in)');
    ok(json(res).error && json(res).error.type === 'auth_required', 'with a branchable error type');

    ok(E.FREE.aiMonthlyLimit >= 100, 'the free meter is an abuse ceiling (≥100/mo), no longer the 25-message offer');
    ok(!('premiumExports' in E.FREE) && !('advancedFeatures' in E.FREE), 'feature-flag purchase gates are gone from entitlements');

    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '{}' }], usage: { output_tokens: 5 } }) });
    res = fakeRes();
    await chat(fakeReq('/api/chat', { method: 'POST', headers: mkCookie('dev:chat1'), body: { messages: [{ role: 'user', content: 'hi' }] } }), res);
    globalThis.fetch = realFetch;
    eq(res.statusCode, 200, 'signed-in chat proxies upstream');
    const st = await E.statusFor('dev:chat1');
    eq(st.usage.aiMessages, 1, 'signed-in traffic is still metered per uid');
    ok(st.credits && typeof st.credits.balance === 'number', 'billing status now carries the credit balance');
    drop();
  }

  /* ---------------- purchase: packs via Stripe checkout ---------------- */
  section('billing: credit packs create payment-mode checkout sessions');
  {
    cleanEnv();
    const drop = useTempKV();
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_CREDIT_PACK_3_PRICE_ID = 'price_pack3';
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), body: init && init.body });
      if (String(url).includes('/v1/customers')) return { ok: true, status: 200, json: async () => ({ id: 'cus_9' }) };
      return { ok: true, status: 200, json: async () => ({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' }) };
    };
    const res = fakeRes();
    await billing(fakeReq('/api/billing?action=credits', { method: 'POST', headers: mkCookie('dev:buyer'), body: { pack: 3 } }), res);
    globalThis.fetch = realFetch;
    eq(res.statusCode, 200, 'pack checkout succeeds');
    ok(/checkout\.stripe\.test/.test(json(res).url), 'returns the redirect url');
    const co = calls.find(c => c.url.includes('/v1/checkout/sessions'));
    ok(co && /mode=payment/.test(co.body), 'one-time payment mode, not a subscription');
    ok(co && /metadata%5Bbb_credits%5D=3/.test(co.body), 'credit count rides the session metadata');
    ok(co && /metadata%5Bbb_uid%5D=dev%3Abuyer/.test(co.body), 'uid rides the session metadata');

    const bad = fakeRes();
    await billing(fakeReq('/api/billing?action=credits', { method: 'POST', headers: mkCookie('dev:buyer'), body: { pack: 7 } }), bad);
    eq(bad.statusCode, 400, 'unknown pack size is refused');
    drop();
  }

  section('webhook: a completed pack checkout credits the ledger exactly once');
  {
    cleanEnv();
    const drop = useTempKV();
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    const event = JSON.stringify({
      id: 'evt_1', type: 'checkout.session.completed',
      data: { object: { id: 'cs_pack_1', mode: 'payment', payment_status: 'paid', metadata: { bb_uid: 'dev:buyer2', bb_credits: '10' } } }
    });
    const deliver = async () => {
      const res = fakeRes();
      await webhook(fakeReq('/api/stripe-webhook', {
        method: 'POST', body: event,
        headers: { 'stripe-signature': signWebhook(event, 'whsec_test') }
      }), res);
      return res;
    };
    const first = await deliver();
    eq(first.statusCode, 200, 'webhook accepted');
    eq((await Credits.state('dev:buyer2')).balance, 11, 'signup + pack of 10');
    await deliver(); // Stripe redelivers — must not double-credit
    eq((await Credits.state('dev:buyer2')).balance, 11, 'replayed event never grants twice');
    const led = await Credits.ledgerFor('dev:buyer2');
    ok(led.filter(e => e.type === 'grant' && e.sourceId === 'cs_pack_1').length === 1, 'one ledger grant per checkout session');
    drop();
  }

  /* ---------------- Phase 5: public blueprint pages + lead capture ---------------- */
  section('blueprint: a share code renders a public, indexable, read-only page — free');
  {
    cleanEnv();
    const drop = useTempKV();
    const Pipeline = require('../api/_pipeline.js');
    const BB = Pipeline.load();
    const { spec } = Pipeline.evaluate(VALID_SPEC);
    const code = BB.Codec.toShareCode(spec);
    const res = fakeRes();
    await blueprint(fakeReq('/api/blueprint?share=' + encodeURIComponent(code)), res);
    eq(res.statusCode, 200, 'no session needed — viewing is free');
    ok(/text\/html/.test(res.headers['content-type']), 'renders as html');
    ok(res.body.includes('Credit Test Table'), 'page names the piece');
    ok(/<meta name="description"/.test(res.body), 'page carries a meta description (indexable)');
    ok(/Open this design in the studio/i.test(res.body), 'page carries the studio call to action');
    ok(!/Pilot|clearance hole|Dado/i.test(res.body), 'no buildable setout leaks into the free page');
    const led = await Credits.ledgerFor('dev:any');
    ok(!led.some(e => e.type === 'charge'), 'viewing a share page never charges anyone');
    const bad = fakeRes();
    await blueprint(fakeReq('/api/blueprint?share=BB4:notacode'), bad);
    eq(bad.statusCode, 404, 'a garbage code is a quiet 404');
    drop();
  }

  section('lead: the calculator and preview capture write down qualified intent');
  {
    cleanEnv();
    const drop = useTempKV();
    const lead = require('../api/lead.js');
    const KV = require('../api/_kv.js');
    let res = fakeRes();
    await lead(fakeReq('/api/lead', { method: 'POST', body: { email: 'not-an-email', kind: 'preview' } }), res);
    eq(res.statusCode, 400, 'a malformed email is refused');
    res = fakeRes();
    await lead(fakeReq('/api/lead', { method: 'POST', body: { email: 'maker@example.com', kind: 'calculator', context: '{"cost":193.9}' } }), res);
    eq(res.statusCode, 200, 'a real lead is stored');
    const stored = JSON.parse(await KV.backend().get('bb:leads'));
    ok(stored.length === 1 && stored[0].email === 'maker@example.com' && stored[0].kind === 'calculator', 'the lead landed with its context');
    // The leads list lives OUTSIDE every per-uid keyspace — /api/store can
    // never reach it (its keys are always bb:{uid}:{doc}).
    const g = fakeRes();
    await store(fakeReq('/api/store?doc=leads', { headers: mkCookie('dev:snoop') }), g);
    ok(g.statusCode === 200 && json(g).value === null, 'a user doc named "leads" reads their own empty key, never bb:leads');
    drop();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
})().catch(e => { console.error('credit tests crashed:', e); process.exitCode = 1; });
