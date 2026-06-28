// N-way reconcile DRIVER (parachord#911, Step 2 / PR-4b).
//
// The thin, injected orchestration that runs the pure reconcile core
// (playlist-reconcile.js) over every sync-tracked playlist for one cycle. It
// owns the three impure concerns the core deliberately doesn't:
//   1. per-cycle token binding (OQ-2) — real desktop providers take `token` on
//      every method; the reconcile core + executor call them token-free, so
//      each provider is wrapped in a per-cycle adapter that closes over its
//      token (and fills any not-yet-implemented write primitive with a throwing
//      default, so a mis-call is loud rather than a silent no-op).
//   2. store-backed effects — the core RETURNS its mutations through injected
//      effect callbacks; here they read/write electron-store-shaped maps
//      (local_playlists, sync_playlist_state, sync_playlist_links).
//   3. per-playlist isolation — one playlist throwing (a throttled mirror's A1
//      fetch propagates out of the core) must NEVER abort the rest of the
//      cycle, mirroring sync:start's per-playlist resilience.
//
// SHADOW-FIRST: with dryRun=true the core stops before any write, so the only
// provider call is fetchPlaylistTracks and NONE of the effects fire — the pass
// is side-effect-free. Real writes are reached only when the caller passes
// dryRun=false (gated by `nway_propagate`, default OFF). This module is pure +
// injected (no electron, no fetch); main.js supplies the real store + providers
// + tokens + remoteLists. Unit-tested in tests/sync/nway-reconcile-driver.test.js.

const { reconcilePlaylist } = require('./playlist-reconcile');
const { createHydrationCoordinator } = require('./hydration-coordinator');
const { createHydrationCache } = require('./nway-hydration-cache');
const { withIncrementalDefaults } = require('../sync-providers/incremental-primitives');

// The provider methods the reconcile core + executor + coordinator call, and
// whether the token is bound as a trailing arg. nativeIdOf is pure (no token).
const TOKEN_BOUND_METHODS = [
  'fetchPlaylistTracks',
  'addPlaylistTracks',
  'removePlaylistTracksByNativeId',
  'removePlaylistTracksByPosition',
  'replacePlaylistTracks',
  'getPlaylistSnapshot',
  'remotePlaylistExists',
  'searchForTrackId',
];

/**
 * Wrap a real provider so the reconcile core can call it token-free. Fills any
 * unimplemented incremental write primitive with a throwing default first (so a
 * premature write call is loud), then binds `token` as the trailing arg of each
 * network method. nativeIdOf passes through unbound (pure).
 */
function bindProviderToken(provider, token) {
  const ready = withIncrementalDefaults(provider);
  const bound = {
    id: ready.id,
    capabilities: ready.capabilities,
    nativeIdOf: typeof ready.nativeIdOf === 'function' ? (t) => ready.nativeIdOf(t) : () => null,
  };
  for (const m of TOKEN_BOUND_METHODS) {
    bound[m] = (...args) => ready[m](...args, token);
  }
  return bound;
}

/**
 * Build the effects object the reconcile core writes its mutations through,
 * backed by an injected `store` abstraction. NONE of these fire in shadow
 * (dryRun) — the core returns before A13/A14/A15.
 *
 * @param {object} store - { getPlaylist(localId), savePlaylist(playlist),
 *   getState(localId), saveState(localId, state), removeSyncLink(localId, providerId) }
 */
function makeStoreEffects(store) {
  return {
    replaceAllLocalTracks(localId, tracks) {
      const pl = store.getPlaylist(localId);
      if (pl) store.savePlaylist({ ...pl, tracks, lastModified: pl.lastModified });
    },
    clearLocallyModified(localId) {
      const pl = store.getPlaylist(localId);
      if (pl && pl.locallyModified) store.savePlaylist({ ...pl, locallyModified: false });
    },
    setProviderToken(localId, providerId, changeToken, now) {
      const state = store.getState(localId);
      if (!state) return;
      const providers = { ...(state.providers || {}) };
      providers[providerId] = { ...(providers[providerId] || {}), changeToken, lastSyncedAt: now };
      store.saveState(localId, { ...state, providers });
    },
    removeProviderState(localId, providerId) {
      const state = store.getState(localId);
      if (!state || !state.providers || !(providerId in state.providers)) return;
      const providers = { ...state.providers };
      delete providers[providerId];
      store.saveState(localId, { ...state, providers });
    },
    setBaseline(localId, tiers, now) {
      const state = store.getState(localId);
      if (!state) return;
      store.saveState(localId, {
        ...state,
        baseline: { ...(state.baseline || {}), tracks: tiers, baselineSyncedAt: now },
      });
    },
    removeSyncLink(localId, providerId) {
      store.removeSyncLink(localId, providerId);
    },
  };
}

/**
 * Run one reconcile cycle over every tracked playlist. Each playlist is
 * isolated in its own try/catch so a throttled mirror can't abort the rest.
 *
 * @param {object} args
 * @param {object}   args.states       - sync_playlist_state map { localId -> state }
 * @param {(localId:string)=>object|null} args.getPlaylist - local playlist lookup
 * @param {(localId:string)=>Object<string,string>} args.getMirrors - { providerId -> externalId } per playlist
 * @param {Object<string,object>} args.boundProviders - per-provider token-bound adapter (bindProviderToken output)
 * @param {object}   args.remoteLists   - { providerId -> { externalId -> { snapshotId?, trackCount? } } }
 * @param {(localId:string)=>object|null} [args.getPullSource]
 * @param {(localId:string)=>boolean} [args.getMirrorOnly] - user mirror-only flag per playlist
 * @param {object}   args.cache         - hydration cache (createHydrationCache)
 * @param {object}   args.effects       - makeStoreEffects output
 * @param {number}   args.now           - epoch ms
 * @param {boolean}  args.dryRun        - shadow (no writes) when true
 * @param {object}   [args.log]
 * @returns {Promise<{cycles:number, results:object[], errors:object[]}>}
 */
async function runNwayReconcileCycle(args) {
  const {
    states, getPlaylist, getMirrors, boundProviders, remoteLists,
    getPullSource, getMirrorOnly, cache, effects, now, dryRun, log = console,
  } = args;

  const providersList = Object.values(boundProviders || {});
  const coordinator = createHydrationCoordinator({ cache, clock: () => now });

  const results = [];
  const errors = [];
  for (const localId of Object.keys(states || {})) {
    const state = states[localId];
    const playlist = getPlaylist(localId);
    if (!playlist) continue;
    try {
      const result = await reconcilePlaylist({
        baseline: state.baseline,
        playlist,
        mirrors: getMirrors(localId),
        providers: providersList,
        remoteLists,
        storedTokens: state.providers || {},
        pullSource: getPullSource ? getPullSource(localId) : null,
        mirrorOnly: getMirrorOnly ? getMirrorOnly(localId) : false,
        coordinator,
        cache,
        now,
        dryRun,
        effects,
        log,
      });
      if (result) results.push(result);
    } catch (err) {
      // Per-playlist isolation — one throttled mirror never aborts the cycle.
      log.warn('[nway-driver] playlist reconcile failed; skipping', { localId, error: err && err.message });
      errors.push({ localId, error: err && err.message });
    }
  }
  return { cycles: Object.keys(states || {}).length, results, errors };
}

module.exports = {
  bindProviderToken,
  makeStoreEffects,
  runNwayReconcileCycle,
  createHydrationCache,
  TOKEN_BOUND_METHODS,
};
