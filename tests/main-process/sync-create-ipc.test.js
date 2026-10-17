/**
 * main-process/ipc/sync-create.js — the create/link gateway, driven with fakes.
 *
 * Pins the three-layer dedup in order (durable ID link → name-match fallback →
 * create), the parachord#846 retryable-failure handling (a failed
 * fetchPlaylists must NEVER be read as "remote gone"), the empty-create guard,
 * the non-owned-source guard (parachord#950), the channel gate, and the
 * Achordion playlist-links fire-and-forget.
 */

const { registerSyncCreateIpc } = require('../../main-process/ipc/sync-create');
const { createSyncLinks } = require('../../main-process/sync-links');

function makeStore(initial = {}) {
  const data = { ...initial };
  return { data, get: (k) => data[k], set: (k, v) => { data[k] = v; } };
}

function makeHarness({ provider, channelOverride, legacy = true, token = 'TOKEN', playlistsCapability = true, lbInvolved = false } = {}) {
  const store = makeStore();
  const syncLinks = createSyncLinks({ store });

  const calls = { createPlaylist: [], updatePlaylistTracks: [], fetchPlaylists: [], resolveTracks: [], achordion: [] };
  const impl = {
    // eslint-disable-next-line no-unused-vars
    createPlaylist: async (name, description, token) => {
      calls.createPlaylist.push({ name, description });
      return { externalId: 'NEW-1', snapshotId: 'snap-new' };
    },
    updatePlaylistTracks: async (externalId, resolved, tok) => {
      calls.updatePlaylistTracks.push({ externalId, resolved, tok });
      return { snapshotId: 'snap-upd' };
    },
    fetchPlaylists: async () => {
      calls.fetchPlaylists.push(1);
      return { playlists: [] };
    },
    resolveTracks: async (tracks) => {
      calls.resolveTracks.push(tracks);
      return { resolved: tracks.map((t, i) => ({ ...t, nativeId: `n${i}` })), unresolved: [] };
    },
    ...(provider || {}),
  };
  const providerObj = {
    capabilities: { playlists: playlistsCapability },
    createPlaylist: impl.createPlaylist,
    updatePlaylistTracks: impl.updatePlaylistTracks,
    fetchPlaylists: impl.fetchPlaylists,
    ...(impl.resolveTracks ? { resolveTracks: impl.resolveTracks } : {}),
    ...(provider || {}),
  };

  const SyncEngine = { getProvider: () => providerObj };
  const legacyPlaylistSyncEnabled = () => legacy;
  const getChannelOverride = () => channelOverride;
  const resolveProviderToken = async () => {
    const auth = { token, refreshTokenCb: async () => token };
    return auth;
  };
  const lbHydrationOpts = () => undefined;
  const achordion = {
    buildLocalPlaylistMirrorContext: (ctx) => ({ built: true, ...ctx }),
    pushPlaylistLinksToAchordion: (ctx) => { calls.achordion.push(ctx); },
  };

  const handlers = new Map();
  registerSyncCreateIpc({
    ipcMain: { handle: (c, fn) => handlers.set(c, fn) },
    SyncEngine,
    legacyPlaylistSyncEnabled,
    getChannelOverride,
    resolveProviderToken,
    lbHydrationOpts,
    achordion,
    syncLinks,
  });
  return { handlers, syncLinks, store, calls };
}

const TRACKS = [{ artist: 'A', title: 'T' }];

describe('sync:create-playlist — gates', () => {
  test('N-way mode stands the legacy create gateway down', async () => {
    const { handlers, calls } = makeHarness({ legacy: false });
    await expect(handlers.get('sync:create-playlist')(null, 'spotify', 'N', null, TRACKS, 'local-1')).resolves.toEqual({ success: true, skipped: 'nway-active' });
    expect(calls.createPlaylist).toEqual([]);
  });

  test('a provider without playlist capability is refused', async () => {
    const { handlers } = makeHarness({ playlistsCapability: false });
    await expect(handlers.get('sync:create-playlist')(null, 'spotify', 'N', null, [], null)).resolves.toEqual({ success: false, error: 'Provider does not support playlists' });
  });

  test('the channel override blocks creates for providers the user turned off', async () => {
    const { handlers, calls } = makeHarness({ channelOverride: ['applemusic'] });
    await expect(handlers.get('sync:create-playlist')(null, 'spotify', 'N', null, [], 'local-1')).resolves.toEqual({ success: false, error: 'channel-not-selected' });
    expect(calls.createPlaylist).toEqual([]);
  });

  test('no provider token → Not authenticated', async () => {
    const { handlers } = makeHarness({ token: null });
    await expect(handlers.get('sync:create-playlist')(null, 'spotify', 'N', null, [], 'local-1')).resolves.toEqual({ success: false, error: 'Not authenticated' });
  });
});

describe('sync:create-playlist — the three-layer dedup', () => {
  test('Layer 1: a durable ID link pointing at a live owned remote is reused, never recreated', async () => {
    const { handlers, syncLinks, calls } = makeHarness({
      provider: {
        fetchPlaylists: async () => ({ playlists: [{ externalId: 'sp-existing', name: 'Other name', isOwnedByUser: true, trackCount: 5 }] }),
      },
    });
    syncLinks.setSyncLink('local-1', 'spotify', 'sp-existing');
    const result = await handlers.get('sync:create-playlist')(null, 'spotify', 'My List', null, TRACKS, 'local-1');
    expect(result).toEqual({
      success: true,
      externalId: 'sp-existing',
      snapshotId: 'snap-upd',
      unresolvedTracks: [],
      linkedToExisting: true,
      linkSource: 'id-link',
    });
    expect(calls.createPlaylist).toEqual([]);
    expect(calls.updatePlaylistTracks).toEqual([{ externalId: 'sp-existing', resolved: [{ artist: 'A', title: 'T', nativeId: 'n0' }], tok: 'TOKEN' }]);
  });

  test('Layer 1 stale link: a successful fetch that lacks the id clears the link and falls through', async () => {
    const { handlers, syncLinks, calls } = makeHarness();
    syncLinks.setSyncLink('local-1', 'spotify', 'sp-gone');
    const result = await handlers.get('sync:create-playlist')(null, 'spotify', 'Fresh', null, TRACKS, 'local-1');
    expect(result.success).toBe(true);
    expect(result.externalId).toBe('NEW-1'); // fell through to create
    expect(syncLinks.getSyncLinks()['local-1'].spotify.externalId).toBe('NEW-1'); // link refreshed
    expect(calls.createPlaylist).toEqual([{ name: 'Fresh', description: null }]);
  });

  test('parachord#846 with a link: fetchPlaylists failing is retryable and PRESERVES the link', async () => {
    const { handlers, syncLinks, calls } = makeHarness({
      provider: { fetchPlaylists: async () => { throw new Error('503'); } },
    });
    syncLinks.setSyncLink('local-1', 'spotify', 'sp-existing');
    const result = await handlers.get('sync:create-playlist')(null, 'spotify', 'My List', null, TRACKS, 'local-1');
    expect(result.success).toBe(false);
    expect(result.retryable).toBe(true);
    expect(syncLinks.getSyncLinks()['local-1'].spotify.externalId).toBe('sp-existing'); // preserved
    expect(calls.createPlaylist).toEqual([]);
  });

  test('parachord#846 without a link: a failed fetch skips name-match AND create (no runaway duplicates)', async () => {
    const { handlers, calls } = makeHarness({
      provider: { fetchPlaylists: async () => { throw new Error('429'); } },
    });
    const result = await handlers.get('sync:create-playlist')(null, 'spotify', 'My List', null, TRACKS, 'local-1');
    expect(result.success).toBe(false);
    expect(result.retryable).toBe(true);
    expect(calls.createPlaylist).toEqual([]);
  });

  test('Layer 2: name-match picks the richest owned candidate', async () => {
    const { handlers, calls } = makeHarness({
      provider: {
        fetchPlaylists: async () => ({
          playlists: [
            { externalId: 'sp-1', name: 'My List', isOwnedByUser: true, trackCount: 2 },
            { externalId: 'sp-2', name: 'my list', isOwnedByUser: true, trackCount: 40 },
            { externalId: 'sp-3', name: 'My List', isOwnedByUser: false, trackCount: 99 }, // followed, not owned
          ],
        }),
      },
    });
    const result = await handlers.get('sync:create-playlist')(null, 'spotify', 'MY LIST', null, TRACKS, 'local-1');
    expect(result).toMatchObject({ success: true, externalId: 'sp-2', linkedToExisting: true, linkSource: 'name-match (2 candidates)' });
    expect(calls.createPlaylist).toEqual([]);
  });

  test('Layer 3 / #950: an imported playlist never re-exports onto a same-named followed remote', async () => {
    const { handlers, calls } = makeHarness({
      // A listenbrainz-* local exporting to a streaming provider is opt-in
      // gated; the override admits it so the test reaches the non-owned guard.
      channelOverride: ['spotify'],
      provider: {
        fetchPlaylists: async () => ({ playlists: [{ externalId: 'sp-f', name: 'Their List', isOwnedByUser: false, ownerId: 'someone' }] }),
      },
    });
    const result = await handlers.get('sync:create-playlist')(null, 'spotify', 'Their List', null, TRACKS, 'listenbrainz-mb-1');
    expect(result).toEqual({ success: false, error: 'non-owned-source', skipped: 'non-owned-source' });
    expect(calls.createPlaylist).toEqual([]);
  });
});

describe('sync:create-playlist — the create path', () => {
  test('clean create: resolves, creates, records the link, pushes tracks', async () => {
    const { handlers, syncLinks, calls } = makeHarness();
    const result = await handlers.get('sync:create-playlist')(null, 'spotify', 'Fresh', 'desc', TRACKS, 'local-1');
    expect(result).toEqual({ success: true, externalId: 'NEW-1', snapshotId: 'snap-upd', unresolvedTracks: [] });
    expect(syncLinks.getSyncLinks()['local-1'].spotify.externalId).toBe('NEW-1');
    expect(calls.createPlaylist).toEqual([{ name: 'Fresh', description: 'desc' }]);
    expect(calls.updatePlaylistTracks).toEqual([{ externalId: 'NEW-1', resolved: [{ artist: 'A', title: 'T', nativeId: 'n0' }], tok: 'TOKEN' }]);
  });

  test('no-empty-create guard: zero resolved of a non-empty local does not create an empty remote', async () => {
    const { handlers, calls } = makeHarness({
      provider: { resolveTracks: async () => ({ resolved: [], unresolved: [{ artist: 'A', title: 'T' }] }) },
    });
    const result = await handlers.get('sync:create-playlist')(null, 'listenbrainz', 'Empty', null, TRACKS, 'local-1');
    expect(result).toEqual({ success: false, error: 'no-resolvable-tracks', unresolvedTracks: [{ artist: 'A', title: 'T' }] });
    expect(calls.createPlaylist).toEqual([]);
  });

  test('track-push failure after a successful create still reports success (remote exists; syncedTo must attach)', async () => {
    const { handlers, syncLinks } = makeHarness({
      provider: { updatePlaylistTracks: async () => { throw new Error('push blew up'); } },
    });
    const result = await handlers.get('sync:create-playlist')(null, 'spotify', 'Fresh', null, TRACKS, 'local-1');
    expect(result.success).toBe(true);
    expect(result.externalId).toBe('NEW-1');
    expect(result.unresolvedTracks).toEqual([{ artist: 'A', title: 'T' }]); // mapped back to metadata
    expect(syncLinks.getSyncLinks()['local-1'].spotify.externalId).toBe('NEW-1');
  });

  test('Achordion playlist-links fire when LB is involved, and only then', async () => {
    const lb = makeHarness();
    await lb.handlers.get('sync:create-playlist')(null, 'listenbrainz', 'LB List', null, TRACKS, 'local-1');
    expect(lb.calls.achordion).toEqual([{ built: true, localPlaylistId: 'local-1', providerId: 'listenbrainz', externalId: 'NEW-1', name: 'LB List', tracks: TRACKS }]);

    const spotify = makeHarness();
    await spotify.handlers.get('sync:create-playlist')(null, 'spotify', 'SP List', null, TRACKS, 'local-1');
    expect(spotify.calls.achordion).toEqual([]);
  });
});

describe('sync:resolve-tracks', () => {
  test('delegates to the provider with the resolved token', async () => {
    const { handlers, calls } = makeHarness();
    const result = await handlers.get('sync:resolve-tracks')(null, 'spotify', TRACKS);
    expect(result).toEqual({ success: true, resolved: [{ artist: 'A', title: 'T', nativeId: 'n0' }], unresolved: [] });
    expect(calls.resolveTracks).toEqual([TRACKS]);
  });

  test('no token → Not authenticated', async () => {
    const { handlers } = makeHarness({ token: null });
    await expect(handlers.get('sync:resolve-tracks')(null, 'spotify', TRACKS)).resolves.toEqual({ success: false, error: 'Not authenticated' });
  });

  test('provider without resolveTracks → capability error', async () => {
    const { handlers } = makeHarness({ provider: { resolveTracks: undefined } });
    await expect(handlers.get('sync:resolve-tracks')(null, 'spotify', TRACKS)).resolves.toEqual({ success: false, error: 'Provider does not support track resolution' });
  });
});
