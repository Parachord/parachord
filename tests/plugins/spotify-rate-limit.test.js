/**
 * A Spotify 429 is a refusal, not "no results" (CLAUDE.md "No resolver holds a
 * row"). The plugin returned [] for it, so every lookup during a rate limit was
 * saved as "not on Spotify" for 7 days and the app kept searching, which can
 * stretch the limit (2026-11-15: Retry-After 8940 s after a 2,101-track import).
 * Now it throws, and skips the request entirely until Retry-After has passed.
 */
const spotify = require('../../plugins-src/spotify/implementation');

const res = (status, { headers = {}, body = {} } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[k] ?? headers[k.toLowerCase()] ?? null },
  json: async () => body,
  text: async () => JSON.stringify(body),
});
const trackBody = { tracks: { items: [{ id: 't1', name: 'Penny in the Lake', artists: [{ name: 'Ratboys' }], album: { id: 'a', name: 'X', images: [] }, duration_ms: 1000, uri: 'spotify:track:t1' }] } };
const config = { token: 'tok' };

beforeEach(() => {
  delete spotify.__parachordSpotifyRetryAt;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { delete global.fetch; jest.restoreAllMocks(); });

test('a 429 throws SpotifyRateLimited instead of answering []', async () => {
  global.fetch = jest.fn().mockResolvedValue(res(429, { headers: { 'Retry-After': '8940' } }));
  await expect(spotify.search('ratboys', config)).rejects.toMatchObject({ name: 'SpotifyRateLimited' });
});

test('after a 429 no request goes out until Retry-After has passed', async () => {
  const now = Date.now();
  global.fetch = jest.fn().mockResolvedValue(res(429, { headers: { 'Retry-After': '120' } }));
  await expect(spotify.search('a', config)).rejects.toMatchObject({ name: 'SpotifyRateLimited' });
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(spotify.__parachordSpotifyRetryAt).toBeGreaterThanOrEqual(now + 120000);

  await expect(spotify.search('b', config)).rejects.toMatchObject({ name: 'SpotifyRateLimited' });
  await expect(spotify.resolve('Ratboys', 'Penny in the Lake', null, config)).rejects.toMatchObject({ name: 'SpotifyRateLimited' });
  expect(await spotify.searchAlbums('ratboys', config)).toEqual([]);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('once the wait is over, searches go out again', async () => {
  spotify.__parachordSpotifyRetryAt = Date.now() - 1;
  global.fetch = jest.fn().mockResolvedValue(res(200, { body: trackBody }));
  const results = await spotify.search('ratboys', config);
  expect(results[0].spotifyId).toBe('t1');
});

test('a refusal (403) throws; a bad query (400) is still no results', async () => {
  global.fetch = jest.fn().mockResolvedValue(res(403));
  await expect(spotify.search('a', config)).rejects.toThrow();
  global.fetch = jest.fn().mockResolvedValue(res(400));
  expect(await spotify.search('a', config)).toEqual([]);
});

test('an album search 429 also starts the wait', async () => {
  global.fetch = jest.fn().mockResolvedValue(res(429, { headers: { 'Retry-After': '60' } }));
  expect(await spotify.searchAlbums('ratboys', config)).toEqual([]);
  expect(spotify.__parachordSpotifyRetryAt).toBeGreaterThan(Date.now());
});
