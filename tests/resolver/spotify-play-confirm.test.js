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
function mockSpotify({ device, playStatuses = [204], playerStates }) {
  const calls = [];
  let playIdx = 0;
  let stateIdx = 0;
  global.fetch = jest.fn(async (url, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push(`${method} ${url.replace('https://api.spotify.com/v1', '')}`);
    if (url.endsWith('/me/player/devices')) return json(200, { devices: [device] });
    if (url.includes('/me/player/play')) return json(playStatuses[Math.min(playIdx++, playStatuses.length - 1)]);
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
