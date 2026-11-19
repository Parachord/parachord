/**
 * The charts capability (#1539 step 3): Pop of the Tops' charts from the
 * plug-ins. Apple Music's most-played feeds, Last.fm's top tracks and
 * ListenBrainz's sitewide statistics, moved out of app.js. Loads the built
 * plug-ins (plugins/*.axe, from scripts/build-axes.js) the way the app
 * materializes them: new Function.
 */
const fs = require('fs');
const path = require('path');
const ResolverLoader = require('../../resolver-loader');

const load = (id) => {
  const axe = JSON.parse(fs.readFileSync(path.join(__dirname, `../../plugins/${id}.axe`), 'utf8'));
  return { axe, getCharts: new Function('return ' + axe.implementation.getCharts)() };
};
const apple = load('applemusic');
const lastfm = load('lastfm');
const listenbrainz = load('listenbrainz');

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
  test('each declares charts and says what it charts', () => {
    for (const p of [apple, lastfm, listenbrainz]) {
      expect(p.axe.capabilities.charts).toBe(true);
      expect(typeof p.getCharts).toBe('function');
    }
    expect(ResolverLoader.chartsInfo(apple.axe.charts)).toEqual({
      tracks: { global: false, countries: expect.arrayContaining(['us', 'gb', 'jp']) },
      albums: { global: false, countries: expect.arrayContaining(['us', 'gb', 'jp']) },
    });
    expect(ResolverLoader.chartsInfo(lastfm.axe.charts)).toEqual({ tracks: { global: true, countries: expect.arrayContaining(['us', 'pl']) } });
    expect(ResolverLoader.chartsInfo(listenbrainz.axe.charts)).toEqual({
      period: 'this week', tracks: { global: true, countries: [] }, albums: { global: true, countries: [] },
    });
  });
});

describe('Apple Music getCharts', () => {
  const feed = { feed: { results: [
    { name: 'Song A', artistName: 'Artist A', artworkUrl100: 'https://img/100x100bb.jpg', url: 'https://music.apple.com/a', genres: [{ name: 'Pop' }, { name: 'Music' }], releaseDate: '2026-05-17' },
    { name: '', artistName: 'Nobody' },
  ] } };

  test('tracks: the songs feed for the country, art at 600px', async () => {
    mockFetch(() => reply(feed));
    const out = await apple.getCharts({ kind: 'tracks', country: 'gb', limit: 50 }, {});
    expect(calls[0].url).toBe('https://rss.marketingtools.apple.com/api/v2/gb/music/most-played/50/songs.json');
    expect(out).toEqual([{ title: 'Song A', artist: 'Artist A', albumArt: 'https://img/600x600bb.jpg', url: 'https://music.apple.com/a', genres: ['Pop'], releaseDate: '2026-05-17' }]);
  });

  test('albums: the albums feed, art at 300px', async () => {
    mockFetch(() => reply(feed));
    const out = await apple.getCharts({ kind: 'albums', country: 'us' }, {});
    expect(calls[0].url).toContain('/us/music/most-played/50/albums.json');
    expect(out[0].albumArt).toBe('https://img/300x300bb.jpg');
  });

  test('no global chart: no country is null, with no request', async () => {
    mockFetch(() => reply(feed));
    await expect(apple.getCharts({ kind: 'tracks' }, {})).resolves.toBeNull();
    await expect(apple.getCharts({ kind: 'artists', country: 'us' }, {})).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  test('a failed first try is tried once more; two failures throw', async () => {
    let n = 0;
    mockFetch(() => (++n === 1 ? reply(null, { ok: false, status: 500 }) : reply(feed)));
    await expect(apple.getCharts({ kind: 'tracks', country: 'us' }, {})).resolves.toHaveLength(1);
    expect(calls).toHaveLength(2);
    mockFetch(() => reply(null, { ok: false, status: 503 }));
    await expect(apple.getCharts({ kind: 'tracks', country: 'us' }, {})).rejects.toThrow('503');
  });
});

describe('Last.fm getCharts', () => {
  const KEY = 'secret-key-123';
  const body = { tracks: { track: [
    { name: 'Song A', artist: { name: 'Artist A' }, listeners: '123456', playcount: '999999', url: 'https://last.fm/a', mbid: 'm1',
      image: [{ size: 'extralarge', '#text': 'https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png' }] },
    { name: 'Song B', artist: 'Artist B', image: [{ size: 'extralarge', '#text': 'https://img/b.jpg' }] },
  ] } };

  test('worldwide: chart.gettoptracks; the grey star placeholder is dropped', async () => {
    mockFetch(() => reply(body));
    const out = await lastfm.getCharts({ kind: 'tracks', limit: 50 }, { apiKey: KEY });
    const u = new URL(calls[0].url);
    expect(u.searchParams.get('method')).toBe('chart.gettoptracks');
    expect(out).toEqual([
      { title: 'Song A', artist: 'Artist A', albumArt: undefined, url: 'https://last.fm/a', listeners: 123456, listens: 999999, mbid: 'm1' },
      { title: 'Song B', artist: 'Artist B', albumArt: 'https://img/b.jpg', url: undefined, listeners: undefined, listens: undefined, mbid: undefined },
    ]);
  });

  test('a country: geo.gettoptracks with its English name', async () => {
    mockFetch(() => reply({ toptracks: body.tracks }));
    await lastfm.getCharts({ kind: 'tracks', country: 'kr', countryName: 'South Korea' }, { apiKey: KEY });
    const u = new URL(calls[0].url);
    expect(u.searchParams.get('method')).toBe('geo.gettoptracks');
    expect(u.searchParams.get('country')).toBe('South Korea');
  });

  test('albums are not charted; no key or an error throws', async () => {
    mockFetch(() => reply(body));
    await expect(lastfm.getCharts({ kind: 'albums' }, { apiKey: KEY })).resolves.toBeNull();
    await expect(lastfm.getCharts({ kind: 'tracks' }, {})).rejects.toThrow('no API key');
    mockFetch(() => reply({ error: 29, message: 'Rate limit' }));
    const err = await lastfm.getCharts({ kind: 'tracks' }, { apiKey: KEY }).catch((e) => e);
    expect(err.message).toContain('error 29');
    expect(err.message).not.toContain(KEY);
  });
});

describe('ListenBrainz getCharts', () => {
  test('tracks: this week\'s sitewide recordings', async () => {
    mockFetch(() => reply({ payload: { recordings: [
      { track_name: 'Song A', artist_name: 'Artist A', release_name: 'Album A', recording_mbid: 'r1', listen_count: 456 },
      { track_name: '', artist_name: 'X' },
    ] } }));
    const out = await listenbrainz.getCharts({ kind: 'tracks', limit: 50 }, {});
    expect(calls[0].url).toBe('https://api.listenbrainz.org/1/stats/sitewide/recordings?range=week&count=50');
    expect(calls[0].options.headers).toEqual({});
    expect(out).toEqual([{ title: 'Song A', artist: 'Artist A', album: 'Album A', mbid: 'r1', listens: 456 }]);
  });

  test('albums: release groups, with their MBID; the user\'s token goes along when there is one', async () => {
    mockFetch(() => reply({ payload: { release_groups: [
      { release_group_name: 'Monsters', artist_name: 'All Time Low', release_group_mbid: 'rg1', listen_count: 381 },
    ] } }));
    const out = await listenbrainz.getCharts({ kind: 'albums' }, { userToken: 'tok' });
    expect(calls[0].url).toContain('/sitewide/release-groups?');
    expect(calls[0].options.headers.Authorization).toBe('Token tok');
    expect(out).toEqual([{ title: 'Monsters', artist: 'All Time Low', mbid: 'rg1', listens: 381 }]);
  });

  test('worldwide only; not calculated yet is empty; a challenge page or failure throws', async () => {
    mockFetch(() => reply({}));
    await expect(listenbrainz.getCharts({ kind: 'tracks', country: 'us' }, {})).resolves.toBeNull();
    expect(calls).toHaveLength(0);
    mockFetch(() => ({ ok: true, status: 204, json: async () => { throw new Error('no body'); } }));
    await expect(listenbrainz.getCharts({ kind: 'tracks' }, {})).resolves.toEqual([]);
    mockFetch(() => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token '<'"); } }));
    await expect(listenbrainz.getCharts({ kind: 'tracks' }, {})).rejects.toThrow('Unexpected token');
    mockFetch(() => reply(null, { ok: false, status: 502 }));
    await expect(listenbrainz.getCharts({ kind: 'albums' }, {})).rejects.toThrow('502');
    mockFetch(() => reply({ payload: {} }));
    await expect(listenbrainz.getCharts({ kind: 'albums' }, {})).rejects.toThrow('unexpected');
  });
});
