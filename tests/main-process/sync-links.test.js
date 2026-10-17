/**
 * main-process/sync-links.js — the durable local→remote playlist ID map,
 * driven with an in-memory store fake.
 */

const { createSyncLinks } = require('../../main-process/sync-links');

function makeStore(initial = {}) {
  const data = { ...initial };
  return {
    data,
    get: (k) => data[k],
    set: (k, v) => { data[k] = v; },
  };
}

function makeHarness(initial = {}) {
  const store = makeStore(initial);
  const syncLinks = createSyncLinks({ store });
  const handlers = new Map();
  syncLinks.registerSyncLinksIpc({ ipcMain: { handle: (c, fn) => handlers.set(c, fn) } });
  return { store, syncLinks, handlers };
}

describe('createSyncLinks', () => {
  test('setSyncLink writes entries under [local][provider] with a syncedAt', () => {
    const { store, syncLinks } = makeHarness();
    syncLinks.setSyncLink('local-1', 'spotify', 'sp-9');
    expect(store.data.sync_playlist_links['local-1'].spotify.externalId).toBe('sp-9');
    expect(store.data.sync_playlist_links['local-1'].spotify.syncedAt).toBeGreaterThan(0);
  });

  test('setSyncLink ignores incomplete ids (never writes a null link)', () => {
    const { store, syncLinks } = makeHarness();
    syncLinks.setSyncLink(null, 'spotify', 'sp-9');
    syncLinks.setSyncLink('local-1', 'spotify', '');
    expect(store.data.sync_playlist_links).toBeUndefined();
  });

  test('removeSyncLink drops one provider, then the emptied local bucket', () => {
    const { store, syncLinks } = makeHarness({
      sync_playlist_links: {
        'local-1': { spotify: { externalId: 'sp-1', syncedAt: 1 }, applemusic: { externalId: 'am-1', syncedAt: 1 } },
      },
    });
    syncLinks.removeSyncLink('local-1', 'spotify');
    expect(store.data.sync_playlist_links['local-1']).toEqual({ applemusic: { externalId: 'am-1', syncedAt: 1 } });
    syncLinks.removeSyncLink('local-1', 'applemusic');
    expect(store.data.sync_playlist_links['local-1']).toBeUndefined();
  });

  test('removeSyncLink without a provider drops the whole local entry', () => {
    const { store, syncLinks } = makeHarness({
      sync_playlist_links: { 'local-1': { spotify: { externalId: 'sp-1', syncedAt: 1 } } },
    });
    syncLinks.removeSyncLink('local-1');
    expect(store.data.sync_playlist_links).toEqual({});
  });

  test('migrateSyncLinksFromPlaylists backfills from syncedTo and is idempotent', () => {
    const { store, syncLinks } = makeHarness({
      local_playlists: [
        { id: 'local-1', syncedTo: { spotify: { externalId: 'sp-1', syncedAt: 111 } } },
        { id: 'local-2', syncedTo: { listenbrainz: { externalId: 'lb-2' } } },
        { id: 'local-3', syncedTo: {} },
        { noId: true },
      ],
      sync_playlist_links: { 'local-1': { spotify: { externalId: 'sp-1', syncedAt: 111 } } },
    });
    syncLinks.migrateSyncLinksFromPlaylists();
    const links = store.data.sync_playlist_links;
    expect(links['local-1'].spotify).toEqual({ externalId: 'sp-1', syncedAt: 111 }); // untouched
    expect(links['local-2'].listenbrainz.externalId).toBe('lb-2');
    expect(links['local-2'].listenbrainz.syncedAt).toBeGreaterThan(0); // defaults to now
    expect(links['local-3']).toBeUndefined();
    // Second run adds nothing
    syncLinks.migrateSyncLinksFromPlaylists();
    expect(store.data.sync_playlist_links).toEqual(links);
  });

  test('registers the sync-links:* IPC surface', async () => {
    const { syncLinks, handlers } = makeHarness();
    expect([...handlers.keys()].sort()).toEqual(['sync-links:get-all', 'sync-links:remove', 'sync-links:set']);
    syncLinks.setSyncLink('local-1', 'spotify', 'sp-1');
    await expect(handlers.get('sync-links:get-all')()).resolves.toEqual({
      'local-1': { spotify: { externalId: 'sp-1', syncedAt: expect.any(Number) } },
    });
    await expect(handlers.get('sync-links:set')(null, 'local-1', 'applemusic', 'am-1')).resolves.toEqual({ success: true });
    await expect(handlers.get('sync-links:remove')(null, 'local-1', 'applemusic')).resolves.toEqual({ success: true });
    expect(syncLinks.getSyncLinks()['local-1'].applemusic).toBeUndefined();
  });
});
