// What quitting Parachord does to playback outside the app.
//
// Spotify plays in the Spotify app, not in Parachord, so quitting Parachord
// has to pause it, or it plays on with nothing in control: it finishes the
// track and carries on into the album. Two gaps let that happen
// (2026-11-14):
//   - the pause sent the stored access token without checking it, so an
//     hour after the last refresh Spotify answered 401 and played on;
//   - Ctrl+C under `npm start` killed the app partway through the quit
//     step: Electron runs the normal quit on a first SIGINT and dies on a
//     second, and electron's launcher forwarded a second one
//     (scripts/start-electron.js now launches the app instead).

'use strict';

// The whole pause step, token refresh included, must finish in this long:
// quitting waits on it, and the refresh request has no timeout of its own.
const QUIT_PAUSE_BUDGET_MS = 5000;

// pauseSpotifyOnQuit({ getToken, sendPause, budgetMs }) → outcome string.
//   getToken(force)  → a valid access token or null (main.js passes
//                      ensureValidSpotifyToken, which refreshes an expired one)
//   sendPause(token) → the fetch Response of PUT /v1/me/player/pause
// One 401 forces a refresh and retries once. Never throws: quitting goes on
// whatever Spotify says.
async function pauseSpotifyOnQuit({ getToken, sendPause, budgetMs = QUIT_PAUSE_BUDGET_MS }) {
  const attempt = async () => {
    let token = await getToken(false);
    if (!token) return 'no-token';
    let res = await sendPause(token);
    if (res && res.status === 401) {
      token = await getToken(true);
      if (!token) return 'status-401';
      res = await sendPause(token);
    }
    if (!res) return 'error';
    if (res.ok || res.status === 204) return 'paused';
    // No active device, or already paused.
    if (res.status === 403 || res.status === 404) return 'nothing-playing';
    return `status-${res.status}`;
  };
  let timer = null;
  try {
    return await Promise.race([
      attempt().catch(() => 'error'),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve('timeout'), budgetMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = { pauseSpotifyOnQuit, QUIT_PAUSE_BUDGET_MS };
