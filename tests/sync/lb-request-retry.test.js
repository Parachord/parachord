/**
 * lbRequest retry-with-backoff (parachord#868). Mirrors spotifyRequest: 429
 * honors Retry-After; 5xx + network errors back off exponentially; capped at
 * LB_MAX_RETRIES (3); non-transient statuses (404/401) return immediately; the
 * final Response is returned even after exhausted retries so callers keep their
 * own non-OK handling. Fake timers keep the backoff from slowing the suite.
 */

const { lbRequest } = require('../../sync-providers/listenbrainz');

function res(status, headers = {}) {
  const low = {};
  for (const [k, v] of Object.entries(headers)) low[k.toLowerCase()] = v;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => (h.toLowerCase() in low ? low[h.toLowerCase()] : null) },
    text: async () => '',
    json: async () => ({}),
  };
}

describe('lbRequest retry-with-backoff (#868)', () => {
  let origFetch;
  beforeEach(() => { jest.useFakeTimers(); origFetch = global.fetch; });
  afterEach(() => { jest.useRealTimers(); global.fetch = origFetch; });

  test('returns immediately on 2xx (no retry)', async () => {
    global.fetch = jest.fn().mockResolvedValue(res(200));
    const p = lbRequest('/1/x', 'tok');
    await jest.runAllTimersAsync();
    expect((await p).status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('retries on 429 honoring Retry-After, then succeeds', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(res(429, { 'Retry-After': '1' }))
      .mockResolvedValueOnce(res(200));
    const p = lbRequest('/1/x', 'tok');
    await jest.runAllTimersAsync();
    expect((await p).status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('retries on 503 with exponential backoff, then succeeds', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(res(503))
      .mockResolvedValueOnce(res(503))
      .mockResolvedValueOnce(res(200));
    const p = lbRequest('/1/x', 'tok');
    await jest.runAllTimersAsync();
    expect((await p).status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  test('gives up after LB_MAX_RETRIES (3) and returns the final 429', async () => {
    global.fetch = jest.fn().mockResolvedValue(res(429, { 'Retry-After': '1' }));
    const p = lbRequest('/1/x', 'tok');
    await jest.runAllTimersAsync();
    expect((await p).status).toBe(429);
    expect(global.fetch).toHaveBeenCalledTimes(4); // initial + 3 retries
  });

  test('does NOT retry a non-transient 404 (caller handles remote-deleted)', async () => {
    global.fetch = jest.fn().mockResolvedValue(res(404));
    const p = lbRequest('/1/x', 'tok');
    await jest.runAllTimersAsync();
    expect((await p).status).toBe(404);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('does NOT retry a 401 (auth failure surfaces to caller)', async () => {
    global.fetch = jest.fn().mockResolvedValue(res(401));
    const p = lbRequest('/1/x', 'tok');
    await jest.runAllTimersAsync();
    expect((await p).status).toBe(401);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('retries network errors, then re-throws after max retries', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    const p = lbRequest('/1/x', 'tok').catch((e) => e);
    await jest.runAllTimersAsync();
    const out = await p;
    expect(out).toBeInstanceOf(Error);
    expect(out.message).toBe('ECONNRESET');
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  test('sends Token auth + serializes object body', async () => {
    global.fetch = jest.fn().mockResolvedValue(res(200));
    const p = lbRequest('/1/playlist/create', 'mytoken', { method: 'POST', body: { a: 1 } });
    await jest.runAllTimersAsync();
    await p;
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toContain('/1/playlist/create');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Token mytoken');
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
  });
});

describe('playlist visibility', () => {
  const { playlistStatus, setPlaylistPublic } = require('../../sync-providers/listenbrainz');
  const KEY = 'https://musicbrainz.org/doc/jspf#playlist';
  const body = (ext) => ({ playlist: { title: 'P', extension: { [KEY]: ext } } });
  const reply = (status, json = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => JSON.stringify(json), json: async () => json });
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  describe('playlistStatus', () => {
    test('a public playlist', async () => {
      global.fetch = jest.fn(async () => reply(200, body({ public: true })));
      await expect(playlistStatus('mbid', 'tok')).resolves.toEqual({ exists: true, isPublic: true });
    });

    test('a private playlist', async () => {
      global.fetch = jest.fn(async () => reply(200, body({ public: false })));
      await expect(playlistStatus('mbid', 'tok')).resolves.toEqual({ exists: true, isPublic: false });
    });

    test('exists with no visibility field is unknown visibility, not private', async () => {
      global.fetch = jest.fn(async () => reply(200, { playlist: { title: 'P' } }));
      await expect(playlistStatus('mbid', 'tok')).resolves.toEqual({ exists: true, isPublic: null });
    });

    test('gone only on a 404', async () => {
      global.fetch = jest.fn(async () => reply(404));
      await expect(playlistStatus('mbid', 'tok')).resolves.toEqual({ exists: false, isPublic: null });
    });

    test('unknown on any other answer', async () => {
      global.fetch = jest.fn(async () => reply(401));
      await expect(playlistStatus('mbid', 'tok')).resolves.toEqual({ exists: null, isPublic: null });
    });
  });

  describe('setPlaylistPublic', () => {
    const sentBody = () => JSON.parse(global.fetch.mock.calls.find((c) => c[1]?.method === 'POST')[1].body);

    // ListenBrainz rebuilds collaborators from the edit's extension: leaving
    // them out silently removes everyone.
    test('sends the visibility and keeps the collaborators', async () => {
      global.fetch = jest.fn(async (url, opts) => (opts?.method === 'POST' ? reply(200, { status: 'ok' }) : reply(200, body({ public: false, collaborators: ['ana', 'bo'] }))));
      await setPlaylistPublic('mbid', true, 'tok');
      expect(global.fetch.mock.calls.find((c) => c[1]?.method === 'POST')[0]).toContain('/1/playlist/edit/mbid');
      expect(sentBody()).toEqual({ playlist: { extension: { [KEY]: { public: true, collaborators: ['ana', 'bo'] } } } });
    });

    test('sends no title or description, so they stay as they are', async () => {
      global.fetch = jest.fn(async (url, opts) => (opts?.method === 'POST' ? reply(200, {}) : reply(200, body({ public: false }))));
      await setPlaylistPublic('mbid', true, 'tok');
      expect(Object.keys(sentBody().playlist)).toEqual(['extension']);
      expect(sentBody().playlist.extension[KEY].collaborators).toEqual([]);
    });

    test('edits nothing if it cannot read the current collaborators', async () => {
      global.fetch = jest.fn(async () => reply(401));
      await expect(setPlaylistPublic('mbid', true, 'tok')).rejects.toThrow('401');
      expect(global.fetch.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(false);
    });

    test('throws when the edit is refused', async () => {
      global.fetch = jest.fn(async (url, opts) => (opts?.method === 'POST' ? reply(403, { error: 'no' }) : reply(200, body({ public: false }))));
      await expect(setPlaylistPublic('mbid', true, 'tok')).rejects.toThrow('403');
    });
  });
});
