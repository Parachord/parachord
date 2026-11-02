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

// Search's ranking, with the real Fuse the renderer loads (vendor/fuse.min.js).
describe('rankSearchRows', () => {
  const Fuse = require('../../vendor/fuse.min.js');
  const {
    rankSearchRows, ALBUM_RANK_KEY, albumArtistName, queryNamesArtist, ARTIST_NAMED_BONUS,
  } = require('../../src/renderer/lib/search-catalog');
  const album = (title, artist, score) => ({ id: `${artist}:${title}`, title, 'artist-credit': [{ name: artist }], score });

  // 2026-11-02: "Mazzy Star" listed only covers under Albums. MusicBrainz
  // returned Mazzy Star's own albums (score 100), but titles alone ranked
  // them at 40 and the services' covers ("… (Mazzy Star Cover)") near 100.
  test('an artist search ranks the artist\'s own albums above covers that mention the name', () => {
    const rows = [
      album('Mazzy Star Covers', 'Mersilde', 100),
      album('Into Dust (Mazzy Star Cover)', 'Indigo Raven', 95),
      album('fade into you (mazzy star cover)', 'bleach bath', 90),
      album('Among My Swan', 'Mazzy Star', 100),
      album('So Tonight That I Might See', 'Mazzy Star', 100),
    ];
    const ranked = rankSearchRows(rows, 'Mazzy Star', { Fuse, key: ALBUM_RANK_KEY, artistOf: albumArtistName });
    expect(ranked.slice(0, 2).map(r => albumArtistName(r))).toEqual(['Mazzy Star', 'Mazzy Star']);
  });

  test('a title search still finds the title first', () => {
    const rows = [
      album('Pink Moon', 'Nick Drake', 100),
      album('Abbey Road', 'The Beatles', 100),
      album('Abbey Road Revisited', 'Various Artists', 90),
    ];
    const ranked = rankSearchRows(rows, 'abbey road', { Fuse, key: ALBUM_RANK_KEY, artistOf: albumArtistName });
    expect(ranked[0].title).toBe('Abbey Road');
    expect(ranked[ranked.length - 1].title).toBe('Pink Moon');
  });

  test('"artist title" puts that artist\'s track above a cover titled with both', () => {
    const rows = [
      { id: 'cover', title: 'Portishead - Roads', artist: 'Some Covers Band', score: 100 },
      { id: 'own', title: 'Roads', artist: 'Portishead', score: 90 },
    ];
    const ranked = rankSearchRows(rows, 'portishead roads', { Fuse, key: { name: 'artistTitle', getFn: t => `${t.artist} ${t.title}` }, artistOf: t => t.artist });
    expect(ranked[0].id).toBe('own');
  });

  test('without artistOf there is no bonus; no Fuse or no query leaves the order', () => {
    const rows = [album('A', 'X', 10), album('B', 'Y', 90)];
    expect(rankSearchRows(rows, 'x', { Fuse, key: 'title' }).every(r => r._finalScore < ARTIST_NAMED_BONUS + 100)).toBe(true);
    expect(rankSearchRows(rows, '', { Fuse, key: 'title' })).toBe(rows);
    expect(rankSearchRows(rows, 'x', { key: 'title' })).toBe(rows);
  });
});

describe('queryNamesArtist', () => {
  const { queryNamesArtist } = require('../../src/renderer/lib/search-catalog');
  test('whole words, any position, accents and a leading "The" ignored', () => {
    expect(queryNamesArtist('Mazzy Star', 'Mazzy Star')).toBe(true);
    expect(queryNamesArtist('mazzy star among my swan', 'Mazzy Star')).toBe(true);
    expect(queryNamesArtist('roads portishead', 'Portishead')).toBe(true);
    expect(queryNamesArtist('beatles abbey road', 'The Beatles')).toBe(true);
    expect(queryNamesArtist('the beatles', 'Beatles')).toBe(true);
    expect(queryNamesArtist('beyonce lemonade', 'Beyoncé')).toBe(true);
    expect(queryNamesArtist('simon garfunkel', 'Simon & Garfunkel')).toBe(false); // "and" is a word
    expect(queryNamesArtist('simon and garfunkel', 'Simon & Garfunkel')).toBe(true);
  });
  test('not a part of a word, not an empty name', () => {
    expect(queryNamesArtist('airplane', 'Air')).toBe(false);
    expect(queryNamesArtist('mazzy', 'Mazzy Star')).toBe(false);
    expect(queryNamesArtist('anything', '')).toBe(false);
  });
});

describe('stabilizeRows tiers', () => {
  const { stabilizeRows, rowIdentityKeys, queryNamesArtist, albumArtistName } = require('../../src/renderer/lib/search-catalog');
  const album = (id, title, artist) => ({ id, title, 'artist-credit': [{ name: artist }] });
  const tier = (row) => (queryNamesArtist('Mazzy Star', albumArtistName(row)) ? 1 : 0);

  test('the artist\'s own albums, arriving after covers, move above them once; rows hold still within a tier', () => {
    // a fast service answers first with covers that mention the name
    const first = stabilizeRows([album('c1', 'Mazzy Star Covers', 'Mersilde'), album('c2', 'Into Dust (Mazzy Star Cover)', 'Indigo Raven')], [], rowIdentityKeys, tier);
    expect(first.rows.map(r => r.id)).toEqual(['c1', 'c2']);
    // then Mazzy Star's own albums
    const ranked = [album('m1', 'Among My Swan', 'Mazzy Star'), album('m2', 'Still', 'Mazzy Star'), album('c2', 'Into Dust (Mazzy Star Cover)', 'Indigo Raven'), album('c1', 'Mazzy Star Covers', 'Mersilde')];
    const second = stabilizeRows(ranked, first.shown, rowIdentityKeys, tier);
    expect(second.rows.map(r => r.id)).toEqual(['m1', 'm2', 'c1', 'c2']); // covers keep their order among themselves
    // a later answer doesn't reshuffle what's shown
    const third = stabilizeRows([album('m3', 'Deep Cuts', 'Mazzy Star'), ...ranked], second.shown, rowIdentityKeys, tier);
    expect(third.rows.map(r => r.id)).toEqual(['m1', 'm2', 'm3', 'c1', 'c2']);
  });

  test('without tierOf, behavior is unchanged', () => {
    const first = stabilizeRows([album('c1', 'X', 'A')], [], rowIdentityKeys);
    const second = stabilizeRows([album('m1', 'Y', 'Mazzy Star'), album('c1', 'X', 'A')], first.shown, rowIdentityKeys);
    expect(second.rows.map(r => r.id)).toEqual(['c1', 'm1']);
  });
});

describe('popularity', () => {
  const Fuse = require('../../vendor/fuse.min.js');
  const {
    popularityFromListens, rankSearchRows, ALBUM_RANK_KEY, albumArtistName, catalogTrackToSearchResult,
  } = require('../../src/renderer/lib/search-catalog');
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');

  test('listen counts map to 0-100 on a log scale; no data is null', () => {
    expect(popularityFromListens(0)).toBe(0);
    expect(popularityFromListens(1e6)).toBeCloseTo(100, 5);
    expect(popularityFromListens(1e9)).toBe(100);
    expect(popularityFromListens(609887)).toBeGreaterThan(95); // Dummy
    expect(popularityFromListens(50)).toBeLessThan(30); // an obscure cover
    expect(popularityFromListens(null)).toBeNull();
    expect(popularityFromListens(-1)).toBeNull();
    expect(popularityFromListens(NaN)).toBeNull();
  });

  test('between equally matching rows, the more listened one ranks first; a row without popularity counts as the median', () => {
    const rows = [
      { id: 'obscure', title: 'Roads', score: 100, _popularity: 20 },
      { id: 'famous', title: 'Roads', score: 100, _popularity: 95 },
      { id: 'unknown', title: 'Roads', score: 100 },
    ];
    // same title, so relevance is equal and only standing differs
    const ranked = rankSearchRows(rows, 'roads', { Fuse, key: 'title' });
    expect(ranked.map(r => r.id)).toEqual(['famous', 'unknown', 'obscure']);
    const by = Object.fromEntries(ranked.map(r => [r.id, r._finalScore]));
    // unknown stands at the median of 20 and 95
    expect(by.famous - by.unknown).toBeCloseTo(((100 + 95) / 2 - (100 + 57.5) / 2) * 0.4, 5);
  });

  test('graceful degradation: with no popularity anywhere the ranking is unchanged, and lacking it is neutral', () => {
    const plain = [
      { id: 'a', title: 'Roads', score: 90 },
      { id: 'b', title: 'Roads', score: 100 },
    ];
    const ranked = rankSearchRows(plain, 'roads', { Fuse, key: 'title' });
    expect(ranked.map(r => r.id)).toEqual(['b', 'a']);
    // one service sends popularity (Spotify), another doesn't (Apple Music):
    // the row without it isn't helped or hurt relative to a row at the median
    const mixed = [
      { id: 'spotify-mid', title: 'Roads', score: 100, _popularity: 50 },
      { id: 'apple', title: 'Roads', score: 100 },
    ];
    const both = rankSearchRows(mixed, 'roads', { Fuse, key: 'title' });
    expect(both[0]._finalScore).toBeCloseTo(both[1]._finalScore, 5);
  });

  test('a service track keeps its own popularity', () => {
    const row = catalogTrackToSearchResult({ title: 'Roads', artist: 'Portishead', album: 'Dummy', popularity: 71 }, 'spotify', 0);
    expect(row._popularity).toBe(71);
    expect(catalogTrackToSearchResult({ title: 'Roads', artist: 'Portishead' }, 'applemusic', 0)._popularity).toBeUndefined();
  });

  test('Search fetches ListenBrainz popularity for MusicBrainz rows before showing them, capped and cached', () => {
    const search = app.slice(app.indexOf('const performSearch = async (query) => {'), app.indexOf('const catalogPromise = Promise.all(['));
    expect(search.indexOf("mb.albums = await withListenBrainzPopularity('release-group', mb.albums);")).toBeGreaterThan(-1);
    expect(search.indexOf("mb.albums = await withListenBrainzPopularity('release-group', mb.albums);")).toBeLessThan(search.indexOf('publishAlbums();', search.indexOf('const albumPromise')));
    // tracks by their artist's total: a song's own recording count is patchy
    const trackPop = search.indexOf("mb.tracks = await withListenBrainzPopularity('artist', mb.tracks, {");
    expect(trackPop).toBeGreaterThan(-1);
    expect(trackPop).toBeLessThan(search.indexOf('publishTracks();', search.indexOf('const trackPromise')));
    expect(search).toMatch(/idOf: t => t\.artistMbids\?\.\[0\], reference: ARTIST_POPULARITY_REFERENCE_LISTENS/);
    // a row that clearly outranks a shown one moves past it
    expect(search).toMatch(/const promoteByScore = \{ scoreOf: r => r\._finalScore, margin: PROMOTE_MARGIN \};/);
    expect(search).toMatch(/stabilizeRows\(ranked, shown\[category\], identityKeys, tierOf, promoteByScore\)/);
    const fetcher = app.slice(app.indexOf('const fetchListenBrainzPopularity = async'), app.indexOf('const withListenBrainzPopularity = async'));
    expect(fetcher).toMatch(/timeoutMs = 800/);
    expect(fetcher).toMatch(/https:\/\/api\.listenbrainz\.org\/1\/popularity\/\$\{kind\}/);
    expect(fetcher).toMatch(/method: 'POST'/);
    expect(fetcher).toMatch(/cache\.set\(`\$\{kind\}:\$\{id\}`, \{ value, at: now \}\)/);
    expect(app).toMatch(/const LISTENBRAINZ_POPULARITY_TTL_MS = 24 \* 60 \* 60 \* 1000;/);
  });
});

describe('artist popularity and promotion', () => {
  const {
    popularityFromListens, ARTIST_POPULARITY_REFERENCE_LISTENS, stabilizeRows, rowIdentityKeys, PROMOTE_MARGIN,
  } = require('../../src/renderer/lib/search-catalog');

  test('artist totals use a 10M scale that still separates a known artist from a small one', () => {
    const mazzy = popularityFromListens(4191963, ARTIST_POPULARITY_REFERENCE_LISTENS);
    const melt = popularityFromListens(18536, ARTIST_POPULARITY_REFERENCE_LISTENS);
    expect(mazzy).toBeGreaterThan(93);
    expect(mazzy).toBeLessThan(96);
    expect(melt).toBeGreaterThan(58);
    expect(melt).toBeLessThan(64);
  });

  const row = (id, score) => ({ id, _finalScore: score });
  const promote = { scoreOf: r => r._finalScore, margin: PROMOTE_MARGIN };

  test('a later row that clearly outranks shown rows moves above them, once; small gaps hold still', () => {
    const first = stabilizeRows([row('cover1', 81), row('cover2', 80), row('cover3', 76)], [], rowIdentityKeys, null, promote);
    expect(first.rows.map(r => r.id)).toEqual(['cover1', 'cover2', 'cover3']);
    // the original arrives 6 points above the top cover: it moves to the top
    const second = stabilizeRows([row('original', 87), row('cover1', 81), row('cover2', 80), row('nearby', 79), row('cover3', 76)], first.shown, rowIdentityKeys, null, promote);
    // a new row only 3 points above a shown one lands after it, like any new row
    expect(second.rows.map(r => r.id)).toEqual(['original', 'cover1', 'cover2', 'cover3', 'nearby']);
    // the next answer re-scores slightly; nothing within the margin moves
    const third = stabilizeRows([row('original', 86), row('cover2', 82), row('cover1', 80), row('nearby', 79), row('cover3', 77)], second.shown, rowIdentityKeys, null, promote);
    expect(third.rows.map(r => r.id)).toEqual(['original', 'cover1', 'cover2', 'cover3', 'nearby']);
  });

  test('promotion never crosses a tier', () => {
    const tierOf = r => (r.id.startsWith('own') ? 1 : 0);
    const first = stabilizeRows([row('own1', 70)], [], rowIdentityKeys, tierOf, promote);
    const second = stabilizeRows([row('popular-cover', 99), row('own1', 70)], first.shown, rowIdentityKeys, tierOf, promote);
    expect(second.rows.map(r => r.id)).toEqual(['own1', 'popular-cover']);
  });
});

describe('queryNamesRow: an exact title counts like naming the artist', () => {
  const Fuse = require('../../vendor/fuse.min.js');
  const { queryNamesRow, rankSearchRows, ALBUM_RANK_KEY, albumArtistName, stabilizeRows, rowIdentityKeys } = require('../../src/renderer/lib/search-catalog');
  const album = (id, title, artist, score, pop) => ({ id, title, 'artist-credit': [{ name: artist }], score, ...(pop !== undefined ? { _popularity: pop } : {}) });

  test('artist or exact title, edition suffixes aside', () => {
    expect(queryNamesRow('Abbey Road', 'The Beatles', 'Abbey Road')).toBe(true);
    expect(queryNamesRow('Abbey Road', 'The Beatles', 'Abbey Road (Remastered 2009)')).toBe(true);
    expect(queryNamesRow('Abbey Road', 'The Beatles', 'Abbey Road (2019 Mix)')).toBe(false); // a different mix isn't an edition suffix
    expect(queryNamesRow('Abbey Road', 'Abbey Road', 'Enjoy The Beatles!')).toBe(true); // names the band
    expect(queryNamesRow('Abbey Road', 'Dream Theater', 'Abbey Road Medley')).toBe(false);
    expect(queryNamesRow('Mazzy Star', 'Haytham', 'Mazzy Star - Single')).toBe(true); // ranked by popularity within the tier
  });

  // 2026-11-02, live: a tribute band named Abbey Road topped "Abbey Road"
  // with "Enjoy The Beatles!" because only the band was "named".
  test('"Abbey Road": the Beatles\' album outranks a tribute band named Abbey Road', () => {
    const rows = [
      album('band', 'Enjoy The Beatles!', 'Abbey Road', 100, 30),
      album('beatles', 'Abbey Road', 'The Beatles', 100, 99),
      album('medley', 'Abbey Road Medley', 'Dream Theater', 95, 70),
    ];
    const ranked = rankSearchRows(rows, 'Abbey Road', { Fuse, key: ALBUM_RANK_KEY, artistOf: albumArtistName });
    expect(ranked[0].id).toBe('beatles');
    const tier = (r) => (queryNamesRow('Abbey Road', albumArtistName(r), r.title) ? 1 : 0);
    const shown = stabilizeRows(ranked, [], rowIdentityKeys, tier);
    expect(shown.rows.map(r => r.id).slice(0, 2)).toEqual(['beatles', 'band']);
  });
});
