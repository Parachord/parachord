/**
 * spotify.axe play(): a 204 from PUT /me/player/play only means Spotify
 * accepted the command. play() now confirms playback started, and sends play
 * once more if the device hasn't woken up yet (parachord#985, seen with the
 * Windows desktop app).
 */

const fs = require('fs');
const path = require('path');

const axe = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'plugins', 'spotify.axe'), 'utf8'));
const play = new Function('return ' + axe.implementation.play)();

const URI = 'spotify:track:abc';
const track = { spotifyUri: URI, title: 'Hard to Explain' };
const config = { token: 'tok' };

const json = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
  text: async () => JSON.stringify(body || {}),
});

// Scripted Spotify API. `playerStates` is consumed one GET /me/player at a time
// (the last entry repeats).
// `trackLookup` answers GET /v1/tracks/{id}: a body, or a status number.
// Play bodies are collected in `calls.bodies`.
function mockSpotify({ device, playStatuses = [204], playerStates, trackLookup = 500 }) {
  const calls = [];
  calls.bodies = [];
  let playIdx = 0;
  let stateIdx = 0;
  global.fetch = jest.fn(async (url, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push(`${method} ${url.replace('https://api.spotify.com/v1', '')}`);
    if (url.endsWith('/me/player/devices')) return json(200, { devices: [device] });
    if (url.includes('/v1/tracks/')) return typeof trackLookup === 'number' ? json(trackLookup) : json(200, trackLookup);
    if (url.includes('/me/player/play')) {
      calls.bodies.push(JSON.parse(opts.body));
      return json(playStatuses[Math.min(playIdx++, playStatuses.length - 1)]);
    }
    if (url.endsWith('/me/player') && method === 'PUT') return json(204);
    if (url.endsWith('/me/player')) {
      const s = playerStates[Math.min(stateIdx++, playerStates.length - 1)];
      return s === null ? json(204) : json(200, s);
    }
    throw new Error('unexpected ' + url);
  });
  return calls;
}

const desktop = (isActive) => ({ id: 'dev1', name: 'DESKTOP', type: 'Computer', is_active: isActive, is_restricted: false });
const playingState = (uri = URI) => ({ is_playing: true, progress_ms: 800, item: { uri } });

async function run(promise) {
  let result;
  promise.then((r) => { result = r; });
  // Advance well past the longest path (1s wake + 5s + 4s of polling).
  for (let i = 0; i < 40; i++) await jest.advanceTimersByTimeAsync(500);
  return result;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  delete global.fetch;
  delete globalThis._spotifyTrackAlbums;
});

test('active device: confirms on the first state check and sends play once', async () => {
  const calls = mockSpotify({ device: desktop(true), playerStates: [playingState()] });
  expect(await run(play(track, config))).toBe(true);
  expect(calls.filter((c) => c.startsWith('PUT /me/player/play'))).toHaveLength(1);
});

test('slow-waking device: sends play again after 5s, then confirms (#985)', async () => {
  // No active device for the first 5 seconds of checks, then playing.
  const states = Array(10).fill(null).concat([playingState()]);
  const calls = mockSpotify({ device: desktop(false), playerStates: states });
  expect(await run(play(track, config))).toBe(true);
  expect(calls.filter((c) => c.startsWith('PUT /me/player/play'))).toHaveLength(2);
  expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('playback has not started'), 'DESKTOP', expect.any(String));
});

test('ignores the previous track still being reported', async () => {
  const states = [playingState('spotify:track:previous'), playingState('spotify:track:previous'), playingState()];
  const calls = mockSpotify({ device: desktop(true), playerStates: states });
  expect(await run(play(track, config))).toBe(true);
  expect(calls.filter((c) => c.startsWith('PUT /me/player/play'))).toHaveLength(1);
});

test('accepts a relinked track via linked_from', async () => {
  const relinked = { is_playing: true, progress_ms: 500, item: { uri: 'spotify:track:relinked', linked_from: { uri: URI } } };
  mockSpotify({ device: desktop(true), playerStates: [relinked] });
  expect(await run(play(track, config))).toBe(true);
});

test('fails when the retried play is rejected', async () => {
  mockSpotify({ device: desktop(false), playStatuses: [204, 404], playerStates: [null] });
  expect(await run(play(track, config))).toBe(false);
});

test('never confirmed: still returns true and leaves it to the playback poller', async () => {
  // Avoids double audio if the state endpoint is just slow to reflect playback;
  // the main-process poller skips the track after its startup grace if nothing plays.
  const calls = mockSpotify({ device: desktop(false), playerStates: [null] });
  expect(await run(play(track, config))).toBe(true);
  expect(calls.filter((c) => c.startsWith('PUT /me/player/play'))).toHaveLength(2);
});

test('initial play rejected: fails without polling', async () => {
  const calls = mockSpotify({ device: desktop(true), playStatuses: [403], playerStates: [null] });
  expect(await run(play(track, config))).toBe(false);
  expect(calls.some((c) => c === 'GET /me/player')).toBe(false);
});

// parachord#1300: Spotify's Android app answers a bare `uris` play with 204
// and plays nothing; the track's album plus an offset plays everywhere.
describe('starts the track inside its album (#1300)', () => {
  const ALBUM_BODY = { context_uri: 'spotify:album:alb1', offset: { uri: URI } };
  const BARE_BODY = { uris: [URI] };
  const lookups = (calls) => calls.filter((c) => c.startsWith('GET /tracks/'));

  test('uses the album id the track carries, with no lookup', async () => {
    const calls = mockSpotify({ device: desktop(true), playerStates: [playingState()] });
    expect(await run(play({ ...track, spotifyAlbumId: 'alb1' }, config))).toBe(true);
    expect(calls.bodies).toEqual([ALBUM_BODY]);
    expect(lookups(calls)).toHaveLength(0);
  });

  test('looks the album up once per track, then remembers it', async () => {
    const calls = mockSpotify({ device: desktop(true), playerStates: [playingState()], trackLookup: { id: 'abc', album: { id: 'alb1' } } });
    expect(await run(play(track, config))).toBe(true);
    expect(await run(play(track, config))).toBe(true);
    expect(calls.bodies).toEqual([ALBUM_BODY, ALBUM_BODY]);
    expect(lookups(calls)).toEqual(['GET /tracks/abc']);
  });

  test('a failed lookup plays the bare track, and is not remembered', async () => {
    const calls = mockSpotify({ device: desktop(true), playerStates: [playingState()], trackLookup: 503 });
    expect(await run(play(track, config))).toBe(true);
    expect(await run(play(track, config))).toBe(true);
    expect(calls.bodies).toEqual([BARE_BODY, BARE_BODY]);
    expect(lookups(calls)).toHaveLength(2);
  });

  test('a track with no album plays bare', async () => {
    const calls = mockSpotify({ device: desktop(true), playerStates: [playingState()], trackLookup: { id: 'abc', album: null } });
    expect(await run(play(track, config))).toBe(true);
    expect(calls.bodies).toEqual([BARE_BODY]);
  });

  test('a refused album play is sent again as the bare track', async () => {
    const calls = mockSpotify({ device: desktop(true), playStatuses: [404, 204], playerStates: [playingState()] });
    expect(await run(play({ ...track, spotifyAlbumId: 'alb1' }, config))).toBe(true);
    expect(calls.bodies).toEqual([ALBUM_BODY, BARE_BODY]);
  });

  test('the #985 re-send carries the album too', async () => {
    const states = Array(10).fill(null).concat([playingState()]);
    const calls = mockSpotify({ device: desktop(false), playerStates: states });
    expect(await run(play({ ...track, spotifyAlbumId: 'alb1' }, config))).toBe(true);
    expect(calls.bodies).toEqual([ALBUM_BODY, ALBUM_BODY]);
  });

  test('a uri that is not a track id plays bare with no lookup', async () => {
    const calls = mockSpotify({ device: desktop(true), playerStates: [playingState('spotify:episode:xyz')] });
    expect(await run(play({ spotifyUri: 'spotify:episode:xyz' }, config))).toBe(true);
    expect(calls.bodies).toEqual([{ uris: ['spotify:episode:xyz'] }]);
    expect(lookups(calls)).toHaveLength(0);
  });
});

// A resumed track starts where it was (#1319): the host passes _startAt, the
// play carries position_ms, and a play that started acknowledges with
// _startedAt so the host doesn't seek there again.
describe('starts at _startAt', () => {
  const at = (body) => ({ ...body, position_ms: 141400 });

  test('the album play carries position_ms and acknowledges', async () => {
    const calls = mockSpotify({ device: desktop(true), playerStates: [playingState()] });
    const t = { ...track, spotifyAlbumId: 'alb1', _startAt: 141.4 };
    expect(await run(play(t, config))).toBe(true);
    expect(calls.bodies).toEqual([at({ context_uri: 'spotify:album:alb1', offset: { uri: URI } })]);
    expect(t._startedAt).toBe(141.4);
  });

  test('a bare play carries it, and is sent once (the album fallback still sees the bare body)', async () => {
    const calls = mockSpotify({ device: desktop(true), playStatuses: [404], playerStates: [null] });
    const t = { ...track, _startAt: 141.4 };
    expect(await run(play(t, config))).toBe(false);
    expect(calls.bodies).toEqual([at({ uris: [URI] })]);
    expect(t._startedAt).toBeUndefined();
  });

  test('a refused album play is re-sent bare with the position too', async () => {
    const calls = mockSpotify({ device: desktop(true), playStatuses: [404, 204], playerStates: [playingState()] });
    expect(await run(play({ ...track, spotifyAlbumId: 'alb1', _startAt: 141.4 }, config))).toBe(true);
    expect(calls.bodies).toEqual([at({ context_uri: 'spotify:album:alb1', offset: { uri: URI } }), at({ uris: [URI] })]);
  });

  test('no _startAt: no position_ms', async () => {
    const calls = mockSpotify({ device: desktop(true), playerStates: [playingState()] });
    expect(await run(play({ ...track, spotifyAlbumId: 'alb1' }, config))).toBe(true);
    expect(calls.bodies[0]).not.toHaveProperty('position_ms');
  });
});
