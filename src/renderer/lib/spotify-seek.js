// Seeking a Spotify Connect track from the playbar, a restored queue's
// resume (#1319) and the MCP/DJ `seek` tool.
//
// Spotify plays in an external client, so a seek is one Web API call,
// `PUT /v1/me/player/seek?position_ms=…`, on the active device. The playbar's
// range input fires on every drag movement, so the caller sends only the
// settled position (SPOTIFY_SEEK_DEBOUNCE_MS after the last movement).
//
// Pure (fetch and the wait are injected) so it can be tested without Electron.

const SPOTIFY_SEEK_URL = 'https://api.spotify.com/v1/me/player/seek';

// Trailing debounce for the playbar's drag: one request per gesture.
const SPOTIFY_SEEK_DEBOUNCE_MS = 250;

// How long after a seek a renderer poll of /v1/me/player may still report
// the old position (the request went out before Spotify applied the seek).
const SPOTIFY_SEEK_SETTLE_MS = 2000;

// A 404 is Spotify's "no active device": the device is still waking up after
// a play (a restored queue seeks half a second after it starts). One retry.
const SPOTIFY_SEEK_RETRY_DELAY_MS = 1000;

function spotifySeekPositionMs(positionSec) {
  const n = Number(positionSec);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : 0;
}

function spotifySeekUrl(positionSec) {
  return `${SPOTIFY_SEEK_URL}?position_ms=${spotifySeekPositionMs(positionSec)}`;
}

const defaultWait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Returns { ok, status?, error? }. Never throws.
async function seekSpotify({
  positionSec,
  token,
  refreshToken,
  fetchImpl = (typeof fetch === 'function' ? fetch : null),
  wait = defaultWait,
} = {}) {
  if (!token) return { ok: false, error: 'spotify not connected' };
  if (typeof fetchImpl !== 'function') return { ok: false, error: 'fetch unavailable' };
  const url = spotifySeekUrl(positionSec);
  const send = (t) => fetchImpl(url, { method: 'PUT', headers: { Authorization: `Bearer ${t}` } });
  try {
    let t = token;
    let res = await send(t);
    if (res.status === 401 && typeof refreshToken === 'function') {
      const fresh = await refreshToken();
      if (fresh) {
        t = fresh;
        res = await send(t);
      }
    }
    if (res.status === 404) {
      await wait(SPOTIFY_SEEK_RETRY_DELAY_MS);
      res = await send(t);
    }
    return { ok: !!res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: (err && err.message) || String(err) };
  }
}

// A renderer poll of /v1/me/player whose request went out before a seek was
// applied (or just after it) reports the old position; its progress would
// pull the bar back. True when that poll's progress should be ignored.
function spotifyPollPredatesSeek({ requestedAt, lastSeekAt, settleMs = SPOTIFY_SEEK_SETTLE_MS }) {
  if (!(lastSeekAt > 0)) return false;
  return requestedAt < lastSeekAt + settleMs;
}

module.exports = {
  SPOTIFY_SEEK_URL,
  SPOTIFY_SEEK_DEBOUNCE_MS,
  SPOTIFY_SEEK_SETTLE_MS,
  SPOTIFY_SEEK_RETRY_DELAY_MS,
  spotifySeekPositionMs,
  spotifySeekUrl,
  seekSpotify,
  spotifyPollPredatesSeek,
};
