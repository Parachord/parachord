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

// The playlist page's "where it syncs" badges (#1640): one per push mirror,
// whether or not the playlist was pulled from a service. The pull source is
// left out (its "Source: X" line already says it). Mobile's rule:
// PlaylistOrigin.pushMirrors.
describe('pushMirrors', () => {
  const { pushMirrors } = require('../../src/renderer/lib/playlist-mirrors');

  test('a pulled playlist lists the services it pushes to, not its source', () => {
    expect(pushMirrors({
      syncedFrom: { resolver: 'spotify', externalId: 'sp1' },
      syncedTo: { applemusic: { externalId: 'am1' }, listenbrainz: { externalId: 'lb1' } },
    })).toEqual(['applemusic', 'listenbrainz']);
  });

  test('a source pushed back to (syncedTo of the source itself) is not a mirror', () => {
    expect(pushMirrors({
      syncedFrom: { resolver: 'spotify', externalId: 'sp1' },
      syncedTo: { spotify: { externalId: 'sp1' }, applemusic: { externalId: 'am1' } },
    })).toEqual(['applemusic']);
  });

  test('a local playlist lists every service it syncs to', () => {
    expect(pushMirrors({ syncedTo: { spotify: { externalId: 'x' }, applemusic: { externalId: 'y' } } })).toEqual(['spotify', 'applemusic']);
  });

  test('nothing to show', () => {
    expect(pushMirrors({ syncedFrom: { resolver: 'spotify' }, syncedTo: { spotify: { externalId: 'sp1' } } })).toEqual([]);
    expect(pushMirrors({ syncedFrom: { resolver: 'spotify' } })).toEqual([]);
    expect(pushMirrors(null)).toEqual([]);
  });
});

describe('the playlist page draws a badge per push mirror', () => {
  const page = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/components/playlist-view-page.js'), 'utf8');
  test('from pushMirrors, never only for playlists without a source', () => {
    expect(page).not.toMatch(/selectedPlaylist\?\.syncedTo && !selectedPlaylist\.syncedFrom/);
    expect(page).toMatch(/\.\.\.mirrors\.map\(pid =>/);
    expect(page).toMatch(/const mirrors = pushMirrors\(selectedPlaylist\);/);
  });
});
