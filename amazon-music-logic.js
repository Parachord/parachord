// Pure helpers for the Amazon Music resolver. Kept out of main.js so the
// review fixes (wrong-ASIN play, empty-string match, seek-vs-end, duration
// units, sign-in page detection) can be tested without Electron.

// The <video> element reports duration in seconds; the poller stores
// milliseconds. Search-result duration is seconds and is converted by the
// poller (`duration * 1000`), not here. Do not guess: a "< 1000 means
// seconds" heuristic turns a 20-minute track reported in seconds into 1.2s,
// and a short ms value into a multi-minute one.
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

// Hornet keeps the playbackController in a Metro module; window.__r is the
// only handle, and Amazon redeploys hornet continuously, renumbering modules
// on every bundle change. Executing module factories to find it (require-by-
// id scans) runs Amazon's code out of order and can wedge the whole page —
// observed live: a renderer pegged in V8 churn with every Amazon call hanging.
// So never call __r ourselves. Instead install a trap before the bundle runs:
// when Amazon's own code requires the module, the wrapper observes the exports
// and captures the store. Self-contained by design — serialized with
// .toString() and evaluated inside the Amazon page (world 0), so it must not
// close over anything in this module.
function installAmazonRequireTrap(scope) {
  if (scope.__parachordRequireTrap) return;
  scope.__parachordRequireTrap = true;
  let current = null;
  const consider = (mod, id) => {
    try {
      const pc = mod && mod.playbackController;
      if (pc && pc.audioQualitySettings) {
        scope.__parachordAmazonPlayback = pc;
        scope.__parachordAmazonPlaybackModuleId = id;
      }
    } catch (e) {}
  };
  const wrap = (require) => {
    if (typeof require !== 'function' || require.__parachordWrapped) return require;
    const wrapped = function () {
      const mod = require.apply(this, arguments);
      consider(mod, arguments[0]);
      return mod;
    };
    // Keep require's own properties (e.g. metro's require.async) reachable
    // through the wrapper.
    try { Object.setPrototypeOf(wrapped, require); } catch (e) {}
    try { Object.defineProperty(wrapped, '__parachordWrapped', { value: true }); } catch (e) {}
    return wrapped;
  };
  try {
    // The bundle exposes __r as a global assignment, which routes through the
    // setter; a var declaration in a later script leaves the property alone.
    // If __r was already assigned before the trap installs, wrap that value.
    if (typeof scope.__r === 'function') current = wrap(scope.__r);
    Object.defineProperty(scope, '__r', {
      configurable: true,
      get() { return current; },
      set(v) { current = wrap(v); return current; }
    });
  } catch (e) {}
}

// Hornet persists the playbackController store to a localStorage entry whose
// key contains 'playback-controller' and rehydrates audioQualitySettings from
// it at boot — its persistence reaction misses nested changes while nothing
// plays, so quality writes go to both the live store and this entry. Both
// helpers take the page's localStorage so they can run inside the page world
// and be unit tested against a plain object. Self-contained by design, same
// as installAmazonRequireTrap.
function readPersistedQuality(storage) {
  try {
    const key = Object.keys(storage).find(k => k.indexOf('playback-controller') !== -1);
    if (!key) return null;
    const parsed = JSON.parse(storage.getItem(key));
    const s = parsed && parsed.data && parsed.data.audioQualitySettings;
    if (!s) return null;
    return { streamingQuality: s.streamingQuality || null, abrEnabled: !!s.abrEnabled };
  } catch (e) { return null; }
}

function writePersistedQuality(storage, settings) {
  try {
    const key = Object.keys(storage).find(k => k.indexOf('playback-controller') !== -1);
    if (!key) return false;
    const parsed = JSON.parse(storage.getItem(key));
    if (!parsed || !parsed.data) return false;
    const patch = {};
    if (settings && settings.streamingQuality != null) patch.streamingQuality = settings.streamingQuality;
    if (settings && settings.abrEnabled != null) patch.abrEnabled = !!settings.abrEnabled;
    parsed.data.audioQualitySettings = Object.assign({}, parsed.data.audioQualitySettings, patch);
    storage.setItem(key, JSON.stringify(parsed));
    return true;
  } catch (e) { return false; }
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

// The poller compares this to the ASIN we asked to play. Echoing that
// requested ASIN makes the track-changed branch unreachable: a page that
// moved on, or a mini player showing a different track, still looks like
// the track we loaded. Never fill a missing read with the expected ASIN.
function reportedPlaybackAsin(state) {
  if (!state) return null;
  return state.playingAsin || asinFromPlayerUrl(state.playingHref) || asinFromPlayerUrl(state.href) || null;
}

// Playback failure must not reveal the player. Sign-in is the only window.
// A run of unplayable radio tracks used to show and focus the page.
function shouldRevealPlayerOnFailure() {
  return false;
}

function isAmazonPlayerChrome(testIds) {
  return /miniplayer|nowplaying|playbacktransport/i.test((testIds || []).join(' '));
}

function isAmazonSearchTrackLink(testId) {
  const id = testId || '';
  if (isAmazonPlayerChrome([id])) return false;
  return /searchresults/i.test(id);
}

// A loose "Stations Warning" search misses the song. Amazon's songs tab
// with both terms quoted does not: /search/"stations" "Warning"/songs.
function amazonSongSearchUrl({ title, artist, query, songs } = {}) {
  const quote = (value) => '"' + String(value || '').replace(/"/g, '').trim() + '"';
  let q = '';
  let songsOnly = !!songs;
  if ((title && String(title).trim()) || (artist && String(artist).trim())) {
    const parts = [];
    if (title && String(title).trim()) parts.push(quote(title));
    if (artist && String(artist).trim()) parts.push(quote(artist));
    q = parts.join(' ');
    songsOnly = true;
  } else {
    q = String(query || '').trim();
  }
  if (!q) return null;
  return 'https://music.amazon.com/search/' + encodeURIComponent(q) + (songsOnly ? '/songs' : '');
}

// The songs tab does not use SearchResultsWidget. Its rows are
// <button data-testid="HorizontalItem,undefined">. The general search
// page uses HorizontalItem,SearchResultsWidget_Item. Mini-player chrome
// is not a HorizontalItem.
function isAmazonSongResultItem(testId) {
  const id = testId || '';
  if (!/^HorizontalItem,/i.test(id)) return false;
  return !isAmazonPlayerChrome([id]);
}

function acceptAmazonSearchAnchor(testIds, onSearchPage) {
  if (isAmazonPlayerChrome(testIds)) return false;
  if (/searchresults|topresults/i.test((testIds || []).join(' '))) return true;
  return !!onSearchPage;
}

module.exports = {
  reportedPlaybackAsin,
  shouldRevealPlayerOnFailure,
  playerDurationMs,
  decidePollAdvance,
  shouldPollFaster,
  pageBlocksPlayback,
  isNotReadyReason,
  AMAZON_QUALITY_OPTIONS,
  normalizeStreamingQuality,
  installAmazonRequireTrap,
  readPersistedQuality,
  writePersistedQuality,
  isAmazonSearchTrackLink,
  isAmazonPlayerChrome,
  amazonSongSearchUrl,
  isAmazonSongResultItem,
  acceptAmazonSearchAnchor,
  asinFromPlayerUrl,
  NEAR_END_MS,
  WRAP_POSITION_MS,
  FAST_POLL_REMAINING_MS
};
