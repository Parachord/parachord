// Pure helpers for the Amazon Music resolver. Kept out of main.js so the
// review fixes (wrong-ASIN play, empty-string match, seek-vs-end, consent
// gate, duration units) can be tested without Electron.

function normalizeMatchKey(value) {
  return (value || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function containsNonEmpty(haystack, needle) {
  if (!haystack || !needle) return false;
  return haystack.includes(needle) || needle.includes(haystack);
}

// Never substitute a different ASIN when the caller asked for one. Fuzzy
// match is only for title+artist playback, and an empty field must not
// match everything (`'anything'.includes('')` is true).
function pickPlayableTrack(tracks, { asin, title, artist } = {}) {
  const list = Array.isArray(tracks) ? tracks : [];
  if (asin) {
    return list.find(t => t && t.asin === asin) || null;
  }
  const targetTitle = normalizeMatchKey(title);
  const targetArtist = normalizeMatchKey(artist);
  if (!targetTitle || !targetArtist) return null;
  return list.find(t => t &&
    containsNonEmpty(normalizeMatchKey(t.title), targetTitle) &&
    containsNonEmpty(normalizeMatchKey(t.artist), targetArtist)
  ) || null;
}

// Desktop-app playerModel duration is milliseconds (validated against
// currentPlayable.duration). Search-result duration is seconds and is
// converted by the poller (`duration * 1000`), not here. Do not guess:
// a "< 1000 means seconds" heuristic turns a 20-minute track reported in
// seconds into 1.2s, and a short ms value into a multi-minute one.
function playerDurationMs(raw) {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return 0;
  return raw;
}

// Advance only in the last poll window, not 4s early. The app's own
// autoplay wraps position to ~0; a backward seek does not.
const NEAR_END_MS = 700;
const WRAP_POSITION_MS = 2500;
const FAST_POLL_REMAINING_MS = 8000;

function decidePollAdvance({
  state,
  positionMs = 0,
  durationMs = 0,
  lastPositionMs = 0,
  lastState = null,
  expectedAsin = null,
  actualAsin = null,
  pollCount = 0,
  seekSuppress = false
} = {}) {
  if (actualAsin && expectedAsin && actualAsin !== expectedAsin) {
    if (pollCount <= 2) return { action: 'wait' };
    return { action: 'advance', reason: 'track-changed' };
  }

  if (state === 'PLAYING') {
    const remaining = durationMs > 0 ? durationMs - positionMs : Infinity;
    if (!seekSuppress && durationMs > 0 && remaining <= NEAR_END_MS && remaining >= 0) {
      return { action: 'advance', reason: 'near-end' };
    }
    const lastPercent = durationMs > 0 ? (lastPositionMs / durationMs) * 100 : 0;
    if (!seekSuppress && lastPositionMs > 5000 && positionMs < WRAP_POSITION_MS && lastPercent >= 80) {
      return { action: 'advance', reason: 'finished' };
    }
    return { action: 'continue', updateLast: true };
  }

  if (lastState === 'PLAYING' && (state === 'STOPPED' || state === 'EMPTY' || state === 'FINISHED')) {
    const lastPercent = durationMs > 0 ? (lastPositionMs / durationMs) * 100 : 0;
    const percent = durationMs > 0 ? (positionMs / durationMs) * 100 : lastPercent;
    if (lastPercent >= 90 || percent >= 90) return { action: 'advance', reason: 'finished' };
    return { action: 'advance', reason: 'stopped' };
  }

  return { action: 'track' };
}

function shouldPollFaster(durationMs, positionMs) {
  if (!durationMs || durationMs <= 0) return false;
  return durationMs - positionMs <= FAST_POLL_REMAINING_MS && durationMs - positionMs >= 0;
}

// Main-process gate for relaunching the desktop app with a debug port.
// Consent lives in the main process so a renderer (including a marketplace
// plugin) cannot open the port by calling the IPC alone.
function relaunchAllowed({ platform, consented, portOpen, force } = {}) {
  if (platform !== 'darwin') {
    return { ok: false, reason: 'unsupported-platform' };
  }
  if (portOpen && !force) return { ok: true, relaunch: false };
  if (!consented) return { ok: false, reason: 'consent-required' };
  return { ok: true, relaunch: true };
}

const NOT_READY_REASONS = new Set([
  'app-not-managed',
  'not-ready',
  'consent-required',
  'not-signed-in',
  'no-cdm',
  'unsupported-platform'
]);

function isNotReadyReason(reason) {
  return NOT_READY_REASONS.has(reason);
}

module.exports = {
  pickPlayableTrack,
  playerDurationMs,
  decidePollAdvance,
  shouldPollFaster,
  relaunchAllowed,
  isNotReadyReason,
  NEAR_END_MS,
  WRAP_POSITION_MS,
  FAST_POLL_REMAINING_MS
};
