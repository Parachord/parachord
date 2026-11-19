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
  for (const name of ['getSimilarArtists', 'getSimilarTracks']) {
    if (axe.implementation[name]) fns[name] = new Function('return ' + axe.implementation[name])();
  }
  return { axe, ...fns };
};

const lastfm = load('lastfm');
const listenbrainz = load('listenbrainz');

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
