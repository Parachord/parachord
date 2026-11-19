/**
 * The listeningHistory capability (#1539 step 4): your own stats from
 * Last.fm (user.gettop*, user.getrecenttracks) and ListenBrainz
 * (/1/stats/user, /1/user/<user>/listens), moved out of app.js. Loads the
 * built plug-ins (plugins/*.axe) the way the app materializes them.
 */
const fs = require('fs');
const path = require('path');

const load = (id) => {
  const axe = JSON.parse(fs.readFileSync(path.join(__dirname, `../../plugins/${id}.axe`), 'utf8'));
  const fns = {};
  for (const name of ['getTopItems', 'getRecentListens', 'getNowPlaying']) fns[name] = new Function('return ' + axe.implementation[name])();
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

test('both declare listeningHistory with both methods', () => {
  for (const p of [lastfm, listenbrainz]) {
    expect(p.axe.capabilities.listeningHistory).toBe(true);
    expect(typeof p.getTopItems).toBe('function');
    expect(typeof p.getRecentListens).toBe('function');
  }
});

describe('Last.fm', () => {
  test('top tracks for the signed-in user and the period', async () => {
    mockFetch(() => reply({ toptracks: { track: [
      { name: 'Song', artist: { name: 'Band' }, playcount: '42', mbid: 'r1', image: [{ '#text': 'star' }] },
      { name: '' },
    ] } }));
    const out = await lastfm.getTopItems({ kind: 'tracks', period: 'quarter', limit: 20 }, { apiKey: KEY, username: 'me' });
    const u = new URL(calls[0].url);
    expect(u.searchParams.get('method')).toBe('user.gettoptracks');
    expect(u.searchParams.get('user')).toBe('me');
    expect(u.searchParams.get('period')).toBe('3month');
    expect(u.searchParams.get('limit')).toBe('20');
    // Never a track's image (the grey star).
    expect(out).toEqual([{ title: 'Song', artist: 'Band', plays: 42, mbid: 'r1' }]);
  });

  test('albums keep their cover unless it is the placeholder; artists by name; another user can be asked', async () => {
    mockFetch(() => reply({ topalbums: { album: [
      { name: 'LP', artist: { name: 'Band' }, playcount: '7', image: [{}, {}, { '#text': 'm.jpg' }, { '#text': 'x.jpg' }] },
      { name: 'EP', artist: { name: 'Band' }, playcount: '3', image: [{}, {}, {}, { '#text': 'https://x/300/2a96cbd8b46e442fc41c2b86b821562f.png' }] },
    ] } }));
    const albums = await lastfm.getTopItems({ kind: 'albums', period: 'all', user: 'friend' }, { apiKey: KEY, username: 'me' });
    expect(new URL(calls[0].url).searchParams.get('user')).toBe('friend');
    expect(new URL(calls[0].url).searchParams.get('period')).toBe('overall');
    expect(albums.map((a) => a.albumArt)).toEqual(['x.jpg', undefined]);
    mockFetch(() => reply({ topartists: { artist: [{ name: 'Band', playcount: '9', mbid: 'a1' }] } }));
    await expect(lastfm.getTopItems({ kind: 'artists', period: 'week' }, { apiKey: KEY, username: 'me' }))
      .resolves.toEqual([{ name: 'Band', plays: 9, mbid: 'a1' }]);
  });

  test('recent listens: newest first, now playing marked', async () => {
    mockFetch(() => reply({ recenttracks: { track: [
      { name: 'Now', artist: { '#text': 'A' }, '@attr': { nowplaying: 'true' } },
      { name: 'Then', artist: { '#text': 'B' }, album: { '#text': 'LP' }, date: { uts: '1700000000' }, image: [{}, {}, { '#text': 'c.jpg' }] },
    ] } }));
    const out = await lastfm.getRecentListens({ limit: 50 }, { apiKey: KEY, username: 'me' });
    expect(out).toEqual([
      { title: 'Now', artist: 'A', album: undefined, albumArt: undefined, playedAt: null, nowPlaying: true, mbid: undefined },
      { title: 'Then', artist: 'B', album: 'LP', albumArt: 'c.jpg', playedAt: 1700000000000, nowPlaying: false, mbid: undefined },
    ]);
  });

  test('no user is null with no request; no such user is []; a failure or no key throws', async () => {
    mockFetch(() => reply({}));
    await expect(lastfm.getTopItems({ kind: 'tracks', period: 'all' }, { apiKey: KEY })).resolves.toBeNull();
    await expect(lastfm.getRecentListens({}, { apiKey: KEY })).resolves.toBeNull();
    expect(calls).toHaveLength(0);
    mockFetch(() => reply({ error: 6, message: 'User not found' }));
    await expect(lastfm.getTopItems({ kind: 'tracks', period: 'all' }, { apiKey: KEY, username: 'x' })).resolves.toEqual([]);
    await expect(lastfm.getTopItems({ kind: 'tracks', period: 'all' }, { username: 'x' })).rejects.toThrow('no API key');
    mockFetch(() => reply(null, { ok: false, status: 500 }));
    const err = await lastfm.getRecentListens({}, { apiKey: KEY, username: 'x' }).catch((e) => e);
    expect(err.message).toContain('500');
    expect(err.message).not.toContain(KEY);
  });
});

describe('ListenBrainz', () => {
  test('top tracks: the user\'s recordings for the period, with the token and ListenBrainz\'s own cover', async () => {
    mockFetch(() => reply({ payload: { recordings: [
      { track_name: 'Song', artist_name: 'Band', release_name: 'LP', listen_count: 12, recording_mbid: 'r1', caa_id: 5, caa_release_mbid: 'rel1' },
      { track_name: 'Bare', artist_name: 'Band', listen_count: 2, caa_release_mbid: 'rel2' },
    ] } }));
    const out = await listenbrainz.getTopItems({ kind: 'tracks', period: 'half_year', limit: 15 }, { username: 'me', userToken: 'tok' });
    expect(calls[0].url).toBe('https://api.listenbrainz.org/1/stats/user/me/recordings?range=half_yearly&count=15');
    expect(calls[0].options.headers.Authorization).toBe('Token tok');
    expect(out).toEqual([
      { title: 'Song', artist: 'Band', album: 'LP', plays: 12, mbid: 'r1', albumArt: 'https://coverartarchive.org/release/rel1/front-250' },
      // No caa_id: no cover (an unverified archive URL showed placeholders for months).
      { title: 'Bare', artist: 'Band', album: undefined, plays: 2, mbid: undefined, albumArt: undefined },
    ]);
  });

  test('albums are releases, artists by name; periods map to ListenBrainz ranges', async () => {
    mockFetch(() => reply({ payload: { releases: [{ release_name: 'LP', artist_name: 'Band', listen_count: 4, release_mbid: 'm' }] } }));
    await expect(listenbrainz.getTopItems({ kind: 'albums', period: 'all', user: 'friend' }, { username: 'me' }))
      .resolves.toEqual([{ title: 'LP', artist: 'Band', plays: 4, mbid: 'm', albumArt: undefined }]);
    expect(calls[0].url).toContain('/stats/user/friend/releases?range=all_time');
    expect(calls[0].options.headers).toEqual({});
    mockFetch(() => reply({ payload: { artists: [{ artist_name: 'Band', listen_count: 9, artist_mbid: 'a' }] } }));
    await expect(listenbrainz.getTopItems({ kind: 'artists', period: 'week' }, { username: 'me' }))
      .resolves.toEqual([{ name: 'Band', plays: 9, mbid: 'a' }]);
    expect(calls[0].url).toContain('range=week');
  });

  test('recent listens', async () => {
    mockFetch(() => reply({ payload: { listens: [
      { listened_at: 1700000000, recording_msid: 'msid1', track_metadata: { track_name: 'Song', artist_name: 'Band', release_name: 'LP',
        additional_info: { recording_mbid: 'r1' }, mbid_mapping: { caa_id: 1, caa_release_mbid: 'rel' } } },
      { playing_now: true, track_metadata: { track_name: 'Now', artist_name: 'X' } },
      { track_metadata: {} },
    ] } }));
    const out = await listenbrainz.getRecentListens({ limit: 50 }, { username: 'me' });
    expect(calls[0].url).toBe('https://api.listenbrainz.org/1/user/me/listens?count=50');
    expect(out).toEqual([
      { title: 'Song', artist: 'Band', album: 'LP', albumArt: 'https://coverartarchive.org/release/rel/front-250', playedAt: 1700000000000, nowPlaying: false, mbid: 'r1', msid: 'msid1' },
      { title: 'Now', artist: 'X', album: undefined, albumArt: undefined, playedAt: null, nowPlaying: true, mbid: undefined, msid: undefined },
    ]);
  });

  test('no user is null; 204 is []; a failure or an unexpected answer throws', async () => {
    mockFetch(() => reply({}));
    await expect(listenbrainz.getTopItems({ kind: 'tracks', period: 'all' }, {})).resolves.toBeNull();
    expect(calls).toHaveLength(0);
    mockFetch(() => ({ ok: true, status: 204, json: async () => { throw new Error('no body'); } }));
    await expect(listenbrainz.getTopItems({ kind: 'tracks', period: 'all' }, { username: 'me' })).resolves.toEqual([]);
    mockFetch(() => reply(null, { ok: false, status: 503 }));
    await expect(listenbrainz.getRecentListens({}, { username: 'me' })).rejects.toThrow('503');
    mockFetch(() => reply({ payload: {} }));
    await expect(listenbrainz.getTopItems({ kind: 'albums', period: 'all' }, { username: 'me' })).rejects.toThrow('unexpected');
  });
});

describe('friends (#1539 step 5): getNowPlaying and error statuses', () => {
  test('Last.fm: playing now is the newest listen when Last.fm marks it so', async () => {
    const self = { getRecentListens: lastfm.getRecentListens };
    mockFetch(() => reply({ recenttracks: { track: [{ name: 'Now', artist: { '#text': 'A' }, album: { '#text': 'LP' }, '@attr': { nowplaying: 'true' } }] } }));
    await expect(lastfm.getNowPlaying.call(self, { user: 'friend' }, { apiKey: KEY })).resolves.toEqual({ title: 'Now', artist: 'A', album: 'LP' });
    expect(new URL(calls[0].url).searchParams.get('user')).toBe('friend');
    expect(new URL(calls[0].url).searchParams.get('limit')).toBe('1');
    mockFetch(() => reply({ recenttracks: { track: [{ name: 'Then', artist: { '#text': 'A' }, date: { uts: '1' } }] } }));
    await expect(lastfm.getNowPlaying.call(self, { user: 'friend' }, { apiKey: KEY })).resolves.toBeNull();
  });

  test('ListenBrainz: /playing-now', async () => {
    mockFetch(() => reply({ payload: { listens: [{ playing_now: true, track_metadata: { track_name: 'Now', artist_name: 'A', release_name: 'LP' } }] } }));
    await expect(listenbrainz.getNowPlaying({ user: 'friend' }, {})).resolves.toEqual({ title: 'Now', artist: 'A', album: 'LP' });
    expect(calls[0].url).toBe('https://api.listenbrainz.org/1/user/friend/playing-now');
    mockFetch(() => reply({ payload: { listens: [] } }));
    await expect(listenbrainz.getNowPlaying({ user: 'friend' }, {})).resolves.toBeNull();
  });

  test('a failed request\'s error carries its HTTP status, for the friend poll\'s backoff', async () => {
    mockFetch(() => reply({ error: 29 }, { ok: false, status: 429 }));
    expect((await lastfm.getRecentListens({ user: 'f' }, { apiKey: KEY }).catch((e) => e)).status).toBe(429);
    expect((await lastfm.getTopItems({ user: 'f', kind: 'tracks', period: 'week' }, { apiKey: KEY }).catch((e) => e)).status).toBe(429);
    mockFetch(() => reply(null, { ok: false, status: 404 }));
    expect((await listenbrainz.getRecentListens({ user: 'f' }, {}).catch((e) => e)).status).toBe(404);
    expect((await listenbrainz.getTopItems({ user: 'f', kind: 'albums', period: 'week' }, {}).catch((e) => e)).status).toBe(404);
    expect((await listenbrainz.getNowPlaying({ user: 'f' }, {}).catch((e) => e)).status).toBe(404);
  });
});
