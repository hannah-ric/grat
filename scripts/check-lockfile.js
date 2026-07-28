#!/usr/bin/env node
/* pnpm-lock.yaml must agree with package.json.
 *
 * WHY THIS EXISTS
 * `pnpm-lock.yaml` is committed (package-lock.json is deliberately not — see
 * .gitignore and the note in ci.yml). Vercel picks its package manager from
 * whichever lockfile it finds, so a committed pnpm lock means the deploy runs
 * `pnpm install --frozen-lockfile`, and frozen-lockfile refuses to install
 * when the lock does not match package.json:
 *
 *   ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with "frozen-lockfile"
 *     because pnpm-lock.yaml is not up to date with <ROOT>/package.json
 *   Error: Command "pnpm install" exited with 1
 *
 * That is a DEPLOY-time failure from a repo-hygiene mistake, and nothing in
 * the test suite or CI saw it coming: adding one devDependency (axe-core, for
 * the accessibility suite) broke production deploys while every check stayed
 * green, because no suite reads package.json and CI never installs with pnpm.
 * This check closes that gap at PR time, in the zero-install job, with no
 * dependencies and no package manager.
 *
 * WHAT IT CHECKS
 * The specifiers pnpm recorded for the root importer against the ones
 * package.json declares — the exact comparison frozen-lockfile makes when it
 * decides whether the lock is current. Transitive drift inside `packages:` is
 * NOT checked; that cannot be verified without resolving against the registry,
 * which is the whole point of not installing here.
 *
 * A parser that cannot fail is not a check: if the lockfile's shape is not the
 * one this understands, it exits non-zero and says so rather than quietly
 * reporting agreement it never established.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const LOCK = path.join(root, 'pnpm-lock.yaml');
const PKG = path.join(root, 'package.json');

const die = msg => { console.error('✗ ' + msg); process.exit(1); };

/* No pnpm lock: nothing claims to be current, so nothing can be stale. Vercel
 * then falls back to npm and honours vercel.json's installCommand. Said out
 * loud rather than passing in silence — a check that goes quiet when its
 * subject disappears is how a guard stops guarding without anyone noticing. */
if (!fs.existsSync(LOCK)) {
  console.log('· no pnpm-lock.yaml — nothing to verify (Vercel will use npm and vercel.json\'s installCommand)');
  process.exit(0);
}

const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
const declared = {};
for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
  for (const [name, spec] of Object.entries(pkg[field] || {})) declared[name] = String(spec);
}

/* pnpm's emitted layout, indentation-significant:
 *
 *   importers:
 *
 *     .:
 *       devDependencies:
 *         axe-core:
 *           specifier: ^4.12.1
 *           version: 4.12.1
 */
const lines = fs.readFileSync(LOCK, 'utf8').split(/\r?\n/);
const unquote = s => s.replace(/^['"]|['"]$/g, '');

const importersAt = lines.findIndex(l => /^importers:\s*$/.test(l));
if (importersAt < 0) die('pnpm-lock.yaml has no `importers:` block — this checker does not understand its shape. Update scripts/check-lockfile.js.');

let rootAt = -1;
for (let i = importersAt + 1; i < lines.length; i++) {
  if (/^\S/.test(lines[i])) break;                       // left the importers block
  if (/^ {2}\.:\s*$/.test(lines[i])) { rootAt = i; break; }
}
if (rootAt < 0) die('pnpm-lock.yaml has no root importer (`  .:`) — this checker does not understand its shape. Update scripts/check-lockfile.js.');

const locked = {};
let section = null, current = null;
for (let i = rootAt + 1; i < lines.length; i++) {
  const line = lines[i];
  if (!line.trim()) continue;
  const indent = line.match(/^ */)[0].length;
  if (indent <= 2) break;                                // next importer, or back to top level
  if (indent === 4) { const m = line.match(/^ {4}(\S+):\s*$/); section = m ? m[1] : null; current = null; continue; }
  if (indent === 6 && section) { const m = line.match(/^ {6}(\S+):\s*$/); current = m ? unquote(m[1]) : null; continue; }
  if (indent === 8 && current) { const m = line.match(/^ {8}specifier:\s*(.+?)\s*$/); if (m) locked[current] = unquote(m[1]); }
}

if (!Object.keys(locked).length && Object.keys(declared).length) {
  die('parsed no specifiers out of pnpm-lock.yaml while package.json declares ' + Object.keys(declared).length +
      ' — refusing to report agreement this checker never established. Update scripts/check-lockfile.js.');
}

const problems = [];
for (const [name, spec] of Object.entries(declared)) {
  if (!(name in locked)) problems.push(`"${name}": in package.json (${spec}), missing from the lockfile`);
  else if (locked[name] !== spec) problems.push(`"${name}": package.json says ${spec}, lockfile says ${locked[name]}`);
}
for (const name of Object.keys(locked)) {
  if (!(name in declared)) problems.push(`"${name}": in the lockfile, no longer in package.json`);
}

if (problems.length) {
  console.error('✗ pnpm-lock.yaml is out of date with package.json:\n');
  for (const p of problems) console.error('    ' + p);
  console.error('\n  Vercel deploys with `pnpm install --frozen-lockfile`, which will REFUSE this.');
  console.error('  Fix: pnpm install --lockfile-only   (then commit pnpm-lock.yaml)\n');
  process.exit(1);
}

const n = Object.keys(declared).length;
console.log(`· pnpm-lock.yaml agrees with package.json (${n} dependenc${n === 1 ? 'y' : 'ies'}: ${Object.keys(declared).sort().join(', ')})`);
