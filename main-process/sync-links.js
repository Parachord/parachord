// main-process/sync-links.js — the durable local→remote playlist ID map.
//
// Primary duplicate-prevention is `syncedTo[providerId].externalId` on each
// local playlist. That field is fragile: any playlist-save path that forgets
// to forward it drops the link, and the next sync creates a remote duplicate.
//
// `sync_playlist_links` is an independent, write-only-from-main store keyed
// by local playlist ID. It's never written by renderer playlist saves, so it
// can't be clobbered by a save that omits fields. Before creating a playlist
// on a remote, we consult this map; if we already have a link, we verify the
// remote still exists and reuse it instead of creating a duplicate.
//
// Shape: { [localPlaylistId]: { [providerId]: { externalId, syncedAt } } }
//
// Extracted from main.js (maintainability plan Track 3, sync slice 1).
// `store` is injected; the renderer reads the map through the sync-links:*
// IPC handlers registered by registerSyncLinksIpc. Everything else in
// main-process consumes the returned functions directly.

function createSyncLinks({ store }) {
  function getSyncLinks() {
    return store.get('sync_playlist_links') || {};
  }

  function setSyncLink(localPlaylistId, providerId, externalId) {
    if (!localPlaylistId || !providerId || !externalId) return;
    const links = getSyncLinks();
    if (!links[localPlaylistId]) links[localPlaylistId] = {};
    links[localPlaylistId][providerId] = { externalId, syncedAt: Date.now() };
    store.set('sync_playlist_links', links);
  }

  function removeSyncLink(localPlaylistId, providerId) {
    if (!localPlaylistId) return;
    const links = getSyncLinks();
    if (!links[localPlaylistId]) return;
    if (providerId) {
      delete links[localPlaylistId][providerId];
      if (Object.keys(links[localPlaylistId]).length === 0) {
        delete links[localPlaylistId];
      }
    } else {
      delete links[localPlaylistId];
    }
    store.set('sync_playlist_links', links);
  }

  // Idempotent startup migration: populate the durable map from each local
  // playlist's syncedTo. Fire-and-forget at boot (reads/writes the store,
  // never the network).
  function migrateSyncLinksFromPlaylists() {
    try {
      const playlists = store.get('local_playlists') || [];
      const links = getSyncLinks();
      let added = 0;
      for (const p of playlists) {
        if (!p.id || !p.syncedTo) continue;
        for (const [providerId, info] of Object.entries(p.syncedTo)) {
          if (!info?.externalId) continue;
          const existing = links[p.id]?.[providerId];
          if (existing?.externalId === info.externalId) continue;
          if (!links[p.id]) links[p.id] = {};
          links[p.id][providerId] = {
            externalId: info.externalId,
            syncedAt: info.syncedAt || Date.now()
          };
          added++;
        }
      }
      if (added > 0) {
        store.set('sync_playlist_links', links);
        console.log(`[SyncLinks] Migrated ${added} playlist link(s) from syncedTo to sync_playlist_links`);
      }
    } catch (err) {
      console.warn('[SyncLinks] Migration failed (non-fatal):', err.message);
    }
  }

  function registerSyncLinksIpc({ ipcMain }) {
    ipcMain.handle('sync-links:get-all', async () => getSyncLinks());
    ipcMain.handle('sync-links:set', async (event, localPlaylistId, providerId, externalId) => {
      setSyncLink(localPlaylistId, providerId, externalId);
      return { success: true };
    });
    ipcMain.handle('sync-links:remove', async (event, localPlaylistId, providerId) => {
      removeSyncLink(localPlaylistId, providerId);
      return { success: true };
    });
  }

  return { getSyncLinks, setSyncLink, removeSyncLink, migrateSyncLinksFromPlaylists, registerSyncLinksIpc };
}

module.exports = { createSyncLinks };
