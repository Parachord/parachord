/**
 * Album track lists from the plugins (capabilities.albumSearch) when
 * MusicBrainz can't supply them: matching, resolver order, and the
 * conversion to the release-page shape.
 */

const {
  isMusicBrainzId,
  resolverIdFromReleaseId,
  normalizeAlbumTitle,
  albumMatchScore,
  sameAlbumIdentity,
  pickCatalogAlbum,
  creditMatches,
  releaseGroupCredit,
  pickReleaseGroupForAlbum,
  orderCatalogResolvers,
  catalogAlbumToRelease,
  catalogAlbumToSearchResult,
} = require('../../src/renderer/lib/album-catalog');

describe('ids', () => {
  test('a MusicBrainz id is a UUID; service ids are not', () => {
    expect(isMusicBrainzId('f075d022-497c-4bbb-b4a2-25bf38c18ca5')).toBe(true);
    expect(isMusicBrainzId('spotify-4aawyAB9vmqN3uQ7FjRGTy')).toBe(false);
    expect(isMusicBrainzId('applemusic-1440857781')).toBe(false);
    expect(isMusicBrainzId(undefined)).toBe(false);
  });

  test('a service id names its resolver only when that resolver exists', () => {
    const known = ['spotify', 'applemusic', 'bandcamp'];
    expect(resolverIdFromReleaseId('spotify-4aawyAB9vmqN3uQ7FjRGTy', known)).toBe('spotify');
    expect(resolverIdFromReleaseId('applemusic-1440857781', known)).toBe('applemusic');
    expect(resolverIdFromReleaseId('lastfm-wild-pink-x', known)).toBe(null);
  });
});

describe('matching', () => {
  const target = { artist: 'Wild Pink', title: 'Dulling the Horns' };

  test('edition and format suffixes do not block a match', () => {
    expect(normalizeAlbumTitle('Dulling the Horns (Deluxe Edition)')).toBe(normalizeAlbumTitle('Dulling the Horns'));
    expect(normalizeAlbumTitle('Hey Jude (Remastered 2015) - Single')).toBe(normalizeAlbumTitle('Hey Jude'));
    expect(normalizeAlbumTitle('Album [Explicit]')).toBe(normalizeAlbumTitle('Album'));
  });

  test('the right album by the right artist matches', () => {
    expect(albumMatchScore(target, { name: 'Dulling the Horns', artist: 'Wild Pink' })).toBeGreaterThan(0);
    expect(albumMatchScore(target, { name: 'Dulling The Horns', artist: 'wild pink' })).toBeGreaterThan(0);
  });

  test('a same-titled album by someone else does not', () => {
    expect(albumMatchScore(target, { name: 'Dulling the Horns', artist: 'Other Band' })).toBe(0);
  });

  test('a different album by the same artist does not', () => {
    expect(albumMatchScore(target, { name: 'Yolk in the Fur', artist: 'Wild Pink' })).toBe(0);
    // containment needs the shorter title to be most of the longer one
    expect(albumMatchScore({ artist: 'Wild Pink', title: 'Wild Pink' }, { name: 'Wild Pink (Audiotree Live) - EP Session Recordings', artist: 'Wild Pink' })).toBe(0);
  });

  test('one artist of a joint credit is enough, and "the" / "&" are ignored', () => {
    expect(albumMatchScore({ artist: 'Elton John', title: 'Cold Heart' }, { name: 'Cold Heart', artist: 'Elton John & Dua Lipa' })).toBeGreaterThan(0);
    expect(albumMatchScore({ artist: 'The War on Drugs', title: 'Lost in the Dream' }, { name: 'Lost in the Dream', artist: 'War on Drugs' })).toBeGreaterThan(0);
    expect(albumMatchScore({ artist: 'Simon & Garfunkel', title: 'Bookends' }, { name: 'Bookends', artist: 'Simon and Garfunkel' })).toBeGreaterThan(0);
  });

  test('two joint credits written with different separators are the same act', () => {
    // Amazon writes "Ozzy Osbourne, Black Sabbath", MusicBrainz "Ozzy Osbourne
    // & Black Sabbath": folding the whole string left them different, and the
    // album openers matched no search result at all.
    expect(creditMatches('Ozzy Osbourne, Black Sabbath', 'Ozzy Osbourne & Black Sabbath')).toBe(true);
    expect(creditMatches('Ozzy Osbourne & Black Sabbath', 'Ozzy Osbourne, Black Sabbath')).toBe(true);
    expect(albumMatchScore(
      { artist: 'Ozzy Osbourne, Black Sabbath', title: 'Back To The Beginning (Live)' },
      { name: 'Back to the Beginning', artist: 'Ozzy Osbourne & Black Sabbath' }
    )).toBeGreaterThan(0);
  });

  test('a different act is still a different act', () => {
    expect(creditMatches('Ozzy Osbourne, Black Sabbath', 'Lounge Brigade')).toBe(false);
    expect(creditMatches('Lounge Brigade', 'Ozzy Osbourne & Black Sabbath')).toBe(false);
    expect(creditMatches('', 'Anyone')).toBe(false);
  });

  test('both sides joint need the same names, not one shared member', () => {
    // Sharing a member is not being the same act: "A & B" and "A & C" are
    // two collaborations, and treating them as one put another act's album in
    // an album's edition list. (One side a single name is different, and is
    // the documented rule — see the test above.)
    expect(creditMatches('A & B', 'A & C')).toBe(false);
    expect(creditMatches('Erykah Badu and The Alchemist', 'Erykah Badu, The Alchemist')).toBe(true);
    // one side a single name: one artist of the joint credit is enough
    expect(creditMatches('Ozzy Osbourne', 'Ozzy Osbourne & Black Sabbath')).toBe(true);
    expect(creditMatches('Ozzy Osbourne & Black Sabbath', 'Black Sabbath')).toBe(true);
    // a real artist whose own name splits like a joint credit (MusicBrainz
    // has an artist called "Earth" too): the long-standing single-vs-joint rule
    expect(creditMatches('Earth', 'Earth, Wind & Fire')).toBe(true);
  });

  test('non-Latin titles match on their own letters', () => {
    expect(albumMatchScore({ artist: 'ХЛЕБ', title: 'Пушка' }, { name: 'Пушка', artist: 'ХЛЕБ' })).toBeGreaterThan(0);
    expect(albumMatchScore({ artist: 'ХЛЕБ', title: 'Пушка' }, { name: 'Яйца', artist: 'ХЛЕБ' })).toBe(0);
  });

  test('pickCatalogAlbum prefers the exact match over a close one', () => {
    const albums = [
      { name: 'Dulling the Horns (Deluxe)', artist: 'Wild Pink', url: 'u1' },
      { name: 'Dulling the Horns', artist: 'Wild Pink', url: 'u2' },
      { name: 'Yolk in the Fur', artist: 'Wild Pink', url: 'u3' },
    ];
    expect(pickCatalogAlbum(albums, target).url).toBe('u2');
    expect(pickCatalogAlbum([{ name: 'Nope', artist: 'Wild Pink' }], target)).toBe(null);
    expect(pickCatalogAlbum(undefined, target)).toBe(null);
  });
});

describe('pickReleaseGroupForAlbum', () => {
  const group = (id, title, credit, { type = 'Album', secondary = null } = {}) => ({
    id,
    title,
    'primary-type': type,
    ...(secondary ? { 'secondary-types': secondary } : {}),
    'artist-credit': credit.map((name, i) => ({ name, ...(i < credit.length - 1 ? { joinphrase: ' & ' } : {}) })),
  });

  // A real MusicBrainz answer for "Ozzy Osbourne, Black Sabbath Back To The
  // Beginning (Live)" (Amazon's credit string), 2026-11-20: the album asked
  // for is first and is a Live album, the only studio album is a tribute.
  const ozzySearch = [
    group('right', 'Back to the Beginning', ['Ozzy Osbourne', 'Black Sabbath'], { secondary: ['Live'] }),
    group('ozzy-years', 'The Ozzy Osbourne Years', ['Black Sabbath'], { secondary: ['Compilation'] }),
    group('tribute', 'Sabbath in the Suburbs: The Lounge Tribute to Ozzy Osbourne & Black Sabbath', ['Lounge Brigade']),
  ];

  test('the album whose title and artist match, not the first studio album in the list', () => {
    expect(pickReleaseGroupForAlbum(ozzySearch, { artist: 'Ozzy Osbourne, Black Sabbath', title: 'Back To The Beginning (Live)' }).id).toBe('right');
  });

  test('a studio edition wins between two editions of the same album', () => {
    const editions = [
      group('live', 'Dulling the Horns', ['Wild Pink'], { secondary: ['Live'] }),
      group('studio', 'Dulling the Horns', ['Wild Pink']),
    ];
    expect(pickReleaseGroupForAlbum(editions, { artist: 'Wild Pink', title: 'Dulling the Horns' }).id).toBe('studio');
  });

  test('the right artist beats a same-titled album by someone else', () => {
    const results = [group('other', 'Black Star', ['Someone Else']), group('mine', 'Black Star', ['Lustmord'], { type: 'Single' })];
    expect(pickReleaseGroupForAlbum(results, { artist: 'Lustmord', title: 'Black Star' }).id).toBe('mine');
  });

  test('with no title (a caller that only knows the artist) the artist decides: a studio album first, then MusicBrainz order', () => {
    expect(pickReleaseGroupForAlbum(ozzySearch, { artist: 'Ozzy Osbourne, Black Sabbath' }).id).toBe('right');
    expect(pickReleaseGroupForAlbum([group('top', 'X', ['A']), group('live', 'X', ['A'], { secondary: ['Live'] })], { artist: 'A' }).id).toBe('top');
  });

  test('nothing matching: the closest title, then the artist\'s own releases, then the top result; empty input gives null', () => {
    expect(pickReleaseGroupForAlbum([group('a', 'X', ['A']), group('b', 'Y', ['B'])], { artist: 'B', title: 'Z' }).id).toBe('b');
    expect(pickReleaseGroupForAlbum([group('top', 'X', ['A'])], { artist: 'B', title: 'Z' }).id).toBe('top');
    expect(pickReleaseGroupForAlbum([], { artist: 'A', title: 'X' })).toBeNull();
    expect(pickReleaseGroupForAlbum(undefined, { artist: 'A' })).toBeNull();
  });

  test('a long MusicBrainz spelling of the title beats another album of the same artist', () => {
    // MusicBrainz often spells a title out: a source's "Back to the Beginning"
    // is "Back to the Beginning: The Final Show, Live from Villa Park" here,
    // too little of the shorter side for albumMatchScore's containment gate.
    // Without the title-closeness pass the artist fallback took the studio
    // album "13" — the original bug in another shape.
    const results = [
      group('final-show', 'Back to the Beginning: The Final Show, Live from Villa Park', ['Ozzy Osbourne', 'Black Sabbath'], { secondary: ['Live'] }),
      group('13', '13', ['Black Sabbath']),
    ];
    expect(pickReleaseGroupForAlbum(results, { artist: 'Ozzy Osbourne, Black Sabbath', title: 'Back to the Beginning' }).id).toBe('final-show');
  });

  test('a title the results spell out counts whatever its length', () => {
    // A prefix counts only at a word boundary, not from an arbitrary length:
    // "Rumours" is still the album MusicBrainz calls "Rumours: Live from the
    // Forum 1977", while "Go" is not the artist's "Goodbye".
    const spelledOut = [group('tusk', 'Tusk', ['Fleetwood Mac']), group('rumours', 'Rumours: Live from the Forum 1977', ['Fleetwood Mac'], { secondary: ['Live'] })];
    expect(pickReleaseGroupForAlbum(spelledOut, { artist: 'Fleetwood Mac', title: 'Rumours' }).id).toBe('rumours');
    const shortPrefix = [group('b', 'B', ['A']), group('bye', 'Goodbye', ['A'])];
    expect(pickReleaseGroupForAlbum(shortPrefix, { artist: 'A', title: 'Go' }).id).toBe('b');
    const thirdWord = [group('b', 'B', ['A']), group('home', 'Homecoming', ['A'])];
    expect(pickReleaseGroupForAlbum(thirdWord, { artist: 'A', title: 'Home' }).id).toBe('b');
  });

  test('the credit reads as one string, join phrases included', () => {
    expect(releaseGroupCredit(group('x', 'T', ['Ozzy Osbourne', 'Black Sabbath']))).toBe('Ozzy Osbourne & Black Sabbath');
    expect(releaseGroupCredit(group('x', 'T', ['Solo']))).toBe('Solo');
    // a credit that carries no join phrases still separates the names, so
    // creditMatches can split them
    expect(releaseGroupCredit({ 'artist-credit': [{ name: 'A' }, { name: 'B' }] })).toBe('A, B');
    // a result whose credit carries the artist object but no name
    expect(releaseGroupCredit({ 'artist-credit': [{ artist: { name: 'From the artist' } }] })).toBe('From the artist');
    expect(releaseGroupCredit(null)).toBe('');
  });
});

describe('orderCatalogResolvers', () => {
  const resolvers = [{ id: 'bandcamp' }, { id: 'localfiles' }, { id: 'applemusic' }, { id: 'spotify' }, { id: 'subsonic' }];

  test('active services in priority order first, then the rest', () => {
    const ordered = orderCatalogResolvers(resolvers, {
      activeIds: ['spotify', 'localfiles'],
      order: ['spotify', 'applemusic', 'bandcamp', 'localfiles', 'subsonic'],
    }).map(r => r.id);
    expect(ordered).toEqual(['spotify', 'localfiles', 'applemusic', 'bandcamp', 'subsonic']);
  });

  test('the service a release came from goes first', () => {
    const ordered = orderCatalogResolvers(resolvers, { activeIds: ['spotify'], order: ['spotify'], preferId: 'applemusic' }).map(r => r.id);
    expect(ordered[0]).toBe('applemusic');
    expect(ordered[1]).toBe('spotify');
  });
});

describe('catalogAlbumToRelease', () => {
  const album = {
    id: 'applemusic-album-1',
    name: 'Dulling the Horns',
    artist: 'Wild Pink',
    albumArt: 'https://example.com/a.jpg',
    releaseDate: '2024-10-04T07:00:00Z',
    tracks: [
      { id: 'applemusic-2', title: 'Second', duration: 200, trackNumber: 2, discNumber: 1, sources: ['applemusic'], appleMusicId: '2' },
      { id: 'applemusic-1', title: 'First', duration: 180.4, trackNumber: 1, discNumber: 1, sources: ['applemusic'], appleMusicId: '1' },
      { id: 'applemusic-3', title: 'Disc Two', duration: 0, trackNumber: 1, discNumber: 2 },
    ],
  };

  test('converts to the release-page shape, in disc and track order', () => {
    const release = catalogAlbumToRelease(album, { resolverId: 'applemusic', resolverName: 'Apple Music' });
    expect(release.title).toBe('Dulling the Horns');
    expect(release.artist).toEqual({ id: null, name: 'Wild Pink' });
    expect(release.date).toBe('2024-10-04');
    expect(release.tracks.map(t => [t.mediumIndex, t.position, t.title])).toEqual([
      [1, 1, 'First'], [1, 2, 'Second'], [2, 1, 'Disc Two'],
    ]);
    expect(release.tracks[0].length).toBe(180400); // ms, as MusicBrainz gives it
    expect(release.tracks[2].length).toBe(null);
    expect(release._catalogSource).toEqual({ resolverId: 'applemusic', name: 'Apple Music', url: null });
  });

  test('carries the album url the source dropdown marks the current edition by', () => {
    const withUrl = catalogAlbumToRelease({ ...album, url: 'https://music.apple.com/us/album/dulling-the-horns/1' }, { resolverId: 'applemusic', resolverName: 'Apple Music' });
    expect(withUrl._catalogSource.url).toBe('https://music.apple.com/us/album/dulling-the-horns/1');
  });

  test('drops service-specific fields so the usual resolution runs', () => {
    const [t] = catalogAlbumToRelease(album, { resolverId: 'applemusic' }).tracks;
    expect(t).not.toHaveProperty('sources');
    expect(t).not.toHaveProperty('appleMusicId');
    expect(t).not.toHaveProperty('id');
  });

  test('the requested title, artist, id and art win, so track ids match the MusicBrainz path', () => {
    const release = catalogAlbumToRelease(album, {
      resolverId: 'applemusic',
      requested: { id: 'f075d022-497c-4bbb-b4a2-25bf38c18ca5', title: 'Dulling The Horns', artistName: 'Wild Pink', albumArt: 'cached.jpg', releaseType: 'album' },
    });
    expect(release.id).toBe('f075d022-497c-4bbb-b4a2-25bf38c18ca5');
    expect(release.title).toBe('Dulling The Horns');
    expect(release.albumArt).toBe('cached.jpg');
  });

  test('tracks without numbers are numbered in order', () => {
    const release = catalogAlbumToRelease({ name: 'X', artist: 'Y', tracks: [{ title: 'a' }, { title: 'b' }] }, { resolverId: 'bandcamp' });
    expect(release.tracks.map(t => t.position)).toEqual([1, 2]);
  });
});

test('catalogAlbumToSearchResult carries its source for the click', () => {
  const row = catalogAlbumToSearchResult({ id: 'bandcamp-album-1', name: 'Still Coming Down', artist: 'Wild Pink', url: 'https://wildpink.bandcamp.com/album/still-coming-down' }, 'bandcamp');
  expect(row).toMatchObject({
    title: 'Still Coming Down',
    'artist-credit': [{ name: 'Wild Pink' }],
    _source: 'bandcamp',
    _catalog: { resolverId: 'bandcamp', url: 'https://wildpink.bandcamp.com/album/still-coming-down' },
  });
});

describe('sameAlbumIdentity', () => {
  test('same artist and title, whatever the ids, the artist shape and the edition', () => {
    expect(sameAlbumIdentity(
      { id: 'rg-id', title: 'Dulling the Horns', artist: { name: 'Wild Pink' } },
      { id: 'release-id', title: 'Dulling The Horns (Deluxe)', artist: 'wild pink' }
    )).toBe(true);
  });

  test('a different album or artist is not the same', () => {
    expect(sameAlbumIdentity({ title: 'A', artist: 'X' }, { title: 'B', artist: 'X' })).toBe(false);
    expect(sameAlbumIdentity({ title: 'A', artist: 'X' }, { title: 'A', artist: 'Y' })).toBe(false);
  });

  test('missing fields never match', () => {
    expect(sameAlbumIdentity({ title: '', artist: 'X' }, { title: '', artist: 'X' })).toBe(false);
    expect(sameAlbumIdentity(null, { title: 'A', artist: 'X' })).toBe(false);
  });
});
