/**
 * main-process/ipc/sync-playlists.js — the remaining sync surface, driven with
 * fakes: the registration surface, getSyncProviderToken's sync MusicKit read
 * (the readGeneratedMusicKitToken injection — must stay non-Promise), the thin
 * delegation handlers, cleanup's relink phase, and the tombstone IPC delegation.
 */

const { registerSyncPlaylistsIpc } = require('../../main-process/ipc/sync-playlists');
const { createSyncLinks } = require('../../main-process/sync-links');

const LB_STORE = { 'scrobbler-config-listenbrainz': { userToken: 'LB-TOK' } };

function makeStore(initial = {}) {
  const data = { ...initial };
  return { data, get(k) { return this.data[k]; }, set(k, v) { this.data[k] = v; } };
}

function makeHarness({ provider = {}, storeData = {}, generatedToken = 'AM-DEV', relinkResult = null } = {}) {
  const store = makeStore(storeData);
  const syncLinks = createSyncLinks({ store });
  const handlers = new Map();
  const calls = { provider: [], relink: [], achordion: [], deletes: [] };

  const providerObj = {
    id: 'fake',
    capabilities: { playlists: true, tracks: true, albums: true, artists: true },
    fetchPlaylists: async (...a) => { calls.provider.push({ method: 'fetchPlaylists', args: a }); return { playlists: [] }; },
    fetchPlaylistTracks: async (...a) => { calls.provider.push({ method: 'fetchPlaylistTracks', args: a }); return { tracks: [] }; },
    updatePlaylistTracks: async (...a) => { calls.provider.push({ method: 'updatePlaylistTracks', args: a }); return { snapshotId: 'snap' }; },
    saveTracks: async (...a) => { calls.provider.push({ method: 'saveTracks', args: a }); return { saved: [] }; },
    unfollowArtists: async (...a) => { calls.provider.push({ method: 'unfollowArtists', args: a }); return { unfollowed: [] }; },
    deletePlaylist: async (...a) => { calls.provider.push({ method: 'deletePlaylist', args: a }); return { success: true }; },
    ...(provider || {}),
  };
  const SyncEngine = { getProvider: () => providerObj };

  registerSyncPlaylistsIpc({
    ipcMain: { handle: (c, fn) => handlers.set(c, fn) },
    SyncEngine,
    store,
    ensureValidSpotifyToken: async () => 'SP-TOK',
    awaitGeneratedMusicKitToken: async () => generatedToken,
    readGeneratedMusicKitToken: () => generatedToken,
    lbHydrationOpts: () => undefined,
    getChannelOverride: () => null,
    legacyPlaylistSyncEnabled: () => true,
    relinkOrphansFor: (providerId, owned) => { calls.relink.push({ providerId, owned }); return relinkResult; },
    removePlaylistSyncState: () => {},
    buildAppleMusicRefreshCb: () => async () => 'AM-TOK',
    deleteRemotePlaylistBestEffort: (providerId, externalId) => { calls.deletes.push({ providerId, externalId }); return Promise.resolve(true); },
    achordion: {
      buildLocalPlaylistMirrorContext: (ctx) => ({ built: true, ...ctx }),
      pushPlaylistLinksToAchordion: (ctx) => { calls.achordion.push(ctx); },
    },
    syncLinks,
  });
  return { handlers, store, syncLinks, calls, providerObj };
}

const CHANNELS = [
  'sync:cleanup-duplicate-playlists', 'sync:fetch-playlist-tracks', 'sync:fetch-playlists',
  'sync:follow-artists', 'sync:push-playlist', 'sync:relink-orphaned-playlists',
  'sync:remove-albums', 'sync:remove-tracks', 'sync:save-albums', 'sync:save-tracks',
  'sync:tombstones:add-batch', 'sync:tombstones:clear-batch', 'sync:tombstones:list',
  'sync:unfollow-artists',
];

describe('sync-playlists IPC surface', () => {
  test('registers the full remaining sync channel surface', () => {
    const { handlers } = makeHarness();
    expect([...handlers.keys()].sort()).toEqual(CHANNELS);
  });

  test('getSyncProviderToken stays synchronous — the applemusic read returns a value, not a Promise', async () => {
    const { handlers, calls } = makeHarness({ storeData: { applemusic_user_token: 'AM-USER' } });
    const result = await handlers.get('sync:save-tracks')(null, 'applemusic', ['id1']);
    expect(result).toEqual({ success: true, saved: [] });
    const saveCall = calls.provider.find((c) => c.method === 'saveTracks');
    expect(saveCall).toBeTruthy();
    expect(typeof saveCall.args[1]).toBe('string'); // a value, never a Promise
    expect(JSON.parse(saveCall.args[1])).toEqual({ developerToken: 'AM-DEV', userToken: 'AM-USER' });
  });

  test('sync:fetch-playlists delegates and returns playlists + folders', async () => {
    const { handlers } = makeHarness({
      storeData: { applemusic_user_token: 'AM-USER' },
      provider: { fetchPlaylists: async () => ({ playlists: [{ externalId: 'p1', name: 'List' }], folders: [] }) },
    });
    await expect(handlers.get('sync:fetch-playlists')(null, 'applemusic')).resolves.toEqual({
      success: true,
      playlists: [{ externalId: 'p1', name: 'List' }],
      folders: [],
    });
  });

  test('sync:push-playlist resolves a token and pushes via updatePlaylistTracks', async () => {
    const { handlers, calls } = makeHarness({
      storeData: LB_STORE,
      provider: { fetchPlaylists: async () => ({ playlists: [] }) },
    });
    const result = await handlers.get('sync:push-playlist')(null, 'listenbrainz', 'lb-1', [{ artist: 'A', title: 'T', mbid: 'm' }], { name: 'L' });
    expect(result.success).toBe(true);
    const update = calls.provider.find((c) => c.method === 'updatePlaylistTracks');
    expect(update.args[0]).toBe('lb-1');
    expect(update.args[1]).toBeTruthy(); // the resolve/push payload
  });

  test('sync:cleanup-duplicate-playlists runs the relink phase, then dedup keeps the richest linked remote', async () => {
    const { handlers, calls } = makeHarness({
      relinkResult: { relinked: 2, ambiguous: [] },
      storeData: { applemusic_user_token: 'AM-USER' },
      provider: {
        fetchPlaylists: async () => ({
          playlists: [
            { externalId: 'sp-a', name: 'Twin', isOwnedByUser: true, trackCount: 3, snapshotId: 's1' },
            { externalId: 'sp-b', name: 'twin', isOwnedByUser: true, trackCount: 9, snapshotId: 's2' },
          ],
        }),
        deletePlaylist: async () => ({ success: true }),
      },
    });
    const result = await handlers.get('sync:cleanup-duplicate-playlists')(null, 'applemusic');
    expect(result.success).toBe(true);
    expect(calls.relink).toEqual([{ providerId: 'applemusic', owned: expect.any(Array) }]);
    // The thinner twin is deleted; the richest (sp-b, 9 tracks) is the kept one.
    expect(result.deleted).toBe(1);
    expect(result.groups).toEqual([{ name: 'twin', kept: { externalId: 'sp-b', trackCount: 9 }, deleted: 1 }]);
  });

  test('sync:relink-orphaned-playlists delegates to relinkOrphansFor', async () => {
    const { handlers, calls } = makeHarness({
      storeData: { applemusic_user_token: 'AM-USER' },
      provider: { fetchPlaylists: async () => ({ playlists: [{ externalId: 'sp-a', name: 'X', isOwnedByUser: true, trackCount: 1 }] }) },
    });
    const result = await handlers.get('sync:relink-orphaned-playlists')(null, 'applemusic');
    expect(result.success).toBe(true);
    expect(calls.relink.length).toBe(1);
  });

  test('the tombstone IPC delegates to the Tombstones module against the store', async () => {
    const { handlers } = makeHarness();
    await expect(handlers.get('sync:tombstones:add-batch')(null, [{ providerId: 'spotify', externalId: 'sp-1' }])).resolves.toMatchObject({ success: true, written: 1 });
    const list = await handlers.get('sync:tombstones:list')();
    expect(list.spotify['sp-1']).toBeTruthy();
    await expect(handlers.get('sync:tombstones:clear-batch')(null, [{ providerId: 'spotify', externalId: 'sp-1' }])).resolves.toMatchObject({ success: true, cleared: 1 });
    expect(await handlers.get('sync:tombstones:list')()).toEqual({});
  });

  test('sync:unfollow-artists gates on capability and delegates with the resolved token', async () => {
    const ok = makeHarness({ storeData: LB_STORE });
    await expect(ok.handlers.get('sync:unfollow-artists')(null, 'listenbrainz', ['a1'])).resolves.toEqual({ success: true, unfollowed: [] });
    const noCap = makeHarness({ provider: { capabilities: { artists: false } } });
    await expect(noCap.handlers.get('sync:unfollow-artists')(null, 'listenbrainz', ['a1'])).resolves.toEqual({
      success: false, error: 'Provider does not support artist syncing',
    });
  });
});
