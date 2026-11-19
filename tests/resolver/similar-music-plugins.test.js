/**
 * The similarArtists / similarTracks capabilities (#1539): Last.fm's
 * artist.getsimilar and track.getsimilar, and ListenBrainz's similar-artists
 * data, moved out of app.js and spinoff-pool.js into the plug-ins. Loads the
 * built plug-ins (plugins/*.axe, from scripts/build-axes.js) the way the app
 * materializes them: new Function.
 */
const fs = require('fs');
const path = require('path');

const load = (id) => {
  const axe = JSON.parse(fs.readFileSync(path.join(__dirname, `../../plugins/${id}.axe`), 'utf8'));
  const fns = {};
  for (const name of ['getSimilarArtists', 'getSimilarTracks', 'getArtistTopTracks', 'getArtistReleases']) {
    if (axe.implementation[name]) fns[name] = new Function('return ' + axe.implementation[name])();
  }
  return { axe, ...fns };
};

const lastfm = load('lastfm');
const listenbrainz = load('listenbrainz');
const spotify = load('spotify');
const applemusic = load('applemusic');
const discogs = load('discogs');

const KEY = 'secret-key-123';
let calls;
const reply = (body, { ok = true, status = 200 } = {}) => ({ ok, status, json: async () => body });
const mockFetch = (handler) => {
  calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return handler(url, options);
  };
};

afterEach(() => { delete global.fetch; });

describe('manifests', () => {
  test('Last.fm declares both, ListenBrainz similar artists', () => {
    expect(lastfm.axe.capabilities).toMatchObject({ similarArtists: true, similarTracks: true });
    expect(listenbrainz.axe.capabilities.similarArtists).toBe(true);
    expect(listenbrainz.axe.capabilities.similarTracks).toBeUndefined();
    expect(typeof lastfm.getSimilarArtists).toBe('function');
    expect(typeof lastfm.getSimilarTracks).toBe('function');
    expect(typeof listenbrainz.getSimilarArtists).toBe('function');
  });

  test('both declare artistTopTracks (#1539 step 2)', () => {
    expect(lastfm.axe.capabilities.artistTopTracks).toBe(true);
    expect(listenbrainz.axe.capabilities.artistTopTracks).toBe(true);
    expect(typeof lastfm.getArtistTopTracks).toBe('function');
    expect(typeof listenbrainz.getArtistTopTracks).toBe('function');
  });
});

describe('Last.fm getSimilarArtists', () => {
  test('asks artist.getsimilar and answers match as a percentage', async () => {
    mockFetch(() => reply({ similarartists: { artist: [
      { name: 'Muse', match: '0.874', mbid: 'm-1', url: 'https://last.fm/muse' },
      { name: 'Thom Yorke', match: '0.5' },
      { name: '' },
    ] } }));
    const out = await lastfm.getSimilarArtists({ name: 'Radiohead', limit: 8 }, { apiKey: KEY });
    expect(out).toEqual([
      { name: 'Muse', mbid: 'm-1', match: 87, url: 'https://last.fm/muse' },
      { name: 'Thom Yorke', mbid: undefined, match: 50, url: undefined },
    ]);
    const u = new URL(calls[0].url);
    expect(u.host).toBe('ws.audioscrobbler.com');
    expect(u.searchParams.get('method')).toBe('artist.getsimilar');
    expect(u.searchParams.get('artist')).toBe('Radiohead');
    expect(u.searchParams.get('limit')).toBe('8');
    expect(u.searchParams.get('api_key')).toBe(KEY);
  });

  test('a single artist (not an array) is one row', async () => {
    mockFetch(() => reply({ similarartists: { artist: { name: 'Muse', match: '1' } } }));
    expect(await lastfm.getSimilarArtists({ name: 'Radiohead' }, { apiKey: KEY })).toHaveLength(1);
  });

  test('error 6 ("not found") is a miss', async () => {
    mockFetch(() => reply({ error: 6, message: 'The artist you supplied could not be found' }));
    await expect(lastfm.getSimilarArtists({ name: 'Nobody' }, { apiKey: KEY })).resolves.toEqual([]);
  });

  test('a failed request, another error, or no key throws: never an empty answer', async () => {
    mockFetch(() => reply({ error: 29 }, { ok: false, status: 429 }));
    await expect(lastfm.getSimilarArtists({ name: 'Radiohead' }, { apiKey: KEY })).rejects.toThrow('429');
    mockFetch(() => reply({ error: 10, message: 'Invalid API key' }));
    await expect(lastfm.getSimilarArtists({ name: 'Radiohead' }, { apiKey: KEY })).rejects.toThrow('error 10');
    mockFetch(() => reply({}));
    await expect(lastfm.getSimilarArtists({ name: 'Radiohead' }, {})).rejects.toThrow('no API key');
    expect(calls).toHaveLength(0);
  });

  test('the key never appears in an error message', async () => {
    mockFetch(() => reply({ error: 26 }));
    const err = await lastfm.getSimilarArtists({ name: 'Radiohead' }, { apiKey: KEY }).catch((e) => e);
    expect(String(err.message)).not.toContain(KEY);
  });

  test('no name asks nothing', async () => {
    mockFetch(() => reply({}));
    await expect(lastfm.getSimilarArtists({ name: '  ' }, { apiKey: KEY })).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe('Last.fm getSimilarTracks', () => {
  test('asks track.getsimilar and answers { artist, title, match }', async () => {
    mockFetch(() => reply({ similartracks: { track: [
      { name: 'Karma Police', match: '0.9', artist: { name: 'Radiohead' }, mbid: 'r-1' },
      { name: 'Teardrop', match: '0.25', artist: { name: 'Massive Attack' } },
    ] } }));
    const out = await lastfm.getSimilarTracks({ artist: 'Radiohead', title: 'Nude', limit: 1 }, { apiKey: KEY });
    expect(out).toEqual([
      { artist: 'Radiohead', title: 'Karma Police', mbid: 'r-1', match: 90 },
      { artist: 'Massive Attack', title: 'Teardrop', mbid: undefined, match: 25 },
    ]);
    const u = new URL(calls[0].url);
    expect(u.searchParams.get('method')).toBe('track.getsimilar');
    expect(u.searchParams.get('track')).toBe('Nude');
    expect(u.searchParams.get('limit')).toBe('1');
  });

  test('error 6 is a miss; a failure throws', async () => {
    mockFetch(() => reply({ error: 6, message: 'Track not found' }));
    await expect(lastfm.getSimilarTracks({ artist: 'A', title: 'B' }, { apiKey: KEY })).resolves.toEqual([]);
    mockFetch(() => reply(null, { ok: false, status: 500 }));
    await expect(lastfm.getSimilarTracks({ artist: 'A', title: 'B' }, { apiKey: KEY })).rejects.toThrow('500');
  });
});

describe('ListenBrainz getSimilarArtists', () => {
  const RADIOHEAD = 'a74b1b7f-71a5-4011-9441-d0b5e4122711';
  // The shape of a real answer (2026-11-19): raw-count scores, most similar
  // first, and NOT led by the artist itself.
  const answer = [
    { artist_mbid: 'nirvana', name: 'Nirvana', score: 11156, reference_mbid: RADIOHEAD },
    { artist_mbid: 'rhcp', name: 'Red Hot Chili Peppers', score: 10587, reference_mbid: RADIOHEAD },
    { artist_mbid: 'coldplay', name: 'Coldplay', score: 5578, reference_mbid: RADIOHEAD },
  ];

  test('POSTs the MBID and scales each score against the top one', async () => {
    mockFetch(() => reply(answer));
    const out = await listenbrainz.getSimilarArtists({ name: 'Radiohead', mbid: RADIOHEAD }, {});
    expect(out).toEqual([
      { name: 'Nirvana', mbid: 'nirvana', match: 100 },
      { name: 'Red Hot Chili Peppers', mbid: 'rhcp', match: 95 },
      { name: 'Coldplay', mbid: 'coldplay', match: 50 },
    ]);
    expect(calls[0].url).toBe('https://labs.api.listenbrainz.org/similar-artists/json');
    expect(calls[0].options.method).toBe('POST');
    expect(JSON.parse(calls[0].options.body)[0].artist_mbids).toEqual([RADIOHEAD]);
  });

  test('keeps the first row (the closest match), drops a row for the artist itself', async () => {
    mockFetch(() => reply([{ artist_mbid: RADIOHEAD, name: 'Radiohead', score: 99999 }, ...answer]));
    const out = await listenbrainz.getSimilarArtists({ name: 'Radiohead', mbid: RADIOHEAD }, {});
    expect(out.map((a) => a.name)).toEqual(['Nirvana', 'Red Hot Chili Peppers', 'Coldplay']);
    expect(out[0].match).toBe(100);
  });

  test('honours the limit', async () => {
    mockFetch(() => reply(answer));
    const out = await listenbrainz.getSimilarArtists({ name: 'Radiohead', mbid: RADIOHEAD, limit: 1 }, {});
    expect(out.map((a) => a.name)).toEqual(['Nirvana']);
  });

  test('no MBID is a miss with no request', async () => {
    mockFetch(() => reply(answer));
    await expect(listenbrainz.getSimilarArtists({ name: 'Radiohead' }, {})).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });

  test('a failed request or an unexpected answer throws', async () => {
    mockFetch(() => reply(null, { ok: false, status: 503 }));
    await expect(listenbrainz.getSimilarArtists({ name: 'R', mbid: RADIOHEAD }, {})).rejects.toThrow('503');
    mockFetch(() => reply({ error: 'nope' }));
    await expect(listenbrainz.getSimilarArtists({ name: 'R', mbid: RADIOHEAD }, {})).rejects.toThrow('unexpected');
  });
});

describe('Last.fm getArtistTopTracks', () => {
  test('asks artist.gettoptracks and answers most played first', async () => {
    mockFetch(() => reply({ toptracks: { track: [
      { name: 'Creep', playcount: '9000', duration: '238', mbid: 'r-1', artist: { name: 'Radiohead' } },
      { name: 'Karma Police', playcount: '7000', duration: '0', artist: { name: 'Radiohead' } },
      { name: '' },
    ] } }));
    const out = await lastfm.getArtistTopTracks({ name: 'Radiohead', limit: 5 }, { apiKey: KEY });
    expect(out).toEqual([
      { title: 'Creep', artist: 'Radiohead', duration: 238000, mbid: 'r-1', listens: 9000 },
      { title: 'Karma Police', artist: 'Radiohead', duration: undefined, mbid: undefined, listens: 7000 },
    ]);
    const u = new URL(calls[0].url);
    expect(u.searchParams.get('method')).toBe('artist.gettoptracks');
    expect(u.searchParams.get('artist')).toBe('Radiohead');
    expect(u.searchParams.get('limit')).toBe('5');
  });

  test('error 6 is a miss; a failure or no key throws', async () => {
    mockFetch(() => reply({ error: 6, message: 'The artist you supplied could not be found' }));
    await expect(lastfm.getArtistTopTracks({ name: 'Nobody' }, { apiKey: KEY })).resolves.toEqual([]);
    mockFetch(() => reply(null, { ok: false, status: 500 }));
    await expect(lastfm.getArtistTopTracks({ name: 'Radiohead' }, { apiKey: KEY })).rejects.toThrow('500');
    mockFetch(() => reply({}));
    await expect(lastfm.getArtistTopTracks({ name: 'Radiohead' }, {})).rejects.toThrow('no API key');
    expect(calls).toHaveLength(0);
  });
});

describe('ListenBrainz getArtistTopTracks', () => {
  const RADIOHEAD = 'a74b1b7f-71a5-4011-9441-d0b5e4122711';
  const TOKEN = 'lb-token-xyz';
  // The documented answer of /1/popularity/top-recordings-for-artist.
  const answer = [
    { artist_mbids: [RADIOHEAD], artist_name: 'Radiohead', recording_name: 'Creep', recording_mbid: 'rec-1', release_name: 'Pablo Honey', length: 238000, total_listen_count: 900 },
    { artist_mbids: [RADIOHEAD], artist_name: 'Radiohead', recording_name: 'creep', recording_mbid: 'rec-2', release_name: 'Creep (single)', length: 236000, total_listen_count: 300 },
    { artist_mbids: [RADIOHEAD], artist_name: 'Radiohead', recording_name: 'No Surprises', recording_mbid: 'rec-3', release_name: 'OK Computer', length: 0, total_listen_count: 800 },
  ];

  test('asks by MBID with the user’s token; one row per title, most played first', async () => {
    mockFetch(() => reply(answer));
    const out = await listenbrainz.getArtistTopTracks({ name: 'Radiohead', mbid: RADIOHEAD }, { userToken: TOKEN });
    expect(out).toEqual([
      { title: 'Creep', artist: 'Radiohead', album: 'Pablo Honey', duration: 238000, mbid: 'rec-1', listens: 900 },
      { title: 'No Surprises', artist: 'Radiohead', album: 'OK Computer', duration: undefined, mbid: 'rec-3', listens: 800 },
    ]);
    expect(calls[0].url).toBe(`https://api.listenbrainz.org/1/popularity/top-recordings-for-artist/${RADIOHEAD}`);
    expect(calls[0].options.headers.Authorization).toBe(`Token ${TOKEN}`);
  });

  test('honours the limit', async () => {
    mockFetch(() => reply(answer));
    const out = await listenbrainz.getArtistTopTracks({ name: 'Radiohead', mbid: RADIOHEAD, limit: 1 }, { userToken: TOKEN });
    expect(out.map((t) => t.title)).toEqual(['Creep']);
  });

  test('no MBID is a miss with no request', async () => {
    mockFetch(() => reply(answer));
    await expect(listenbrainz.getArtistTopTracks({ name: 'Radiohead' }, { userToken: TOKEN })).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });

  test('signed out, it throws without asking: ListenBrainz refuses anonymous requests', async () => {
    mockFetch(() => reply(answer));
    await expect(listenbrainz.getArtistTopTracks({ name: 'Radiohead', mbid: RADIOHEAD }, {})).rejects.toThrow('signed-in');
    expect(calls).toHaveLength(0);
  });

  test('a failed request or an unexpected answer throws, and never shows the token', async () => {
    mockFetch(() => reply({ code: 401 }, { ok: false, status: 401 }));
    const err = await listenbrainz.getArtistTopTracks({ name: 'R', mbid: RADIOHEAD }, { userToken: TOKEN }).catch((e) => e);
    expect(err.message).toContain('401');
    expect(err.message).not.toContain(TOKEN);
    mockFetch(() => reply({ error: 'nope' }));
    await expect(listenbrainz.getArtistTopTracks({ name: 'R', mbid: RADIOHEAD }, { userToken: TOKEN })).rejects.toThrow('unexpected');
  });
});

describe('artistReleases (#1539 step 2)', () => {
  test('Spotify, Apple Music, Last.fm and Discogs declare it', () => {
    for (const p of [spotify, applemusic, lastfm, discogs]) {
      expect(p.axe.capabilities.artistReleases).toBe(true);
      expect(typeof p.getArtistReleases).toBe('function');
    }
  });

  describe('Spotify', () => {
    const ask = (q, config) => spotify.getArtistReleases.call({}, q, config);
    const headers = { get: () => null };

    test('picks the artist whose name matches, then lists their albums and singles', async () => {
      mockFetch((url) => {
        if (url.includes('/v1/search')) {
          return { ...reply({ artists: { items: [{ id: 'x', name: 'Radiohead Tribute Band' }, { id: 'rh', name: 'Radiohead' }] } }), headers };
        }
        return { ...reply({ items: [
          { id: 'a1', name: 'Kid A', album_group: 'album', release_date: '2000-10-02', images: [{ url: 'art' }] },
          { id: 's1', name: 'Creep', album_type: 'single', release_date: '1992-09-21' },
        ] }), headers };
      });
      const out = await ask({ name: 'Radiohead' }, { token: 't' });
      expect(out).toEqual({ artist: { name: 'Radiohead' }, releases: [
        { id: 'a1', title: 'Kid A', date: '2000-10-02', releaseType: 'album', albumArt: 'art' },
        { id: 's1', title: 'Creep', date: '1992-09-21', releaseType: 'single', albumArt: null },
      ] });
      expect(calls[1].url).toContain('/v1/artists/rh/albums');
      expect(calls[0].options.headers.Authorization).toBe('Bearer t');
    });

    test('signed out or a failed request throws; no artists is a miss', async () => {
      mockFetch(() => ({ ...reply({ artists: { items: [] } }), headers }));
      await expect(ask({ name: 'Radiohead' }, {})).rejects.toThrow('not signed in');
      expect(calls).toHaveLength(0);
      await expect(ask({ name: 'Nobody' }, { token: 't' })).resolves.toBeNull();
      mockFetch(() => ({ ...reply(null, { ok: false, status: 500 }), headers }));
      await expect(ask({ name: 'Radiohead' }, { token: 't' })).rejects.toThrow('500');
    });
  });

  describe('Apple Music', () => {
    afterEach(() => { delete global.window; });

    test('asks the catalog through the host\'s MusicKit', async () => {
      const paths = [];
      global.window = { getMusicKitWeb: () => ({ isConfigured: true, musicKit: { api: { music: async (path) => {
        paths.push(path);
        if (path.endsWith('/search')) return { data: { results: { artists: { data: [{ id: '657515', attributes: { name: 'Radiohead' } }] } } } };
        return { data: { data: [
          { id: '1097861387', attributes: { name: 'OK Computer', releaseDate: '1997-05-21', artwork: { url: 'https://img/{w}x{h}.jpg' } } },
          { id: '2', attributes: { name: 'Creep - Single', isSingle: true } },
        ] } };
      } } } }) };
      const out = await applemusic.getArtistReleases({ name: 'Radiohead' }, { storefront: 'gb' });
      expect(out).toEqual({ artist: { name: 'Radiohead' }, releases: [
        { id: '1097861387', title: 'OK Computer', date: '1997-05-21', releaseType: 'album', albumArt: 'https://img/500x500.jpg' },
        { id: '2', title: 'Creep - Single', date: null, releaseType: 'single', albumArt: null },
      ] });
      expect(paths).toEqual(['/v1/catalog/gb/search', '/v1/catalog/gb/artists/657515/albums']);
    });

    test('MusicKit not ready throws', async () => {
      global.window = { getMusicKitWeb: () => ({ isConfigured: false }) };
      await expect(applemusic.getArtistReleases({ name: 'Radiohead' }, {})).rejects.toThrow('MusicKit not ready');
    });
  });

  describe('Last.fm', () => {
    test('artist.gettopalbums, most played first, ids from the MBID or title', async () => {
      mockFetch(() => reply({ topalbums: { album: [
        { name: 'OK Computer', mbid: 'mb-ok', artist: { name: 'Radiohead', mbid: 'rh' }, image: [{ size: 'extralarge', '#text': 'art' }] },
        { name: 'In Rainbows', artist: { name: 'Radiohead' } },
        { name: '(null)' },
      ] } }));
      const out = await lastfm.getArtistReleases({ name: 'radiohead' }, { apiKey: KEY });
      expect(out).toEqual({ artist: { name: 'Radiohead', mbid: 'rh' }, releases: [
        { id: 'mb-ok', title: 'OK Computer', date: null, releaseType: 'album', albumArt: 'art' },
        { id: 'in-rainbows', title: 'In Rainbows', date: null, releaseType: 'album', albumArt: null },
      ] });
      expect(new URL(calls[0].url).searchParams.get('method')).toBe('artist.gettopalbums');
    });

    test('error 6 or no albums is a miss; a failure throws', async () => {
      mockFetch(() => reply({ error: 6 }));
      await expect(lastfm.getArtistReleases({ name: 'Nobody' }, { apiKey: KEY })).resolves.toBeNull();
      mockFetch(() => reply({ topalbums: { album: [] } }));
      await expect(lastfm.getArtistReleases({ name: 'Nobody' }, { apiKey: KEY })).resolves.toBeNull();
      mockFetch(() => reply(null, { ok: false, status: 503 }));
      await expect(lastfm.getArtistReleases({ name: 'Radiohead' }, { apiKey: KEY })).rejects.toThrow('503');
    });
  });

  describe('Discogs', () => {
    test('the main artist\'s releases, one per title, with the token when set', async () => {
      mockFetch((url) => {
        if (url.includes('/database/search')) return reply({ results: [{ id: 1, title: 'Radiohead Fans' }, { id: 3840, title: 'Radiohead' }] });
        return reply({ releases: [
          { id: 10, title: 'Kid A', year: 2000, role: 'Main', format: 'CD, Album', thumb: 't' },
          { id: 11, title: 'kid a', year: 2000, role: 'Main' },
          { id: 12, title: 'Remixes', role: 'Remix' },
          { id: 13, title: 'Creep', year: 1992, type: 'Single' },
        ] });
      });
      const out = await discogs.getArtistReleases({ name: 'Radiohead' }, { personalAccessToken: 'pat' });
      expect(out).toEqual({ artist: { name: 'Radiohead' }, releases: [
        { id: '10', title: 'Kid A', date: '2000', releaseType: 'album', albumArt: 't' },
        { id: '13', title: 'Creep', date: '1992', releaseType: 'single', albumArt: null },
      ] });
      expect(calls[1].url).toContain('/artists/3840/releases');
      expect(calls[0].options.headers.Authorization).toBe('Discogs token=pat');
    });

    test('a numbered namesake ("Nirvana (2)") still matches; a failure throws', async () => {
      mockFetch((url) => (url.includes('/database/search')
        ? reply({ results: [{ id: 2, title: 'Nirvana (2)' }] })
        : reply({ releases: [] })));
      await expect(discogs.getArtistReleases({ name: 'Nirvana' }, {})).resolves.toEqual({ artist: { name: 'Nirvana (2)' }, releases: [] });
      mockFetch(() => reply(null, { ok: false, status: 429 }));
      await expect(discogs.getArtistReleases({ name: 'Nirvana' }, {})).rejects.toThrow('429');
    });
  });
});
