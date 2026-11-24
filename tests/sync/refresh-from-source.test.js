/**
 * Refreshing one synced playlist now (the playlist page's Refresh), without
 * waiting for the next full sync: the same rules as the background sync's
 * auto-pull (sync-engine/auto-pull.js), applied to one playlist the moment
 * it's asked. refreshFromSource is the pure decision; the page fetches the
 * tracks and saves what it answers.
 */
const { refreshFromSource, sourceOwnsPlaylist, tracksFingerprint } = require('../../sync-engine/auto-pull');

const A = [{ title: 'One', artist: 'X' }, { title: 'Two', artist: 'Y' }];
const B = [{ title: 'Three', artist: 'Z' }];
const NOW = 5000;
const synced = (over = {}) => ({
  id: 'spotify-1',
  tracks: A,
  syncedFrom: { resolver: 'spotify', externalId: '1', snapshotId: 'snap-1', ownerId: 'someone', tracksFingerprint: tracksFingerprint(A) },
  syncSources: { spotify: { syncedAt: 1000 } },
  lastModified: 1000,
  locallyModified: false,
  hasUpdates: false,
  ...over,
});

describe('refreshFromSource', () => {
  test('the service has the same tracks: already up to date, nothing to save', () => {
    expect(refreshFromSource(synced(), { tracks: A, snapshotId: 'snap-1' }, { now: NOW })).toEqual({ outcome: 'unchanged', playlist: null });
  });

  test('the service changed and nothing was edited here: its tracks come in now', () => {
    const r = refreshFromSource(synced(), { tracks: B, snapshotId: 'snap-2' }, { now: NOW });
    expect(r.outcome).toBe('pulled');
    expect(r.playlist.tracks).toEqual(B);
    expect(r.playlist.syncedFrom).toMatchObject({ snapshotId: 'snap-2', tracksFingerprint: tracksFingerprint(B) });
    expect(r.playlist.syncSources.spotify.syncedAt).toBe(NOW);
    expect(r.playlist.hasUpdates).toBe(false);
  });

  test('edited here and the service is where it was: your edits stand, nothing to save', () => {
    const edited = [...A, { title: 'Added here', artist: 'W' }];
    expect(refreshFromSource(synced({ tracks: edited, locallyModified: true, lastModified: 2000 }), { tracks: A, snapshotId: 'snap-1' }, { now: NOW }))
      .toEqual({ outcome: 'unchanged', playlist: null });
  });

  test('edited here and changed on the service: a conflict for the banner, your tracks kept', () => {
    const edited = [...A, { title: 'Added here', artist: 'W' }];
    const r = refreshFromSource(synced({ tracks: edited, locallyModified: true, lastModified: 2000 }), { tracks: B, snapshotId: 'snap-2' }, { now: NOW });
    expect(r.outcome).toBe('conflict');
    expect(r.playlist.tracks).toEqual(edited);
    expect(r.playlist.hasUpdates).toBe(true);
  });

  test('a playlist the service itself owns (Daily Brew, owner spotify) always takes the service\'s tracks', () => {
    const daily = synced({ syncedFrom: { ...synced().syncedFrom, ownerId: 'spotify' }, tracks: [...A, { title: 'x', artist: 'y' }], locallyModified: true, lastModified: 2000 });
    expect(sourceOwnsPlaylist(daily)).toBe(true);
    const r = refreshFromSource(daily, { tracks: B, snapshotId: 'snap-2' }, { now: NOW });
    expect(r.outcome).toBe('pulled');
    expect(r.playlist.tracks).toEqual(B);
  });

  test('an empty answer for a playlist with tracks changes nothing, and says it was empty (not "up to date")', () => {
    expect(refreshFromSource(synced(), { tracks: [], snapshotId: 'snap-2' }, { now: NOW })).toEqual({ outcome: 'empty', playlist: null });
  });

  test('not a synced import, or a hosted XSPF: nothing to refresh this way', () => {
    expect(refreshFromSource({ id: 'p', tracks: A }, { tracks: B }, { now: NOW })).toEqual({ outcome: 'not-synced', playlist: null });
    expect(refreshFromSource(synced({ sourceUrl: 'https://x/a.xspf', source: 'hosted' }), { tracks: B }, { now: NOW })).toEqual({ outcome: 'not-synced', playlist: null });
  });
});

describe('sourceOwnsPlaylist', () => {
  test('owned by the service it syncs from, by the stored owner, never by a name', () => {
    expect(sourceOwnsPlaylist(synced({ syncedFrom: { resolver: 'spotify', ownerId: 'spotify' } }))).toBe(true);
    expect(sourceOwnsPlaylist(synced())).toBe(false);
    expect(sourceOwnsPlaylist(synced({ syncedFrom: { resolver: 'applemusic' } }))).toBe(false);
    expect(sourceOwnsPlaylist(null)).toBe(false);
  });
});

describe('the playlist page\'s Refresh', () => {
  const page = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'src', 'renderer', 'components', 'playlist-view-page.js'), 'utf8');
  const block = page.slice(page.indexOf('// Refresh a playlist imported from a service now'), page.indexOf('// Edit / Cancel+Done buttons'));

  test('shows for a service import with no link, not while editing or for an ephemeral playlist', () => {
    expect(block).toContain('if (!playlist || playlist.isEphemeral || playlistEditMode || playlist.sourceUrl) return null;');
    expect(block).toContain('if (!from || !from.resolver || !from.externalId) return null;');
  });

  test('fetches that one playlist and applies the background sync\'s rules, then saves what changed', () => {
    expect(block).toContain('window.electron.sync.fetchPlaylistTracks(from.resolver, from.externalId)');
    expect(block).toContain('refreshFromSource(playlist, fetched, { now: Date.now() })');
    expect(block).toContain('await savePlaylistToStore(next);');
  });

  test('says what happened, in the service\'s name, and is busy while it runs', () => {
    expect(block).toContain('`Already up to date with ${serviceName}`');
    expect(block).toContain('`This playlist changed on ${serviceName} and here. Choose which to keep above.`');
    expect(block).toContain('busy: refreshing,');
    expect(block).toContain('const serviceName = pluginName(from.resolver);');
  });
});

describe('the Refresh says what came back, and logs it', () => {
  const page = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'src', 'renderer', 'components', 'playlist-view-page.js'), 'utf8');
  const block = page.slice(page.indexOf('// Refresh a playlist imported from a service now'), page.indexOf('// Edit / Cancel+Done buttons'));
  test('an empty answer has its own message', () => {
    expect(block).toContain("`${serviceName} sent no tracks for this playlist, so it’s left as it is.`");
  });
  test('the diagnostic log records the counts, whether they matched, and the outcome', () => {
    expect(block).toMatch(/console\.log\(`🔄 Refresh "\$\{playlist\.title\}" from \$\{from\.resolver\}: \$\{fetched\.tracks\.length\} fetched, \$\{\(playlist\.tracks \|\| \[\]\)\.length\} here/);
  });
});
