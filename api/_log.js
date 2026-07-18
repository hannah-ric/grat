/* Blueprint Buddy — minimal structured error reporter (zero dependency).
 *
 * Files starting with "_" are libraries, not deployed Vercel functions. The
 * api/ handlers had no logging outside cold-start, so a swallowed webhook 400,
 * a KV outage, or a failed AI-meter increment left no trace in the Function
 * logs (E-08). This emits ONE machine-parseable line per failure to stderr:
 *
 *   {"ts":"2026-07-18T…","scope":"store","event":"kv_error","detail":"…"}
 *
 * No external service, no buffering, no dependency. It must never throw — a
 * reporter that crashes the catch block it lives in is worse than silence.
 */
'use strict';

function report(scope, event, detail) {
  let d = null;
  if (detail instanceof Error) d = detail.message;
  else if (detail !== undefined && detail !== null) {
    try { d = typeof detail === 'string' ? detail : JSON.stringify(detail); }
    catch (e) { d = String(detail); }
  }
  try {
    console.error(JSON.stringify({ ts: new Date().toISOString(), scope, event, detail: d }));
  } catch (e) { /* logging must never throw */ }
}

module.exports = { report };
