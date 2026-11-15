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
  const pulled = imported({ tracks: [{ title: 'New', artist: 'B' }], lastModified: 5000, syncedFrom: { resolver: 'spotify', externalId: 'abc', snapshotId: 'snap-2' } });

  test('with no edit since the pull read the playlist, the pull is saved', () => {
    const latest = imported();
    expect(keepEditsMadeDuringPull(pulled, latest, 1000)).toBe(pulled);
  });

  test('an edit saved while the sync ran wins, and the playlist is left as a conflict', () => {
    const latest = imported({ tracks: [], locallyModified: true, lastModified: 3000 });
    const out = keepEditsMadeDuringPull(pulled, latest, 1000);
    expect(out.tracks).toEqual([]);
    expect(out.lastModified).toBe(3000);
    expect(out.syncedFrom.snapshotId).toBe('snap-1');
    expect(out.hasUpdates).toBe(true);
  });

  test('no stored record means nothing to keep', () => {
    expect(keepEditsMadeDuringPull(pulled, undefined, 1000)).toBe(pulled);
  });
});
