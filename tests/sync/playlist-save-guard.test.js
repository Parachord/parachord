/**
 * `playlists-save` replaces the stored record, so a stale renderer copy erased
 * mirror links (ten hosted playlists lost their Apple Music links and kept
 * losing their Spotify ones). The guard keeps an entry the save left out only
 * when the stored record and the durable link map agree on it.
 */

const { keepDroppedLinks } = require('../../sync-engine/playlist-save-guard');

const mirror = (externalId, extra = {}) => ({ externalId, snapshotId: 's', syncedAt: 1, unresolvedTracks: [], pendingAction: null, ...extra });

describe('keepDroppedLinks', () => {
  test('a save that leaves out a live link keeps it', () => {
    const stored = { id: 'hosted-1', syncedTo: { applemusic: mirror('p.1'), spotify: mirror('sp1') } };
    const incoming = { id: 'hosted-1', title: 'new', syncedTo: { spotify: mirror('sp1', { syncedAt: 2 }) } };
    const links = { 'hosted-1': { applemusic: { externalId: 'p.1' }, spotify: { externalId: 'sp1' } } };
    const { playlist, kept } = keepDroppedLinks(incoming, stored, links);
    expect(kept).toEqual(['applemusic']);
    expect(playlist.syncedTo.applemusic).toEqual(stored.syncedTo.applemusic);
    expect(playlist.syncedTo.spotify.syncedAt).toBe(2); // the save's own entry wins
    expect(playlist.title).toBe('new');
    expect(incoming.syncedTo.applemusic).toBeUndefined(); // not mutated
  });

  test('a save with no syncedTo at all keeps every live link', () => {
    const stored = { id: 'h', syncedTo: { spotify: mirror('sp1') } };
    const { playlist, kept } = keepDroppedLinks({ id: 'h' }, stored, { h: { spotify: { externalId: 'sp1' } } });
    expect(kept).toEqual(['spotify']);
    expect(playlist.syncedTo).toEqual({ spotify: stored.syncedTo.spotify });
  });

  test('a link already removed from the durable map stays removed', () => {
    const stored = { id: 'h', syncedTo: { spotify: mirror('sp1') } };
    const { playlist, kept } = keepDroppedLinks({ id: 'h', syncedTo: {} }, stored, { h: {} });
    expect(kept).toEqual([]);
    expect(playlist.syncedTo).toEqual({});
  });

  test('the durable map naming a different remote is not a reason to keep the stored one', () => {
    const stored = { id: 'h', syncedTo: { spotify: mirror('old') } };
    const { kept } = keepDroppedLinks({ id: 'h', syncedTo: {} }, stored, { h: { spotify: { externalId: 'new' } } });
    expect(kept).toEqual([]);
  });

  test('a new playlist, or a stored one with no links, passes through untouched', () => {
    const incoming = { id: 'n', syncedTo: {} };
    expect(keepDroppedLinks(incoming, undefined, {}).playlist).toBe(incoming);
    expect(keepDroppedLinks(incoming, { id: 'n' }, {}).playlist).toBe(incoming);
  });

  test('a link the durable map holds but the stored record never had is not invented', () => {
    // e.g. the map links an imported playlist to a hosted copy's remote
    const { kept } = keepDroppedLinks({ id: 'spotify-a', syncedTo: {} }, { id: 'spotify-a', syncedTo: {} }, { 'spotify-a': { spotify: { externalId: 'x' } } });
    expect(kept).toEqual([]);
  });
});

describe('playlists-save uses the guard', () => {
  test('the handler passes the stored record and the durable links through keepDroppedLinks', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../main.js'), 'utf8');
    const start = src.indexOf("ipcMain.handle('playlists-save'");
    const body = src.slice(start, src.indexOf('ipcMain.handle(', start + 1));
    expect(body).toMatch(/const existing = store\.getPlaylist\(playlistData\.id\)/);
    expect(body).toMatch(/keepDroppedLinks\(playlistData, existing, getSyncLinks\(\)\)/);
    expect(body).toMatch(/store\.savePlaylist\(guarded\)/);
    // One record per save, never the whole list (#801).
    expect(body).not.toMatch(/store\.set\('local_playlists'/);
  });
});
