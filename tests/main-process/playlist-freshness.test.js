/**
 * Playlist freshness stamps (Home redesign, "Your playlists, freshest first").
 *
 * `tracksChangedAt` moves only when a playlist's tracks change (added,
 * removed or reordered), and `lastChangeAdded` counts the tracks that change
 * added. A rename, a sync-state stamp or a hosted re-poll that brings the same
 * tracks is not a change. Every `local_playlists` write passes through the
 * split store, so the stamp is applied there; the renderer stamps first in
 * savePlaylistToStore so Home sees it without a reload.
 */

const fs = require('fs');
const path = require('path');

const {
  trackKeysOf,
  trackKey,
  stampPlaylist,
  stampTrackChanges,
  indexPlaylists,
} = require('../../playlist-freshness');
const { createSplitStore } = require('../../main-process/split-store');
const { trackSlug } = require('../../src/renderer/lib/track-slug');

const T0 = 1_700_000_000_000;
const NOW = T0 + 86_400_000;

const track = (artist, title, extra = {}) => ({ id: trackSlug(artist, title, 'Album'), artist, title, album: 'Album', ...extra });
const tracksOf = (n, prefix = 'Song') => Array.from({ length: n }, (_, i) => track('Artist', `${prefix} ${i}`));
const playlist = (overrides = {}) => ({
  id: 'playlist-1',
  title: 'Road trip',
  tracks: [track('A', 'One'), track('B', 'Two'), track('C', 'Three')],
  lastModified: T0,
  tracksChangedAt: T0,
  lastChangeAdded: 3,
  ...overrides,
});

describe('track identity', () => {
  test('keys follow the content, so ids that are positions (ListenBrainz) still see a swap', () => {
    // sync-providers/listenbrainz.js builds `listenbrainz-track-<mbid>-<index>`:
    // the same id at the same position whatever song is there.
    const before = { id: 'listenbrainz-x', tracks: [
      { id: 'listenbrainz-track-m-0', artist: 'A', title: 'One' },
      { id: 'listenbrainz-track-m-1', artist: 'B', title: 'Two' },
    ] };
    const after = { id: 'listenbrainz-x', tracks: [
      { id: 'listenbrainz-track-m-0', artist: 'C', title: 'Three' },
      { id: 'listenbrainz-track-m-1', artist: 'D', title: 'Four' },
    ] };
    expect(trackKeysOf(after)).not.toEqual(trackKeysOf(before));
  });

  test('hosted XSPF tracks carry no id and still get a stable key', () => {
    const xspfTrack = { title: 'Do You Realize??', artist: 'The Flaming Lips', album: 'Yoshimi', duration: 0, location: '' };
    expect(trackKey(xspfTrack)).toBe(trackSlug('The Flaming Lips', 'Do You Realize??'));
    expect(trackKey({ ...xspfTrack })).toBe(trackKey(xspfTrack));
  });

  test('the key folds the way trackSlug does (case, accents, punctuation)', () => {
    expect(trackKey({ artist: 'Beyoncé', title: 'Halo!' })).toBe(trackKey({ artist: 'BEYONCE', title: 'halo' }));
    expect(trackKey({ artist: 'Король и Шут', title: 'Лесник' })).toBe(trackSlug('Король и Шут', 'Лесник'));
  });

  test('metadata a track gains later (sources, art, album) is not a different track', () => {
    const t = { id: 'x', artist: 'A', title: 'One' };
    expect(trackKey({ ...t, album: 'Later', sources: { spotify: {} }, albumArt: 'https://a' })).toBe(trackKey(t));
  });

  test('a track with no artist or title falls back to its id', () => {
    expect(trackKey({ id: 'spotify:track:1' })).toBe('id:spotify:track:1');
  });

  test('ids come out in order', () => {
    expect(trackKeysOf(playlist())).toEqual([trackSlug('A', 'One'), trackSlug('B', 'Two'), trackSlug('C', 'Three')]);
    expect(trackKeysOf({ id: 'p' })).toEqual([]);
  });
});

describe('stampTrackChanges', () => {
  test('a rename alone leaves tracksChangedAt unchanged', () => {
    const prev = [playlist()];
    const next = [playlist({ title: 'Renamed', lastModified: NOW })];
    const [out] = stampTrackChanges(prev, next, NOW);
    expect(out.title).toBe('Renamed');
    expect(out.tracksChangedAt).toBe(T0);
    expect(out.lastChangeAdded).toBe(3);
  });

  test('the same tracks reordered is a change that added nothing', () => {
    const p = playlist();
    const next = [{ ...p, tracks: [p.tracks[2], p.tracks[0], p.tracks[1]] }];
    const [out] = stampTrackChanges([p], next, NOW);
    expect(out.tracksChangedAt).toBe(NOW);
    expect(out.lastChangeAdded).toBe(0);
  });

  test('two tracks added gives lastChangeAdded 2', () => {
    const p = playlist();
    const next = [{ ...p, tracks: [...p.tracks, track('D', 'Four'), track('E', 'Five')] }];
    const [out] = stampTrackChanges([p], next, NOW);
    expect(out.tracksChangedAt).toBe(NOW);
    expect(out.lastChangeAdded).toBe(2);
  });

  test('a removal stamps with nothing added; a swap counts the new ones', () => {
    const p = playlist();
    expect(stampTrackChanges([p], [{ ...p, tracks: p.tracks.slice(1) }], NOW)[0])
      .toMatchObject({ tracksChangedAt: NOW, lastChangeAdded: 0 });
    expect(stampTrackChanges([p], [{ ...p, tracks: [p.tracks[0], track('Z', 'New')] }], NOW)[0])
      .toMatchObject({ tracksChangedAt: NOW, lastChangeAdded: 1 });
  });

  test('a second copy of a track already there counts as added', () => {
    const p = playlist();
    const [out] = stampTrackChanges([p], [{ ...p, tracks: [...p.tracks, p.tracks[0]] }], NOW);
    expect(out.lastChangeAdded).toBe(1);
  });

  test('a brand-new playlist is stamped now with its track count', () => {
    const fresh = { id: 'playlist-2', title: 'New', tracks: tracksOf(4) };
    const [, out] = stampTrackChanges([playlist()], [playlist(), fresh], NOW);
    expect(out).toMatchObject({ tracksChangedAt: NOW, lastChangeAdded: 4 });
  });

  test('a playlist saved before the fields existed gains them only when its tracks change', () => {
    const legacy = playlist({ tracksChangedAt: undefined, lastChangeAdded: undefined });
    delete legacy.tracksChangedAt;
    delete legacy.lastChangeAdded;
    const [same] = stampTrackChanges([legacy], [{ ...legacy, title: 'x' }], NOW);
    expect(same).not.toHaveProperty('tracksChangedAt');
    expect(same).not.toHaveProperty('lastChangeAdded');
    const [changed] = stampTrackChanges([legacy], [{ ...legacy, tracks: [...legacy.tracks, track('D', 'Four')] }], NOW);
    expect(changed).toMatchObject({ tracksChangedAt: NOW, lastChangeAdded: 1 });
  });

  test('an unchanged record that lost the fields gets them back from the stored copy', () => {
    // A sync path that rebuilds the record without spreading it.
    const p = playlist();
    const rebuilt = { id: p.id, title: p.title, tracks: p.tracks.map((t) => ({ ...t })) };
    const [out] = stampTrackChanges([p], [rebuilt], NOW);
    expect(out).toMatchObject({ tracksChangedAt: T0, lastChangeAdded: 3 });
  });

  test('an unchanged record with an older stamp (a stale renderer copy) keeps the newer one', () => {
    const stored = playlist({ tracksChangedAt: T0 + 5, lastChangeAdded: 7 });
    const [out] = stampTrackChanges([stored], [playlist({ title: 'Renamed' })], NOW);
    expect(out).toMatchObject({ tracksChangedAt: T0 + 5, lastChangeAdded: 7 });
  });

  test('a change the renderer already stamped keeps the renderer\'s stamp', () => {
    const p = playlist();
    const RENDERER_NOW = T0 + 1000;
    const incoming = { ...p, tracks: [...p.tracks, track('D', 'Four')], tracksChangedAt: RENDERER_NOW, lastChangeAdded: 1 };
    const [out] = stampTrackChanges([p], [incoming], NOW);
    expect(out).toMatchObject({ tracksChangedAt: RENDERER_NOW, lastChangeAdded: 1 });
    // ... and so does a new playlist the renderer created.
    const created = { id: 'new', tracks: tracksOf(2), tracksChangedAt: RENDERER_NOW, lastChangeAdded: 2 };
    expect(stampTrackChanges([p], [p, created], NOW)[1]).toMatchObject({ tracksChangedAt: RENDERER_NOW, lastChangeAdded: 2 });
  });

  test('a change carrying the old stamp (spread from the stored record) is stamped now', () => {
    const p = playlist();
    const incoming = { ...p, tracks: [track('Q', 'Other')] };
    expect(stampTrackChanges([p], [incoming], NOW)[0]).toMatchObject({ tracksChangedAt: NOW, lastChangeAdded: 1 });
  });

  test('a record without a tracks array is never read as "every track removed"', () => {
    const p = playlist();
    const partial = { id: p.id, title: 'Header only' };
    const [out] = stampTrackChanges([p], [partial], NOW);
    expect(out).toMatchObject({ tracksChangedAt: T0, lastChangeAdded: 3 });
  });

  test('nothing changed returns the same array and records untouched', () => {
    const p = playlist();
    const next = [{ ...p }];
    const out = stampTrackChanges([p], next, NOW);
    expect(out).toBe(next);
    expect(out[0]).toBe(next[0]);
  });

  test('never mutates what it was given', () => {
    const p = playlist();
    const incoming = { ...p, tracks: [...p.tracks, track('D', 'Four')] };
    const next = [incoming];
    const snapshot = JSON.parse(JSON.stringify(next));
    stampTrackChanges([p], next, NOW);
    expect(next).toEqual(snapshot);
  });

  test('keeps every other field (sync fields ride through untouched)', () => {
    const p = playlist({
      syncedFrom: { resolver: 'spotify', externalId: 'x', snapshotId: 's' },
      syncedTo: { applemusic: { externalId: 'p.1', syncedAt: 1 } },
      syncSources: { spotify: { addedAt: 1, syncedAt: 2 } },
      localOnly: true, locallyModified: true, hasUpdates: false, sourceUrl: 'https://e/x.xspf',
    });
    const incoming = { ...p, tracks: [...p.tracks, track('D', 'Four')] };
    const [out] = stampTrackChanges([p], [incoming], NOW);
    const { tracksChangedAt, lastChangeAdded, ...rest } = out;
    const { tracksChangedAt: _a, lastChangeAdded: _b, ...incomingRest } = incoming;
    expect(rest).toEqual(incomingRest);
    expect([tracksChangedAt, lastChangeAdded]).toEqual([NOW, 1]);
  });

  test('passes anything that is not a list straight through', () => {
    expect(stampTrackChanges([playlist()], null, NOW)).toBeNull();
    expect(stampTrackChanges(undefined, undefined, NOW)).toBeUndefined();
    const next = [playlist()];
    expect(stampTrackChanges(null, next, NOW)[0]).toMatchObject({ tracksChangedAt: T0 });
  });

  test('accepts a prebuilt index in place of the previous list', () => {
    const p = playlist();
    const next = [{ ...p, tracks: [...p.tracks, track('D', 'Four')] }];
    expect(stampTrackChanges(indexPlaylists([p]), next, NOW)).toEqual(stampTrackChanges([p], next, NOW));
  });

  test('a 5,000-track diff is correct and quick', () => {
    const big = { id: 'big', tracks: tracksOf(5000), tracksChangedAt: T0, lastChangeAdded: 5000 };
    const others = Array.from({ length: 199 }, (_, i) => ({ id: `p${i}`, tracks: tracksOf(40, `P${i}`) }));
    const prev = [big, ...others];
    const added = [track('New', 'One'), track('New', 'Two'), track('New', 'Three')];
    const nextBig = { ...big, tracks: [...big.tracks.slice(10), ...added] }; // 10 removed, 3 added
    const unchanged = [{ ...big, tracks: big.tracks.map((t) => ({ ...t })) }, ...others.map((p) => ({ ...p }))];

    const out = stampTrackChanges(prev, [nextBig, ...others.map((p) => ({ ...p }))], NOW);
    const same = stampTrackChanges(prev, unchanged, NOW);

    expect(out[0]).toMatchObject({ tracksChangedAt: NOW, lastChangeAdded: 3 });
    expect(out.slice(1).every((p) => p.tracksChangedAt === undefined)).toBe(true);
    expect(same[0]).toMatchObject({ tracksChangedAt: T0, lastChangeAdded: 5000 });
  });

  test('fills an out index equal to indexing the result, keying each track once', () => {
    const p = playlist();
    const legacy = { id: 'legacy', tracks: tracksOf(2) };
    const partial = { id: 'partial', title: 'no tracks' };
    const next = [{ ...p, tracks: [...p.tracks, track('D', 'Four')] }, legacy, partial, { ...legacy, title: 'dup id' }];
    const filled = new Map();
    const out = stampTrackChanges([p, legacy], next, NOW, filled);
    expect(filled).toEqual(indexPlaylists(out));
  });
});

describe('stampPlaylist', () => {
  test('stamps one record against its previous version', () => {
    const p = playlist();
    expect(stampPlaylist(p, { ...p, tracks: [...p.tracks, track('D', 'Four')] }, NOW))
      .toMatchObject({ tracksChangedAt: NOW, lastChangeAdded: 1 });
    expect(stampPlaylist(null, { id: 'n', tracks: tracksOf(2) }, NOW))
      .toMatchObject({ tracksChangedAt: NOW, lastChangeAdded: 2 });
    const same = { ...p, title: 'x' };
    expect(stampPlaylist(p, same, NOW)).toBe(same);
  });
});

describe('the split store stamps every local_playlists write', () => {
  // A fake key store with conf's copy-on-get semantics.
  const fakeConf = () => {
    let data = {};
    const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
    return {
      get: (k, d) => (k in data ? clone(data[k]) : d),
      set: (k, v) => {
        if (k !== null && typeof k === 'object') { for (const [kk, vv] of Object.entries(k)) data[kk] = clone(vv); return; }
        data[k] = clone(v);
      },
      has: (k) => k in data,
      delete: (k) => { delete data[k]; },
      clear: () => { data = {}; },
      get store() { return clone(data); },
      set store(v) { data = clone(v); },
      path: '/fake/config.json',
    };
  };
  const makeStore = (seed, clock = { now: NOW }) => {
    const main = fakeConf();
    const files = new Map();
    const store = createSplitStore({
      main,
      openKeyStore: (key) => { if (!files.has(key)) files.set(key, fakeConf()); return files.get(key); },
      listKeyStores: () => [...files.keys()],
      log: () => {},
      now: () => clock.now,
    });
    if (seed) files.set('local_playlists', fakeConf()), files.get('local_playlists').set('local_playlists', seed);
    return { store, files, clock };
  };

  test('a sync-pull-shaped write stamps the playlist whose tracks changed', () => {
    const p = playlist();
    const other = playlist({ id: 'playlist-2', title: 'Other' });
    const { store } = makeStore([p, other]);

    // sync-start.js: read the list, rebuild one record from the remote, write it all back.
    const current = store.get('local_playlists');
    current[0] = { ...current[0], tracks: [...current[0].tracks, track('D', 'Four'), track('E', 'Five')], syncSources: { spotify: { syncedAt: NOW } } };
    store.set('local_playlists', current);

    const [pulled, untouched] = store.get('local_playlists');
    expect(pulled).toMatchObject({ tracksChangedAt: NOW, lastChangeAdded: 2, syncSources: { spotify: { syncedAt: NOW } } });
    expect(untouched).toMatchObject({ tracksChangedAt: T0, lastChangeAdded: 3 });
  });

  test('a metadata-only write (a syncedFrom heal, a sync stamp) does not stamp', () => {
    const { store } = makeStore([playlist()]);
    const current = store.get('local_playlists');
    current[0].syncedFrom = { resolver: 'spotify', externalId: 'x' };
    current[0].lastModified = NOW;
    store.set('local_playlists', current);
    expect(store.get('local_playlists')[0]).toMatchObject({ tracksChangedAt: T0, lastChangeAdded: 3 });
  });

  test('the object form of set stamps too, and leaves other keys alone', () => {
    const p = playlist();
    const { store } = makeStore([p]);
    store.set({ local_playlists: [{ ...p, tracks: p.tracks.slice(0, 1) }], saved_volume: 4, cache_x: { a: 1 } });
    expect(store.get('local_playlists')[0]).toMatchObject({ tracksChangedAt: NOW, lastChangeAdded: 0 });
    expect(store.get('saved_volume')).toBe(4);
    expect(store.get('cache_x')).toEqual({ a: 1 });
  });

  test('a write after a write compares against the last write, not the first', () => {
    const p = playlist();
    const { store, clock } = makeStore([p]);
    store.set('local_playlists', [{ ...p, tracks: [...p.tracks, track('D', 'Four')] }]);
    clock.now = NOW + 60_000;
    // Same tracks again (a hosted re-poll): no new stamp.
    store.set('local_playlists', store.get('local_playlists').map((x) => ({ ...x, lastUpdated: clock.now })));
    expect(store.get('local_playlists')[0]).toMatchObject({ tracksChangedAt: NOW, lastChangeAdded: 1 });
  });

  test('delete and clear forget what was stored, so the next write sees new playlists', () => {
    const p = playlist();
    const { store } = makeStore([p]);
    store.set('local_playlists', [p]);
    store.delete('local_playlists');
    const fresh = { id: 'playlist-1', tracks: tracksOf(2) };
    store.set('local_playlists', [fresh]);
    expect(store.get('local_playlists')[0]).toMatchObject({ tracksChangedAt: NOW, lastChangeAdded: 2 });
  });

  test('a stamp that throws writes the list as given and leaves the index empty', () => {
    const p = playlist();
    const { store, files } = makeStore([p]);
    const file = files.get('local_playlists');
    const realGet = file.get;
    let reads = 0;
    file.get = (...args) => {
      reads++;
      if (reads === 1) throw new Error('unreadable');
      return realGet(...args);
    };
    const edited = { ...p, tracks: [...p.tracks, track('D', 'Four')] };
    store.set('local_playlists', [edited]);
    // Written unchanged: the edit's tracks, the old stamp.
    expect(realGet('local_playlists')).toEqual([edited]);
    // No index was kept, so the next write reads the file again.
    store.set('local_playlists', [{ ...edited, tracks: edited.tracks.slice(0, 1) }]);
    expect(reads).toBe(2);
    expect(realGet('local_playlists')[0]).toMatchObject({ tracksChangedAt: NOW, lastChangeAdded: 0 });
  });

  test('a write that fails drops the index, so the next write re-reads the file', () => {
    const p = playlist();
    const { store, files } = makeStore([p]);
    const file = files.get('local_playlists');
    const realGet = file.get;
    const realSet = file.set;
    let reads = 0;
    file.get = (...args) => { reads++; return realGet(...args); };
    let failNext = true;
    file.set = (...args) => {
      if (failNext) { failNext = false; throw new Error('disk full'); }
      return realSet(...args);
    };

    expect(() => store.set('local_playlists', [{ ...p, tracks: [...p.tracks, track('D', 'Four')] }])).toThrow('disk full');
    expect(reads).toBe(1);
    // The failed list never reached disk; the next write compares against the file.
    store.set('local_playlists', [{ ...p, title: 'Renamed' }]);
    expect(reads).toBe(2);
    expect(realGet('local_playlists')[0]).toMatchObject({ title: 'Renamed', tracksChangedAt: T0, lastChangeAdded: 3 });
    // And a successful write keeps an index again.
    store.set('local_playlists', [{ ...p, title: 'Again' }]);
    expect(reads).toBe(2);
  });

  test('other keys are never stamped', () => {
    const { store } = makeStore();
    store.set('cache_playlists_like', [{ id: 'x', tracks: tracksOf(2) }]);
    expect(store.get('cache_playlists_like')[0]).not.toHaveProperty('tracksChangedAt');
  });
});

describe('the renderer stamps before it saves', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');
  const bodyOf = (signature) => {
    const s = app.indexOf(signature);
    expect(s).toBeGreaterThan(-1);
    return app.slice(s, app.indexOf('\n  };\n', s));
  };

  test('savePlaylistToStore stamps against the copy in playlistsRef, then saves through the builder', () => {
    const body = bodyOf('const savePlaylistToStore = async (playlist) => {');
    const stampAt = body.indexOf('stampPlaylist(');
    expect(stampAt).toBeGreaterThan(-1);
    expect(body).toMatch(/playlistsRef\.current/);
    const buildAt = body.indexOf('window.buildPlaylistSavePayload(');
    expect(buildAt).toBeGreaterThan(stampAt);
    expect(body).toMatch(/window\.buildPlaylistSavePayload\(playlist, xspfContent, Date\.now\(\)\)/);
    // State gets the stamp too, so Home sees it without a reload.
    expect(body).toMatch(/setPlaylists\(/);
  });

  test('the hosted refresh stamps the record it keeps in state', () => {
    const body = bodyOf('const handleImportPlaylistFromUrl = async (');
    expect(body).toMatch(/stampPlaylist\(existing,/);
    expect(body).toMatch(/stampPlaylist\(null,/);
  });

  test('the module comes from the shared root file', () => {
    expect(app).toMatch(/require\('\.\.\/\.\.\/playlist-freshness'\)/);
  });
});
