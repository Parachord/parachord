/**
 * Seeking a Spotify Connect track: the playbar, a restored queue's resume
 * (#1319, through handleSeek) and the MCP/DJ seek tool.
 *
 * - lib/spotify-seek.js sends the Web API seek, with one retry after a token
 *   refresh (401) and one after "no active device" (404).
 * - The renderer's 5 s poll ignores progress from a request sent before the
 *   seek landed (spotifyPollPredatesSeek), so the bar doesn't jump back.
 * - The main-process poller retimes its end-of-track check (#1300) from the
 *   seek position (seekRecheckPlan), so a seek forward near the end can't let
 *   the album's next track start.
 */
const fs = require('fs');
const path = require('path');

const {
  SPOTIFY_SEEK_URL,
  SPOTIFY_SEEK_SETTLE_MS,
  spotifySeekPositionMs,
  spotifySeekUrl,
  seekSpotify,
  spotifyPollPredatesSeek,
} = require('../../src/renderer/lib/spotify-seek');
const {
  END_CHECK_LEAD_MS,
  SEEK_SETTLE_POLL_MS,
  SEEK_MIN_RECHECK_MS,
  seekRecheckPlan,
} = require('../../spotify-startup-grace');

const res = (status) => ({ status, ok: status >= 200 && status < 300 });

describe('spotifySeekUrl', () => {
  test('sends the position in whole milliseconds', () => {
    expect(spotifySeekUrl(83.4567)).toBe(`${SPOTIFY_SEEK_URL}?position_ms=83457`);
    expect(SPOTIFY_SEEK_URL).toBe('https://api.spotify.com/v1/me/player/seek');
  });

  test('a negative, missing or non-numeric position seeks to the start', () => {
    expect(spotifySeekPositionMs(-3)).toBe(0);
    expect(spotifySeekPositionMs(undefined)).toBe(0);
    expect(spotifySeekPositionMs('abc')).toBe(0);
    expect(spotifySeekPositionMs(NaN)).toBe(0);
  });
});

describe('seekSpotify', () => {
  const wait = jest.fn().mockResolvedValue();
  beforeEach(() => wait.mockClear());

  test('PUTs the seek with the token', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(res(204));
    const result = await seekSpotify({ positionSec: 42, token: 'tok', fetchImpl, wait });
    expect(result).toEqual({ ok: true, status: 204 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(`${SPOTIFY_SEEK_URL}?position_ms=42000`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer tok' },
    });
  });

  test('with no token it sends nothing', async () => {
    const fetchImpl = jest.fn();
    const result = await seekSpotify({ positionSec: 42, token: null, fetchImpl, wait });
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('a 401 refreshes the token and retries once', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(res(401)).mockResolvedValueOnce(res(204));
    const refreshToken = jest.fn().mockResolvedValue('fresh');
    const result = await seekSpotify({ positionSec: 10, token: 'old', refreshToken, fetchImpl, wait });
    expect(result.ok).toBe(true);
    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh');
  });

  test('a 404 (device still waking) waits and retries once', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(res(404)).mockResolvedValueOnce(res(204));
    const result = await seekSpotify({ positionSec: 10, token: 'tok', fetchImpl, wait });
    expect(result.ok).toBe(true);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('a refusal is reported, not thrown, and not retried past one 404', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(res(404));
    expect(await seekSpotify({ positionSec: 10, token: 'tok', fetchImpl, wait })).toEqual({ ok: false, status: 404 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const forbidden = jest.fn().mockResolvedValue(res(403));
    expect(await seekSpotify({ positionSec: 10, token: 'tok', fetchImpl: forbidden, wait })).toEqual({ ok: false, status: 403 });
    expect(forbidden).toHaveBeenCalledTimes(1);
  });

  test('a network error is reported, not thrown', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('Failed to fetch'));
    expect(await seekSpotify({ positionSec: 10, token: 'tok', fetchImpl, wait })).toEqual({ ok: false, error: 'Failed to fetch' });
  });
});

describe('spotifyPollPredatesSeek', () => {
  test('with no seek, every poll counts', () => {
    expect(spotifyPollPredatesSeek({ requestedAt: 1000, lastSeekAt: 0 })).toBe(false);
  });

  test('a poll sent before the seek, or while it settles, is ignored', () => {
    expect(spotifyPollPredatesSeek({ requestedAt: 5000, lastSeekAt: 6000 })).toBe(true);
    expect(spotifyPollPredatesSeek({ requestedAt: 6000 + SPOTIFY_SEEK_SETTLE_MS - 1, lastSeekAt: 6000 })).toBe(true);
  });

  test('a poll sent after the seek settled counts', () => {
    expect(spotifyPollPredatesSeek({ requestedAt: 6000 + SPOTIFY_SEEK_SETTLE_MS, lastSeekAt: 6000 })).toBe(false);
  });
});

describe('seekRecheckPlan (the poller after a seek)', () => {
  const POLL = 20000;
  const base = { durationMs: 200000, isPlaying: true, confirmed: true, pollIntervalMs: POLL };

  test('a seek forward to near the end polls just before the new end', () => {
    expect(seekRecheckPlan({ ...base, positionMs: 190000 })).toEqual({ action: 'poll', delayMs: 10000 - END_CHECK_LEAD_MS });
  });

  test('a seek back, far from the end, clears the old check (the regular poll comes first)', () => {
    expect(seekRecheckPlan({ ...base, positionMs: 30000 })).toEqual({ action: 'clear' });
  });

  test('a seek into the last moments polls soon, but not before the seek can be read', () => {
    expect(seekRecheckPlan({ ...base, positionMs: 199500 })).toEqual({ action: 'poll', delayMs: SEEK_MIN_RECHECK_MS });
    expect(seekRecheckPlan({ ...base, positionMs: 250000 })).toEqual({ action: 'poll', delayMs: SEEK_MIN_RECHECK_MS });
  });

  test('paused: no end check', () => {
    expect(seekRecheckPlan({ ...base, positionMs: 190000, isPlaying: false })).toEqual({ action: 'clear' });
  });

  test('before startup is confirmed, the startup ticks handle it', () => {
    expect(seekRecheckPlan({ ...base, positionMs: 190000, confirmed: false })).toEqual({ action: 'none' });
  });

  test('with no known duration, one poll once the seek settles', () => {
    expect(seekRecheckPlan({ ...base, durationMs: 0, positionMs: 60000 })).toEqual({ action: 'poll', delayMs: SEEK_SETTLE_POLL_MS });
  });
});

describe('the wiring', () => {
  const root = path.join(__dirname, '../..');
  const app = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');

  const handleSeek = app.slice(
    app.indexOf('const handleSeek = useCallback(async (newPosition) => {'),
    app.indexOf('const formatTimeAgo = ')
  );

  test('handleSeek no longer refuses Spotify; it sends one debounced seek per drag', () => {
    expect(handleSeek).not.toMatch(/seeking not supported for Spotify/);
    expect(handleSeek).toMatch(/if \(activeResolver === 'spotify'\) \{/);
    expect(handleSeek).toMatch(/spotifySeekTimerRef\.current = setTimeout\(\(\) => \{\s*spotifySeekTimerRef\.current = null;\s*seekSpotifyTo\(newPosition\);\s*\}, SPOTIFY_SEEK_DEBOUNCE_MS\);/);
    // the bar holds the dragged position: interpolation restarts from it
    expect(handleSeek).toMatch(/spotifyProgressBaselineRef\.current = \{ progress: newPosition, timestamp: Date\.now\(\)/);
  });

  test('the seek bar is enabled for Spotify', () => {
    expect(app).not.toMatch(/Seeking not available for Spotify tracks/);
    expect(app).toMatch(/const isSeekDisabled = !currentTrack \|\| browserPlaybackActive;/);
  });

  test('seekSpotifyTo tells the main-process poller once Spotify accepted the seek', () => {
    const fn = app.slice(app.indexOf('const seekSpotifyTo = async (positionSec) => {'));
    const body = fn.slice(0, fn.indexOf('\n  };\n'));
    expect(body).toMatch(/await seekSpotify\(\{/);
    expect(body.indexOf('if (!result.ok)')).toBeLessThan(body.indexOf('window.electron?.spotify?.polling?.seeked'));
    expect(body).toMatch(/positionMs: Math\.round\(positionSec \* 1000\)/);
  });

  test("the renderer poll keeps a seek's baseline over a stale answer", () => {
    expect(app).toMatch(/if \(spotifyPollPredatesSeek\(\{ requestedAt, lastSeekAt: spotifyLastSeekAtRef\.current \}\)\) \{/);
  });

  test('the MCP/DJ seek reports Spotify as seekable', () => {
    expect(app).not.toMatch(/spotify seek not supported/);
    expect(app).toMatch(/return \{ success: true, supported: true, position_ms: Math\.round\(spotifySec \* 1000\) \};/);
  });

  test('main exposes the seek to the poller, which retimes the end check', () => {
    expect(preload).toMatch(/seeked: \(params\) => ipcRenderer\.invoke\('spotify-polling-seeked', params\)/);
    expect(main).toMatch(/ipcMain\.handle\('spotify-polling-seeked', async \(event, params\) => \{\s*spotifyPoller\.seeked\(params \|\| \{\}\);/);
    const seeked = main.slice(main.indexOf('  seeked({ positionMs, durationMs, isPlaying } = {}) {'), main.indexOf('  pollSoon(delay) {'));
    expect(seeked).toMatch(/const plan = seekRecheckPlan\(\{/);
    expect(seeked).toMatch(/if \(plan\.action === 'poll'\) this\.pollSoon\(plan\.delayMs\);\s*else if \(plan\.action === 'clear'\) this\.clearEndCheck\(\);/);
    expect(seeked).toMatch(/this\.lastProgressMs = pos;/);
  });
});
