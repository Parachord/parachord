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

// Circuit breaker for search's structural failures. A hornet rename of the
// search operation makes every search wait the full capture window and then
// throw not-ready — serially on the search chain, a 100-track resolution run
// burns ~25 minutes there and starves playlist imports too. After `threshold`
// consecutive structural failures the breaker opens for `cooldownMs`; while
// open, searchTracks fails fast instead of burning the window. When the
// cooldown elapses the next search is a probe (one window); a failure re-opens
// the breaker, any success closes it. Pure with an injected now() — the poller
// pattern.
function createSearchBreaker({ threshold = 3, cooldownMs = 10 * 60 * 1000, now = Date.now } = {}) {
  let failures = 0;
  let openUntil = 0;
  const open = () => failures >= threshold && now() < openUntil;
  return {
    allows: () => !open(),
    isProbe: () => failures >= threshold && now() >= openUntil,
    recordFailure() {
      failures += 1;
      if (failures >= threshold) openUntil = now() + cooldownMs;
    },
    recordSuccess() {
      failures = 0;
      openUntil = 0;
    },
    state: () => ({ failures, openUntil, open: open() })
  };
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

// A loose "Stations Warning" search misses the song, so both terms are
// quoted — but quoting alone imposes phrase ORDER, and Amazon's matching
// is order-sensitive in both directions (live-verified 2026-10 through the
// app): Warning's "Stations" only surfaces as '"Stations" "Warning"' while
// ХЛЕБ's "Яйца" only surfaces as '"ХЛЕБ" "Яйца"'. So the query ORs the two
// orders in one page load: '"title" "artist" OR "artist" "title"'. Amazon
// unions the clauses (the literal keyword OR adds a few noise rows — tracks
// whose title contains "or" — which the resolver's artist+title filter and
// the confidence gate drop).
// Returns { url, searchText } — the search runs over gql (the page's own
// SpecSearchSeeMorePage request, captured and replayed), and searchText is the
// exact string the page puts in variables.searchText, so the caller can find
// its own request among everything the page fires. The songs tab is always
// used: that is the page which fires the track search. Returns null when
// there is nothing to search.
function amazonSongSearchUrl({ title, artist, query } = {}) {
  const quote = (value) => '"' + String(value || '').replace(/"/g, '').trim() + '"';
  let q = '';
  if ((title && String(title).trim()) || (artist && String(artist).trim())) {
    const titlePart = title && String(title).trim() ? quote(title) : '';
    const artistPart = artist && String(artist).trim() ? quote(artist) : '';
    q = titlePart && artistPart
      ? titlePart + ' ' + artistPart + ' OR ' + artistPart + ' ' + titlePart
      : titlePart || artistPart;
  } else {
    q = String(query || '').trim();
  }
  if (!q) return null;
  return { url: 'https://music.amazon.com/search/' + encodeURIComponent(q) + '/songs', searchText: q };
}

// A playlist page lives at /playlists/<id> (shared/brand playlists),
// /my/playlists/<id> (the user's own) or /user-playlists/<id> (the share-link
// shape for user-created playlists). The id is a long token — PP… (brand), a
// bare hex uuid, or a dashed uuid (live-observed 2026-10) — not the 10-char
// ASIN a track uses (brand playlists use those too). The id class must accept
// dashes: a dashed-uuid id truncated at its first dash never matches the
// page's own playlistDetail request (variables.id), and the import times out
// into "Playlist not found".
function amazonPlaylistIdFromUrl(url) {
  const m = String(url || '').match(/music\.amazon\.com\/(?:my\/)?(?:user-)?playlists\/([A-Za-z0-9-]+)/i);
  return m ? m[1] : null;
}

// Diagnostic for the lookup miss: the gql operations the page actually fired.
// When hornet renames playlistDetail, every import looks like "playlist
// deleted" — this turns that into a one-line diagnosis.
function capturedOperationNames(bodies) {
  const names = new Set();
  for (const raw of (Array.isArray(bodies) ? bodies : [])) {
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { continue; }
    const batch = Array.isArray(parsed) ? parsed : [parsed];
    for (const req of batch) {
      if (req && req.operationName) names.add(String(req.operationName));
    }
  }
  return [...names];
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

// The search request the page fired for OUR query — the same
// capture-and-replay pattern as playlistDetail. Matched on
// variables.searchText (case-insensitive equality), NOT the operationName:
// the songs tab fires SpecSearchSeeMorePage today, but matching the text
// survives an operation rename, and the text is unique among the page's
// requests (only the spec search carries it).
//
// Only the TRACK spec is accepted by default: an album/artist/playlist spec
// for the same text is a different entity whose ASIN must never reach
// playback — an album-shaped edge maps to { asin: <albumAsin>, title, artist }
// and a self-titled release passes the confidence gate, which is exactly the
// album-ASIN failure the DOM-era exclusion dance existed to prevent. A body
// with no specType at all is accepted (older deploys). Pass { spec: 'album' }
// from album search to accept the album spec instead — the album parser
// rejects non-Album nodes, so a track-only response is a miss, never a
// misfiled entity. With { anySpec: true } the first searchText match of ANY
// spec is returned — used only to detect "the page searched our text, but
// the wanted spec never came" (the grace decision in searchTracks), never
// for replay.
function amazonSpecSearchRequest(bodies, searchText, { anySpec = false, spec = 'track' } = {}) {
  const wanted = String(searchText || '').trim().toLowerCase();
  if (!wanted) return null;
  for (const raw of (Array.isArray(bodies) ? bodies : [])) {
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { continue; }
    const batch = Array.isArray(parsed) ? parsed : [parsed];
    for (const req of batch) {
      const vars = req && req.variables;
      if (!vars || typeof vars.searchText !== 'string') continue;
      if (String(vars.searchText).trim().toLowerCase() !== wanted) continue;
      if (anySpec || vars.specType == null || vars.specType === spec) return req;
    }
  }
  return null;
}

// --- Spec-search request templates (replay-first) -------------------------
// A page load per search is what mints a fresh capture: the APQ hash
// renumbers on every hornet redeploy, and the csrf/session headers rotate
// with the session. But within a deploy+session the page's own request is
// reusable — the album search was discovered by replaying the captured
// track-spec request with the album spec swapped, and playlist pagination
// replays one capture up to 40 times. So a search that comes in while a
// captured template is still fresh skips its page load entirely: patch the
// template's variables (searchText + specType — one slot serves track,
// album and artist searches, exactly the swap that live-verified album
// search) and replay from the still-warm search view. A replay error (stale
// hash, rotated headers, network) discards the template and falls back to
// the full page flow, which recaptures — the fallback IS the page load, so
// nothing about the failure semantics changes; only the happy path gets
// cheaper. See "specSearch" in amazon-web-player.js.

// Hard cap on template age, past which the page flow runs anyway: session
// headers (csrf-ts rotation) have no verified TTL, and a hopeless replay
// costs one round trip anyway, so fresh means low-risk rather than exactly
// right. The capture timestamp rides along inside the template.
const SPEC_TEMPLATE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Build the reusable template from one capture of the page's own spec
// search request: entry { url, headers } (verbatim — amazonGqlFetchHeaders
// still filters browser-managed headers at replay time) and the matched
// request body. Everything is deep-cloned (JSON: the capture is pure JSON)
// so a later capture's mutation cannot alias into the stored template.
function makeSpecSearchTemplate({ url, headers, body, capturedAt }) {
  if (!url || !headers || !body || typeof body !== 'object') return null;
  if (!(body.extensions && body.extensions.persistedQuery && body.extensions.persistedQuery.sha256Hash)) return null;
  if (!(body.variables && typeof body.variables === 'object')) return null;
  return JSON.parse(JSON.stringify({
    url,
    headers,
    body,
    capturedAt: typeof capturedAt === 'number' ? capturedAt : Date.now()
  }));
}

// Whether the template can drive a replay-first search: present, shaped
// right, and not older than the freshness cap.
function specTemplateIsFresh(template, now) {
  if (!template || typeof template !== 'object') return false;
  if (typeof template.url !== 'string' || !template.url) return false;
  if (!template.headers || typeof template.headers !== 'object') return false;
  if (!(template.body && template.body.variables && template.body.extensions)) return false;
  const at = typeof template.capturedAt === 'number' ? template.capturedAt : 0;
  return (typeof now === 'number' ? now : Date.now()) - at < SPEC_TEMPLATE_MAX_AGE_MS;
}

// A deep clone of the template's request body with the search variables
// patched — searchText and, when given, specType (the track/album/artist
// swap the template shares). Everything else — firstLimit, feature flags,
// extensions with the APQ hash — stays byte-identical to the capture.
function specBodyWithVars(body, { searchText, specType } = {}) {
  const out = JSON.parse(JSON.stringify(body || {}));
  if (!out.variables || typeof out.variables !== 'object') out.variables = {};
  if (searchText != null) out.variables.searchText = searchText;
  if (specType != null) out.variables.specType = specType;
  return out;
}

// Whether a request a page flow matched is byte-identical to a replay of
// the CURRENT template (specBodyWithVars with the same variables) — i.e.
// it is not the page's own request but OUR replay echoing into the
// session-wide capture. Minting from it would re-store the template's own
// recycled (session-aged) headers with a fresh capturedAt, keeping a stale
// header set certified-fresh indefinitely; the page flow skips the re-mint
// then and lets the real page capture renew the template next time. The
// comparison is exact (JSON key order round-trips through specBodyWithVars
// and the replay script's own JSON.stringify without reordering).
function bodyMatchesTemplate(template, request, { searchText, specType } = {}) {
  if (!(template && template.body) || !request) return false;
  try {
    return JSON.stringify(specBodyWithVars(template.body, { searchText, specType })) === JSON.stringify(request);
  } catch (e) {
    return false;
  }
}

// Reader/writer gate in front of the shared search view. Template replays
// are READERS: they only evaluate fetch() in the page world — no navigation,
// no webRequest listener — so any number run in parallel. A real page load
// is the WRITER: executeJavaScript during a navigation races frame teardown,
// so a navigation waits for in-flight readers to drain. Readers arriving
// while the writer is active do not wait — they turn away (their caller
// falls back to the chained page flow, which re-checks the template after
// the writer refreshes it), so the writer is never starved and readers
// never queue behind a writer. All transitions are synchronous counter/flag
// flips — safe under JS's single thread; every reader exit runs in a finally
// so a thrown replay cannot leak the count. A reader is bounded by the
// caller's own replay timeout, so the writer's drain wait is bounded too.
function createReplayGate() {
  let readers = 0;
  let writing = false;
  let drainWaiters = [];
  const wake = () => {
    const waiters = drainWaiters;
    drainWaiters = [];
    for (const resolve of waiters) resolve();
  };
  return {
    // Become a reader, or refuse (navigation in progress). Sync on purpose:
    // the check and the increment must interleave with nothing.
    tryEnterReplay() {
      if (writing) return false;
      readers++;
      return true;
    },
    exitReplay() {
      if (readers > 0) {
        readers--;
      } else {
        // An unmatched exit would otherwise STEAL a live reader's slot (the
        // writer proceeds while a genuine reader is still in flight). All
        // call sites pair enter/exit via finally; warn loudly if that ever
        // breaks instead of silently corrupting the counts.
        console.warn('[Amazon] replayGate: exitReplay with no readers');
      }
      if (readers === 0) wake();
    },
    // Before navigating the shared view: no new readers, wait out the ones
    // in flight. Sync flag flip first, then drain. Writers are serialized by
    // the caller (the search chain); a second begin while one is held breaks
    // the flag — say so rather than clearing it from under the first.
    async beginNavigation() {
      if (writing) console.warn('[Amazon] replayGate: overlapping navigations');
      writing = true;
      while (readers > 0) await new Promise(resolve => drainWaiters.push(resolve));
    },
    endNavigation() {
      writing = false;
    },
    // Diagnostics only (getStatus): counters are the whole state.
    state() {
      return { readers, writing };
    }
  };
}

// The albums-tab search page — /search/<q>/albums fires the album-spec
// SpecSearchSeeMorePage (specType: 'album', same operation and query as the
// songs tab's track spec — live-verified 2026-10). The query string is built
// exactly like the songs one: quoted terms OR'd in both orders, since
// Amazon's matching is order-sensitive in both directions.
function amazonAlbumSearchUrl(input) {
  // Same input contract as the web player: a free-text string, or { title,
  // artist, query } (the album pages send { artist, title }).
  const opts = typeof input === 'string' ? { query: input } : input;
  const spec = amazonSongSearchUrl(opts || {});
  if (!spec) return null;
  return { url: spec.url.replace(/\/songs$/, '/albums'), searchText: spec.searchText };
}

// The album page lives at /albums/<ASIN> — a 10-char uppercase ASIN, unlike
// the long token playlist ids use. The gql search response carries node.url
// with a ?ref= tracker; both that and the bare canonical form yield the ASIN.
function amazonAlbumAsinFromUrl(url) {
  const m = String(url || '').match(/music\.amazon\.com\/albums\/([A-Za-z0-9]{10})(?:[/?#]|$)/i);
  return m ? m[1].toUpperCase() : null;
}

// The album-detail request the page fired for OUR album — the same
// capture-and-replay pattern as playlistDetail. The album page fires it as
// AlbumDetailPage with variables.id = the ASIN (live-captured 2026-10), but
// it also fires OTHER reads whose variables carry the ASIN: AlbumSeo (the
// header-only op — its response has data.album with title/trackCount but no
// tracksConnection) arrives FIRST on a real page, and an unrelated read that
// happens to hold the ASIN may too. So first-arrival must not win: candidates
// are ranked — detail-named, then album-named, then (with { anyName: true },
// the hornet-rename hedge) any read carrying the ASIN — and the caller
// verifies the REPLAY carries data.album.tracksConnection (albumTracksConnectionIn)
// before accepting one. Write-shaped names (a replay would repeat the action
// on the user's account) never are candidates.
function amazonAlbumDetailCandidates(bodies, asin, { anyName = false } = {}) {
  const wanted = String(asin || '').toUpperCase();
  if (!wanted || wanted === 'UNDEFINED' || wanted === 'NULL') return [];
  const detail = [];
  const named = [];
  const other = [];
  for (const raw of (Array.isArray(bodies) ? bodies : [])) {
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { continue; }
    const batch = Array.isArray(parsed) ? parsed : [parsed];
    for (const req of batch) {
      const opName = String((req && req.operationName) || '');
      if (GQL_WRITE_OP.test(opName) || GQL_MUTATION_NAME.test(opName)) continue;
      if (/^\s*mutation\b/.test(String((req && req.query) || ''))) continue;
      const vars = req && req.variables;
      if (!vars || typeof vars !== 'object') continue;
      if (String(vars.id || '').toUpperCase() !== wanted) continue;
      if (/detail/i.test(opName)) detail.push(req);
      else if (/album/i.test(opName)) named.push(req);
      else if (anyName) other.push(req);
    }
  }
  return [...detail, ...named, ...other];
}

function amazonAlbumDetailRequest(bodies, asin, { anyName = false } = {}) {
  return amazonAlbumDetailCandidates(bodies, asin, { anyName })[0] || null;
}

// Whether a replayed response IS the album detail: data.album carrying a
// tracksConnection with an edges array (empty edges are fine — a pre-order /
// fully-delisted album still comes from the detail op; the header-only
// AlbumSeo response has data.album WITHOUT tracksConnection).
function albumTracksConnectionIn(data) {
  const album = data && data.album;
  const tc = album && album.tracksConnection;
  return !!(tc && Array.isArray(tc.edges));
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

// The widest imageType=PRIMARY image, else the widest image overall. The
// playlist cover and the per-track art use the same pick.
function gqlPrimaryImageUrl(images) {
  const list = (Array.isArray(images) ? images : []).filter(i => i && i.url);
  const widest = (l) => (l.length ? l.reduce((a, b) => ((b.width || 0) >= (a.width || 0) ? b : a)) : null);
  return (widest(list.filter(i => i.imageType === 'PRIMARY')) || widest(list) || {}).url || null;
}

// One tracks.edges[] entry -> the lookupPlaylist track shape. Artist is the
// joined contributing artists (PRIMARY first); album is the album shortTitle
// (the detail response has no full album title). A row without asin + title +
// artist is dropped (the import path filters on both anyway). The same mapper
// serves the search response — its edges carry the same Track entity
// (live-verified 2026-10: id/title/contributingArtists/album/duration/images
// Amazon renders the explicit tag as a marker INSIDE the title text
// ("Kunnioita [Explicit]") — the gql Track node carries no explicit field.
// Left in, the tag pollutes every downstream consumer that compares this
// title against another provider's spelling (cross-resolver enrichment, sync
// mirrors, and scrobbles — "Kunnioita [Explicit]" is a different Last.fm
// track). Strip a TRAILING bracketed/parenthesized "explicit" marker (the
// only shape Amazon uses) and report it, so the edge mapper can set the
// explicit flag the payload itself lacks. A bare word ("Sexually Explicit")
// is the track's real title and is left alone.
function stripAmazonTitleMarker(title) {
  const raw = String(title || '');
  const m = raw.match(/^(.*?)\s*[[(]\s*explicit\s*[\])]\s*$/i);
  if (!m) return { title: raw.trim(), explicit: false };
  return { title: m[1].trim(), explicit: true };
}

// are identical shapes), and the search flow additionally uses the art.
// The joined artist credit for a contributingArtists connection: the
// PRIMARY-role artists, else every named artist. Shared by the playlist and
// search track mapper, the album search mapper, and the album detail mappers.
function gqlPrimaryArtistNames(connection) {
  const artists = (connection && Array.isArray(connection.edges)) ? connection.edges : [];
  const primary = artists.filter(a => a && a.node && a.node.name && a.role === 'PRIMARY');
  const all = artists.filter(a => a && a.node && a.node.name);
  const chosen = primary.length ? primary : all;
  return chosen.map(a => a.node.name).join(', ');
}

// Only Track entities import: the search response asks for __typename, and an
// album/artist-spec edge (an Album node) must never become a track — an album
// ASIN in the track slot passes the confidence gate on self-titled releases
// and playback loads /tracks/<albumAsin>. Absent __typename (the playlist
// detail response does not request it) is allowed.
function playlistTrackFromGqlEdge(edge) {
  const node = edge && edge.node;
  if (!node || !node.id || !node.title) return null;
  if (node.__typename && node.__typename !== 'Track') return null;
  const artist = gqlPrimaryArtistNames(node.contributingArtists);
  if (!artist) return null;
  const cleaned = stripAmazonTitleMarker(node.title);
  if (!cleaned.title) return null;
  const album = node.album || {};
  return {
    asin: node.id,
    title: cleaned.title.slice(0, 200),
    artist: artist.slice(0, 200),
    album: String(album.shortTitle || album.title || '').slice(0, 200),
    albumAsin: album.id || null,
    albumArt: gqlPrimaryImageUrl(node.images) || null,
    duration: typeof node.duration === 'number' ? node.duration : 0,
    explicit: cleaned.explicit
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
  const cover = gqlPrimaryImageUrl(playlist.images);
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

// --- Playlist pagination (a >page-size playlist arrives in pages) ---
// The server clamps the page size (a 977-track playlist answered 100 rows
// however high firstLimit was raised), so the import has to follow the
// playlist's own pagination. Everything below is learned from the page or the
// response — no param name or cursor format is hardcoded against hornet.

// The connection's pageInfo, when the response carries one. hasNextPage null =
// absent; endCursor null = absent. Returns null when there is no pageInfo at
// all (the caller falls back to scroll-driven pagination).
function playlistPageInfoFromGql(data) {
  const tracks = data && data.playlist && data.playlist.tracks;
  const pageInfo = tracks && tracks.pageInfo;
  if (!pageInfo || typeof pageInfo !== 'object') return null;
  const endCursor = pageInfo.endCursor == null ? null : String(pageInfo.endCursor);
  const hasNextPage = typeof pageInfo.hasNextPage === 'boolean' ? pageInfo.hasNextPage : null;
  // token is the page's OWN continuation state (a composite base64 blob) —
  // the value the next request passes as afterCursor. Live-verified 2026-10:
  // the token advances the pages; the Relay-style endCursor is ignored by the
  // server (page 1 repeats) and the dependent blob alone errors.
  const token = typeof pageInfo.token === 'string' && pageInfo.token ? pageInfo.token : null;
  return { hasNextPage, endCursor, token };
}

// The response's track edges. The playlistDetail envelope is
// data.playlist.tracks.edges; a continuation operation may answer with a
// different envelope, so fall back to a bounded scan for any edges[] whose
// nodes look like playlist rows (id + title).
function playlistEdgesFromGql(data) {
  const tracks = data && data.playlist && data.playlist.tracks;
  if (tracks && Array.isArray(tracks.edges)) return tracks.edges;
  const looksLikeRow = (edges) =>
    Array.isArray(edges) && edges.some(e => e && e.node && e.node.id && e.node.title);
  const scan = (value, depth) => {
    if (depth > 4 || !value || typeof value !== 'object') return null;
    if (looksLikeRow(value.edges)) return value.edges;
    for (const key of Object.keys(value)) {
      const found = scan(value[key], depth + 1);
      if (found) return found;
    }
    return null;
  };
  return scan(data, 0);
}

// The SpecSearchSeeMorePage response -> the searchTracks result. The
// response answers with data.specificationSearch.result[], the spec result
// carrying edges[].node = the same Track entity the playlist detail returns
// (shared edge mapper above). A miss is a present envelope with empty edges;
// an absent envelope (hornet renamed the field) is a structural failure — the
// caller must throw not-ready, not cache a 30-day noMatch. Returns
// { tracks, envelope }.
function searchTracksFromGql(data) {
  const search = data && data.specificationSearch;
  if (!search || typeof search !== 'object') return { tracks: [], envelope: false };
  const results = Array.isArray(search.result) ? search.result : [];
  let spec = null;
  for (const r of results) {
    if (r && Array.isArray(r.edges) && r.edges.length) { spec = r; break; }
  }
  if (!spec) {
    for (const r of results) {
      if (r && Array.isArray(r.edges)) { spec = r; break; }
    }
  }
  const tracks = ((spec && spec.edges) || [])
    .map(playlistTrackFromGqlEdge)
    .filter(Boolean);
  return { tracks, envelope: true };
}

// --- Album search / lookup (capabilities.albumSearch in the plugin) -------
// The album-spec SpecSearchSeeMorePage response and the AlbumDetailPage
// response (both shapes live-verified 2026-10 via the page's own requests,
// replayed verbatim like the track search and playlistDetail).
//
// Search: data.specificationSearch.result[] carries edges[] whose node is an
// ALBUM entity this time: id (ASIN), title (may end in the bracketed explicit
// marker, like track titles), shortTitle, contributingArtists, images and url
// — the Album node has no releaseDate/trackCount in the search spec, so those
// stay null in the mapped result (the plugin contract allows it). Only Album
// nodes map: a Track edge in the album slot is the same ASIN-in-the-wrong-
// slot failure the track parser guards against, in reverse.
function albumFromGqlSearchNode(node) {
  if (!node || node.__typename !== 'Album' || !node.id) return null;
  const artist = gqlPrimaryArtistNames(node.contributingArtists);
  if (!artist) return null;
  const cleaned = stripAmazonTitleMarker(node.title || node.shortTitle || '');
  if (!cleaned.title) return null;
  return {
    asin: node.id,
    name: cleaned.title.slice(0, 200),
    artist: artist.slice(0, 200),
    albumArt: gqlPrimaryImageUrl(node.images) || null,
    // node.url exists but carries a ?ref= tracker; the canonical album URL is
    // the form lookupAlbum parses anyway, so mint it from the ASIN.
    url: 'https://music.amazon.com/albums/' + node.id,
    explicit: cleaned.explicit || !!(node.parentalSettings && node.parentalSettings.hasExplicitLanguage)
  };
}

// The album-spec response -> the searchAlbums bridge shape. Same envelope
// semantics as searchTracksFromGql: a miss is a present envelope with no
// usable edges; an absent envelope (hornet renamed the field) is structural.
function searchAlbumsFromGql(data) {
  const search = data && data.specificationSearch;
  if (!search || typeof search !== 'object') return { albums: [], envelope: false };
  const results = Array.isArray(search.result) ? search.result : [];
  let spec = null;
  for (const r of results) {
    if (r && Array.isArray(r.edges) && r.edges.length) { spec = r; break; }
  }
  if (!spec) {
    for (const r of results) {
      if (r && Array.isArray(r.edges)) { spec = r; break; }
    }
  }
  const albums = ((spec && spec.edges) || [])
    .map(e => albumFromGqlSearchNode(e && e.node))
    .filter(Boolean);
  return { albums, envelope: true };
}

// --- Artist images (capabilities.artistImage in the plugin) ---------------
// The artists tab (/search/<q>/artists — plural, like /songs and /albums;
// the singular /artist path fires nothing matchable) fires the same
// SpecSearchSeeMorePage operation as the track and album searches, with
// variables.specType = 'artist' (live-verified 2026-10 via the in-app debug
// capture and a specSearch probe). Its response bucket is labeled
// 'requiredButUnused' — the SAME label the album see-more bucket uses — so
// the parser never matches on label: it takes the first result with edges,
// like the track and album parsers, and accepts only Artist nodes inside it.

// The artists-tab URL for an artist NAME (the artist-image chain passes a
// bare name, never the search object's title/artist pair). The name is
// quoted like the single-artist album query: Amazon's matching is
// order/phrase-sensitive, and a quoted name is the closest thing to an
// exact-name search the page offers. Returns { url, searchText } (searchText
// is what the page puts in variables.searchText, so the runner can find its
// own request), null when there is nothing to search.
function amazonArtistSearchUrl(artistName) {
  // The name is track metadata, not typed text: control characters never
  // belong in it. One surviving into searchText and being normalized
  // differently by hornet would leave the runner waiting out its capture
  // window for a request it can never match — one junk name tripping the
  // shared search breaker.
  const name = String(artistName || '').replace(/"/g, '').replace(/[\p{Cc}]+/gu, ' ').trim();
  if (!name) return null;
  const q = '"' + name + '"';
  let url;
  try {
    url = 'https://music.amazon.com/search/' + encodeURIComponent(q) + '/artists';
  } catch (e) {
    // A lone surrogate in metadata makes encodeURIComponent throw; a name
    // that malformed is garbage, not a search — miss, never an exception.
    return null;
  }
  return { url, searchText: q };
}

// Mirrors normalizeArtistName in src/renderer/lib/album-catalog.js (the
// normalization the Deezer step of the artist-image chain matches on): case,
// diacritic marks, a leading "The", "&" and punctuation are folded away.
// Kept as a local copy — this module must not depend on renderer sources.
function amazonNormalizeArtistName(name) {
  let out = String(name || '');
  try { out = out.normalize('NFKD').replace(/\p{M}/gu, ''); } catch (e) { /* old engines */ }
  return out.toLowerCase().replace(/^the\s+/, '').replace(/&/g, 'and').replace(/[^\p{L}\p{N}]+/gu, '');
}

// One artist-spec edges[] entry -> { asin, name, imageUrl }. Only Artist
// nodes map: a Track/Album/Station edge in the artist slot is the
// ASIN-in-the-wrong-slot failure the track and album parsers guard against,
// and a misfiled entity here would pin the wrong photo on the artist for 90
// days (CACHE_TTL.artistImage — the host persists artist images in its image
// cache). The photo pick
// is the widest PROFILE image (the square artist photo; BACKGROUND is a wide
// banner — albums use PRIMARY, artists do not have one), else the widest
// image overall. Only a bare https URL on
// Amazon's m.media-amazon.com CDN qualifies: the photo goes into the
// persisted cache, so anything else — another host (a third-party tracking
// pixel would persist and load on every render) or a query string (Amazon
// has never signed these; a '?' would be new, and a credential-bearing URL
// must not be stored) — is skipped. imageUrl is null when the artist has no
// usable photo at all — the caller reports a miss for that artist, never
// another artist's photo.
function artistFromGqlSearchNode(node) {
  if (!node || node.__typename !== 'Artist' || !node.id || !node.name) return null;
  const usable = (Array.isArray(node.images) ? node.images : [])
    .filter(i => i && typeof i.url === 'string' && /^https:\/\/m\.media-amazon\.com\//i.test(i.url) && !i.url.includes('?'));
  const widest = (l) => (l.length ? l.reduce((a, b) => ((b.width || 0) >= (a.width || 0) ? b : a)) : null);
  const picked = widest(usable.filter(i => i.imageType === 'PROFILE')) || widest(usable);
  return { asin: node.id, name: String(node.name).slice(0, 200), imageUrl: picked ? picked.url : null };
}

// The artist-spec response -> the artist's photo URL, or null. Same envelope
// semantics as searchAlbumsFromGql: a miss is a present envelope with no
// usable match; an absent envelope (hornet renamed the field) is structural.
//
// The edges are ranked by Amazon and the top hit is not always the exact
// name ('warning' leads with 'The Warning', and both fold to the same key
// anyway). The photo comes only from the FIRST node whose normalized name
// equals the requested one — never from another artist the search happened
// to rank higher, however similar ('Fates Warning' is not 'Warning').
function searchArtistImageFromGql(data, artistName) {
  const search = data && data.specificationSearch;
  if (!search || typeof search !== 'object') return { url: null, envelope: false };
  const results = Array.isArray(search.result) ? search.result : [];
  let spec = null;
  for (const r of results) {
    if (r && Array.isArray(r.edges) && r.edges.length) { spec = r; break; }
  }
  if (!spec) {
    for (const r of results) {
      if (r && Array.isArray(r.edges)) { spec = r; break; }
    }
  }
  const artists = ((spec && spec.edges) || [])
    .map(e => artistFromGqlSearchNode(e && e.node))
    .filter(Boolean);
  const wanted = amazonNormalizeArtistName(artistName);
  if (!wanted) return { url: null, envelope: true };
  const match = artists.find(a => amazonNormalizeArtistName(a.name) === wanted);
  return { url: (match && match.imageUrl) || null, envelope: true };
}

// One AlbumDetailPage tracksConnection.edges[] entry -> the album track
// shape. Like the playlist/search row (shared contributingArtists and
// title-marker handling) plus trackNumber, and the explicit flag from
// parentalSettings when the title carries no marker (the detail response
// carries both — "Dumpweed [Explicit]" with hasExplicitLanguage true).
// Per-track artists matter on compilations: a Various Artists row keeps its
// own artists, not the album's.
function albumTrackFromGqlEdge(edge) {
  const node = edge && edge.node;
  if (!node || !node.id || !node.title) return null;
  if (node.__typename && node.__typename !== 'Track') return null;
  const artist = gqlPrimaryArtistNames(node.contributingArtists);
  if (!artist) return null;
  const cleaned = stripAmazonTitleMarker(node.title);
  if (!cleaned.title) return null;
  return {
    asin: node.id,
    title: cleaned.title.slice(0, 200),
    artist: artist.slice(0, 200),
    duration: typeof node.duration === 'number' ? node.duration : 0,
    trackNumber: typeof node.trackNumber === 'number' ? node.trackNumber : null,
    explicit: cleaned.explicit || !!(node.parentalSettings && node.parentalSettings.hasExplicitLanguage)
  };
}

// The album detail response numbers tracks per disc (1..n, 1..m — verified
// on 2-disc, 3-disc and 100-track sets) but carries no discNumber field
// anywhere: a trackNumber that does not advance past the previous one starts
// a new disc. Rows without a trackNumber keep discNumber null (the plugin
// contract has it "when known").
function assignDiscNumbers(tracks) {
  let disc = 1;
  let prev = 0;
  for (const t of tracks) {
    if (typeof t.trackNumber === 'number') {
      if (t.trackNumber <= prev) disc += 1;
      prev = t.trackNumber;
      t.discNumber = disc;
    } else {
      t.discNumber = null;
    }
  }
  return tracks;
}

// The AlbumDetailPage response's data.album -> the lookupAlbum bridge shape.
// The tracksConnection has no pageInfo at all (a 100-track album answers all
// 100 edges in one response — live-verified), so unlike playlistDetail there
// is no continuation to follow; trackCount above the edge count is logged by
// the caller as a truncation, the way a short playlist page is. Returns
// { album, envelope }: data.album null is a legitimate not-found (deleted /
// other region), a data object with no 'album' field at all is a hornet
// rename (structural — the caller throws instead of reporting a miss).
function albumDetailFromGql(data) {
  if (!data || typeof data !== 'object' || !('album' in data)) {
    return { album: null, envelope: false };
  }
  const album = data.album;
  if (!album || typeof album !== 'object') return { album: null, envelope: true };
  const artist = gqlPrimaryArtistNames(album.contributingArtists);
  const cleaned = stripAmazonTitleMarker(album.title || album.shortTitle || '');
  const edges = (album.tracksConnection && Array.isArray(album.tracksConnection.edges))
    ? album.tracksConnection.edges : [];
  const tracks = assignDiscNumbers(edges.map(albumTrackFromGqlEdge).filter(Boolean));
  return {
    album: {
      asin: album.id || null,
      // The full title (editions distinguish releases), not shortTitle.
      name: (cleaned.title || album.shortTitle || '').slice(0, 200),
      artist: artist.slice(0, 200) || null,
      albumArt: gqlPrimaryImageUrl(album.images) || null,
      releaseDate: typeof album.releaseDate === 'string' ? album.releaseDate : null,
      trackCount: typeof album.trackCount === 'number' ? album.trackCount : tracks.length,
      url: album.id ? 'https://music.amazon.com/albums/' + album.id : null,
      explicit: cleaned.explicit || !!(album.parentalSettings && album.parentalSettings.hasExplicitLanguage),
      tracks
    },
    envelope: true
  };
}

// Follow a playlist's own pagination to the end of the list. The gql server
// serves one page per request however high firstLimit is raised, and the ONLY
// continuation it accepts is the response's pageInfo.token passed as the
// afterCursor variable (live-verified 2026-10 — the Relay-style endCursor is
// a decoy the server answers with page 1 for, other variable names are
// dropped, the dependent blob alone errors "Invalid sequence token"). Each
// response's own token drives the next page.
//
// Pure except the injected fetchPage (one gql page by token: { error } or
// { data }) and now() (the time cap) — the same pattern as the Amazon poller,
// so every stop condition is unit-testable.
//
// Progress is judged on RAW edges, never mapped tracks (review feedback on
// #1072): a page that is entirely delisted rows (node:null) maps to zero
// tracks but still advances — later pages can exist after a label pulls its
// catalog — and a duplicate track that happens to be first on two consecutive
// pages is not a repeated window. The per-edge cursor (position-encoded:
// "128:dfeab136-…128") distinguishes a genuine advance from the same window
// served again.
//
// Returns { playlist, pages, stop }:
//   'complete'    — every row merged (tracks >= trackCount)
//   'exhausted'   — the server is out of pages (no token / hasNextPage false)
//   'page-error'  — fetchPage answered an error (a later page may exist)
//   'empty-page'  — a page with zero raw edges
//   'no-advance'  — a page starting at the same cursor as the previous one
//   'page-limit'  / 'time-limit' — the caps
//   'no-playlist' — the first page has no playlist (deleted/private/region)
async function paginatePlaylistTracks({ firstPageData, fetchPage, maxPages = 40, maxMs = 120000, now = Date.now, log = () => {} }) {
  const playlist = playlistFromGql(firstPageData);
  if (!playlist) return { playlist: null, pages: 0, stop: 'no-playlist' };
  const firstEdges = playlistEdgesFromGql(firstPageData) || [];
  let lastFirstCursor = firstEdges.length && firstEdges[0] && firstEdges[0].cursor != null
    ? String(firstEdges[0].cursor) : null;
  let pageInfo = playlistPageInfoFromGql(firstPageData);
  const startedAt = now();
  let pages = 0;
  let stop = null;
  while (!stop) {
    if (playlist.tracks.length >= playlist.trackCount) { stop = 'complete'; break; }
    if (!pageInfo || !pageInfo.token || pageInfo.hasNextPage === false) { stop = 'exhausted'; break; }
    if (pages >= maxPages) { stop = 'page-limit'; break; }
    if (now() - startedAt >= maxMs) { stop = 'time-limit'; break; }
    pages += 1;
    const page = await fetchPage(pageInfo.token);
    if (!page || page.error) { stop = 'page-error'; break; }
    const data = page.data;
    const edges = (data && playlistEdgesFromGql(data)) || [];
    if (!edges.length) { stop = 'empty-page'; break; }
    const firstCursor = edges[0] && edges[0].cursor != null ? String(edges[0].cursor) : null;
    if (firstCursor != null && firstCursor === lastFirstCursor) { stop = 'no-advance'; break; }
    lastFirstCursor = firstCursor;
    let mappedAdded = 0;
    for (const edge of edges) {
      const track = playlistTrackFromGqlEdge(edge);
      if (track) {
        playlist.tracks.push(track);
        mappedAdded++;
      }
    }
    const info = data ? playlistPageInfoFromGql(data) : null;
    if (info) pageInfo = info;
    const respCount = data && data.playlist && data.playlist.trackCount;
    if (typeof respCount === 'number' && respCount > playlist.trackCount) playlist.trackCount = respCount;
    log(`page ${pages}: +${edges.length} rows (+${mappedAdded} tracks, ${playlist.tracks.length}/${playlist.trackCount})`);
  }
  return { playlist, pages, stop };
}

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

function isAmazonMusicPage(url) {
  try {
    return new URL(url).origin === 'https://music.amazon.com';
  } catch {
    return false;
  }
}

// ── Diagnostic: gql shapes from a live page ─────────────────────────────────
// Album search and album lookup for the Amazon plugin need the request and
// response shapes Amazon's own album and search pages use, and only a live
// signed-in session shows them (every Amazon flow replays the page's own
// request; see docs/architecture/amazon-music.md). amazonWebPlayer's
// debugCaptureGql records them; these pure helpers decide what it replays and
// what may be written to disk.

// What a page is about: an album page's ASIN, or a search page's text and tab
// (/search/<text>/albums, /search/<text>/songs, ...). null for anything else.
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

// ── Native playback (dmls client + DASH variant selection) ─────────────────
//
// The native engine (amazon-native-player.js) plays a track without the
// hornet page in the audio path: main fetches the DASH manifest from the
// Digital Music Locator Service (dmls) and a bundled Shaka in our own window
// decrypts it (the license bytes round-trip through dmls opaquely, relayed by
// main). These are the pure pieces: request bodies, the region segment, and
// the mapping from the user's quality setting to one manifest variant.

const AMAZON_DEVICE_TYPE_ID = 'A16ZV8BU3SN1N3';
const DML_TARGET_PREFIX = 'com.amazon.digitalmusiclocator.DigitalMusicLocatorServiceExternal.';
// An empty Widevine challenge the hornet page sends before its first real
// per-track license exchange (session/cert init). Mimic it once per session.
const WIDEVINE_CERT_CHALLENGE = 'CAQ=';

// Region segment in the dmls URL, derived from the session territory.
const AMAZON_FE_TERRITORIES = new Set(['JP', 'AU', 'NZ', 'SG', 'MY', 'ID', 'TH', 'PH', 'KR', 'TW', 'IN', 'HK']);
const AMAZON_EU_TERRITORIES = new Set(['GB', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'IE', 'SE', 'DK', 'NO', 'FI', 'PL', 'PT', 'CH', 'CZ', 'GR', 'HU', 'RO', 'TR']);
function amazonDmlsRegion(territoryId) {
  const t = String(territoryId || '').toUpperCase();
  if (AMAZON_FE_TERRITORIES.has(t)) return 'FE';
  if (AMAZON_EU_TERRITORIES.has(t)) return 'EU';
  return 'NA';
}

function amazonDmlsManifestBody({ asin, customerId, marketplaceId, territoryId, deviceId, musicAgent, dashVersions } = {}) {
  if (!asin || !customerId || !deviceId) return null;
  return {
    appInfo: { musicAgent: String(musicAgent || '') },
    customerId,
    customerInfo: {
      marketplaceId: String(marketplaceId || 'ATVPDKIKX0DER'),
      territoryId: String(territoryId || 'US')
    },
    contentIdList: [{ identifier: String(asin), identifierType: 'ASIN' }],
    deviceToken: { deviceTypeId: AMAZON_DEVICE_TYPE_ID, deviceId: String(deviceId) },
    musicDashVersionList: Array.isArray(dashVersions) && dashVersions.length ? dashVersions.map(String) : ['SIREN_KATANA'],
    contentProtectionList: ['TRACK_PSSH'],
    tryAsinSubstitution: true
  };
}

function amazonDmlsLicenseBody({ challenge, customerId, deviceId, musicAgent } = {}) {
  if (!challenge || !customerId || !deviceId) return null;
  return {
    DrmType: 'WIDEVINE',
    licenseChallenge: String(challenge),
    customerId,
    deviceToken: { deviceTypeId: AMAZON_DEVICE_TYPE_ID, deviceId: String(deviceId) },
    appInfo: { musicAgent: String(musicAgent || '') }
  };
}

// ── Plan-tier eligibility (the muse getEligibility call, #1196) ─────────────
// Amazon Music plans can play different catalogs ON DEMAND. On a Prime-only
// account a track that is Unlimited-only (isPrime: false) cannot be played on
// demand — Amazon starts a station seeded from it instead, i.e. the wrong
// music after the source was already chosen. muse's getEligibility answers
// the catalog flags for a batch of ASINs in one call:
//   POST https://music.amazon.com/<REGION>/api/muse/getEligibility
//   X-Amz-Target com.amazon.muse.MuseServiceExternal.getEligibility
//   { customerId, deviceType, deviceId, musicTerritory, requestedContent, asins }
// Content-Type application/json + Content-Encoding amz-1.0 + the csrf triplet
// + the session Cookie — the same signed envelope the dmls calls use (the
// region segment is the session's siteRegion, e.g. NA for US).
const MUSE_TARGET_PREFIX = 'com.amazon.muse.MuseServiceExternal.';

// Verdicts are cached per ASIN so a playlist resolve is not one call per
// track. Catalog membership drifts slowly; a day is fine, and sign-out drops
// the cache with the rest of the session state.
const ELIGIBILITY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// A FAILED lookup is remembered too: after one, no getEligibility calls for
// this long, so a broken/rotated endpoint doesn't tax every search (#1198
// review #3). Cached verdicts still apply during the backoff; only the
// round trip pauses.
const ELIGIBILITY_FAILURE_BACKOFF_MS = 10 * 60 * 1000;

// Which eligibility flag the account's plan tier gates on. Only PRIME filters
// today (#1196): an Unlimited account plays the full catalog on demand, and
// the "isMusicSubscription covers every playable track" assumption still
// needs a live check before it gates anything. An unrecognized tier means
// DON'T FILTER — verdicts only ever remove results, so a wrong mapping would
// silently drop playable music.
function amazonEligibilityFlagForTier(tier) {
  return String(tier || '').trim().toUpperCase() === 'PRIME' ? 'isPrime' : null;
}

// The getEligibility body: customer/device are the same values the
// getDashManifestsV2 body sends (the device type is the web player's
// registered id — the AMAZON_DEVICE_TYPE_ID constant dmls uses), and the
// territory is the marketplace the account is signed into (config.json's
// musicTerritory, not a secret). requestedContent 'KATANA' is the on-demand
// streaming catalog the web player gates with.
function amazonEligibilityBody({ asins, customerId, deviceId, territoryId } = {}) {
  const list = [];
  const seen = new Set();
  for (const a of Array.isArray(asins) ? asins : []) {
    const asin = String(a || '').trim();
    if (asin && !seen.has(asin)) { seen.add(asin); list.push(asin); }
  }
  if (!list.length || !customerId || !deviceId) return null;
  return {
    customerId: String(customerId),
    deviceType: AMAZON_DEVICE_TYPE_ID,
    deviceId: String(deviceId),
    musicTerritory: String(territoryId || 'US'),
    requestedContent: 'KATANA',
    asins: list
  };
}

// The response's trackEligibilityMap: asin → catalog flags. isPrime — the
// track is in the Prime catalog; isMusicSubscription — it needs an Amazon
// Music subscription; isHighQuality — HD/UHD; isSonicRush — Atmos. A missing
// envelope is NOT an empty verdict: the caller treats it as "the call
// failed" and keeps the results, so a hornet rename of the response field can
// never wipe a search. An EMPTY map is a valid answer — everything asked was
// ineligible.
function amazonEligibilityFromResponse(json) {
  const map = json && typeof json === 'object' ? json.trackEligibilityMap : null;
  if (!map || typeof map !== 'object' || Array.isArray(map)) return null;
  const verdicts = {};
  for (const [asin, entry] of Object.entries(map)) {
    const e = entry && typeof entry === 'object' ? entry : {};
    verdicts[asin] = {
      isPrime: e.isPrime === true,
      isMusicSubscription: e.isMusicSubscription === true,
      isHighQuality: e.isHighQuality === true,
      isSonicRush: e.isSonicRush === true
    };
  }
  return verdicts;
}

// Drop the tracks a SUCCEEDED lookup says the plan's flag does not cover.
// verdicts === null is the failed-call shape: keep EVERYTHING — eligibility
// filtering never makes a search worse than today. A track whose ASIN has no
// entry in a succeeded response is not eligible ("a missing map entry means
// not eligible"); a track with no ASIN at all cannot be judged and stays.
function amazonFilterTracksByEligibility(tracks, verdicts, flag) {
  if (!Array.isArray(tracks) || !verdicts || !flag) return tracks;
  return tracks.filter((t) => {
    const asin = t && typeof t.asin === 'string' ? t.asin : null;
    if (!asin) return true;
    const v = verdicts[asin];
    return !!(v && v[flag] === true);
  });
}

// Codec bucket of a DASH codec string (mpdAudioRepresentations rep.codec).
function dashCodecFamily(codec) {
  const c = String(codec || '').toLowerCase();
  if (c.startsWith('flac')) return 'flac';
  if (c.startsWith('opus')) return 'opus';
  if (c.startsWith('mp4a') || c.startsWith('aac')) return 'aac';
  return c || null;
}

// Deterministic order inside a tier: bandwidth desc, then sampleRate desc,
// then bitDepth desc, then id (stable). Used for both picking and ABR caps.
function compareDashReps(a, b) {
  const bw = (b.bandwidth || 0) - (a.bandwidth || 0);
  if (bw) return bw;
  const sr = (b.sampleRate || 0) - (a.sampleRate || 0);
  if (sr) return sr;
  const bd = (b.bitDepth || 0) - (a.bitDepth || 0);
  if (bd) return bd;
  return String(a.id || '').localeCompare(String(b.id || ''));
}

// GET https://music.amazon.com/config.json answers the session facts the
// native engine needs in one shot (cookies only, no CSRF): customer,
// marketplace, territory, and the dmls region segment itself (siteRegion).
// Parse defensively — every field degrades to null.
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

// ── Streaming telemetry (the hornet /telemetry/v1/events vocabulary) ────────
// Live-captured 2026-10: the web player reports streamingInitiated on play
// start, streamingTerminated at seek/pause/teardown/end, and trackStreamed
// paired with the FINAL terminated (carrying the accumulated
// durationSecondsSum). terminationReason: trackScrub (seek), userStop
// (pause), systemStop (teardown/advance), trackFinished (natural end).
// These builders produce clientActionList entries in that exact shape; the
// reporter (main-process/amazon-telemetry.js) owns session ids and sums.
// All fields are strings, mirroring hornet's serialization.

const AMAZON_TELEMETRY_CONSTANTS = Object.freeze({
  appVersion: '1.0.1458',
  productId: '803',
  productVersion: 'GREENHORNET',
  platformName: 'WebPlayer',
  mediaPlayerName: 'VINYL',
  playbackSourceType: 'stream',
  playbackCurrentSpeed: 'ONE',
  pageType: 'trackDetail',
  streamOrDRMTech: 'DASH_DRM',
  cacheHitStatus: 'NONE',
  enqueueState: 'audio',
  offlineMode: 'ONLINE_MODE',
  isOnDemandQueue: 'true',
  isDirectedPlay: 'true',
  isShufflePlay: 'false',
  isVoiceInitiated: 'false',
  isAugmentedTrack: 'false',
  isExplicitLanguageFilterOn: 'false',
  isCustomerSelectedEntity: 'true',
  source: 'WIFI',
  deviceConnectivity: 'WiFi',
  locale: 'en_US'
});

const TELEMETRY_TERMINATION = Object.freeze({
  scrub: 'trackScrub',
  userStop: 'userStop',
  systemStop: 'systemStop',
  finished: 'trackFinished'
});

// Amazon's bitrate-tier labels (from captured UHD48 for 24/48 FLAC). The
// ladder below is approximate — conservative family+rate naming.
function amazonTelemetryBitrateLabel({ codec, sampleRate, bitDepth } = {}) {
  const family = dashCodecFamily(codec);
  const rate = Number(sampleRate) || 44.1;
  const depth = Number(bitDepth) || 16;
  if (family === 'flac') return depth >= 24 ? (rate > 44.1 ? 'UHD48' : 'UHD44') : (rate > 44.1 ? 'HD48' : 'HD44');
  return 'SD';
}

function amazonClientAction(actionName, details, { timestampSeconds, sdkEventId } = {}) {
  if (!actionName || !details) return null;
  return {
    actionName: String(actionName),
    timestamp: Number(timestampSeconds) || 0,
    contentInfo: [],
    additionalDetails: {
      ...details,
      ...(sdkEventId ? { sdkEventId: String(sdkEventId) } : {})
    }
  };
}

// Streaming facts shared by all three event kinds (mirroring the captured
// blocks; every undefined input simply drops out).
function amazonStreamingDetails({
  asin, albumAsin, territory, tier, playbackInstanceId, playQueueId,
  subscriptionMode, resourceType, bitrates, durationSeconds, durationSecondsSum,
  terminationReason, trackProgress, trackCount, initialPlaybackDelaySeconds,
  rebufferCount, transferSpeedBPS, cdnType, customSessionId, csrf, deviceTimeZone,
  appVersion
} = {}) {
  const d = {
    customSessionId,
    customSessionType: 'foreground_session',
    asin,
    appVersion: appVersion || AMAZON_TELEMETRY_CONSTANTS.appVersion,
    deviceTimeZone,
    isDirectedPlay: AMAZON_TELEMETRY_CONSTANTS.isDirectedPlay,
    isExplicitLanguageFilterOn: AMAZON_TELEMETRY_CONSTANTS.isExplicitLanguageFilterOn,
    isShufflePlay: AMAZON_TELEMETRY_CONSTANTS.isShufflePlay,
    isVoiceInitiated: AMAZON_TELEMETRY_CONSTANTS.isVoiceInitiated,
    ...(albumAsin ? {
      selectionSourceId: albumAsin,
      selectionSourceSessionId: playQueueId,
      selectionSourceType: 'ALBUM',
      fulfillmentSourceId: albumAsin,
      fulfillmentSourceType: 'ALBUM'
    } : {}),
    contentSubscriptionMode: subscriptionMode || tier,
    subContentSubscriptionMode: subscriptionMode || tier,
    pageType: AMAZON_TELEMETRY_CONSTANTS.pageType,
    playbackCurrentSpeed: AMAZON_TELEMETRY_CONSTANTS.playbackCurrentSpeed,
    playbackInstanceId,
    playbackSourceType: AMAZON_TELEMETRY_CONSTANTS.playbackSourceType,
    platformName: AMAZON_TELEMETRY_CONSTANTS.platformName,
    isOnDemandQueue: AMAZON_TELEMETRY_CONSTANTS.isOnDemandQueue,
    mediaPlayerName: AMAZON_TELEMETRY_CONSTANTS.mediaPlayerName,
    playQueueId,
    isCustomerSelectedEntity: AMAZON_TELEMETRY_CONSTANTS.isCustomerSelectedEntity,
    productVersion: AMAZON_TELEMETRY_CONSTANTS.productVersion,
    mrn: asin ? `mrn:1.0:catalog:track:asin:${asin}?territory=${territory || 'US'}` : undefined,
    isAugmentedTrack: AMAZON_TELEMETRY_CONSTANTS.isAugmentedTrack,
    source: AMAZON_TELEMETRY_CONSTANTS.source,
    enqueueState: AMAZON_TELEMETRY_CONSTANTS.enqueueState,
    deviceConnectivity: AMAZON_TELEMETRY_CONSTANTS.deviceConnectivity,
    offlineMode: AMAZON_TELEMETRY_CONSTANTS.offlineMode,
    productId: AMAZON_TELEMETRY_CONSTANTS.productId,
    locale: AMAZON_TELEMETRY_CONSTANTS.locale
  };
  // event-specific fields only when meaningful
  if (bitrates != null) d.bitrates = String(bitrates);
  if (durationSeconds != null) d.durationSeconds = String(Number(durationSeconds.toFixed ? durationSeconds.toFixed(3) : durationSeconds));
  if (durationSecondsSum != null) d.durationSecondsSum = String(Number(durationSecondsSum.toFixed ? durationSecondsSum.toFixed(3) : durationSecondsSum));
  if (terminationReason != null) d.terminationReason = String(terminationReason);
  if (trackProgress != null) d.trackProgress = String(Math.round(trackProgress));
  if (trackCount != null) d.trackCount = String(trackCount);
  if (initialPlaybackDelaySeconds != null) d.initialPlaybackDelaySeconds = String(initialPlaybackDelaySeconds);
  if (rebufferCount != null) d.rebufferCount = String(rebufferCount);
  if (transferSpeedBPS != null) d.transferSpeedBPS = String(Math.round(transferSpeedBPS));
  if (cdnType != null) d.cdnType = String(cdnType);
  if (resourceType != null) d.resourceType = String(resourceType);
  if (csrf && csrf.csrfToken) {
    d.csrf = JSON.stringify({ token: csrf.csrfToken, rnd: csrf.csrfRnd, ts: csrf.csrfTs });
  }
  // hornet serializes everything as strings; undefined never survives
  const out = {};
  for (const [k, v] of Object.entries(d)) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === 'string' ? v : String(v);
  }
  return out;
}

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

// The manifest already says which playback tier carries which protection:
// every adaptation set's ContentProtection@default_KID. Amazon issues
// DIFFERENT Widevine keys per rendition group (lossy sets, FLAC set,
// spatial sets) — shaka 4012 (RESTRICTIONS_CANNOT_BE_MET) usually means a
// specific KID is missing output-absolution in the license, and the tier to
// blame is exactly the one named by its KID group. Pure parse from the MPD
// (defensive about malformed input).
function mpdContentProtectionSets(xml) {
  const text = String(xml || '');
  const sets = [];
  if (!text) return sets;
  const attr = (name, tag) => {
    const m = (tag || '').match(new RegExp(name + '="([^"]*)"'));
    return m ? m[1] : null;
  };
  for (const match of text.matchAll(/<AdaptationSet[\s\S]*?<\/AdaptationSet>/g)) {
    const set = match[0];
    const setTag = set.slice(0, set.indexOf('>') + 1);
    const kids = [...set.matchAll(/cenc:default_KID="([^"]+)"/g)].map((m) => m[1]);
    const kid = kids.length ? kids[0] : null;
    const reps = [];
    for (const rep of set.matchAll(/<Representation ([^>]*)>>?/g)) {
      reps.push({
        id: attr('id', rep[1]),
        codecs: attr('codecs', rep[1]),
        bandwidth: Number(attr('bandwidth', rep[1])) || null
      });
    }
    const family = reps.length ? dashCodecFamily(reps[0].codecs) : null;
    sets.push({ kid, family, reps });
  }
  return sets;
}

module.exports = {
  amazonNativeSessionFromConfig,
  mpdContentProtectionSets,
  gqlCaptureSubject,
  gqlRequestsIn,
  gqlRequestIsAboutSubject,
  redactGqlSample,
  summarizeGqlRequest,
  reportedPlaybackAsin,
  amazonMediaPauseExpr,
  amazonPlayGenerationStamp,
  isAmazonMusicPage,
  shouldRevealPlayerOnFailure,
  cdmStatusHealthy,
  pageBlocksPlayback,
  amazonAuthCookieState,
  onMusicHost,
  amazonNowPlayingMismatch,
  signInLanded,
  amazonSongSearchUrl,
  asinFromPlayerUrl,
  amazonPlaylistIdFromUrl,
  amazonPlaylistDetailRequest,
  amazonSpecSearchRequest,
  SPEC_TEMPLATE_MAX_AGE_MS,
  makeSpecSearchTemplate,
  specTemplateIsFresh,
  specBodyWithVars,
  bodyMatchesTemplate,
  createReplayGate,
  amazonAlbumSearchUrl,
  amazonAlbumAsinFromUrl,
  amazonAlbumDetailRequest,
  amazonAlbumDetailCandidates,
  albumTracksConnectionIn,
  amazonGqlFetchHeaders,
  capturedOperationNames,
  searchTracksFromGql,
  albumFromGqlSearchNode,
  searchAlbumsFromGql,
  amazonArtistSearchUrl,
  amazonNormalizeArtistName,
  artistFromGqlSearchNode,
  searchArtistImageFromGql,
  albumTrackFromGqlEdge,
  assignDiscNumbers,
  albumDetailFromGql,
  createSearchBreaker,
  playlistTrackFromGqlEdge,
  gqlPrimaryArtistNames,
  stripAmazonTitleMarker,
  playlistFromGql,
  playlistPageInfoFromGql,
  paginatePlaylistTracks,
  playlistEdgesFromGql,
  AMAZON_DEVICE_TYPE_ID,
  DML_TARGET_PREFIX,
  WIDEVINE_CERT_CHALLENGE,
  AMAZON_TELEMETRY_CONSTANTS,
  TELEMETRY_TERMINATION,
  amazonTelemetryBitrateLabel,
  amazonClientAction,
  amazonStreamingDetails,
  amazonDmlsRegion,
  amazonDmlsManifestBody,
  amazonDmlsLicenseBody,
  MUSE_TARGET_PREFIX,
  ELIGIBILITY_CACHE_TTL_MS,
  ELIGIBILITY_FAILURE_BACKOFF_MS,
  amazonEligibilityFlagForTier,
  amazonEligibilityBody,
  amazonEligibilityFromResponse,
  amazonFilterTracksByEligibility,
  dashCodecFamily,

};
