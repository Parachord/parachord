// N-way incremental playlist MATERIALIZE — Layer B (the executor).
//
// Design: docs/plans/2026-06-23-incremental-materialization-design.md
// (parachord-mobile) + docs/plans/2026-06-25-nway-desktop-port-plan.md (Step
// 2). Tracker: Parachord/parachord#911. Kotlin reference:
// shared/.../sync/PlaylistMaterializeExecutor.kt — port the test vectors 1:1.
//
// Reconcile (identity, Layer A) is decoupled from materialize (writing, this
// module). The executor takes the desired `canonical` tracklist + the live
// `remote` tracklist for ONE provider mirror and brings the remote to the
// canonical state with a NON-DESTRUCTIVE incremental identity-diff —
// capability-dispatched on `provider.capabilities.trackRemoveMode`, NEVER on
// provider id (so a future service is an adapter, not an engine edit).
//
// Pure + injected-provider: tests pass a FakeProvider, prod passes a real
// provider (token-bound by a per-cycle adapter). It NEVER calls a destructive
// replace-all for the add/remove providers — every removal is a targeted
// delete-by-native-id or delete-by-position. The Layer-A reconcile driver,
// the hydration coordinator, the shadow flags, and the real-provider write
// primitives land in later PRs (#911 Steps 2.3/2.4).

const { trackTiers, unifyTrackKeys } = require('./playlist-key-unify');

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
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
 * Identity-diff the desired `canonical` tracklist against the live `remote`
 * one. Both lists are unified TOGETHER (so the same song across the two gets
 * the same representative key — the remaster-drift / cross-service guard), then
 * compared by representative key. NOT a native-id diff.
 *
 * @param {object[]} canonical - desired tracks (Layer-A merge output)
 * @param {object[]} remote    - the provider's current tracks
 * @returns {{addKeys:string[], removeKeys:string[], reorderNeeded:boolean, canonicalKeys:string[], remoteKeys:string[]}}
 *   `canonicalKeys`/`remoteKeys` are 1:1 (order + length) with their inputs,
 *   NOT deduped, so the caller can map a key back to its track/position.
 */
function computeMaterializeDiff(canonical, remote) {
  const can = Array.isArray(canonical) ? canonical : [];
  const rem = Array.isArray(remote) ? remote : [];
  const keysOf = (ts) => ts.map((t) => trackTiers(t));
  const [canonicalKeys, remoteKeys] = unifyTrackKeys([keysOf(can), keysOf(rem)]);
  const canSet = new Set(canonicalKeys);
  const remSet = new Set(remoteKeys);
  const addKeys = distinct(canonicalKeys.filter((k) => !remSet.has(k)));
  const removeKeys = distinct(remoteKeys.filter((k) => !canSet.has(k)));
  const reorderNeeded =
    addKeys.length === 0 && removeKeys.length === 0 && !arraysEqual(canonicalKeys, remoteKeys);
  return { addKeys, removeKeys, reorderNeeded, canonicalKeys, remoteKeys };
}

// ── add/remove helpers ──────────────────────────────────────────────

// Hydrate add keys to native ids via the injected resolver (search/cache).
// An unresolvable add this cycle is PENDING (a fill target), never a drop.
async function resolveAdds(addKeys, keyToCanonical, resolveNativeId) {
  const ids = [];
  let pending = 0;
  for (const key of addKeys) {
    const track = keyToCanonical[key];
    if (!track) continue;
    const nid = await resolveNativeId(track);
    if (!nid) pending++;
    else ids.push(nid);
  }
  return { ids, pending };
}

// Empty-add guard: never call addPlaylistTracks([]).
async function appendAdds(provider, externalId, ids) {
  if (!ids.length) return 0;
  await provider.addPlaylistTracks(externalId, ids);
  return ids.length;
}

async function removeByNativeId(provider, externalId, removeKeys, keyToRemote) {
  const ids = removeKeys
    .map((k) => keyToRemote[k])
    .filter(Boolean)
    .map((t) => provider.nativeIdOf(t))
    .filter(Boolean);
  if (!ids.length) return 0;
  await provider.removePlaylistTracksByNativeId(externalId, ids);
  return ids.length;
}

/**
 * Bring ONE provider mirror to the canonical tracklist via a non-destructive
 * incremental diff, dispatched on `provider.capabilities.trackRemoveMode`.
 *
 * @param {object}   args
 * @param {object}   args.provider        - SyncProvider (real adapter or Fake): `capabilities`, `nativeIdOf`, `addPlaylistTracks`, `removePlaylistTracksByNativeId`, `removePlaylistTracksByPosition`, `replacePlaylistTracks`
 * @param {string}   args.externalId      - remote playlist id
 * @param {object[]} args.canonical       - desired tracklist
 * @param {object[]} args.remote          - the provider's current tracklist
 * @param {(track:object)=>Promise<string|null>} args.resolveNativeId - hydration closure for ADDS
 * @returns {Promise<{added:number, removed:number, pendingAdds:number, unsupportedRemoves:number}>}
 *   counts what the executor ACTUALLY DID (not what the diff wanted).
 */
async function materializeToProvider({ provider, externalId, canonical, remote, resolveNativeId }) {
  const diff = computeMaterializeDiff(canonical, remote);

  // Key -> track maps over the diff's OWN keyspace (never re-unify). First
  // occurrence wins (matches the dedupe the diff already applied to add/remove).
  const keyToCanonical = {};
  diff.canonicalKeys.forEach((k, i) => {
    if (!(k in keyToCanonical)) keyToCanonical[k] = canonical[i];
  });
  const keyToRemote = {};
  const remKeyToPosition = {};
  diff.remoteKeys.forEach((k, i) => {
    if (!(k in keyToRemote)) keyToRemote[k] = remote[i];
    if (!(k in remKeyToPosition)) remKeyToPosition[k] = i;
  });

  let added = 0;
  let removed = 0;
  let pendingAdds = 0;
  let unsupportedRemoves = 0;

  const mode = provider.capabilities && provider.capabilities.trackRemoveMode;

  if (mode === 'ByNativeId') {
    removed = await removeByNativeId(provider, externalId, diff.removeKeys, keyToRemote);
    const resolved = await resolveAdds(diff.addKeys, keyToCanonical, resolveNativeId);
    pendingAdds = resolved.pending;
    added = await appendAdds(provider, externalId, resolved.ids);
  } else if (mode === 'ByPosition') {
    const positions = distinct(
      diff.removeKeys.map((k) => remKeyToPosition[k]).filter((p) => p != null)
    );
    if (positions.length) {
      await provider.removePlaylistTracksByPosition(externalId, positions);
      removed = positions.length;
    }
    const resolved = await resolveAdds(diff.addKeys, keyToCanonical, resolveNativeId);
    pendingAdds = resolved.pending;
    added = await appendAdds(provider, externalId, resolved.ids);
  } else if (mode === 'Unsupported') {
    unsupportedRemoves = diff.removeKeys.length; // surfaced, never forced
    const resolved = await resolveAdds(diff.addKeys, keyToCanonical, resolveNativeId);
    pendingAdds = resolved.pending;
    added = await appendAdds(provider, externalId, resolved.ids);
  } else if (mode === 'ReplaceOnly') {
    // Full wipe + re-add ONLY when every canonical track contributes a native
    // id; otherwise a partial replace would SHRINK the list (destructive), so
    // degrade to add-only and leave removals unapplied.
    const addKeySet = new Set(diff.addKeys);
    const resolvedAdds = {};
    let addCoverageGap = 0;
    for (const key of diff.addKeys) {
      const track = keyToCanonical[key];
      if (!track) continue;
      const nid = await resolveNativeId(track);
      if (!nid) addCoverageGap++;
      else resolvedAdds[key] = nid;
    }
    const allNativeIds = [];
    diff.canonicalKeys.forEach((key, i) => {
      const nid = addKeySet.has(key) ? resolvedAdds[key] : provider.nativeIdOf(canonical[i]);
      if (nid) allNativeIds.push(nid); // a blank SHRINKS the list -> blocks replace
    });
    const fullCoverage = allNativeIds.length === canonical.length;
    if (fullCoverage && diff.removeKeys.length) {
      await provider.replacePlaylistTracks(externalId, allNativeIds);
      removed = diff.removeKeys.length;
      added = diff.addKeys.length;
    } else {
      if (diff.removeKeys.length) unsupportedRemoves = diff.removeKeys.length;
      pendingAdds = addCoverageGap;
      const orderedAddIds = diff.addKeys.map((k) => resolvedAdds[k]).filter(Boolean);
      added = await appendAdds(provider, externalId, orderedAddIds);
    }
  }
  // Unknown / undeclared mode: no-op (no writes) — defensive.

  // Reorder is v1-deferred: log only, no API call (matches mobile YAGNI).
  if (diff.reorderNeeded && provider.capabilities && provider.capabilities.canReorder) {
    // eslint-disable-next-line no-console
    console.log('[nway-materialize] reorder needed but deferred (v1):', externalId);
  }

  return { added, removed, pendingAdds, unsupportedRemoves };
}

module.exports = { materializeToProvider, computeMaterializeDiff };
