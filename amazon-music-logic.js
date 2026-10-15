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
// A page torn down while paused (element removed after the user paused via
// media keys and the page idled out) polls EMPTY with lastState PAUSED — dead,
// unresumable, and previously stuck in {action:'track'} forever. Give the
// pause a generous grace window (~60s at the 2s cadence), then treat it like
// any other dead player.
const EMPTY_WHILE_PAUSED_POLL_LIMIT = 30;

function decidePollAdvance({
  state,
  positionMs = 0,
  durationMs = 0,
  lastPositionMs = 0,
  lastState = null,
  expectedAsin = null,
  actualAsin = null,
  pollCount = 0,
  seekSuppress = false,
  emptyWhilePausedPolls = 0
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

  // A page torn down while paused: EMPTY with lastState PAUSED is dead and
  // cannot be resumed. The caller latches the pause-death (the 'track' action
  // overwrites lastState with the dead value on the first such poll, so
  // gating on lastState === 'PAUSED' here used to make the grace window
  // unreachable — the counter could never be spent). The count is only ever
  // nonzero when the caller saw PAUSED before the death, so it is the
  // authority here. A never-alive player sends 0 and never advances.
  if ((state === 'EMPTY' || state === 'STOPPED' || state === 'FINISHED') &&
      emptyWhilePausedPolls >= EMPTY_WHILE_PAUSED_POLL_LIMIT) {
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

// openLogin's completion gate. "The URL is not a known wall" alone fails
// open: music.amazon.com/ itself is not a wall, and a logged-out first paint
// can sit there (or redirect slowly) for a second or more — the old timer
// closed the sign-in window and reported success before the user touched the
// password field. Require a positive signal: a non-wall music.amazon.com URL
// that has been stable for two consecutive ticks AND at least one of (an
// auth cookie is present, the page has moved off the bare home path, or three
// stable ticks — the fallback for Amazon rotating its cookie names, at the
// cost of a ~3s wait when a signed-in landing page really is /).
function signInLanded({ url, lastUrl = null, stableTicks = 0, hasCookie = false } = {}) {
  const okUrl = !!url && /music\.amazon\.com/i.test(url) && !pageBlocksPlayback(url);
  const ticks = okUrl ? (lastUrl === url ? stableTicks + 1 : 1) : 0;
  let landed = false;
  if (ticks >= 2) {
    let path = '';
    try { path = new URL(url).pathname; } catch (e) { /* not a URL */ }
    landed = !!hasCookie || path !== '/' || ticks >= 3;
  }
  return { landed, stableTicks: ticks };
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
  // URL first: it is the document we loaded, and the only ASIN the poller can
  // trust when the mini player disagrees. The mini player read is a scrape of
  // whatever /tracks/ link sorts first inside its chrome — a stale row or an
  // "up next" entry made actualAsin disagree with the page we are actually
  // on, and the track-changed branch skipped the track two polls in. The mini
  // player remains the fallback for surfaces with no /tracks/ URL (a queue or
  // home page) while something keeps playing; a genuine Amazon auto-advance
  // is still caught there, and near-end/wrap advance regardless.
  return asinFromPlayerUrl(state.href) || state.playingAsin || null;
}

// Playback failure must not reveal the player. Sign-in is the only window.
// A run of unplayable radio tracks used to show and focus the page.
function shouldRevealPlayerOnFailure() {
  return false;
}

function isAmazonPlayerChrome(testIds) {
  return /miniplayer|nowplaying|playbacktransport/i.test((testIds || []).join(' '));
}

// Songs-tab rows put the track ASIN on a descendant element id (the like
// button); the artist and album ASINs arrive on /artists/ and /albums/ hrefs.
// The first B-prefixed 10-char id used to win, which matched the album ASIN
// whenever it sorted earlier in the row — and the row's title and artist still
// matched, so the wrong id sailed through the confidence gate and playback
// targeted the album. Prefer an id that is not any ASIN the row links to.
function pickTrackAsinFromIds(ids, linkedAsins = []) {
  const exclude = new Set((Array.isArray(linkedAsins) ? linkedAsins : [])
    .filter(Boolean).map(a => String(a).toUpperCase()));
  for (const raw of (Array.isArray(ids) ? ids : [])) {
    if (typeof raw !== 'string') continue;
    const id = raw.toUpperCase();
    if (!/^B[A-Z0-9]{9}$/.test(id)) continue;
    if (exclude.has(id)) continue;
    return id;
  }
  return null;
}

// Search rows render durations as "N MIN M SEC" (en). Also accept "M:SS",
// "H:MM:SS" and a bare "N SEC" so the common shapes parse; anything else
// (localized, missing) is 0 — same as the old English-only parse, which
// button-scraped rows never got at all.
function parseRowDurationSec(text) {
  const s = String(text || '');
  let m = s.match(/(\d+)\s*MIN(?:\s*(\d+)\s*SEC)?/i);
  if (m) return parseInt(m[1], 10) * 60 + (m[2] ? parseInt(m[2], 10) : 0);
  m = s.match(/(\d+):(\d{2})(?::(\d{2}))?/);
  if (m) {
    if (m[3]) return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }
  m = s.match(/(\d+)\s*SEC/i);
  if (m) return parseInt(m[1], 10);
  return 0;
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

// A playlist page lives at /playlists/<id> (shared/brand playlists) or
// /my/playlists/<id> (the user's own). The id is a long alphanumeric token
// (PP…), not the 10-char ASIN a track uses — brand playlists use those too.
function amazonPlaylistIdFromUrl(url) {
  const m = String(url || '').match(/music\.amazon\.com\/(?:my\/)?playlists\/([A-Za-z0-9]+)/i);
  return m ? m[1] : null;
}

// The page fetches its playlist via a persisted GraphQL query (APQ) against
// gql.music.amazon.com: {operationName: 'playlistDetail', variables: {id,
// firstLimit: 100, ...}, extensions: {persistedQuery: {sha256Hash}}}. The hash
// renumbers on every hornet redeploy, so we never hardcode it — we capture the
// request the page itself makes for the playlist we loaded, then replay it from
// the page world with a bigger firstLimit. Given the captured request bodies
// (strings), return the parsed playlistDetail request for OUR playlist id, or
// null when the page never made one (not found / private / other region).
function amazonPlaylistDetailRequest(bodies, playlistId) {
  const wanted = String(playlistId || '').toLowerCase();
  for (const raw of (Array.isArray(bodies) ? bodies : [])) {
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { continue; }
    const batch = Array.isArray(parsed) ? parsed : [parsed];
    for (const req of batch) {
      if (!req || req.operationName !== 'playlistDetail') continue;
      const id = req.variables && req.variables.id;
      if (!id) continue;
      if (wanted && String(id).toLowerCase() !== wanted) continue;
      return req;
    }
  }
  return null;
}

// Headers to copy onto the replayed gql fetch. The request the page made is
// authoritative (x-api-key, csrf-*, music-territory, x-amzn-*); the browser
// adds cookies (credentials: 'include') and origin/referer/sec-* itself, and
// setting them from JS is either forbidden or wrong, so strip those.
const GQL_REPLAY_DROP_HEADERS = new Set([
  'cookie', 'origin', 'referer', 'user-agent', 'accept-encoding', 'accept-language',
  'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-user',
  'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'host', 'connection',
  'content-length'
]);

function amazonGqlFetchHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (!GQL_REPLAY_DROP_HEADERS.has(String(k).toLowerCase())) out[k] = v;
  }
  return out;
}

// One tracks.edges[] entry -> the lookupPlaylist track shape. Artist is the
// joined contributing artists (PRIMARY first); album is the album shortTitle
// (the detail response has no full album title). A row without asin + title +
// artist is dropped (the import path filters on both anyway).
function playlistTrackFromGqlEdge(edge) {
  const node = edge && edge.node;
  if (!node || !node.id || !node.title) return null;
  const artists = (node.contributingArtists && Array.isArray(node.contributingArtists.edges))
    ? node.contributingArtists.edges : [];
  const primary = artists.filter(a => a && a.node && a.node.name && a.role === 'PRIMARY');
  const all = artists.filter(a => a && a.node && a.node.name);
  const chosen = primary.length ? primary : all;
  const artist = chosen.map(a => a.node.name).join(', ');
  if (!artist) return null;
  const album = node.album || {};
  return {
    asin: node.id,
    title: String(node.title).slice(0, 200),
    artist: artist.slice(0, 200),
    album: String(album.shortTitle || album.title || '').slice(0, 200),
    albumAsin: album.id || null,
    duration: typeof node.duration === 'number' ? node.duration : 0
  };
}

// The gql response's data.playlist -> the lookupPlaylist result shape. Picks
// the cover (imageType PRIMARY, else the largest) and a best-effort owner.
// Returns null when data.playlist is null (deleted / private / other region).
function playlistFromGql(data) {
  const playlist = data && data.playlist;
  if (!playlist) return null;
  // Cover: the widest imageType=PRIMARY entry (the 2400×2400 square); when
  // there is no PRIMARY, the widest image overall.
  const images = (Array.isArray(playlist.images) ? playlist.images : []).filter(i => i && i.url);
  const widest = (list) => (list.length ? list.reduce((a, b) => ((b.width || 0) >= (a.width || 0) ? b : a)) : null);
  const cover = (widest(images.filter(i => i.imageType === 'PRIMARY')) || widest(images) || {}).url || null;
  const curator = playlist.curator;
  const owner = (curator && typeof curator === 'object' && curator.name) || (typeof curator === 'string' ? curator : null);
  const tracks = (playlist.tracks && Array.isArray(playlist.tracks.edges))
    ? playlist.tracks.edges.map(playlistTrackFromGqlEdge).filter(Boolean)
    : [];
  return {
    id: playlist.id,
    name: playlist.title || 'Amazon Music Playlist',
    owner,
    albumArt: cover,
    trackCount: typeof playlist.trackCount === 'number' ? playlist.trackCount : tracks.length,
    tracks
  };
}

module.exports = {
  reportedPlaybackAsin,
  shouldRevealPlayerOnFailure,
  playerDurationMs,
  decidePollAdvance,
  shouldPollFaster,
  pageBlocksPlayback,
  signInLanded,
  AMAZON_QUALITY_OPTIONS,
  normalizeStreamingQuality,
  installAmazonRequireTrap,
  readPersistedQuality,
  writePersistedQuality,
  isAmazonPlayerChrome,
  pickTrackAsinFromIds,
  parseRowDurationSec,
  amazonSongSearchUrl,
  isAmazonSongResultItem,
  acceptAmazonSearchAnchor,
  asinFromPlayerUrl,
  amazonPlaylistIdFromUrl,
  amazonPlaylistDetailRequest,
  amazonGqlFetchHeaders,
  playlistTrackFromGqlEdge,
  playlistFromGql,
  NEAR_END_MS,
  WRAP_POSITION_MS,
  FAST_POLL_REMAINING_MS,
  EMPTY_WHILE_PAUSED_POLL_LIMIT
};
