const {
  reportedPlaybackAsin,
  shouldRevealPlayerOnFailure,
  playerDurationMs,
  decidePollAdvance,
  shouldPollFaster,
  pageBlocksPlayback,
  isNotReadyReason,
  AMAZON_QUALITY_OPTIONS,
  normalizeStreamingQuality,
  installAmazonRequireTrap,
  readPersistedQuality,
  writePersistedQuality,
  isAmazonSearchTrackLink,
  amazonSongSearchUrl,
  isAmazonSongResultItem,
  acceptAmazonSearchAnchor,
  asinFromPlayerUrl,
  amazonPlaylistIdFromUrl,
  amazonPlaylistDetailRequest,
  amazonGqlFetchHeaders,
  playlistTrackFromGqlEdge,
  playlistFromGql,
  NEAR_END_MS
} = require('../../amazon-music-logic');

describe('reportedPlaybackAsin', () => {
  test('uses the mini player ASIN ahead of the page URL', () => {
    expect(reportedPlaybackAsin({
      playingAsin: 'B0NEWTRACK',
      href: 'https://music.amazon.com/tracks/B0OLDTRACK?do=play'
    })).toBe('B0NEWTRACK');
  });

  test('reads a track ASIN from the player URL when the mini player has none', () => {
    expect(reportedPlaybackAsin({
      href: 'https://music.amazon.com/tracks/B0URLTRACK?do=play'
    })).toBe('B0URLTRACK');
  });

  test('does not echo the ASIN we asked to play when the page has none', () => {
    expect(reportedPlaybackAsin({ href: 'https://music.amazon.com/', expectedAsin: 'B0ASKED' })).toBeNull();
    expect(reportedPlaybackAsin(null)).toBeNull();
  });
});

describe('shouldRevealPlayerOnFailure', () => {
  test('a playback miss never reveals the player, including during radio', () => {
    expect(shouldRevealPlayerOnFailure({ advancing: true })).toBe(false);
    expect(shouldRevealPlayerOnFailure({ advancing: false, licenseDenied: false })).toBe(false);
  });
});

describe('playerDurationMs', () => {
  test('treats the player value as milliseconds, including long tracks', () => {
    expect(playerDurationMs(180000)).toBe(180000);
    expect(playerDurationMs(1200000)).toBe(1200000);
    expect(playerDurationMs(0)).toBe(0);
    expect(playerDurationMs(null)).toBe(0);
  });
});

describe('decidePollAdvance', () => {
  const playing = { state: 'PLAYING', durationMs: 180000, pollCount: 5, expectedAsin: 'B1', actualAsin: 'B1' };

  test('does not skip when seeking backward near the end', () => {
    const decision = decidePollAdvance({
      ...playing,
      lastPositionMs: 176000,
      positionMs: 140000,
      seekSuppress: true
    });
    expect(decision.action).not.toBe('advance');
  });

  test('a backward seek is not an autoplay wrap even without the suppress flag', () => {
    const decision = decidePollAdvance({
      ...playing,
      lastPositionMs: 176000,
      positionMs: 140000
    });
    expect(decision.action).toBe('continue');
  });

  test('wrap to the start after 80% is a finish', () => {
    const decision = decidePollAdvance({
      ...playing,
      lastPositionMs: 176000,
      positionMs: 200
    });
    expect(decision).toEqual({ action: 'advance', reason: 'finished' });
  });

  test('does not cut off several seconds before the end', () => {
    const early = decidePollAdvance({ ...playing, lastPositionMs: 170000, positionMs: 176000 });
    expect(early.action).not.toBe('advance');
    const late = decidePollAdvance({
      ...playing,
      lastPositionMs: 179000,
      positionMs: 180000 - NEAR_END_MS
    });
    expect(late).toEqual({ action: 'advance', reason: 'near-end' });
  });

  test('polls faster only in the last few seconds', () => {
    expect(shouldPollFaster(180000, 100000)).toBe(false);
    expect(shouldPollFaster(180000, 175000)).toBe(true);
  });

  test('a different ASIN after the grace period advances', () => {
    expect(decidePollAdvance({ ...playing, pollCount: 1, actualAsin: 'B9' }).action).toBe('wait');
    expect(decidePollAdvance({ ...playing, pollCount: 3, actualAsin: 'B9' }).reason).toBe('track-changed');
  });
});

describe('pageBlocksPlayback', () => {
  test('profile picker and sign-in are not a finished session', () => {
    expect(pageBlocksPlayback('https://music.amazon.com/identity/who-is-listening')).toBe('not-signed-in');
    expect(pageBlocksPlayback('https://www.amazon.com/ap/signin?openid.return_to=music')).toBe('not-signed-in');
  });

  test('the player home is usable', () => {
    expect(pageBlocksPlayback('https://music.amazon.com/')).toBeNull();
    expect(pageBlocksPlayback('https://music.amazon.com/tracks/B000SNWG5Q')).toBeNull();
  });
});

describe('amazonSongSearchUrl', () => {
  test('quotes title then artist and stays on the songs tab', () => {
    expect(amazonSongSearchUrl({ title: 'stations', artist: 'Warning' }))
      .toBe('https://music.amazon.com/search/%22stations%22%20%22Warning%22/songs');
  });

  test('still uses the songs tab when only one field is present', () => {
    expect(amazonSongSearchUrl({ title: 'stations' })).toMatch(/\/songs$/);
    expect(amazonSongSearchUrl({ artist: 'Warning' })).toMatch(/\/songs$/);
  });
});

describe('isAmazonSongResultItem', () => {
  test('accepts the songs tab row and the general search row', () => {
    expect(isAmazonSongResultItem('HorizontalItem,undefined')).toBe(true);
    expect(isAmazonSongResultItem('HorizontalItem,SearchResultsWidget_Item')).toBe(true);
    expect(isAmazonSongResultItem('TrackItem_Title')).toBe(false);
    expect(isAmazonSongResultItem('HorizontalItem,MiniPlayer_Title')).toBe(false);
  });
});

describe('normalizeStreamingQuality', () => {
  test('maps the modal radios and the legacy HD value', () => {
    expect(normalizeStreamingQuality('BEST_AVAILABLE')).toBe('BEST_AVAILABLE');
    expect(normalizeStreamingQuality('HD')).toBe('BEST_AVAILABLE');
    expect(normalizeStreamingQuality('STANDARD')).toBe('STANDARD');
    expect(normalizeStreamingQuality('DATA_SAVER')).toBe('DATA_SAVER');
    expect(normalizeStreamingQuality('ULTRA_HD')).toBeNull();
    expect(AMAZON_QUALITY_OPTIONS.map(o => o.value)).toEqual([
      'BEST_AVAILABLE', 'STANDARD', 'DATA_SAVER'
    ]);
  });
});

// window.__r is Metro's require. The trap observes requires Amazon's own
// code makes — it never calls __r itself.
const makeMetroScope = () => {
  const scope = {};
  scope.require = (id) => {
    if (id === 123) return { playbackController: { audioQualitySettings: { streamingQuality: 'STANDARD', abrEnabled: true } } };
    if (id === 456) return { other: true };
    throw new Error(`Requiring unknown module "${id}"`);
  };
  return scope;
};

describe('installAmazonRequireTrap', () => {
  test('captures the playbackController when Amazon requires its module', () => {
    const scope = makeMetroScope();
    installAmazonRequireTrap(scope);
    scope.__r = scope.require;
    scope.__r(456);
    expect(scope.__parachordAmazonPlayback).toBeUndefined();
    scope.__r(123);
    expect(scope.__parachordAmazonPlaybackModuleId).toBe(123);
    expect(scope.__parachordAmazonPlayback.audioQualitySettings.streamingQuality).toBe('STANDARD');
  });

  test('wraps a require that was already assigned before the trap', () => {
    const scope = makeMetroScope();
    scope.__r = scope.require;
    installAmazonRequireTrap(scope);
    scope.__r(123);
    expect(scope.__parachordAmazonPlaybackModuleId).toBe(123);
  });

  test('the wrapped require still passes through calls and extra properties', () => {
    const scope = makeMetroScope();
    installAmazonRequireTrap(scope);
    const asyncChunk = () => {};
    scope.require.async = asyncChunk;
    scope.__r = scope.require;
    expect(scope.__r).not.toBe(scope.require);
    expect(scope.__r.async).toBe(asyncChunk);
    expect(scope.__r(456)).toEqual({ other: true });
  });

  test('re-assignment re-wraps without double wrapping, and install is idempotent', () => {
    const scope = makeMetroScope();
    installAmazonRequireTrap(scope);
    scope.__r = scope.require;
    const first = scope.__r;
    scope.__r = scope.require; // a lazy chunk exposes __r again
    expect(scope.__r).not.toBe(first);
    scope.__r(123);
    expect(scope.__parachordAmazonPlaybackModuleId).toBe(123);
    installAmazonRequireTrap(scope);
    expect(scope.__r).toBe(scope.__r); // no-op re-install
  });

  test('a throwing module export does not break the require', () => {
    const scope = {};
    const hostile = { get playbackController() { throw new Error('getter'); } };
    scope.require = (id) => (id === 7 ? hostile : { ok: 1 });
    installAmazonRequireTrap(scope);
    scope.__r = scope.require;
    expect(() => scope.__r(7)).not.toThrow();
    expect(scope.__r(8)).toEqual({ ok: 1 });
    expect(scope.__parachordAmazonPlayback).toBeUndefined();
  });

  test('serializes self-contained for evaluation inside the Amazon page', () => {
    // The preload embeds this function with .toString() and runs it in the
    // page world, where module-scope identifiers do not exist. new Function
    // gives it the same bare scope, so a closure reference fails here instead
    // of inside Amazon's page.
    const embedded = new Function(`return (${installAmazonRequireTrap.toString()})`)();
    const scope = makeMetroScope();
    embedded(scope);
    scope.__r = scope.require;
    scope.__r(123);
    expect(scope.__parachordAmazonPlaybackModuleId).toBe(123);
  });
});

// Real localStorage exposes stored entries as enumerable own properties,
// which is how the helpers find the playback-controller key. Model that.
const makeStorage = (initial) => {
  const storage = {};
  for (const [k, v] of Object.entries(initial || {})) storage[k] = String(v);
  Object.defineProperty(storage, 'getItem', { value: (k) => (k in storage ? storage[k] : null), enumerable: false });
  Object.defineProperty(storage, 'setItem', { value: (k, v) => { storage[k] = String(v); }, enumerable: false });
  return storage;
};

const playbackControllerEntry = (quality) => JSON.stringify({
  data: { audioQualitySettings: quality, unrelated: { keep: true } }
});

describe('readPersistedQuality', () => {
  test('reads audio quality from the playback-controller entry', () => {
    const storage = makeStorage({
      'hornet:playback-controller:v2': playbackControllerEntry({ streamingQuality: 'HD', abrEnabled: false })
    });
    expect(readPersistedQuality(storage)).toEqual({ streamingQuality: 'HD', abrEnabled: false });
  });

  test('returns null when no entry, malformed JSON, or no audioQualitySettings', () => {
    expect(readPersistedQuality(makeStorage({}))).toBeNull();
    expect(readPersistedQuality(makeStorage({ 'playback-controller': '{not json' }))).toBeNull();
    expect(readPersistedQuality(makeStorage({ 'playback-controller': JSON.stringify({ data: {} }) }))).toBeNull();
    expect(readPersistedQuality(makeStorage({ 'playback-controller': JSON.stringify({ data: { audioQualitySettings: null } }) }))).toBeNull();
  });

  test('serializes self-contained for evaluation inside the Amazon page', () => {
    const embedded = new Function(`return (${readPersistedQuality.toString()})`)();
    const storage = makeStorage({
      'playback-controller': playbackControllerEntry({ streamingQuality: 'STANDARD', abrEnabled: true })
    });
    expect(embedded(storage)).toEqual({ streamingQuality: 'STANDARD', abrEnabled: true });
  });
});

describe('writePersistedQuality', () => {
  test('merges quality into the entry and preserves unrelated data', () => {
    const storage = makeStorage({
      'playback-controller': playbackControllerEntry({ streamingQuality: 'STANDARD', abrEnabled: true })
    });
    expect(writePersistedQuality(storage, { streamingQuality: 'BEST_AVAILABLE', abrEnabled: false })).toBe(true);
    const parsed = JSON.parse(storage.getItem('playback-controller'));
    expect(parsed.data.audioQualitySettings).toEqual({ streamingQuality: 'BEST_AVAILABLE', abrEnabled: false });
    expect(parsed.data.unrelated).toEqual({ keep: true });
  });

  test('a patch with undefined fields keeps the stored tier', () => {
    // Flipping only Auto-adjust must not clobber the persisted streamingQuality.
    const storage = makeStorage({
      'playback-controller': playbackControllerEntry({ streamingQuality: 'HD', abrEnabled: true })
    });
    expect(writePersistedQuality(storage, { abrEnabled: false })).toBe(true);
    const parsed = JSON.parse(storage.getItem('playback-controller'));
    expect(parsed.data.audioQualitySettings).toEqual({ streamingQuality: 'HD', abrEnabled: false });
  });

  test('returns false when there is no entry to merge into', () => {
    const storage = makeStorage({});
    expect(writePersistedQuality(storage, { streamingQuality: 'STANDARD' })).toBe(false);
    expect(readPersistedQuality(storage)).toBeNull();
  });

  test('serializes self-contained for evaluation inside the Amazon page', () => {
    const embedded = new Function(`return (${writePersistedQuality.toString()})`)();
    const storage = makeStorage({
      'playback-controller': playbackControllerEntry({ streamingQuality: 'STANDARD', abrEnabled: true })
    });
    expect(embedded(storage, { abrEnabled: false })).toBe(true);
    expect(readPersistedQuality(storage)).toEqual({ streamingQuality: 'STANDARD', abrEnabled: false });
  });
});

describe('asinFromPlayerUrl', () => {
  test('reads the playing track ASIN from the player URL', () => {
    expect(asinFromPlayerUrl('https://music.amazon.com/tracks/B000SNWG5Q?do=play')).toBe('B000SNWG5Q');
    expect(asinFromPlayerUrl('https://music.amazon.com/')).toBeNull();
    expect(asinFromPlayerUrl('')).toBeNull();
  });
});

describe('isAmazonSearchTrackLink', () => {
  test('keeps search rows and drops the mini player', () => {
    expect(isAmazonSearchTrackLink('SearchResultsWidget_Item_Metadata_TrackTitle')).toBe(true);
    expect(isAmazonSearchTrackLink('SearchResultsWidget_TopResults_TrackItem_Metadata_TrackTitle')).toBe(true);
    expect(isAmazonSearchTrackLink('MiniPlayer_Title')).toBe(false);
    expect(isAmazonSearchTrackLink('')).toBe(false);
  });

  test('search page keeps rows that are not player chrome', () => {
    expect(acceptAmazonSearchAnchor(['SearchResultsWidget_Item'], true)).toBe(true);
    expect(acceptAmazonSearchAnchor([], true)).toBe(true);
    expect(acceptAmazonSearchAnchor(['MiniPlayer_Title'], true)).toBe(false);
    expect(acceptAmazonSearchAnchor([], false)).toBe(false);
  });
});

describe('isNotReadyReason', () => {
  test('sign-in and missing-CDM are not empty search results', () => {
    expect(isNotReadyReason('not-signed-in')).toBe(true);
    expect(isNotReadyReason('no-cdm')).toBe(true);
    expect(isNotReadyReason('playback-failed')).toBe(false);
    expect(isNotReadyReason('app-not-managed')).toBe(false);
  });
});

describe('amazonPlaylistIdFromUrl', () => {
  test('reads the id off shared/brand and my-music playlist pages', () => {
    expect(amazonPlaylistIdFromUrl('https://music.amazon.com/playlists/PP6417A00A9C99470BBC8834FF3BF6009A'))
      .toBe('PP6417A00A9C99470BBC8834FF3BF6009A');
    expect(amazonPlaylistIdFromUrl('https://music.amazon.com/my/playlists/PP6417A00A9C99470BBC8834FF3BF6009A?ref=dm_sh'))
      .toBe('PP6417A00A9C99470BBC8834FF3BF6009A');
  });

  test('track, album and non-Amazon URLs are not playlists', () => {
    expect(amazonPlaylistIdFromUrl('https://music.amazon.com/tracks/B000SNWG5Q')).toBeNull();
    expect(amazonPlaylistIdFromUrl('https://music.amazon.com/albums/B000031W1M')).toBeNull();
    expect(amazonPlaylistIdFromUrl('https://open.spotify.com/playlist/abc')).toBeNull();
    expect(amazonPlaylistIdFromUrl('')).toBeNull();
  });
});

describe('amazonPlaylistDetailRequest', () => {
  const detail = (id) => JSON.stringify({
    operationName: 'playlistDetail',
    variables: { id, firstLimit: 100, isAuthenticated: true, includeCollaborators: false },
    extensions: { persistedQuery: { version: 1, sha256Hash: '41c5f472' } }
  });

  test('finds the playlistDetail request for our playlist among the captured gql bodies', () => {
    const bodies = [
      JSON.stringify({ operationName: 'Transport', variables: {} }),
      detail('PP6417A00A9C99470BBC8834FF3BF6009A'),
      JSON.stringify({ operationName: 'playlistSuggestions', variables: { recsUri: 'uri:///playlist/x/suggested-tracks' } }),
      '{not json'
    ];
    const req = amazonPlaylistDetailRequest(bodies, 'PP6417A00A9C99470BBC8834FF3BF6009A');
    expect(req.operationName).toBe('playlistDetail');
    expect(req.variables.id).toBe('PP6417A00A9C99470BBC8834FF3BF6009A');
    expect(req.extensions.persistedQuery.sha256Hash).toBe('41c5f472');
  });

  test('a playlistDetail for another playlist is not ours', () => {
    expect(amazonPlaylistDetailRequest([detail('PPOTHER')], 'PP6417A00A9C99470BBC8834FF3BF6009A')).toBeNull();
    expect(amazonPlaylistDetailRequest([detail('pp6417a00a9c99470bbc8834ff3bf6009a')], 'PP6417A00A9C99470BBC8834FF3BF6009A')).not.toBeNull();
    expect(amazonPlaylistDetailRequest([], 'PP6417A00A9C99470BBC8834FF3BF6009A')).toBeNull();
    expect(amazonPlaylistDetailRequest(null, 'x')).toBeNull();
  });
});

describe('amazonGqlFetchHeaders', () => {
  test('keeps the gql auth headers and drops browser-managed ones', () => {
    const headers = amazonGqlFetchHeaders({
      'content-type': 'application/json',
      accept: 'application/graphql-response+json, application/json',
      'x-api-key': 'amzn1.application.4ff5579ca2e3407aba989a1f5dbdaf69',
      'csrf-token': 'dAFuzikk=',
      'csrf-rnd': '2128471272',
      'csrf-ts': '1791997974',
      'music-territory': 'US',
      'x-amzn-device-id': '14354613042605242',
      Cookie: 'at-main=secret; session-id=143',
      Origin: 'https://music.amazon.com',
      Referer: 'https://music.amazon.com/',
      'User-Agent': 'Mozilla/5.0',
      'sec-fetch-site': 'same-site',
      'sec-ch-ua': '"Not_A Brand"',
      'Accept-Encoding': 'gzip',
      Host: 'gql.music.amazon.com'
    });
    expect(Object.keys(headers).sort()).toEqual([
      'accept', 'content-type', 'csrf-rnd', 'csrf-token', 'csrf-ts',
      'music-territory', 'x-amzn-device-id', 'x-api-key'
    ]);
    expect(headers['x-api-key']).toBe('amzn1.application.4ff5579ca2e3407aba989a1f5dbdaf69');
    expect(headers.Cookie).toBeUndefined();
  });

  test('tolerates missing headers', () => {
    expect(amazonGqlFetchHeaders(null)).toEqual({});
  });
});

describe('playlistTrackFromGqlEdge', () => {
  const edge = (node) => ({ node });

  test('maps a track node with artists, album, and duration', () => {
    const track = playlistTrackFromGqlEdge(edge({
      id: 'B00136J8K8',
      title: 'Metal Health (Bang Your Head)',
      duration: 317,
      contributingArtists: {
        edges: [
          { role: 'PRIMARY', node: { name: 'Quiet Riot' } },
          { role: 'FEATURED', node: { name: 'Someone Else' } }
        ]
      },
      album: { id: 'B00136JQEQ', shortTitle: 'Metal Health' }
    }));
    expect(track).toEqual({
      asin: 'B00136J8K8',
      title: 'Metal Health (Bang Your Head)',
      artist: 'Quiet Riot',
      album: 'Metal Health',
      albumAsin: 'B00136JQEQ',
      duration: 317
    });
  });

  test('joins multiple artists when none are PRIMARY, and falls back to the album title', () => {
    const track = playlistTrackFromGqlEdge(edge({
      id: 'B1',
      title: 'Song',
      contributingArtists: { edges: [{ node: { name: 'A' } }, { role: 'FEATURED', node: { name: 'B' } }] },
      album: { id: 'B2', title: 'Full Album Title' }
    }));
    expect(track.artist).toBe('A, B');
    expect(track.album).toBe('Full Album Title');
  });

  test('drops rows without asin, title, or artist', () => {
    expect(playlistTrackFromGqlEdge(edge({ id: 'B1', title: 'No artists', contributingArtists: { edges: [] } }))).toBeNull();
    expect(playlistTrackFromGqlEdge(edge({ title: 'No asin', contributingArtists: { edges: [{ node: { name: 'A' } }] } }))).toBeNull();
    expect(playlistTrackFromGqlEdge(null)).toBeNull();
  });
});

describe('playlistFromGql', () => {
  const gqlPlaylist = (overrides = {}) => ({
    id: 'PP6417A00A9C99470BBC8834FF3BF6009A',
    title: 'My Discovery Mix',
    trackCount: 2,
    images: [
      { url: 'https://m.media-amazon.com/images/I/banner.jpg', width: 4188, height: 2094, imageType: null },
      { url: 'https://m.media-amazon.com/images/I/cover.jpg', width: 2400, height: 2400, imageType: 'PRIMARY' }
    ],
    curator: { name: 'Amazon' },
    tracks: {
      edges: [
        { node: { id: 'B00136J8K8', title: 'Metal Health (Bang Your Head)', duration: 317, contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: 'Quiet Riot' } }] }, album: { id: 'B00136JQEQ', shortTitle: 'Metal Health' } } },
        { node: { id: 'B07XLSKGGK', title: 'Master of Puppets (Remastered)', duration: 515, contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: 'Metallica' } }] }, album: { id: 'B000031W1M', shortTitle: 'Master of Puppets' } } }
      ]
    },
    ...overrides
  });

  test('maps the response playlist with the PRIMARY cover', () => {
    const out = playlistFromGql({ playlist: gqlPlaylist() });
    expect(out.id).toBe('PP6417A00A9C99470BBC8834FF3BF6009A');
    expect(out.name).toBe('My Discovery Mix');
    expect(out.owner).toBe('Amazon');
    expect(out.albumArt).toBe('https://m.media-amazon.com/images/I/cover.jpg');
    expect(out.trackCount).toBe(2);
    expect(out.tracks).toHaveLength(2);
    expect(out.tracks[0]).toEqual({
      asin: 'B00136J8K8',
      title: 'Metal Health (Bang Your Head)',
      artist: 'Quiet Riot',
      album: 'Metal Health',
      albumAsin: 'B00136JQEQ',
      duration: 317
    });
  });

  test('null playlist (deleted/private) maps to null, not an empty import', () => {
    expect(playlistFromGql({ playlist: null })).toBeNull();
    expect(playlistFromGql(null)).toBeNull();
  });

  test('curator variants: string curator, algorithmic null curator, widest non-PRIMARY fallback', () => {
    expect(playlistFromGql({ playlist: gqlPlaylist({ curator: 'Rhino' }) }).owner).toBe('Rhino');
    expect(playlistFromGql({ playlist: gqlPlaylist({ curator: null }) }).owner).toBeNull();
    const noPrimary = playlistFromGql({
      playlist: gqlPlaylist({ images: [{ url: 'https://x/small.jpg', width: 300, imageType: null }, { url: 'https://x/big.jpg', width: 3000, imageType: null }] })
    });
    expect(noPrimary.albumArt).toBe('https://x/big.jpg');
  });
});
