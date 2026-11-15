/**
 * src/renderer/lib/playlist-sync-banner.js: the playlist page's sync banner no
 * longer asks to "pull changes" (the next sync pulls them, see
 * sync-engine/auto-pull.js). It shows local edits waiting to be pushed and a
 * conflict, and an open playlist that a sync pulled is refreshed in place.
 */

const { syncBannerState, pulledOpenPlaylist } = require('../../src/renderer/lib/playlist-sync-banner');
const { tracksFingerprint } = require('../../sync-engine/auto-pull');

const OLD = [{ title: 'Old', artist: 'A' }];
const NEW = [{ title: 'New', artist: 'B' }];

const imported = (over = {}) => ({
  id: 'spotify-abc',
  tracks: OLD,
  syncedFrom: { resolver: 'spotify', externalId: 'abc', snapshotId: 'snap-1', tracksFingerprint: tracksFingerprint(OLD) },
  syncSources: { spotify: { syncedAt: 1000 } },
  lastModified: 1000,
  locallyModified: false,
  hasUpdates: false,
  ...over,
});

describe('syncBannerState', () => {
  test('nothing for a playlist that is not imported', () => {
    expect(syncBannerState({ id: 'playlist-1', tracks: OLD })).toBeNull();
  });

  test('a remote change alone shows nothing: the next sync pulls it', () => {
    expect(syncBannerState(imported({ hasUpdates: true }))).toBeNull();
  });

  test('local edits waiting to go to the source show the push state', () => {
    const state = syncBannerState(imported({ tracks: NEW, locallyModified: true, lastModified: 2000 }));
    expect(state).toEqual({ state: 'push', localIsNewer: true });
  });

  test('local edits plus a remote change are a conflict', () => {
    const state = syncBannerState(imported({ tracks: NEW, locallyModified: true, lastModified: 2000, hasUpdates: true }));
    expect(state.state).toBe('conflict');
  });

  test('the conflict stays visible after a later sync moved syncedAt past the edit', () => {
    const state = syncBannerState(imported({
      tracks: NEW, locallyModified: false, lastModified: 2000, hasUpdates: true, syncSources: { spotify: { syncedAt: 9000 } },
    }));
    expect(state).toEqual({ state: 'conflict', localIsNewer: false });
  });

  test('the flag a pull leaves for other mirrors is not a push', () => {
    expect(syncBannerState(imported({ locallyModified: true, lastModified: 5000 }))).toBeNull();
  });

  test('a dismissed push (flag cleared) is hidden, though the edit is still protected', () => {
    expect(syncBannerState(imported({ tracks: NEW, locallyModified: false, lastModified: 2000 }))).toBeNull();
  });

  test('a hosted XSPF only ever shows the push state', () => {
    const hosted = { sourceUrl: 'https://example.com/a.xspf', source: 'hosted' };
    expect(syncBannerState(imported({ ...hosted, hasUpdates: true }))).toBeNull();
    expect(syncBannerState(imported({ ...hosted, tracks: NEW, hasUpdates: true, locallyModified: true, lastModified: 2000 })).state).toBe('push');
  });
});

describe('pulledOpenPlaylist', () => {
  const pulled = imported({
    tracks: NEW,
    syncedFrom: { resolver: 'spotify', externalId: 'abc', snapshotId: 'snap-2', tracksFingerprint: tracksFingerprint(NEW) },
  });

  test('the stored record when the open playlist was pulled', () => {
    expect(pulledOpenPlaylist(imported(), [pulled])).toBe(pulled);
  });

  test('nothing when the stored record has the same snapshot', () => {
    expect(pulledOpenPlaylist(imported(), [imported()])).toBeNull();
  });

  test('nothing when the open view already shows those tracks', () => {
    expect(pulledOpenPlaylist({ ...pulled, syncedFrom: { ...pulled.syncedFrom, snapshotId: 'snap-1' } }, [pulled])).toBeNull();
  });

  test('nothing with no open playlist, or when it is not in the list', () => {
    expect(pulledOpenPlaylist(null, [pulled])).toBeNull();
    expect(pulledOpenPlaylist({ ...imported(), id: 'other' }, [pulled])).toBeNull();
  });
});
