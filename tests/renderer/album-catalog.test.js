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
    expect(release._catalogSource).toEqual({ resolverId: 'applemusic', name: 'Apple Music' });
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
