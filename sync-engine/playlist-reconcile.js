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
const { computeMaterializeDiff, materializeToProvider, canonicalTracksOnRemote } = require('./playlist-materialize');
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
 * The hydration cache is the only evidence. PENDING = no entry, no fetch has
 * ever SEEN the track on this provider (`lastSeenAt` unset), OR it was seen
 * there but its absence has not yet streak-escalated. A non-null `resolvedId`
 * is NOT evidence: it only proves a search found the id, and an add that
 * resolved but never landed would otherwise escalate into deleting the user's
 * own track everywhere (parachord#1163). A seen track stays protected until it
 * has been omitted from the provider's COMPLETE fetch for
 * MISSING_STREAK_THRESHOLD consecutive cycles, so a single transient omission
 * (region-filtered, or silently-short-but-count-matching) is not a deletion.
 * A missing track object is treated as pending (defensive).
 *
 * This rule is shared with the Kotlin engine (SyncEngine.isProviderPendingForKey,
 * parachord-mobile#469); per the #911 parity contract it changes on both
 * engines together, with the shared test vectors.
 */
// Number of CONSECUTIVE complete-fetch omissions before a materialized track's
// absence escalates from "transient" to "real deletion".
const MISSING_STREAK_THRESHOLD = 2;

// Change token stored for a provider while the reconcile HOLDS keys on it (an
// omission whose streak is building). It never equals a real snapshot, and
// change-detection treats it as changed, so the provider is fetched again next
// cycle even when its snapshot or trackCount reads as unchanged.
const NWAY_HELD_TOKEN = 'nway-held';

function isProviderPendingForKey(cache, providerId, reprKey, keyToTrack) {
  const track = keyToTrack[reprKey];
  if (!track) return true; // defensive: protect
  const cacheKey = canonicalTrackKey(track);
  const entry = cache.select(cacheKey, providerId);
  if (!entry || entry.lastSeenAt == null) return true; // never seen there → pending
  // Materialized: still PENDING (protected) until it has been omitted from the
  // provider's complete fetch for MISSING_STREAK_THRESHOLD consecutive cycles.
  return (entry.missingStreak || 0) < MISSING_STREAK_THRESHOLD;
}

// True when a fetch has SEEN the track behind reprKey on providerId, so an
// omission there is counting toward the missingStreak gate. While the streak
// builds, the reconcile HOLDS the key: it stays in canonical but is not pushed
// back to that provider. Pushing it back would make the next fetch see it again
// and reset the streak, so a deletion there could never reach the threshold.
function seenOnProvider(cache, providerId, reprKey, keyToTrack) {
  const track = keyToTrack[reprKey];
  if (!track) return false;
  const entry = cache.select(canonicalTrackKey(track), providerId);
  return !!entry && entry.lastSeenAt != null;
}

// True when a materialized track's absence has cleared the missingStreak gate
// (>= threshold consecutive complete-fetch omissions) — i.e. its absence is now
// genuine deletion evidence. Used by the authoritative-source path.
function streakEscalated(cache, providerId, reprKey, keyToTrack) {
  const track = keyToTrack[reprKey];
  if (!track) return false; // can't key it → don't escalate (protect)
  const entry = cache.select(canonicalTrackKey(track), providerId);
  if (!entry || entry.lastSeenAt == null) return false; // never seen there → not a deletion
  return (entry.missingStreak || 0) >= MISSING_STREAK_THRESHOLD;
}

// Mark every canonical track the provider's remote holds as SEEN there. With
// `reread` the remote is fetched again (the materialize just added tracks, and
// a resolved id is not proof the add landed); otherwise `remote`, the copy
// fetched before materializing, is used. A failed re-read records nothing:
// unseen tracks stay pending, the safe direction.
async function recordCanonicalOnRemote({ cache, provider, externalId, canonical, remote, reread, now, log }) {
  let observed = remote;
  if (reread) {
    try {
      observed = await provider.fetchPlaylistTracks(externalId);
    } catch (e) {
      log.info('[nway-reconcile] re-read after materialize failed', { providerId: provider.id, error: e && e.message });
      return;
    }
  }
  for (const { track, nativeId } of canonicalTracksOnRemote(provider, canonical, Array.isArray(observed) ? observed : [])) {
    cache.recordPresent(canonicalTrackKey(track), provider.id, nativeId, now);
  }
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
    pullSource, coordinator, cache, now, dryRun, effects, mirrorOnly,
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
    } else if (storedToken === NWAY_HELD_TOKEN) {
      changed = true; // re-check a held omission
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
  // what that provider currently holds: record every key it shows as SEEN
  // (recordPresent creates the entry if needed: a track whose native id was
  // already on the row never gets a hydration entry, and without one its later
  // omission could never count), and step the streak for each baseline key it
  // omits. Only complete fetches vote, so a truncated/unchanged copy never
  // moves a streak. This is the persisted memory that lets a SINGLE transient
  // complete-fetch omission stay protected, while a genuine deletion, omitted
  // for >= 2 consecutive cycles, still escalates. (parachord#911 / #1163; mobile
  // mirrors the same rule.)
  // Gated off in shadow: streak escalation is a REAL-propagation mechanism, and
  // shadow must stay side-effect-free. While dryRun, streaks never advance, so
  // a materialized track transiently absent is always protected (safe).
  if (!dryRun) {
    for (const copy of copies) {
      if (copy.id === 'local' || !copy.changed) continue;
      const provider = providerById[copy.id];
      if (!provider) continue;
      const present = new Set(copy.keys);
      copy.keys.forEach((k, j) => {
        const track = keyToTrack[k];
        if (!track) return;
        const fetchedTrack = copy.tracks[j];
        const nativeId = fetchedTrack && typeof provider.nativeIdOf === 'function' ? provider.nativeIdOf(fetchedTrack) : null;
        cache.recordPresent(canonicalTrackKey(track), copy.id, nativeId || null, now);
      });
      for (const k of baselineRepr) {
        if (present.has(k)) continue;
        const track = keyToTrack[k];
        if (!track) continue;
        cache.recordMissing(canonicalTrackKey(track), copy.id);
      }
    }
  }

  // A4 — pull-source authority. A deletion made by the AUTHORITATIVE source is
  // FINAL (not protected by augmentation). The source is authoritative only if
  // it CAN delete (trackRemoveMode !== 'Unsupported'); an add-only source
  // (Apple Music) can never prove a deletion, so it grants no drop-authority.
  let authoritativeCopyId = null;
  // Refinement A (parachord#911 / parachord#956 audit §2a): a non-removal-capable
  // PULL SOURCE (Apple Music — trackRemoveMode 'Unsupported') can NEVER prove a
  // deletion. Its source copy is AUGMENT-ALL in A6 — every lacked baseline key is
  // re-added, bypassing the missingStreak gate — so a transient/partial AM fetch
  // can't read as a deletion and propagate a real removal to the writable mirrors.
  // Without this, an AM-sourced track AM omits from a complete fetch for >= 2
  // cycles falls through the streak gate and DELETE-WINS drops it fleet-wide.
  let addOnlyPullSourceId = null;
  if (pullSource && pullSource.providerId) {
    const sourceProvider = providerById[pullSource.providerId];
    const canDelete = sourceProvider && sourceProvider.capabilities
      && sourceProvider.capabilities.trackRemoveMode !== 'Unsupported';
    if (canDelete) authoritativeCopyId = pullSource.providerId;
    else addOnlyPullSourceId = pullSource.providerId; // non-removal-capable → augment-all
  } else if (playlist.sourceUrl) {
    authoritativeCopyId = 'local'; // hosted XSPF — local mirror IS the source
  }

  // immediateAuthority — the source is SINGLE-AUTHORITY (a one-way mirror), so
  // its rotate-out drops IMMEDIATELY, with NO missingStreak gate:
  //   • 'local'    — a hosted-XSPF source (in-process, never a truncated fetch);
  //   • !writable  — a FOLLOWED (read-only) provider source. A wrong drop
  //                  SELF-HEALS next cycle (the source re-asserts the track), so
  //                  the gate buys nothing but would lag/break a daily-rotating
  //                  algorithmic playlist — a followed Daily Brew (~40 tracks/day)
  //                  would accumulate WITHOUT BOUND under the gate (the exact
  //                  bloat the pull-source-authority fix closed);
  //   • mirrorOnly — the user flagged an OWNED-but-dynamic playlist (e.g. a
  //                  SmarterPlaylists-managed Daily Brew the provider reports as
  //                  user-owned) as one-way; the writability split alone can't
  //                  catch it.
  // ONLY an OWNED, non-mirror provider source keeps the gate — there a transient
  // complete-fetch omission could lose a real user edit, so a single omission
  // stays protected until sustained >= MISSING_STREAK_THRESHOLD cycles. The
  // partial-fetch floor (A1) runs BEFORE this, so a truncated followed-source
  // fetch is already degraded to changed:false and can't mass-drop here.
  // (parachord#911 — byte-aligned with mobile 9780432 / parachord-mobile#277.)
  const immediateAuthority = authoritativeCopyId === 'local' || !!mirrorOnly || !playlist.writable;
  const authoritativeCopy = copies.find((c) => c.id === authoritativeCopyId && c.changed);
  const authoritativeDropped = new Set();
  if (authoritativeCopy) {
    const present = new Set(authoritativeCopy.keys);
    for (const k of baselineRepr) {
      if (present.has(k)) continue;
      if (immediateAuthority || streakEscalated(cache, authoritativeCopyId, k, keyToTrack)) {
        authoritativeDropped.add(k);
      }
    }
  }

  // A6 — pending-aware augmentation. A CHANGED copy that LACKS a baseline key
  // gets that key re-added to its merge keys (so the merge doesn't read its
  // absence as a deletion) unless the absence is GENUINE deletion evidence:
  //   - AUTHORITATIVE source copy: re-add every lacked key EXCEPT those in
  //     authoritativeDropped. For an OWNED source that means only streak-
  //     escalated keys drop (a single transient omission is protected); for an
  //     immediate-authority source (followed / hosted / mirrorOnly) ALL lacked
  //     keys are in authoritativeDropped, so its rotate-out drops at once.
  //   - other mirror copies: re-add a lacked key only if the source didn't drop
  //     it AND it's pending for this provider (never seen there, OR seen but
  //     not yet missing for >= 2 consecutive complete fetches).
  //   - an add-only pull source: re-add every lacked key (Refinement A above).
  //   - a mirror of a ONE-WAY playlist (hosted XSPF, followed source,
  //     user-flagged mirrorOnly): re-add every lacked key the source didn't
  //     drop. The playlist takes no edits back from its mirrors, so a mirror's
  //     omission is restored from the source, never gated toward a deletion.
  //
  // HOLD: a re-added key the provider was SEEN holding is an omission the
  // streak is counting. It stays in canonical (protected everywhere else) but
  // is NOT materialized back onto that provider (heldByCopy, used by A9/A13).
  const oneWay = immediateAuthority && (authoritativeCopyId != null || addOnlyPullSourceId != null);
  const heldByCopy = {};
  const augmentedCopies = copies.map((copy) => {
    if (copy.id === 'local' || !copy.changed) return copy;
    const present = new Set(copy.keys);
    const lacked = baselineRepr.filter((k) => !present.has(k));
    if (lacked.length === 0) return copy;
    // gated = these re-adds wait on the missingStreak gate, so the seen ones are HELD
    let toReadd;
    let gated;
    if (copy.id === authoritativeCopyId) {
      toReadd = lacked.filter((k) => !authoritativeDropped.has(k));
      gated = !immediateAuthority;
    } else if (copy.id === addOnlyPullSourceId) {
      // Refinement A — a non-removal-capable PULL SOURCE (AM) is AUGMENT-ALL:
      // re-add EVERY lacked key, no streak gate. Its absence is never a delete.
      toReadd = lacked;
      gated = false;
    } else if (oneWay) {
      toReadd = lacked.filter((k) => !authoritativeDropped.has(k));
      gated = false;
    } else {
      toReadd = lacked.filter(
        (k) => !authoritativeDropped.has(k) && isProviderPendingForKey(cache, copy.id, k, keyToTrack)
      );
      gated = true;
    }
    if (gated) {
      const held = new Set(toReadd.filter((k) => seenOnProvider(cache, copy.id, k, keyToTrack)));
      if (held.size) heldByCopy[copy.id] = held;
    }
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

  // A9 — materialize targets from UN-AUGMENTED keys (recover lag). A writable
  // copy whose real keys differ from the merge (set OR length) is a push
  // target — including an empty mirror (keys:[]) and a lagging mirror. A
  // copy's target list is the merge minus the keys HELD for it, so a provider
  // lagging only by a held key isn't a target at all.
  const reprFor = (copyId) => {
    const held = heldByCopy[copyId];
    return held ? mergedRepr.filter((k) => !held.has(k)) : mergedRepr;
  };
  const pushTargets = copies
    .filter((c) => {
      const expected = reprFor(c.id);
      return writableById[c.id] !== false
        && (!setEqual(new Set(c.keys), new Set(expected)) || c.keys.length !== expected.length);
    })
    .map((c) => c.id);

  // Held providers get the sentinel token so next cycle fetches them again and
  // the streak can grow (or reset). A provider that held keys last cycle but
  // holds none now, and isn't a push target (whose token A13 refreshes), gets
  // the snapshot this cycle observed instead. Written before the A10
  // short-circuit, since a cycle that only holds returns there.
  if (!dryRun) {
    for (const c of copies) {
      if (c.id === 'local') continue;
      const stored = storedTokens && storedTokens[c.id] ? storedTokens[c.id].changeToken : undefined;
      if (heldByCopy[c.id]) {
        effects.setProviderToken(localId, c.id, NWAY_HELD_TOKEN, now);
      } else if (stored === NWAY_HELD_TOKEN && c.changed && !pushTargets.includes(c.id)) {
        const listEntry = remoteLists && remoteLists[c.id] ? remoteLists[c.id][mirrorMap[c.id]] : null;
        effects.setProviderToken(localId, c.id, listEntry && listEntry.snapshotId != null ? listEntry.snapshotId : null, now);
      }
    }
  }

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

  // The migration preview's view of one provider: the merge minus its held
  // keys, so it doesn't list a held track as an add the real run won't make.
  const canonicalFor = (providerId) => {
    const held = heldByCopy[providerId];
    return held ? mergedTracks.filter((_, i) => !held.has(mergedRepr[i])) : mergedTracks;
  };

  // A12 — SHADOW stop. Compute the per-target would-be diff EXACTLY the way the
  // real push (A13) would, so the migration preview (#911) shows precisely what
  // the executor would write — including track NAMES. materializeToProvider
  // diffs `computeMaterializeDiff(canonical, remote)` and maps the diff's own
  // keyspace back to tracks; we mirror that here, but stop at the diff (no write,
  // no baseline advance). A target's `remote` is its A1-fetched copy.tracks when
  // present (a changed mirror), otherwise a fresh fetch — which is what makes an
  // UNCHANGED-mirror removal nameable (its tracks aren't in the A1 copy). Shadow
  // is interactive, so the extra fetch for unchanged targets is acceptable.
  const previewName = (t) => {
    if (!t) return { artist: '', title: '' };
    const artist = t.artist || t.artistName
      || (Array.isArray(t.artists) ? t.artists.map((a) => (a && a.name) || a).filter(Boolean).join(', ') : '')
      || '';
    return { artist, title: t.title || t.name || t.trackTitle || '' };
  };
  if (dryRun) {
    const perTarget = [];
    for (const id of providerTargets) {
      const copy = copies.find((c) => c.id === id);
      let remote = copy && Array.isArray(copy.tracks) && copy.tracks.length ? copy.tracks : [];
      if (!remote.length && providerById[id] && mirrorMap[id]) {
        try {
          const f = await providerById[id].fetchPlaylistTracks(mirrorMap[id]);
          remote = Array.isArray(f) ? f : [];
        } catch (e) {
          log.warn('[nway-shadow] preview name-fetch failed', { localId, id, error: e && e.message });
        }
      }
      const canonical = canonicalFor(id);
      const diff = computeMaterializeDiff(canonical, remote);
      const keyToCanonical = {};
      diff.canonicalKeys.forEach((k, i) => { if (!(k in keyToCanonical)) keyToCanonical[k] = canonical[i]; });
      const keyToRemote = {};
      diff.remoteKeys.forEach((k, i) => { if (!(k in keyToRemote)) keyToRemote[k] = remote[i]; });
      perTarget.push({
        providerId: id,
        addKeys: diff.addKeys.length,
        removeKeys: diff.removeKeys.length,
        addTracks: diff.addKeys.map((k) => previewName(keyToCanonical[k])),
        removeTracks: diff.removeKeys.map((k) => previewName(keyToRemote[k])),
      });
    }
    log.info('[nway-shadow]', {
      localId, status: 'would-push', mergedSize: mergedTracks.length,
      pushTargets: providerTargets,
      perTarget: perTarget.map((p) => ({ providerId: p.providerId, addKeys: p.addKeys, removeKeys: p.removeKeys })),
      baselineWouldAdvanceTo: mergedTracks.length,
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
      const fetchedRemote = await provider.fetchPlaylistTracks(externalId);
      const remote = Array.isArray(fetchedRemote) ? fetchedRemote : [];
      // The diff runs against the FULL canonical, so a held track the user put
      // back in the meantime is never removed; a held track only has its ADD
      // suppressed (it counts as pending while its streak builds).
      const held = heldByCopy[targetId];
      const heldCacheKeys = new Set(
        held ? [...held].map((k) => keyToTrack[k]).filter(Boolean).map((t) => canonicalTrackKey(t)) : []
      );
      const res = await materializeToProvider({
        provider,
        externalId,
        canonical: mergedTracks,
        remote,
        resolveNativeId: (track) => (heldCacheKeys.has(canonicalTrackKey(track)) ? null : coordinator.resolve(provider, track)),
      });
      pendingAdds += res.pendingAdds || 0;
      unsupportedRemoves += res.unsupportedRemoves || 0;
      // Record what the provider now holds, so a later removal there can count
      // toward the missingStreak gate. When something was added, re-read the
      // remote: a resolved id is not proof the add landed.
      await recordCanonicalOnRemote({
        cache, provider, externalId, canonical: mergedTracks, remote, reread: (res.added || 0) > 0, now, log,
      });
      // ECHO-SUPPRESSION: capture the post-push snapshot so next cycle's
      // change-detection doesn't read our OWN write as a foreign change. A
      // FAILED read means "no fresh anchor", NOT "the anchor is null" — writing
      // null would CLOBBER the valid prior token, re-arm false change-detection
      // next cycle, and (with an authoritative source) read a still-pending add
      // as a deletion. So only advance the token when we actually captured a
      // non-null snapshot; otherwise keep the prior stored token (a stale token
      // just means the source re-detects changed next cycle and re-converges
      // non-destructively — the safe direction).
      // A provider with HELD keys keeps the NWAY_HELD_TOKEN written after A9, so
      // the next cycle fetches it again and the omission's streak can grow (or reset).
      if (!held) {
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
  NWAY_HELD_TOKEN,
};
