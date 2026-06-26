// N-way reconcile — Layer A (parachord#911, Step 2 / PR-4a).
//
// Design: docs/plans/2026-06-21-nway-multimaster-playlist-sync-design.md +
// 2026-06-23-incremental-materialization-design.md (parachord-mobile). Kotlin
// reference: SyncEngine.runNwayPropagation + NwayMaterializeTest.
//
// THE GOVERNING INVARIANT (every line here serves it):
//   Propagation must NEVER drop a track present in — or identity-matching a
//   track in — any copy. A removal requires POSITIVE evidence that a copy
//   deliberately deleted it. Absence from a fetch (identity mismatch, partial
//   coverage, stale ancestor, throttled request, catalog gap) is NOT a
//   deletion.
//
// Layer A (this module) decides WHAT the merged truth is and WHICH mirrors
// lag; Layer B (playlist-materialize.js) writes one mirror non-destructively.
// This module is PURE + injected: providers, the hydration coordinator, the
// negative cache, the change-detection metadata, and all write-back EFFECTS
// are passed in. The Group-4 harness drives it with in-memory fakes; PR-4b
// wires the same function into main.js's sync path behind the shadow flag with
// electron-store-backed effects + token-bound real providers. Nothing here
// reads electron or performs a fetch except through an injected provider.

const { mergePlaylist, canonicalTrackKey } = require('./playlist-merge');
const { unifyTrackKeys, trackTiers } = require('./playlist-key-unify');
const { computeMaterializeDiff, materializeToProvider } = require('./playlist-materialize');
const { buildBaselineTiers } = require('./playlist-sync-state');

// ── small set helpers ───────────────────────────────────────────────
function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function setEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
function distinct(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

/**
 * Is a baseline key that a CHANGED provider copy is missing a PENDING add
 * (protect — never read its absence as a deletion) or a genuine deletion?
 *
 * The negative cache is the only evidence: no entry, or an entry with a null
 * resolvedId, means the track was never successfully materialized onto this
 * provider (catalog gap / un-hydratable) → its absence is pending, NOT a
 * delete. A non-null resolvedId means it genuinely landed there once and is
 * gone now → a real deletion. A missing track object is treated as pending
 * (defensive — we'd rather over-protect than risk a false drop).
 *
 * KNOWN SHARED-DESIGN LIMITATION (parachord#911 — DO NOT patch desktop-only).
 * A non-null resolvedId proves the track was materialized ONCE, not that the
 * provider DELETED it. If an already-materialized track is transiently absent
 * from an otherwise-complete fetch (region-restricted/unavailable track
 * silently filtered, a single paging glitch the trackCount floor can't catch
 * because the count still matches), this reads its absence as a real deletion.
 * The robust fix is a `missingStreak >= 2 consecutive complete fetches` /
 * `lastSeenAt` gate before escalating to a deletion — but this rule is
 * BYTE-SHARED with the Kotlin engine (SyncEngine.runNwayPropagation /
 * NwayMaterializeTest) and the shared fixtures, so per CLAUDE.md's cross-engine
 * parity contract it must change in LOCKSTEP on both engines with a shared
 * fixture. Flagged to the human; tracked for a coordinated change before
 * `nway_propagate` is ever armed. Surfaced by the PR-4a adversarial review.
 */
// Number of CONSECUTIVE complete-fetch omissions before a materialized track's
// absence escalates from "transient" to "real deletion".
const MISSING_STREAK_THRESHOLD = 2;

function isProviderPendingForKey(cache, providerId, reprKey, keyToTrack) {
  const track = keyToTrack[reprKey];
  if (!track) return true; // defensive: protect
  const cacheKey = canonicalTrackKey(track);
  const entry = cache.select(cacheKey, providerId);
  if (!entry || !entry.resolvedId) return true; // never materialized → pending
  // Materialized: still PENDING (protected) until it has been omitted from the
  // provider's complete fetch for MISSING_STREAK_THRESHOLD consecutive cycles.
  return (entry.missingStreak || 0) < MISSING_STREAK_THRESHOLD;
}

// True when a materialized track's absence has cleared the missingStreak gate
// (>= threshold consecutive complete-fetch omissions) — i.e. its absence is now
// genuine deletion evidence. Used by the authoritative-source path.
function streakEscalated(cache, providerId, reprKey, keyToTrack) {
  const track = keyToTrack[reprKey];
  if (!track) return false; // can't key it → don't escalate (protect)
  const entry = cache.select(canonicalTrackKey(track), providerId);
  if (!entry || !entry.resolvedId) return false; // never materialized → not a deletion
  return (entry.missingStreak || 0) >= MISSING_STREAK_THRESHOLD;
}

/**
 * The merge + total-wipe guard (A7). Only CHANGED copies contribute a delta.
 * Writability does NOT filter the merge — a read-only upstream source still
 * contributes its truth; writability only gates WHERE we push (A9). The guard
 * is TOTAL-WIPE-ONLY (merged empty while the baseline wasn't): a large
 * non-empty drop (even 75%) is a legitimate user edit and is allowed — the
 * exact behavior NwayMaterializeTest #7 pins.
 * @returns {{merged:string[], massChangeAbort:boolean}|null} null = nothing changed
 */
function computeNwayPropagationPlan(baselineRepr, augmentedCopies) {
  const changed = augmentedCopies.filter((c) => c.changed && !arraysEqual(c.keys, baselineRepr));
  if (changed.length === 0) return null;
  const merged = mergePlaylist(
    baselineRepr,
    changed.map((c) => ({ id: c.id, tracks: c.keys, editedAt: c.editedAt }))
  );
  const massChangeAbort = merged.length === 0 && baselineRepr.length > 0;
  return { merged, massChangeAbort };
}

/**
 * Reconcile one local playlist across its mirrors for one cycle.
 *
 * @param {object} ctx
 * @param {object}   ctx.baseline       - { localPlaylistId, tracks: tierRecords[], baselineSyncedAt }
 * @param {object}   ctx.playlist       - { tracks: track[], locallyModified, lastModified, writable?, sourceUrl? }
 * @param {Object<string,string>} ctx.mirrors    - { providerId -> externalId }
 * @param {object[]} ctx.providers      - token-bound/Fake providers ({id, capabilities, nativeIdOf, fetchPlaylistTracks, …})
 * @param {object}   ctx.remoteLists    - { providerId -> { externalId -> { snapshotId?, trackCount? } } } (this cycle's fetch metadata)
 * @param {object}   ctx.storedTokens   - { providerId -> { changeToken, editedAt? } }
 * @param {object|null} ctx.pullSource  - { providerId, externalId } | null
 * @param {object}   ctx.coordinator    - createHydrationCoordinator() instance
 * @param {object}   ctx.cache          - createHydrationCache() instance
 * @param {number}   ctx.now            - epoch ms
 * @param {boolean}  ctx.dryRun         - shadow mode: compute + report, no writes
 * @param {object}   ctx.effects        - { replaceAllLocalTracks, setProviderToken, removeSyncLink, removeProviderState, setBaseline, clearLocallyModified }
 * @param {object}   [ctx.log]          - { info, warn } (defaults to console)
 * @returns {Promise<object|null>} a result entry, or null for a pure no-op
 */
async function reconcilePlaylist(ctx) {
  const {
    baseline, playlist, mirrors, providers, remoteLists, storedTokens,
    pullSource, coordinator, cache, now, dryRun, effects,
  } = ctx;
  const log = ctx.log || console;

  // A0 — preconditions
  if (!baseline || !playlist) return null;
  const localId = baseline.localPlaylistId;
  if (!localId) return null;
  const mirrorMap = mirrors && typeof mirrors === 'object' ? mirrors : {};
  if (Object.keys(mirrorMap).length === 0) return null;
  const baselineTiers = Array.isArray(baseline.tracks) ? baseline.tracks : [];

  const providerById = {};
  for (const p of providers || []) providerById[p.id] = p;

  // A1 — build copy inputs (LOCAL always; each mirror by change-detection).
  const inputs = [];

  const localTracks = Array.isArray(playlist.tracks) ? playlist.tracks : [];
  const localChanged =
    !!playlist.locallyModified || (playlist.lastModified || 0) > (baseline.baselineSyncedAt || 0);
  inputs.push({
    id: 'local',
    tracks: localTracks,
    keys: localTracks.map(trackTiers),
    editedAt: playlist.lastModified || 0,
    changed: localChanged,
  });

  for (const [providerId, externalId] of Object.entries(mirrorMap)) {
    const provider = providerById[providerId];
    if (!provider) continue;
    const listEntry = remoteLists && remoteLists[providerId] ? remoteLists[providerId][externalId] : null;
    const storedToken = storedTokens && storedTokens[providerId] ? storedTokens[providerId].changeToken : undefined;
    const editedAt = storedTokens && storedTokens[providerId] ? storedTokens[providerId].editedAt || 0 : 0;

    // Change-detection — DELIBERATELY snapshot-OR-trackCount (a safety-only
    // strengthening over the reference's snapshot-XOR-trackCount ternary): a
    // provider that lagged behind a baseline advanced past it (an add that was
    // pending last cycle) has a matching snapshot but a SHORT trackCount, and
    // must be re-fetched so the now-hydratable add finally lands. Re-fetching
    // more often only ever re-runs the non-destructive materialize — it can
    // never cause a drop — so erring toward "changed" is the no-false-drop
    // safe direction. (Drives NwayMaterializeTest #2 incremental convergence.)
    let changed;
    if (listEntry == null) {
      changed = false;
    } else {
      const snapMismatch = listEntry.snapshotId != null && listEntry.snapshotId !== storedToken;
      const countMismatch = listEntry.trackCount != null && listEntry.trackCount !== baselineTiers.length;
      changed = snapMismatch || countMismatch;
    }

    if (!changed) {
      // Reuse baseline tiers (NO fetch) — contributes no delta, but its keys
      // still let A9 detect it as lagging if the merge moved.
      inputs.push({ id: providerId, tracks: [], keys: baselineTiers, editedAt, changed: false });
      continue;
    }

    const fetched = await provider.fetchPlaylistTracks(externalId);
    const tracks = Array.isArray(fetched) ? fetched : [];
    // PARTIAL-FETCH FLOOR — the no-false-drop guard the empty-mirror rule is
    // only the collapse-to-zero SUBSET of. A changed mirror whose fetch
    // returned FEWER rows than the provider's own reported trackCount was
    // TRUNCATED (pagination cut-off, a throttled later page, a transient 200
    // with a short body) — that is NOT a deletion. A truncated copy diffed as
    // truth would union-remove the missing tracks from the HEALTHY mirrors
    // (reproduced: a 3-of-5 Spotify fetch actively removed 2 tracks from the
    // ListenBrainz mirror). So a SHORT fetch (length 0, OR length < the honest
    // trackCount) degrades to the same fill/lag shape: changed:false
    // (contributes NO delete delta) with keys:[] (so A9 still treats it as
    // lagging and RE-PUSHES the merge to it). Strict `<` so a legitimate ADD
    // that GROWS the list past baseline still flows through as a real change.
    // Applied to EVERY changed mirror — including the authoritative pull-source
    // — so a truncated source cannot manufacture an authoritative deletion (A4).
    // CALLER CONTRACT (PR-4b adapters): trackCount must come from an
    // authoritative count NOT subject to the same truncation as the page fetch
    // (Spotify `tracks.total`; LB/AM full list length, or a complete-or-throw
    // fetch). A count derived from the truncated body would defeat this floor.
    const expectedCount =
      listEntry && typeof listEntry.trackCount === 'number' ? listEntry.trackCount : null;
    const incomplete = tracks.length === 0 || (expectedCount != null && tracks.length < expectedCount);
    if (incomplete && baselineTiers.length > 0) {
      if (tracks.length > 0) {
        log.warn('[nway-reconcile] partial fetch — treating as fill target, NOT delete', {
          localId, providerId, got: tracks.length, expected: expectedCount,
        });
      }
      inputs.push({ id: providerId, tracks: [], keys: [], editedAt, changed: false });
    } else {
      inputs.push({ id: providerId, tracks, keys: tracks.map(trackTiers), editedAt, changed: true });
    }
  }

  // A2 — unify tier records across baseline + all copies → collapsed repr keys.
  const unified = unifyTrackKeys([baselineTiers, ...inputs.map((i) => i.keys)]);
  const baselineRepr = unified[0];
  const copies = inputs.map((c, i) => ({
    id: c.id, keys: unified[i + 1], tracks: c.tracks, editedAt: c.editedAt, changed: c.changed,
  }));

  // A3 — writability. Only the imported SOURCE copy (provider matching the
  // localId prefix) is gated on playlist.writable; local + all other mirrors
  // are writable. Writability gates push targets (A9), never the merge.
  const sourcePrefix = typeof localId === 'string' ? localId.split('-')[0] : '';
  const writableById = {};
  for (const c of copies) {
    writableById[c.id] =
      c.id !== 'local' && c.id === sourcePrefix ? playlist.writable !== false : true;
  }

  // A5 — key→track (LOCAL first so richer local metadata wins) + key→isrc.
  // Moved ahead of A4 because both the authority gate and the streak update
  // need the concrete track to derive its cache key.
  const keyToTrack = {};
  const keyToIsrc = {};
  for (let i = 0; i < copies.length; i++) {
    const reprKeys = copies[i].keys;
    const tracks = copies[i].tracks;
    for (let j = 0; j < reprKeys.length && j < tracks.length; j++) {
      const k = reprKeys[j];
      if (!(k in keyToTrack)) keyToTrack[k] = tracks[j];
      if (!(k in keyToIsrc)) {
        const isrc = tracks[j] && tracks[j].isrc;
        if (isrc) keyToIsrc[k] = isrc;
      }
    }
  }

  // A5.5 — PRESENCE TRACKING for the missingStreak gate. Every CHANGED (=>
  // COMPLETE, post partial-fetch floor) provider copy is fresh evidence of
  // what that provider currently holds: reset the streak for each baseline key
  // it shows, increment it for each baseline key it omits. Only complete
  // fetches vote, so a truncated/unchanged copy never moves a streak. This is
  // the persisted memory that lets a SINGLE transient complete-fetch omission
  // stay protected (a region-filtered/silently-short-but-count-matching fetch),
  // while a genuine deletion — omitted for >= 2 consecutive cycles — still
  // escalates. (parachord#911 shared-root fix; mobile mirrors the same rule.)
  // Gated off in shadow: streak escalation is a REAL-propagation mechanism, and
  // shadow must stay side-effect-free. While dryRun, streaks never advance, so
  // a materialized track transiently absent is always protected (safe).
  if (!dryRun) {
    for (const copy of copies) {
      if (copy.id === 'local' || !copy.changed) continue;
      const present = new Set(copy.keys);
      for (const k of baselineRepr) {
        const track = keyToTrack[k];
        if (!track) continue;
        const cacheKey = canonicalTrackKey(track);
        if (present.has(k)) cache.recordSeen(cacheKey, copy.id, now);
        else cache.recordMissing(cacheKey, copy.id);
      }
    }
  }

  // A4 — pull-source authority. A deletion made by the AUTHORITATIVE source is
  // FINAL (not protected by augmentation). The source is authoritative only if
  // it CAN delete (trackRemoveMode !== 'Unsupported'); an add-only source
  // (Apple Music) can never prove a deletion, so it grants no drop-authority.
  // Even the authoritative source's absence must clear the missingStreak gate:
  // a single transient complete-fetch omission is NOT a deletion (it would
  // resurrect for one cycle, then drop — the no-false-drop-safe direction).
  let authoritativeCopyId = null;
  if (pullSource && pullSource.providerId) {
    const sourceProvider = providerById[pullSource.providerId];
    const canDelete = sourceProvider && sourceProvider.capabilities
      && sourceProvider.capabilities.trackRemoveMode !== 'Unsupported';
    authoritativeCopyId = canDelete ? pullSource.providerId : null;
  } else if (playlist.sourceUrl) {
    authoritativeCopyId = 'local'; // hosted XSPF — local mirror IS the source
  }
  const authoritativeCopy = copies.find((c) => c.id === authoritativeCopyId && c.changed);
  const authoritativeDropped = new Set();
  if (authoritativeCopy) {
    const present = new Set(authoritativeCopy.keys);
    for (const k of baselineRepr) {
      if (present.has(k)) continue;
      // 'local' source (hosted XSPF) is in-process, never a truncated fetch —
      // its absence is immediately authoritative. A provider source must clear
      // the missingStreak gate first.
      if (authoritativeCopyId === 'local' || streakEscalated(cache, authoritativeCopyId, k, keyToTrack)) {
        authoritativeDropped.add(k);
      }
    }
  }

  // A6 — pending-aware augmentation. A CHANGED copy that LACKS a baseline key
  // gets that key re-added to its merge keys (so the merge doesn't read its
  // absence as a deletion) unless the absence is GENUINE deletion evidence:
  //   - AUTHORITATIVE source copy: re-add every lacked key EXCEPT those whose
  //     absence has streak-escalated (authoritativeDropped) — so a single
  //     transient complete-fetch omission of the source doesn't drop the track,
  //     but a sustained one (>= 2 cycles) finally does.
  //   - other mirror copies: re-add a lacked key only if the source didn't drop
  //     it AND it's pending for this provider (never-materialized, OR
  //     materialized but not yet missing for >= 2 consecutive complete fetches).
  const augmentedCopies = copies.map((copy) => {
    if (copy.id === 'local' || !copy.changed) return copy;
    const present = new Set(copy.keys);
    const lacked = baselineRepr.filter((k) => !present.has(k));
    if (lacked.length === 0) return copy;
    const toReadd = copy.id === authoritativeCopyId
      ? lacked.filter((k) => !authoritativeDropped.has(k))
      : lacked.filter(
        (k) => !authoritativeDropped.has(k) && isProviderPendingForKey(cache, copy.id, k, keyToTrack)
      );
    return toReadd.length ? { ...copy, keys: copy.keys.concat(toReadd) } : copy;
  });

  // A7 — merge + total-wipe guard.
  const plan = computeNwayPropagationPlan(baselineRepr, augmentedCopies);
  if (plan && plan.massChangeAbort) {
    log.warn('[nway-reconcile] TOTAL-WIPE blocked', { localId, baseline: baselineRepr.length });
    return { status: 'total-wipe-abort', localId };
  }

  // A8 — merged repr (baseline stands if nothing changed).
  const mergedRepr = plan ? plan.merged : baselineRepr;
  const mergedSet = new Set(mergedRepr);

  // A9 — materialize targets from UN-AUGMENTED keys (recover lag). A writable
  // copy whose real keys differ from the merge (set OR length) is a push
  // target — including an empty mirror (keys:[]) and a lagging mirror.
  const pushTargets = copies
    .filter((c) =>
      writableById[c.id] !== false
      && (!setEqual(new Set(c.keys), mergedSet) || c.keys.length !== mergedRepr.length))
    .map((c) => c.id);

  // A10 — pure no-op short-circuit.
  if (!plan && pushTargets.every((t) => t === 'local')) return null;

  // A11 — hydrate merged repr to concrete tracks (LOCAL-first metadata + isrc backfill).
  if (mergedRepr.some((k) => !keyToTrack[k])) {
    log.warn('[nway-reconcile] partial-abort: merged key without a track', { localId });
    return { status: 'partial-abort', localId };
  }
  const mergedTracks = mergedRepr.map((key, idx) => {
    const t = keyToTrack[key];
    return { ...t, playlistId: localId, position: idx, isrc: (t && t.isrc) || keyToIsrc[key] };
  });

  const providerTargets = pushTargets.filter((t) => t !== 'local');

  // A12 — SHADOW stop. Compute the per-target would-be diff from known keys
  // (no extra fetch) and report; no writes, no baseline advance.
  if (dryRun) {
    const perTarget = providerTargets.map((id) => {
      const copy = copies.find((c) => c.id === id);
      const have = new Set(copy ? copy.keys : []);
      const addKeys = mergedRepr.filter((k) => !have.has(k)).length;
      const removeKeys = (copy ? copy.keys : []).filter((k) => !mergedSet.has(k)).length;
      return { providerId: id, addKeys, removeKeys };
    });
    log.info('[nway-shadow]', {
      localId, status: 'would-push', mergedSize: mergedTracks.length,
      pushTargets: providerTargets, perTarget, baselineWouldAdvanceTo: mergedTracks.length,
    });
    return { status: 'would-push', localId, mergedSize: mergedTracks.length, pushTargets: providerTargets, perTarget };
  }

  // A13 — PUSH loop (real writes). Skip 'local' (handled by A14). Each target
  // is independent: a throw on one is logged + skipped, never aborts the rest.
  let pendingAdds = 0;
  let unsupportedRemoves = 0;
  const pushedTo = [];
  for (const targetId of providerTargets) {
    const externalId = mirrorMap[targetId];
    const provider = providerById[targetId];
    if (!provider || !externalId) continue;
    try {
      const remote = await provider.fetchPlaylistTracks(externalId);
      const res = await materializeToProvider({
        provider,
        externalId,
        canonical: mergedTracks,
        remote: Array.isArray(remote) ? remote : [],
        resolveNativeId: (track) => coordinator.resolve(provider, track),
      });
      pendingAdds += res.pendingAdds || 0;
      unsupportedRemoves += res.unsupportedRemoves || 0;
      // ECHO-SUPPRESSION: capture the post-push snapshot so next cycle's
      // change-detection doesn't read our OWN write as a foreign change. A
      // FAILED read means "no fresh anchor", NOT "the anchor is null" — writing
      // null would CLOBBER the valid prior token, re-arm false change-detection
      // next cycle, and (with an authoritative source) read a still-pending add
      // as a deletion. So only advance the token when we actually captured a
      // non-null snapshot; otherwise keep the prior stored token (a stale token
      // just means the source re-detects changed next cycle and re-converges
      // non-destructively — the safe direction).
      let token2;
      let captured = true;
      try {
        token2 = await provider.getPlaylistSnapshot(externalId);
      } catch {
        captured = false;
      }
      if (captured && token2 != null) {
        effects.setProviderToken(localId, targetId, token2, now);
      }
      pushedTo.push(targetId);
    } catch (e) {
      log.warn('[nway-reconcile] push failed; skipping target', { localId, targetId, error: e && e.message });
      // SELF-HEAL: only clear the link if the remote is provably GONE; a
      // transient failure on a still-present mirror keeps the link.
      let mirrorGone = false;
      try {
        const exists = await provider.remotePlaylistExists(externalId);
        mirrorGone = exists === false;
      } catch {
        mirrorGone = false;
      }
      if (mirrorGone) {
        effects.removeSyncLink(localId, targetId);
        effects.removeProviderState(localId, targetId);
      }
    }
  }

  // A14 — local rows become the merged truth.
  effects.replaceAllLocalTracks(localId, mergedTracks);

  // A15 — baseline advances EVERY cycle (no all-covered gate); pending adds
  // are recovered next cycle via the trackCount-lag re-detection (A1) + the
  // augmentation guard, not by withholding the baseline.
  effects.setBaseline(localId, buildBaselineTiers(mergedTracks), now);
  effects.clearLocallyModified(localId);

  return {
    status: 'pushed', localId, mergedSize: mergedTracks.length,
    pushTargets: providerTargets, pushedTo, pendingAdds, unsupportedRemoves,
  };
}

module.exports = {
  reconcilePlaylist,
  computeNwayPropagationPlan,
  isProviderPendingForKey,
};
