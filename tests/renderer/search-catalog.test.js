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

  test('a row keeps the better of its scores', () => {
    const mbLow = { ...mbCreep, score: 40 };
    expect(mergeTrackResults([mbLow], [sp], scorer)[0].score).toBe(100);
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
