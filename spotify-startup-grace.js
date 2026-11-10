// Startup grace for the main-process Spotify poller (parachord#985).
//
// A 204 from `PUT /me/player/play` only means Spotify accepted the command.
// On some clients (the Windows desktop app in particular) the device takes a
// few seconds to actually become active. During that window `GET /me/player`
// answers 204 (no active device), returns no item, or still reports the
// previous track. The poller used to read any of those on its very first
// check as "track over" and advance, which skipped every track in silence.
//
// Until the expected track is seen playing, or the grace window runs out,
// those answers mean "still starting", not "finished". Pure so it can be
// unit-tested without Electron.

const STARTUP_GRACE_MS = 10000;
const STARTUP_POLL_INTERVAL_MS = 2000;

// Spotify can relink a track to a market-specific copy, in which case the
// player reports the relinked URI and the requested one under linked_from.
function matchesExpectedTrack(item, expectedUri) {
  if (!item || !expectedUri) return false;
  return item.uri === expectedUri || (!!item.linked_from && item.linked_from.uri === expectedUri);
}

// Returns:
//   'confirmed' — the expected track is playing; startup is over
//   'wait'      — still inside the grace window and not confirmed; don't act
//   'evaluate'  — apply the normal end-of-track / track-changed logic
function startupPollVerdict({ status, data, expectedUri, elapsedMs, confirmed, graceMs = STARTUP_GRACE_MS }) {
  if (confirmed) return 'evaluate';
  if (status === 200 && data && data.is_playing && matchesExpectedTrack(data.item, expectedUri)) {
    return 'confirmed';
  }
  if (elapsedMs < graceMs) return 'wait';
  return 'evaluate';
}

// End check (parachord#1300). Tracks are started inside their album, so when
// ours ends Spotify carries on into the album's next track instead of
// stopping. The regular poll is 20s apart and would let that track play for
// up to 20s, so when the end falls before the next regular poll, one extra
// poll is timed to land END_CHECK_LEAD_MS before it, inside the poller's 2s
// near-end window, which advances to the queue's next track.
//
// Returns the delay for that poll, or null when the regular poll comes first
// (it schedules the check itself when its turn comes).
const END_CHECK_LEAD_MS = 1500;

function endCheckDelayMs(remainingMs, pollIntervalMs, leadMs = END_CHECK_LEAD_MS) {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return null;
  const delay = Math.max(0, remainingMs - leadMs);
  return delay < pollIntervalMs ? delay : null;
}

module.exports = {
  STARTUP_GRACE_MS,
  STARTUP_POLL_INTERVAL_MS,
  END_CHECK_LEAD_MS,
  matchesExpectedTrack,
  startupPollVerdict,
  endCheckDelayMs,
};
