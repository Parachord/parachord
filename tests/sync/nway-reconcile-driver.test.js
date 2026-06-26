/**
 * N-way reconcile DRIVER (Parachord/parachord#911, Step 2 / PR-4b). The thin
 * injected orchestration that runs the pure reconcile core over every tracked
 * playlist for one cycle: token binding, store-backed effects, per-playlist
 * isolation, and shadow (dryRun) side-effect-freedom.
 */

const {
  bindProviderToken, makeStoreEffects, runNwayReconcileCycle, createHydrationCache,
} = require('../../sync-engine/nway-reconcile-driver');
const { buildBaselineTiers } = require('../../sync-engine/playlist-sync-state');

const mk = (mbid) => ({ recordingMbid: mbid, title: `title-${mbid}`, artist: `artist-${mbid}` });

describe('bindProviderToken', () => {
  test('binds the token as the trailing arg of network methods; nativeIdOf stays pure', async () => {
    const calls = [];
    const real = {
      id: 'spotify',
      capabilities: { trackRemoveMode: 'ByNativeId' },
      nativeIdOf: (t) => (t ? `nid:${t.recordingMbid}` : null),
      async fetchPlaylistTracks(ext, token) { calls.push(['fetch', ext, token]); return []; },
      async searchForTrackId(title, artist, album, isrc, token) { calls.push(['search', title, artist, album, isrc, token]); return null; },
    };
    const bound = bindProviderToken(real, 'TOK');
    await bound.fetchPlaylistTracks('ext-1');
    await bound.searchForTrackId('t', 'a', 'al', 'isrc');
    expect(calls[0]).toEqual(['fetch', 'ext-1', 'TOK']);
    expect(calls[1]).toEqual(['search', 't', 'a', 'al', 'isrc', 'TOK']);
    expect(bound.nativeIdOf(mk('x'))).toBe('nid:x'); // unbound, pure
  });

  test('an unimplemented write primitive throws (the throwing default), bound or not', async () => {
    const real = { id: 'applemusic', capabilities: { trackRemoveMode: 'Unsupported' }, nativeIdOf: () => null };
    const bound = bindProviderToken(real, 'TOK');
    await expect(bound.removePlaylistTracksByNativeId('ext', ['a'])).rejects.toThrow(/not implemented/);
  });
});

// A minimal in-memory store matching makeStoreEffects' injected shape.
function makeMemoryStore(playlists, states) {
  const pl = new Map(playlists.map((p) => [p.id, p]));
  const st = new Map(Object.entries(states));
  const removedLinks = [];
  return {
    getPlaylist: (id) => pl.get(id) || null,
    savePlaylist: (p) => pl.set(p.id, p),
    getState: (id) => st.get(id) || null,
    saveState: (id, s) => st.set(id, s),
    removeSyncLink: (id, provider) => removedLinks.push([id, provider]),
    _pl: pl,
    _st: st,
    _removedLinks: removedLinks,
  };
}

// A FakeProvider with a real round-tripping in-memory remote, built as a PLAIN
// OBJECT (methods as own properties) to mirror the real desktop providers —
// bindProviderToken's withIncrementalDefaults does {...provider}, which only
// copies own props, so a class instance would lose its prototype methods.
// Token-agnostic: the driver binds the real token; the Fake ignores it.
function makeFakeProvider(id, mode) {
  const p = {
    id,
    capabilities: { trackRemoveMode: mode, canReorder: false, supportsPlaylistDelete: true, supportsPlaylistRename: true },
    remote: [],
    snap: 0,
    fetchCount: 0,
    addCalls: [],
    nativeIdOf(t) { return t && t.recordingMbid ? `nid:${t.recordingMbid}` : null; },
    async fetchPlaylistTracks() { p.fetchCount += 1; return p.remote.map((t) => ({ ...t })); },
    async addPlaylistTracks(_e, ids) { p.addCalls.push(ids); for (const id of ids) p.remote.push({ recordingMbid: String(id).slice(4) }); p.snap += 1; },
    async removePlaylistTracksByNativeId(_e, ids) { const d = new Set(ids); p.remote = p.remote.filter((t) => !d.has(p.nativeIdOf(t))); p.snap += 1; },
    async getPlaylistSnapshot() { return `snap-${id}-${p.snap}`; },
    async remotePlaylistExists() { return true; },
    async searchForTrackId() { return null; },
  };
  return p;
}

describe('runNwayReconcileCycle', () => {
  function setup() {
    const sp = makeFakeProvider('spotify', 'ByNativeId');
    sp.remote = [mk('m0'), mk('m1')];
    const seeded = [mk('m0'), mk('m1')];
    const states = {
      'pl-1': {
        baseline: { localPlaylistId: 'pl-1', tracks: buildBaselineTiers(seeded), baselineSyncedAt: 1000 },
        providers: { spotify: { changeToken: 'snap-spotify-0', editedAt: 0 } },
      },
    };
    const playlists = [{ id: 'pl-1', tracks: [mk('m0'), mk('m1'), mk('added')], locallyModified: true, lastModified: 2000, writable: true }];
    const store = makeMemoryStore(playlists, states);
    const boundProviders = { spotify: bindProviderToken(sp, 'TOK') };
    const remoteLists = { spotify: { 'ext-sp': { snapshotId: 'snap-spotify-0', trackCount: 2 } } };
    return { sp, states, store, boundProviders, remoteLists };
  }

  test('shadow (dryRun) computes the plan with ZERO writes', async () => {
    const { sp, states, store, boundProviders, remoteLists } = setup();
    const cache = createHydrationCache();
    const out = await runNwayReconcileCycle({
      states,
      getPlaylist: store.getPlaylist,
      getMirrors: () => ({ spotify: 'ext-sp' }),
      boundProviders,
      remoteLists,
      cache,
      effects: makeStoreEffects(store),
      now: 3000,
      dryRun: true,
      log: { info() {}, warn() {} },
    });
    expect(out.results[0]).toMatchObject({ status: 'would-push', mergedSize: 3 });
    expect(sp.remote.length).toBe(2); // remote untouched
    expect(sp.addCalls).toEqual([]);
    expect(store.getState('pl-1').baseline.tracks.length).toBe(2); // baseline not advanced
    expect(store.getPlaylist('pl-1').locallyModified).toBe(true); // flag untouched
  });

  test('write mode (dryRun=false) materializes + advances baseline via store effects', async () => {
    const { sp, states, store, boundProviders, remoteLists } = setup();
    const cache = createHydrationCache();
    await runNwayReconcileCycle({
      states,
      getPlaylist: store.getPlaylist,
      getMirrors: () => ({ spotify: 'ext-sp' }),
      boundProviders,
      remoteLists,
      cache,
      effects: makeStoreEffects(store),
      now: 3000,
      dryRun: false,
      log: { info() {}, warn() {} },
    });
    expect(new Set(sp.remote.map((t) => t.recordingMbid))).toEqual(new Set(['m0', 'm1', 'added']));
    expect(store.getState('pl-1').baseline.tracks.length).toBe(3); // advanced
    expect(store.getState('pl-1').providers.spotify.lastSyncedAt).toBe(3000); // token re-stamped
    expect(store.getPlaylist('pl-1').locallyModified).toBe(false); // cleared
  });

  test('per-playlist isolation — one playlist throwing does not abort the others', async () => {
    // ONE shared provider whose A1 fetch THROWS only for pl-bad's externalId.
    const sp = makeFakeProvider('spotify', 'ByNativeId');
    sp.remote = [mk('m0'), mk('m1')];
    sp.fetchPlaylistTracks = async (ext) => {
      if (ext === 'ext-bad') throw new Error('429 throttled');
      sp.fetchCount += 1;
      return sp.remote.map((t) => ({ ...t }));
    };
    const states = {
      'pl-bad': { baseline: { localPlaylistId: 'pl-bad', tracks: buildBaselineTiers([mk('z0')]), baselineSyncedAt: 1000 }, providers: { spotify: { changeToken: 'snap-spotify-0' } } },
      'pl-good': { baseline: { localPlaylistId: 'pl-good', tracks: buildBaselineTiers([mk('m0'), mk('m1')]), baselineSyncedAt: 1000 }, providers: { spotify: { changeToken: 'snap-spotify-0' } } },
    };
    const playlists = [
      { id: 'pl-bad', tracks: [mk('z0')], locallyModified: false, lastModified: 1000, writable: true },
      { id: 'pl-good', tracks: [mk('m0'), mk('m1'), mk('added')], locallyModified: true, lastModified: 2000, writable: true },
    ];
    const store = makeMemoryStore(playlists, states);
    const out = await runNwayReconcileCycle({
      states,
      getPlaylist: store.getPlaylist,
      getMirrors: (id) => ({ spotify: id === 'pl-bad' ? 'ext-bad' : 'ext-good' }),
      boundProviders: { spotify: bindProviderToken(sp, 'TOK') },
      // pl-bad's mirror is 'changed' (trackCount 2 vs baseline 1) → it fetches → throws.
      remoteLists: { spotify: { 'ext-bad': { trackCount: 2 }, 'ext-good': { snapshotId: 'snap-spotify-0', trackCount: 2 } } },
      cache: createHydrationCache(),
      effects: makeStoreEffects(store),
      now: 3000,
      dryRun: false,
      log: { info() {}, warn() {} },
    });
    expect(out.cycles).toBe(2);
    expect(out.errors).toEqual([{ localId: 'pl-bad', error: '429 throttled' }]); // isolated
    // pl-good still converged despite pl-bad throwing.
    expect(new Set(sp.remote.map((t) => t.recordingMbid))).toEqual(new Set(['m0', 'm1', 'added']));
    expect(store.getState('pl-good').baseline.tracks.length).toBe(3);
  });
});
