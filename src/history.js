/* Blueprint Buddy — revision history.
 * Immutable snapshots of the corrected spec. One stack shared by AI edits and
 * manual inspector edits. Nothing is ever truncated: undo/redo move a pointer,
 * new edits and restores append, so redo history is never silently destroyed.
 */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';
  const S = () => BB.Spec;

  function createHistory(initialSpec, source) {
    const h = {
      snapshots: [],
      index: -1,

      current() { return this.snapshots[this.index] || null; },
      currentSpec() { const c = this.current(); return c ? S().clone(c.spec) : null; },

      push(spec, src, summary) {
        const prev = this.current();
        const diffs = prev ? S().diffSpecs(prev.spec, spec) : [];
        const snap = {
          id: this.snapshots.length,
          ts: Date.now(),
          source: src || 'manual',
          spec: Object.freeze(S().clone(spec)),
          summary: summary || (prev
            ? (diffs.length ? S().describeDiff(diffs, spec.meta.units) : ['no dimensional change'])
            : ['initial design']),
          diffs
        };
        this.snapshots.push(snap);
        this.index = this.snapshots.length - 1;
        return snap;
      },

      canUndo() { return this.index > 0; },
      canRedo() { return this.index < this.snapshots.length - 1; },
      undo() { if (this.canUndo()) this.index--; return this.currentSpec(); },
      redo() { if (this.canRedo()) this.index++; return this.currentSpec(); },

      /* Restore appends a fresh snapshot of the old state — the timeline keeps
       * everything that ever existed. */
      restore(snapshotId) {
        const snap = this.snapshots.find(s => s.id === snapshotId);
        if (!snap) return null;
        this.push(S().clone(snap.spec), 'restore', ['restored “' + this.label(snap) + '”']);
        return this.currentSpec();
      },

      label(snap) {
        const d = new Date(snap.ts);
        return `#${snap.id + 1} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      },

      compare(idA, idB) {
        const a = this.snapshots.find(s => s.id === idA);
        const b = this.snapshots.find(s => s.id === idB);
        if (!a || !b) return null;
        const diffs = S().diffSpecs(a.spec, b.spec);
        return { a, b, diffs, rows: S().describeDiff(diffs, b.spec.meta.units) };
      }
    };
    if (initialSpec) h.push(initialSpec, source || 'manual', ['initial design']);
    return h;
  }

  BB.History = { createHistory };
})();
