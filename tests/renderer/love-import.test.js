/**
 * Loved-tracks IMPORT from Last.fm (parachord#1071) — the inbound half of
 * the loved-tracks scrobbler sync. The push half (addTrackToCollection →
 * pushLoveToScrobblers) is documented in
 * docs/plans/2026-05-03-loved-tracks-scrobbler-push-design.md.
 *
 * This file tests the pure helpers (src/renderer/lib/love-import.js): the
 * user.getLovedTracks page mapping, the identity-first dedupe that keeps an
 * album-less love from duplicating a saved row, the tombstone key the import
 * reads and app.js's deriveTombstoneEntries writes, the no-loop marks, the
 * incremental cursor, and the completion-summary copy. Plus the wiring
 * source-markers: the runner, the scrobbler fetcher, the store keys and the
 * settings card all have to be in place for the button to do anything.
 */

const fs = require('fs');
const path = require('path');

const {
  mapLastFmLovedPage,
  buildCollectionIdentityIndex,
  indexTrack,
  matchCollectionTrack,
  lastfmTombstoneKey,
  tombstoneEntriesForCandidate,
  isTombstoned,
  buildImportTrack,
  applyLoveImportMarks,
  nextImportCursor,
  sliceNewLoved,
  summarizeLoveImport,
} = require('../../src/renderer/lib/love-import');

const lastfmPage = require('../fixtures/lastfm-lovedtracks.json');

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

const MBID = '8f28b6df-1788-46ea-a7a4-3a0f30e10482';

describe('mapLastFmLovedPage', () => {
  test('maps artist, title, recording MBID and the loved-at date (uts string seconds → ms)', () => {
    const { items, total } = mapLastFmLovedPage(lastfmPage);
    expect(total).toBe(842);
    expect(items).toHaveLength(4);
    expect(items[0]).toEqual({
      service: 'lastfm',
      artist: 'Radiohead',
      title: 'Creep',
      album: '',
      mbid: '8f28b6df-1788-46ea-a7a4-3a0f30e10482',
      lovedAt: 1735689600000,
    });
  });

  test('keeps non-Latin names, drops a non-UUID mbid, and an item with no date gets lovedAt null', () => {
    const { items } = mapLastFmLovedPage(lastfmPage);
    expect(items[1].artist).toBe('Tokyo Jihen');
    expect(items[1].title).toBe('修羅場');
    expect(items[1].mbid).toBeNull(); // "" is not a UUID
    expect(items[2].mbid).toBeNull(); // "not-a-uuid"
    expect(items[2].lovedAt).toBeNull();
  });

  test('an artist written as #text (the older serialization) maps the same way', () => {
    const { items } = mapLastFmLovedPage(lastfmPage);
    expect(items[3]).toEqual({
      service: 'lastfm',
      artist: 'New Order',
      title: 'Temptation',
      album: '',
      mbid: '0f2a2e31-9a0f-4c0f-b0c5-e9d62a1e6384',
      lovedAt: 1609459200000,
    });
  });

  test('a single-item page returns track as an object, not an array', () => {
    const { items, total } = mapLastFmLovedPage({
      lovedtracks: {
        '@attr': { page: '1', perPage: '50', totalPages: '1', total: '1' },
        track: {
          artist: { name: 'Wire' },
          name: 'Map Ref. 41°N 93°W',
          date: { uts: '1704067200' },
        },
      },
    });
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Map Ref. 41°N 93°W');
    expect(total).toBe(1);
  });

  test('drops items without an artist or a title and survives a missing @attr', () => {
    const { items, total } = mapLastFmLovedPage({
      lovedtracks: {
        track: [
          { artist: { name: 'No Title' }, date: { uts: '1' } },
          { name: 'No Artist', date: { uts: '1' } },
        ],
      },
    });
    expect(items).toEqual([]);
    expect(total).toBe(0);
  });
});

describe('identity-first dedupe (issue #1071 rule 3)', () => {
  const collection = [
    // A saved row with the album the love doesn't have — the near-duplicate
    // the naive id add would create.
    { id: 'a', artist: 'Radiohead', title: 'Creep', album: 'Pablo Honey', sources: {} },
    // A row whose recording MBID came from the mapper.
    { id: 'b', artist: 'Sonic Youth', title: 'Kool Thing', album: 'Goo', mbid: '9bd9f6a2-2c27-4d3c-b1d9-6e56a5ee72c2', sources: {} },
    // A row carrying an MBID only on a source record.
    { id: 'c', artist: 'Björk', title: 'Jóga', album: 'Homogenic', sources: { listenbrainz: { mbid: '1e7b2ec1-6fab-4846-b25e-3dcb4a9f61a9' } } },
    // A row carrying an ISRC on a source record.
    { id: 'd', artist: 'Molchat Doma', title: 'Судно', album: 'Этажи', sources: { spotify: { isrc: 'GB2LV1700107' } } },
  ];
  const index = buildCollectionIdentityIndex(collection);

  test('recording MBID wins over a different artist+title spelling', () => {
    const m = matchCollectionTrack(index, { service: 'lastfm', artist: 'Sonic Youth', title: 'Kool Thing (2024 Remaster)', mbid: '9bd9f6a2-2c27-4d3c-b1d9-6e56a5ee72c2' });
    expect(m && m.id).toBe('b');
  });

  test('a source record MBID matches too', () => {
    const m = matchCollectionTrack(index, { service: 'lastfm', artist: 'Björk', title: 'Joga', mbid: '1e7b2ec1-6fab-4846-b25e-3dcb4a9f61a9' });
    expect(m && m.id).toBe('c');
  });

  test('ISRC matches when the candidate carries one', () => {
    const m = matchCollectionTrack(index, { service: 'lastfm', artist: 'Molchat Doma', title: 'Sudno (Boris Vian)', isrc: 'GB2LV1700107' });
    expect(m && m.id).toBe('d');
  });

  test('normalized artist + title matches an album-less love to the saved row (the near-duplicate guard)', () => {
    const m = matchCollectionTrack(index, { service: 'lastfm', artist: 'Radiohead', title: 'Creep', album: '', mbid: null });
    expect(m && m.id).toBe('a');
  });

  test('no match for a track nobody loves yet, and no match on an empty title', () => {
    expect(matchCollectionTrack(index, { service: 'lastfm', artist: 'Wire', title: 'Map Ref. 41°N 93°W' })).toBeNull();
    expect(matchCollectionTrack(index, { service: 'lastfm', artist: '', title: '' })).toBeNull();
  });

  test('non-Latin names match by artist+title instead of collapsing to one id', () => {
    const jp = buildCollectionIdentityIndex([
      { id: 'x', artist: '東京事変', title: '修羅場', album: '大人', sources: {} },
    ]);
    expect(matchCollectionTrack(jp, { service: 'lastfm', artist: '東京事変', title: '修羅場' }).id).toBe('x');
    expect(matchCollectionTrack(jp, { service: 'lastfm', artist: '東京事変', title: '群青日和' })).toBeNull();
  });

  test('two non-Latin loves that slug to the same ASCII id add once (the collection id tier)', () => {
    // normalizeForId is ASCII-only (the documented track-slug gap), so two
    // DIFFERENT Japanese songs both slug to '--noalbum'. Without the id
    // tier the import would write two rows sharing one id — corrupting
    // every id-keyed map. The id tier refuses the second the way
    // addTrackToCollection's findSavedTrack would.
    const idx = buildCollectionIdentityIndex([]);
    const first = buildImportTrack({ service: 'lastfm', artist: '東京事変', title: '修羅場', album: '', mbid: null, lovedAt: 1 });
    expect(first.id).toBe('--noalbum');
    indexTrack(idx, first);
    expect(matchCollectionTrack(idx, { service: 'lastfm', artist: '東京事変', title: '群青日和', album: '' })).toBe(first);
    // …and the tier catches same-slug Latin variants of the same song too.
    expect(matchCollectionTrack(idx, { service: 'lastfm', artist: 'Tokyo Jihen', title: 'Shuraba', album: '' })).toBeNull();
  });

  test('a track added to the index matches the next candidate (batch-internal dedupe)', () => {
    const idx = buildCollectionIdentityIndex([]);
    indexTrack(idx, buildImportTrack({ service: 'lastfm', artist: 'Wire', title: 'Map Ref. 41°N 93°W', album: '', mbid: null }));
    const dup = matchCollectionTrack(idx, { service: 'lastfm', artist: 'Wire', title: 'Map Ref. 41°N 93°W', album: '' });
    expect(dup).not.toBeNull();
  });
});

describe('tombstones (issue #1071 rule 4)', () => {
  test('the Last.fm key is the normalized artist|title, shared by app.js deriveTombstoneEntries', () => {
    expect(lastfmTombstoneKey('Radiohead', 'Creep')).toBe(lastfmTombstoneKey(' radiohead ', 'CREEP!'));
    expect(tombstoneEntriesForCandidate({ service: 'lastfm', artist: 'Radiohead', title: 'Creep' }))
      .toEqual([{ providerId: 'lastfm', externalId: lastfmTombstoneKey('Radiohead', 'Creep') }]);
  });

  test('a ListenBrainz love keys on the recording MBID', () => {
    expect(tombstoneEntriesForCandidate({ service: 'listenbrainz', artist: 'X', title: 'Y', mbid: MBID }))
      .toEqual([{ providerId: 'listenbrainz', externalId: MBID }]);
    expect(tombstoneEntriesForCandidate({ service: 'listenbrainz', artist: 'X', title: 'Y', mbid: null })).toEqual([]);
  });

  test('isTombstoned honors the map from sync:tombstones:list and tolerates none', () => {
    const tombstones = { lastfm: { [lastfmTombstoneKey('Radiohead', 'Creep')]: { removedAt: 1 } } };
    expect(isTombstoned(tombstones, { service: 'lastfm', artist: 'Radiohead', title: 'Creep' })).toBe(true);
    expect(isTombstoned(tombstones, { service: 'lastfm', artist: 'Wire', title: 'Map Ref. 41°N 93°W' })).toBe(false);
    expect(isTombstoned(null, { service: 'lastfm', artist: 'Radiohead', title: 'Creep' })).toBe(false);
  });
});

describe('buildImportTrack (issue #1071 rules 1 + 5)', () => {
  test('keeps the service loved-at as addedAt and carries the MBID', () => {
    const t = buildImportTrack({ service: 'lastfm', artist: 'Radiohead', title: 'Creep', album: '', mbid: MBID, lovedAt: 1735689600000 });
    expect(t.addedAt).toBe(1735689600000);
    expect(t.mbid).toBe(MBID);
    expect(t.id).toBe('radiohead-creep-noalbum');
    expect(t.album).toBe('');
    expect(t.sources).toEqual({});
    expect(t.albumArt).toBeNull();
  });

  test('a love with no date falls back to now, and no MBID means no field', () => {
    const t = buildImportTrack({ service: 'lastfm', artist: 'Wire', title: 'Map Ref. 41°N 93°W', album: '', mbid: null, lovedAt: null }, 12345);
    expect(t.addedAt).toBe(12345);
    expect('mbid' in t).toBe(false);
  });

  test('a ListenBrainz love keeps its release name', () => {
    const t = buildImportTrack({ service: 'listenbrainz', artist: 'Sonic Youth', title: 'Kool Thing', album: 'Goo', mbid: MBID, lovedAt: 1 });
    expect(t.album).toBe('Goo');
    expect(t.id).toBe('sonic-youth-kool-thing-goo');
  });
});

describe('no-loop marks and the cursor', () => {
  test('applyLoveImportMarks marks every id for the source service and keeps other entries', () => {
    const before = { 'existing-track': { lastfm: 5 } };
    const after = applyLoveImportMarks(before, ['t1', 't2', ''], 'lastfm', 99);
    expect(after['t1']).toEqual({ lastfm: 99 });
    expect(after['t2']).toEqual({ lastfm: 99 });
    expect(after['existing-track']).toEqual({ lastfm: 5 });
    expect(before['t1']).toBeUndefined(); // pure: the input map is untouched
  });

  test('nextImportCursor advances to the newest loved-at seen, not just added ones', () => {
    const items = [{ lovedAt: 100 }, { lovedAt: 500 }, { lovedAt: null }, { lovedAt: 300 }];
    expect(nextImportCursor(items, 0)).toBe(500);
    expect(nextImportCursor(items, 600)).toBe(600);
  });

  test('sliceNewLoved stops below the cursor, keeping an overlap for same-second late arrivals', () => {
    const C = 1735689600000;
    const items = [
      { lovedAt: C + 5000 }, // newer than the cursor
      { lovedAt: C + 1000 }, // inside the overlap window — re-fetched on purpose
      { lovedAt: C },       // inside the overlap window
      { lovedAt: C - 5000 }, // older than the overlap — the stop marker
    ];
    expect(sliceNewLoved(items, C)).toEqual({ fresh: items.slice(0, 3), stop: true });
    expect(sliceNewLoved(items, 0)).toEqual({ fresh: items, stop: false });
    expect(sliceNewLoved(items, C + 5001)).toEqual({ fresh: [items[0]], stop: true });
    // An item with no date can't be ordered and is kept.
    expect(sliceNewLoved([{ lovedAt: null }, { lovedAt: C - 5000 }], C))
      .toEqual({ fresh: [{ lovedAt: null }], stop: true });
  });
});

describe('the completion summary (issue #1071 rule 2 — cross-service is explicit)', () => {
  test('summarizes added / existing / removed / skipped', () => {
    expect(summarizeLoveImport({ serviceLabel: 'Last.fm', added: 12, existing: 3, skipped: 1, removed: 2 }))
      .toBe('Imported 12 loved tracks from Last.fm · 3 already in your collection · 2 previously removed · 1 skipped — no resolvable metadata');
    expect(summarizeLoveImport({ serviceLabel: 'Last.fm', added: 1, existing: 0, skipped: 0, removed: 0 }))
      .toBe('Imported 1 loved track from Last.fm');
  });

  test('says when the other service\'s toggle will push the imports', () => {
    const msg = summarizeLoveImport({ serviceLabel: 'Last.fm', added: 12, existing: 0, skipped: 0, removed: 0, crossServiceLabel: 'ListenBrainz', crossQueued: 12 });
    expect(msg).toContain('12 will also be pushed to ListenBrainz (its push toggle is on).');
  });
});

describe('wiring (source markers)', () => {
  const app = read('src/renderer/app.js');
  const loader = read('scrobbler-loader.js');
  const card = read('src/renderer/components/settings-cards.js');
  const storeIpc = read('main-process/ipc/store.js');

  test('the runner exists and only claims to run a service with a fetcher', () => {
    expect(app).toContain('const runLoveImport = useCallback');
    expect(app).toContain("fetchLastFmLoves = useCallback");
    // The other services are wired in follow-up slices; a service without a
    // fetcher returns before touching any state.
    expect(app).toContain("service === 'lastfm' ? fetchLastFmLoves : null");
  });

  test('the Last.fm scrobbler fetches user.getLovedTracks through the signed apiRequest', () => {
    expect(loader).toContain('async fetchLovedTracksPage(');
    expect(loader).toContain("'user.getLovedTracks'");
  });

  test('removal writes the Last.fm tombstone key the import reads back', () => {
    expect(app).toContain("push('lastfm', lastfmTombstoneKey(track.artist, track.title))");
  });

  test('the no-loop marks and cursor are persisted through allowlisted keys', () => {
    expect(app).toContain("store.set('love_pushed_keys', marked)");
    expect(app).toContain("'love_import_cursors'");
    expect(storeIpc).toContain("'love_import_cursors'");
  });

  test('the cursor only advances on a run that added nothing (a failed save re-imports)', () => {
    expect(app).toContain('toAdd.length > 0 ? cursorMs : LoveImport.nextImportCursor(candidates, cursorMs)');
    expect(app).toContain('advances ONLY on a run that added nothing');
  });

  test('a removal during the run is honored before the write', () => {
    expect(app).toContain('const tombstonesNow = await readTombstones();');
  });

  test('the Settings card renders the import action with progress, and the Last.fm card passes it', () => {
    expect(card).toContain('onRunImport = null');
    expect(card).toContain('Import loved tracks from ${');
    expect(card).toContain('Also pushing to ');
    expect(app).toContain("onRunImport: () => runLoveImport('lastfm')");
    expect(app).toContain("importRunning: !!loveImportRunning.lastfm");
  });

  test('the import button is disabled while it runs', () => {
    const button = card.slice(card.indexOf('onRunImport &&'));
    expect(button).toContain('disabled: importRunning');
  });
});
