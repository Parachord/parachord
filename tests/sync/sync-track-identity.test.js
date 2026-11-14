/**
 * Library sync matches an incoming track to the collection row that already
 * holds it, not only by id (parachord#1397 and the multi-artist heart case).
 *
 * A collection id is built from artist, title and album, and the two sides
 * build it differently:
 *  - a heart builds it from the full artist credit ("Mondo Cozmo, Jim James"),
 *    while Spotify sync builds it from the first artist only;
 *  - a love import with no album gets `-noalbum`, while sync brings the album.
 * Matching by id alone added a second row for the same song in both cases.
 */

const { syncDataType } = require('../../sync-engine');
const SpotifyProvider = require('../../sync-providers/spotify');
const AppleMusicProvider = require('../../sync-providers/applemusic');

const SPOTIFY_ID = '75RrvGMJftSdTwt6fjD3rL';

const provider = (remote) => ({
  id: 'spotify',
  nativeIdOf: (t) => SpotifyProvider.nativeIdOf(t),
  fetchTracks: jest.fn(async () => remote),
  fetchAlbums: jest.fn(async () => remote),
  fetchArtists: jest.fn(async () => remote)
});

const sync = (remote, local, dataType = 'tracks') =>
  syncDataType(provider(remote), 'token', dataType, local, () => {}, null);

// What sync-providers/spotify.js transformTrack produces.
const remoteTrack = ({ id, artist, title, album, spotifyId, addedAt = 1794689768000 }) => ({
  id,
  externalId: spotifyId,
  title,
  artist,
  album,
  duration: 259,
  addedAt,
  spotifyUri: `spotify:track:${spotifyId}`,
  spotifyId,
  sources: { spotify: { id: `spotify-${spotifyId}`, title, artist, album, spotifyUri: `spotify:track:${spotifyId}`, spotifyId, confidence: 1 } }
});

// The user's case: a heart saved the full credit; Spotify sync's id uses the
// first artist only. The heart row holds the Spotify id under sources.spotify
// (the id the heart pushed to Liked Songs), never at the top level.
const heartRow = () => ({
  id: 'mondo-cozmo-jim-james-white-roses-white-roses',
  title: 'White Roses',
  artist: 'Mondo Cozmo, Jim James',
  album: 'White Roses',
  sources: {
    spotify: { spotifyId: SPOTIFY_ID, spotifyUri: `spotify:track:${SPOTIFY_ID}` },
    bandcamp: { bandcampUrl: 'https://example.bandcamp.com/track/white-roses' }
  },
  addedAt: 1794689768232,
  syncSources: { manual: { addedAt: 1794689768232 } }
});

const spotifyWhiteRoses = () => remoteTrack({
  id: 'mondo-cozmo-white-roses-white-roses',
  artist: 'Mondo Cozmo, Jim James',
  title: 'White Roses',
  album: 'White Roses',
  spotifyId: SPOTIFY_ID
});

describe('library sync: an incoming track matches the row that already holds it', () => {
  test('a heart on a multi-artist track, then sync, leaves one row (the heart\'s)', async () => {
    const result = await sync([spotifyWhiteRoses()], [heartRow()]);

    expect(result.data).toHaveLength(1);
    const row = result.data[0];
    expect(row.id).toBe('mondo-cozmo-jim-james-white-roses-white-roses');
    expect(Object.keys(row.syncSources).sort()).toEqual(['manual', 'spotify']);
    // The heart's own sources survive (bandcamp), the local Spotify record wins.
    expect(row.sources.bandcamp).toBeDefined();
    expect(row.sources.spotify.spotifyId).toBe(SPOTIFY_ID);
    expect(result.stats.added).toBe(0);
  });

  test('the matched row gets the remote externalId, so the next incremental check matches', async () => {
    const result = await sync([spotifyWhiteRoses()], [heartRow()]);
    expect(result.data[0].externalId).toBe(SPOTIFY_ID);
  });

  test('a row matched by Spotify id is not removed on the next sync', async () => {
    const first = await sync([spotifyWhiteRoses()], [heartRow()]);
    const second = await sync([spotifyWhiteRoses()], first.data);

    expect(second.data).toHaveLength(1);
    expect(second.data[0].id).toBe('mondo-cozmo-jim-james-white-roses-white-roses');
    expect(second.stats.removed).toBe(0);
    expect(second.stats.added).toBe(0);
    expect(second.data[0].syncSources.spotify).toBeDefined();
  });

  test('a matched row that leaves Liked Songs loses only the Spotify sync source', async () => {
    const first = await sync([spotifyWhiteRoses()], [heartRow()]);
    const second = await sync([], first.data);

    expect(second.data).toHaveLength(1);
    expect(second.data[0].syncSources.spotify).toBeUndefined();
    expect(second.data[0].syncSources.manual).toBeDefined();
  });

  test('an existing pair from before the fix heals into the heart row', async () => {
    // What the user's collection holds today: the heart row plus the row an
    // earlier sync added under the first-artist id.
    const synced = {
      ...spotifyWhiteRoses(),
      syncSources: { spotify: { addedAt: 1794689768000, syncedAt: 1794690013903 } }
    };
    const result = await sync([spotifyWhiteRoses()], [heartRow(), synced]);

    expect(result.data).toHaveLength(1);
    const row = result.data[0];
    expect(row.id).toBe('mondo-cozmo-jim-james-white-roses-white-roses');
    expect(Object.keys(row.syncSources).sort()).toEqual(['manual', 'spotify']);
    expect(row.externalId).toBe(SPOTIFY_ID);
    // A merge, not a removal: no tombstone path, not counted as removed.
    expect(result.stats.removed).toBe(0);
    expect(result.stats.merged).toBe(1);

    const again = await sync([spotifyWhiteRoses()], result.data);
    expect(again.data).toHaveLength(1);
    expect(again.data[0].id).toBe('mondo-cozmo-jim-james-white-roses-white-roses');
    expect(again.stats.merged).toBe(0);
  });

  test('a row saved without an album matches a synced copy with its album (#1397)', async () => {
    const loved = {
      id: 'radiohead-creep-noalbum',
      title: 'Creep',
      artist: 'Radiohead',
      album: '',
      sources: {},
      addedAt: 1000,
      syncSources: { manual: { addedAt: 1000 } }
    };
    const remote = remoteTrack({ id: 'radiohead-creep-pablo-honey', artist: 'Radiohead', title: 'Creep', album: 'Pablo Honey', spotifyId: '70LcF31zb1H0PyJoS1Sx1r' });
    const result = await sync([remote], [loved]);

    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe('radiohead-creep-noalbum');
    // The album stays a placeholder: findSavedTrack's placeholder tier keeps
    // matching hearts on this row only while it is one.
    expect(result.data[0].album).toBe('');
    expect(result.data[0].syncSources.spotify).toBeDefined();
    expect(result.data[0].sources.spotify.spotifyId).toBe('70LcF31zb1H0PyJoS1Sx1r');
  });

  test('a synced copy with no album matches a saved row with its album (#1397, the other order)', async () => {
    const saved = {
      id: 'radiohead-creep-pablo-honey',
      title: 'Creep',
      artist: 'Radiohead',
      album: 'Pablo Honey',
      sources: {},
      addedAt: 1000,
      syncSources: { manual: { addedAt: 1000 } }
    };
    const remote = { ...remoteTrack({ id: 'radiohead-creep-noalbum', artist: 'Radiohead', title: 'Creep', album: '', spotifyId: 'x1' }) };
    const result = await sync([remote], [saved]);

    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe('radiohead-creep-pablo-honey');
    expect(result.data[0].album).toBe('Pablo Honey');
  });

  test('two real editions stay two rows, even when both resolved to one Spotify track', async () => {
    const bestOf = {
      id: 'radiohead-creep-the-best-of',
      title: 'Creep',
      artist: 'Radiohead',
      album: 'The Best Of',
      sources: { spotify: { spotifyId: '70LcF31zb1H0PyJoS1Sx1r' } },
      addedAt: 1000,
      syncSources: { manual: { addedAt: 1000 } }
    };
    const remote = remoteTrack({ id: 'radiohead-creep-pablo-honey', artist: 'Radiohead', title: 'Creep', album: 'Pablo Honey', spotifyId: '70LcF31zb1H0PyJoS1Sx1r' });
    const result = await sync([remote], [bestOf]);

    expect(result.data.map((t) => t.id).sort()).toEqual(['radiohead-creep-pablo-honey', 'radiohead-creep-the-best-of']);
    expect(result.data.find((t) => t.id === 'radiohead-creep-the-best-of').syncSources.spotify).toBeUndefined();
  });

  test('a row matched by id is never taken by another track\'s fallback match', async () => {
    // The no-album row could match the first remote by name, but the second
    // remote carries its exact id: the id match wins, and the first is added.
    const loved = {
      id: 'radiohead-creep-noalbum', title: 'Creep', artist: 'Radiohead', album: '',
      sources: {}, addedAt: 1000, syncSources: { manual: { addedAt: 1000 } }
    };
    const withAlbum = remoteTrack({ id: 'radiohead-creep-pablo-honey', artist: 'Radiohead', title: 'Creep', album: 'Pablo Honey', spotifyId: 'a1' });
    const exact = { ...remoteTrack({ id: 'radiohead-creep-noalbum', artist: 'Radiohead', title: 'Creep', album: '', spotifyId: 'a2' }) };
    const result = await sync([withAlbum, exact], [loved]);

    expect(result.data.map((t) => t.id).sort()).toEqual(['radiohead-creep-noalbum', 'radiohead-creep-pablo-honey']);
  });

  test('albums still match by id only', async () => {
    const localAlbum = { id: 'radiohead-pablo-honey', title: 'Pablo Honey', artist: 'Radiohead', album: '', syncSources: { manual: {} } };
    const remoteAlbum = { id: 'radiohead-pablo-honey-deluxe', title: 'Pablo Honey', artist: 'Radiohead', album: '' };
    const result = await sync([remoteAlbum], [localAlbum], 'albums');
    expect(result.data).toHaveLength(2);
  });

  test('a row whose album was never known matches a synced copy reported as "Unknown Album"', async () => {
    // Both providers fall back to "Unknown Album" when a track has none.
    const saved = {
      id: 'radiohead-creep-pablo-honey', title: 'Creep', artist: 'Radiohead', album: 'Pablo Honey',
      sources: {}, addedAt: 1000, syncSources: { manual: { addedAt: 1000 } }
    };
    const remote = remoteTrack({ id: 'radiohead-creep-unknown-album', artist: 'Radiohead', title: 'Creep', album: 'Unknown Album', spotifyId: 'u1' });
    const result = await sync([remote], [saved]);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe('radiohead-creep-pablo-honey');
  });
});

describe('library sync with Apple Music: the same rules hold with its naming', () => {
  const CATALOG_ID = '1440857781';
  const amProvider = (remote) => ({
    id: 'applemusic',
    nativeIdOf: (t) => AppleMusicProvider.nativeIdOf(t),
    fetchTracks: jest.fn(async () => remote),
    fetchAlbums: jest.fn(async () => remote),
    fetchArtists: jest.fn(async () => remote)
  });
  const amSync = (remote, local) =>
    syncDataType(amProvider(remote), 'token', 'tracks', local, () => {}, null);

  // What sync-providers/applemusic.js transformTrack produces: Apple Music
  // writes "A & B" where Spotify writes "A, B", and suffixes singles and EPs.
  const amWhiteRoses = () => ({
    id: 'mondo-cozmo-jim-james-white-roses-white-roses-single',
    externalId: 'i.abc123',
    title: 'White Roses',
    artist: 'Mondo Cozmo & Jim James',
    album: 'White Roses - Single',
    duration: 259,
    addedAt: 1794689768000,
    appleMusicId: CATALOG_ID,
    sources: { applemusic: { id: `applemusic-${CATALOG_ID}`, title: 'White Roses', artist: 'Mondo Cozmo & Jim James', album: 'White Roses - Single', appleMusicId: CATALOG_ID, confidence: 1 } }
  });
  const amHeartRow = () => ({
    id: 'mondo-cozmo-jim-james-white-roses-white-roses',
    title: 'White Roses',
    artist: 'Mondo Cozmo, Jim James',
    album: 'White Roses',
    sources: { applemusic: { appleMusicId: CATALOG_ID } },
    addedAt: 1794689768232,
    syncSources: { manual: { addedAt: 1794689768232 } }
  });

  test('a heart, then an Apple Music sync that names the album "X - Single", leaves one row', async () => {
    const result = await amSync([amWhiteRoses()], [amHeartRow()]);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe('mondo-cozmo-jim-james-white-roses-white-roses');
    expect(result.data[0].syncSources.applemusic).toBeDefined();
    expect(result.data[0].externalId).toBe('i.abc123');
  });

  test('an existing pair heals although Apple Music writes the artists with "&"', async () => {
    const synced = { ...amWhiteRoses(), syncSources: { applemusic: { addedAt: 1794689768000, syncedAt: 1794690013903 } } };
    const result = await amSync([amWhiteRoses()], [amHeartRow(), synced]);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe('mondo-cozmo-jim-james-white-roses-white-roses');
    expect(result.stats.merged).toBe(1);
  });

  test('a deluxe edition is still a different album', async () => {
    const saved = {
      id: 'x-song-live-forever', title: 'Song', artist: 'X', album: 'Live Forever',
      sources: { applemusic: { appleMusicId: '42' } }, addedAt: 1, syncSources: { manual: { addedAt: 1 } }
    };
    const remote = {
      id: 'x-song-live-forever-deluxe-edition', externalId: 'i.42', title: 'Song', artist: 'X',
      album: 'Live Forever (Deluxe Edition)', addedAt: 2, appleMusicId: '42',
      sources: { applemusic: { appleMusicId: '42' } }
    };
    const result = await amSync([remote], [saved]);
    expect(result.data).toHaveLength(2);
  });
});
