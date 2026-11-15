// Pure helpers for the Amazon Music resolver. Kept out of main.js so the
       // steady pairs before a measurement reports
const QUALITY_MIN_PAIR_MS = 250;   // a shorter pair (jittery/duplicate read) means nothing
const QUALITY_MAX_PAIR_MS = 4000;  // a longer pair spans a dropped poll — skip it
const QUALITY_MAX_DRIFT_MS = 400;  // |playheadΔ − wallΔ| beyond this is a seek or pause
const QUALITY_MIN_KBPS = 16;       // sanity bounds — outside is a transient, not the stream
const QUALITY_MAX_KBPS = 10000;
  // recent median this far from the track median = a real quality change
const QUALITY_TRACK_RATES_MAX = 2000; // ~66 min of 2s pairs; older rates drop first

// The kbps of one pair of consecutive samples, or null when the pair is not
// a steady measurement (seek, pause, dropped poll, stalled or missing counter,
// absurd rate).
function streamPairKbps(prev, next) {
  if (!prev || !next) return null;
  const wallMs = (next.wallMs || 0) - (prev.wallMs || 0);
  const posMs = (next.positionMs || 0) - (prev.positionMs || 0);
  const bytes = (next.bytes || 0) - (prev.bytes || 0);
  if (wallMs < QUALITY_MIN_PAIR_MS || wallMs > QUALITY_MAX_PAIR_MS) return null;
  if (Math.abs(posMs - wallMs) > QUALITY_MAX_DRIFT_MS) return null;
  if (bytes <= 0) return null; // nothing decoded in the window (counter missing / stall)
  const kbps = Math.round((bytes * 8) / posMs);
  if (kbps < QUALITY_MIN_KBPS || kbps > QUALITY_MAX_KBPS) return null;
  return kbps;
}

function medianKbps(rates) {
  const sorted = rates.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// ── DASH manifest → stream parameters ────────────────────────────────────────
// The preload's net hook (installAmazonStreamCapture) captures the MPD the
// page itself fetched, plus the (small) init segment responses. Everything
// below is pure parsing of what was captured — no fetching, no DOM. DASH
// attributes are packager output rather than hornet UI, so this surface is
// stable across hornet redeploys; the tolerant scan trades precision for
// rot-resistance (an unrecognized shape yields an empty list, not garbage).

function decodeXmlEntities(value) {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => {
      try { return String.fromCodePoint(parseInt(h, 16)); } catch (e) { return ''; }
    })
    .replace(/&#(\d+);/g, (m, d) => {
      try { return String.fromCodePoint(parseInt(d, 10)); } catch (e) { return ''; }
    })
    .replace(/&amp;/g, '&'); // amp last: &amp;lt; stays as literal &lt; per XML
}

// attribute pairs of one opening tag ("id="x" codecs="fLaC"").
function xmlAttrMap(tagSource) {
  const attrs = {};
  const re = /([A-Za-z_][-\w:.]*)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(tagSource))) attrs[m[1]] = decodeXmlEntities(m[2]);
  return attrs;
}

// Bit depth is not a standard DASH attribute, so accept it from the places a
// packager might put it, and only for the depths Amazon actually delivers.
function mpdBitDepthHint(attrs, repText) {
  for (const key of ['bitDepth', 'bitsPerSample', 'bit_depth']) {
    const v = attrs && attrs[key];
    if (v && ['16', '24', '32'].includes(String(v))) return Number(v);
  }
  const attrScan = String(repText || '').match(/\b(?:bitDepth|bitsPerSample|bit_depth)["':=\s]+(\d{1,2})\b/i);
  if (attrScan && ['16', '24', '32'].includes(attrScan[1])) return Number(attrScan[1]);
  const idScan = String((attrs && attrs.id) || '').match(/\b(16|24|32)[-_ ]?bit\b/i);
  if (idScan) return Number(idScan[1]);
  return null;
}

// FLAC-in-ISOBMFF init segments carry STREAMINFO in a `dfla` box — the same
// bytes the decoder reads, so this is the authoritative sample rate / bit
// depth / channels for the delivered stream. ISOBMFF boxes nest, so scan for
// the `dfla` fourcc instead of walking the box tree, and let the STREAMINFO
// sanity checks reject a coincidental byte sequence.
function flacStreamInfo(s) {
  const sampleRate = (s[10] << 12) | (s[11] << 4) | (s[12] >> 4);
  const channels = ((s[12] >> 1) & 0x07) + 1;
  const bits = (((s[12] & 0x01) << 4) | (s[13] >> 4)) + 1;
  const info = { codec: 'fLaC' };
  if (sampleRate >= 8000 && sampleRate <= 768000) info.sampleRate = sampleRate;
  if (channels >= 1 && channels <= 8) info.channels = channels;
  if (bits >= 8 && bits <= 32) info.bitDepth = bits;
  return (info.sampleRate && info.bitDepth) ? info : null;
}

// dfla is a FullBox: 4 version/flags bytes, then the FLAC metadata block
// (4-byte block header + 34-byte STREAMINFO). A bare 34-byte read after the
// fourcc is not accepted: those checks only bound sample rate and bit depth,
// so random bytes after a coincidental dfla/dfLa parsed as FLAC.
function flacStreamInfoAt(b, at) {
  for (const blockHeaderAt of [at + 8, at + 4]) {
    // With the metadata block header…
    if (blockHeaderAt + 38 <= b.length) {
      const blockType = b[blockHeaderAt] & 0x7f;
      const blockLen = (b[blockHeaderAt + 1] << 16) | (b[blockHeaderAt + 2] << 8) | b[blockHeaderAt + 3];
      if (blockType === 0 && blockLen === 34) {
        const info = flacStreamInfo(b.subarray(blockHeaderAt + 4, blockHeaderAt + 38));
        if (info) return info;
      }
    }
  }
  return null;
}


// castlabs components.status() shape is not a documented contract. Read only
// the status fields instead of substring-matching the whole JSON blob - an
// unrelated "failed" elsewhere in the payload (a URL, a component name) used
// to disable Amazon playback entirely. Optimistic when the shape is not
// recognized: the EME probe is the real playback gate, and a spurious
// "no CDM" disables the resolver outright. Cycle-safe.
function cdmStatusHealthy(status) {
  if (!status || typeof status !== 'object') return true;
  if (Object.keys(status).length === 0) return false; // {} = nothing installed
  const seen = new Set();
  const stack = [status];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'status') {
        const s = String(entry).toLowerCase();
        if (s === 'failed' || s.includes('component_update_error')) return false;
      } else if (entry && typeof entry === 'object') {
        stack.push(entry);
      }
    }
  }
  return true; // no status field found: assume present; the EME probe is the gate
}

// Amazon's web player is not usable for search or play while it is still
// on the account sign-in page or the post-login profile picker. Cookies can
// already exist at that point; the URL is the signal that selection finished.
function pageBlocksPlayback(url) {
  const value = url || '';
  if (/\/identity\/who-is-listening/i.test(value)) return 'not-signed-in';
  if (/\/ap\/signin/i.test(value)) return 'not-signed-in';
  // The sign-in portal is every /ap/ path on an Amazon account host, not only
  // /ap/signin: 2FA (/ap/mfa), push approval and verification (/ap/cvf/...),
  // challenges and account fixes all come before the session is usable (#1166).
  if (/^https?:\/\/[^/?#]*amazon\.[^/?#]+\/ap\//i.test(value)) return 'not-signed-in';
  return null;
}

// Which Amazon session cookies a cookie jar holds, by NAME:
//   'known'   — the auth cookies isSignedIn has always keyed on
//               (at-main / sess-at-main / at-acb, prefix-matched);
//   'rotated' — none of those, but another auth-shaped cookie (x-main, or
//               any at-* / sess-at-*): Amazon renamed its cookies, and the
//               session is still live;
//   'none'    — signed out.
// A logged-out jar holds only session-id / session-id-time / ubid-main and
// the like (observed 2026-10, before and during a sign-in), never an
// auth-shaped name, so 'none' is safe to read as signed out. The old hedge
// trusted any non-wall music.amazon.com page instead, and Amazon Music's
// logged-out home page is exactly that.
function amazonAuthCookieState(names) {
  const list = Array.isArray(names) ? names.filter(n => typeof n === 'string') : [];
  if (list.some(n => /^(at-main|sess-at-main|at-acb)/.test(n))) return 'known';
  if (list.some(n => /^(x-main|at-|sess-at-)/.test(n))) return 'rotated';
  return 'none';
}

// The Amazon Music web player's own host. A URL is on the player only when
// its HOST is this: the sign-in portal's URLs carry music.amazon.com in their
// return_to query, so a substring match passes them.
function onMusicHost(url) {
  try {
    return new URL(url).hostname.toLowerCase() === 'music.amazon.com';
  } catch (e) {
    return false;
  }
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
  const okUrl = !!url && onMusicHost(url) && !pageBlocksPlayback(url);
  const ticks = okUrl ? (lastUrl === url ? stableTicks + 1 : 1) : 0;
  let landed = false;
  if (ticks >= 2) {
    let path = '';
    try { path = new URL(url).pathname; } catch (e) { /* not a URL */ }
    landed = !!hasCookie || path !== '/' || ticks >= 3;
  }
  return { landed, stableTicks: ticks };
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


// Headers to copy onto the replayed gql fetch (the host's replayGql — now the
// diagnostic capture's only caller, since the recommendations flows moved
// into the plugin, #1356 M8). The request the page made is authoritative
// (x-api-key, csrf-*, music-territory, x-amzn-*); the browser adds cookies
// (credentials: 'include') and origin/referer/sec-* itself, and setting them
// from JS is either forbidden or wrong.
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

// HTTP 294 is the gql server's PARTIAL-SUCCESS status: a resolver for one
// field failed, the response carries `errors` for that path, and `data`
// still holds everything else. It is not always a refusal. A community
// playlist (/user-playlists/<id>) answers playlistDetail with 294 to Amazon's
// own page, because playlist.capabilities.setOnDemand calls a collaborators
// service that fails (500) for a playlist the user doesn't own, while
// data.playlist (title, tracks, pageInfo) is complete, and the page renders
// it (live-captured 2026-11-15). Other 294s carry no usable data: a Prime
// account's MusicHomePage, and a home walk with firstLimit above 20. So a
// 294 is accepted only by a flow that asks, and only when its own predicate
// finds the data it needs (`acceptPartial(parsed)`); every other non-200 is
// a failure carrying its status (the home flow reads that status).
const GQL_PARTIAL_STATUS = 294;

// The page-world replay's raw { status, text } (or { error }) -> { parsed }
// or { error, status? }. Pure, so the status rules are unit-tested; the
// host's replayGql in amazon-web-player.js is the caller (the diagnostic
// capture it still serves, since the recommendations flows moved into the
// plugin, #1356 M8), and the plugin's `_lib` copy serves the plugin's own
// replayGql with the moved flows (#1356 M5/M6/M7/M8; the playlist flow's
// playlistPartialIsUsable predicate moved with it).
function gqlReplayOutcome(replay, { acceptPartial = null } = {}) {
  if (!replay || replay.error) return { error: (replay && replay.error) || 'Amazon gql query failed' };
  const status = replay.status;
  const failed = () => ({ error: `Amazon gql query failed (${status})`, status });
  const partialAllowed = status === GQL_PARTIAL_STATUS && typeof acceptPartial === 'function';
  if (status !== 200 && !partialAllowed) return failed();
  let parsed = null;
  try { parsed = JSON.parse(replay.text); } catch (e) { /* leave null */ }
  if (status !== 200) {
    // A partial answer the flow can't use (or that isn't JSON) is the plain
    // failure, status and all.
    let usable = false;
    try { usable = !!(parsed && acceptPartial(parsed)); } catch (e) { usable = false; }
    return usable ? { parsed, partial: true } : failed();
  }
  if (!parsed) return { error: 'Amazon gql response was not JSON' };
  if (Array.isArray(parsed.errors) && parsed.errors.length && !parsed.data) {
    return { error: String((parsed.errors[0] || {}).message || 'Amazon gql query error') };
  }
  return { parsed };
}

// Amazon renders the explicit tag as a marker INSIDE the title text
// ("Kunnioita [Explicit]") — the gql Track node carries no explicit field.
// Left in, the tag pollutes every downstream consumer that compares this
// title against another provider's spelling (cross-resolver enrichment, sync
// mirrors, and scrobbles — "Kunnioita [Explicit]" is a different Last.fm
// track). Strip a TRAILING bracketed/parenthesized "explicit" marker (the
// only shape Amazon uses) and report it, so an item mapper can set the
// explicit flag the payload itself lacks. A bare word ("Sexually Explicit")
// is the track's real title and is left alone. (The plugin's _lib carries
// its own copy — #1356 M5; this one serves amazonNowPlayingMismatch.)
function stripAmazonTitleMarker(title) {
  const raw = String(title || '');
  const m = raw.match(/^(.*?)\s*[[(]\s*explicit\s*[\])]\s*$/i);
  if (!m) return { title: raw.trim(), explicit: false };
  return { title: m[1].trim(), explicit: true };
}

// (The playlist edge mapper, the data.playlist parsers and the recommendation
// item mapper — playlistTrackFromGqlEdge / playlistFromGql /
// playlistPageInfoFromGql / playlistEdgesFromGql /
// recommendationItemFromGqlNode / gqlPrimaryImageUrl / gqlPrimaryArtistNames,
// and with them amazonMusicHomeRequest / recommendationsFromMusicHome /
// musicHomeBodyWithVars / mergeMusicHomeSectionPages / seeMoreSectionIdFor /
// amazonSeeMoreRequest / recommendationStrategyId / amazonSeeMorePageUrl /
// seeMoreBodyWithVars / recommendationsFromSeeMore, plus the replay-template
// trio (makeSpecSearchTemplate / specTemplateIsFresh /
// SPEC_TEMPLATE_MAX_AGE_MS), capturedOperationNames and isAmazonMusicPage —
// lived here until #1356 M8 moved the recommendations into the plugin; the
// _lib copies in plugins-src/amazonmusic/implementation.js are the only ones
// now.)






// (paginatePlaylistTracks — the pure token-driven pagination loop — lived
// here until #1356 M7 moved the playlist import into the plugin; the _lib
// copy in plugins-src/amazonmusic/implementation.js is the only one now.)

// A halt that started for play N must not pause play N+1. The page token is
// stamped after the track document loads. A generation-scoped pause no-ops
// unless that token matches — including when the token is missing, so a halt
// that races the stamp cannot pause a page it does not own. User pause passes
// no generation and always pauses the current element.
function amazonMediaPauseExpr(expectedGeneration) {
  if (!Number.isFinite(expectedGeneration)) return 'm.pause();';
  const gen = expectedGeneration | 0;
  return `if (window.__parachordPlayGen !== ${gen}) return { ok: false, superseded: true }; m.pause();`;
}

function gqlCaptureSubject(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return null; }
  if (u.origin !== 'https://music.amazon.com') return null;
  const album = /^\/albums\/([A-Z0-9]{10})(?:\/|$)/i.exec(u.pathname);
  if (album) return { kind: 'album', asin: album[1].toUpperCase() };
  const search = /^\/search\/([^/]+)(?:\/([a-z]+))?\/?$/i.exec(u.pathname);
  if (search) {
    let text;
    try { text = decodeURIComponent(search[1]); } catch { text = search[1]; }
    return { kind: 'search', searchText: text, tab: search[2] ? search[2].toLowerCase() : null };
  }
  return null;
}

// The requests in one captured body: a single request or a batch.
function gqlRequestsIn(raw) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return []; }
  return (Array.isArray(parsed) ? parsed : [parsed]).filter(r => r && typeof r === 'object');
}

// Operation names that change account state or report activity. Never
// replayed, even when their variables name the album: a replay would repeat
// the action ("add to library", "record a view") on the user's account.
const GQL_WRITE_OP = /^(?:add|remove|delete|update|set|put|create|follow|unfollow|like|unlike|save|record|log|report|send|post|mark)[A-Z_]|^track[A-Z]/;
const GQL_MUTATION_NAME = /mutation/i;

// Whether a captured request is the page's own read query for what it shows:
// its variables name the album ASIN, or carry the search text. Only these are
// replayed (to read their response shape); everything else is listed by name.
function gqlRequestIsAboutSubject(req, subject) {
  if (!req || !subject || !req.variables || typeof req.variables !== 'object') return false;
  if (/^\s*mutation\b/.test(String(req.query || ''))) return false;
  const opName = String(req.operationName || '');
  if (GQL_WRITE_OP.test(opName) || GQL_MUTATION_NAME.test(opName)) return false;
  if (subject.kind === 'album') {
    return JSON.stringify(req.variables).toUpperCase().includes(subject.asin);
  }
  if (subject.kind === 'search') {
    const text = req.variables.searchText;
    return typeof text === 'string' && text.toLowerCase() === String(subject.searchText).toLowerCase();
  }
  return false;
}

// Keys whose values could identify or authenticate the user.
const GQL_SECRET_KEY = /token|cookie|session|auth|csrf|secret|password|credential|signature|customer|device|email/i;

// A copy of a gql value that is safe to write to disk and share: secret-
// looking keys redacted, query strings cut from URLs (signed CDN URLs carry
// credentials), long strings and long arrays trimmed. The shape survives;
// that is what a parser needs.
function redactGqlSample(value, opts = {}, depth = 0) {
  const maxArray = opts.maxArray || 3;
  const maxString = opts.maxString || 300;
  if (depth > 40) return '[too deep]';
  if (Array.isArray(value)) {
    const out = value.slice(0, maxArray).map(v => redactGqlSample(v, opts, depth + 1));
    if (value.length > maxArray) out.push(`[${value.length - maxArray} more]`);
    return out;
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = GQL_SECRET_KEY.test(k) ? '[redacted]' : redactGqlSample(v, opts, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') {
    let s = value;
    if (/^https?:\/\//i.test(s) && s.includes('?')) s = `${s.slice(0, s.indexOf('?'))}?[query removed]`;
    return s.length > maxString ? `${s.slice(0, maxString)}…` : s;
  }
  return value;
}

// One captured request as written to the capture file: never header values
// (they carry the session), only their names.
function summarizeGqlRequest(entry, req) {
  let endpoint = null;
  try {
    const u = new URL(entry && entry.url);
    endpoint = u.origin + u.pathname;
  } catch { /* leave null */ }
  return {
    operationName: (req && req.operationName) || null,
    endpoint,
    persistedQuery: !!(req && req.extensions && req.extensions.persistedQuery),
    hasQueryText: !!(req && req.query),
    variables: redactGqlSample(req && req.variables, { maxArray: 10 }),
    headerNames: Object.keys((entry && entry.headers) || {}).sort()
  };
}

function amazonPlayGenerationStamp(generation) {
  return `window.__parachordPlayGen = ${generation | 0};`;
}

// ── config.json (the session facts reader) ──────────────────────────────────
// #1356 M9: the dmls request bodies, the licence-refusal semantics, the MPD
// KID parse and the telemetry envelope builders moved into the Amazon plugin's
// _lib (plugins-src/amazonmusic/implementation.js) with the DRM pair; the host
// copies died with amazon-dmls.js / main-process/amazon-telemetry.js. What
// stays here is the config.json parse the getStatus plan stopgap
// (amazon-web-player.js getPlan) reads — every field degrades to null.

// GET https://music.amazon.com/config.json answers the session facts in one
// shot (cookies only, no CSRF): customer, marketplace, territory, the dmls
// region segment itself (siteRegion) and the tier. What remains host-side is
// the plan read (the getStatus stopgap); the plugin's mint parses the same
// file with its own copy. Parse defensively — every field degrades to null.
function amazonNativeSessionFromConfig(json) {
  const j = json && typeof json === 'object' ? json : {};
  const str = (v) => (typeof v === 'string' && v ? v : null);
  return {
    customerId: str(j.customerId),
    marketplaceId: str(j.marketplaceId),
    territoryId: str(j.musicTerritory),
    region: str(j.siteRegion),
    deviceId: str(j.deviceId),
    deviceType: str(j.deviceType),
    tier: typeof j.tier === 'string' ? j.tier : (j.tier && typeof j.tier === 'object' ? (str(j.tier.name) || str(j.tier.tier) || null) : null)
  };
}

// The account's plan, from config.json's `tier` (#1220). Only Music Unlimited
// plays on demand in Parachord. Prime gives no on-demand playback, and a tier
// we can't read or don't recognize blocks too ('unknown'), so a format change
// on Amazon's side shows up as a message rather than as plays the plan may
// not cover. Seen so far: 'PRIME' and values starting 'UNLIMITED'. The rule
// lives here alone (the plugin's telemetry resourceType uses its own copy).
function isUnlimitedTier(tier) {
  return typeof tier === 'string' && /^UNLIMITED/i.test(tier.trim());
}

function amazonPlanFromTier(tier) {
  if (isUnlimitedTier(tier)) return 'unlimited';
  if (typeof tier === 'string' && tier.trim().toUpperCase() === 'PRIME') return 'prime';
  return 'unknown';
}

// One wording for the tile, the settings panel and the play refusal.
const AMAZON_PLAN_MESSAGES = {
  prime: 'Amazon Prime: Amazon is used for album art, artist photos and links. Playing Amazon tracks in Parachord needs Music Unlimited.',
  unknown: "Parachord couldn't confirm your Amazon Music plan, so Amazon playback is off until it can. Playing Amazon tracks in Parachord needs Music Unlimited."
};

function amazonPlanMessage(plan) {
  return AMAZON_PLAN_MESSAGES[plan] || null;
}

// ── Streaming telemetry ─────────────────────────────────────────────────────
// #1356 M9: the hornet /telemetry/v1/events envelope builders and the reporter
// state machine moved into the Amazon plugin's _lib (createAmazonTelemetry —
// the plugin reports the player events itself on the renderer-mediated DRM
// path); the host copies died with main-process/amazon-telemetry.js.

// Does Amazon's page say it is playing a different song than the one
// requested? Parachord loads /tracks/<ASIN>?do=play, and for a track the
// account can only start as a STATION, Amazon's player starts a station
// seeded from it instead (live 2026-10: "Ready or Not" by Shakey Graves played
// Mumford & Sons, then another Shakey Graves song). The poller cannot see that
// (it reads the ASIN from the URL it loaded), but the page reports its real
// now-playing through navigator.mediaSession.metadata, which the media-session
// hijack keeps (embedded-player-kit.js).
//
// Conservative on purpose: only a clear TITLE mismatch counts. Unknown or
// empty metadata is never a mismatch, and titles are compared after dropping
// the explicit marker, bracketed suffixes ("(feat. ...)", "[Remastered]") and
// a " - ..." suffix, by containment either way, so a station is caught while
// a track whose page title is spelled a little differently is not.
// expectedTitle is Amazon's own label for the ASIN (what the plugin passes).
function amazonNowPlayingMismatch(expectedTitle, nowPlaying) {
  const core = (value) => stripAmazonTitleMarker(value).title
    .replace(/\s*[[(][^\])]*[\])]/g, ' ')
    .replace(/\s+-\s+.*$/, '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
  if (!nowPlaying || typeof nowPlaying.title !== 'string' || !expectedTitle) return false;
  const want = core(expectedTitle);
  const got = core(nowPlaying.title);
  if (!want || !got) return false;
  return !(want.includes(got) || got.includes(want));
}

module.exports = {
  amazonNativeSessionFromConfig,
  isUnlimitedTier,
  amazonPlanFromTier,
  amazonPlanMessage,
  gqlCaptureSubject,
  gqlRequestsIn,
  gqlRequestIsAboutSubject,
  redactGqlSample,
  summarizeGqlRequest,
  reportedPlaybackAsin,
  amazonMediaPauseExpr,
  amazonPlayGenerationStamp,
  shouldRevealPlayerOnFailure,
  cdmStatusHealthy,
  pageBlocksPlayback,
  amazonAuthCookieState,
  onMusicHost,
  amazonNowPlayingMismatch,
  signInLanded,
  asinFromPlayerUrl,
  amazonGqlFetchHeaders,
  GQL_PARTIAL_STATUS,
  gqlReplayOutcome,
  stripAmazonTitleMarker,

};
