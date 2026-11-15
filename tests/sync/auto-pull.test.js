/**
 * sync-engine/auto-pull.js: a playlist imported from a service takes that
 * service's new version on the next sync, with no "pull changes" prompt, unless
 * the person has edited it here since the last sync (then it is a conflict and
 * the playlist page asks), or it is a hosted XSPF (the XSPF is the upstream).
 */

const {
  tracksFingerprint,
  hasRealLocalEdits,
  isHostedXspf,
  remoteUpdateAction,
  applyPulledTracks,
  keepEditsMadeDuringPull,
  seedTracksFingerprint,
  UNKNOWN_FINGERPRINT,
  shouldPushToSource,
  recordPushToSource,
} = require('../../sync-engine/auto-pull');

const imported = (over = {}) => ({
  id: 'spotify-abc',
  title: 'Imported',
  tracks: [{ title: 'Old', artist: 'A' }],
  syncedFrom: { resolver: 'spotify', externalId: 'abc', snapshotId: 'snap-1' },
  syncSources: { spotify: { syncedAt: 1000 } },
  lastModified: 1000,
  locallyModified: false,
  hasUpdates: false,
  ...over,
});

describe('tracksFingerprint', () => {
  const a = { title: 'One', artist: 'A' };
  const b = { title: 'Two', artist: 'B' };

  test('the same tracks give the same fingerprint, ids and sources aside', () => {
    expect(tracksFingerprint([a, b])).toBe(tracksFingerprint([{ ...a, id: 'x', sources: { spotify: {} } }, { ...b, album: 'Other' }]));
  });

  test('an added, removed or reordered track changes it', () => {
    const base = tracksFingerprint([a, b]);
    expect(tracksFingerprint([a, b, a])).not.toBe(base);
    expect(tracksFingerprint([a])).not.toBe(base);
    expect(tracksFingerprint([b, a])).not.toBe(base);
  });

  test('no tracks is a fingerprint too', () => {
    expect(typeof tracksFingerprint([])).toBe('string');
    expect(tracksFingerprint(undefined)).toBe(tracksFingerprint([]));
  });
});

describe('hasRealLocalEdits with a fingerprint', () => {
  const agreed = (tracks, over = {}) => imported({
    tracks,
    syncedFrom: { resolver: 'spotify', externalId: 'abc', snapshotId: 'snap-1', tracksFingerprint: tracksFingerprint(tracks) },
    ...over,
  });

  test('tracks that still match what the source last gave are not an edit, whatever the flags say', () => {
    const tracks = [{ title: 'Old', artist: 'A' }];
    expect(hasRealLocalEdits(agreed(tracks, { locallyModified: true, lastModified: 9000 }), 'spotify')).toBe(false);
  });

  test('tracks that differ are an edit, even after later syncs moved syncedAt and cleared the flag', () => {
    const pl = agreed([{ title: 'Old', artist: 'A' }]);
    const edited = { ...pl, tracks: [], locallyModified: false, lastModified: 2000, syncSources: { spotify: { syncedAt: 9000 } } };
    expect(hasRealLocalEdits(edited, 'spotify')).toBe(true);
  });
});

describe('hasRealLocalEdits without a fingerprint (playlists saved before it existed)', () => {
  test('an unedited import has none', () => {
    expect(hasRealLocalEdits(imported(), 'spotify')).toBe(false);
  });

  test('an edit after the last sync from the source counts', () => {
    expect(hasRealLocalEdits(imported({ locallyModified: true, lastModified: 2000 }), 'spotify')).toBe(true);
  });

  test('the flag a pull leaves for other mirrors is not an edit', () => {
    // A pull stamps lastModified and syncedAt with the same time.
    expect(hasRealLocalEdits(imported({ locallyModified: true, lastModified: 1000 }), 'spotify')).toBe(false);
  });

  test('a newer lastModified without the flag is not an edit', () => {
    expect(hasRealLocalEdits(imported({ lastModified: 5000 }), 'spotify')).toBe(false);
  });
});

describe('isHostedXspf', () => {
  test('a polled XSPF URL is hosted', () => {
    expect(isHostedXspf(imported({ sourceUrl: 'https://example.com/list.xspf', source: 'hosted' }))).toBe(true);
  });

  test('a provider URL import is a snapshot, not hosted', () => {
    expect(isHostedXspf(imported({ sourceUrl: 'https://open.spotify.com/playlist/abc', source: 'spotify-import' }))).toBe(false);
  });

  test('no sourceUrl is not hosted', () => {
    expect(isHostedXspf(imported())).toBe(false);
  });
});

describe('remoteUpdateAction', () => {
  test('an unedited import is pulled', () => {
    expect(remoteUpdateAction(imported(), 'spotify')).toBe('pull');
  });

  test('an import edited here is a conflict, never overwritten', () => {
    expect(remoteUpdateAction(imported({ locallyModified: true, lastModified: 2000 }), 'spotify')).toBe('conflict');
  });

  test('a hosted XSPF is never pulled', () => {
    expect(remoteUpdateAction(imported({ sourceUrl: 'https://example.com/a.xspf' }), 'spotify')).toBe('hosted');
  });

  test('a source-only playlist (Spotify-curated) is pulled even with local edits', () => {
    const edited = imported({ locallyModified: true, lastModified: 2000 });
    expect(remoteUpdateAction(edited, 'spotify', { sourceOnly: true })).toBe('pull');
  });
});

describe('applyPulledTracks', () => {
  const remotePlaylist = { externalId: 'abc', snapshotId: 'snap-2' };
  const newTracks = [{ title: 'New 1', artist: 'B' }, { title: 'New 2', artist: 'C' }];

  test('takes the remote tracks and snapshot and clears the update flag', () => {
    const out = applyPulledTracks(imported({ hasUpdates: true }), { providerId: 'spotify', remotePlaylist, tracks: newTracks, now: 5000 });
    expect(out.tracks).toEqual(newTracks);
    expect(out.syncedFrom).toEqual({ resolver: 'spotify', externalId: 'abc', snapshotId: 'snap-2', tracksFingerprint: tracksFingerprint(newTracks) });
    expect(out.hasUpdates).toBe(false);
    expect(out.locallyModified).toBe(false);
  });

  test('records the pulled tracks as agreed with the source', () => {
    const out = applyPulledTracks(imported(), { providerId: 'spotify', remotePlaylist, tracks: newTracks, now: 5000 });
    expect(hasRealLocalEdits(out, 'spotify')).toBe(false);
    expect(hasRealLocalEdits({ ...out, tracks: newTracks.slice(1) }, 'spotify')).toBe(true);
  });

  test('stamps lastModified and syncedAt alike, so the pull is not read as an edit', () => {
    const out = applyPulledTracks(imported(), { providerId: 'spotify', remotePlaylist, tracks: newTracks, now: 5000 });
    expect(out.lastModified).toBe(5000);
    expect(out.syncSources.spotify.syncedAt).toBe(5000);
    expect(hasRealLocalEdits(out, 'spotify')).toBe(false);
  });

  test('keeps every other field, sync links included', () => {
    const pl = imported({
      syncedTo: { applemusic: { externalId: 'p.1', syncedAt: 900 } },
      coverArt: 'https://img/x.jpg',
      localOnly: false,
      syncSources: { spotify: { syncedAt: 1000, addedAt: 10 }, applemusic: { syncedAt: 900 } },
    });
    const out = applyPulledTracks(pl, { providerId: 'spotify', remotePlaylist, tracks: newTracks, now: 5000 });
    expect(out.syncedTo).toEqual(pl.syncedTo);
    expect(out.coverArt).toBe('https://img/x.jpg');
    expect(out.syncSources.spotify.addedAt).toBe(10);
    expect(out.syncSources.applemusic).toEqual({ syncedAt: 900 });
  });

  test('flags the playlist for its other mirrors, so the push loop passes the pull on', () => {
    const pl = imported({ syncedTo: { applemusic: { externalId: 'p.1' } } });
    const out = applyPulledTracks(pl, { providerId: 'spotify', remotePlaylist, tracks: newTracks, now: 5000 });
    expect(out.locallyModified).toBe(true);
  });

  test('a mirror entry for the source itself is not another mirror', () => {
    const pl = imported({ syncedTo: { spotify: { externalId: 'abc' } } });
    const out = applyPulledTracks(pl, { providerId: 'spotify', remotePlaylist, tracks: newTracks, now: 5000 });
    expect(out.locallyModified).toBe(false);
  });

  test('an empty answer for a playlist that has tracks keeps the tracks (mobile parity)', () => {
    const pl = imported();
    const out = applyPulledTracks(pl, { providerId: 'spotify', remotePlaylist, tracks: [], now: 5000 });
    expect(out.tracks).toEqual(pl.tracks);
    expect(out.syncedFrom.snapshotId).toBe('snap-2');
    expect(out.syncedFrom.tracksFingerprint).toBe(tracksFingerprint(pl.tracks));
    expect(out.hasUpdates).toBe(false);
  });
});

describe('keepEditsMadeDuringPull', () => {
  const OLD = [{ title: 'Old', artist: 'A' }];
  const NEW = [{ title: 'New', artist: 'B' }];
  const pulled = imported({
    tracks: NEW,
    lastModified: 5000,
    hasUpdates: false,
    syncedFrom: { resolver: 'spotify', externalId: 'abc', snapshotId: 'snap-2', tracksFingerprint: tracksFingerprint(NEW) },
    syncSources: { spotify: { syncedAt: 5000 } },
  });
  const base = { lastModified: 1000, tracksFingerprint: tracksFingerprint(OLD) };

  test('with no save since the pull read the playlist, the pull is saved', () => {
    expect(keepEditsMadeDuringPull(pulled, imported(), base)).toBe(pulled);
  });

  test('an edit saved while the sync ran wins, and the playlist is left as a conflict', () => {
    const latest = imported({ tracks: [], locallyModified: true, lastModified: 3000 });
    const out = keepEditsMadeDuringPull(pulled, latest, base);
    expect(out.tracks).toEqual([]);
    expect(out.lastModified).toBe(3000);
    expect(out.syncedFrom.snapshotId).toBe('snap-1');
    expect(out.hasUpdates).toBe(true);
  });

  test('a save that moved lastModified but not the tracks (the resolved-sources flush, a rename) takes the pull on top', () => {
    const latest = imported({ title: 'Renamed', lastModified: 3000, tracks: OLD.map((t) => ({ ...t, sources: { spotify: { id: 'x' } } })) });
    const out = keepEditsMadeDuringPull(pulled, latest, base);
    expect(out.title).toBe('Renamed');
    expect(out.tracks).toEqual(NEW);
    expect(out.syncedFrom).toEqual(pulled.syncedFrom);
    expect(out.hasUpdates).toBe(false);
    expect(out.syncSources.spotify.syncedAt).toBe(5000);
  });

  test('no stored record means nothing to keep', () => {
    expect(keepEditsMadeDuringPull(pulled, undefined, base)).toBe(pulled);
  });
});

describe('seedTracksFingerprint (imports from before the fingerprint)', () => {
  const OLD = [{ title: 'Old', artist: 'A' }];
  const legacy = (over = {}) => imported({ tracks: OLD, syncedFrom: { resolver: 'spotify', externalId: 'abc', snapshotId: 'snap-1' }, ...over });

  test('an unedited one is taken as agreeing with its source', () => {
    const out = seedTracksFingerprint(legacy(), 'spotify');
    expect(out.syncedFrom.tracksFingerprint).toBe(tracksFingerprint(OLD));
    expect(hasRealLocalEdits(out, 'spotify')).toBe(false);
  });

  test('one flagged as edited is seeded with a fingerprint that never matches', () => {
    const out = seedTracksFingerprint(legacy({ locallyModified: true, lastModified: 2000 }), 'spotify');
    expect(out.syncedFrom.tracksFingerprint).toBe(UNKNOWN_FINGERPRINT);
    expect(hasRealLocalEdits(out, 'spotify')).toBe(true);
  });

  test('even a flag the old rule would discount counts: when in doubt it reads as edited', () => {
    const out = seedTracksFingerprint(legacy({ locallyModified: true, lastModified: 500 }), 'spotify');
    expect(out.syncedFrom.tracksFingerprint).toBe(UNKNOWN_FINGERPRINT);
  });

  test('the seed outlives a later sync that moves syncedAt (the old rule would forget it)', () => {
    const seeded = seedTracksFingerprint(legacy({ locallyModified: true, lastModified: 100, syncSources: { spotify: { syncedAt: 50 } } }), 'spotify');
    const afterUnchangedSync = { ...seeded, locallyModified: false, syncSources: { spotify: { syncedAt: 200 } } };
    expect(remoteUpdateAction(afterUnchangedSync, 'spotify')).toBe('conflict');
  });

  test('a record that has one, or another provider\'s import, is left alone', () => {
    const withOne = imported({ syncedFrom: { resolver: 'spotify', externalId: 'abc', tracksFingerprint: 'x' } });
    expect(seedTracksFingerprint(withOne, 'spotify')).toBe(withOne);
    const other = legacy();
    expect(seedTracksFingerprint(other, 'applemusic')).toBe(other);
    const notImported = { id: 'p', tracks: [] };
    expect(seedTracksFingerprint(notImported, 'spotify')).toBe(notImported);
  });
});

describe('shouldPushToSource (the push loop sending edits back to the playlist\'s own source)', () => {
  const OLD = [{ title: 'Old', artist: 'A' }];
  const NEW = [{ title: 'New', artist: 'B' }];
  const agreed = (over = {}) => imported({
    tracks: OLD,
    syncedFrom: { resolver: 'listenbrainz', externalId: 'mbid', snapshotId: 's1', tracksFingerprint: tracksFingerprint(OLD) },
    syncSources: { listenbrainz: { syncedAt: 1000 } },
    ...over,
  });

  test('only for the playlist\'s own source', () => {
    expect(shouldPushToSource(agreed({ tracks: NEW }), 'spotify')).toBe(false);
  });

  test('a real edit is pushed, even after unchanged syncs moved syncedAt and the flag was cleared', () => {
    expect(shouldPushToSource(agreed({ tracks: NEW, locallyModified: false, lastModified: 500, syncSources: { listenbrainz: { syncedAt: 9000 } } }), 'listenbrainz')).toBe(true);
  });

  test('a pull-induced flag with matching tracks is not pushed', () => {
    expect(shouldPushToSource(agreed({ locallyModified: true, lastModified: 5000 }), 'listenbrainz')).toBe(false);
  });

  test('a pending conflict is never pushed: the person picks on the playlist page', () => {
    expect(shouldPushToSource(agreed({ tracks: NEW, hasUpdates: true }), 'listenbrainz')).toBe(false);
  });

  test('an unknown seed falls back to the old rule (no burst of pushes after upgrade)', () => {
    const seeded = agreed({ syncedFrom: { resolver: 'listenbrainz', externalId: 'mbid', tracksFingerprint: UNKNOWN_FINGERPRINT } });
    expect(shouldPushToSource({ ...seeded, locallyModified: true, lastModified: 500 }, 'listenbrainz')).toBe(false);
    expect(shouldPushToSource({ ...seeded, locallyModified: true, lastModified: 2000 }, 'listenbrainz')).toBe(true);
  });

  test('a record with no fingerprint uses the old rule', () => {
    const legacy = agreed({ syncedFrom: { resolver: 'listenbrainz', externalId: 'mbid' }, locallyModified: true, lastModified: 2000 });
    expect(shouldPushToSource(legacy, 'listenbrainz')).toBe(true);
  });
});

describe('recordPushToSource', () => {
  const NEW = [{ title: 'New', artist: 'B' }];
  const pl = imported({
    tracks: NEW,
    syncedFrom: { resolver: 'listenbrainz', externalId: 'mbid', snapshotId: 's1', tracksFingerprint: 'old' },
    syncSources: { listenbrainz: { syncedAt: 1000, addedAt: 5 } },
    syncedTo: { applemusic: { externalId: 'p.1' } },
    hasUpdates: false,
  });

  test('records the pushed tracks as agreed and the source\'s new snapshot, so the next sync sees no change', () => {
    const out = recordPushToSource(pl, 'listenbrainz', { snapshotId: 's2', tracks: NEW, now: 7000 });
    expect(out.syncedFrom).toEqual({ resolver: 'listenbrainz', externalId: 'mbid', snapshotId: 's2', tracksFingerprint: tracksFingerprint(NEW) });
    expect(out.syncSources.listenbrainz).toEqual({ syncedAt: 7000, addedAt: 5 });
    expect(hasRealLocalEdits(out, 'listenbrainz')).toBe(false);
    expect(out.syncedTo).toEqual(pl.syncedTo);
  });

  test('no snapshot from the push keeps the old one (the next sync pulls our own tracks back, which is no change)', () => {
    expect(recordPushToSource(pl, 'listenbrainz', { snapshotId: undefined, tracks: NEW, now: 7000 }).syncedFrom.snapshotId).toBe('s1');
  });

  test('a push to another remote on the same service (an owned copy, not the source) changes nothing here', () => {
    expect(recordPushToSource(pl, 'listenbrainz', { externalId: 'other-mbid', snapshotId: 's2', tracks: NEW, now: 7000 })).toBe(pl);
    expect(recordPushToSource(pl, 'listenbrainz', { externalId: 'mbid', snapshotId: 's2', tracks: NEW, now: 7000 }).syncedFrom.snapshotId).toBe('s2');
  });

  test('a push to a mirror that is not the source changes nothing here', () => {
    expect(recordPushToSource(pl, 'applemusic', { snapshotId: 'x', tracks: NEW, now: 7000 })).toBe(pl);
  });
});
