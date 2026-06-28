/**
 * No-false-drop / no-dup-add harness — the LAST identity gate before N-way real
 * writes can be armed (parachord#911 P3, mobile#289 audit action #5).
 *
 * Drives the audit's identity-collision D-pairs through the real pure pipeline:
 *   - computeMaterializeDiff (unify-together add/remove diff — Layer B), and
 *   - computeNwayPropagationPlan (merge + total-wipe guard — Layer A).
 *
 * Beyond asserting each scenario's `expect`, the runner INDEPENDENTLY enforces
 * the two governing invariants on every materialize case, so it proves the gate
 * rather than echoing the function:
 *   (1) NO-FALSE-DROP — no removeKey is the unified key of a canonical track;
 *   (2) NO-DUP-ADD    — no addKey is already a unified key present on the remote,
 *                       and applying the adds leaves the remote key-set duplicate-free
 *                       w.r.t. the newly-added keys.
 *
 * Scenarios live in the shared fixture tests/fixtures/nway-merge/
 * no-false-drop-scenarios.json (proposed as the cross-engine contract on
 * mobile#289 — the Kotlin harness must run the same file to identical results).
 */

const fs = require('fs');
const path = require('path');
const { computeMaterializeDiff } = require('../../sync-engine/playlist-materialize');
const { computeNwayPropagationPlan } = require('../../sync-engine/playlist-reconcile');

const SCEN = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'nway-merge', 'no-false-drop-scenarios.json'), 'utf8')
);

describe('no-false-drop harness — materialize diff (identity collisions)', () => {
  test('fixture carries both scenario groups', () => {
    expect(Array.isArray(SCEN.materialize)).toBe(true);
    expect(Array.isArray(SCEN.propagation)).toBe(true);
    expect(SCEN.materialize.length).toBeGreaterThanOrEqual(6);
  });

  for (const s of SCEN.materialize) {
    test(`${s.name}`, () => {
      const diff = computeMaterializeDiff(s.canonical, s.remote);

      // 1. Matches the pinned cross-engine expectation.
      expect({
        addKeys: diff.addKeys,
        removeKeys: diff.removeKeys,
        reorderNeeded: diff.reorderNeeded,
      }).toEqual(s.expect);

      // 2. INVARIANT — no-false-drop: a canonical track's unified key is never
      //    in removeKeys (canonicalKeys/remoteKeys come from the SAME joint
      //    unification, so this is the real identity check, not a re-derivation).
      const canonicalKeySet = new Set(diff.canonicalKeys);
      for (const rk of diff.removeKeys) {
        expect(canonicalKeySet.has(rk)).toBe(false);
      }

      // 3. INVARIANT — no-dup-add: an addKey is never already on the remote,
      //    and the post-apply remote key multiset gains no duplicate key.
      const remoteKeySet = new Set(diff.remoteKeys);
      for (const ak of diff.addKeys) {
        expect(remoteKeySet.has(ak)).toBe(false);
      }
      const afterApply = diff.remoteKeys
        .filter((k) => !diff.removeKeys.includes(k))
        .concat(diff.addKeys);
      // adds are distinct and disjoint from the surviving remote keys → no new dup.
      expect(new Set(afterApply).size).toBe(afterApply.length);
    });
  }
});

describe('no-false-drop harness — propagation plan (total-wipe guard)', () => {
  for (const s of SCEN.propagation) {
    test(`${s.name}`, () => {
      const plan = computeNwayPropagationPlan(s.baselineRepr, s.copies);
      expect(plan).toEqual(s.expect);
      // INVARIANT — an empty merge against a non-empty baseline must abort
      // (never silently wipe a mirror on a partial/throttled fetch).
      if (plan && plan.merged.length === 0 && s.baselineRepr.length > 0) {
        expect(plan.massChangeAbort).toBe(true);
      }
    });
  }
});
