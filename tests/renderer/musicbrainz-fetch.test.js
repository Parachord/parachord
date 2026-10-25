/**
 * MusicBrainz retry timing and error wording (2026-10 MetaBrainz outage:
 * 503s with Retry-After: 0, dropped TLS handshakes, and an artist page that
 * blamed the user's internet connection).
 */

const { mbFetchWithRetries, mbRetryDelayMs, isNetworkFailure, describeMusicBrainzError } = require('../../src/renderer/lib/musicbrainz-fetch');

const typeError = (message) => Object.assign(new TypeError(message));

const response = (status, retryAfter) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: (h) => (h.toLowerCase() === 'retry-after' && retryAfter !== undefined ? String(retryAfter) : null) },
});

// A doFetch that plays a script: each step is a status number, a
// [status, retryAfter] pair, or an error to throw (DOMException is not an
// Error subclass under Node, so anything else that is an object is thrown).
const scripted = (steps) => {
  const calls = [];
  const doFetch = jest.fn(async (init) => {
    calls.push(init);
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (Array.isArray(step)) return response(...step);
    if (step && typeof step === 'object') throw step;
    return response(step);
  });
  return { doFetch, calls };
};

describe('mbFetchWithRetries', () => {
  const sleeps = [];
  const sleep = async (ms) => { sleeps.push(ms); };
  beforeEach(() => { sleeps.length = 0; });

  test('returns the first non-throttled response', async () => {
    const { doFetch } = scripted([[503, 0], 200]);
    const resp = await mbFetchWithRetries(doFetch, {}, { sleep });
    expect(resp.status).toBe(200);
    expect(sleeps).toEqual([1000]);
  });

  test('Retry-After: 0 still backs off between attempts, then throws mbThrottled', async () => {
    const { doFetch } = scripted([[503, 0]]);
    await expect(mbFetchWithRetries(doFetch, {}, { sleep })).rejects.toMatchObject({ mbThrottled: true, status: 503 });
    expect(doFetch).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  test('a dropped connection is retried, then rethrown with mbUnreachable', async () => {
    const { doFetch } = scripted([typeError('Failed to fetch')]);
    const err = await mbFetchWithRetries(doFetch, {}, { sleep }).catch(e => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(err.mbUnreachable).toBe(true);
    expect(doFetch).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  test('a dropped connection that recovers returns the response', async () => {
    const { doFetch } = scripted([typeError('Failed to fetch'), 200]);
    expect((await mbFetchWithRetries(doFetch, {}, { sleep })).status).toBe(200);
  });

  test('a POST is not retried after a dropped connection', async () => {
    const { doFetch } = scripted([typeError('Failed to fetch'), 200]);
    await expect(mbFetchWithRetries(doFetch, { method: 'POST' }, { sleep })).rejects.toThrow('Failed to fetch');
    expect(doFetch).toHaveBeenCalledTimes(1);
  });

  test('aborts and code errors are not retried', async () => {
    const abort = scripted([new DOMException('Aborted', 'AbortError')]);
    await expect(mbFetchWithRetries(abort.doFetch, {}, { sleep })).rejects.toMatchObject({ name: 'AbortError' });
    expect(abort.doFetch).toHaveBeenCalledTimes(1);
    const bug = scripted([typeError('x.fetchThing is not a function')]);
    await expect(mbFetchWithRetries(bug.doFetch, {}, { sleep })).rejects.toThrow('is not a function');
    expect(bug.doFetch).toHaveBeenCalledTimes(1);
  });

  test('other error statuses are returned, not retried', async () => {
    const { doFetch } = scripted([404]);
    expect((await mbFetchWithRetries(doFetch, {}, { sleep })).status).toBe(404);
    expect(doFetch).toHaveBeenCalledTimes(1);
  });

  test('an already-aborted caller signal stops before fetching', async () => {
    const { doFetch } = scripted([200]);
    const controller = new AbortController();
    controller.abort();
    await expect(mbFetchWithRetries(doFetch, { signal: controller.signal }, { sleep })).rejects.toMatchObject({ name: 'AbortError' });
    expect(doFetch).not.toHaveBeenCalled();
  });

  test('queuedTimeoutMs arms a fresh signal on each attempt', async () => {
    const { doFetch, calls } = scripted([[503, 0], 200]);
    await mbFetchWithRetries(doFetch, {}, { sleep, queuedTimeoutMs: 5000 });
    expect(calls[0].signal).toBeDefined();
    expect(calls[1].signal).toBeDefined();
    expect(calls[0].signal).not.toBe(calls[1].signal);
  });
});

describe('mbRetryDelayMs', () => {
  test('exponential backoff without a header: 1s, 2s, 4s, capped', () => {
    expect([1, 2, 3, 4].map(a => mbRetryDelayMs(null, a))).toEqual([1000, 2000, 4000, 4000]);
  });

  test('Retry-After: 0 does not cancel the backoff', () => {
    expect(mbRetryDelayMs('0', 1)).toBe(1000);
    expect(mbRetryDelayMs('0', 2)).toBe(2000);
  });

  test('a longer Retry-After is honoured, up to 8s', () => {
    expect(mbRetryDelayMs('3', 1)).toBe(3000);
    expect(mbRetryDelayMs('60', 1)).toBe(8000);
  });

  test('a shorter Retry-After does not shorten the backoff', () => {
    expect(mbRetryDelayMs('1', 3)).toBe(4000);
  });

  test('junk headers fall back to the backoff', () => {
    expect(mbRetryDelayMs('soon', 2)).toBe(2000);
    expect(mbRetryDelayMs('-5', 1)).toBe(1000);
    expect(mbRetryDelayMs(undefined, 1)).toBe(1000);
  });
});

describe('isNetworkFailure', () => {
  test.each([
    'Failed to fetch',
    'NetworkError when attempting to fetch resource.',
    'Load failed',
    'Network error',
  ])('"%s" is a network failure', (message) => {
    expect(isNetworkFailure(typeError(message))).toBe(true);
  });

  test('a code bug that mentions fetch is not a network failure', () => {
    expect(isNetworkFailure(typeError('fetchArtistFromSpotify is not a function'))).toBe(false);
    expect(isNetworkFailure(typeError("Cannot read properties of undefined (reading 'fetch')"))).toBe(false);
  });

  test('only TypeErrors count', () => {
    expect(isNetworkFailure(new Error('Failed to fetch'))).toBe(false);
    expect(isNetworkFailure(null)).toBe(false);
  });
});

describe('describeMusicBrainzError', () => {
  test('a dropped connection names MusicBrainz, not the user\'s connection', () => {
    const msg = describeMusicBrainzError(typeError('Failed to fetch'));
    expect(msg).toMatch(/Couldn't reach MusicBrainz/);
    expect(msg).not.toMatch(/internet connection/i);
  });

  test('the wrapper\'s exhausted-retry flags', () => {
    expect(describeMusicBrainzError(Object.assign(new Error('MusicBrainz throttled (HTTP 503)'), { mbThrottled: true })))
      .toMatch(/busy/);
    expect(describeMusicBrainzError(Object.assign(typeError('Failed to fetch'), { mbUnreachable: true })))
      .toMatch(/Couldn't reach MusicBrainz/);
  });

  test('offline wins: then it is the user\'s connection', () => {
    expect(describeMusicBrainzError(typeError('Failed to fetch'), { online: false })).toMatch(/offline/);
  });

  test('a timeout says so', () => {
    expect(describeMusicBrainzError(new DOMException('Aborted', 'AbortError'))).toMatch(/too long/);
  });

  test('anything else keeps its own message', () => {
    expect(describeMusicBrainzError(typeError('fetchArtistFromSpotify is not a function')))
      .toBe('Error: fetchArtistFromSpotify is not a function');
    expect(describeMusicBrainzError(undefined)).toBe('Something went wrong. Please try again.');
  });
});
