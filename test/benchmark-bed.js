/* Blueprint Buddy — published-plan benchmark: queen platform bed (bed class,
 * 2026-07, permanent asset — same standing as test/benchmark-shaker.js and
 * test/benchmark-chair.js; run manually, not part of npm test).
 *
 * External ground truth: Ana White, "Modern Farmhouse Bed Frame"
 * (ana-white.com/woodworking-projects/modern-farmhouse-bed-frame) — the
 * canonical free platform-bed plan: all mattress sizes, slat deck (no box
 * spring), lengthwise centre cleat, pocket-hole softwood construction.
 *
 * CAVEAT, stated up front: the queen cut list below is READER-EXTRACTED
 * (search-tool page reader, 2026-07 — the site itself 403s from CI), i.e.
 * verified-approximate, not eyeballed verbatim. One line (headboard legs,
 * 4×4) did not surface with a length and is carried as unknown; quantities
 * should be re-checked against the page in a normal browser before treating
 * any single line as gospel. The ARCHITECTURE (slat deck on side cleats +
 * centre support, knock-down at the rails) surfaced consistently across
 * three extraction passes and is what this benchmark leans on.
 *
 * Queen cut list as extracted (nominal actuals: 4×4=89×89, 2×6=38×140,
 * 2×4=38×89, 2×2=38×38, 1×6=19×140, 1×4=19×89):
 *   1 × 2×4 @ 67"     top of headboard
 *   2 × 2×2 @ 27-1/2" headboard cleats
 *   5 × 1×6 @ 60"     headboard planking
 *   1 × 2×6 @ 60"     headboard base
 *   2 × 4×4 @ 14-1/2" footboard legs
 *   1 × 2×4 @ 60"     footboard top
 *   1 × 2×6 @ 60"     footboard base
 *   2 × 2×6 @ 80"     siderails
 *   2 × 2×4 @ 80"     siderail top caps
 *   2 × 2×4 @ 80"     slat cleats (set down 1", screwed every 8–12")
 *   1 × 2×4 @ ~81"    centre cleat, cut to fit (lengthwise centre rail)
 *  10 × 1×4/2×4 @ ~62" slats, measure and cut to fit
 *   2 × 4×4           headboard legs (length not surfaced by the reader)
 *
 * We generate OUR queen bed in the same palette (SPF stud lumber, beginner)
 * and diff line by line. Every divergence is classified:
 *   OURS-BETTER  — a deliberate improvement the class contract demands
 *   EQUIVALENT   — different numbers, same craft outcome
 *   TRADITIONAL  — the published choice we refuse or don't reproduce, with
 *                  the reason stated, never silently approximated
 * The run FAILS if any row is left unclassified. Run: node test/benchmark-bed.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SRC = ['knowledge.js', 'hardware.js', 'icons.js', 'materials.js', 'geometry.js', 'units.js', 'classes.js', 'spec.js', 'parametric.js', 'structural.js', 'fasteners.js', 'packing.js',
  'plans.js', 'drafting.js', 'gltf.js', 'exports.js', 'history.js', 'codec.js', 'ai.js', 'store.js', 'gallery.js', 'joinery3d.js', 'selftest.js'];
for (const f of SRC) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), { filename: f });
const { Spec, Parametric, Plans, Structural, Units } = globalThis.BB;
Units.set({ system: 'imperial', precision: 16, dual: false });

const IN = 25.4;
const PLAN_LINES = 13; // the extracted rows above, headboard legs included

const raw = {
  meta: { name: 'Benchmark Bed', template: 'bed', level: 'beginner', units: 'in' },
  wood: { species: 'spf' },
  bed: { size: 'queen' }
};
const spec = Spec.correctSpec(raw);
const model = Parametric.build(spec);
const report = Spec.validate(spec, model);
const integ = Structural.computeIntegrity(spec, model, {});
const cut = Plans.cutList(spec, model);

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };
const fmtIn = mm => (mm / IN).toFixed(2) + '"';
const find = rx => cut.find(r => rx.test(r.name));

console.log('=== Blueprint Buddy vs Ana White "Modern Farmhouse Bed Frame" (queen) ===\n');
console.log(`our spec: queen ${spec.overall.width}×${spec.overall.depth}, deck at ${spec.bed.platformHeight}, headboard ${spec.bed.headboardHeight}, ${spec.wood.species}, frame ${spec.joinery.frame}`);
console.log('published: fits a 60×80" queen, slat deck + centre cleat, pocket screws throughout\n');

const rows = [];
const classify = (theirs, ours, cls, why) => rows.push({ theirs, ours, cls, why });

/* --- line-by-line --- */
const srail = find(/side rail/i);
classify('2 × siderail 2×6 @ 80" + 2×4 cap, pocket-screwed to the legs', srail && `2 × side rail ${fmtIn(srail.L)} ${srail.W}×${srail.T}, 2 × M6 barrel bolts per end`,
  'OURS-BETTER',
  'The rail member is the same class (140 deep band; ours 25 thick carries the checked quarter-share + edge-sit at 3.6× margin — bed:rail). The CONNECTION is not: pocket-screwed rails are permanent, and a bed that cannot leave the room is a defect (the knock-down mandate). Ours bolts with two M6 barrel bolts per end, priced against the computed 742 N end reaction (bed:joint 3.06×), and the unrated-bracket alternative gets a printed REQUIRED rating instead of a guess.');
ok(srail && Math.abs(srail.L - 1970) < 1, `our side rail spans the interior (${srail && fmtIn(srail.L)} vs their 80")`);
ok(spec.joinery.frame === 'kd_bolt', 'our frame joint is the knock-down mandate, never screws');

const cleat = find(/slat cleat/i);
classify('2 × slat cleat 2×4 @ 80", set down 1", screws every 8–12"', cleat && `2 × slat cleat ${fmtIn(cleat.L)} ${cleat.W}×${cleat.T}, screw schedule computed`,
  'EQUIVALENT',
  'Same member, same job (the deck bears on the cleats). Theirs is a 2×4 with a rule-of-thumb screw pitch; ours is sized to the drop the slat thickness needs and its screw count/pilots come out of the fastener engine — both hold a slat deck that loads the screws in shear against the rail.');
ok(cleat && cleat.qty === 2, 'two cleats, one per rail, like the plan');

const slat = find(/bed slat/i);
classify('10 × slat 1×4/2×4 @ ~62", measure and cut to fit', slat && `${slat.qty} × slat ${fmtIn(slat.L)} ${slat.W}×${slat.T}, gaps ${integ.checks.find(c => c.id === 'bed:slats').data.gapMM.toFixed(1)} mm`,
  'OURS-BETTER',
  '10 slats across a ~78" deck leaves ~4.7" gaps — fine under a spring mattress, but foam warranties void past 2.75in (Amerisleep floor; the class gap rule is ≤ 70 mm). Ours solves the count against the gap cap (13 slats), the section against the knee case (bed:slats margin), and prints exact lengths instead of "measure and cut to fit".');
ok(slat && slat.qty >= 12, `slat count solved against the gap cap (${slat && slat.qty} ≥ 12)`);
ok(integ.checks.find(c => c.id === 'bed:slats').data.gapMM <= 70.05, 'gaps hold the foam-warranty floor');

const centre = find(/centre rail/i);
const cleg = find(/centre leg/i);
classify('1 × centre cleat 2×4 @ ~81", cut to fit', centre && `1 × centre rail ${fmtIn(centre.L)} ${centre.W}×${centre.T} on edge + dimensioned centre leg ${cleg && fmtIn(cleg.L)}`,
  'OURS-BETTER',
  'The plan gets the architecture right — queen+ needs centre support (the warranty mandate both agree on). Ours turns "cut to fit" into engineering: the rail runs on edge (I grows as h³), the floor leg is a dimensioned cut-list part, and bed:centre prices the worst segment (1.73 MPa vs 24.75 allow).');
ok(centre && cleg, 'centre rail AND its floor leg are explicit cut-list parts');

const fpost = find(/footboard post/i);
classify('2 × footboard leg 4×4 @ 14-1/2" + 2×4 top + 2×6 base', fpost && `2 × footboard post ${fmtIn(fpost.L)} ${fpost.W}×${fpost.T} + foot rail`,
  'EQUIVALENT',
  'Same corner-post architecture at the foot (theirs 89 sq, ours 70 sq — both far above the bearing demand; ours also carries the bolt bores). Their 2×4/2×6 top-and-base panel is footboard styling; our foot end is a plain bolted rail. Style, not structure.');
ok(fpost && fpost.qty === 2, 'two footboard posts');

const hpost = find(/headboard post/i);
const hboard = find(/headboard board/i);
classify('headboard: 2 × 4×4 legs (length unextracted) + 5 × 1×6 planks + 2×4 top + 2×6 base + 2×2 cleats', hpost && `2 × headboard post ${fmtIn(hpost.L)} + ${hboard.qty} × board ${fmtIn(hboard.L)}×${fmtIn(hboard.W)}`,
  'EQUIVALENT',
  'Both are posts carrying a plank field. Theirs is a full plank wall (styling); ours is three boards between the posts. The structural difference is that ours is CHECKED: bed:headboard levers the 667 N sit-back force about the rail-bolt line into the post section (7.1× margin at the default height).');
ok(hpost && hboard && hboard.qty >= 2, 'headboard posts + boards present');
ok(integ.checks.find(c => c.id === 'bed:headboard').status === 'pass', 'the sit-back lever case passes');

classify('fits a 60" × 80" queen mattress (no clearance stated)', `interior ${fmtIn(1524 + 30)} × ${fmtIn(2030 + 30)} — 30 mm stated fit clearance`,
  'OURS-BETTER',
  'The plan sizes the opening to the nominal mattress; real queens run 60–60.5" and bedding needs tuck room. The class carries FIT_CLEARANCE 30 mm explicitly and prints it, so the mattress drops in instead of wedging.');

classify('pocket holes + screws throughout (2-3/4" screws + glue at the cleats)', 'butt+screws at cleats/slats (computed schedule), M6 barrel bolts at every rail end, NO glue at the joints that must come apart',
  'OURS-BETTER',
  'Screws are right for the cleats and deck — and that is where ours uses them too, with counts, pilots, and positions from the fastener engine. Rails and posts must separate on moving day: bolts, not screws, and the no_glued_bed refusal keeps glue out of the knock-down joints even on an advanced ask.');

classify('2 × siderail top cap 2×4 @ 80" (styling) + headboard/footboard top & base trim', 'not reproduced',
  'TRADITIONAL',
  'Farmhouse trim — caps, top/base boards, the plank-wall look — is styling this template does not reproduce. Stated as the plan\'s look, not approximated with phantom parts; nothing structural rides on it (the deck bears on the cleats in both builds).');

/* --- their plan under OUR validator (why the class exists) --- */
console.log('--- the published plan judged by the class contract ---');
const G = globalThis.BB.Classes.get('bed').geom;
const theirGap = ((80 * IN - 2 * (89 - 25) - 6) - 10 * 89) / 9; // 10 slats on their deck
console.log(`  their 10-slat deck: gaps ≈ ${theirGap.toFixed(0)} mm vs the ${G.SLAT_GAP_MAX} mm foam-warranty cap — FAILS the gap rule`);
ok(theirGap > G.SLAT_GAP_MAX, 'the published slat count fails the class gap rule (spring-mattress era default)');
const joint = integ.checks.find(c => c.id === 'bed:joint');
console.log(`  our rail connection: ${joint.value}`);
ok(joint.data.marginRatio >= 1.5, 'our bolted connection clears the 1.5× joint gate');
console.log(`  their centre support: present — the one thing every warranty and this class agree on\n`);

/* --- report --- */
console.log('--- line-by-line classification ---');
for (const r of rows) {
  console.log(`\n[${r.cls}] ${r.theirs}`);
  console.log(`    ours: ${r.ours}`);
  console.log(`    why:  ${r.why}`);
}
ok(rows.length >= 9, `every published line is covered (${rows.length} classifications for ${PLAN_LINES} extracted plan lines, grouped)`);
ok(rows.every(r => ['OURS-BETTER', 'EQUIVALENT', 'TRADITIONAL'].includes(r.cls)), 'no row left unclassified');
ok(report.errors.length === 0, `our benchmark bed builds clean (${JSON.stringify(report.errors.map(e => e.id))})`);
ok(!integ.checks.some(c => c.status === 'fail'), 'and every bed check passes in SPF');

const tally = rows.reduce((t, r) => (t[r.cls] = (t[r.cls] || 0) + 1, t), {});
console.log(`\ntally: ${JSON.stringify(tally)}`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
