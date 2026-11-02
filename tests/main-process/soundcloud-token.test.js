const { createSoundCloudTokenSource, PROACTIVE_REFRESH_MS } = require('../../main-process/soundcloud-token');

const HOUR = 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

function memoryStore(initial) {
  const data = { ...initial };
  return {
    data,
    get: (k) => data[k],
    set: (k, v) => { data[k] = v; },
    delete: (k) => { delete data[k]; }
  };
}

// SoundCloud's token endpoint: refresh tokens are single-use, so a second
// refresh with the same token gets invalid_grant.
function soundCloudServer(firstRefreshToken) {
  let live = firstRefreshToken;
  let issued = 0;
  const fetch = jest.fn(async (url, opts) => {
    await new Promise((r) => setTimeout(r, 5));
    const sent = opts.body.get('refresh_token');
    if (sent !== live) {
      return { ok: false, status: 400, statusText: 'Bad Request', json: async () => ({ error: 'invalid_grant' }) };
    }
    issued += 1;
    live = `refresh-${issued}`;
    return { ok: true, status: 200, json: async () => ({ access_token: `access-${issued}`, refresh_token: live, expires_in: 3600 }) };
  });
  return { fetch };
}

const quiet = { log: () => {}, error: () => {} };
const credentials = () => ({ clientId: 'id', clientSecret: 'secret', source: 'test' });

function expiredStore() {
  return memoryStore({
    soundcloud_token: 'access-0',
    soundcloud_refresh_token: 'refresh-0',
    soundcloud_token_expiry: NOW - 1000,
    soundcloud_last_refresh: NOW - 2 * HOUR
  });
}

describe('SoundCloud token source', () => {
  test('a valid token is returned without a refresh', async () => {
    const store = memoryStore({ soundcloud_token: 'a', soundcloud_token_expiry: NOW + HOUR, soundcloud_last_refresh: NOW - HOUR });
    const server = soundCloudServer('r');
    const source = createSoundCloudTokenSource({ store, fetch: server.fetch, getCredentials: credentials, now: () => NOW, log: quiet });
    await expect(source.checkToken()).resolves.toEqual({ token: 'a', expiresAt: NOW + HOUR });
    expect(server.fetch).not.toHaveBeenCalled();
  });

  test('concurrent checks on an expired token share ONE refresh and stay signed in', async () => {
    const store = expiredStore();
    const server = soundCloudServer('refresh-0');
    const source = createSoundCloudTokenSource({ store, fetch: server.fetch, getCredentials: credentials, now: () => NOW, log: quiet });

    const results = await Promise.all(Array.from({ length: 12 }, () => source.checkToken()));

    expect(server.fetch).toHaveBeenCalledTimes(1);
    results.forEach((r) => expect(r.token).toBe('access-1'));
    expect(store.data.soundcloud_token).toBe('access-1');
    expect(store.data.soundcloud_refresh_token).toBe('refresh-1');
  });

  test('a stale invalid_grant never clears tokens another refresh rotated in', async () => {
    // Two token sources over one store stand in for two refreshes that
    // started with the same refresh token (the race the single-flight
    // stops inside one process).
    const store = expiredStore();
    const server = soundCloudServer('refresh-0');
    const a = createSoundCloudTokenSource({ store, fetch: server.fetch, getCredentials: credentials, now: () => NOW, log: quiet });
    const b = createSoundCloudTokenSource({ store, fetch: server.fetch, getCredentials: credentials, now: () => NOW, log: quiet });

    const [ra, rb] = await Promise.all([a.checkToken(), b.checkToken()]);

    expect(server.fetch).toHaveBeenCalledTimes(2);
    expect(ra.token).toBe('access-1');
    expect(rb && rb.token).toBe('access-1');
    expect(store.data.soundcloud_refresh_token).toBe('refresh-1');
  });

  test('a dead refresh token that is still the stored one clears the tokens', async () => {
    const store = expiredStore();
    const server = soundCloudServer('something-else');
    const source = createSoundCloudTokenSource({ store, fetch: server.fetch, getCredentials: credentials, now: () => NOW, log: quiet });
    await expect(source.checkToken()).resolves.toBeNull();
    expect(store.data).toEqual({});
  });

  test('a failed proactive refresh keeps handing out the still-valid token', async () => {
    const store = memoryStore({
      soundcloud_token: 'a',
      soundcloud_refresh_token: 'r',
      soundcloud_token_expiry: NOW + HOUR,
      soundcloud_last_refresh: NOW - PROACTIVE_REFRESH_MS - 1
    });
    const fetch = jest.fn(async () => { throw new Error('offline'); });
    const source = createSoundCloudTokenSource({ store, fetch, getCredentials: credentials, now: () => NOW, log: quiet });
    await expect(source.checkToken()).resolves.toEqual({ token: 'a', expiresAt: NOW + HOUR });
    expect(store.data.soundcloud_refresh_token).toBe('r');
  });

  test('no refresh token means signed out, with no request', async () => {
    const store = memoryStore({ soundcloud_token: 'a', soundcloud_token_expiry: NOW - 1 });
    const fetch = jest.fn();
    const source = createSoundCloudTokenSource({ store, fetch, getCredentials: credentials, now: () => NOW, log: quiet });
    await expect(source.checkToken()).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
