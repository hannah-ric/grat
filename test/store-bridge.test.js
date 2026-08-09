/* Blueprint Buddy — iOS native store bridge contract.
 * The iPhone shell (ios/App/WebViewController.swift) injects a window.storage
 * implementation over a WKScriptMessageHandlerWithReply message handler;
 * store.js then treats native app-container files as its TOP driver rung
 * (the 'artifact' slot). This suite extracts the injected bootstrap VERBATIM
 * from the Swift source and runs it against the real src/store.js, so the
 * JS↔Swift contract cannot drift silently in either file.
 * Plain Node, zero deps, no network. Run: node test/store-bridge.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function section(name) { console.log('· ' + name); }

/* ---- extract the bootstrap scripts from the Swift source, verbatim ---- */
section('bootstrap extraction from WebViewController.swift');
const swift = fs.readFileSync(path.join(__dirname, '../ios/App/WebViewController.swift'), 'utf8');
// Swift strips the closing delimiter's indentation from every line of a
// multiline literal — replicate that to get the exact runtime script.
function swiftLiteral(name) {
  const m = swift.match(new RegExp(name + ' = """\\n([\\s\\S]*?)\\n(\\s*)"""'));
  if (!m) return null;
  const indent = m[2];
  return m[1].split('\n').map(l => (l.startsWith(indent) ? l.slice(indent.length) : l)).join('\n');
}
const storagePart = swiftLiteral('storageBootstrapJS');
const printPart = swiftLiteral('printBootstrapJS');
ok(!!storagePart, 'WebViewController.swift contains the storageBootstrapJS literal');
ok(!!printPart, 'WebViewController.swift contains the printBootstrapJS literal');
if (!storagePart || !printPart) { console.error(`${pass} passed, ${fail} failed`); process.exit(1); }
// Offline mode injects both scripts — run them exactly as the shell does.
const bootstrap = storagePart + '\n' + printPart;
ok(bootstrap.includes('window.storage'), 'bootstrap installs window.storage');

/* ---- fake the native side with StoreBridge semantics ----
 * get → stored string, or null (NSNull) when absent; set → true; del → true;
 * failures reject the promise. Replies are asynchronous, like the bridge. */
const files = new Map(); // what StoreBridge persists: opaque strings by key
const printed = [];
let failNextGet = false;
global.window = globalThis; // store.js and the bootstrap expect a window
window.webkit = {
  messageHandlers: {
    bbStore: {
      postMessage(msg) {
        return new Promise((resolve, reject) => setImmediate(() => {
          if (msg.op === 'get') {
            if (failNextGet) { failNextGet = false; return reject(new Error('bridge down')); }
            resolve(files.has(msg.key) ? files.get(msg.key) : null);
          } else if (msg.op === 'set') {
            if (typeof msg.value !== 'string') return reject(new Error('set without value'));
            files.set(msg.key, msg.value); resolve(true);
          } else if (msg.op === 'del') {
            files.delete(msg.key); resolve(true);
          } else reject(new Error('unknown op: ' + msg.op));
        }));
      }
    },
    bbPrint: { postMessage(v) { printed.push(v); } }
  }
};

vm.runInThisContext(bootstrap, { filename: 'ios-bootstrap.js' });
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../src/store.js'), 'utf8'), { filename: 'store.js' });
const Store = BB.Store;

(async () => {
  section('driver chain recognizes the native rung');
  ok(Store.hasStorage(), 'window.storage passes the hasStorage() probe');
  eq(Store.persistenceMode(), 'artifact', 'native rung occupies the top (artifact) slot');
  const auth = await Store.init({ timeoutMs: 1 });
  ok(!auth.user && !auth.cloud, 'init() returns signed-out state without needing a network');

  section('set/get/del round-trip through the native store');
  const spec = { t: 'table', name: 'Curly “maple” désk', w: 1200.5, deep: { arr: [1, 2, 3], ok: true } };
  ok(await Store.set('project:bridge-test', spec) === true, 'set resolves true');
  eq(await Store.get('project:bridge-test'), spec, 'get returns the exact object (unicode intact)');
  ok(files.has('project:bridge-test'), 'the value landed in the NATIVE store, not only a JS-side mirror');
  eq(JSON.parse(files.get('project:bridge-test')), spec, 'native side holds the JSON-stringified value');
  eq(await Store.get('project:absent'), null, 'an absent key is authoritatively null');
  await Store.del('project:bridge-test');
  ok(!files.has('project:bridge-test'), 'del removes the native document');
  eq(await Store.get('project:bridge-test'), null, 'a deleted key reads null');

  section('large values survive (project docs run big; the cap is 5 MB per key)');
  const big = { blob: 'x'.repeat(400 * 1024) };
  ok(await Store.set('project:big', big) === true, 'a 400 KB set resolves');
  const back = await Store.get('project:big');
  ok(!!back && back.blob.length === big.blob.length, 'a 400 KB get round-trips intact');

  section('a rejecting bridge degrades per call instead of breaking the app');
  await Store.set('prefs:v2', { units: { system: 'imperial' } });
  failNextGet = true;
  const prefs = await Store.get('prefs:v2'); // native get rejects → memory mirror answers
  eq(prefs, { units: { system: 'imperial' } }, 'get falls through to the session mirror on bridge failure');
  ok(Store.hasStorage(), 'the rung stays available for the next call');

  section('window.print reroutes to the native print bridge');
  ok(typeof window.print === 'function', 'bootstrap installed window.print');
  window.print();
  eq(printed.length, 1, 'print() posts one message to bbPrint');

  console.log(`store-bridge: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
