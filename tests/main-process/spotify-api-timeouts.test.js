/**
 * Every Spotify Web API request the main process makes has a timeout.
 *
 * A request on a dead connection hangs for minutes rather than failing. In the
 * poller that meant a hung poll never counted as an error, so recovery never
 * started; on quit, the pause request held the app open. Since parachord#1300
 * Spotify plays on into the album when Parachord misses a track's end, so a
 * stalled poller now costs more than a stalled progress bar.
 */
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '../../main.js'), 'utf8');

// The options object of each fetch() to api.spotify.com, up to its closing `});`.
function spotifyFetchCalls(src) {
  const calls = [];
  const re = /fetch\(\s*['`]https:\/\/api\.spotify\.com[^'`]*['`]/g;
  let m;
  while ((m = re.exec(src))) {
    const end = src.indexOf('});', m.index);
    calls.push(src.slice(m.index, end === -1 ? undefined : end + 3));
  }
  return calls;
}

describe('main-process Spotify API timeouts', () => {
  const calls = spotifyFetchCalls(source);

  test('finds the poller, recovery and quit-pause requests', () => {
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  test('every request passes a timeout signal', () => {
    for (const call of calls) {
      expect(call).toMatch(/signal:\s*AbortSignal\.timeout\(/);
    }
  });

  test('the quit pause gives up sooner than the polls', () => {
    const api = Number(source.match(/const SPOTIFY_API_TIMEOUT_MS = (\d+);/)[1]);
    const quit = Number(source.match(/const SPOTIFY_QUIT_PAUSE_TIMEOUT_MS = (\d+);/)[1]);
    expect(quit).toBeGreaterThan(0);
    expect(quit).toBeLessThanOrEqual(api);
    const pause = calls.find(c => c.includes('/v1/me/player/pause'));
    expect(pause).toContain('SPOTIFY_QUIT_PAUSE_TIMEOUT_MS');
  });
});
