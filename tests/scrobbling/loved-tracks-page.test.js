/**
 * Loved-tracks IMPORT (parachord#1071): the scrobblers' page fetchers.
 * user.getLovedTracks is a read method — API key + username only, no session
 * key and no signature — so a read can't trip the signed-request auth-error
 * handling. Plan: docs/plans/2026-11-06-import-loved-tracks.md, Task 1.
 */

const { LastFmScrobbler, ListenBrainzScrobbler } = require('../../scrobbler-loader');

const installWindow = ({ config, response, url }) => {
  const calls = [];
  global.window = {
    electron: {
      store: { get: async () => config },
      proxyFetch: async (u) => { calls.push(u); return response; },
      crypto: { md5: async (s) => `md5(${s})` },
    },
    ...(url ? {} : {}),
  };
  if (url) global.window.__urlOverride = url;
  return calls;
};

const connected = { enabled: true, sessionKey: 'sk', username: 'example-user' };
const okBody = { lovedtracks: { '@attr': { page: '1', total: '1' }, track: [] } };
const ok = (body = okBody) => ({ success: true, text: JSON.stringify(body) });

afterEach(() => { delete global.window; });

describe('LastFmScrobbler.getLovedTracksPage', () => {
  test('requests the read method unsigned: no sk, no api_sig', async () => {
    const scrobbler = new LastFmScrobbler();
    scrobbler.setApiCredentials('APIKEY', 'SECRET');
    const calls = installWindow({ config: connected, response: ok() });
    await scrobbler.getLovedTracksPage({ page: 2, count: 200 });
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]);
    expect(url.origin + url.pathname).toBe('https://ws.audioscrobbler.com/2.0/');
    expect(url.searchParams.get('method')).toBe('user.getLovedTracks');
    expect(url.searchParams.get('user')).toBe('example-user');
    expect(url.searchParams.get('api_key')).toBe('APIKEY');
    expect(url.searchParams.get('format')).toBe('json');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('limit')).toBe('200');
    expect(url.searchParams.get('sk')).toBeNull();      // no session key
    expect(url.searchParams.get('api_sig')).toBeNull(); // no signature
  });

  test('rejects with the API message (error 6: user not found)', async () => {
    const scrobbler = new LastFmScrobbler();
    scrobbler.setApiCredentials('APIKEY', 'SECRET');
    installWindow({ config: connected, response: ok({ error: 6, message: 'User not found' }) });
    await expect(scrobbler.getLovedTracksPage()).rejects.toThrow('User not found');
  });

  test('rejects with Not connected when there is no username', async () => {
    const scrobbler = new LastFmScrobbler();
    scrobbler.setApiCredentials('APIKEY', 'SECRET');
    installWindow({ config: { enabled: true, sessionKey: 'sk' }, response: ok() });
    await expect(scrobbler.getLovedTracksPage()).rejects.toThrow('Not connected');
  });

  test('rejects with Not connected when there is no API key', async () => {
    const scrobbler = new LastFmScrobbler();
    installWindow({ config: connected, response: ok() });
    await expect(scrobbler.getLovedTracksPage()).rejects.toThrow('Not connected');
  });

  test('rejects when the HTTP request itself fails', async () => {
    const scrobbler = new LastFmScrobbler();
    scrobbler.setApiCredentials('APIKEY', 'SECRET');
    installWindow({ config: connected, response: { success: false, status: 500, error: 'HTTP 500' } });
    await expect(scrobbler.getLovedTracksPage()).rejects.toThrow('Last.fm request failed');
  });
});

describe('ListenBrainzScrobbler.getLovedTracksPage', () => {
  const installLbWindow = ({ config, response }) => {
    const calls = [];
    global.window = {
      electron: {
        store: { get: async () => config },
        proxyFetch: async (u, opts) => { calls.push([u, opts]); return response; },
      },
    };
    return calls;
  };

  test('requests the feedback endpoint unsigned: score=1, count, offset, metadata, and no token header', async () => {
    const calls = installLbWindow({
      config: { enabled: true, userToken: 'tok', username: 'lb-user' },
      response: { success: true, text: '{}' },
    });
    const lb = new ListenBrainzScrobbler();
    await lb.getLovedTracksPage({ offset: 200, count: 100 });
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://api.listenbrainz.org/1/feedback/user/lb-user/get-feedback');
    expect(url.searchParams.get('score')).toBe('1');
    expect(url.searchParams.get('count')).toBe('100');
    expect(url.searchParams.get('offset')).toBe('200');
    expect(url.searchParams.get('metadata')).toBe('true');
    // Public endpoint: no Authorization header, even with a token configured.
    expect((calls[0][1] || {}).headers).toBeUndefined();
    delete global.window;
  });

  test('a 404 rejects with ListenBrainz user not found', async () => {
    installLbWindow({
      config: { enabled: true, userToken: 'tok', username: 'nobody-here' },
      response: { success: false, status: 404 },
    });
    const lb = new ListenBrainzScrobbler();
    await expect(lb.getLovedTracksPage()).rejects.toThrow('ListenBrainz user not found');
    delete global.window;
  });

  test('rejects with Not connected when there is no username', async () => {
    installLbWindow({
      config: { enabled: true, userToken: 'tok' },
      response: { success: true, text: '{}' },
    });
    const lb = new ListenBrainzScrobbler();
    await expect(lb.getLovedTracksPage()).rejects.toThrow('Not connected');
    delete global.window;
  });
});
