// lib/playlist-mirrors.js: a playlist's remote copies, for delete cleanup.
const { getPlaylistMirrorTargets, PROVIDER_LABEL } = require('../../src/renderer/lib/playlist-mirrors');

test('the source first, then each push mirror with an id', () => {
  expect(getPlaylistMirrorTargets({
    syncedFrom: { resolver: 'spotify', externalId: 'sp1' },
    syncedTo: { applemusic: { externalId: 'am1' }, listenbrainz: {} },
  })).toEqual([
    { providerId: 'spotify', externalId: 'sp1', role: 'source' },
    { providerId: 'applemusic', externalId: 'am1', role: 'mirror' },
  ]);
});

test('nothing synced, or no playlist: no targets', () => {
  expect(getPlaylistMirrorTargets({ title: 'Local' })).toEqual([]);
  expect(getPlaylistMirrorTargets(null)).toEqual([]);
  expect(getPlaylistMirrorTargets({ syncedFrom: { resolver: 'spotify' } })).toEqual([]);
});

test('labels for the sync services', () => {
  expect(PROVIDER_LABEL.applemusic).toBe('Apple Music');
});
