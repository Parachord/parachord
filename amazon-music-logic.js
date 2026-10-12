// Pure helpers for the Amazon Music resolver. Kept out of main.js so the
// review fixes (wrong-ASIN play, empty-string match, seek-vs-end, duration
// units, sign-in page detection) can be tested without Electron.

function normalizeMatchKey(value) {
  return (value || '')
    .toString()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
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

// Amazon's web player is not usable for search or play while it is still
// on the account sign-in page or the post-login profile picker. Cookies can
// already exist at that point; the URL is the signal that selection finished.
function pageBlocksPlayback(url) {
  const value = url || '';
  if (/\/identity\/who-is-listening/i.test(value)) return 'not-signed-in';
  if (/\/ap\/signin/i.test(value)) return 'not-signed-in';
  return null;
}

const NOT_READY_REASONS = new Set([
  'not-ready',
  'not-signed-in',
  'no-cdm'
]);

function isNotReadyReason(reason) {
  return NOT_READY_REASONS.has(reason);
}

// Hornet's Audio Quality modal. HD and BEST_AVAILABLE both mean the
// "HD/Ultra HD" radio; the modal writes BEST_AVAILABLE. Data Saver and
// Standard are the other two radios. Auto-adjust is abrEnabled, separate
// from the radio.
const AMAZON_QUALITY_OPTIONS = [
  { value: 'BEST_AVAILABLE', label: 'HD/Ultra HD' },
  { value: 'STANDARD', label: 'Standard' },
  { value: 'DATA_SAVER', label: 'Data Saver' }
];

function normalizeStreamingQuality(value) {
  if (value === 'BEST_AVAILABLE' || value === 'HD') return 'BEST_AVAILABLE';
  if (value === 'STANDARD' || value === 'DATA_SAVER') return value;
  return null;
}

// Search pages also render the mini player. Its title is a /tracks/ link
// with an artist sibling, so a scrape that accepts any track link returns
// the currently playing song before the results exist. The match gate then
// rejects that hit and the track looks unresolved.
//
// Current Amazon search rows often have no SearchResults testid on the
// anchor itself. Reject player chrome by ancestor testids; on a /search/
// page keep the rest.
function asinFromPlayerUrl(url) {
  const m = (url || '').match(/\/tracks\/([A-Z0-9]{10})/i);
  return m ? m[1].toUpperCase() : null;
}

function isAmazonPlayerChrome(testIds) {
  return /miniplayer|nowplaying|playbacktransport/i.test((testIds || []).join(' '));
}

function isAmazonSearchTrackLink(testId) {
  const id = testId || '';
  if (isAmazonPlayerChrome([id])) return false;
  return /searchresults/i.test(id);
}

function acceptAmazonSearchAnchor(testIds, onSearchPage) {
  if (isAmazonPlayerChrome(testIds)) return false;
  if (/searchresults|topresults/i.test((testIds || []).join(' '))) return true;
  return !!onSearchPage;
}

module.exports = {
  pickPlayableTrack,
  playerDurationMs,
  decidePollAdvance,
  shouldPollFaster,
  pageBlocksPlayback,
  isNotReadyReason,
  AMAZON_QUALITY_OPTIONS,
  normalizeStreamingQuality,
  isAmazonSearchTrackLink,
  isAmazonPlayerChrome,
  acceptAmazonSearchAnchor,
  asinFromPlayerUrl,
  NEAR_END_MS,
  WRAP_POSITION_MS,
  FAST_POLL_REMAINING_MS
};
