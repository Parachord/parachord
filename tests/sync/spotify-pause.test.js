/**
 * One Spotify rate-limit pause per process (sync-providers/spotify-pause.js),
 * and the places that must honour it: the renderer's fetch gate, the main
 * process's playback poller and quit pause, and the sync provider.
 */
const fs = require('fs');
const path = require('path');
const { createSpotifyPause, isSpotifyApiUrl, retryAfterMs, pausedResponse, MAX_PAUSE_MS } = require('../../sync-providers/spotify-pause');

describe('createSpotifyPause', () => {
  test('a 429 starts a pause for Retry-After', () => {
    const p = createSpotifyPause();
    expect(p.noteStatus(429, '8940', 0)).toBe(true);
    expect(p.isPaused(8940 * 1000 - 1)).toBe(true);
    expect(p.isPaused(8940 * 1000)).toBe(false);
  });

  test('another 429 extends but never shortens, and reports no new start', () => {
    const p = createSpotifyPause();
    p.noteStatus(429, '100', 0);
    expect(p.noteStatus(429, '10', 1000)).toBe(false);
    expect(p.msRemaining(1000)).toBe(99000);
    p.noteStatus(429, '200', 1000);
    expect(p.msRemaining(1000)).toBe(200000);
  });

  test('other statuses change nothing', () => {
    const p = createSpotifyPause();
    expect(p.noteStatus(200, null, 0)).toBe(false);
    expect(p.noteStatus(503, '60', 0)).toBe(false);
    expect(p.isPaused(1)).toBe(false);
  });

  test('a missing or junk Retry-After is 5 s; a huge one is capped at a day', () => {
    expect(retryAfterMs(null)).toBe(5000);
    expect(retryAfterMs('soon')).toBe(5000);
    expect(retryAfterMs('0')).toBe(5000);
    expect(retryAfterMs(String(10 * 24 * 3600))).toBe(MAX_PAUSE_MS);
  });
});

test('isSpotifyApiUrl matches only the Web API host', () => {
  expect(isSpotifyApiUrl('https://api.spotify.com/v1/me/player')).toBe(true);
  expect(isSpotifyApiUrl({ url: 'https://api.spotify.com/v1/search?q=a' })).toBe(true);
  expect(isSpotifyApiUrl('https://accounts.spotify.com/api/token')).toBe(false);
  expect(isSpotifyApiUrl('https://open.spotify.com/track/x')).toBe(false);
  expect(isSpotifyApiUrl('not a url')).toBe(false);
});

test('pausedResponse is a 429 carrying the time left', async () => {
  const r = pausedResponse(61500);
  expect(r.status).toBe(429);
  expect(r.ok).toBe(false);
  expect(r.headers.get('Retry-After')).toBe('62');
});

describe('wiring', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

  test('the renderer gates every api.spotify.com fetch', () => {
    const app = read('src/renderer/app.js');
    expect(app).toMatch(/isSpotifyApiUrl\(input\)/);
    expect(app).toMatch(/spotifyPause\.isPaused\(\)\)\s*\{?[\s\S]{0,200}pausedResponse\(/);
    expect(app).toMatch(/spotifyPause\.noteStatus\(/);
  });

  test('main: the playback poller, its recovery and the quit pause skip while paused', () => {
    const main = read('main.js');
    expect((main.match(/sharedPause\.isPaused\(\)/g) || []).length).toBeGreaterThanOrEqual(3);
    expect((main.match(/sharedPause\.noteStatus\(/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test('the sync provider shares the main-process pause', () => {
    const sync = read('sync-providers/spotify.js');
    expect(sync).toMatch(/require\('\.\/spotify-pause'\)/);
    expect(sync).toMatch(/sharedPause\.isPaused\(/);
    expect(sync).toMatch(/sharedPause\.noteStatus\(/);
  });
});

describe('the sync sign-in check honours the pause', () => {
  const spotify = require('../../sync-providers/spotify');
  const { sharedPause } = require('../../sync-providers/spotify-pause');
  afterEach(() => { sharedPause.clear(); delete global.fetch; });

  test('while paused it answers 429 without a request', async () => {
    sharedPause.noteStatus(429, '600');
    global.fetch = jest.fn();
    expect(await spotify.checkAuthStatus('tok')).toEqual({ ok: false, status: 429 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('a 429 from /me starts the pause, so the sync after it sends nothing', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429, headers: { get: (k) => (k.toLowerCase() === 'retry-after' ? '600' : null) } });
    expect(await spotify.checkAuthStatus('tok')).toEqual({ ok: false, status: 429 });
    expect(sharedPause.isPaused()).toBe(true);
    await expect(spotify.getPlaylistSnapshot('p', 'tok')).rejects.toThrow(/cooldown/i);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
