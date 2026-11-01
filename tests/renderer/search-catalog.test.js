/**
 * src/renderer/lib/search-catalog.js: which of the user's services Search
 * asks, and how their results merge with MusicBrainz's.
 */

const {
  searchResolversFor,
  catalogTracksToSearchResults,
  catalogAlbumsToSearchResults,
  catalogArtistsFromResults,
  mergeTrackResults,
  mergeAlbumResults,
  withoutLocalDuplicates,
  serviceArtFor,
  CATALOG_RESULTS_PER_RESOLVER,
} = require('../../src/renderer/lib/search-catalog');
const {
  calculateConfidence, normalizeStr, MIN_CONFIDENCE_THRESHOLD,
} = require('../../sync-providers/confidence-scoring');

const scorer = { calculateConfidence, threshold: MIN_CONFIDENCE_THRESHOLD, normalize: normalizeStr };
const fn = () => {};

describe('searchResolversFor', () => {
  const resolvers = [
    { id: 'youtube', capabilities: { search: true }, search: fn },
    { id: 'spotify', capabilities: { search: true, albumSearch: true }, search: fn, searchAlbums: fn },
    { id: 'bandcamp', capabilities: { search: true, albumSearch: true }, search: fn, searchAlbums: fn },
    { id: 'applemusic', capabilities: { search: true, albumSearch: true }, search: fn, searchAlbums: fn },
    { id: 'claimsonly', capabilities: { search: true } },
  ];

  test('active resolvers with the capability and its function, in priority order', () => {
    const found = searchResolversFor(resolvers, {
      activeIds: ['youtube', 'spotify', 'bandcamp', 'claimsonly'],
      order: ['bandcamp', 'spotify', 'youtube'],
      capability: 'search', fn: 'search',
    });
    expect(found.map(r => r.id)).toEqual(['bandcamp', 'spotify', 'youtube']);
  });

  test('an inactive resolver is not asked', () => {
    const found = searchResolversFor(resolvers, {
      activeIds: ['spotify'], order: [], capability: 'albumSearch', fn: 'searchAlbums',
    });
    expect(found.map(r => r.id)).toEqual(['spotify']);
  });

  test('active resolvers missing from the order list come after the ordered ones', () => {
    const found = searchResolversFor(resolvers, {
      activeIds: ['applemusic', 'spotify'], order: ['spotify'], capability: 'search', fn: 'search',
    });
    expect(found.map(r => r.id)).toEqual(['spotify', 'applemusic']);
  });
});

describe('catalogTracksToSearchResults', () => {
  test('a hit becomes a row whose own source is the hit, at confidence 1', () => {
    const [row] = catalogTracksToSearchResults([
      { id: 'sp1', title: 'Creep', artist: 'Radiohead', album: 'Pablo Honey', duration: 238, spotifyUri: 'spotify:track:1', isrc: 'GBAYE9200070', albumArt: 'https://i/1.jpg' },
    ], 'spotify');
    expect(row).toMatchObject({
      title: 'Creep', artist: 'Radiohead', album: 'Pablo Honey', duration: 238,
      albumArt: 'https://i/1.jpg', isrc: 'GBAYE9200070', _source: 'spotify', score: 100,
    });
    expect(row.sources.spotify).toMatchObject({ spotifyUri: 'spotify:track:1', isrc: 'GBAYE9200070', confidence: 1 });
    expect(row.id).toBe('radiohead-creep-pablohoney');
  });

  test('a service further down the priority order scores lower', () => {
    const [first] = catalogTracksToSearchResults([{ title: 'T', artist: 'A' }], 'applemusic', 0);
    const [fourth] = catalogTracksToSearchResults([{ title: 'T', artist: 'A' }], 'soundcloud', 4);
    expect(first.score).toBe(100);
    expect(fourth.score).toBe(80);
  });

  test('rank becomes a falling score, and a long list is cut', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ title: `T${i}`, artist: 'A' }));
    const rows = catalogTracksToSearchResults(many, 'youtube');
    expect(rows).toHaveLength(CATALOG_RESULTS_PER_RESOLVER);
    expect(rows[0].score).toBeGreaterThan(rows[1].score);
  });

  test('hits without a title are dropped', () => {
    expect(catalogTracksToSearchResults([{ artist: 'A' }, null], 'x')).toEqual([]);
  });
});

describe('mergeTrackResults', () => {
  const mbCreep = { id: 'mb-1', mbid: 'mb-1', title: 'Creep', artist: 'Radiohead', sources: {}, score: 100 };
  const sp = catalogTracksToSearchResults([
    { title: 'Creep', artist: 'Radiohead', spotifyId: 's1' },
    { title: 'Creep (Acoustic)', artist: 'Radiohead', spotifyId: 's2' },
  ], 'spotify');
  const am = catalogTracksToSearchResults([
    { title: 'Creep (Acoustic)', artist: 'Radiohead', appleMusicId: 'a2' },
    { title: 'Karma Police', artist: 'Radiohead', appleMusicId: 'a3' },
  ], 'applemusic');

  test('a service hit for a MusicBrainz track adds its source to the MusicBrainz row', () => {
    const rows = mergeTrackResults([mbCreep], [sp], scorer);
    expect(rows[0].id).toBe('mb-1');
    expect(rows[0].sources.spotify).toMatchObject({ spotifyId: 's1', confidence: 0.95 });
    expect(mbCreep.sources).toEqual({}); // inputs are not mutated
  });

  test('another version is its own row, not folded in by containment', () => {
    const rows = mergeTrackResults([mbCreep], [sp], scorer);
    expect(rows.map(r => r.title)).toEqual(['Creep', 'Creep (Acoustic)']);
  });

  test('the same track from a lower-priority service joins the earlier service row', () => {
    const rows = mergeTrackResults([mbCreep], [sp, am], scorer);
    expect(rows.map(r => r.title)).toEqual(['Creep', 'Creep (Acoustic)', 'Karma Police']);
    const acoustic = rows[1];
    expect(acoustic._source).toBe('spotify'); // the higher-priority service's row
    expect(Object.keys(acoustic.sources).sort()).toEqual(['applemusic', 'spotify']);
  });

  test('a local file row is not given service sources, and its duplicates are dropped', () => {
    const local = { id: 'local-1', title: 'Creep', artist: 'Radiohead', isLocal: true, sources: { localFiles: {} } };
    const rows = mergeTrackResults([local], [sp], scorer);
    expect(rows.map(r => r.id)).toEqual(['local-1', sp[1].id]);
    expect(rows[0]).toBe(local);
  });

  test('a row takes the better of its scores, plus a bonus per service that agrees', () => {
    const mbLow = { ...mbCreep, score: 40 };
    expect(mergeTrackResults([mbLow], [sp], scorer)[0].score).toBe(105);
    const rows = mergeTrackResults([], [sp, am], scorer);
    expect(rows.find(r => r.title === 'Creep (Acoustic)').score).toBe(105); // max(95, 100) + 5
    expect(rows.find(r => r.title === 'Creep').score).toBe(100); // one service, no bonus
  });

  test('a hit does not join a MusicBrainz recording from another album', () => {
    const mbLive = { id: 'mb-live', title: 'Roads', artist: 'Portishead', album: 'Roseland NYC Live', sources: {} };
    const studio = catalogTracksToSearchResults([
      { title: 'Roads', artist: 'Portishead', album: 'Dummy', appleMusicId: 'a1' },
    ], 'applemusic');
    const rows = mergeTrackResults([mbLive], [studio], scorer);
    expect(rows.map(r => r.album)).toEqual(['Roseland NYC Live', 'Dummy']);
    expect(rows[0].sources).toEqual({});
  });

  test('a hit joins the MusicBrainz recording on the same album, edition suffix aside', () => {
    const mbLive = { id: 'mb-live', title: 'Roads', artist: 'Portishead', album: 'Roseland NYC Live', sources: {} };
    const mbStudio = { id: 'mb-studio', title: 'Roads', artist: 'Portishead', album: 'Dummy', sources: {} };
    const studio = catalogTracksToSearchResults([
      { title: 'Roads', artist: 'Portishead', album: 'Dummy (Remastered)', appleMusicId: 'a1' },
    ], 'applemusic');
    const rows = mergeTrackResults([mbLive, mbStudio], [studio], scorer);
    expect(rows).toHaveLength(2);
    expect(rows[1].sources.applemusic).toMatchObject({ appleMusicId: 'a1' });
  });

  test('a hit with no album joins the first MusicBrainz recording of the track', () => {
    const mbLive = { id: 'mb-live', title: 'Roads', artist: 'Portishead', album: 'Roseland NYC Live', sources: {} };
    const bare = catalogTracksToSearchResults([{ title: 'Roads', artist: 'Portishead', soundcloudId: 's' }], 'soundcloud');
    expect(mergeTrackResults([mbLive], [bare], scorer)[0].sources.soundcloud).toBeTruthy();
  });

  test('a service source whose artist does not match is not attached', () => {
    // Same normalized key is required to join, so this only guards the scorer
    // floor: a hit with an ISRC-less, artist-mismatched source never joins.
    const other = catalogTracksToSearchResults([{ title: 'Creep', artist: 'Stone Temple Pilots' }], 'spotify');
    const rows = mergeTrackResults([mbCreep], [other], scorer);
    expect(rows).toHaveLength(2);
    expect(rows[0].sources).toEqual({});
  });
});

describe('withoutLocalDuplicates', () => {
  test('drops service rows a local file repeats, keeps MusicBrainz rows', () => {
    const rows = [
      { id: 'mb', title: 'Creep', artist: 'Radiohead' },
      ...catalogTracksToSearchResults([{ title: 'Creep', artist: 'Radiohead' }, { title: 'Lucky', artist: 'Radiohead' }], 'spotify'),
    ];
    const local = [{ title: 'creep', artist: 'RADIOHEAD', isLocal: true }];
    expect(withoutLocalDuplicates(rows, local, scorer).map(r => r.title)).toEqual(['Creep', 'Lucky']);
    expect(withoutLocalDuplicates(rows, [], scorer)).toBe(rows);
  });
});

describe('albums', () => {
  test('MusicBrainz albums lead; a service album MusicBrainz already names is dropped', () => {
    const mb = [{ id: 'rg-1', title: 'OK Computer', 'artist-credit': [{ name: 'Radiohead' }] }];
    const spotify = catalogAlbumsToSearchResults([
      { id: 'spotify-1', name: 'OK Computer (Remastered)', artist: 'Radiohead', url: 'u1' },
      { id: 'spotify-2', name: 'Kid A', artist: 'Radiohead', url: 'u2' },
    ], 'spotify');
    const apple = catalogAlbumsToSearchResults([
      { id: 'am-2', name: 'Kid A', artist: 'Radiohead', url: 'u3' },
    ], 'applemusic');
    const rows = mergeAlbumResults(mb, [spotify, apple]);
    expect(rows.map(r => r.id)).toEqual(['rg-1', 'spotify-2']);
    expect(rows[1]).toMatchObject({ _catalog: { resolverId: 'spotify', url: 'u2' }, score: 95 });
  });
});

describe('catalogArtistsFromResults', () => {
  const tracks = catalogTracksToSearchResults([
    { title: 'Help!', artist: 'The Beatles' },
    { title: 'Beat It', artist: 'Michael Jackson' },
    { title: 'Twist', artist: 'The Beatles' },
  ], 'spotify');
  const albums = catalogAlbumsToSearchResults([{ name: 'Beatles for Sale', artist: 'The Beatles', url: 'u' }], 'applemusic');

  test('artists the results name that match the query, once each, minus MusicBrainz ones', () => {
    const artists = catalogArtistsFromResults({ query: 'beatles', trackLists: [tracks], albumLists: [albums] });
    expect(artists.map(a => a.name)).toEqual(['The Beatles']);
    expect(artists[0]).toMatchObject({ _source: 'spotify', score: 100 });
    expect(catalogArtistsFromResults({
      query: 'beatles', trackLists: [tracks], mbArtists: [{ name: 'The Beatles' }],
    })).toEqual([]);
  });

  test('a query naming the artist and a title still finds the artist', () => {
    const artists = catalogArtistsFromResults({ query: 'the beatles help', trackLists: [tracks] });
    expect(artists.map(a => a.name)).toEqual(['The Beatles']);
  });
});

describe('serviceArtFor', () => {
  test('a MusicBrainz track row lends the cover of the first service source that has one', () => {
    const mb = { id: 'mb-1', title: 'Creep', artist: 'Radiohead', album: 'Pablo Honey', sources: {} };
    const am = catalogTracksToSearchResults([{ title: 'Creep', artist: 'Radiohead', album: 'Pablo Honey', albumArt: 'https://am/1.jpg' }], 'applemusic');
    const sp = catalogTracksToSearchResults([{ title: 'Creep', artist: 'Radiohead', album: 'Pablo Honey', albumArt: 'https://sp/1.jpg' }], 'spotify');
    const [row] = mergeTrackResults([mb], [am, sp], scorer);
    expect(serviceArtFor(row)).toBe('https://am/1.jpg');
  });

  test('a MusicBrainz album row keeps the cover of the service album it absorbed', () => {
    const mb = [{ id: 'rg-1', title: 'Post-Pardon', 'artist-credit': [{ name: 'Quarantine Angst' }] }];
    const bandcamp = catalogAlbumsToSearchResults([
      { name: 'Post-Pardon', artist: 'Quarantine Angst', albumArt: 'https://bc/1.jpg', url: 'u' },
    ], 'bandcamp');
    const [row] = mergeAlbumResults(mb, [bandcamp]);
    expect(row.id).toBe('rg-1');
    expect(serviceArtFor(row)).toBe('https://bc/1.jpg');
    expect(mb[0]._serviceArt).toBeUndefined(); // inputs are not mutated
  });

  test('nothing to lend', () => {
    expect(serviceArtFor({ sources: { x: { albumArt: null } } })).toBeNull();
    expect(serviceArtFor(null)).toBeNull();
  });
});

describe('stabilizeRows', () => {
  const { stabilizeRows, rowIdentityKeys, artistIdentityKeys } = require('../../src/renderer/lib/search-catalog');

  test('rows on screen keep their place; new rows follow in ranked order', () => {
    const first = stabilizeRows([{ id: 'a' }, { id: 'b' }], [], rowIdentityKeys);
    const second = stabilizeRows([{ id: 'c' }, { id: 'b' }, { id: 'a' }, { id: 'd' }], first.shown, rowIdentityKeys);
    expect(second.rows.map(r => r.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(second.rows.map(r => r._rowKey)).toEqual(['a', 'b', 'c', 'd']);
  });

  test('a MusicBrainz row that absorbed a shown service row takes its place and display key', () => {
    const sp = catalogTracksToSearchResults([{ title: 'Creep', artist: 'Radiohead', album: 'Pablo Honey', spotifyId: 's1' }], 'spotify');
    const before = mergeTrackResults([], [sp], scorer);
    const shown1 = stabilizeRows(before, [], rowIdentityKeys);
    const serviceKey = shown1.rows[0]._rowKey;

    const mb = [
      { id: 'mb-other', title: 'Karma Police', artist: 'Radiohead', album: 'OK Computer', sources: {} },
      { id: 'mb-creep', title: 'Creep', artist: 'Radiohead', album: 'Pablo Honey', sources: {} },
    ];
    const after = mergeTrackResults(mb, [sp], scorer);
    const shown2 = stabilizeRows(after, shown1.shown, rowIdentityKeys);
    expect(shown2.rows[0].id).toBe('mb-creep'); // MusicBrainz wins identity
    expect(shown2.rows[0]._rowKey).toBe(serviceKey); // but the card keeps its key and slot
    expect(shown2.rows[0].sources.spotify).toBeTruthy();
    expect(shown2.rows.map(r => r.id)).toEqual(['mb-creep', 'mb-other']);
  });

  test('a MusicBrainz album that replaces a shown service album keeps its slot', () => {
    const svc = catalogAlbumsToSearchResults([{ id: 'spotify-1', name: 'Kid A', artist: 'Radiohead', url: 'u' }], 'spotify');
    const s1 = stabilizeRows(mergeAlbumResults([], [svc]), [], rowIdentityKeys);
    const mb = [{ id: 'rg-kida', title: 'Kid A', 'artist-credit': [{ name: 'Radiohead' }] }];
    const s2 = stabilizeRows(mergeAlbumResults(mb, [svc]), s1.shown, rowIdentityKeys);
    expect(s2.rows[0]).toMatchObject({ id: 'rg-kida', _rowKey: 'spotify-1' });
  });

  test('a MusicBrainz artist replacing a service-named artist keeps its slot', () => {
    const s1 = stabilizeRows([{ id: 'spotify-artist-the-beatles', name: 'The Beatles' }], [], artistIdentityKeys);
    const s2 = stabilizeRows([{ id: 'mbid-x', name: 'Beatles' }, { id: 'mbid-y', name: 'Beatles Revival' }], s1.shown, artistIdentityKeys);
    expect(s2.rows.map(r => [r.id, r._rowKey])).toEqual([['mbid-x', 'spotify-artist-the-beatles'], ['mbid-y', 'mbid-y']]);
  });

  test('a shown row that drops out leaves no hole, and inputs are not mutated', () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    const s1 = stabilizeRows(rows, [], rowIdentityKeys);
    const s2 = stabilizeRows([{ id: 'b' }], s1.shown, rowIdentityKeys);
    expect(s2.rows.map(r => r.id)).toEqual(['b']);
    expect(rows[0]._rowKey).toBeUndefined();
  });
});

test('serviceArtFor passes over URLs known not to load', () => {
  const row = { sources: { bandcamp: { albumArt: 'https://bc/dead.jpg' }, applemusic: { albumArt: 'https://am/ok.jpg' } } };
  expect(serviceArtFor(row)).toBe('https://bc/dead.jpg');
  expect(serviceArtFor(row, new Set(['https://bc/dead.jpg']))).toBe('https://am/ok.jpg');
  expect(serviceArtFor({ _serviceArt: 'x' }, new Set(['x']))).toBeNull();
});
