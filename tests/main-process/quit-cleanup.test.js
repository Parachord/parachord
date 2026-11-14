/**
 * Quitting Parachord pauses Spotify, which plays outside the app.
 *
 * Two gaps let it keep playing (2026-11-14):
 * - the pause sent the stored access token without checking it had expired,
 *   so an hour after the last refresh Spotify answered 401 and played on;
 * - Ctrl+C under `npm start` killed the app partway through the quit step
 *   (start-electron.test.js). After a restart Parachord showed the track
 *   paused while Spotify finished it and carried on into the album.
 */
const { pauseSpotifyOnQuit } = require('../../main-process/quit-cleanup');

const response = (status) => ({ status, ok: status >= 200 && status < 300 });

describe('pauseSpotifyOnQuit', () => {
  test('asks for a valid token (refreshing an expired one) and pauses with it', async () => {
    const getToken = jest.fn(async () => 'fresh');
    const sendPause = jest.fn(async () => response(204));
    await expect(pauseSpotifyOnQuit({ getToken, sendPause })).resolves.toBe('paused');
    expect(getToken).toHaveBeenCalledWith(false);
    expect(sendPause).toHaveBeenCalledWith('fresh');
  });

  test('a 401 forces one refresh and retries once', async () => {
    const getToken = jest.fn(async (force) => (force ? 'forced' : 'stale'));
    const sendPause = jest.fn(async (token) => response(token === 'forced' ? 204 : 401));
    await expect(pauseSpotifyOnQuit({ getToken, sendPause })).resolves.toBe('paused');
    expect(getToken.mock.calls).toEqual([[false], [true]]);
    expect(sendPause.mock.calls).toEqual([['stale'], ['forced']]);
  });

  test('a second 401 gives up rather than looping', async () => {
    const getToken = jest.fn(async () => 'tok');
    const sendPause = jest.fn(async () => response(401));
    await expect(pauseSpotifyOnQuit({ getToken, sendPause })).resolves.toBe('status-401');
    expect(sendPause).toHaveBeenCalledTimes(2);
  });

  test('no token means nothing to pause', async () => {
    const sendPause = jest.fn();
    await expect(pauseSpotifyOnQuit({ getToken: async () => null, sendPause })).resolves.toBe('no-token');
    expect(sendPause).not.toHaveBeenCalled();
  });

  test('403 (no active device, or already paused) is not a failure', async () => {
    await expect(pauseSpotifyOnQuit({ getToken: async () => 't', sendPause: async () => response(403) }))
      .resolves.toBe('nothing-playing');
  });

  test('a throwing token refresh or request never throws out of quit', async () => {
    await expect(pauseSpotifyOnQuit({ getToken: async () => { throw new Error('offline'); }, sendPause: jest.fn() }))
      .resolves.toBe('error');
    await expect(pauseSpotifyOnQuit({ getToken: async () => 't', sendPause: async () => { throw new Error('aborted'); } }))
      .resolves.toBe('error');
  });

  test('the whole step is bounded: a hung token refresh cannot hold quit open', async () => {
    jest.useFakeTimers();
    try {
      const outcome = pauseSpotifyOnQuit({ getToken: () => new Promise(() => {}), sendPause: jest.fn(), budgetMs: 4000 });
      await jest.advanceTimersByTimeAsync(4000);
      await expect(outcome).resolves.toBe('timeout');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('main.js wiring', () => {
  const source = require('fs').readFileSync(require('path').join(__dirname, '../../main.js'), 'utf8');

  test('the quit pause goes through ensureValidSpotifyToken, not the raw stored token', () => {
    const start = source.indexOf('const pauseSpotifyPlayback = ');
    const body = source.slice(start, source.indexOf('\n};', start));
    expect(body).toContain('pauseSpotifyOnQuit(');
    expect(body).toContain('getToken: ensureValidSpotifyToken');
    expect(body).not.toContain("store.get('spotify_token')");
  });
});
