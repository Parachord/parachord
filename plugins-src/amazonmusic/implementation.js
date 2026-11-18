// Source of truth for plugins/amazonmusic.axe v1.21.0.
// Imported from the .axe by `node scripts/build-axes.js --import`.
// Edit here, bump manifest.version in manifest.json, then run `node scripts/build-axes.js`.
// The functions materialize fully isolated (resolver-loader.js uses
// new Function) — no shared scope between them; helpers shared across
// functions live in the _lib factory below (evaluated once per resolver
// instance, pure: helpers and constants only — no I/O, no timers, no window;
// per-instance state lives on `this`).
//
// ── The searches, the catalog, the playlist import, the recommendations, the
// DRM pair AND the session surfaces run in the plugin (#1356 M5–M10) ───────
// The spec-search runner family (the SpecSearchSeeMorePage capture-and-replay
// flows: the track search, M5, plus the album search and the artist-image
// lookup, M6), the album-detail flow (lookupAlbum's candidate-ranking replay),
// the playlist import (M7 — the playlistDetail capture, the verbatim replay
// and the token-driven pagination), the recommendations (M8 — the
// music-home walk, the see-more route and the synthesized playlists section),
// the DRM pair (M9 — getPlaybackManifest + relayLicense, the dmls
// provider's flows with the csrf mint, the rendition-group refusal cache
// and the streaming telemetry) and the
// session surfaces (M10 — the status reply, sign-in, sign-out) are the
// plugin's: they drive the ONE host web-session instance (registered
// as 'amazon-music') through the window.electron.webSession bridge —
// pageFetch replays the captured request from the page world, load(url,
// {capture}) runs the chained page flow with the capture window inside the
// load (the quiet-bounded returned captures replace the old in-flow poll; our
// own replay traffic arrives as echo-flagged captures and is never trusted),
// fetch carries the session's cookie jar for the config/dmls/telemetry
// requests, state() supplies the facts the signed-in verdict composes — and
// the session generation whose change (a sign-out the plugin cannot see the
// event of) drops its session-scoped caches — signIn() opens the visible
// sign-in window with the plugin's own decide rule, and clear() behind
// signOut() wipes the partition. The host-side runner that used to serve the
// album/artist tabs, the host-side playlist import, the host-side
// recommendations flows, the amazon-dmls.js provider (with its
// main-process/amazon-telemetry.js reporter), the host's sign-in/out and its
// getStatus (with its stopgap plan read) are deleted; every helper those
// flows use lives here (copies of the deleted amazon-music-logic.js
// originals). Since the teardown (#1356 M11) nothing remains host-side but
// the view machinery (main-process/web-session.js behind the ONE instance
// main-process/amazon-web-session.js owns) — even the diagnostic capture is
// this plugin's (debugCaptureGql below).
module.exports = {
  // ── The plugin library (#1356) ────────────────────────────────────────
  // Pure helpers and constants, evaluated once per resolver instance and
  // frozen by the loader. Every copy below mirrors its original (deleted
  // with the M11 teardown) in amazon-music-logic.js / amazon-web-player.js.
  // The copies whose flows
  // have moved (the track search in #1356 M5; the album search, album lookup
  // and artist images in M6; the playlist import in M7; the recommendations
  // in M8; the dmls bodies, the licence-refusal semantics, the MPD KID parse
  // and the telemetry envelope in M9; the sign-in verdict, the sign-in
  // window's completion gate, the prompt rule and the playback-limit mapping
  // in M10) are now the ONLY copy — the host's died with its flows. The rest
  // still serve the host-side flow that has not moved (the diagnostic
  // capture); each copy notes which, and dies when its flow moves in.
  _lib: function () {
    // The session this plugin drives — the id main.js registered the ONE
    // host instance under (registerWebSession('amazon-music', …)). The
    // plugin owns the knowledge of which session it drives.
    const SESSION = 'amazon-music';
    const GQL_URL = 'https://gql.music.amazon.com/';
    const CONFIG_URL = 'https://music.amazon.com/config.json';

    // The page flow's capture window: the bridge's load returns its
    // captures once the page's request burst goes quiet, never later than
    // this budget after the load finishes — the same 15s window the old
    // in-flow poll (60 × 250ms) allowed a slow page (and, since the host's
    // zero-capture fix, a page that has fired nothing yet waits this budget
    // rather than closing early).
    const PAGE_CAPTURE_BUDGET_MS = 15000;
    // The quiet window is explicit, NOT the host's 1000ms default: a COLD
    // view's first gql fires well after load-finish (boot + query is ~1-3s
    // on a warm view — amazon-web-player.js's old poll comment — and a cold
    // view pays the view mint and its config fetch first). Under the default
    // a cold view whose first gql lands >1s after its SECOND request would
    // come back captures: [] — "the page never fired the search", a breaker
    // tick. 2500ms past the last captured request keeps that late follow-up
    // inside the window — the gap the old poll's unconditional 15s coverage
    // existed to close.
    const PAGE_CAPTURE_QUIET_MS = 2500;
    // The album page's own stop condition and quiet window. The page fires
    // AlbumSeo (header-only) FIRST and the detail op can lag it by more than
    // one gap — the #1135 review class, where a lagging detail op read as a
    // bogus "0 of 12 tracks" miss — so the old in-flow poll waited it out to
    // the END of its 20s window. The load's capture now ends the moment the
    // DETAIL op itself lands: doneWhen (the host's data-only stop condition,
    // rule 5) names the operation-name value the plugin's matcher ranks
    // first, quoted so it can only match the gql body's operationName field —
    // a hornet rename of the op never matches and falls back to the quiet
    // window, and the judgement on the returned captures stays the plugin's
    // (the response's tracksConnection, never the name). The quiet window is
    // the FALLBACK, and it is sized to the renderer's catalog-step budget —
    // withCatalogTimeout gives the whole lookup CATALOG_STEP_TIMEOUT_MS
    // (8000ms, src/renderer/app.js; the plugin mirrors it as
    // ALBUM_JOB_STALE_MS below and cannot read the renderer constant), so
    // load + quiet must finish comfortably inside it: 4500ms past the last
    // capture keeps the pinned 4s detail-op lag inside while a page that
    // loads in ~2s still ends its window by ~7s, still capped by the shared
    // 15s budget.
    const ALBUM_CAPTURE_QUIET_MS = 4500;
    // The playlist page's own stop condition and quiet window — the same
    // two-mechanism rule as the album page's, sized for the import flow.
    // The window ends the moment the page's own playlistDetail op lands:
    // doneWhen (the host's data-only stop condition, rule 5) names the
    // operation-name value the plugin's matcher keys on (the SAME quoted
    // needle shape as the album's — the quoted JSON string can only match
    // the gql body's operationName field, never another operation's GraphQL
    // document text, and a hornet rename never matches and falls back to
    // the quiet window). That restores #1423's slow-subresource fix the
    // RIGHT way: on `main` the import went ahead the moment playlistDetail
    // was captured, and doneWhen ends the window AT the op — before
    // did-finish-load — instead of waiting out the 30s load budget for the
    // budget escape to fire. The quiet window is the FALLBACK for a
    // playlistDetail that never comes (deleted/private/other-region — or
    // renamed), and it may NOT be the shared 2.5s: the #1437 round-2 miss
    // had an early unrelated gql at 1s, did-finish-load at 4s and
    // playlistDetail at 4.5s — a 3.5s gap after the last capture that the
    // shared window closed on, reading a live playlist as "not found".
    // 4500ms — the album layer's calibrated reference (the same SPA
    // gql-burst page class, with a pinned 4s detail-op lag) — covers that
    // miss with margin. The import has no renderer step budget the way the
    // album catalog step does (it paginates up to 120s), so the window could
    // stretch to ~8s, but the only case that ever pays the full window is
    // the not-found/renamed miss whose answer is null either way — the
    // calibrated reference beats the headroom. Still capped by the shared
    // 15s budget; the found case pays nothing (doneWhen ends the window at
    // the match).
    const PLAYLIST_CAPTURE_QUIET_MS = 4500;
    const PLAYLIST_DETAIL_OP_NAME = 'playlistDetail';
    // The operation-name value the album page fires for the album's detail —
    // live-captured 2026-10 (variables.id = the ASIN). The doneWhen needle is
    // the quoted JSON value, so it cannot match inside another operation's
    // GraphQL document text (names there are unquoted), and a rename falls
    // back to the quiet window instead of matching the SEO sibling.
    const ALBUM_DETAIL_OP_NAME = 'AlbumDetailPage';

    // The playlist import's busy-backoff bound. The import's pagination
    // replays run PARALLEL-SAFE — after the load phase the page-flow queue is
    // free — so a queued page flow's load takes the host's readers/writer
    // gate WHILE the import paginates, and every sendPlaylistQuery through
    // that window answers { error: 'busy' }. A load holds the gate for its
    // whole navigation budget (loadTimeoutMs, 30s — the host default, since
    // the plugin's load passes no timeoutMs), so the backoff must OUTLAST
    // that budget or the import truncates on page-error (or fails the
    // lookup on 'busy') while the queued load is still holding the gate.
    // 30s + 15s of margin (the retry cadence plus scheduling jitter — the
    // worst case observes the busy the moment the navigation takes the gate)
    // covers any one load. The bound still ends: a genuinely stuck gate
    // fails the import honestly instead of hanging a 120s import's every
    // page on it.
    const PLAYLIST_BUSY_BACKOFF_MAX_MS = 45000;

    // The album catalog fallback on the renderer bounds each catalog step
    // (withCatalogTimeout / CATALOG_STEP_TIMEOUT_MS in src/renderer/app.js),
    // and getArtistImage bounds each chain step the same way
    // (ARTIST_IMAGE_STEP_TIMEOUT_MS in src/renderer/lib/artist-image-chain.js
    // — a Home or Search page can ask for 5-20 artist photos at once). An
    // album or artist-image job that waits behind the plugin's page-flow
    // chain longer than that budget has a caller that already moved on:
    // skip its page load and return the miss, so track resolution is not
    // starved behind catalog/image jobs. Mirrors the renderer budget on
    // purpose (#1135) — the plugin cannot read the renderer constant.
    const ALBUM_JOB_STALE_MS = 8000;

    // #1220: the plan is read from config.json. The TTLs are the host dmls
    // gate's (30 min / 1 min) — but only an UNLIMITED reading earns the long
    // one: getPlan explains why (the plugin cannot hear the plan-changed
    // event that refreshes the host's dmls cache).
    const PLAN_TTL_MS = 30 * 60 * 1000;
    const PLAN_UNKNOWN_TTL_MS = 60 * 1000;

    function notReady(reason, message) {
      const err = new Error(message || reason);
      err.reason = reason;
      return err;
    }

    // ── Walls and session cookies (the ONLY copies since #1356 M11 deleted
    // the host modules — M10 moved the host's sign-in/status flows here, the
    // teardown moved the diagnostic capture that owned the
    // originals) ───────────────────────────────────────────────────────────

    // Amazon's web player is not usable for search or play while it is still
    // on the account sign-in page or the post-login profile picker. Cookies
    // can already exist at that point; the URL is the signal that selection
    // finished.
    function pageBlocksPlayback(url) {
      const value = url || '';
      if (/\/identity\/who-is-listening/i.test(value)) return 'not-signed-in';
      if (/\/ap\/signin/i.test(value)) return 'not-signed-in';
      // The sign-in portal is every /ap/ path on an Amazon account host, not
      // only /ap/signin: 2FA (/ap/mfa), push approval and verification
      // (/ap/cvf/...), challenges and account fixes all come before the
      // session is usable (#1166).
      if (/^https?:\/\/[^/?#]*amazon\.[^/?#]+\/ap\//i.test(value)) return 'not-signed-in';
      return null;
    }

    // Which Amazon session cookies a jar holds, by NAME:
    //   'known'   — the auth cookies isSignedIn has always keyed on
    //               (at-main / sess-at-main / at-acb, prefix-matched);
    //   'rotated' — none of those, but another auth-shaped cookie (x-main, or
    //               any at-* / sess-at-*): Amazon renamed its cookies, and
    //               the session is still live;
    //   'none'    — signed out.
    function amazonAuthCookieState(names) {
      const list = Array.isArray(names) ? names.filter(n => typeof n === 'string') : [];
      if (list.some(n => /^(at-main|sess-at-main|at-acb)/.test(n))) return 'known';
      if (list.some(n => /^(x-main|at-|sess-at-)/.test(n))) return 'rotated';
      return 'none';
    }

    // Whether a URL is a music.amazon.com page (host equality — the sign-in
    // portal's URLs carry music.amazon.com in their return_to query, so a
    // substring match passes them).
    function isAmazonMusicPage(url) {
      try {
        return new URL(url).origin === 'https://music.amazon.com';
      } catch {
        return false;
      }
    }

    // ── The search URL and request matching (the ONLY copies since the M11
    // teardown deleted amazon-music-logic.js) ──────────────────────────────

    // A loose "Stations Warning" search misses the song, so both terms are
    // quoted — but quoting alone imposes phrase ORDER, and Amazon's matching
    // is order-sensitive in both directions (live-verified 2026-10): Warning's
    // "Stations" only surfaces as '"Stations" "Warning"' while ХЛЕБ's "Яйца"
    // only surfaces as '"ХЛЕБ" "Яйца"'. So the query ORs the two orders in
    // one page load, plus the natural-language by-form FIRST — Backstabbed's
    // "Out Of Body Experience" is absent from the first 30 rows of both bare
    // orders (all 30 are tracks by an artist literally named "Out of Body
    // Experience") while the by-form returns it as row 1. The by-clause is a
    // supplement, never a replacement: alone it returns ZERO rows for ХЛЕБ's
    // "Яйца" and misses Warning's "Stations", so the bare orders stay. The
    // union carries a few noise rows (titles containing "or" or "by"), which
    // the resolver's artist+title filter and the confidence gate drop.
    // Returns { url, searchText } — searchText is the exact string the page
    // puts in variables.searchText, so the caller can find its own request
    // among everything the page fires. The songs tab is always used: that is
    // the page which fires the track search.
    function amazonSongSearchUrl({ title, artist, query } = {}) {
      // Titles and artists are track metadata, not typed text: control
      // characters never belong in them. One surviving into searchText and
      // being normalized differently by hornet would leave the runner waiting
      // out its capture window for a request it can never match — one junk
      // string tripping the shared search breaker (the same fold
      // amazonArtistSearchUrl applies to a name).
      const clean = (value) => String(value || '').replace(/[\p{Cc}]+/gu, ' ');
      const quote = (value) => '"' + clean(value).replace(/"/g, '').trim() + '"';
      let q = '';
      if ((title && String(title).trim()) || (artist && String(artist).trim())) {
        const titlePart = title && String(title).trim() ? quote(title) : '';
        const artistPart = artist && String(artist).trim() ? quote(artist) : '';
        q = titlePart && artistPart
          ? titlePart + ' by ' + artistPart + ' OR ' + titlePart + ' ' + artistPart + ' OR ' + artistPart + ' ' + titlePart
          : titlePart || artistPart;
      } else {
        q = clean(query).trim();
      }
      if (!q) return null;
      let url;
      try {
        url = 'https://music.amazon.com/search/' + encodeURIComponent(q) + '/songs';
      } catch (e) {
        // A lone surrogate in metadata makes encodeURIComponent throw; a query
        // that malformed is garbage, not a search — miss, never an exception
        // (the callers' catch would cache it as a noMatch).
        return null;
      }
      return { url, searchText: q };
    }

    // The search request the page fired for OUR query — matched on
    // variables.searchText (case-insensitive equality), NOT the
    // operationName: the text is unique among the page's requests and
    // survives an operation rename. Only the TRACK spec is accepted by
    // default: an album/artist/playlist spec for the same text is a
    // different entity whose ASIN must never reach playback — an album-shaped
    // edge maps to a track-shaped row and a self-titled release passes the
    // confidence gate, the album-ASIN failure the DOM-era exclusion dance
    // existed to prevent. A body with no specType at all is accepted (older
    // deploys). With { anySpec: true } the first searchText match of ANY spec
    // is returned — used only to detect "the page searched our text, but the
    // wanted spec never came" (the grace decision), never for replay.
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

    // The albums tab of the same spec search (the plugin's albumSearch
    // capability): the same quoted-or query the songs search builds, on the
    // /albums tab. (The host copy in amazon-music-logic.js died with the
    // host-side album search — this is the only one now.)
    function amazonAlbumSearchUrl(input) {
      const opts = typeof input === 'string' ? { query: input } : input;
      const spec = amazonSongSearchUrl(opts || {});
      if (!spec) return null;
      return { url: spec.url.replace(/\/songs$/, '/albums'), searchText: spec.searchText };
    }

    // The artists tab URL for an artist NAME (the artist-image chain passes a
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

    // The album page lives at /albums/<ASIN> — a 10-char uppercase ASIN,
    // unlike the long token playlist ids use. The gql search response carries
    // node.url with a ?ref= tracker; both that and the bare canonical form
    // yield the ASIN.
    function amazonAlbumAsinFromUrl(url) {
      const m = String(url || '').match(/music\.amazon\.com\/albums\/([A-Za-z0-9]{10})(?:[/?#]|$)/i);
      return m ? m[1].toUpperCase() : null;
    }

    // ── Spec-search request templates (replay-first) ────────────────────────
    // Within a deploy+session the page's own captured request is reusable: a
    // search replays it with the variables patched from the still-warm view —
    // no page load, and replays run in parallel. Any template miss (none,
    // stale, view cold/parked, replay error) falls back to the chained page
    // flow, whose capture re-mints.

    // Hard cap on template age, past which the page flow runs anyway: session
    // headers (csrf-ts rotation) have no verified TTL, so fresh means low-risk
    // rather than exactly right.
    const SPEC_TEMPLATE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

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

    function specTemplateIsFresh(template, now) {
      if (!template || typeof template !== 'object') return false;
      if (typeof template.url !== 'string' || !template.url) return false;
      if (!template.headers || typeof template.headers !== 'object') return false;
      if (!(template.body && template.body.variables && template.body.extensions)) return false;
      const at = typeof template.capturedAt === 'number' ? template.capturedAt : 0;
      return (typeof now === 'number' ? now : Date.now()) - at < SPEC_TEMPLATE_MAX_AGE_MS;
    }

    // A deep clone of the template's request body with the search variables
    // patched. Everything else — firstLimit, feature flags, the APQ hash —
    // stays byte-identical to the capture.
    function specBodyWithVars(body, { searchText, specType } = {}) {
      const out = JSON.parse(JSON.stringify(body || {}));
      if (!out.variables || typeof out.variables !== 'object') out.variables = {};
      if (searchText != null) out.variables.searchText = searchText;
      if (specType != null) out.variables.specType = specType;
      return out;
    }

    // The structural-failure circuit breaker: after 3 consecutive structural
    // failures it opens for 10 min, failing fast instead of burning the
    // capture window on every search of a resolution run (which would starve
    // everything else sharing the host's load chain). After the cooldown the
    // next search is a probe; any success closes it.
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

    // The per-instance page-flow queue, the plugin's mirror of the host's
    // own load-chain lanes (createLaneQueue in main-process/web-session.js,
    // whose #1423 semantics these are): one job at a time — real page
    // navigation on the shared view and the single webRequest listener slot
    // — in TWO LANES. A FOREGROUND job (something the user is waiting on,
    // such as a playlist they opened) starts before every queued BACKGROUND
    // job (the spec searches, album lookups, artist-photo jobs); FIFO within
    // a lane; a running job is never interrupted. A job that throws rejects
    // its own promise only; the queue moves on.
    function createLaneQueue() {
      const lanes = { foreground: [], background: [] };
      let running = false;
      const pump = () => {
        if (running) return;
        const job = lanes.foreground.shift() || lanes.background.shift();
        if (!job) return;
        running = true;
        Promise.resolve()
          .then(job.fn)
          .then(job.resolve, job.reject)
          .then(() => { running = false; pump(); });
      };
      return {
        run(fn, { lane = 'background' } = {}) {
          return new Promise((resolve, reject) => {
            lanes[lane === 'foreground' ? 'foreground' : 'background'].push({ fn: fn, resolve: resolve, reject: reject });
            pump();
          });
        },
        // Jobs waiting (not counting the one running), per lane.
        pending() {
          return { foreground: lanes.foreground.length, background: lanes.background.length };
        },
        isRunning() { return running; }
      };
    }

    // ── Replay plumbing ──────────────────────────────────────────────────────

    // Diagnostic for the miss log: the gql operations the page fired. When
    // hornet renames the search, every search reads as "never searched" —
    // this turns that into a one-line diagnosis.
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

    // Headers to copy onto the replayed gql fetch. The request the page made
    // is authoritative (x-api-key, csrf-*, music-territory, x-amzn-*); the
    // browser adds cookies (credentials: 'include') and origin/referer/sec-*
    // itself, and setting them from JS is either forbidden or wrong.
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
    // playlist (/user-playlists/<id>) answers playlistDetail with 294 to
    // Amazon's own page, because playlist.capabilities.setOnDemand calls a
    // collaborators service that fails (500) for a playlist the user doesn't
    // own, while data.playlist (title, tracks, pageInfo) is complete, and the
    // page renders it (live-captured 2026-11-15, #1423). Other 294s carry no
    // usable data: a Prime account's MusicHomePage, and a home walk with
    // firstLimit above 20. So a 294 is accepted only by a flow that asks, and
    // only when its own predicate finds the data it needs (`acceptPartial`
    // (parsed)); every other non-200 is a failure carrying its status (the
    // host's music-home fallback reads that status — nothing else opts in).
    // This is the plugin's copy of amazon-music-logic.js's rule (the host
    // copy serves the host's remaining replay flows); the playlist import is
    // the only flow here that passes a predicate (#1356 M7).
    const GQL_PARTIAL_STATUS = 294;

    // The replay's raw { status, text } (or { error }) -> { parsed } or
    // { error, status? } (and { partial: true } for an accepted 294). Pure,
    // so the status rules are unit-tested; replayGql below is the caller.
    function gqlReplayOutcome(replay, { acceptPartial = null } = {}) {
      if (!replay || replay.error) return { error: (replay && replay.error) || 'Amazon gql query failed' };
      const status = replay.status;
      const failed = () => ({ error: 'Amazon gql query failed (' + status + ')', status: status });
      const partialAllowed = status === GQL_PARTIAL_STATUS && typeof acceptPartial === 'function';
      if (status !== 200 && !partialAllowed) return failed();
      let parsed = null;
      try { parsed = JSON.parse(replay.text); } catch (e) { /* leave null */ }
      if (status !== 200) {
        // A partial answer the flow can't use (or that isn't JSON) is the plain
        // failure, status and all.
        let usable = false;
        try { usable = !!(parsed && acceptPartial(parsed)); } catch (e) { usable = false; }
        return usable ? { parsed: parsed, partial: true } : failed();
      }
      if (!parsed) return { error: 'Amazon gql response was not JSON' };
      if (Array.isArray(parsed.errors) && parsed.errors.length && !parsed.data) {
        return { error: String((parsed.errors[0] || {}).message || 'Amazon gql query error') };
      }
      return { parsed: parsed };
    }

    // The playlist flow's partial-answer predicate: data.playlist present,
    // with track edges where playlistEdgesFromGql finds them. A null
    // playlist, or one with no track rows block, is not a playlist we can
    // import.
    function playlistPartialIsUsable(parsed) {
      const data = parsed && parsed.data;
      return !!(data && data.playlist && Array.isArray(playlistEdgesFromGql(data)));
    }

    // ── The track mapper (shared by the spec search and the playlist import:
    // both responses return the same Track entity. The host's twin copy,
    // playlistTrackFromGqlEdge, died with the playlist import's move — this
    // is the only one) ─────────────────────────────────────────────────

    function gqlPrimaryImageUrl(images) {
      const list = (Array.isArray(images) ? images : []).filter(i => i && i.url);
      const widest = (l) => (l.length ? l.reduce((a, b) => ((b.width || 0) >= (a.width || 0) ? b : a)) : null);
      return (widest(list.filter(i => i.imageType === 'PRIMARY')) || widest(list) || {}).url || null;
    }

    // Amazon renders the explicit tag as a marker INSIDE the title text
    // ("Kunnioita [Explicit]") — the gql Track node carries no explicit
    // field. Strip a TRAILING bracketed/parenthesized "explicit" marker (the
    // only shape Amazon uses) and report it, so the edge mapper can set the
    // flag the payload lacks. A bare word ("Sexually Explicit") is the
    // track's real title and is left alone.
    function stripAmazonTitleMarker(title) {
      const raw = String(title || '');
      const m = raw.match(/^(.*?)\s*[[(]\s*explicit\s*[\])]\s*$/i);
      if (!m) return { title: raw.trim(), explicit: false };
      return { title: m[1].trim(), explicit: true };
    }

    // The joined artist credit: the PRIMARY-role artists, else every named
    // artist.
    function gqlPrimaryArtistNames(connection) {
      const artists = (connection && Array.isArray(connection.edges)) ? connection.edges : [];
      const primary = artists.filter(a => a && a.node && a.node.name && a.role === 'PRIMARY');
      const all = artists.filter(a => a && a.node && a.node.name);
      const chosen = primary.length ? primary : all;
      return chosen.map(a => a.node.name).join(', ');
    }

    // Only Track entities import: the response asks for __typename, and an
    // album/artist-spec edge (an Album node) must never become a track — an
    // album ASIN in the track slot passes the confidence gate on self-titled
    // releases. Absent __typename is allowed.
    function trackFromGqlEdge(edge) {
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

    // The SpecSearchSeeMorePage response -> the searchTracks result. The
    // response answers with data.specificationSearch.result[], the spec
    // result carrying edges[] whose nodes are the same Track entity the
    // playlist detail returns. A miss is a present envelope with no usable
    // edges; an ABSENT envelope (hornet renamed the field) is a structural
    // failure — the caller must throw not-ready, never cache a 30-day
    // noMatch. (The host's copy died with its track search; this is the
    // only one now.)
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
        .map(trackFromGqlEdge)
        .filter(Boolean);
      return { tracks, envelope: true };
    }

    // ── The album catalog (M6: album search, album detail, artist images) ───
    // The album-spec SpecSearchSeeMorePage response and the AlbumDetailPage
    // response (both shapes live-verified 2026-10 via the page's own
    // requests, replayed verbatim like the track search). These are the only
    // copies — the host's died with the album/artist flows.

    // The album-spec response's Album node → the searchAlbums row. Only
    // Album nodes map: a Track edge in the album slot is the same
    // ASIN-in-the-wrong-slot failure the track parser guards against, in
    // reverse. The node carries no releaseDate/trackCount in the search spec
    // (the plugin contract allows both null), and its own url carries a
    // ?ref= tracker — the canonical album URL (the form lookupAlbum parses)
    // is minted from the ASIN.
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
        url: 'https://music.amazon.com/albums/' + node.id,
        explicit: cleaned.explicit || !!(node.parentalSettings && node.parentalSettings.hasExplicitLanguage)
      };
    }

    // The album-spec response → the searchAlbums rows. Same envelope
    // semantics as searchTracksFromGql: a miss is a present envelope with no
    // usable edges; an absent envelope (hornet renamed the field) is
    // structural.
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

    // Mirrors normalizeArtistName in src/renderer/lib/album-catalog.js (the
    // normalization the Deezer step of the artist-image chain matches on):
    // case, diacritic marks, a leading "The", "&" and punctuation are folded
    // away. Kept as a local copy — the plugin cannot depend on renderer
    // sources.
    function amazonNormalizeArtistName(name) {
      let out = String(name || '');
      try { out = out.normalize('NFKD').replace(/\p{M}/gu, ''); } catch (e) { /* old engines */ }
      return out.toLowerCase().replace(/^the\s+/, '').replace(/&/g, 'and').replace(/[^\p{L}\p{N}]+/gu, '');
    }

    // One artist-spec edges[] entry → { asin, name, imageUrl }. Only Artist
    // nodes map: a Track/Album/Station edge in the artist slot is the
    // ASIN-in-the-wrong-slot failure the track and album parsers guard
    // against, and a misfiled entity here would pin the wrong photo on the
    // artist for 90 days (the renderer persists artist images). The photo pick
    // is the widest PROFILE image (the square artist photo; BACKGROUND is a
    // wide banner — albums use PRIMARY, artists do not have one), else the
    // widest image overall. Only a bare https URL on Amazon's m.media-amazon
    // CDN qualifies: the photo goes into the persisted cache, so anything
    // else — another host (a third-party tracking pixel would persist and
    // load on every render) or a query string (Amazon has never signed these;
    // a '?' would be new, and a credential-bearing URL must not be stored) —
    // is skipped. imageUrl is null when the artist has no usable photo at
    // all — the caller reports a miss for that artist, never another
    // artist's photo.
    function artistFromGqlSearchNode(node) {
      if (!node || node.__typename !== 'Artist' || !node.id || !node.name) return null;
      const usable = (Array.isArray(node.images) ? node.images : [])
        .filter(i => i && typeof i.url === 'string' && /^https:\/\/m\.media-amazon\.com\//i.test(i.url) && !i.url.includes('?'));
      const widest = (l) => (l.length ? l.reduce((a, b) => ((b.width || 0) >= (a.width || 0) ? b : a)) : null);
      const picked = widest(usable.filter(i => i.imageType === 'PROFILE')) || widest(usable);
      return { asin: node.id, name: String(node.name).slice(0, 200), imageUrl: picked ? picked.url : null };
    }

    // The artist-spec response → the artist's photo URL, or null. Same
    // envelope semantics as searchAlbumsFromGql. The edges are ranked by
    // Amazon and the top hit is not always the exact name ('warning' leads
    // with 'The Warning', and both fold to the same key anyway). The photo
    // comes only from the FIRST node whose normalized name equals the
    // requested one — never from another artist the search happened to rank
    // higher, however similar ('Fates Warning' is not 'Warning').
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

    // Write-shaped gql names (a replay would repeat the action on the user's
    // account) never become album-detail candidates, and never get replayed
    // by the diagnostic capture's subject matcher (gqlRequestIsAboutSubject
    // shares the same two shapes — #1356 M11 moved the capture into the
    // plugin with its helpers).
    const GQL_WRITE_OP = /^(?:add|remove|delete|update|set|put|create|follow|unfollow|like|unlike|save|record|log|report|send|post|mark)[A-Z_]|^track[A-Z]/;
    const GQL_MUTATION_NAME = /mutation/i;

    // The album-detail candidates the album page fired for OUR album. The
    // page fires AlbumDetailPage as variables.id = the ASIN (live-captured
    // 2026-10), but it also fires OTHER reads whose variables carry the
    // ASIN: AlbumSeo (the header-only op — its response has data.album with
    // title/trackCount but no tracksConnection) arrives FIRST on a real page,
    // and an unrelated read that happens to carry the ASIN may too. So
    // first-arrival must not win: candidates are ranked — detail-named, then
    // album-named, then (with { anyName: true }, the hornet-rename hedge)
    // any read carrying the ASIN — and the caller verifies the REPLAY
    // carries data.album.tracksConnection (albumTracksConnectionIn) before
    // accepting one.
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

    // Whether a replayed response IS the album detail: data.album carrying a
    // tracksConnection with an edges array (empty edges are fine — a pre-order /
    // fully-delisted album still comes from the detail op; the header-only
    // AlbumSeo response has data.album WITHOUT tracksConnection).
    function albumTracksConnectionIn(data) {
      const album = data && data.album;
      const tc = album && album.tracksConnection;
      return !!(tc && Array.isArray(tc.edges));
    }

    // One tracksConnection.edges[] entry → the album track row. Per-track
    // contributingArtists (a VA compilation keeps its own artists), the
    // title-marker strip, trackNumber, seconds duration.
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
    // anywhere: a trackNumber that does not advance past the previous one
    // starts a new disc. Rows without a trackNumber keep discNumber null (the
    // plugin contract has it "when known").
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

    // The AlbumDetailPage response's data.album → the lookupAlbum row. The
    // tracksConnection has no pageInfo at all (a 100-track album answers all
    // 100 edges in one response — live-verified), so unlike playlistDetail
    // there is no continuation to follow; trackCount above the edge count is
    // logged by the caller as a truncation, the way a short playlist page is.
    // Returns { album, envelope }: data.album null is a legitimate not-found
    // (deleted / other region), a data object with no 'album' field at all is
    // a hornet rename (structural — the caller throws instead of reporting a
    // miss).
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

    // ── The playlist import (M7) ────────────────────────────────────────────
    // The playlist page's own request, response and pagination (the shapes
    // live-verified 2026-10 against a 977-track playlist; see
    // docs/architecture/amazon-music.md, "Playlist import" — every sentence
    // there is a requirement). These are the only copies — the host's died
    // with the flow's move off amazon-web-player.js.

    // A playlist page lives at /playlists/<id> (shared/brand playlists),
    // /my/playlists/<id> (the user's own) or /user-playlists/<id> (the
    // share-link shape for user-created playlists). The id is a long token —
    // PP… (brand), a bare hex uuid, or a dashed uuid — not the 10-char ASIN
    // a track uses (brand playlists use those too). The id class must accept
    // dashes: a dashed-uuid id truncated at its first dash never matches the
    // page's own playlistDetail request (variables.id), and the import times
    // out into "Playlist not found".
    function amazonPlaylistIdFromUrl(url) {
      const m = String(url || '').match(/music\.amazon\.com\/(?:my\/)?(?:user-)?playlists\/([A-Za-z0-9-]+)/i);
      return m ? m[1] : null;
    }

    // The page fetches its playlist via a persisted GraphQL query (APQ)
    // against gql.music.amazon.com: {operationName: 'playlistDetail',
    // variables: {id, firstLimit: 100, ...}, extensions: {persistedQuery:
    // {sha256Hash}}}. The hash renumbers on every hornet redeploy, so nothing
    // is hardcoded: the request the page itself made for OUR playlist is
    // captured and replayed verbatim. Given the captured request bodies
    // (strings), return the parsed playlistDetail request for our playlist id,
    // or null when the page never made one (deleted / private / other
    // region — or the operation was renamed).
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

    // The gql response's data.playlist -> the lookupPlaylist result shape.
    // Picks the cover (imageType PRIMARY, else the widest) and a best-effort
    // owner. Returns null when data.playlist is null (deleted / private /
    // other region). The rows map with the shared trackFromGqlEdge — the
    // playlistDetail response returns the same Track entity the spec search
    // does (album is shortTitle: the detail response has no full album
    // title; the detail edges carry no images, so albumArt is null there).
    function playlistFromGql(data) {
      const playlist = data && data.playlist;
      if (!playlist) return null;
      const cover = gqlPrimaryImageUrl(playlist.images);
      const curator = playlist.curator;
      const owner = (curator && typeof curator === 'object' && curator.name) || (typeof curator === 'string' ? curator : null);
      const tracks = (playlist.tracks && Array.isArray(playlist.tracks.edges))
        ? playlist.tracks.edges.map(trackFromGqlEdge).filter(Boolean)
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

    // The connection's pageInfo, when the response carries one. hasNextPage
    // null = absent; endCursor null = absent. Returns null when there is no
    // pageInfo at all.
    function playlistPageInfoFromGql(data) {
      const tracks = data && data.playlist && data.playlist.tracks;
      const pageInfo = tracks && tracks.pageInfo;
      if (!pageInfo || typeof pageInfo !== 'object') return null;
      const endCursor = pageInfo.endCursor == null ? null : String(pageInfo.endCursor);
      const hasNextPage = typeof pageInfo.hasNextPage === 'boolean' ? pageInfo.hasNextPage : null;
      // token is the page's OWN continuation state (a composite base64
      // blob) — the value the next request passes as afterCursor.
      // Live-verified 2026-10: the token advances the pages; the Relay-style
      // endCursor is a decoy the server ignores (it answers page 1 again),
      // the dependent blob alone errors, and every other variable name is
      // dropped. Only the composite token advances, page over page.
      const token = typeof pageInfo.token === 'string' && pageInfo.token ? pageInfo.token : null;
      return { hasNextPage, endCursor, token };
    }

    // The response's track edges. The playlistDetail envelope is
    // data.playlist.tracks.edges; a continuation operation may answer with a
    // different envelope, so fall back to a bounded scan for any edges[]
    // whose nodes look like playlist rows (id + title).
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

    // Follow a playlist's own pagination to the end of the list. The gql
    // server serves one page per request however high firstLimit is raised
    // (100 rows observed at firstLimit 500), and the ONLY continuation it
    // accepts is the response's pageInfo.token passed as the afterCursor
    // variable — each response's own token drives the next page. Pure except
    // the injected fetchPage (one gql page by token: { error } or { data })
    // and now() (the time cap) — the poller pattern, so every stop condition
    // is unit-testable.
    //
    // Progress is judged on RAW edges, never mapped tracks (review feedback
    // on #1072): a page that is entirely delisted rows (node:null) maps to
    // zero tracks but still advances — later pages can exist after a label
    // pulls its catalog — and a duplicate track that happens to be first on
    // two consecutive pages is not a repeated window. The per-edge cursor
    // (position-encoded, present even on node:null edges) distinguishes a
    // genuine advance from the same window served again.
    //
    // Returns { playlist, pages, stop }:
    //   'complete'    — every row merged (tracks >= trackCount)
    //   'exhausted'   — the server is out of pages (no token / hasNextPage false)
    //   'page-error'  — fetchPage answered an error (a later page may exist)
    //   'empty-page'  — a page with zero raw edges
    //   'no-advance'  — a page starting at the same cursor as the previous one
    //   'page-limit'  / 'time-limit' — the caps
    //   'no-playlist' — the first page has no playlist (deleted/private/region)
    // Every stop keeps what was merged; rows are appended, never deduped
    // (cursor pages tile exactly, and a likes playlist CAN legitimately hold
    // the same track at two positions).
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
          const track = trackFromGqlEdge(edge);
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

    // ── The recommendations (#1356 M8) ───────────────────────────────────────
    // The home page's MUSIC tab and the see-more route: the request, response
    // and pagination shapes (live-captured 2026-11; see
    // docs/architecture/amazon-music.md, "Recommendations" — every sentence
    // there is a requirement). These are the only copies — the host's died in
    // amazon-music-logic.js with the flow's move off amazon-web-player.js.

    // How long the parsed home-page sections stay fresh in the session cache:
    // the Recommendations page refreshes at most hourly, and a replay is not
    // free (a stale template costs a page load).
    const RECOMMENDATIONS_CACHE_TTL_MS = 30 * 60 * 1000;

    // Upper bound on cached see-more expansion pages (one entry per
    // section+cursor a user expanded; the map is dropped with the session
    // generation).
    const SEE_MORE_CACHE_MAX = 40;

    // The home-connection walk: the section pages are fetched with firstLimit
    // MUSIC_HOME_FIRST_LIMIT (live-verified 2026-11: the server honors it — the
    // page's own is 5, and 25/30/50/100 answer HTTP 294), and the walk stops
    // at MUSIC_HOME_MAX_PAGES no matter what the cursor says (a pathological
    // rotation could keep serving fresh offsets of re-ranked sections
    // forever).
    const MUSIC_HOME_FIRST_LIMIT = 20;
    const MUSIC_HOME_MAX_PAGES = 4;

    // The home pages the recommendations flow reads, in order. The music tab
    // is the first choice (no stations or audiobooks mixed in, #1310). A Prime
    // account's music tab is refused: its MusicHomePage answers HTTP 294 to
    // the page itself as well as to a replay, while the same account's full
    // home answers BrowseHomePage with 200, in the same envelope, and walks
    // the same way (firstLimit 5/10/20 and the offset cursor; live-verified
    // 2026-11-11, #1328). So a 294 on the music tab switches the session to
    // the full home.
    const AMAZON_HOMES = {
      music: { url: 'https://music.amazon.com/music', operationName: 'MusicHomePage' },
      browse: { url: 'https://music.amazon.com/', operationName: 'BrowseHomePage' }
    };
    const HOME_REFUSED_STATUS = 294;

    // The home page's playlists strategy — the "Playlists for You" section
    // (the user's mixes: "My Discovery Mix", "My Recent Plays and More", plus
    // curated playlists). A stable strategy URI (Amazon's own ids, the same
    // class of identifier as the see-more route path — NOT an APQ hash, which
    // would renumber per redeploy and must never be hardcoded). The home page
    // rotates its sections per load and often does not render this one; the
    // see-more route answers it regardless (live-verified 2026-11).
    const PLAYLISTS_SECTION_ID = 'uri:///recommendations/browse-home/browse-home_playlistStrategy';

    // One replay is bounded by the host's pageFetch timeout (12s); the
    // multi-page home walk additionally bounds the WHOLE walk with the same
    // budget — one slow page must not stretch a walk of four into a minute.
    const RECOMMENDATIONS_WALK_TIMEOUT_MS = 12000;

    // One recommendation item from a gql entity node. Only music entities
    // map; Audiobook / PodcastEpisode / PodcastShow / Station / merch nodes
    // are dropped at parse time (the replay stays verbatim, so
    // audiobooksEnabled / merchEnabled ride the page's own variables and the
    // parser keeps the music). URLs keep Amazon's ?ref= trackers OFF the item
    // (the node url carries one; the canonical form is what the host's URL
    // routing parses).
    function recommendationItemFromGqlNode(node) {
      if (!node || typeof node !== 'object') return null;
      const bareUrl = (u) => (typeof u === 'string' && u ? u.split('?')[0] : null);
      const artist = gqlPrimaryArtistNames(node.contributingArtists);
      if (node.__typename === 'Track') {
        const cleaned = stripAmazonTitleMarker(node.title || node.shortTitle || '');
        if (!node.id || !cleaned.title || !artist) return null;
        return {
          type: 'song',
          id: node.id,
          name: cleaned.title.slice(0, 200),
          artist: artist.slice(0, 200),
          imageUrl: gqlPrimaryImageUrl(node.images) || null,
          url: bareUrl(node.url),
          duration: typeof node.duration === 'number' ? node.duration : null
        };
      }
      if (node.__typename === 'Album') {
        const cleaned = stripAmazonTitleMarker(node.title || node.shortTitle || '');
        if (!node.id || !cleaned.title || !artist) return null;
        return {
          type: 'album',
          id: node.id,
          name: cleaned.title.slice(0, 200),
          artist: artist.slice(0, 200),
          imageUrl: gqlPrimaryImageUrl(node.images) || null,
          url: bareUrl(node.url) || ('https://music.amazon.com/albums/' + node.id)
        };
      }
      if (node.__typename === 'Artist') {
        if (!node.id || !node.name) return null;
        // The artist-image pick (same rules as artistFromGqlSearchNode):
        // widest PROFILE else widest overall, bare m.media-amazon.com URLs
        // only.
        const usable = (Array.isArray(node.images) ? node.images : [])
          .filter(i => i && typeof i.url === 'string' && /^https:\/\/m\.media-amazon\.com\//i.test(i.url) && !i.url.includes('?'));
        const widest = (l) => (l.length ? l.reduce((a, b) => ((b.width || 0) >= (a.width || 0) ? b : a)) : null);
        const picked = widest(usable.filter(i => i.imageType === 'PROFILE')) || widest(usable);
        return {
          type: 'artist',
          id: node.id,
          name: String(node.name).slice(0, 200),
          imageUrl: picked ? picked.url : null,
          url: bareUrl(node.url) || ('https://music.amazon.com/artists/' + node.id)
        };
      }
      if (node.__typename === 'Playlist') {
        const name = node.title || node.name;
        if (!node.id || !name) return null;
        return {
          type: 'playlist',
          id: node.id,
          name: String(name).slice(0, 200),
          imageUrl: gqlPrimaryImageUrl(node.images) || null,
          url: bareUrl(node.url)
        };
      }
      return null;
    }

    // Find the page's own MusicHomePage among captured request bodies (the
    // MUSIC tab of the home page, https://music.amazon.com/music, fires it —
    // the music-only home; the full home at / fires BrowseHomePage with
    // stations and audiobooks mixed in). Matched on operationName — the page
    // fires exactly one op under this name (unlike SpecSearchSeeMorePage,
    // where the SAME operation carries the track/album/artist specs, which is
    // why the spec matcher matches on variables.searchText instead). The LAST
    // match wins: a re-render fires it again, and the freshest headers ride
    // the last one. Returns the request or null.
    // operationName picks the home: 'MusicHomePage' (the music tab, the
    // default) or 'BrowseHomePage' (the full home, the fallback for an
    // account whose music tab is refused, #1328).
    function amazonMusicHomeRequest(bodies, operationName = 'MusicHomePage') {
      let found = null;
      for (const raw of (Array.isArray(bodies) ? bodies : [])) {
        let parsed;
        try { parsed = JSON.parse(raw); } catch (e) { continue; }
        const batch = Array.isArray(parsed) ? parsed : [parsed];
        for (const req of batch) {
          if (req && req.operationName === operationName && req.variables && typeof req.variables === 'object') found = req;
        }
      }
      return found;
    }

    // The MusicHomePage response -> the recommendations provider shape:
    // { sections: [{ id: strategy uri, title, description, items }],
    // nextCursor, envelope }. nextCursor is the home connection's OFFSET
    // cursor (pageInfo.token: firstLimit-multiples — 5, 10, 20, 40 …,
    // live-verified 2026-11; hasNextPage gates it, the Relay-style endCursor
    // is a null decoy) — the page walk passes it back as the afterCursor
    // variable. EVERY section propagates — a station-only one has no mappable
    // items (a Station node never maps), so it disappears on its own; mixed
    // sections keep their mappable items. An absent data.browse (hornet
    // renamed the field) is envelope false — structural, the caller must
    // throw not-ready rather than cache a miss. data.t1r is skipped on
    // purpose (the user's station-mix top row — stations are not playable in
    // Parachord); data.genres is navigation chips, not things to play.
    function recommendationsFromMusicHome(data) {
      if (!data || typeof data !== 'object' || !('browse' in data)) {
        return { sections: [], nextCursor: null, envelope: false };
      }
      const conn = data.browse && data.browse.recommendationConnection;
      const edges = (conn && Array.isArray(conn.edges)) ? conn.edges : [];
      const sections = [];
      for (const edge of edges) {
        const node = edge && edge.node;
        if (!node || typeof node !== 'object' || !node.id) continue;
        const items = ((node.recommendedContent && Array.isArray(node.recommendedContent.edges)) ? node.recommendedContent.edges : [])
          .map(e => recommendationItemFromGqlNode(e && e.node))
          .filter(Boolean);
        if (!items.length) continue;
        const section = { id: String(node.id).slice(0, 300), title: null, items };
        if (typeof node.name === 'string' && node.name.trim()) section.title = node.name.trim().slice(0, 200);
        if (typeof node.description === 'string' && node.description.trim()) section.description = node.description.trim().slice(0, 300);
        sections.push(section);
      }
      const pageInfo = (conn && conn.pageInfo) || {};
      const nextCursor = pageInfo && pageInfo.hasNextPage && typeof pageInfo.token === 'string' && pageInfo.token
        ? pageInfo.token
        : null;
      return { sections, nextCursor, envelope: true };
    }

    // A deep clone of a MusicHomePage request body with the home-connection
    // pagination variables patched: firstLimit (the page's own is 5 — the
    // walk asks for 20, live-verified 2026-11: honored; 25/30/50/100 answer
    // HTTP 294) and afterCursor (the previous page's pageInfo.token; dropped
    // for page 1). Everything else — type: 'music-home', the feature flags,
    // extensions with the APQ hash — stays byte-identical to the capture
    // (the "replay verbatim" rule: audiobooksEnabled/merchEnabled ride the
    // page's own variables, so an audiobooks-only section simply disappears).
    function musicHomeBodyWithVars(body, { firstLimit, afterCursor } = {}) {
      const out = JSON.parse(JSON.stringify(body || {}));
      if (!out.variables || typeof out.variables !== 'object') out.variables = {};
      if (Number.isFinite(firstLimit)) out.variables.firstLimit = firstLimit;
      if (afterCursor != null) out.variables.afterCursor = afterCursor;
      else delete out.variables.afterCursor;
      return out;
    }

    // Merge a home-connection page walk into one section list:
    // first-appearance order, deduped by section id — the server re-ranks
    // sections per request, so an offset page can re-serve a section an
    // earlier page already carried (live-observed 2026-11: page 2 of a
    // firstLimit-20 walk re-served 3 of 5).
    function mergeMusicHomeSectionPages(pages) {
      const seen = new Set();
      const sections = [];
      for (const page of (Array.isArray(pages) ? pages : [])) {
        for (const section of ((page && page.sections) || [])) {
          if (!section || !section.id || seen.has(section.id)) continue;
          seen.add(section.id);
          sections.push(section);
        }
      }
      return sections;
    }

    // Find the page's own RecommenderSeeMorePage among captured bodies (the
    // see-more route's request). Matched on operationName, last match wins,
    // same reasoning as amazonMusicHomeRequest.
    function amazonSeeMoreRequest(bodies) {
      let found = null;
      for (const raw of (Array.isArray(bodies) ? bodies : [])) {
        let parsed;
        try { parsed = JSON.parse(raw); } catch (e) { continue; }
        const batch = Array.isArray(parsed) ? parsed : [parsed];
        for (const req of batch) {
          if (req && req.operationName === 'RecommenderSeeMorePage' && req.variables && typeof req.variables === 'object') found = req;
        }
      }
      return found;
    }

    // A section's strategy suffix: the last path segment of the recommender
    // uri ('uri:///recommendations/browse-home/<strategy>' — what the see-more
    // route URL and the see-more request's variables.id both key on). Accepts
    // the full uri or a bare strategy.
    function recommendationStrategyId(sectionId) {
      const raw = String(sectionId || '').split('?')[0];
      if (!raw) return null;
      const seg = raw.split('/').filter(Boolean).pop();
      return seg || null;
    }

    // The see-more page URL for a section: the SPA route the home page's
    // "See More" button navigates to (live-verified 2026-11), which fires
    // RecommenderSeeMorePage. Accepts the section's full uri or a bare
    // strategy.
    function amazonSeeMorePageUrl(sectionId) {
      const strategy = recommendationStrategyId(sectionId);
      if (!strategy) return null;
      return 'https://music.amazon.com/browse/music-items/home/recommendation/' + encodeURIComponent(strategy);
    }

    // The variables.id a section's see-more REQUEST carries. The see-more
    // page always prefixes the uri with browse-home — even for a music-home
    // strategy (a music-home section's own id is
    // uri:///recommendations/music-home/<strategy>, but its see-more request
    // asks for uri:///recommendations/browse-home/<strategy>, live-verified
    // 2026-11 on the page's own See More button) — so the echo guard and the
    // replay's id patch must use THIS id, never the section's own. Browse-home
    // ids (the playlists strategy) are already in this form and pass through
    // unchanged. Accepts the section's full uri or a bare strategy.
    function seeMoreSectionIdFor(sectionId) {
      const strategy = recommendationStrategyId(sectionId);
      if (!strategy) return null;
      return 'uri:///recommendations/browse-home/' + strategy;
    }

    // A deep clone of a see-more request body with the section variables
    // patched: id (the template was captured with a different section's uri)
    // and afterCursor (the previous page's pageInfo.token). Everything else —
    // firstLimit, feature flags, extensions with the APQ hash — stays
    // byte-identical to the capture.
    function seeMoreBodyWithVars(body, { sectionId, afterCursor } = {}) {
      const out = JSON.parse(JSON.stringify(body || {}));
      if (!out.variables || typeof out.variables !== 'object') out.variables = {};
      if (sectionId != null) out.variables.id = sectionId;
      if (afterCursor != null) out.variables.afterCursor = afterCursor;
      else delete out.variables.afterCursor;
      return out;
    }

    // The RecommenderSeeMorePage response -> { section, nextCursor, envelope
    // }: section is the provider's { title, items } for one expansion page,
    // nextCursor is pageInfo.token when hasNextPage (the offset cursor the
    // next request passes as afterCursor; endCursor is a decoy), null when
    // done. An absent data.recommender is envelope false — structural (hornet
    // rename), never a miss; a present connection with no usable node/edges
    // is a real "nothing more" (envelope true, section null).
    function recommendationsFromSeeMore(data) {
      if (!data || typeof data !== 'object' || !('recommender' in data)) {
        return { section: null, nextCursor: null, envelope: false };
      }
      const recommender = data.recommender;
      const edges = (recommender && Array.isArray(recommender.edges)) ? recommender.edges : [];
      const node = edges.length && edges[0] && edges[0].node;
      if (!node || typeof node !== 'object') return { section: null, nextCursor: null, envelope: true };
      const content = node.recommendedContent;
      const items = ((content && Array.isArray(content.edges)) ? content.edges : [])
        .map(e => recommendationItemFromGqlNode(e && e.node))
        .filter(Boolean);
      const pageInfo = (content && content.pageInfo) || {};
      const nextCursor = pageInfo && pageInfo.hasNextPage && typeof pageInfo.token === 'string' && pageInfo.token
        ? pageInfo.token
        : null;
      const section = { title: null, items };
      if (typeof node.name === 'string' && node.name.trim()) section.title = node.name.trim().slice(0, 200);
      return { section, nextCursor, envelope: true };
    }

    // ── The plan gate (#1220) ────────────────────────────────────────────────
    // The plugin's own DRM gate (assertPlanPlays in getPlaybackManifest)
    // reads the same file for playback; these copies feed the plugin's own
    // search gate. UNLIMITED… → unlimited, PRIME → prime, anything else,
    // missing or unreadable → unknown, which BLOCKS too (a format change on
    // Amazon's side must show up as a message, not as plays the plan may
    // not cover).

    function isUnlimitedTier(tier) {
      return typeof tier === 'string' && /^UNLIMITED/i.test(tier.trim());
    }

    function amazonPlanFromTier(tier) {
      if (isUnlimitedTier(tier)) return 'unlimited';
      if (typeof tier === 'string' && tier.trim().toUpperCase() === 'PRIME') return 'prime';
      return 'unknown';
    }

    // config.json's tier: a plain string, or an object carrying it under
    // .name / .tier (amazonNativeSessionFromConfig's read, copied).
    function tierFromConfig(json) {
      const j = json && typeof json === 'object' ? json : {};
      if (typeof j.tier === 'string') return j.tier;
      if (j.tier && typeof j.tier === 'object') {
        if (typeof j.tier.name === 'string' && j.tier.name) return j.tier.name;
        if (typeof j.tier.tier === 'string' && j.tier.tier) return j.tier.tier;
      }
      return null;
    }

    // One wording for the refusal (the host's settings panel and tile show
    // the same messages from its own copy).
    const AMAZON_PLAN_MESSAGES = {
      prime: 'Amazon Prime: Amazon is used for album art, artist photos and links. Playing Amazon tracks in Parachord needs Music Unlimited.',
      unknown: "Parachord couldn't confirm your Amazon Music plan, so Amazon playback is off until it can. Playing Amazon tracks in Parachord needs Music Unlimited."
    };

    function amazonPlanMessage(plan) {
      return AMAZON_PLAN_MESSAGES[plan] || null;
    }

    // The playbackLimit entry for the plugin's own plan reading (the mapping
    // src/renderer/lib/playback-limits.js's amazonPlaybackLimit ran on the
    // host's getStatus reply — the wording is unchanged): null when there is
    // no reading (signed out, or the read failed before the plugin knew),
    // unblocked with searchesHeldBack on unlimited (an upgrade from a blocked
    // reading must re-search), blocked with the tile label and the plan
    // message on every refused plan — unknown blocks too.
    const AMAZON_TILE_LABELS = {
      prime: 'Prime: no playback',
      unknown: 'Plan not confirmed'
    };

    function amazonPlaybackLimit(plan) {
      if (!plan) return null;
      if (plan === 'unlimited') {
        return { blocked: false, planKey: 'unlimited', label: null, message: null, searchesHeldBack: true };
      }
      return {
        blocked: true,
        planKey: plan,
        label: AMAZON_TILE_LABELS[plan] || AMAZON_TILE_LABELS.unknown,
        message: amazonPlanMessage(plan),
        searchesHeldBack: true
      };
    }

    // ── The session surfaces (#1356 M10): the sign-in verdict and the prompt rule ──
    // The sign-in window's completion gate and the not-signed-in prompt rule,
    // moved from amazon-music-logic.js's signInLanded and
    // src/renderer/lib/amazon-signin-prompt.js (whose copies died with the
    // host's sign-in flows). Pure pieces only: the window itself opens through
    // the webSession bridge's signIn protocol (the signIn method below).

    // The home page the sign-in window opens. The visible window's size (the
    // host's openLogin carried the same); the window's TITLE is host config
    // (#1432 review, finding 3), never a caller choice.
    const HOME_URL = 'https://music.amazon.com/';
    const SIGN_IN_WINDOW = { width: 980, height: 760 };

    // Whether a URL is a music.amazon.com page: HOST equality — the sign-in
    // portal's URLs carry music.amazon.com in their return_to query, so a
    // substring match passes them.
    function onMusicHost(url) {
      try {
        return new URL(url).hostname.toLowerCase() === 'music.amazon.com';
      } catch (e) {
        return false;
      }
    }

    // The sign-in window's completion gate (openLogin's, moved): "the URL is
    // not a known wall" alone fails open — music.amazon.com/ itself is not a
    // wall, and a logged-out first paint can sit there (or redirect slowly)
    // for a second or more, which used to close the window and report success
    // before the user touched the password field. Require a positive signal:
    // a non-wall music.amazon.com URL stable for two consecutive ticks AND
    // either an auth cookie, or — the fallback for Amazon rotating the
    // at-main/sess-at-main/at-acb cookie names — a page off the bare home path
    // or a third stable tick, but only once this window has been through
    // Amazon's sign-in pages (`sawSignInPage`: any host other than
    // music.amazon.com). Without that last condition the fallback closed the
    // window on a logged-out visitor: Amazon Music shows a signed-out person
    // its home page rather than sending them to sign in, so a fresh profile's
    // window sat on / for three ticks and closed, reporting success, before
    // the person could click Sign in (2026-11-17).
    function signInLanded({ url, lastUrl = null, stableTicks = 0, hasCookie = false, sawSignInPage = false } = {}) {
      const okUrl = !!url && onMusicHost(url) && !pageBlocksPlayback(url);
      const ticks = okUrl ? (lastUrl === url ? stableTicks + 1 : 1) : 0;
      let landed = false;
      if (ticks >= 2) {
        let path = '';
        try { path = new URL(url).pathname; } catch (e) { /* not a URL */ }
        landed = !!hasCookie || (!!sawSignInPage && (path !== '/' || ticks >= 3));
      }
      return { landed, stableTicks: ticks };
    }

    // Whether a sign-in window tick shows it off music.amazon.com: the
    // password, 2FA and account pages live on Amazon's account hosts, so a
    // window that has been on one has been through sign-in.
    function signInTickLeftMusicHost(url) {
      return !!url && !onMusicHost(url) && /^https:/i.test(String(url));
    }

    // Should a not-signed-in open the sign-in prompt? While the auth cookies
    // say the session is live, a not-signed-in is first treated as a hiccup —
    // Amazon refreshes its session token every so often (session-token
    // reissued, the auth cookies untouched), and a page load caught in that
    // refresh can be redirected to a sign-in or profile page; the prompt used
    // to open on an app signed in for hours while the very next search
    // worked. Only a streak of them lasting HICCUP_GRACE_MS (consecutive
    // failures less than STREAK_GAP_MS apart) is real — most likely Amazon's
    // profile picker waiting for a choice. No cookies, or another reason,
    // prompts at once. streak: { firstAt, lastAt } (zeros when none); the
    // caller keeps the returned streak between calls.
    const HICCUP_GRACE_MS = 60 * 1000;
    const STREAK_GAP_MS = 2 * 60 * 1000;

    function signInPromptDecision({ reason, cookiesSignedIn, streak, now }) {
      const none = { firstAt: 0, lastAt: 0 };
      if (reason !== 'not-signed-in' || !cookiesSignedIn) return { prompt: true, streak: none };
      const s = streak || none;
      const continuing = s.lastAt && now - s.lastAt <= STREAK_GAP_MS;
      const firstAt = continuing ? s.firstAt : now;
      if (now - firstAt >= HICCUP_GRACE_MS) return { prompt: true, streak: none };
      return { prompt: false, streak: { firstAt, lastAt: now } };
    }

    // ── The DRM pair (#1356 M4, live for Amazon since M9) ───────────────────
    // The dmls request bodies, the licence-refusal semantics, the MPD KID
    // parse and the telemetry envelope builders — moved from
    // amazon-music-logic.js / main-process/amazon-telemetry.js, whose host
    // copies died with the dmls provider. Pure pieces only; the flow state
    // (the session context, the cert warm, the telemetry health) lives on
    // `this` in the methods below.

    const AMAZON_DEVICE_TYPE_ID = 'A16ZV8BU3SN1N3';
    const DML_TARGET_PREFIX = 'com.amazon.digitalmusiclocator.DigitalMusicLocatorServiceExternal.';
    // An empty Widevine challenge the hornet page sends before its first real
    // per-track license exchange (session/cert init). Mimic it once per session.
    const WIDEVINE_CERT_CHALLENGE = 'CAQ=';
    // A format-valid musicAgent is required by the dmls requests; the raw SDK
    // pair alone is rejected. The app version rides the string like the old
    // provider's did.
    const MUSIC_AGENT_SDK = 'Vinyl/2.0';
    const MUSIC_AGENT_CLIENT = 'GreenHornet_Web/1.0.1458';
    // The mint page flow's capture lens (the old host mint's): the gql host
    // always carries the csrf triplet, the api hosts carry it too.
    const MINT_CAPTURE_URL_PREFIXES = ['https://gql.music.amazon.com/*', 'https://music.amazon.com/api/*', 'https://music.amazon.com/*/api/*'];
    // The benign mint query before the plugin has seen a search of its own
    // (the old host mint's default).
    const MINT_BENIGN_QUERY = 'the';

    // license-400 denialReason semantics (live captures): only these mean the
    // build's certificate (development VMP) is what Amazon is refusing — the
    // `licenseDenied` "no point trying another Amazon track" class. Everything
    // else (HD entitlement, region, ...) is a per-content refusal the player
    // routes around.
    const CERTIFICATE_DENIAL_REASONS = new Set([
      'UNTRUSTED_DEVICE_CERTIFICATE',
      'DEVELOPMENT_CERTIFICATE_NOT_ALLOWED'
    ]);
    // Eligibility denials that mean the ACCOUNT lacks the HD tier (the Prime
    // capture: CUSTOMER_NOT_ELIGIBLE on the HD KID group while the opus groups
    // played fine). The renderer's #1262 family-failure table is the live
    // latch on this class — the old provider's own hdSessionBlockedByPlan
    // flag was set but never read, and is not ported.
    const HD_CONTENT_DENIAL_REASONS = new Set([
      'CUSTOMER_NOT_ELIGIBLE'
    ]);
    // A license denial's message is a sentence, then " - " and a dump of the
    // account's and the title's eligibility that starts
    // `CustomerEligibility(customerId=…, marketplaceId=…, …)`. The message ends
    // up in logs and error text, and logs get pasted into issues, so keep the
    // sentence only, and scrub an account identifier that turns up anyway.
    const LICENSE_DENIAL_SUMMARY_MAX = 200;
    function licenseDenialSummary(message) {
      if (typeof message !== 'string') return null;
      let text = message;
      const separator = text.indexOf(' - ');
      if (separator !== -1) text = text.slice(0, separator);
      const eligibility = text.search(/\b(?:Customer|Content)Eligibility\s*\(/);
      if (eligibility !== -1) text = text.slice(0, eligibility);
      text = text
        .replace(/\b(customerId|marketplaceId|deviceId)("?\s*[=:]\s*"?)[^,)"\s]+/gi, '$1$2<redacted>')
        .trim();
      if (text.length > LICENSE_DENIAL_SUMMARY_MAX) text = `${text.slice(0, LICENSE_DENIAL_SUMMARY_MAX)}…`;
      return text || null;
    }

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

    // GET https://music.amazon.com/config.json answers the session facts the
    // DRM pair needs in one shot (cookies only, no CSRF): customer,
    // marketplace, territory, the dmls region segment itself (siteRegion) and
    // the registered device. Parse defensively — every field degrades to
    // null. (The host's copy in amazon-music-logic.js serves its getStatus
    // plan stopgap; the plugin's mint is this one.)
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
        tier: tierFromConfig(j)
      };
    }

    // Codec bucket of a DASH codec string (mpdAudioRepresentations rep.codec).
    function dashCodecFamily(codec) {
      const c = String(codec || '').toLowerCase();
      if (c.startsWith('flac')) return 'flac';
      if (c.startsWith('opus')) return 'opus';
      if (c.startsWith('mp4a') || c.startsWith('aac')) return 'aac';
      return c || null;
    }

    // The manifest already says which playback tier carries which protection:
    // every adaptation set's ContentProtection@default_KID. Amazon issues
    // DIFFERENT Widevine keys per rendition group (lossy sets, FLAC set,
    // spatial sets) — shaka 4012 (RESTRICTIONS_CANNOT_BE_MET) usually means a
    // specific KID is missing output-absolution in the license, and the tier to
    // blame is exactly the one named by its KID group. Pure parse from the MPD
    // (defensive about malformed input). The player's protectionSets extras
    // ride the plugin reply so per-KID error attribution keeps working.
    function mpdContentProtectionSets(xml) {
      const text = String(xml || '');
      const sets = [];
      if (!text) return sets;
      const attr = (name, tag) => {
        // (?:^|\s) left boundary: an unanchored `value="…"` also matches
        // INSIDE `subvalue="9"`. Same helper shape the group-label reader
        // falls back to.
        const m = (tag || '').match(new RegExp('(?:^|\\s)' + name + '="([^"]*)"'));
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
        // What KIND of set this is, for the playability guard: Amazon's audio
        // sets say contentType="audio"; mimeType is the fallback. null when
        // the document types nothing.
        const contentType = attr('contentType', setTag) || (String(attr('mimeType', setTag) || '').split('/')[0] || null);
        // Every KID the set declares, not just the first (a set may carry more
        // than one ContentProtection), and the set's OWN rendition-group
        // label — the stable name for what a license refusal was about. See
        // mpdRenditionGroupLabel.
        sets.push({ kid, kids, family, groupLabel: mpdRenditionGroupLabel(set, attr), contentType, reps });
      }
      return sets;
    }

    // Does this document still carry something the player could play? Tag
    // counting is not enough (a leftover self-closing set or a VIDEO set with
    // representations passes it) — the engine dies at "manifest carried no
    // audio variant this build can play". Typed sets decide when the document
    // types its sets; when nothing is typed, any set with representations
    // counts.
    function mpdHasPlayableAudio(xml) {
      const sets = mpdContentProtectionSets(xml).filter((s) => s.reps.length);
      if (!sets.length) return false;
      const typed = sets.filter((s) => s.contentType);
      return typed.length ? typed.some((s) => s.contentType === 'audio') : true;
    }

    // Amazon tags every audio adaptation set with its rendition tier:
    //   <SupplementalProperty schemeIdUri="amz-music:trackType" value="LD"/>
    // Live capture over seven plays SERVED TO THE UNVERIFIED BUILD: the TIER
    // SET is what is stable (an Ultra-HD account is served a wider answer —
    // five sets / nine renditions including two FLAC rungs and spatial tiers,
    // see the synthesized five-set fixture in tests/test-utils/
    // amazon-live-mpd.js):
    //   value="LD" selectionPriority 500  opus, 2 rungs 51-63k + 163-180k   (one KID)
    //   value="SD" selectionPriority 1000 opus, 3 rungs 51-63k + 195-213k + 323-346k (one KID)
    //   value="HD" selectionPriority 2000 fLaC, 1-4 rungs 0.88-4.37M        (one KID)
    // The RUNG COUNT varies per track (one title carries one FLAC rung,
    // another four); the tier, its key group, and the label do not.
    // The KID cannot be a cross-track cache key — it is per-asset (live:
    // KID-536f9d, KID-1bc225, KID-a0d737 over three tracks) — but the LABEL is
    // the same string on every track, and it is the SAME vocabulary the
    // license refusal comes back with (`not eligible for SD content`), which
    // is what makes a refused rendition group cacheable at all. The label is
    // an opaque name here: nothing in this file interprets LD/SD/HD, and it is
    // NOT the playback_quality tier vocabulary (saver/standard/high/max) — do
    // not conflate them.
    const AMAZON_TRACK_TYPE_SCHEME = 'amz-music:trackType';
    function mpdRenditionGroupLabel(setBlock, attr) {
      const tag = String(setBlock || '');
      const read = attr || ((name, t) => {
        // Anchored like mpdContentProtectionSets' own reader — `value="…"`
        // must not match inside e.g. `subvalue="9"`.
        const m = (t || '').match(new RegExp('(?:^|\\s)' + name + '="([^"]*)"'));
        return m ? m[1] : null;
      });
      for (const sp of tag.matchAll(/<SupplementalProperty[^>]*\/?>/g)) {
        if (read('schemeIdUri', sp[0]) === AMAZON_TRACK_TYPE_SCHEME) {
          const value = read('value', sp[0]);
          if (value) return value;
        }
      }
      return null;
    }

    // The group a license refusal is about, from Amazon's own sentence. Live
    // shape: `UNVERIFIED request not eligible for HD content
    // (EligibilityException VMP_VALIDATION_FAILED)` — the level word is the
    // set's trackType label. No match → null, and the caller keeps today's
    // unfiltered behavior.
    const AMAZON_GROUP_LABEL_RE = /not\s+eligible\s+for\s+([A-Za-z][A-Za-z0-9_-]*)\s+content/i;
    function amazonGroupLabelFromDenial(message) {
      const m = AMAZON_GROUP_LABEL_RE.exec(String(message || ''));
      return m ? m[1].toUpperCase() : null;
    }

    // The scope a rendition-group refusal is cached at, when to cache it at
    // all: 'build-refused' is a BUILD fact (this build's VMP signature was
    // refused — it survives a sign-out; another account changes nothing about
    // the signature), 'license-denied' is an ACCOUNT fact (sign-out and a plan
    // upgrade end it). Both marks need a POSITIVE, RECOGNIZED reason — the
    // VMP_VALIDATION_FAILED reason or Amazon's own "UNVERIFIED request"
    // sentence (matched ANCHORED at the start of the RAW message so a
    // redacted PII tail cannot impersonate it) say build, CUSTOMER_NOT_ELIGIBLE
    // says account, and ANYTHING ELSE says null: an unrecognized reason (a
    // per-title HD refusal, a reason Amazon invents tomorrow) records
    // NOTHING — a recorded label keeps a tier out of the session's later
    // manifests, and an unrecognized one must never take a tier away.
    function amazonGroupRefusalScope(denialReason, message) {
      if (denialReason === 'VMP_VALIDATION_FAILED') return 'build-refused';
      if (/^UNVERIFIED request/i.test(String(message || ''))) return 'build-refused';
      if (denialReason === 'CUSTOMER_NOT_ELIGIBLE') return 'license-denied';
      return null;
    }

    // Drop whole rendition groups from the MPD text — the only way to stop
    // the license requests for them, since a key group in the manifest is a
    // key request Shaka will make whether or not anything selects it (the
    // license body carries no ASIN and no quality level, and the KIDs inside
    // the challenge are opaque). Returns the manifest and which labels were
    // dropped (ordered unique — two sets can share a tier: the five-set
    // capture shape carries TWO FLAC sets both value="HD", and the drop is
    // per TIER, so it reports ['HD'] once); refuses to empty the manifest (a
    // Period with no playable audio set is an unplayable track, and an
    // over-eager cache must not cause that).
    // THE LABEL IS A TIER NAME, NOT A CODEC FAMILY. Family-scoping the
    // refusal was considered and rejected: the refusal is about the tier
    // ("not eligible for HD content"), and a family-scoped drop re-pays the
    // refusal round-trip on the next track whose refused tier rides a
    // different codec family (SD and LD are both opus today, so the shapes
    // coincide on this capture — the Ultra-HD answer, where FLAC and a
    // spatial set share no family with the lossy tiers, is where they
    // differ).
    function mpdDropRenditionGroups(xml, wantLabels) {
      const text = String(xml || '');
      const want = new Set((wantLabels || []).map((l) => String(l || '').toUpperCase()).filter(Boolean));
      if (!text || !want.size) return { manifest: text, dropped: [] };
      // DASH's AdaptationSetType permits NESTED sets and self-closing sets; a
      // non-greedy match over the whole document would cut a nested block at
      // the INNER close tag and mispair a self-closing one — the vendored
      // Shaka parser then rejects the result with "Unexpected close tag", a
      // hard manifest error instead of a graceful degrade. So NESTED answers
      // bail out BEFORE the rewrite (an `<AdaptationSet` that opens another
      // `<AdaptationSet` before any `</AdaptationSet>`): matching is
      // innermost-only, so a nested document would be partially rewritten —
      // the inner block removed, its OUTER shell left standing — which is
      // neither the refused group nor a whole removal. And documents whose
      // open/close counts disagree (self-closing, unbalanced) bail before the
      // rewrite. The post-rewrite count guard can no longer be the nesting
      // answer — innermost-only matching always removes one open with its
      // close — so it stays as insurance against a rewrite bug only. None of
      // this is reachable with today's flat Amazon audio answers: it is
      // insurance, and it leaves a non-flat answer unfiltered.
      const opens = (s) => (s.match(/<AdaptationSet/g) || []).length;
      const closes = (s) => (s.match(/<\/AdaptationSet>/g) || []).length;
      if (/<AdaptationSet(?:(?!<\/AdaptationSet>)[\s\S])*?<AdaptationSet/.test(text)) return { manifest: text, dropped: [] };
      if (opens(text) !== closes(text)) return { manifest: text, dropped: [] };
      const dropped = [];
      const out = text.replace(/<AdaptationSet(?:(?!<AdaptationSet)[\s\S])*?<\/AdaptationSet>/g, (block) => {
        const label = mpdRenditionGroupLabel(block);
        if (label && want.has(label.toUpperCase())) {
          const up = label.toUpperCase();
          if (!dropped.includes(up)) dropped.push(up);
          return '';
        }
        return block;
      });
      if (opens(out) !== closes(out)) return { manifest: text, dropped: [] };
      // Playability, not tag counting: an `<AdaptationSet` merely PRESENT can
      // be a leftover self-closing set or a VIDEO set — every audio set can
      // still be gone, and the engine then dies at "manifest carried no audio
      // variant this build can play". Require that the filtered document
      // still carries playable AUDIO (a video set's representations are not a
      // substitute).
      if (!mpdHasPlayableAudio(out)) return { manifest: text, dropped: [] };
      return { manifest: out, dropped };
    }

    // hornet reports times relative to this offset format.
    function deviceTimeZoneString() {
      try {
        const offsetMinutes = -new Date().getTimezoneOffset();
        const sign = offsetMinutes >= 0 ? '+' : '-';
        const abs = Math.abs(offsetMinutes);
        return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
      } catch {
        return null;
      }
    }

    // A randomUUID without a crypto binding requirement: the renderer's
    // window.crypto.randomUUID when present (secure contexts only), else a
    // Math.random uuid4 (session ids are unique-enough, not secret).
    function uuid4() {
      try {
        if (typeof crypto === 'object' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
      } catch { /* old engines */ }
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });
    }

    // ── Streaming telemetry (the hornet /telemetry/v1/events vocabulary) ──
    // Live-captured 2026-10: the web player reports streamingInitiated on
    // play start, streamingTerminated at seek/pause/teardown/end, and
    // trackStreamed paired with the FINAL terminated (carrying the
    // accumulated durationSecondsSum). terminationReason: trackScrub (seek),
    // userStop (pause), systemStop (teardown/advance), trackFinished (natural
    // end). These builders produce clientActionList entries in that exact
    // shape; the reporter (createAmazonTelemetry) owns session ids and sums.
    // Dependency-injected for tests: { post, context, now, randomUUID }. All
    // fields are strings, mirroring hornet's serialization.

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

    // The telemetry reporter, dependency-injected ({ post, context, now,
    // randomUUID }) — moved from main-process/amazon-telemetry.js unchanged
    // apart from the uuid fallback (the main process could require('crypto')).
    //   post(envelope)      — one /telemetry/v1/events POST ({deviceId,
    //                         deviceType, clientActionList})
    //   context()           — { tier, territory, csrf…, deviceTimeZone }
    //   now()               — seconds (Date.now()/1000)
    //   randomUUID()        — session ids
    // Player events (the host's handlePlayerEvent payload shapes):
    //   play-started { asin, albumAsin?, durationMs?, initialDelaySeconds?,
    //                  bitratesLabel?, cdnType? }
    //   seek      { positionMs }
    //   pause     { positionMs }
    //   resume    { positionMs }
    //   ended     { positionMs, durationMs }
    //   stopped   { positionMs }   (teardown/skip/replace)
    function createAmazonTelemetry({ post, context, now, randomUUID } = {}) {
      const time = typeof now === 'function' ? now : () => Date.now() / 1000;
      const uuid = typeof randomUUID === 'function' ? randomUUID : uuid4;
      const send = (actions) => {
        if (!actions.length || typeof post !== 'function') return null;
        const ctx = typeof context === 'function' ? (context() || {}) : {};
        try {
          // The post's promise rides out: onStopped's callers await it —
          // signOut posts the FINAL accounting before the session clears.
          // The catch stays: telemetry never throws into playback, and a
          // caller that drops the promise (the generation drop) can never
          // see a rejection.
          return Promise.resolve(post({
            deviceId: ctx.deviceId || null,
            deviceType: AMAZON_DEVICE_TYPE_ID,
            clientActionList: actions
          })).catch(() => {});
        } catch { /* telemetry never throws into playback */ return null; }
      };

      const state = {
        customSessionId: uuid(), // one per session (hornet's foreground session)
        playbackInstanceId: null,
        playQueueId: null,
        current: null, // { asin, albumAsin, bitratesLabel, cdnType, durationMs }
        segmentStartSecs: null,
        durationSumSecs: 0,
        trackTerminated: true
      };

      const ctxNow = () => (typeof context === 'function' ? (context() || {}) : {});
      const sdkEventId = () => uuid();

      const baseDetails = (extra) => {
        const ctx = ctxNow();
        return amazonStreamingDetails({
          asin: state.current && state.current.asin,
          albumAsin: state.current && state.current.albumAsin,
          territory: ctx.territoryId,
          tier: ctx.tier,
          resourceType: isUnlimitedTier(ctx.tier) ? 'UNLIMITED_MUSIC' : 'PRIME_MUSIC',
          playbackInstanceId: state.playbackInstanceId,
          playQueueId: state.playQueueId,
          subscriptionMode: ctx.tier,
          bitrates: state.current && state.current.bitratesLabel,
          cdnType: state.current && state.current.cdnType,
          customSessionId: state.customSessionId,
          csrf: ctx,
          deviceTimeZone: ctx.deviceTimeZone,
          ...extra
        });
      };

      const emit = (actionName, extra) => send([amazonClientAction(actionName, baseDetails(extra), {
        timestampSeconds: time(),
        sdkEventId: sdkEventId()
      })]);

      const emitPair = (reason, { segmentSecs, progressSecs, final = false } = {}) => {
        // streamingTerminated always; trackStreamed only for the track's FINAL
        // termination (hornet pairs it there with the aggregate only). Both are
        // built through ONE derivation (baseDetails) — re-serializing a flattened
        // entry through the builder drops subscription/csrf/fulfillment fields
        // and the territory (review B2).
        const terminated = baseDetails({
          durationSeconds: segmentSecs,
          durationSecondsSum: state.durationSumSecs,
          terminationReason: reason,
          trackProgress: progressSecs,
          trackCount: 1
        });
        const stamp = time();
        const actions = [amazonClientAction('streamingTerminated', terminated, { timestampSeconds: stamp, sdkEventId: sdkEventId() })];
        if (final) {
          // trackStreamed: same facts, minus the per-segment durationSeconds —
          // the aggregate travels in durationSecondsSum.
          const streamed = baseDetails({
            durationSecondsSum: state.durationSumSecs,
            terminationReason: reason,
            trackProgress: progressSecs,
            trackCount: 1
          });
          actions.push(amazonClientAction('trackStreamed', streamed, { timestampSeconds: stamp, sdkEventId: sdkEventId() }));
        }
        return send(actions);
      };

      const segmentElapsedSecs = () => (state.segmentStartSecs == null ? 0 : Math.max(0, time() - state.segmentStartSecs));

      const closeSegment = (reason, progressSecs) => {
        if (!state.current || state.trackTerminated) return;
        const segmentSecs = segmentElapsedSecs();
        state.durationSumSecs += segmentSecs;
        state.segmentStartSecs = null;
        state.trackTerminated = true;
        emitPair(reason, { segmentSecs, progressSecs, final: true });
      };

      return {
        onPlayStarted({ asin, albumAsin, durationMs, initialDelaySeconds, bitratesLabel, variantFacts, cdnType } = {}) {
          if (!asin) return;
          // Replacing a track without an explicit stop: hornet's flow shows the
          // previous session closed as systemStop first.
          closeSegment(TELEMETRY_TERMINATION.systemStop, 0);
          state.playbackInstanceId = uuid();
          state.playQueueId = uuid();
          const label = bitratesLabel || (variantFacts ? amazonTelemetryBitrateLabel(variantFacts) : null);
          state.current = {
            asin: String(asin),
            albumAsin: albumAsin ? String(albumAsin) : null,
            durationMs: Number(durationMs) || 0,
            bitratesLabel: label,
            cdnType: cdnType || null
          };
          state.durationSumSecs = 0;
          state.segmentStartSecs = time();
          state.trackTerminated = false;
          emit('streamingInitiated', {
            timestamp: String(Math.round(time())),
            initialPlaybackDelaySeconds: initialDelaySeconds != null
              ? String(Number(initialDelaySeconds).toFixed(3))
              : undefined
          });
        },

        onSeek({ positionMs } = {}) {
          if (!state.current || state.trackTerminated) return;
          const segmentSecs = segmentElapsedSecs();
          state.durationSumSecs += segmentSecs;
          state.segmentStartSecs = time();
          emitPair(TELEMETRY_TERMINATION.scrub, { segmentSecs, progressSecs: Math.round((Number(positionMs) || 0) / 1000) });
          // A scrub opens a new segment with a fresh initiated, matching hornet.
          emit('streamingInitiated', { timestamp: String(Math.round(time())) });
        },

        onPause({ positionMs } = {}) {
          if (!state.current || state.trackTerminated) return;
          const segmentSecs = segmentElapsedSecs();
          state.durationSumSecs += segmentSecs;
          state.segmentStartSecs = null;
          state.trackTerminated = true;
          emitPair(TELEMETRY_TERMINATION.userStop, { segmentSecs, progressSecs: Math.round((Number(positionMs) || 0) / 1000) });
        },

        onResume(_args) {
          if (!state.current || !state.trackTerminated) return;
          state.segmentStartSecs = time();
          state.trackTerminated = false;
          emit('streamingInitiated', { timestamp: String(Math.round(time())) });
        },

        onEnded({ positionMs, durationMs } = {}) {
          if (!state.current) return;
          const segmentSecs = state.trackTerminated ? 0 : segmentElapsedSecs();
          state.durationSumSecs += segmentSecs;
          state.segmentStartSecs = null;
          state.trackTerminated = true;
          const durationSecs = Math.round(((Number(durationMs) > 0 ? Number(durationMs) : 0) || state.current.durationMs || Number(positionMs) || 0) / 1000);
          emitPair(TELEMETRY_TERMINATION.finished, { segmentSecs, progressSecs: durationSecs, final: true });
          state.current = null;
        },

        onStopped({ positionMs } = {}) {
          // Guard on the track session, not the open segment: pause-then-skip
          // still owes its FINAL trackStreamed (review I6; hornet's flow).
          // Returns the post's promise: signOut awaits it before clearing
          // the session, so the final accounting goes out while it lives.
          if (!state.current) return null;
          const segmentSecs = state.trackTerminated ? 0 : segmentElapsedSecs();
          state.durationSumSecs += segmentSecs;
          state.segmentStartSecs = null;
          state.trackTerminated = true;
          const post = emitPair(TELEMETRY_TERMINATION.systemStop, { segmentSecs, progressSecs: Math.round((Number(positionMs) || 0) / 1000), final: true });
          state.current = null;
          return post;
        },

        // debug visibility
        _state: state
      };
    }

    // ── The diagnostic capture's helpers (#1356 M11, moved from the deleted
    // amazon-music-logic.js) — pure, and the only copy since the teardown.
    // The capture is how a NEW flow is learned: load a live page, list every
    // gql operation it fires, replay only the page's own reads about its
    // subject, and redact what comes back. ────────────────────────────────

    // Which page a capture URL names: an album page (/albums/<ASIN>) or a
    // search page (/search/<text>/<tab>). Everything else is refused — the
    // capture loads a real page and matches its requests against the
    // subject, so a URL that names neither has nothing to match.
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

    // Whether a captured request is the page's own read query for what it
    // shows: its variables name the album ASIN, or carry the search text.
    // Only these are replayed (to read their response shape); everything else
    // is listed by name. Writes are NEVER replayed, even when their variables
    // name the album — a replay would repeat the action ("add to library",
    // "record a view") on the user's account. (Shares GQL_WRITE_OP /
    // GQL_MUTATION_NAME with the album-detail candidate filter.)
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

    // A copy of a gql value that is safe to log and share: secret-looking
    // keys redacted, query strings cut from URLs (signed CDN URLs carry
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

    // One captured request as written to a capture: never header values (they
    // carry the session), only their names.
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

    return {
      SESSION, GQL_URL, CONFIG_URL,
      PAGE_CAPTURE_BUDGET_MS, PAGE_CAPTURE_QUIET_MS, ALBUM_CAPTURE_QUIET_MS, ALBUM_DETAIL_OP_NAME, ALBUM_JOB_STALE_MS,
      PLAYLIST_CAPTURE_QUIET_MS, PLAYLIST_DETAIL_OP_NAME,
      PLAN_TTL_MS, PLAN_UNKNOWN_TTL_MS,
      RECOMMENDATIONS_CACHE_TTL_MS, SEE_MORE_CACHE_MAX,
      MUSIC_HOME_FIRST_LIMIT, MUSIC_HOME_MAX_PAGES,
      AMAZON_HOMES, HOME_REFUSED_STATUS, PLAYLISTS_SECTION_ID,
      RECOMMENDATIONS_WALK_TIMEOUT_MS,
      notReady,
      pageBlocksPlayback,
      amazonAuthCookieState,
      isAmazonMusicPage,
      amazonSongSearchUrl,
      amazonSpecSearchRequest,
      amazonAlbumSearchUrl,
      amazonArtistSearchUrl,
      amazonAlbumAsinFromUrl,
      makeSpecSearchTemplate,
      specTemplateIsFresh,
      specBodyWithVars,
      createSearchBreaker,
      createLaneQueue,
      capturedOperationNames,
      amazonGqlFetchHeaders,
      GQL_PARTIAL_STATUS,
      gqlReplayOutcome,
      playlistPartialIsUsable,
      gqlCaptureSubject,
      gqlRequestsIn,
      gqlRequestIsAboutSubject,
      redactGqlSample,
      summarizeGqlRequest,
      trackFromGqlEdge,
      searchTracksFromGql,
      searchAlbumsFromGql,
      albumFromGqlSearchNode,
      searchArtistImageFromGql,
      artistFromGqlSearchNode,
      amazonAlbumDetailCandidates,
      albumTracksConnectionIn,
      albumDetailFromGql,
      albumTrackFromGqlEdge,
      assignDiscNumbers,
      amazonPlaylistIdFromUrl,
      amazonPlaylistDetailRequest,
      playlistFromGql,
      playlistPageInfoFromGql,
      playlistEdgesFromGql,
      paginatePlaylistTracks,
      PLAYLIST_BUSY_BACKOFF_MAX_MS,
      amazonNormalizeArtistName,
      recommendationItemFromGqlNode,
      amazonMusicHomeRequest,
      recommendationsFromMusicHome,
      musicHomeBodyWithVars,
      mergeMusicHomeSectionPages,
      amazonSeeMoreRequest,
      recommendationStrategyId,
      amazonSeeMorePageUrl,
      seeMoreSectionIdFor,
      seeMoreBodyWithVars,
      recommendationsFromSeeMore,
      amazonPlanFromTier,
      tierFromConfig,
      amazonPlanMessage,
      amazonPlaybackLimit,
      HOME_URL,
      SIGN_IN_WINDOW,
      onMusicHost,
      signInLanded,
      signInTickLeftMusicHost,
      signInPromptDecision,
      HICCUP_GRACE_MS,
      STREAK_GAP_MS,
      AMAZON_DEVICE_TYPE_ID,
      DML_TARGET_PREFIX,
      WIDEVINE_CERT_CHALLENGE,
      CERTIFICATE_DENIAL_REASONS,
      HD_CONTENT_DENIAL_REASONS,
      licenseDenialSummary,
      amazonDmlsRegion,
      amazonDmlsManifestBody,
      amazonDmlsLicenseBody,
      amazonNativeSessionFromConfig,
      dashCodecFamily,
      mpdContentProtectionSets,
      mpdHasPlayableAudio,
      mpdRenditionGroupLabel,
      amazonGroupLabelFromDenial,
      amazonGroupRefusalScope,
      mpdDropRenditionGroups,
      MUSIC_AGENT_SDK,
      MUSIC_AGENT_CLIENT,
      MINT_CAPTURE_URL_PREFIXES,
      MINT_BENIGN_QUERY,
      deviceTimeZoneString,
      uuid4,
      AMAZON_TELEMETRY_CONSTANTS,
      TELEMETRY_TERMINATION,
      amazonTelemetryBitrateLabel,
      amazonClientAction,
      amazonStreamingDetails,
      createAmazonTelemetry
    };
  },

  // The compat guard (#1402's documented pattern): an app whose loader
  // predates _lib materializes the factory as an inert method and every
  // this.lib read is a null deref. Ship the readable error instead. Every
  // library-using method opens with this.
  requireLib: function () {
    if (!this.lib) {
      // The notReady shape (not a plain Error — the library is what is
      // missing, so lib.notReady is not available here): the callers' catch
      // would otherwise swallow the update message into a cached miss.
      const err = new Error('Amazon Music needs a newer Parachord — please update the app.');
      err.reason = 'not-ready';
      err.notReady = true;
      err.code = 'not-ready';
      throw err;
    }
    return this.lib;
  },

  // The per-instance page-flow queue: one job at a time (the plugin's whole
  // page flows — load + the verbatim replay after it — serialized on the
  // shared view), in TWO LANES mirroring the host's own (#1423's semantics,
  // createLaneQueue in _lib — the host's enqueue(fn, { lane }) in
  // main-process/web-session.js is the original). The FOREGROUND lane is for
  // a job the user is waiting on (a playlist they opened — lookupPlaylistFlow
  // — or a play needing a fresh session context — the csrf-triplet mint): it
  // starts before every queued BACKGROUND job (the
  // spec searches, album lookups, artist-photo jobs), FIFO within a lane, and
  // a running job is never interrupted. The queue lives on the instance
  // (per-resolver state, dropped with it).
  enqueuePageFlow: function (fn, { lane = 'background' } = {}) {
    const lib = this.requireLib();
    if (!this._pageFlowQueue) this._pageFlowQueue = lib.createLaneQueue();
    return this._pageFlowQueue.run(fn, { lane });
  },

  // ── The spec-search runner (#1356 M5) ──────────────────────────────────────
  // The track search's two paths, moved from amazon-web-player.js and
  // rewritten against the webSession bridge:
  //
  //   FAST PATH (trySpecReplay) — the last captured request, patched
  //   (searchText/specType) and replayed from the still-warm view via
  //   webSession.pageFetch: no page load, and replays run in parallel.
  //
  //   PAGE FLOW (specSearchPageFlow) — webSession.load(url, {capture}): the
  //   host serializes the navigation on its load chain, waits out in-flight
  //   replays (the readers/writer gate), and returns the captures once the
  //   page's request burst goes quiet — the quiet window that replaces the
  //   old in-flow 250ms poll, with the same 15s budget. Our own replay
  //   traffic arrives as echo-flagged captures and is never trusted: the
  //   matcher may take one (it answers the right search) but the template is
  //   never re-minted from it, and an echo never reads as the page having
  //   searched another spec (#1152's rules, on the data the bridge provides).
  //
  // Failure semantics unchanged: structural failures (the page never
  // searched, another spec searched but ours never came, or the response
  // carried no spec search envelope) throw not-ready and trip the breaker so
  // a hornet rename fails fast; a present envelope with empty edges is a
  // real miss and returns [].

  // Structural failure reporting: record on the search breaker (which opens
  // after consecutive failures) and make the not-ready error. A hornet rename
  // must never be confused with a miss, which resolution caches for 30 days.
  specStructuralError: function (message) {
    const lib = this.requireLib();
    if (!this._searchBreaker) this._searchBreaker = lib.createSearchBreaker();
    this._searchBreaker.recordFailure();
    const state = this._searchBreaker.state();
    if (state.open) console.warn('[Amazon] search breaker open for ' + Math.max(0, state.openUntil - Date.now()) + 'ms (' + state.failures + ' consecutive structural failures)');
    return lib.notReady('not-ready', message);
  },

  // Replay a captured gql request from the page world — webSession.pageFetch
  // (the host supplies the origin, cookies and CORS; the bridge scopes the
  // URL to the session's cookie domains). The APQ hash in the body comes
  // from the request the page itself made, so it is always current for this
  // hornet deploy. Never throws for a failed fetch: every failure is a
  // recoverable { error }, so the fast path degrades to the page flow.
  // `options.acceptPartial` opts a flow into HTTP 294 partial answers (see
  // GQL_PARTIAL_STATUS in _lib): a predicate over the parsed body that says
  // whether the data the flow needs came back. Without it a 294 is a failure
  // with its status — every flow here passes none, and the host's
  // music-home fallback depends on the same rule holding there. The status
  // rules live in the pure gqlReplayOutcome (unit-tested).
  replayGql: async function (entry, body, options = {}) {
    const lib = this.requireLib();
    const ws = window.electron && window.electron.webSession;
    if (!ws) return { error: 'Amazon webSession bridge not available' };
    const replayUrl = (entry && entry.url) || lib.GQL_URL;
    const headers = lib.amazonGqlFetchHeaders(entry && entry.headers);
    const raw = JSON.stringify(body);
    const replay = await ws.pageFetch(lib.SESSION, { url: replayUrl, method: 'POST', headers, body: raw });
    if (!replay || !replay.success) return { error: (replay && replay.error) || 'Amazon web-session bridge unavailable' };
    return lib.gqlReplayOutcome(replay, { acceptPartial: (options && options.acceptPartial) || null });
  },

  // The shared runner for the spec searches — the track search, the album
  // search and the artist-image lookup all ride it (the albums/artists tabs
  // fire the same SpecSearchSeeMorePage operation, differing only in
  // variables.specType). The fast path first; any template miss falls to the
  // chained page flow, whose capture re-mints the template — the fallback IS
  // the old flow, so the failure semantics never change. Only real page
  // navigation is serialized (the per-instance page flow chain below + the
  // host's load chain); replays run in parallel. `staleCheck` (the album
  // catalog / artist-image jobs' #1135 budget) short-circuits a job whose
  // caller already moved on — before any path selection, and again after
  // the chain wait — returning [] without a page load.
  specSearch: async function ({ url, searchText, specType, parse, noun, staleCheck = null }) {
    const lib = this.requireLib();
    if (staleCheck && staleCheck()) {
      console.log('[Amazon] ' + specType + ' search skipped: past the ' + lib.ALBUM_JOB_STALE_MS + 'ms budget before it started — the caller already moved on');
      return [];
    }
    if (!this._searchBreaker) this._searchBreaker = lib.createSearchBreaker();
    if (!this._searchBreaker.allows()) {
      const probe = this._searchBreaker.isProbe() ? ' (probing after cooldown)' : '';
      throw lib.notReady('not-ready', 'Amazon search is cooling down after repeated structural failures' + probe);
    }
    const fast = await this.trySpecReplay({ searchText, specType, parse, noun });
    if (fast !== null) return fast;
    // The per-instance page-flow queue: the host's load chain serializes the
    // LOADS; this queue serializes the plugin's whole page flows (load + the
    // verbatim replay after it) so one flow's re-minted template heals every
    // search queued behind it, and one flow's replay is never run into the
    // teeth of the next flow's navigation (a pageFetch arriving while a
    // navigation holds the gate answers { error: 'busy' }). Two lanes,
    // mirroring the host's own (#1423's semantics, createLaneQueue in _lib):
    // this is the BACKGROUND lane — the spec searches are speculative work;
    // the album lookup and the recommendations flows ride the same lane, and
    // a job the user is waiting on (a playlist they opened —
    // lookupPlaylistFlow — or a play's csrf-triplet mint, the foreground
    // lane) goes ahead of every job queued here. The host's own remaining loads
    // (the diagnostic capture) serialize against them on
    // the host's chain.
    const run = this.enqueuePageFlow(() => {
      if (staleCheck && staleCheck()) {
        console.log('[Amazon] ' + specType + ' search skipped: queued past the ' + lib.ALBUM_JOB_STALE_MS + 'ms budget — the caller already moved on');
        return [];
      }
      return this.specSearchPageFlow({ url, searchText, specType, parse, noun });
    });
    return run;
  },

  // specSearch's fast path: replay the cached request with fresh variables
  // from the warm view. Returns the parsed rows, or null for any template
  // miss (the caller then runs the page flow, which re-mints the template).
  // A wall URL on the warm view is one of those misses, NOT a throw: the
  // view keeps whatever URL its last navigation left behind, so a
  // token-refresh redirect can park it on a wall with a LIVE session, and a
  // throw would block the very page flow that navigates it off — the page
  // flow's own after-load URL re-check (it loads a fresh page, so its
  // verdict is current) is where a genuinely dead session surfaces
  // not-signed-in. A
  // structural-looking response (200 with data but no spec search envelope)
  // is NOT judged here: on the page flow that can only mean a hornet rename
  // (its request was captured seconds earlier), but on the fast path it can
  // equally mean the template went bad (the auth-failed-field shape of
  // rotated session headers). Replay-and-throw here made every later search
  // fail identically, probe included, with nothing able to heal the template
  // for 24h (#1152). So a missing envelope drops the template and defers to
  // the chained page flow, which makes the structural call with a fresh
  // capture.
  trySpecReplay: async function ({ searchText, specType, parse, noun }) {
    const lib = this.requireLib();
    const template = this._specSearchTemplate;
    if (!lib.specTemplateIsFresh(template, Date.now())) return null;
    // A replay needs an Amazon-origin page world (cookies, CORS): a parked
    // or never-loaded view means the page flow runs instead, and a wall URL
    // means the session died mid-flight (the same URL re-check every load
    // does). The state read also runs the session-generation check (see
    // sessionState): a template minted under the previous account is
    // dropped before it can replay into this one.
    const state = await this.sessionState();
    if (!state) return null;
    // The generation check inside sessionState may have dropped the template
    // (a sign-out the plugin cannot see the event of): the local snapshot
    // belongs to the previous account — its csrf headers must never replay
    // into this one. A template replaced meanwhile (a page flow re-mint) is
    // simply a miss — the caller falls to its page flow.
    if (this._specSearchTemplate !== template) return null;
    const href = state.url;
    if (!href || !lib.isAmazonMusicPage(href)) return null;
    if (lib.pageBlocksPlayback(href)) {
      // A MISS, not a throw: the view keeps whatever URL its last navigation
      // left behind, so a token-refresh redirect can park it on a wall with a
      // LIVE session — and a throw here would block the very page flow that
      // navigates it off. The page flow's own after-load URL re-check is
      // where a genuinely dead session surfaces not-signed-in (it loads a
      // fresh page, so its verdict is current).
      console.warn('[Amazon] ' + specType + ' replay blocked: ' + href + '; the page flow will navigate it off');
      return null;
    }
    const body = lib.specBodyWithVars(template.body, { searchText, specType });
    let outcome;
    try {
      outcome = await this.replayGql(template, body);
    } catch (error) {
      // A HARD rejection — the invoke refused, the view destroyed mid-replay
      // (signOut, host close) — is the same miss as an error envelope: the
      // fallback page flow re-evaluates view state itself. The fast path must
      // never break specSearch's throw contract.
      outcome = { error: (error && error.message) || String(error) };
    }
    if (outcome.error) {
      // A navigation holds the readers/writer gate: not a template miss (the
      // bridge answers 'busy'), just fall to the page flow without dropping
      // anything.
      if (outcome.error === 'busy') return null;
      console.warn('[Amazon] ' + specType + ' template replay failed (' + outcome.error + '); refreshing via a page load');
      // Drop only if nobody re-minted meanwhile — a page flow that ran in
      // parallel already put a fresh template in place.
      if (this._specSearchTemplate === template) this._specSearchTemplate = null;
      return null;
    }
    const parsed = outcome.parsed;
    const { rows, envelope } = parse(parsed && parsed.data);
    if (!envelope) {
      // Defer structure to the page flow (see the method comment): the
      // template may be stale, and only a fresh capture can prove a hornet
      // rename. The breaker gets involved only if the page flow also fails
      // structurally.
      console.warn('[Amazon] ' + specType + ' template replay was not a spec search envelope for ' + JSON.stringify(searchText) + '; dropping the template');
      if (this._specSearchTemplate === template) this._specSearchTemplate = null;
      return null;
    }
    if (this._searchBreaker) this._searchBreaker.recordSuccess();
    const fromSpec = template.body && template.body.variables && template.body.variables.specType;
    console.log('[Amazon] ' + specType + ' replay' + (fromSpec && fromSpec !== specType ? ' (' + fromSpec + ' template)' : '') + ' returning ' + rows.length + ' ' + noun + ' for ' + JSON.stringify(searchText));
    return rows;
  },

  // The page flow behind specSearch: load the tab page through the bridge
  // with the capture window inside the load, match the page's own search
  // request on the RETURNED captures, replay it, parse pure. Mint the
  // template the fast path replays. The load is serialized on the host's
  // chain (it waits out in-flight replays rather than tearing their frame
  // down mid-fetch) and its captures come back when the page's request burst
  // goes quiet (PAGE_CAPTURE_QUIET_MS — sized for a cold view's late first
  // request, not the host's 1000ms default — never later than
  // PAGE_CAPTURE_BUDGET_MS, the old in-flow poll's 15s window).
  specSearchPageFlow: async function ({ url, searchText, specType, parse, noun }) {
    const lib = this.requireLib();
    const ws = window.electron && window.electron.webSession;
    if (!ws) throw lib.notReady('not-ready', 'Amazon webSession bridge not available');
    // The page flow that ran while this one waited the per-instance chain
    // may have refreshed the template — one refresh heals every search
    // queued behind it.
    const warmed = await this.trySpecReplay({ searchText, specType, parse, noun });
    if (warmed !== null) return warmed;
    const load = await ws.load(lib.SESSION, url, {
      capture: {
        urlPrefixes: [lib.GQL_URL + '*'],
        quietMs: lib.PAGE_CAPTURE_QUIET_MS,
        budgetMs: lib.PAGE_CAPTURE_BUDGET_MS
      }
    });
    if (!load || !load.success) {
      // A refused load: 'load-failed' (the page never finished), 'superseded'
      // (a sign-out cleared the session mid-load), 'not-ready' (no host
      // window). Transient/wiring classes, never a miss and never a sign-in
      // prompt.
      throw lib.notReady((load && load.reason) || 'load-failed', (load && load.error) || 'Amazon search page did not finish loading');
    }
    // The after-load URL re-check: a genuinely dead session is caught
    // mid-flight (the page redirected to a sign-in wall while it loaded).
    if (lib.pageBlocksPlayback(load.finalUrl)) {
      console.warn('[Amazon] search blocked: ' + load.finalUrl);
      throw lib.notReady('not-signed-in', 'Choose an Amazon Music profile');
    }
    // The entries must have their headers — the host pairs bodies with
    // headers by request id (onBeforeSendHeaders fires milliseconds after
    // onBeforeRequest), and ALL header-complete bodies go to the matcher:
    // the matcher only ever accepts the wanted spec, so a different-spec
    // request that arrived first cannot win by first-arrival.
    const captured = (load.captures || []).filter(r => r.headers);
    const bodies = captured.map(r => r.body);
    const request = lib.amazonSpecSearchRequest(bodies, searchText, { spec: specType });
    if (!request) {
      // The page loaded but never ran our search: a hornet rename of the
      // operation (or the search page itself), or an SPA failure. Log what
      // the page did fire so a rename reads as a rename instead of a silent
      // run of empty searches each cached as a 30-day noMatch.
      // The old other-spec grace (a same-text different-spec request meant
      // "the page searched the wrong tab", concluded structurally early):
      // on the returned captures the window has already closed, so the grace
      // is a diagnosis, not a wait — and an echo-flagged capture is never
      // evidence. Echoes are OUR replay traffic (this plugin's — track,
      // album or artist spec replays share the one template): reading one
      // as "the page searched another spec" is exactly the #1152 poisoning,
      // so an echoed candidate degrades the diagnosis to "never searched".
      const otherSpec = captured.find(r => !r.echo && lib.amazonSpecSearchRequest([r.body], searchText, { anySpec: true }));
      const seen = lib.capturedOperationNames(bodies).join(', ') || 'none';
      if (otherSpec) {
        console.warn('[Amazon] search: a non-' + specType + ' spec searched for ' + JSON.stringify(searchText) + ' but the ' + specType + ' spec never came; gql operations seen: ' + seen);
        throw this.specStructuralError('Amazon search page searched our text with another spec but never the ' + specType);
      }
      console.warn('[Amazon] search: page never fired the ' + specType + ' search for ' + JSON.stringify(searchText) + '; gql operations seen: ' + seen);
      throw this.specStructuralError('Amazon search page never issued its ' + specType + ' search');
    }
    if (!request.variables || typeof request.variables !== 'object') {
      throw this.specStructuralError('Unexpected Amazon search query shape');
    }
    // The page's OWN capture is preferred over our echo (both match; the
    // echo's headers are session-aged) — for the replay either answers, but
    // the mint must take the page's.
    const match = (r) => lib.amazonSpecSearchRequest([r.body], searchText, { spec: specType });
    const entry = captured.find(r => !r.echo && match(r)) || captured.find(match);

    // Replay the page's own request verbatim. (Capturing the page's own
    // response in the page world instead — the stream-capture pattern —
    // does NOT work here: hornet binds its fetch at module init, before
    // any preload-injected wrapper can install, so the page's own search
    // bypasses the wrapper. The replay's cost is one request on top of the
    // ~9 ops the page load itself fires.)
    // Mint BEFORE this flow's own replay runs: the template captures the
    // page's own fresh request, which is valid whether or not the replay
    // that follows answers well — a later replay error drops it again
    // anyway. NEVER mint from OUR OWN echo (echo: true), whatever the
    // existing template's state: the echoed capture is a replay of some
    // template, and minting from it would re-store session-aged headers
    // with a fresh capturedAt, keeping a stale header set certified-fresh
    // indefinitely (#1152 — bodyMatchesTemplate in the host copy guarded
    // this by comparing bytes; the bridge's echo flag says it outright).
    // The rows are still correct — the replay below answers the same search
    // either way; an echo-only match just stays page-load-per-search.
    if (entry.echo) {
      console.log('[Amazon] search matched our own replay in the capture; not minting from it');
    } else {
      const template = lib.makeSpecSearchTemplate({ url: entry.url, headers: entry.headers, body: request, capturedAt: Date.now() });
      if (template) this._specSearchTemplate = template;
      else console.warn('[Amazon] spec search captured a request that is not template-shaped; staying page-load-per-search');
    }
    let outcome;
    // A busy gate is transient (a concurrent navigation — the host's session
    // mint or diagnostic capture, or a playlist import's pagination replay
    // riding out this load — holds the readers/writer gate), not a
    // structural failure: the capture already succeeded. A short bounded
    // retry rides it out; anything still busy after it is not-ready.
    for (let attempt = 0; ; attempt++) {
      try {
        outcome = await this.replayGql(entry, request);
      } catch (error) {
        // A HARD rejection — the invoke refused, the view destroyed mid-replay —
        // is the same as an error envelope: not-ready, never a raw throw the
        // callers would map to a cached miss.
        outcome = { error: (error && error.message) || String(error) };
      }
      if (outcome.error !== 'busy') break;
      // Back off within a ~12s bound: a real navigation can hold the gate
      // for its whole load budget, and the capture already succeeded — the
      // flow is one gate away from its answer.
      const wait = attempt < 3 ? 400 : 1000;
      if (attempt >= 3 && (attempt - 3 + 1) * 1000 > 12000) break;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    if (outcome.error) throw lib.notReady('not-ready', outcome.error);
    const parsed = outcome.parsed;
    const { rows, envelope } = parse(parsed && parsed.data);
    if (!envelope) {
      // The response carried no spec search envelope: hornet renamed the
      // response field. A rename must surface as not-ready, not as a cached
      // miss.
      console.warn('[Amazon] search response was not a spec search envelope for ' + JSON.stringify(searchText));
      throw this.specStructuralError('Amazon search response was not a spec search envelope');
    }
    if (this._searchBreaker) this._searchBreaker.recordSuccess();
    console.log('[Amazon] search returning ' + rows.length + ' ' + noun + ' for ' + JSON.stringify(searchText));
    return rows;
  },

  // ── The diagnostic capture (#1356 M11, moved from the deleted host module) ─
  // Diagnostic (a developer tool, no UI): load one Amazon Music album page
  // (/albums/<ASIN>) or search page (/search/<text>/<tab>) in the offscreen
  // view and record the gql operations it fires — the tool the album search,
  // the album lookup, the artist-image lookup and the recommendations flows
  // were built from, since those shapes are only visible from a live
  // signed-in session. Every operation is listed (name, endpoint, redacted
  // variables, header NAMES only: their values carry the session); only the
  // page's own read queries about its subject (gqlRequestIsAboutSubject) are
  // replayed once each, so their response shapes can be read, and those
  // responses are redacted and trimmed (redactGqlSample) before they leave
  // the method. The caller decides what to do with the reply — DevTools
  // reaches it through the renderer's window.__parachordResolver helper
  // (src/renderer/app.js) and copies the JSON out:
  //
  //   const out = await window.__parachordResolver('amazonmusic')
  //     .debugCaptureGql('https://music.amazon.com/albums/<ASIN>');
  //   copy(JSON.stringify(out, null, 2));   // DevTools clipboard
  //
  // (the old IPC handler wrote the capture to userData; the plugin has no
  // file access, and copy() from the console replaces the file). Rides the
  // plugin's page-flow chain like every other page flow (serialized against
  // the spec-search/catalog/playlist/recommendation flows; the host's own
  // load chain serializes the navigation itself).
  debugCaptureGql: async function (rawUrl) {
    const lib = this.requireLib();
    const ws = window.electron && window.electron.webSession;
    if (!ws) throw lib.notReady('not-ready', 'Amazon webSession bridge not available');
    const subject = lib.gqlCaptureSubject(rawUrl);
    if (!subject) {
      throw lib.notReady('not-ready', 'Pass a music.amazon.com album URL (/albums/<ASIN>) or search URL (/search/<text>/<tab>)');
    }
    if (!(await this.isSignedIn())) {
      throw lib.notReady('not-signed-in', 'Sign in and choose an Amazon Music profile');
    }
    const run = (this._pageFlowChain || Promise.resolve()).then(() => this.debugCapturePageFlow(rawUrl, subject));
    this._pageFlowChain = run.then(() => {}, () => {});
    return run;
  },

  // The capture's own page flow (the chain wrapper above serializes it): one
  // load with the gql capture window inside it, then the subject reads
  // replayed once each. The quiet window is the old host flow's (3s with no
  // new captured request, at most 20s — a diagnostic wants the page's whole
  // burst, not the flows' tighter 2.5s/15s window).
  debugCapturePageFlow: async function (rawUrl, subject) {
    const lib = this.requireLib();
    const ws = window.electron && window.electron.webSession;
    if (!ws) throw lib.notReady('not-ready', 'Amazon webSession bridge not available');
    const load = await ws.load(lib.SESSION, rawUrl, {
      capture: {
        urlPrefixes: [lib.GQL_URL + '*'],
        quietMs: 3000,
        budgetMs: 20000
      }
    });
    if (!load || !load.success) {
      throw lib.notReady((load && load.reason) || 'load-failed', (load && load.error) || 'Amazon capture page did not finish loading');
    }
    // A wall the page redirected to while it loaded (the same after-load
    // re-check every page flow runs).
    if (lib.pageBlocksPlayback(load.finalUrl)) {
      throw lib.notReady('not-signed-in', 'Choose an Amazon Music profile');
    }
    // Headers must be attached before an entry counts (the host pairs bodies
    // with headers by request id; onBeforeSendHeaders fires milliseconds
    // after onBeforeRequest).
    const captured = (load.captures || []).filter(r => r.headers);
    const operations = [];
    for (const entry of captured) {
      for (const req of lib.gqlRequestsIn(entry.body)) {
        const op = lib.summarizeGqlRequest(entry, req);
        if (lib.gqlRequestIsAboutSubject(req, subject)) {
          // A busy gate (a concurrent navigation holds the host's
          // readers/writer gate) is transient: the same bounded backoff the
          // other replay flows carry, then whatever error remains is recorded
          // on the operation — a diagnostic reports it, never hides it.
          let out;
          for (let attempt = 0; ; attempt++) {
            try {
              out = await this.replayGql(entry, req);
            } catch (error) {
              out = { error: (error && error.message) || String(error) };
            }
            if (!out || out.error !== 'busy') break;
            const wait = attempt < 3 ? 400 : 1000;
            if (attempt >= 3 && (attempt - 3 + 1) * 1000 > 12000) break;
            await new Promise((resolve) => setTimeout(resolve, wait));
          }
          op.replayed = true;
          op.response = (!out || out.error) ? { error: (out && out.error) || 'Amazon gql query failed' } : lib.redactGqlSample(out.parsed);
        }
        operations.push(op);
      }
    }
    console.log('[Amazon] gql capture ' + rawUrl + ': ' + operations.length + ' operation(s), ' + operations.filter(o => o.replayed).length + ' replayed');
    return {
      capturedAt: new Date().toISOString(),
      page: rawUrl,
      finalUrl: load.finalUrl,
      subject,
      operations
    };
  },

  // ── The session generation (the sign-out the plugin cannot see) ───────────
  // The host's clear() bumps a session generation and state() carries it:
  // the plugin cannot see the sign-out EVENT, but every state read can
  // compare the generation against the one this instance cached under. Sign
  // out → sign in as another account with no search between would otherwise
  // serve account A's plan reading (up to 30 min) and spec-search template
  // (up to 24h — its headers embed the OLD session's csrf tokens, the same
  // reason amazon-web-player.js's signOut nulls its own templates). Every
  // state read goes through here (isSignedIn, trySpecReplay), so the drop
  // lands on the first read after the switch — before any cache is served.
  // The drop itself is dropSessionState below (the shared sign-out reset
  // list; signOut calls it directly, a generation change lands here).
  sessionState: async function () {
    const lib = this.requireLib();
    const ws = window.electron && window.electron.webSession;
    if (!ws) return null;
    const state = await ws.state(lib.SESSION);
    if (!state || !state.success) return null;
    if (typeof state.generation === 'number') {
      if (this._sessionGeneration === undefined) {
        this._sessionGeneration = state.generation;
      } else if (state.generation !== this._sessionGeneration) {
        this._sessionGeneration = state.generation;
        this.dropSessionState();
      }
    }
    return state;
  },

  // The sign-out reset list (the M9 generation drop, named): everything the
  // plugin holds that belongs to the signed-in account dies — the plan
  // reading (the next sign-in may be another plan), the spec-search template
  // and the recommendations state (M5/M8 — the templates embed the old
  // session's csrf headers, the parsed caches carry the old account's
  // content, and the music-home variant belongs to the old account), the
  // search breaker (its failure counts may be session-shaped; a fresh session
  // is the recovery path), the DRM state (M9 — the session context embeds
  // the old session's csrf triplet; the cert warm, the telemetry instance
  // and its health are session-scoped the same way) and the mint's benign
  // query source (account A's last search is not "already in the user's
  // history" under account B). The stream the old account was playing gets
  // its FINAL accounting first (the old dmls onSignOut's
  // trackStreamed-before-the-clear): the post's promise is RETURNED, and
  // signOut awaits it before the clear, so the accounting goes out while the
  // session still lives. The generation-drop caller cannot rely on it — the
  // plugin only sees the generation change on its first state read AFTER
  // webSession.clear(), so the onStopped there always fires once the cookies
  // are gone and its post fails (best-effort, fire-and-forget); what posts
  // the final pair in practice is the Settings sign-out button stopping the
  // engine BEFORE it calls sign-out — that 'stopped' reaches
  // handlePlayerEvent while the session still lives. _cdmProbe is process
  // state, not session state — a CDM does not leave with the account.
  dropSessionState: function () {
    this._planState = null;
    this._planPromise = null;
    // Rendition-group refusals split the same way as the engine's family
    // table: an eligibility refusal ('license-denied') is the ACCOUNT's —
    // the next account's plan may cover the group — while an UNVERIFIED-
    // request refusal ('build-refused') is this BUILD's and stays (a
    // different account changes nothing about this build's VMP signature).
    if (this._refusedGroups) {
      for (const label of Array.from(this._refusedGroups.keys())) {
        if (this._refusedGroups.get(label) === 'license-denied') this._refusedGroups.delete(label);
      }
    }
    this._specSearchTemplate = null;
    this._musicHomeTemplate = null;
    this._seeMoreTemplate = null;
    this._recommendationsCache = null;
    this._seeMorePages = new Map();
    this._musicHomeVariant = null;
    this._searchBreaker = null;
    // The final accounting (the returned promise is signOut's to await
    // before the clear; every other caller fires it best-effort).
    let finalPost = null;
    try {
      if (this._telemetry) finalPost = this._telemetry.onStopped({});
    } catch (e) { /* best-effort */ }
    this._drmSessionContext = null;
    this._drmSessionContextPromise = null;
    this._certSessionReady = false;
    this._telemetry = null;
    this._telemetryHealth = { last: null, dropped: 0 };
    this._lastSearchText = null;
    this._cookieWarned = false;
    return finalPost;
  },

  // ── The signed-in verdict ──────────────────────────────────────────────────
  // The plugin's composition of the host's facts (webSession.state() →
  // { url, signInUrl, cookieNames } — read through sessionState, which also
  // runs the generation check) with Amazon's pure predicates — the
  // composition the host's isSignedIn ran until #1356 M10 moved every
  // session surface here. Ready means signed in AND a profile chosen (a window still on the
  // profile picker is not ready, even with a cookie set); a page is never
  // proof of a session, and only the sign-in window's URL is authoritative
  // (the hidden view keeps whatever URL its last navigation left behind).
  isSignedIn: async function () {
    const lib = this.requireLib();
    const state = await this.sessionState();
    if (!state) return false;
    const cookies = lib.amazonAuthCookieState(state.cookieNames);
    if (cookies === 'none') return false;
    // The auth-cookie names are an implementation detail Amazon can rotate.
    // A jar with no known name but another auth-shaped one (x-main, at-*,
    // sess-at-*) is a live session under new names: trust it, and say so
    // once.
    if (cookies === 'rotated' && !this._cookieWarned) {
      this._cookieWarned = true;
      console.warn('[Amazon] no auth cookie matched (at-main|sess-at-main|at-acb) but other Amazon session cookies are set — Amazon may have rotated cookie names');
    }
    if (state.signInUrl && lib.pageBlocksPlayback(state.signInUrl)) return false;
    return true;
  },

  // ── The plan gate (#1220): only Music Unlimited plays ──────────────────────
  // The plugin's copy of the gate the deleted amazonmusic-search-tracks
  // handler ran (amazonDmls.assertPlanPlays): the plan is config.json's
  // `tier`, read through the webSession bridge (the jar's cookies ride the
  // fetch), mapped by amazonPlanFromTier, cached 30 min ONLY when the reading
  // is unlimited — a refusal (prime/unknown) re-reads within the 1-min TTL —
  // and unknown BLOCKS (a format change on Amazon's side must show up as a
  // message, not as plays the plan may not cover). Search checks it only when
  // signed in — a signed-out search must still answer not-signed-in, the
  // sign-in prompt — and before searching. The plugin has no refresh channel,
  // so the refusal TTL is the upgrade path's backstop: an upgrade unblocks
  // the search a minute later at the worst. { refresh: true } skips the TTL
  // cache (the status read's "read it from Amazon, not the cache" — the old
  // host getStatus's refreshPlan).
  getPlan: async function ({ refresh } = {}) {
    const lib = this.requireLib();
    const ws = window.electron && window.electron.webSession;
    if (!ws) return 'unknown';
    const now = Date.now();
    const s = this._planState;
    // dmls's own shape (amazon-dmls.js getPlan): a FORCED re-read skips the
    // cache entirely — it exists to catch a change — and a scheduled read
    // serves it within the TTL. Only an UNLIMITED reading earns the 30-min
    // TTL. The plugin has no refresh channel, so a refused reading (prime /
    // unknown) re-reads within the 1-min TTL: an upgrade unblocks search a
    // minute later at the worst, and the status read (refresh: true) catches
    // it at once where the person is looking. The harmful error is a false
    // refusal (an Unlimited account blocked); a false unlimited reading costs
    // at most one failed play's manifest refusal.
    if (!refresh && s) {
      const ttl = s.plan === 'unlimited' ? lib.PLAN_TTL_MS : lib.PLAN_UNKNOWN_TTL_MS;
      if (now - s.at < ttl) return s.plan;
    }
    // Join an in-flight read only when it started under the same session
    // generation — a read that started before a sign-out belongs to the old
    // account, and joining it would gate the new account on the old plan.
    if (this._planPromise && this._planPromiseGeneration === this._sessionGeneration) {
      return this._planPromise;
    }
    const startedGeneration = this._sessionGeneration;
    this._planPromiseGeneration = startedGeneration;
    const myPlanPromise = this._planPromise = (async () => {
      let config = {};
      try {
        const out = await ws.fetch(lib.SESSION, {
          url: lib.CONFIG_URL,
          method: 'GET',
          headers: { Accept: 'application/json', Referer: 'https://music.amazon.com/' }
        });
        if (out && out.success && typeof out.text === 'string') {
          config = JSON.parse(out.text); // a bad reply reads as no tier → unknown
        }
      } catch (e) { /* a failed fetch reads as no tier → unknown */ }
      const plan = lib.amazonPlanFromTier(lib.tierFromConfig(config));
      // The dmls gate's rule, exactly (amazon-dmls.js getPlan): only a FORCED
      // re-read that comes back without a tier (offline, a bad reply) keeps a
      // known plan — that would otherwise block an Unlimited account for a
      // minute because Settings opened — and it keeps the reading WITHOUT
      // re-caching it (the stale timestamp stands, so a scheduled re-read
      // that follows stays the judge). The generation check is the plugin's
      // equivalent of dmls's onSignOut-forgets: a known plan from before a
      // sign-out belongs to the old account. A SCHEDULED re-read stays the
      // judge: it reads what came back (unknown), so a hornet rename of
      // `tier` surfaces as plan-ineligible here exactly as it does host-side,
      // never as this plugin serving its last Unlimited reading until a
      // restart or sign-out.
      if (
        refresh && plan === 'unknown' &&
        s && s.plan !== 'unknown' &&
        this._sessionGeneration === startedGeneration
      ) {
        return s.plan;
      }
      // A sign-out raced the read (the generation bumped): the reading
      // belongs to the old account — don't cache it under the new one (the
      // generation drop in sessionState is worthless if this write lands
      // after it).
      if (this._sessionGeneration === startedGeneration) {
        this.notePlanReading(plan);
      }
      return plan;
    })();
    try {
      return await this._planPromise;
    } finally {
      // Clear only this call's slot: an overlapping read that started after a
      // generation bump owns the field now, and a third read must join it,
      // not start a third fetch.
      if (this._planPromise === myPlanPromise) this._planPromise = null;
    }
  },

  // The plan-reading write: every `_planState` write site goes through here.
  // A reading that turns `unlimited` FROM non-unlimited clears the
  // ACCOUNT-scoped rendition-group refusals (the `license-denied` entries —
  // the next reading's plan may cover the group; the `build-refused` ones
  // stay: the build's VMP signature did not change with the plan). On this
  // stack a Prime account never reaches a licence at all (`assertPlanPlays`
  // refuses before any dmls request), so an eligibility refusal is only ever
  // recorded under an UNLIMITED reading — the reachable transition is
  // unlimited → unknown (a scheduled re-read on a bad reply) → unlimited,
  // and the return to unlimited is the moment the old refusals must not
  // outlive. A RE-read of an already-unlimited plan clears nothing (the
  // first-ever reading counts as the turn: there is nothing older to keep,
  // and the worst case is one extra refusal round-trip on the next track).
  notePlanReading: function (plan) {
    const previous = this._planState && this._planState.plan;
    this._planState = { plan, at: Date.now() };
    if (plan === 'unlimited' && previous !== 'unlimited' && this._refusedGroups) {
      for (const label of Array.from(this._refusedGroups.keys())) {
        if (this._refusedGroups.get(label) === 'license-denied') this._refusedGroups.delete(label);
      }
    }
  },

  // Throws plan-ineligible unless the account is on Music Unlimited. The
  // resolver treats plan-ineligible as not-ready, so nothing is cached as a
  // 30-day noMatch and an upgrade re-resolves.
  assertPlanPlays: async function () {
    const lib = this.requireLib();
    const plan = await this.getPlan();
    if (plan !== 'unlimited') {
      const err = lib.notReady('plan-ineligible', lib.amazonPlanMessage(plan) || lib.amazonPlanMessage('unknown'));
      // plugins.md's contract for the DRM pair: the plan as the service names
      // it, the field the engine's refusal handlers read.
      err.planKey = plan;
      throw err;
    }
    return plan;
  },

  // ── The session surfaces (#1356 M10): the status reply, sign-in, sign-out ──
  // The host's sign-in window, sign-out and getStatus died with this move; the
  // plugin is the session authority (docs/architecture/amazon-music.md,
  // "Sign-in"). All three ride the ONE host web-session instance through the
  // webSession bridge like every other flow.

  // The status reply (capabilities.status, docs/architecture/plugins.md
  // "Status and playback limits"): one answer feeds the playback limit map
  // (pluginStatusLimit over playbackLimit), the resolver tile and the
  // Settings sign-in row (pluginStatusRow over statusLabel/statusMessage).
  // The plan is read FRESH — the old getStatus's refreshPlan: the read runs
  // on the settings path (startup, Settings open, the panel, a plan
  // refusal), where an upgrade must show at once, and a signed-out reply
  // reads no plan at all (config.json needs the session). `cdm` is the
  // build's Widevine verdict (cdmAvailable below) — an extra field the
  // sign-in prompt gate reads so it never opens a window a build can't play
  // from; everything else in the reply is the documented shape.
  getStatus: async function () {
    const lib = this.requireLib();
    const signedIn = await this.isSignedIn();
    let plan = null;
    if (signedIn) {
      try {
        // FRESH on purpose, on every call — the background not-signed-in
        // prompt decisions go through this reply too, so the prompt gate
        // always sees the current plan (the one config.json round trip it
        // costs is the price of that; #1440 review, note 4).
        plan = await this.getPlan({ refresh: true });
      } catch (e) { plan = 'unknown'; }
    }
    const cdm = await this.cdmAvailable();
    const limit = signedIn ? lib.amazonPlaybackLimit(plan) : null;
    return {
      signedIn,
      playbackLimit: limit,
      // 'Setup required' is the signed-out wording — the tile's own badge
      // and the Settings row agree (a signed-out Amazon still searches and
      // plays nothing until the sign-in; the dialog opens only when the
      // user asks for Amazon).
      statusLabel: signedIn ? null : 'Setup required',
      statusMessage: signedIn
        // The blocked plan's message; nothing to add on unlimited. Signed out,
        // the profile-picker hint rides along — choosing a profile is the
        // step people miss (the docs' sign-in section exists because of it).
        ? (limit && limit.blocked ? limit.message : null)
        : (cdm
          ? 'Sign in with your Amazon Music account, then choose a profile if Amazon asks.'
          : 'This build cannot play DRM-protected Amazon streams'),
      cdm
    };
  },

  // Does this build carry a Widevine CDM at all? The old host read
  // (electron.components.status() in main, via the IPC status) died with
  // this move; the plugin's DRM pair runs in the renderer, and the
  // renderer's own EME probe is the honest fact — requestMediaKeySystemAccess
  // is the same gate playback itself passes (the shared engine's
  // getSupportedCodecFamilies probes the same way; the minimal config, never
  // a stricter robustness ask — one false-negatives on working L3 CDMs).
  // Only a TRUE answer caches: a CDM never leaves a process, but a FALSE can
  // be a moment, not a verdict — on a first launch the probe can run while
  // castlabs is still installing the CDM (main.js's waitForWidevine gives up
  // after 10s and opens the window anyway), and the old host read saw the
  // install finish because it re-read components.status() on every
  // getStatus. A latched false would show "cannot play DRM-protected streams"
  // and turn every Sign in into the no-CDM toast until a restart, so a false
  // re-probes on the next read; an in-flight probe is joined, never
  // duplicated.
  cdmAvailable: async function () {
    if (this._cdmProbe !== true) {
      const probe = this._cdmProbeInFlight || (this._cdmProbeInFlight = (async () => {
        const nav = (typeof window !== 'undefined' && window.navigator) || (typeof navigator !== 'undefined' ? navigator : null);
        if (!nav || typeof nav.requestMediaKeySystemAccess !== 'function') return false;
        try {
          const access = await nav.requestMediaKeySystemAccess('com.widevine.alpha', [{
            initDataTypes: ['cenc'],
            audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }]
          }]);
          return !!access;
        } catch (e) {
          return false;
        }
      })());
      // Latch only a true. A false stays a false for THIS reply alone; the
      // slot clears so the next read probes again — and an overlapping call
      // joins this probe rather than starting a second one.
      probe.then(
        (verdict) => { this._cdmProbe = verdict; },
        () => { this._cdmProbe = false; }
      ).finally(() => {
        if (this._cdmProbeInFlight === probe) this._cdmProbeInFlight = null;
      });
      try {
        return await probe;
      } catch (e) {
        return false;
      }
    }
    return true;
  },

  // The prompt rule for the renderer's sign-in flow (the pure decision the
  // renderer's manageAmazonMusic calls through the loaded resolver): while
  // the auth cookies say the session is live, a not-signed-in is a hiccup
  // (Amazon's periodic session-token refresh catching a page load) — retry
  // quietly; only a streak lasting a minute (most likely the profile picker
  // waiting for a choice) prompts. See _lib's signInPromptDecision.
  signInPromptDecision: function (inputs) {
    return this.requireLib().signInPromptDecision(inputs);
  },

  // Sign-in: the visible window over the bridge's signIn protocol — the host
  // shows the window (no preload; it must behave like a normal browser
  // window), loads the page (unbudgeted on purpose: this is the one window
  // the person watches) and ticks once a second with
  // { url, cookieNames }; the plugin supplies the verdict, Amazon's own
  // positive-signal rule (signInLanded: a non-wall music.amazon.com URL —
  // HOST equality, never a substring — stable two ticks AND an auth cookie,
  // or, once the window has been through Amazon's sign-in pages, a path off
  // the bare home page or a third stable tick; the cookie is one accepted
  // signal, not a requirement, so Amazon rotating the cookie names cannot
  // leave the window waiting forever, and a logged-out visitor parked on the
  // home page is never taken for a sign-in). lastUrl/stableTicks are kept
  // here because signInLanded's tick counting is its own. Resolves
  // { success, signedIn } — the same shape the old host openLogin answered.
  signIn: async function () {
    const lib = this.requireLib();
    const ws = window.electron && window.electron.webSession;
    if (!ws || typeof ws.signIn !== 'function') {
      return { success: false, error: 'no web-session bridge' };
    }
    let lastUrl = null;
    let stableTicks = 0;
    let sawSignInPage = false;
    const out = await ws.signIn(lib.SESSION, lib.HOME_URL, {
      window: { width: lib.SIGN_IN_WINDOW.width, height: lib.SIGN_IN_WINDOW.height },
      decide: (tick) => {
        const hasCookie = lib.amazonAuthCookieState(tick.cookieNames) !== 'none';
        if (lib.signInTickLeftMusicHost(tick.url)) sawSignInPage = true;
        const verdict = lib.signInLanded({ url: tick.url, lastUrl, stableTicks, hasCookie, sawSignInPage });
        lastUrl = tick.url;
        stableTicks = verdict.stableTicks;
        return verdict.landed;
      }
    });
    return out || { success: false };
  },

  // Sign-out. The partition (persist:amazon-music) is Amazon-only, so the
  // whole-session clear is correctly scoped — the machinery half is the
  // host's clear() behind the bridge: the views die, the sign-in window
  // closes, the webRequest capture detaches, the chain cuts and the storage
  // clears. The plugin's half runs FIRST: every session-scoped state this
  // instance holds drops (dropSessionState, which also posts the final
  // telemetry accounting — the stream the old account was playing gets its
  // trackStreamed pair), and the returned post is AWAITED before the clear:
  // the accounting goes out while the session still lives, never racing the
  // clear that destroys the cookies it needs. clear() bumps the generation
  // too, but the next getStatus must not serve the old account's plan
  // reading for even one read.
  signOut: async function () {
    const lib = this.requireLib();
    const ws = window.electron && window.electron.webSession;
    if (!ws || typeof ws.clear !== 'function') {
      return { success: false, error: 'no web-session bridge' };
    }
    const finalPost = this.dropSessionState();
    // Re-learn the generation on the next state read: the drop above already
    // ran for THIS sign-out, and clear()'s bump must not run it twice.
    this._sessionGeneration = null;
    // The final accounting goes out while the session still lives: the post
    // is AWAITED here, before the clear — its fetch needs the cookies the
    // clear destroys. best-effort still: a failed post (or none) never
    // blocks the sign-out.
    if (finalPost) await finalPost;
    const out = await ws.clear(lib.SESSION);
    if (!out || out.success !== true) {
      return { success: false, error: (out && out.error) || 'sign-out failed' };
    }
    return out;
  },

  // ── The DRM pair (#1356 M4, live since M9) ─────────────────────────────
  // getPlaybackManifest + relayLicense, moved from amazon-dmls.js (the
  // main-side provider died with this move). The flows ride the same ONE host
  // web-session instance through the window.electron.webSession bridge: the
  // dmls POSTs and the telemetry events go out via webSession.fetch (the
  // session's cookie jar rides them — Amazon's licence server needs the
  // auth cookies, and Electron's net module attaches them reliably only that
  // way), and the csrf triplet mints via a page flow's own capture (the old
  // host mint's pattern, `load(url, {capture})` + the placeholder filter).
  // The engine prefers this pair when it exists (use-playback-engine's
  // pluginWidevine gate); main's widevine provider registration for
  // 'amazonmusic' is gone, and the bridge's gates (sender, session, cap, the
  // shared manifest rate window) still apply — the plugin hands the manifest
  // UP through widevine:open-session and answers licence challenges forwarded
  // back from main.

  // The requested ASIN out of the WHOLE track the engine hands the plugin
  // (M4: the plugin digs its own identifier; the host stopped pre-extracting
  // one). The dig is the old host extraction's inputs verbatim — the track's
  // amazonmusic source record carries `amazonAsin`.
  drmAsinFromTrack: function (track) {
    const t = track && typeof track === 'object' ? track : {};
    const sources = t.sources && typeof t.sources === 'object' ? t.sources : {};
    const byId = sources[this.id] || sources.amazonmusic;
    return t.amazonAsin
      || (byId && byId.amazonAsin)
      || t.asin
      || null;
  },

  getPlaybackManifest: async function (track, config) {
    const lib = this.requireLib();
    const asin = this.drmAsinFromTrack(track);
    if (!asin) {
      throw lib.notReady('invalid', 'Amazon Music: no ASIN to play');
    }
    if (!(await this.isSignedIn())) {
      throw lib.notReady('not-signed-in', 'Sign in and choose an Amazon Music profile');
    }
    // The mint reads config.json (and records its plan reading), so the plan
    // gate below rarely fetches again — but the gate itself is what refuses.
    const ctx = await this.ensureSessionContext();
    // Only Music Unlimited plays (#1220): refused BEFORE any manifest request.
    await this.assertPlanPlays();
    const body = lib.amazonDmlsManifestBody({
      asin,
      customerId: ctx.customerId,
      marketplaceId: ctx.marketplaceId,
      territoryId: ctx.territoryId,
      deviceId: ctx.deviceId,
      musicAgent: await this.musicAgent()
    });
    if (!body) throw lib.notReady('invalid', 'Amazon Music: manifest body incomplete');
    const { status, text } = await this.dmls(ctx, 'getDashManifestsV2', body);
    let json = null;
    try { json = JSON.parse(text); } catch { /* fall through */ }
    if (status !== 200 || !json) {
      throw lib.notReady(status === -1 ? 'load-failed' : 'playback-failed',
        'Amazon Music: manifest HTTP ' + status + ': ' + (lib.licenseDenialSummary(text) || '').slice(0, 160));
    }
    const entry = json.contentResponseList && json.contentResponseList[0];
    if (!entry || entry.contentResponseStatusCode !== 'SUCCESS' || !entry.manifest) {
      throw lib.notReady('playback-failed',
        ('Amazon Music: manifest error ' + (entry ? entry.contentResponseStatusCode : 'empty') + ': ' + ((entry && entry.contentResponseStatusMessage) || '')).trim());
    }
    const substituteAsin = entry.substituteAsin || null;
    const cdnType = entry.cdnType || null;
    const musicDashVersion = entry.musicDashVersion || null;
    // A key group in the manifest is a license request Shaka will make whether
    // or not anything selects it, so a refusal that is only remembered at
    // selection time still pays the round-trip on every track. Drop the
    // refused groups from the manifest we hand the player instead — BEFORE
    // the protectionSets are computed, so the reply's sets describe the SERVED
    // manifest (a dropped group can never be blamed by error attribution).
    let manifest = entry.manifest;
    let droppedGroups = [];
    if (this._refusedGroups && this._refusedGroups.size) {
      const filtered = lib.mpdDropRenditionGroups(manifest, Array.from(this._refusedGroups.keys()));
      if (filtered.dropped.length) {
        manifest = filtered.manifest;
        droppedGroups = filtered.dropped;
      }
    }
    const protectionSets = lib.mpdContentProtectionSets(manifest);
    // The full rung/KID shape, not just one KID per set: which rungs a track
    // offers and which rendition group each set rides is what every
    // license-shaped investigation needs, and it is otherwise only readable
    // from a pasted MPD. The roster is built from the SERVED manifest — when
    // filtering changed the document, print served/original so the size next
    // to the roster can not be misread as the raw answer's.
    const roster = protectionSets
      .map((g) => g.family + (g.groupLabel ? '/' + g.groupLabel : '')
        + '(' + ((g.kids || []).length
          ? (g.kids.length === 1 ? 'KID-' + String(g.kids[0]).slice(0, 6) : g.kids.length + ' KIDs')
          : 'clear') + ') '
        + g.reps.map((r) => (r.codecs || '?') + '@' + Math.round((r.bandwidth || 0) / 1000) + 'k').join(' '))
      .join(' | ');
    const sizeNote = manifest === entry.manifest
      ? Math.round(entry.manifest.length / 1024) + 'KB'
      : Math.round(manifest.length / 1024) + '/' + Math.round(entry.manifest.length / 1024) + 'KB';
    console.log('[Amazon dmls] manifest ' + asin + (substituteAsin ? ' → substitute ' + substituteAsin : '')
      + ' (' + sizeNote + ', ' + roster + ')'
      + (droppedGroups.length ? ' [dropped refused groups: ' + droppedGroups.join(',') + ']' : ''));
    // CAQ= cert pre-charge once per session (the page world used to do this
    // in its Shaka setup; warm it lazily on the first successful manifest).
    this.kickCertWarm();
    return {
      manifest,
      type: 'dash',
      drm: 'widevine',
      // The plugin's identifier extraction, riding the reply's optional
      // extras: the host's trackSession entity keys provenance and
      // play-started telemetry off it, layering the SERVED asin over it when
      // Amazon substitutes one.
      asin: String(asin),
      substituteAsin,
      musicDashVersion,
      cdnType,
      protectionSets,
      // The opaque context relayLicense + telemetry need, carried main-side on
      // the licence session and forwarded back with every challenge (data,
      // never closures — it crosses IPC by value).
      context: {
        customerId: ctx.customerId,
        marketplaceId: ctx.marketplaceId,
        territoryId: ctx.territoryId,
        region: ctx.region,
        tier: ctx.tier,
        deviceType: ctx.deviceType,
        deviceId: ctx.deviceId,
        csrfToken: ctx.csrfToken,
        csrfRnd: ctx.csrfRnd,
        csrfTs: ctx.csrfTs,
        substituteAsin,
        musicDashVersion,
        cdnType
      }
    };
  },

  relayLicense: async function (challengeB64, context) {
    const lib = this.requireLib();
    const challenge = String(challengeB64 || '');
    // CDM challenges are ~7KB observed; b64 alphabet only. An oversize or
    // non-b64 blob would 400 opaquely downstream.
    if (!/^[A-Za-z0-9+/=]+$/.test(challenge) || challenge.length > 65536) {
      throw new Error('Amazon Music: invalid license challenge');
    }
    // The licence body's session bits: the passed context is the snapshot the
    // session opened with; the plugin's own mint is at least as fresh (an
    // auth-rot re-mint updates it mid-session and the passed snapshot cannot —
    // it is frozen main-side on the session). Prefer the live mint, fall back
    // to the passed snapshot, and let the auth-rot retry below refresh
    // whichever was used. The cert warm calls this with no context at all.
    const ctx = this._drmSessionContext
      || (context && typeof context === 'object' && context.customerId && context.csrfToken ? context : null)
      || (await this.ensureSessionContext());
    const body = lib.amazonDmlsLicenseBody({
      challenge,
      customerId: ctx.customerId,
      deviceId: ctx.deviceId,
      musicAgent: await this.musicAgent()
    });
    if (!body) throw new Error('Amazon Music: license body incomplete');
    const { status, text } = await this.dmls(ctx, 'getLicenseForPlaybackV2', body);
    if (status === 400) {
      // A 400 is NOT always the certificate. Parse Amazon's body and branch
      // on denialReason: only the cert reasons mean the build's VMP signature
      // (licenseDenied — no point trying another Amazon track). Every other
      // denial (CUSTOMER_NOT_ELIGIBLE for HD on a Prime plan, region, …) is a
      // per-kid-group refusal the player must route around; carry Amazon's
      // denialReason + message through, logging no session material. (The
      // old provider's hdSessionBlockedByPlan latch is not ported — the
      // renderer's #1262 family-failure table is the live mechanism.)
      let refusal = null;
      try { refusal = JSON.parse(text); } catch { /* opaque */ }
      const denialReason = refusal && typeof refusal.denialReason === 'string' ? refusal.denialReason : null;
      // Amazon's message carries the account's customer ID after its first
      // sentence; only the sentence reaches the error and the log.
      const message = lib.licenseDenialSummary(refusal && refusal.message);
      if (lib.CERTIFICATE_DENIAL_REASONS.has(denialReason)) {
        // NO rendition-group label is recorded here, on purpose: a
        // certificate-class refusal means NO license works at all on this
        // build — caching groups from it would be noise (and the message tail
        // of such a refusal is not a per-group sentence).
        const err = new Error('Amazon refused the Widevine license. This build needs a production VMP signature.');
        err.reason = 'playback-failed';
        err.licenseDenied = true;
        throw err;
      }
      // The refusal names the rendition group it is about in the manifest's own
      // vocabulary — `not eligible for SD content` against the set tagged
      // <SupplementalProperty schemeIdUri="amz-music:trackType" value="SD"/>.
      // That label, not the per-asset KID, is what carries to the next track, so
      // it is what the manifest filter drops. The LABEL is read from the SUMMARY,
      // never the raw message: after the first sentence Amazon dumps
      // `CustomerEligibility(customerId=…, note=not eligible for HD content)` —
      // a label must never be mined from that PII tail. The SCOPE reads the RAW
      // message instead: its build signal is ANCHORED at the sentence start, so
      // the redacted tail cannot trip it, and the summary's " - " cut can drop
      // the very sentence that says build.
      const groupLabel = lib.amazonGroupLabelFromDenial(message);
      if (groupLabel) {
        // The scope decides WHETHER the label is recorded at all: an
        // unrecognized reason (amazonGroupRefusalScope → null) records
        // nothing — a per-title HD refusal must never take a tier away from
        // the whole session.
        const scope = lib.amazonGroupRefusalScope(denialReason, refusal && refusal.message);
        // Never DOWNGRADE a build-scoped entry: `build-refused` means this
        // build's VMP signature was refused, and a later refusal for the same
        // label with an account-shaped reason does not unsay that —
        // overwriting would quietly hand the entry back to sign-out and let
        // the refused group walk into every later manifest again.
        if (scope) {
          if (!this._refusedGroups) this._refusedGroups = new Map();
          if (this._refusedGroups.get(groupLabel) !== 'build-refused') {
            this._refusedGroups.set(groupLabel, scope);
          }
        }
      }
      const err = new Error('Amazon refused the license for this content'
        + (denialReason ? ' (' + denialReason + ')' : '')
        + (message ? ': ' + message : ''));
      err.reason = 'playback-failed';
      err.licenseDenied = false;
      err.denialReason = denialReason;
      // Provider-local diagnostics (the test ring reads it). The bridge
      // forwards only reason/licenseDenied/denialReason/message — the engine
      // never reads provider dialect, so do not widen the bridge for this.
      err.groupLabel = groupLabel;
      console.warn('[Amazon dmls] license denied (' + (denialReason || 'unknown') + ')' + (message ? ': ' + message : '')
        + (groupLabel ? ' — rendition group ' + groupLabel + ' is out of this session\'s manifests' : ''));
      throw err;
    }
    let json = null;
    try { json = JSON.parse(text); } catch { /* fall through */ }
    if (status !== 200 || !json || typeof json.license !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(json.license)) {
      throw lib.notReady(status === -1 ? 'load-failed' : 'playback-failed',
        'Amazon Music: license HTTP ' + status + ': ' + (lib.licenseDenialSummary(text) || '').slice(0, 160));
    }
    return json.license;
  },

  // One dmls POST over the webSession bridge. The session's cookie jar rides
  // the fetch (the host owns cookies in both directions; the old provider's
  // explicit Cookie header existed because a bare net.request does not attach
  // the partition's jar — the bridge's fetch does). Session rot — a 400 that
  // smells like auth — drops the cached context, re-mints once, retries once.
  // A second refusal is the session ITSELF being dead: map to not-signed-in
  // so the renderer's prompt-then-retry contract applies (review I7).
  dmls: async function (ctx, target, body, opts) {
    const lib = this.requireLib();
    const authRetry = !(opts && opts.authRetry === false);
    const ws = window.electron && window.electron.webSession;
    if (!ws) throw lib.notReady('not-ready', 'Amazon webSession bridge not available');
    const out = await ws.fetch(lib.SESSION, {
      url: 'https://music.amazon.com/' + ctx.region + '/api/dmls/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Encoding': 'amz-1.0',
        'X-Amz-Target': lib.DML_TARGET_PREFIX + target,
        'csrf-token': ctx.csrfToken,
        'csrf-rnd': ctx.csrfRnd,
        'csrf-ts': ctx.csrfTs,
        Referer: 'https://music.amazon.com/',
        Origin: 'https://music.amazon.com',
        Accept: '*/*'
      },
      body: JSON.stringify(body)
    });
    if (!out || !out.success) {
      throw lib.notReady((out && out.reason) || 'load-failed',
        'Amazon Music: dmls request failed (' + ((out && out.error) || (out && out.reason) || 'bridge unavailable') + ')');
    }
    if (out.status === 400 && /Unauthorized|Authentication|REQUIRED_COOKIES/i.test(out.text || '')) {
      if (!authRetry) {
        this._drmSessionContext = null;
        throw lib.notReady('not-signed-in', 'Amazon Music session expired — sign in again');
      }
      console.log('[Amazon dmls] session rejected — refreshing context and retrying once');
      this._drmSessionContext = null;
      let fresh;
      try {
        fresh = await this.ensureSessionContext();
      } catch (mintErr) {
        this._drmSessionContext = null;
        throw mintErr;
      }
      return this.dmls(fresh, target, body, { authRetry: false });
    }
    return { status: out.status, text: out.text };
  },

  // The DRM session context, single-flight. The mint's config.json read also
  // records the plan (the old notePlan seam): a mint under an Unlimited tier
  // feeds the gate below without a second read.
  ensureSessionContext: async function () {
    if (this._drmSessionContext) return this._drmSessionContext;
    if (this._drmSessionContextPromise) return this._drmSessionContextPromise;
    const startedGeneration = this._sessionGeneration;
    this._drmSessionContextPromise = this.mintSessionContext().then((ctx) => {
      this._drmSessionContextPromise = null;
      // A sign-out raced the mint: the context belongs to the previous
      // account and must not serve the next (the generation drop below is
      // worthless if this write lands after it).
      if (this._sessionGeneration === startedGeneration) {
        this._drmSessionContext = ctx;
        this.notePlanReading(this.requireLib().amazonPlanFromTier(ctx.tier));
        console.log('[Amazon dmls] session context ok (territory ' + ctx.territoryId + ', region ' + ctx.region + ', tier ' + (ctx.tier || 'unknown') + ')');
        return ctx;
      }
      console.log('[Amazon dmls] session context minted under a new session — dropping it');
      return ctx;
    }).catch((err) => {
      this._drmSessionContextPromise = null;
      throw err;
    });
    return this._drmSessionContextPromise;
  },

  mintSessionContext: async function () {
    const lib = this.requireLib();
    if (!(await this.isSignedIn())) {
      throw lib.notReady('not-signed-in', 'Sign in to Amazon Music first');
    }
    // config.json (the jar's cookies ride the fetch) plus the csrf triplet,
    // minted by a page flow: one load of the songs search for a BENIGN query —
    // the plugin's own last search text (it is already in the user's Amazon
    // history, so the one-shot page flow pollutes nothing; the old host mint
    // used the host store's search_history for the same reason), falling back
    // to a constant when no search has run yet. Difference from the old host
    // mint, known and accepted (#1439 review): _lastSearchText is in-memory
    // only, while the host read the persisted search_history[0] — so the
    // first mint after every launch uses the benign constant, not the user's
    // last search.
    const query = (this._lastSearchText && String(this._lastSearchText).trim()) || lib.MINT_BENIGN_QUERY;
    const [config, headers] = await Promise.all([
      this.fetchConfigJson(),
      this.mintCsrfHeaders(query)
    ]);
    const session = lib.amazonNativeSessionFromConfig(config);
    const ctx = {
      customerId: session.customerId,
      marketplaceId: session.marketplaceId || 'ATVPDKIKX0DER',
      territoryId: session.territoryId || 'US',
      region: session.region || lib.amazonDmlsRegion(session.territoryId),
      tier: session.tier,
      deviceType: session.deviceType || null,
      // config.json's deviceId is the registered device; the captured header
      // is the fallback (the page sometimes reports placeholder values).
      deviceId: session.deviceId || (headers && headers.deviceId) || null,
      csrfToken: headers && headers.csrfToken,
      csrfRnd: headers && headers.csrfRnd,
      csrfTs: headers && headers.csrfTs
    };
    if (!ctx.deviceId || !ctx.csrfToken) {
      // transient — never a sign-in prompt
      throw lib.notReady('load-failed', 'Amazon session context incomplete (no device id / csrf)');
    }
    return ctx;
  },

  fetchConfigJson: async function () {
    const lib = this.requireLib();
    const ws = window.electron && window.electron.webSession;
    if (!ws) throw lib.notReady('not-ready', 'Amazon webSession bridge not available');
    const out = await ws.fetch(lib.SESSION, {
      url: lib.CONFIG_URL,
      method: 'GET',
      headers: { Accept: 'application/json', Referer: 'https://music.amazon.com/' }
    });
    if (!out || !out.success || typeof out.text !== 'string') return {};
    try { return JSON.parse(out.text); } catch { return {}; }
  },

  // The csrf-triplet mint, as its own page flow on the plugin's two-lane
  // page-flow queue (serialized against the spec searches, the album
  // lookups, the playlist import and the recommendations — one flow's
  // navigation never interleaves another's capture). It rides the FOREGROUND
  // lane: a play that needs a fresh session context is a click the user is
  // waiting on, so it starts before every queued background flow (a spec
  // search, an album lookup, a recommendations refresh — each a page load
  // that can hold the queue for 15-30s), behind at most the one in progress.
  mintCsrfHeaders: async function (query) {
    const lib = this.requireLib();
    const q = String(query || lib.MINT_BENIGN_QUERY).slice(0, 120);
    return this.enqueuePageFlow(() => this.mintCsrfPageFlow(q), { lane: 'foreground' });
  },

  mintCsrfPageFlow: async function (q) {
    const lib = this.requireLib();
    const ws = window.electron && window.electron.webSession;
    if (!ws) throw lib.notReady('not-ready', 'Amazon webSession bridge not available');
    console.log('[Amazon] session-headers mint: page flow for "' + q + '"');
    // The capture window is the spec searches' (the quiet window sized for a
    // cold view's late first gql), and the lens is the old host mint's (the
    // gql host always carries the csrf triplet).
    const load = await ws.load(lib.SESSION, 'https://music.amazon.com/search/' + encodeURIComponent(q) + '/songs', {
      capture: {
        urlPrefixes: lib.MINT_CAPTURE_URL_PREFIXES,
        quietMs: lib.PAGE_CAPTURE_QUIET_MS,
        budgetMs: lib.PAGE_CAPTURE_BUDGET_MS
      }
    });
    if (!load || !load.success) {
      throw lib.notReady((load && load.reason) || 'load-failed',
        (load && load.error) || 'Amazon session-headers mint did not finish loading');
    }
    // A genuinely dead session is caught mid-flight (the page redirected to a
    // sign-in wall while it loaded).
    if (lib.pageBlocksPlayback(load.finalUrl)) {
      console.warn('[Amazon] session-headers mint blocked: ' + load.finalUrl);
      throw lib.notReady('not-signed-in', 'Choose an Amazon Music profile');
    }
    // The page emits PLACEHOLDER csrf values (literally foo/bar) on requests
    // that do not need them — only the real spec-search-class requests carry
    // live ones. A dmls call made with placeholders fails server-side (its
    // "REQUIRED_COOKIES_MISSING" is the bad-csrf symptom, live-verified
    // 2026-10), so only values that look real count. The page's OWN capture is
    // preferred over our echo (an echoed capture is a replay of some template
    // minted under this session — valid, but session-aged).
    const tokenLooksReal = (h) =>
      typeof h['csrf-token'] === 'string' && h['csrf-token'].length >= 20
      && /^\d+$/.test(String(h['csrf-rnd'] || '')) && /^\d+$/.test(String(h['csrf-ts'] || ''));
    const captured = (load.captures || []).filter((r) => r.headers && tokenLooksReal(r.headers));
    const entry = captured.find((r) => !r.echo) || captured[0] || null;
    if (entry) {
      console.log('[Amazon] session-headers mint ok');
      return {
        csrfToken: entry.headers['csrf-token'],
        csrfRnd: entry.headers['csrf-rnd'] || null,
        csrfTs: entry.headers['csrf-ts'] || null,
        deviceId: entry.headers['x-amzn-device-id'] || null
      };
    }
    // transient — never a sign-in prompt
    throw lib.notReady('load-failed', 'session headers: the page fired no captured request');
  },

  // The app version for musicAgent, off the renderer's own version surface
  // (window.electron.updater.getVersion — the same IPC app.js's about line
  // reads; the resolver config the engine hands the pair is the user's saved
  // service settings, not app facts, so it is not that seam).
  appVersion: async function () {
    try {
      const getter = window.electron && window.electron.updater && window.electron.updater.getVersion;
      if (typeof getter === 'function') {
        const v = await getter();
        if (typeof v === 'string' && v) return v;
      }
    } catch { /* not ready */ }
    return 'dev';
  },

  musicAgent: async function () {
    const lib = this.requireLib();
    return lib.MUSIC_AGENT_SDK + ' ' + lib.MUSIC_AGENT_CLIENT + ' (Parachord/' + (await this.appVersion()) + ')';
  },

  // CAQ= cert pre-charge once per session (the page world used to do this in
  // its Shaka setup; the relay necessitates our side).
  kickCertWarm: function () {
    if (this._certSessionReady || this._certWarmInFlight) return;
    this._certWarmInFlight = true;
    void this.warmCertSession().catch(() => {}).finally(() => { this._certWarmInFlight = false; });
  },

  warmCertSession: async function () {
    const lib = this.requireLib();
    if (this._certSessionReady) return;
    try {
      await this.relayLicense(lib.WIDEVINE_CERT_CHALLENGE);
      console.log('[Amazon dmls] license cert session warm');
    } catch (e) {
      // Tolerated: some sessions accept first-party challenges without it;
      // the real per-track exchange decides.
      console.log('[Amazon dmls] cert pre-charge failed (continuing):', e && e.message);
    }
    this._certSessionReady = true;
  },

  // ── Telemetry (the hornet /telemetry/v1/events streaming reports) ───────
  // The player events the host's shared engine reports (handlePlayerEvent,
  // wired through playPlugin's playerEvents since M9 — no main-side provider
  // exists to receive them on the plugin path), mapped by _lib's
  // createAmazonTelemetry onto the captured envelope and posted via the
  // webSession bridge.
  handlePlayerEvent: function (event) {
    try {
      const t = this.telemetry();
      const e = event || {};
      switch (e.type) {
        case 'play-started': return t.onPlayStarted(e);
        case 'seek': return t.onSeek(e);
        case 'pause': return t.onPause(e);
        case 'resume': return t.onResume(e);
        case 'ended': return t.onEnded(e);
        case 'stopped': return t.onStopped(e);
        default: return undefined;
      }
    } catch (e) {
      console.log('[Amazon telemetry] event dropped:', e && e.message);
      return undefined;
    }
  },

  telemetry: function () {
    if (!this._telemetry) {
      const lib = this.requireLib();
      this._telemetry = lib.createAmazonTelemetry({
        post: (envelope) => this.postTelemetryEvent(envelope),
        context: () => ({
          ...(this._drmSessionContext || {}),
          deviceTimeZone: lib.deviceTimeZoneString()
        }),
        randomUUID: () => lib.uuid4()
      });
    }
    return this._telemetry;
  },

  postTelemetryEvent: async function (envelope) {
    const lib = this.requireLib();
    const ws = window.electron && window.electron.webSession;
    if (!ws) return { status: -1 };
    const ctx = await this.ensureSessionContext();
    // Captured hornet telemetry headers: csrf triplet + device registration
    // (x-amz- spellings, distinct from the gql template's x-amzn-device-id).
    const headers = {
      'Content-Type': 'application/json',
      'csrf-token': ctx.csrfToken,
      'csrf-rnd': ctx.csrfRnd,
      'csrf-ts': ctx.csrfTs,
      'x-amz-device-type': ctx.deviceType || lib.AMAZON_DEVICE_TYPE_ID,
      'x-amz-device-id': ctx.deviceId,
      Referer: 'https://music.amazon.com/',
      Origin: 'https://music.amazon.com',
      Accept: '*/*'
    };
    const actionName = envelope.clientActionList && envelope.clientActionList[0] && envelope.clientActionList[0].actionName;
    let status = -1;
    let text = '';
    try {
      const out = await ws.fetch(lib.SESSION, {
        url: 'https://music.amazon.com/telemetry/v1/events',
        method: 'POST',
        headers,
        body: JSON.stringify({ ...envelope, deviceId: ctx.deviceId || envelope.deviceId })
      });
      if (out && out.success) {
        status = out.status;
        text = out.text || '';
      } else {
        text = String((out && out.error) || (out && out.reason) || 'webSession bridge unavailable');
      }
    } catch (e) {
      // bookkeeping still runs on a failed post
      text = String((e && e.message) || e);
    }
    // Telemetry health surfaces in the plugin's status/diagnostics state (M10
    // surfaces it in getStatus): plays must be reported or the subscription
    // accounting drifts silently. Console.warn + the dropped counter make a
    // rotated header set loud instead of invisible.
    if (!this._telemetryHealth) this._telemetryHealth = { last: null, dropped: 0 };
    this._telemetryHealth.last = { status, at: Date.now(), actionName: actionName || null };
    if (status !== 200) {
      this._telemetryHealth.dropped += 1;
      console.warn('[Amazon telemetry] POST ' + (actionName || 'event') + ' -> ' + status + ': ' + (text || '').slice(0, 120));
    }
    return { status };
  },

  search: async function (query, config) {
    let lib = null;
    try {
      if (!window.electron || !window.electron.webSession) {
        console.warn('Amazon Music: webSession bridge not available');
        return [];
      }
      lib = this.requireLib();
      var payload = query;
      if (typeof query === 'string') {
        if (!query.trim() || query.trim().length < 2) return [];
        payload = query.trim();
      } else if (
        !query ||
        (!(query.title && String(query.title).trim()) &&
          !(query.artist && String(query.artist).trim()))
      ) {
        return [];
      }
      // #1220: off Music Unlimited, offer no playable tracks. Checked only
      // when signed in (a signed-out search must still answer not-signed-in,
      // the sign-in prompt) and before searching. plan-ineligible is
      // not-ready rather than a miss, so an upgrade re-resolves instead of
      // finding cached misses.
      if (!(await this.isSignedIn())) {
        // Sign-out invalidates the plan cache: the next sign-in may be
        // another account (the host's dmls clears its own copy on sign-out
        // the same way).
        this._planState = null;
        throw lib.notReady('not-signed-in', 'Sign in and choose an Amazon Music profile');
      }
      await this.assertPlanPlays();
      const spec = lib.amazonSongSearchUrl(
        typeof payload === 'string' ? { query: payload } : payload
      );
      if (!spec) return [];
      // The DRM session-context mint's benign query (#1356 M9): the plugin's
      // own most recent search text, already in the user's Amazon history via
      // this very search — the old host mint read the host store's
      // search_history for the same reason (the plugin cannot read the host
      // store, so it keeps its own).
      this._lastSearchText = spec.searchText;
      const rows = await this.specSearch({
        url: spec.url,
        searchText: spec.searchText,
        specType: 'track',
        noun: 'tracks',
        parse: (data) => {
          const out = lib.searchTracksFromGql(data);
          return { rows: out.tracks, envelope: out.envelope };
        }
      });
      console.log('[Amazon] resolver search', payload, rows.length);
      return rows.map(function (t) {
        return {
          id: 'amazonmusic-' + t.asin,
          title: t.title,
          artist: t.artist,
          album: t.album,
          duration: t.duration || 0,
          sources: ['amazonmusic'],
          amazonAsin: t.asin,
          amazonUniqueId: t.uniqueId,
          genre: t.genre || null,
          explicit: !!t.explicit,
          // The gql search response carries the track's own cover art (the
          // DOM scrape never had it) — getAlbumArtFromResolvers can hit it.
          albumArt: t.albumArt || null,
        };
      });
    } catch (error) {
      if (error && error.notReady) throw error;
      var reason = error && error.reason;
      // plan-ineligible / not-signed-in / load-failed / superseded / a
      // structural not-ready: readiness failures are never cached as a miss
      // (the resolver would store a 30-day noMatch for them).
      if (
        reason === 'not-ready' ||
        reason === 'not-signed-in' ||
        reason === 'no-cdm' ||
        reason === 'load-failed' ||
        reason === 'plan-ineligible' ||
        reason === 'superseded'
      ) {
        var err = new Error('Amazon Music not ready');
        err.notReady = true;
        err.code = reason;
        throw err;
      }
      // Any other error (a requireLib throw, a bridge 'invalid'/'denied', a
      // plain bug) is notReady too, never a cached miss — the recommendations
      // path's rule: "an error is never 'no results'" (playback.md), and more
      // failure classes reach this catch since the runner moved into the
      // plugin. The reason (when the error carries one) still rides along as
      // the code.
      console.error('Amazon Music search error:', error);
      var unknownErr = new Error('Amazon Music not ready');
      unknownErr.notReady = true;
      unknownErr.code = reason || 'not-ready';
      throw unknownErr;
    }
  },
  resolve: async function (artist, track, album, config) {
    // The platform's gate (validateResolvedTrack in
    // sync-providers/confidence-scoring.js), copied because an .axe function can't
    // import it. A result dropped here never reaches that gate, so this has to
    // accept what it accepts: tests/resolver/plugin-credit-match.test.js holds the
    // two together over the shared credit vectors. No property-escape literal, which
    // would stop the whole function parsing on an engine without them: the guarded
    // constructor falls back to ASCII, so a non-Latin name misses instead.
    var MARKS = /[̀-ͯ]/g;
    var NON_ALNUM = /[^a-z0-9]/g;
    try {
      MARKS = new RegExp('\\p{M}', 'gu');
      NON_ALNUM = new RegExp('[^\\p{L}\\p{N}]', 'gu');
    } catch (e) {}
    var fold = function (s) {
      s = (s || '').toString().toLowerCase();
      if (typeof s.normalize === 'function') s = s.normalize('NFKD');
      return s.replace(MARKS, '');
    };
    var norm = function (s) {
      return fold(s).replace(NON_ALNUM, '');
    };
    var contains = function (a, b) {
      return !!a && !!b && (a.indexOf(b) !== -1 || b.indexOf(a) !== -1);
    };
    // The words need a space on both sides, so "Little Feat" and "Malcolm X" stay
    // whole. The brackets on a title credit are required: "ft" can be title text.
    var ARTIST_JOIN = /,|&| (?:and|x) | [(\[]?(?:feat\.?|ft\.?|featuring) /i;
    var TITLE_CREDIT = / *[(\[] *(?:feat|ft|featuring)[. ][^)\]]*[)\]] *$/i;
    var creditedNames = function (credit) {
      var parts = fold(credit).split(ARTIST_JOIN);
      var names = [];
      for (var p = 0; p < parts.length; p++) {
        var name = norm(parts[p]);
        if (name && names.indexOf(name) === -1) names.push(name);
      }
      return names;
    };
    var isSubset = function (a, b) {
      if (a.length === 0) return false;
      for (var n = 0; n < a.length; n++) {
        if (b.indexOf(a[n]) === -1) return false;
      }
      return true;
    };
    var artistsMatch = function (a, b) {
      if (contains(norm(a), norm(b))) return true;
      var namesA = creditedNames(a);
      var namesB = creditedNames(b);
      return isSubset(namesA, namesB) || isSubset(namesB, namesA);
    };
    var titlesMatch = function (a, b) {
      if (contains(norm(a), norm(b))) return true;
      var bare = norm(fold(a).replace(TITLE_CREDIT, ''));
      return !!bare && bare === norm(fold(b).replace(TITLE_CREDIT, ''));
    };
    var matches = function (r) {
      return !!r && !!r.artist && !!r.title && artistsMatch(r.artist, artist) && titlesMatch(r.title, track);
    };
    var targetArtist = norm(artist);
    var targetTitle = norm(track);
    console.log('[Amazon] resolver resolve', artist, track, 'norm', targetArtist, targetTitle);
    var results = await this.search({ title: track, artist: artist }, config);
    console.log(
      '[Amazon] resolver hits',
      results.length,
      results.slice(0, 3).map(function (r) {
        return (r.artist || '') + ' — ' + (r.title || '');
      }),
    );
    if (results.length === 0) return null;
    // The first containment hit used to win, so a live cut, remix or karaoke
    // version ranked above the original was what played and scrobbled (the
    // same flaw the Bandcamp resolver had). Pass 1: an exact artist + title
    // match, ignoring feat. credits and how the credit is joined. Pass 2: a match
    // that is not another version (a version word the requested title lacks; the
    // list matches src/renderer/lib/track-variants.js). Pass 3: any match, since a
    // "Remastered" or live track by the right artist is still better than nothing
    // on a service whose catalog is the artist's own.
    var stripFeat = function (s) {
      return (s || '')
        .toString()
        .replace(/\s*[([]\s*(feat\.?|ft\.?|featuring)\s[^)\]]*[)\]]/gi, '')
        .replace(/\s+(feat\.?|ft\.?|featuring)\s.*$/i, '');
    };
    var VARIANT =
      /\b(live|medley|remix(es|ed)?|rmx|cover(s|ed)?|covering|tribute|karaoke|instrumental|acoustic|demo|unplugged|rework|bootleg|mashup|reprise|edit|jam track|sped up|slowed|in the style of)\b/gi;
    // A slash-joined title is a medley (#1306); joinsSongs in
    // sync-providers/track-variants.js.
    var joinsSongs = function (title) {
      if ((track || '').toString().indexOf('/') !== -1) return false;
      var s = (title || '').toString().toLowerCase();
      var a = (artist || '').toString().toLowerCase();
      if (a.indexOf('/') !== -1) s = s.split(a).join(' ');
      s = s.replace(/\bw\/\s*/g, ' ');
      return /[^\s\d]\s*\/\s*[^\s\d]/.test(s);
    };
    var isVariant = function (r) {
      if (joinsSongs(r.title)) return true;
      var words = ((r.title || '') + ' ' + (r.artist || '')).match(VARIANT) || [];
      var asked = ((track || '') + ' ' + (artist || '')).toLowerCase();
      for (var w = 0; w < words.length; w++) {
        if (asked.indexOf(words[w].toLowerCase()) === -1) return true;
      }
      return false;
    };
    var exactArtist = norm(stripFeat(artist));
    var exactTitle = norm(stripFeat(track));
    var requestedNames = creditedNames(artist);
    var sameCredit = function (credit) {
      var names = creditedNames(credit);
      return isSubset(names, requestedNames) && isSubset(requestedNames, names);
    };
    var matching = results.filter(matches);
    if (exactArtist && exactTitle) {
      for (var i = 0; i < matching.length; i++) {
        if (
          (norm(stripFeat(matching[i].artist)) === exactArtist || sameCredit(matching[i].artist)) &&
          norm(stripFeat(matching[i].title)) === exactTitle &&
          !isVariant(matching[i])
        )
          return matching[i];
      }
    }
    for (var j = 0; j < matching.length; j++) {
      if (!isVariant(matching[j])) return matching[j];
    }
    return matching[0] || null;
  },
  play: async function (track, config) {
    // Host-owned: with capabilities.widevine the host's handlePlay drives the
    // shared Widevine player (Shaka on the shared audio element, the manifest
    // and license bytes supplied by this plugin's own DRM pair —
    // getPlaybackManifest/relayLicense over the renderer-mediated path). What
    // used to live here — playTrack IPC, prompt-then-retry — lives in the
    // host's widevine branch, which also keeps the not-signed-in → prompt →
    // retry contract.
    console.log('Amazon Music: play() is host-owned (capabilities.widevine branch in handlePlay); not handled here');
    return false;
  },
  init: async function (config) {
    console.log('Amazon Music resolver initialized');
    return true;
  },
  cleanup: async function () {
    console.log('Amazon Music resolver cleanup');
    try {
      if (typeof window.__parachordWidevine === 'object' && typeof window.__parachordWidevine.stop === 'function') {
        await window.__parachordWidevine.stop();
      }
    } catch (e) {}
  },
  // ── The album catalog (#1356 M6: album search, album lookup, artist images) ──
  // The three flows that used to live in amazon-web-player.js, moved onto the
  // webSession bridge. NOT plan-gated (#1220: the plan gate stops playback,
  // not discovery — the deleted amazonmusic-search-albums /
  // -search-artist-image / -lookup-album handlers never read the plan, and
  // neither do these): a Prime account still gets album search, album
  // lookups and artist photos.

  // capabilities.albumSearch (docs/architecture/plugins.md, "searchAlbums"):
  // the album-page catalog fallback. searchAlbums finds an album by
  // artist+title or free text over the albums tab of the same spec search the
  // track search uses (SpecSearchSeeMorePage with variables.specType 'album'
  // — live-verified 2026-10), parsed by searchAlbumsFromGql (only Album
  // nodes; the search spec carries no releaseDate/trackCount, so both stay
  // null in the mapped result). Throwing notReady only on sign-in/readiness
  // failures — the same rule as search — and returning [] on a miss.
  searchAlbums: async function (query, config) {
    try {
      if (!window.electron || !window.electron.webSession) {
        console.warn('Amazon Music: webSession bridge not available');
        return [];
      }
      const lib = this.requireLib();
      var payload = query;
      if (typeof query === 'string') {
        if (!query.trim() || query.trim().length < 2) return [];
        payload = query.trim();
      } else if (
        !query ||
        (!(query.title && String(query.title).trim()) &&
          !(query.artist && String(query.artist).trim()))
      ) {
        return [];
      }
      const spec = lib.amazonAlbumSearchUrl(typeof payload === 'string' ? { query: payload } : payload);
      if (!spec) return [];
      if (!(await this.isSignedIn())) {
        throw lib.notReady('not-signed-in', 'Sign in and choose an Amazon Music profile');
      }
      const queuedAt = Date.now();
      const albums = await this.specSearch({
        url: spec.url,
        searchText: spec.searchText,
        specType: 'album',
        noun: 'albums',
        staleCheck: () => Date.now() - queuedAt > lib.ALBUM_JOB_STALE_MS,
        parse: (data) => {
          const out = lib.searchAlbumsFromGql(data);
          return { rows: out.albums, envelope: out.envelope };
        }
      });
      console.log('[Amazon] resolver album search', payload, albums.length);
      return (albums || []).map(function (a) {
        return {
          id: 'amazonmusic-album-' + a.asin,
          name: a.name,
          artist: a.artist || null,
          albumArt: a.albumArt || null,
          // The album search spec carries no releaseDate or trackCount; the
          // plugin contract allows both to be null.
          releaseDate: null,
          trackCount: null,
          url: a.url,
          explicit: !!a.explicit,
        };
      });
    } catch (error) {
      if (error && error.notReady) throw error;
      var reason = error && error.reason;
      // not-ready / not-signed-in / load-failed / superseded (a sign-out
      // cleared the session mid-load): readiness failures are never cached
      // as a miss (the album pages would store a 30-day noMatch for them)
      // — the same rule as search.
      if (
        reason === 'not-ready' ||
        reason === 'not-signed-in' ||
        reason === 'no-cdm' ||
        reason === 'load-failed' ||
        reason === 'superseded'
      ) {
        var err = new Error('Amazon Music not ready');
        err.notReady = true;
        err.code = reason;
        throw err;
      }
      // Any other error (a requireLib throw, a bridge 'invalid'/'denied', a
      // plain bug) is notReady too, never a cached miss — search()'s rule
      // ("an error is never 'no results'", playback.md): the album search
      // shares the runner's failure classes, and a miss here caches a
      // 30-day noMatch against every album page that asked.
      console.error('Amazon Music album search error:', error);
      var unknownErr = new Error('Amazon Music not ready');
      unknownErr.notReady = true;
      unknownErr.code = reason || 'not-ready';
      throw unknownErr;
    }
  },

  // capabilities.artistImage (docs/architecture/plugins.md,
  // "searchArtistImage"): a photo of an artist by name, from the artists tab
  // of the same spec search the track and album searches use. The lookup
  // rides the shared runner with its never-throw wrapper + the #1135
  // staleness check: not signed in is null WITHOUT a request (the
  // artist-image chain just asks the next source — Deezer needs no account),
  // the runner's structural notReady (which trips the shared breaker)
  // degrades to null too, since a photo is always optional. The name match
  // happens in the parser (searchArtistImageFromGql — only an exact
  // normalized name's photo is returned, never the top hit's when Amazon
  // ranks a different artist first), and the bare-https re-check below keeps
  // anything but a credential-free CDN URL out of the persisted image cache.
  searchArtistImage: async function (artistName, config) {
    try {
      if (!window.electron || !window.electron.webSession) return null;
      const lib = this.requireLib();
      var name = (artistName || '').trim();
      if (name.length < 2) return null;
      const spec = lib.amazonArtistSearchUrl(name);
      if (!spec) return null;
      if (!(await this.isSignedIn())) {
        console.log('[Amazon] artist image for ' + name + ' skipped: not signed in');
        return null;
      }
      const queuedAt = Date.now();
      const rows = await this.specSearch({
        url: spec.url,
        searchText: spec.searchText,
        specType: 'artist',
        noun: 'artist image',
        staleCheck: () => Date.now() - queuedAt > lib.ALBUM_JOB_STALE_MS,
        parse: (data) => {
          const out = lib.searchArtistImageFromGql(data, name);
          return { rows: out.url ? [out.url] : [], envelope: out.envelope };
        }
      });
      var url = (rows && rows[0]) || null;
      // The parser only returns credential-free https CDN URLs, but this URL
      // is persisted in the image cache — check before trusting.
      if (typeof url !== 'string' || !/^https:\/\//i.test(url) || url.indexOf('?') !== -1) return null;
      return url;
    } catch (error) {
      // Catches the runner's structural notReady (which trips the shared
      // breaker) and anything the URL builder or sign-in check throws: the
      // artist-image chain contracts a miss, never an exception.
      console.warn('[Amazon] artist image for ' + String(artistName) + ' failed: ' + (error && error.reason) + ' ' + (error && error.message));
      return null;
    }
  },

  // The album-lookup entry (lookupAlbum's flow, moved from
  // amazon-web-player.js): sign-in check, then the queued page flow. The
  // queue is the plugin's page-flow chain — the same chain the spec searches
  // ride — so an album lookup never interleaves a navigation with a search's
  // page flow, and a lookup queued behind a slow flow checks the #1135
  // staleness budget before paying its page load.
  lookupAlbumFlow: async function (rawUrl) {
    const lib = this.requireLib();
    const ws = window.electron && window.electron.webSession;
    if (!ws) throw lib.notReady('not-ready', 'Amazon webSession bridge not available');
    if (typeof rawUrl !== 'string' || !/^https:\/\/music\.amazon\.com\//i.test(rawUrl)) {
      throw lib.notReady('not-ready', 'Not an Amazon Music album URL');
    }
    const asin = lib.amazonAlbumAsinFromUrl(rawUrl);
    if (!asin) {
      throw lib.notReady('not-ready', 'Not an Amazon Music album URL');
    }
    if (!(await this.isSignedIn())) {
      throw lib.notReady('not-signed-in', 'Sign in and choose an Amazon Music profile');
    }
    const queuedAt = Date.now();
    const run = this.enqueuePageFlow(() => {
      if (Date.now() - queuedAt > lib.ALBUM_JOB_STALE_MS) {
        console.log('[Amazon] album lookup skipped: queued past the ' + lib.ALBUM_JOB_STALE_MS + 'ms catalog budget — the caller already moved on');
        return null;
      }
      return this.lookupAlbumPageFlow(asin);
    });
    return run;
  },

  // The album-lookup page flow: load the album page through the bridge with
  // the capture window inside the load, then replay the captured candidates
  // for the ASIN until one's response carries data.album.tracksConnection.
  // The real album page fires AlbumDetailPage with variables.id = the ASIN —
  // but it also fires AlbumSeo with the same id, a header-only op whose
  // data.album has title/trackCount but no tracksConnection, and it arrives
  // FIRST (live-captured 2026-10, which is how the first attempt shipped a
  // "0 of 12 tracks" truncation). So the winner is judged by RESPONSE:
  // amazonAlbumDetailCandidates ranks every captured read carrying the ASIN
  // (detail-named, then album-named, then — the hornet-rename hedge — any
  // name at all; write-shaped names are never replayed), candidates are
  // replayed in order with a cap, and the first replay carrying the
  // tracksConnection (albumTracksConnectionIn) wins; a replayed header-only
  // op is logged and skipped, and a replay that parses with no `album` field
  // at all is the hornet-rename shape and fails the lookup (below). Unlike
  // the old in-flow poll (which replayed candidates as they streamed in), the
  // bridge returns the whole burst once it goes quiet — so the ranking replay
  // runs over the complete candidate set. The window ends EARLY on the detail
  // op itself: doneWhen (the host's data-only stop condition) names
  // AlbumDetailPage's operation-name value, so the load returns the moment
  // that op's headers land — before the page's subresources finish — and the
  // whole flow fits the renderer's 8s catalog step instead of paying page
  // load + a 10s tail. The quiet window is the album one
  // (ALBUM_CAPTURE_QUIET_MS), not the shared default, and it is the FALLBACK
  // for a detail op the needle can't see (a hornet rename of the op name): a
  // detail op lagging its SEO sibling is still captured and matched either
  // way (#1135 review — a lagging detail op once read as a bogus header-only
  // miss).
  lookupAlbumPageFlow: async function (asin) {
    const lib = this.requireLib();
    const ws = window.electron && window.electron.webSession;
    if (!ws) throw lib.notReady('not-ready', 'Amazon webSession bridge not available');
    const url = 'https://music.amazon.com/albums/' + asin;
    const load = await ws.load(lib.SESSION, url, {
      capture: {
        urlPrefixes: [lib.GQL_URL + '*'],
        quietMs: lib.ALBUM_CAPTURE_QUIET_MS,
        budgetMs: lib.PAGE_CAPTURE_BUDGET_MS,
        doneWhen: { bodyIncludes: '"' + lib.ALBUM_DETAIL_OP_NAME + '"' }
      }
    });
    if (!load || !load.success) {
      // A refused load: 'load-failed' (the page never finished), 'superseded'
      // (a sign-out cleared the session mid-load), 'not-ready' (no host
      // window). Transient/wiring classes, never a miss and never a sign-in
      // prompt.
      throw lib.notReady((load && load.reason) || 'load-failed', (load && load.error) || 'Amazon album page did not finish loading');
    }
    // The after-load URL re-checks: a wall means the session died mid-flight;
    // a page that left music.amazon.com entirely cannot be replayed from.
    if (lib.pageBlocksPlayback(load.finalUrl)) {
      console.warn('[Amazon] album lookup blocked: ' + load.finalUrl);
      throw lib.notReady('not-signed-in', 'Choose an Amazon Music profile');
    }
    if (!lib.isAmazonMusicPage(load.finalUrl)) {
      throw lib.notReady('not-ready', 'Amazon album page left music.amazon.com before replay');
    }
    // The entries must have their headers — the host pairs bodies with headers
    // by request id — and every candidate is deduped by operationName +
    // variables (a same-burst sibling like AlbumSeo fires alongside the
    // detail op on one page load; both are ranked, not first-arrival).
    const captured = (load.captures || []).filter(r => r.headers);
    const reqKey = (request) => ((request && request.operationName) || '') + ':' + JSON.stringify((request && request.variables) || {});
    const entryFor = (request) => captured.find(r => lib.amazonAlbumDetailCandidates([r.body], asin, { anyName: true }).some(c => reqKey(c) === reqKey(request)));
    const candidates = lib.amazonAlbumDetailCandidates(captured.map(r => r.body), asin, { anyName: true });
    const seen = new Set();
    let winner = null;        // { request, data } — the replay that carried a tracksConnection
    let headerOnlyOp = null;   // replayed op that had data.album but no tracksConnection (AlbumSeo)
    let albumLessOp = null;    // replayed op whose response parsed with no album field at all (the hornet-rename shape)
    let lastReplayError = null;
    let replayCount = 0;
    for (const request of candidates) {
      if (winner || replayCount >= 4) break;
      const key = reqKey(request);
      if (seen.has(key)) continue;
      seen.add(key);
      replayCount += 1;
      console.log('[Amazon] album replaying ' + request.operationName + ' via gql');
      let outcome;
      // A busy gate (a concurrent navigation — the host's session mint or
      // diagnostic capture, or a playlist import's pagination replay riding
      // out this load — holds the readers/writer gate) is transient, not a
      // failed candidate: the same short bounded retry the spec-search page
      // flow carries rides it out before the candidate is given up on.
      for (let attempt = 0; ; attempt++) {
        try {
          outcome = await this.replayGql(entryFor(request), request);
        } catch (error) {
          // A HARD rejection — the invoke refused, the view destroyed
          // mid-replay — reads like any other replay error: the next ranked
          // candidate is still worth a try.
          outcome = { error: (error && error.message) || String(error) };
        }
        if (outcome.error !== 'busy') break;
        // The same bounded backoff as the spec-search page flow's replay.
        const wait = attempt < 3 ? 400 : 1000;
        if (attempt >= 3 && (attempt - 3 + 1) * 1000 > 12000) break;
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      if (outcome.error) {
        lastReplayError = outcome.error;
        console.warn('[Amazon] album replay of ' + request.operationName + ' failed: ' + outcome.error);
        continue;
      }
      const data = outcome.parsed && outcome.parsed.data;
      if (lib.albumTracksConnectionIn(data)) {
        winner = { request, data };
        break;
      }
      if (data && data.album) {
        if (!headerOnlyOp) headerOnlyOp = request.operationName;
        console.log('[Amazon] album replay of ' + request.operationName + ' carried the header but no tracks connection');
      } else if (!lib.albumDetailFromGql(data).envelope) {
        // A replay that PARSED with no album field at all — albumDetailFromGql's
        // envelope:false, the hornet rename of the response's album field. The
        // winner is chosen by the connection, which requires data.album, so
        // this shape can never win; it is recorded and classified once the
        // pool is exhausted (lookup-failed, never a miss — a rename must not
        // be cached as a deleted album). The pool is still replayed to the
        // end: the response stays the arbiter, and a later candidate (a
        // hornet-renamed op name in the any-name tier) can still carry the
        // connection. data.album null (deleted / other region) carries the
        // field and stays the not-found miss.
        if (!albumLessOp) albumLessOp = request.operationName;
        console.warn('[Amazon] album replay of ' + request.operationName + ' carried no album field at all');
      }
    }
    if (!winner) {
      const ops = lib.capturedOperationNames(captured.map(r => r.body)).join(', ') || 'none';
      if (lastReplayError) {
        // An errored replay outranks the header-only miss: the AlbumSeo
        // header proves the album EXISTS, so a replay that failed is a failed
        // lookup — never a "deleted album" miss the catalog would cache.
        throw lib.notReady('lookup-failed', lastReplayError);
      }
      if (headerOnlyOp) {
        // An AlbumSeo-style header seen but no operation exposed a tracks
        // connection: the detail op never ran. A miss with the ops log, so a
        // hornet rename reads as a rename instead of "every album is gone".
        // The header also proves the album field intact, so an album-less
        // replay elsewhere in the pool is an unrelated read's expected shape,
        // not a rename — the header-only verdict stands over it.
        console.warn('[Amazon] album lookup: ' + asin + ' header came from ' + headerOnlyOp + ' but no operation exposed a tracks connection; gql operations seen: ' + ops);
        return null;
      }
      if (albumLessOp) {
        // A replay parsed with no album field at all and nothing carried the
        // header either: the hornet rename of the response's album field —
        // albumDetailFromGql's envelope:false, which the winner can never
        // reach (it is chosen by the connection, so the rename surfaces
        // here, on the non-winning replays). lookup-failed, never a miss: a
        // rename must not be cached as a deleted album.
        console.warn('[Amazon] album lookup: replay of ' + albumLessOp + ' carried no album field at all; gql operations seen: ' + ops);
        throw lib.notReady('lookup-failed', 'Amazon album response had no album field at all');
      }
      // The page loaded but never asked for this album: deleted, not
      // available in the user's territory — or hornet renamed everything.
      // Log what the page did fire so a rename reads as a rename instead of
      // "every album is gone".
      console.warn('[Amazon] album lookup: page never requested the album detail for ' + asin + '; gql operations seen: ' + ops);
      return null;
    }
    const { album, envelope } = lib.albumDetailFromGql(winner.data);
    if (!envelope) {
      // Belt: the loop classifies album-less replays before a winner can
      // exist (the winner is chosen by the connection, which requires
      // data.album), so this cannot fire today — but if the winner predicate
      // ever loosens, fail honestly instead of mapping a bogus album.
      console.warn('[Amazon] album lookup: response was not an album detail envelope for ' + asin);
      throw lib.notReady('lookup-failed', 'Amazon album response was not an album detail envelope');
    }
    if (album && album.trackCount > album.tracks.length) {
      // The tracksConnection has no pageInfo at all (a 100-track album
      // answers all 100 edges in one response — live-verified), so there is
      // no continuation to follow: a trackCount above the mapped rows is a
      // truncation, visible the way a short playlist page's is.
      console.warn('[Amazon] album lookup truncated: got ' + album.tracks.length + ' of ' + album.trackCount + ' tracks');
      if (album.tracks.length === 0) {
        // Every edge failed to map: either the server carries no rows for
        // this album (pre-order / delisted) or hornet changed the row shape.
        // Say which — a future "0 of N" in the field log should not need a
        // DevTools session to diagnose.
        const tc = winner.data && winner.data.album && winner.data.album.tracksConnection;
        const edges = tc && tc.edges;
        const first = Array.isArray(edges) && edges[0] && edges[0].node;
        console.warn('[Amazon] album lookup: 0 of ' + album.trackCount + ' mapped — edges=' + (Array.isArray(edges) ? edges.length : 'absent') + (first ? ', first node keys=' + Object.keys(first).join(',') : ', first node null'));
      }
    }
    console.log('[Amazon] album lookup returning ' + (album ? album.tracks.length : 0) + ' tracks "' + (album ? album.name : '') + '"');
    return album;
  },

  // capabilities.albumSearch's other half: load what searchAlbums returned.
  // A legitimate miss (data.album null — deleted / other region) is null; a
  // sign-in problem prompts and retries once (the same contract as
  // lookupPlaylist); transient/wiring failures (a stalled load, a hornet
  // rename) throw notReady — never a bogus miss — and a lookup-failed (an
  // errored replay, a response with no album field at all — the hornet-rename
  // shape) throws too.
  lookupAlbum: async function (url, config) {
    var mapAlbum = function (a) {
      return {
        id: 'amazonmusic-album-' + a.asin,
        name: a.name,
        artist: a.artist || null,
        albumArt: a.albumArt || null,
        releaseDate: a.releaseDate || null,
        // The flow reports the album's own trackCount; keep it so a
        // server-truncated load is visible instead of silently complete.
        trackCount: a.trackCount || a.tracks.length,
        url: a.url || url,
        tracks: a.tracks.map(function (t) {
          return {
            id: 'amazonmusic-' + t.asin,
            title: t.title,
            artist: t.artist || a.artist || '',
            album: a.name,
            duration: t.duration || 0,
            sources: ['amazonmusic'],
            amazonAsin: t.asin,
            albumAsin: a.asin,
            trackNumber: typeof t.trackNumber === 'number' ? t.trackNumber : null,
            discNumber: typeof t.discNumber === 'number' ? t.discNumber : null,
            explicit: !!t.explicit,
            albumArt: a.albumArt || null,
          };
        }),
      };
    };
    var loaded = function (result) {
      return !!(
        result &&
        result.success &&
        result.album &&
        result.album.tracks &&
        result.album.tracks.length > 0
      );
    };
    // The flow's throw → a result-shaped outcome, so the mapping below keeps
    // the exact semantics the IPC bridge result used to carry.
    var runFlow = async () => {
      try {
        var album = await this.lookupAlbumFlow(url);
        return { success: true, album: album };
      } catch (error) {
        return { success: false, reason: error && error.reason, error: error };
      }
    };
    var result = null;
    try {
      if (!window.electron || !window.electron.webSession) {
        console.warn('Amazon Music: webSession bridge not available');
        return null;
      }
      result = await runFlow();
      if (loaded(result)) return mapAlbum(result.album);
      // Only a sign-in problem is fixed by sign-in — the same rule the
      // playlist import follows.
      if (result && result.reason === 'not-signed-in') {
        console.log('Amazon Music: not signed in, asking you to sign in...');
        var managed = false;
        if (typeof window.__parachordManageAmazonMusic === 'function') {
          managed = await window.__parachordManageAmazonMusic({
            explicit: true,
            reason: 'not-signed-in',
          });
        }
        if (managed) {
          result = await runFlow();
          if (loaded(result)) return mapAlbum(result.album);
        }
        var err = new Error(
          'Amazon Music is not signed in - sign in from Settings to load albums',
        );
        err.notReady = true;
        err.code = 'not-signed-in';
        throw err;
      }
    } catch (error) {
      if (error && error.notReady) throw error;
      console.error('Amazon Music album lookup error:', error);
      return null;
    }
    // Outside the try so the catch does not swallow these, the same pattern
    // as lookupPlaylist: transient/wiring failures (a stalled load, a hornet
    // rename) must not be reported as a missing album.
    var reason = result && result.reason;
    if (
      reason === 'load-failed' ||
      reason === 'no-cdm' ||
      reason === 'not-ready' ||
      reason === 'lookup-failed' ||
      reason === 'superseded'
    ) {
      var transientErr = new Error(
        'Amazon Music is not reachable right now - check your connection and try again',
      );
      transientErr.notReady = true;
      transientErr.code = reason;
      throw transientErr;
    }
    // success with album: null is the legitimate miss (deleted / other
    // region); so is any other outcome — the catalog fallback moves on to
    // the next service.
    return null;
  },
  // ── The playlist import (#1356 M7) ─────────────────────────────────────────
  // The flow that used to live in amazon-web-player.js, moved onto the
  // webSession bridge (the last main-process capture-and-replay flow besides
  // recommendations). The playlist page has no ASINs in its DOM (rows are
  // ListItem buttons whose track identity lives in React fiber props), so
  // the import borrows the page's own GraphQL: the playlist page loads with
  // the capture window inside the load, the playlistDetail request the page
  // itself fires (a persisted query / APQ whose hash renumbers on every
  // hornet redeploy — nothing is hardcoded) is replayed to the captured URL
  // VERBATIM (the page's own firstLimit, never raised: the server serves
  // one page per request however high the limit), and a playlist longer than
  // one page continues via the response's own pageInfo.token passed as the
  // afterCursor variable (the Relay-style endCursor is a decoy the server
  // answers with page 1 for; every other variable name is dropped) — the
  // pure paginatePlaylistTracks in _lib follows it, MAX_PAGES 40 / MAX_MS
  // 120s, every stop keeping what was merged. NOT plan-gated, like the album
  // catalog: the plan gate stops playback, not discovery — the old
  // amazonmusic-lookup-playlist handler never read the plan either.

  // The playlist-lookup entry: URL shape, sign-in check, then the load phase
  // queued on the plugin's page-flow queue (the FOREGROUND lane — see
  // lookupPlaylistFlow below). The queue covers the LOAD only
  // (serialized against the spec-search and album page flows, so one flow's
  // navigation never interleaves another's); the replay + token-driven
  // pagination after it run parallel-safe — pageFetch is reader traffic, and
  // a busy gate (a concurrent navigation) is ridden out by the bounded
  // backoff inside sendPlaylistQuery rather than truncating the import.
  // A long import therefore does not hold the queue hostage (up to 120s of
  // pagination behind it would starve every search queued on it).
  //
  // The load rides the FOREGROUND lane of the per-instance page-flow queue
  // (#1423's semantics, mirrored from the host's own): the user opened this
  // playlist and is waiting on it, so it starts before every queued
  // background page flow (a spec search, an album lookup, an artist-photo
  // job), behind at most the one in progress. The hover prefetch calls the
  // same lookup, so it rides the foreground lane too.
  lookupPlaylistFlow: async function (rawUrl) {
    const lib = this.requireLib();
    const ws = window.electron && window.electron.webSession;
    if (!ws) throw lib.notReady('not-ready', 'Amazon webSession bridge not available');
    if (typeof rawUrl !== 'string' || !/^https:\/\/music\.amazon\.com\//i.test(rawUrl)) {
      throw lib.notReady('not-ready', 'Not an Amazon Music playlist URL');
    }
    const playlistId = lib.amazonPlaylistIdFromUrl(rawUrl);
    if (!playlistId) {
      throw lib.notReady('not-ready', 'Not an Amazon Music playlist URL');
    }
    if (!(await this.isSignedIn())) {
      throw lib.notReady('not-signed-in', 'Sign in and choose an Amazon Music profile');
    }
    const page = await this.enqueuePageFlow(() => this.lookupPlaylistPageFlow(rawUrl, playlistId), { lane: 'foreground' });
    if (!page) return null;
    return this.playlistImportPages(page.entry, page.request);
  },

  // The load phase: load the playlist page through the bridge with the
  // capture window inside the load, then match the page's own playlistDetail
  // request on the RETURNED captures. The entries must have their headers
  // (the host pairs bodies with headers by request id; onBeforeSendHeaders
  // fires milliseconds after onBeforeRequest, so accepting the body alone
  // races it) and the page's own capture is preferred over our echo (both
  // match our playlist id; the echo's headers are session-aged).
  lookupPlaylistPageFlow: async function (rawUrl, playlistId) {
    const lib = this.requireLib();
    const ws = window.electron && window.electron.webSession;
    if (!ws) throw lib.notReady('not-ready', 'Amazon webSession bridge not available');
    console.log('[Amazon] playlist lookup ' + rawUrl);
    const load = await ws.load(lib.SESSION, rawUrl, {
      capture: {
        urlPrefixes: [lib.GQL_URL + '*'],
        // The window ENDS AT the page's own playlistDetail op — doneWhen
        // (the host's data-only stop condition, rule 5) names the operation
        // the matcher below keys on, quoted so a rename only falls back to
        // the quiet window — restoring #1423's slow-subresource fix the right
        // way: the import proceeds the moment the op is captured, before
        // did-finish-load, instead of waiting out the 30s budget for the
        // escape below. The quiet window is the FALLBACK for a playlistDetail
        // that never comes (not found / renamed), and it is the playlist one
        // — wider than the shared 2.5s so a lagging playlistDetail survives
        // an early unrelated gql (#1437 round 2).
        quietMs: lib.PLAYLIST_CAPTURE_QUIET_MS,
        budgetMs: lib.PAGE_CAPTURE_BUDGET_MS,
        doneWhen: { bodyIncludes: '"' + lib.PLAYLIST_DETAIL_OP_NAME + '"' },
        // Rule 5's budget escape, opted in per load: this flow is the ONE
        // caller that knows how to judge a half-loaded page's captures (the
        // matcher below reads playlistDetail off whatever the window holds,
        // and a capture that holds no playlistDetail is the ordinary miss).
        // Every other flow keeps the default contract — a budget-out load
        // throws load-failed, which its callers already treat as transient —
        // so a slow page is never misread as a structural "never searched"
        // or a not-found miss. The pathological case this still covers:
        // playlistDetail never arrives but other captures are held.
        returnOnTimeout: true
      }
    });
    if (!load || !load.success) {
      // A refused load: 'load-failed' (the page never finished), 'superseded'
      // (a sign-out cleared the session mid-load), 'not-ready' (no host
      // window). Transient/wiring classes, never a miss and never a sign-in
      // prompt.
      throw lib.notReady((load && load.reason) || 'load-failed', (load && load.error) || 'Amazon playlist page did not finish loading');
    }
    if (load.loadTimedOut) {
      // The host's rule-5 escape (#1423's bug class): the navigation budget ran
      // out with the capture already holding requests — one slow subresource
      // keeps did-finish-load from firing long after the page's gql. The
      // page's requests were the point of the load, not the finished
      // document, and the host returned them with the flag; the import
      // proceeds on the still-loading page (the SPA already booted and
      // queried). A capture that holds no playlistDetail is the ordinary miss
      // below, with its ops log.
      console.log('[Amazon] playlist page still loading after the load budget; proceeding with the captured requests');
    }
    // The after-load URL re-checks: a wall means the session died mid-flight
    // (the page redirected to a sign-in wall while it loaded); a page that
    // left music.amazon.com entirely cannot be replayed from.
    if (lib.pageBlocksPlayback(load.finalUrl)) {
      console.warn('[Amazon] playlist blocked: ' + load.finalUrl);
      throw lib.notReady('not-signed-in', 'Choose an Amazon Music profile');
    }
    if (!lib.isAmazonMusicPage(load.finalUrl)) {
      throw lib.notReady('not-ready', 'Amazon playlist page left music.amazon.com before replay');
    }
    const captured = (load.captures || []).filter(r => r.headers);
    const isOurs = (r) => !!lib.amazonPlaylistDetailRequest([r.body], playlistId);
    const entry = captured.find(r => !r.echo && isOurs(r)) || captured.find(isOurs);
    if (!entry) {
      // The page loaded but never asked for this playlist: deleted, private,
      // not available in the user's territory — or hornet renamed the
      // operation. Log what the page did fire so a rename reads as a rename
      // instead of "every playlist is deleted". The ops list is built from
      // the UNFILTERED captures — every captured body's operation names,
      // header-complete or not (a playlistDetail body whose headers never
      // paired is not replayable, but the race must not hide the rename from
      // the log; the old host flow logged the same unfiltered list).
      const ops = lib.capturedOperationNames((load.captures || []).map(r => r.body)).join(', ') || 'none';
      console.warn('[Amazon] playlist lookup: page never requested playlistDetail for ' + playlistId + '; gql operations seen: ' + ops);
      return null;
    }
    const request = lib.amazonPlaylistDetailRequest([entry.body], playlistId);
    if (!request || !request.variables || typeof request.variables !== 'object') {
      throw lib.notReady('lookup-failed', 'Unexpected Amazon playlist query shape');
    }
    return { entry, request };
  },

  // The replay + token-driven pagination (parallel-safe after the load
  // phase; see lookupPlaylistFlow). fetchPage replays the page's own request
  // with the token as afterCursor — the token is the only continuation the
  // server accepts (live-verified 2026-10 against a 977-track playlist; the
  // endCursor decoy answers page 1, the dependent blob alone errors
  // "Invalid sequence token", other variable names are dropped).
  playlistImportPages: async function (entry, request) {
    const lib = this.requireLib();
    // The playlist-specific gql-error rule: errors are fatal unless
    // data.playlist came back (a null playlist with errors is the
    // deleted/private shape, which surfaces as "Playlist not found").
    const sendPlaylistQuery = async (body) => {
      let outcome;
      // A busy gate (a concurrent navigation — another plugin page flow's
      // load, the host's session mint) is transient, not a failed page: a
      // bounded backoff rides it out, so one navigation does not truncate the
      // import. The bound OUTLASTS the host's load budget
      // (PLAYLIST_BUSY_BACKOFF_MAX_MS, 45s > loadTimeoutMs + margin — the
      // pagination runs parallel-safe after the load phase, so a queued page
      // flow's load takes the gate for its whole navigation budget WHILE the
      // import paginates; the old ~13s bound gave up mid-import and truncated
      // the playlist on page-error / failed the lookup on 'busy').
      for (let attempt = 0; ; attempt++) {
        try {
          // A community playlist (/user-playlists/) answers 294: complete
          // data.playlist plus an error on a capabilities field we never read
          // (playlistPartialIsUsable, _lib). Amazon's own page renders it, so
          // the import does too — for the first page AND every continuation
          // page (each page is its own 294 candidate). Nothing else opts in.
          outcome = await this.replayGql(entry, body, { acceptPartial: lib.playlistPartialIsUsable });
        } catch (error) {
          // A HARD rejection — the invoke refused, the view destroyed
          // mid-replay (signOut, host close) — reads like any other replay
          // error here: a page that stops the pagination keeps what merged.
          outcome = { error: (error && error.message) || String(error) };
        }
        if (outcome.error !== 'busy') break;
        // The accumulated pause if this wait runs: three fast 400ms retries,
        // then 1s steps — never past the bound above.
        const wait = attempt < 3 ? 400 : 1000;
        const waited = attempt < 3 ? (attempt + 1) * 400 : 1200 + (attempt - 2) * 1000;
        if (waited > lib.PLAYLIST_BUSY_BACKOFF_MAX_MS) break;
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      if (outcome.error) return { error: outcome.error };
      if (outcome.partial) {
        const paths = (Array.isArray(outcome.parsed.errors) ? outcome.parsed.errors : [])
          .map(e => (Array.isArray(e && e.path) ? e.path.join('.') : '?'));
        console.log('[Amazon] playlist partial answer (HTTP 294), using data.playlist; errors at: ' + (paths.join(', ') || 'none'));
      }
      const parsed = outcome.parsed;
      if (parsed && Array.isArray(parsed.errors) && parsed.errors.length && !(parsed.data && parsed.data.playlist)) {
        return { error: String((parsed.errors[0] || {}).message || 'Amazon playlist query error') };
      }
      return { parsed };
    };
    console.log('[Amazon] playlist replaying playlistDetail via gql');
    const outcome = await sendPlaylistQuery(request);
    if (outcome.error) throw lib.notReady('lookup-failed', outcome.error);
    const paginated = await lib.paginatePlaylistTracks({
      firstPageData: outcome.parsed && outcome.parsed.data,
      fetchPage: async (token) => {
        const page = await sendPlaylistQuery({
          ...request,
          variables: { ...request.variables, afterCursor: token }
        });
        if (page.error) return { error: page.error };
        return { data: page.parsed && page.parsed.data };
      },
      log: (m) => console.log('[Amazon] playlist ' + m)
    });
    const playlist = paginated.playlist;
    if (playlist && playlist.trackCount > playlist.tracks.length) {
      // A shortfall is only a truncation when pages were left unfetched
      // (paginated.stop names why). When the server is out of pages
      // ('exhausted'), the missing rows are edges with node:null — delisted
      // tracks the response carries no data for at all; there is nothing to
      // import, and the natural end is not a failure.
      if (paginated.stop === 'exhausted') {
        console.log('[Amazon] playlist complete: ' + playlist.tracks.length + ' of ' + playlist.trackCount + ' rows are importable (' + (playlist.trackCount - playlist.tracks.length) + ' unavailable on Amazon)');
      } else {
        console.warn('[Amazon] playlist lookup truncated: got ' + playlist.tracks.length + ' of ' + playlist.trackCount + ' tracks (' + paginated.stop + ')');
      }
    }
    console.log('[Amazon] playlist lookup returning ' + (playlist ? playlist.tracks.length : 0) + ' tracks "' + (playlist ? playlist.name : '') + '"');
    return playlist;
  },

  lookupPlaylist: async function (url, config) {
    var mapResult = function (p) {
      return {
        id: 'amazonmusic-playlist-' + (p.id || ''),
        name: p.name || 'Amazon Music Playlist',
        owner: p.owner || null,
        albumArt: p.albumArt || null,
        // The flow reports the playlist's own trackCount; keep it so a
        // server-truncated import is visible instead of silently complete.
        trackCount: p.trackCount || p.tracks.length,
        url: url,
        tracks: p.tracks.map(function (t) {
          return {
            id: 'amazonmusic-' + t.asin,
            title: t.title,
            artist: t.artist,
            album: t.album,
            duration: t.duration || 0,
            sources: ['amazonmusic'],
            amazonAsin: t.asin,
            albumAsin: t.albumAsin || null,
          };
        }),
      };
    };
    var loaded = function (result) {
      return !!(
        result &&
        result.success &&
        result.playlist &&
        result.playlist.tracks &&
        result.playlist.tracks.length > 0
      );
    };
    // The flow's throw → a result-shaped outcome, so the mapping below keeps
    // the exact semantics the deleted IPC bridge result used to carry. An
    // error with no reason class (a raw bridge rejection — the invoke itself
    // broke) propagates to the outer catch, which answers with the old IPC
    // handler's shape: "Amazon Music playlist import failed: <message>",
    // never a silent null (the old handler's catch-all did the same).
    var runFlow = async () => {
      try {
        var playlist = await this.lookupPlaylistFlow(url);
        return { success: true, playlist: playlist };
      } catch (error) {
        if (!error || !error.reason) throw error;
        return { success: false, reason: error.reason, error: error };
      }
    };
    var result = null;
    try {
      if (!window.electron || !window.electron.webSession) {
        console.warn('Amazon Music: webSession bridge not available');
        return null;
      }
      result = await runFlow();
      if (loaded(result)) return mapResult(result.playlist);
      // Only a sign-in problem is fixed by sign-in. load-failed is a network
      // condition - and prompting for sign-in on a network failure points
      // the user at the wrong fix.
      if (result && result.reason === 'not-signed-in') {
        console.log('Amazon Music: not signed in, asking you to sign in...');
        var managed = false;
        if (typeof window.__parachordManageAmazonMusic === 'function') {
          managed = await window.__parachordManageAmazonMusic({
            explicit: true,
            reason: 'not-signed-in',
          });
        }
        if (managed) {
          result = await runFlow();
          if (loaded(result)) return mapResult(result.playlist);
        }
        var err = new Error(
          'Amazon Music is not signed in - sign in from Settings to import playlists',
        );
        err.notReady = true;
        err.code = 'not-signed-in';
        throw err;
      }
    } catch (error) {
      if (error && error.notReady) throw error;
      // An error with no reason class keeps the old IPC handler's shape — the
      // handler caught every error and the renderer surfaced "Amazon Music
      // playlist import failed: <message>". Only a programming error or a
      // broken invoke reaches this path (the reason-classed outcomes are
      // handled below), but a silent null would report a real failure as a
      // missing playlist.
      console.error('Amazon Music playlist lookup error:', error);
      throw new Error('Amazon Music playlist import failed: ' + ((error && error.message) || error));
    }
    // Outside the try so the catch does not swallow these.
    // Transient/wiring failures first: a stalled load must not be reported as a
    // missing playlist (or offered a sign-in prompt) - it is a network condition.
    var reason = result && result.reason;
    if (
      reason === 'load-failed' ||
      reason === 'not-ready' ||
      reason === 'superseded'
    ) {
      var transientErr = new Error(
        'Amazon Music is not reachable right now - check your connection and try again',
      );
      transientErr.notReady = true;
      transientErr.code = reason;
      throw transientErr;
    }
    if (result && result.success && result.playlist === null) {
      throw new Error(
        'Playlist not found on Amazon Music. It may have been deleted or made private.',
      );
    }
    if (result && result.error) {
      throw new Error('Amazon Music playlist import failed: ' + ((result.error && result.error.message) || result.error));
    }
    if (result && result.success) {
      throw new Error(
        'Playlist not found on Amazon Music. It may have been deleted or made private.',
      );
    }
    return null;
  },
  // ── The recommendations (#1356 M8) ─────────────────────────────────────────
  // The two flows that used to live in amazon-web-player.js, moved onto the
  // webSession bridge (the last capture-and-replay family besides the session
  // mint, the diagnostic capture and dmls):
  //
  //   getRecommendations — the home page's MUSIC tab
  //   (https://music.amazon.com/music — the music-only home; the full home at
  //   / fires BrowseHomePage with stations and audiobooks mixed in) fires
  //   MusicHomePage; the flow captures it and walks the home connection
  //   (firstLimit 20, the offset cursor), parsing pure. A fresh template (the
  //   same makeSpecSearchTemplate contract: url + headers + APQ body) replays
  //   from the warm view with NO page load — musicHomeBodyWithVars patches
  //   ONLY the pagination variables; the hash, type and feature flags stay
  //   the capture's.
  //
  //   expandRecommendationSection — the see-more ROUTE
  //   (/browse/music-items/home/recommendation/<strategy>) fires
  //   RecommenderSeeMorePage; a section's first expansion pays the page load,
  //   which mints the see-more template, and every later page (any section,
  //   any cursor) replays it with the id/afterCursor patched
  //   (seeMoreBodyWithVars — the id is seeMoreSectionIdFor(sectionId): the
  //   see-more page prefixes browse-home even onto a music-home strategy) —
  //   one template serves all sections.
  //
  // Chain discipline (the M5 pattern, the playlist layer's lane split): the
  // page flows (the loads) ride the per-instance two-lane page-flow queue's
  // BACKGROUND lane, serialized against the spec-search and catalog flows
  // so one flow's navigation never interleaves another's, while a playlist
  // the user opened (lookupPlaylistFlow, the foreground lane) goes ahead of
  // every job queued here — the recommendations asked for the playlist, so
  // they cannot be what it waits behind (#1423's case); the replays around
  // them run parallel-safe (pageFetch is reader traffic; a busy gate is
  // ridden out or read as a miss, never a failure).
  // NOT plan-gated, like the album catalog and artist images: a Prime
  // account's home page is still its own recommendations — the plan gate stops
  // playback, not discovery. No breaker: recommendations are asked for by a
  // page (Recommendations on each visit, Home's "Albums you might love" row),
  // never on a resolution path, so a structural failure costs one capture
  // window, not a run of them. Miss policy like the album catalog's: a real
  // miss is empty sections; a readiness failure throws notReady (never cached
  // as a miss, never a sign-in prompt); signed out is notReady, never cached
  // as anything. A host whose bridge predates the capability is a quiet empty
  // provider.

  // The home-page sections for the recommendations provider. Cached per
  // process for RECOMMENDATIONS_CACHE_TTL_MS (the renderer's per-provider
  // cache answers first). The cached result includes the synthesized
  // playlists section (withPlaylistsSection below) and holds EVERY section
  // the walk parsed — the shelf filter is applied on the way out, so the
  // cache survives a filter change.
  getRecommendations: async function (config) {
    try {
      if (!window.electron || !window.electron.webSession) {
        console.warn('Amazon Music: webSession bridge not available');
        return { sections: [] };
      }
      const lib = this.requireLib();
      // Signed out is notReady('not-signed-in'), never cached as a miss.
      if (!(await this.isSignedIn())) {
        throw lib.notReady('not-signed-in', 'Sign in and choose an Amazon Music profile');
      }
      const cached = this._recommendationsCache;
      if (cached && (Date.now() - cached.fetchedAt) < lib.RECOMMENDATIONS_CACHE_TTL_MS) {
        return { sections: this.pageSections(cached.sections) };
      }
      let sections = null;
      const fast = await this.tryMusicHomeWalk();
      if (fast) {
        sections = fast.sections;
      } else {
        // The queued page flow (the M5 pattern): the load and the walk's
        // replays after the mint run inside the same queued job — a whole
        // multi-page walk must never interleave another flow's navigation.
        // The BACKGROUND lane of the per-instance two-lane page-flow queue
        // (#1423's semantics, the playlist layer's lane split): the home
        // refresh is speculative work the Recommendations page asked for,
        // while a playlist the user opened from it (lookupPlaylistFlow, the
        // foreground lane) goes ahead of this whole job — the exact case
        // #1423 fixed on the host: an opened playlist waited behind a
        // two-page home refresh.
        const run = this.enqueuePageFlow(async () => {
          // The page flow that ran while this one waited may have
          // refreshed the template — one refresh heals every walk queued
          // behind it.
          const warmed = await this.tryMusicHomeWalk();
          if (warmed) return warmed.sections;
          return this.musicHomePageFlow();
        });
        sections = await run;
      }
      // Outside the queue (the job above has completed): the home page
      // rotates its sections per load and often does not render the
      // playlists one.
      sections = await this.withPlaylistsSection(sections);
      this._recommendationsCache = { sections, fetchedAt: Date.now() };
      console.log('[Amazon] resolver recommendations', sections.length, 'sections,', sections.reduce((n, s) => n + s.items.length, 0), 'items');
      return { sections: this.pageSections(sections) };
    } catch (error) {
      if (error && error.notReady) throw error;
      var reason = error && error.reason;
      if (reason) {
        // A readiness failure (or any unmapped failure — the page must never
        // cache a failure as a miss) is notReady, never a quiet miss.
        var err = new Error('Amazon Music not ready');
        err.notReady = true;
        err.code = reason;
        throw err;
      }
      console.error('Amazon Music recommendations error:', error);
      return { sections: [] };
    }
  },

  // The shelf filter (#1491), applied on the way out of every
  // getRecommendations answer (the walk parses and caches every section;
  // every shelf but "Featured This Week" reaches the page, each under a
  // category). Amazon's personal shelves are named strategies
  // ("…mp3YmlRecentPlaybackStrategy", "…playlistStrategy"); its editorial
  // ones ("Top Playlists", "A Whole Mood", "On-Demand Albums This Week",
  // "Amazon Music Live", "Recently Played") carry UUID ids, the onboarding
  // shelf is GET_STARTED, and the genre shelf ("Soundtracks") is a strategy
  // but a promo. Live-captured 2026-11-12. The UUID shelves carry no other
  // mark, so the two that need telling apart ("Featured This Week",
  // "Recently Played") go by title.
  pageSections: function (sections) {
    const strategyName = (id) => String(id || '').split('/').pop().replace(/^(browse|music)-home_/, '');
    const isStrategy = (id) => /Strategy$/.test(strategyName(id));
    const isFeatured = (s) => /^\s*featured\b/i.test(String((s && s.title) || ''));
    // The category the Recommendations page files a section under (its
    // albums and playlists; songs and artists have no categories). A
    // strategy it doesn't know sends none, so the page files it under
    // "More …"; a shelf that isn't a strategy is Amazon's editors' pick.
    const STRATEGY_CATEGORIES = {
      playlistStrategy: 'personal',
      mp3YmlRecentPlaybackStrategy: 'personal',
      mp3PrimeAlbumsStrategy: 'personal',
      mp3YourHeaviestListeningStrategy: 'personal',
      newReleasesForYouStrategy: 'new',
      mp3ByArtistStrategy: 'artist',
      mp3CommunityPlaylistsStrategy: 'community',
      mp3GenreForYouStrategy: 'editorial'
    };
    const categoryOf = (s) => {
      if (isStrategy(s.id)) {
        const last = strategyName(s.id);
        return Object.prototype.hasOwnProperty.call(STRATEGY_CATEGORIES, last) ? STRATEGY_CATEGORIES[last] : undefined;
      }
      if (/^\s*recently played\s*$/i.test(String(s.title || ''))) return 'personal';
      return 'editorial';
    };
    // The artist a "by artist" shelf is seeded on: the one artist every
    // album shares (trimmed, case-insensitive, first spelling). Never read
    // from the shelf title; mixed or blank artists give no seed and the row
    // title falls back.
    const seedArtistOf = (items) => {
      let seed = null;
      for (let i = 0; i < items.length; i++) {
        const a = items[i] && typeof items[i].artist === 'string' ? items[i].artist.trim() : '';
        if (!a) return undefined;
        if (seed === null) seed = a;
        else if (seed.toLowerCase() !== a.toLowerCase()) return undefined;
      }
      return seed === null ? undefined : seed;
    };
    return (sections || [])
      .filter((s) => s && Array.isArray(s.items) && s.items.length > 0 && !isFeatured(s))
      .map((s) => {
        // The synthesized "Playlists for You" section carries its first
        // page's continuation cursor — pass it through so the page's first
        // "Load more" starts from it.
        const category = categoryOf(s);
        let out = s;
        if (s.nextCursor != null) {
          out = { id: s.id, title: s.title, description: s.description, items: s.items, nextCursor: String(s.nextCursor) };
        }
        if (category) out = Object.assign({}, out, { category: category });
        if (category === 'artist') {
          const seedArtist = seedArtistOf(s.items);
          if (seedArtist) out = Object.assign({}, out, { seedArtist: seedArtist });
        }
        return out;
      });
  },

  // The replay-first fast path for getRecommendations: the same gates as
  // trySpecReplay (a fresh template, a live session generation, an
  // Amazon-origin page world) around the whole multi-page walk. Returns the
  // merged sections, or null for any template miss — the caller queues the
  // page flow, which re-mints. A mid-walk failure drops the template and
  // defers to the page flow (the #1152 rule: only a fresh capture can prove
  // a hornet rename).
  tryMusicHomeWalk: async function () {
    const lib = this.requireLib();
    const template = this._musicHomeTemplate;
    if (!lib.specTemplateIsFresh(template, Date.now())) return null;
    const state = await this.sessionState();
    if (!state) return null;
    // The generation check inside sessionState may have dropped the template
    // (a sign-out the plugin cannot see the event of): the local snapshot
    // belongs to the previous account — its csrf headers must never replay
    // into this one. A template replaced meanwhile (a page flow re-mint) is
    // simply a miss — the caller falls to its page flow.
    if (this._musicHomeTemplate !== template) return null;
    const href = state.url;
    // A replay needs an Amazon-origin page world (cookies, CORS): a parked
    // or never-loaded view means the page flow runs instead.
    if (!href || !lib.isAmazonMusicPage(href)) return null;
    if (lib.pageBlocksPlayback(href)) {
      // A MISS, never a throw (the rule the M5 spec-search fast path
      // learned): the view keeps whatever URL its last navigation left
      // behind, so a token-refresh redirect can park it on a wall with a
      // LIVE session, and a throw would block the very page flow that
      // navigates it off — the page flow's own after-load re-check (on a
      // freshly loaded page) is where the verdict is made.
      console.warn('[Amazon] home recommendations replay blocked: ' + href + '; the page flow will navigate it off');
      return null;
    }
    let timer = null;
    try {
      // The whole walk is bounded by RECOMMENDATIONS_WALK_TIMEOUT_MS (the
      // same 12s as one replay — the host's pageFetch timeout): one slow
      // page must not stretch a walk of four into a minute. A late rejection
      // after the race lost must not be unhandled (the walk keeps running in
      // the background until its own page answers).
      const walking = this.walkMusicHomePages(template);
      walking.catch(() => {});
      const walked = await Promise.race([
        walking,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve({ timeout: true }), lib.RECOMMENDATIONS_WALK_TIMEOUT_MS);
          if (typeof timer.unref === 'function') timer.unref();
        })
      ]);
      if (walked && walked.timeout) {
        console.warn('[Amazon] home recommendations walk exceeded ' + lib.RECOMMENDATIONS_WALK_TIMEOUT_MS + 'ms; the page flow will re-capture');
        if (this._musicHomeTemplate === template) this._musicHomeTemplate = null;
        return null;
      }
      console.log('[Amazon] home recommendations walk returning ' + walked.sections.length + ' sections over ' + walked.pages + ' page(s)');
      return walked;
    } catch (error) {
      // A busy gate (a concurrent navigation holds the host's readers/writer
      // gate) is a miss that KEEPS the template (the M5 rule): the page flow
      // queues behind the same navigation anyway.
      if (error && error.busy) return null;
      console.warn('[Amazon] home recommendations walk failed (' + ((error && error.message) || error) + '); the page flow will re-capture');
      if (this._musicHomeTemplate === template) this._musicHomeTemplate = null;
      return null;
    } finally {
      clearTimeout(timer);
    }
  },

  // The full section walk over the home connection. The page's own request
  // carries firstLimit 5 — the walk asks for MUSIC_HOME_FIRST_LIMIT per page
  // and follows the connection's OFFSET cursor (pageInfo.token, passed back
  // as the afterCursor variable) until it runs out (hasNextPage false / no
  // token), a page repeats the cursor it was sent (no advance — the same
  // rule the see-more pagination enforces), or the page cap is hit. Sections
  // dedupe by id across pages: the server re-ranks per request, so an offset
  // page can re-serve a section an earlier page already carried. Throws
  // plain Errors for a replay failure and for a non-envelope response — the
  // callers decide which of those is a drop-the-template miss and which is
  // structural.
  walkMusicHomePages: async function (template) {
    const lib = this.requireLib();
    const pages = [];
    let cursor = null;
    for (let i = 0; i < lib.MUSIC_HOME_MAX_PAGES; i++) {
      const body = lib.musicHomeBodyWithVars(template.body, {
        firstLimit: lib.MUSIC_HOME_FIRST_LIMIT,
        afterCursor: cursor
      });
      let outcome;
      // A busy gate (a concurrent navigation — the host's session mint,
      // another load through the same host, the idle park's blank) is
      // transient, not a failed walk: the same bounded backoff the other
      // replay flows carry rides it out (the M7 pattern).
      for (let attempt = 0; ; attempt++) {
        try {
          outcome = await this.replayGql(template, body);
        } catch (error) {
          // A HARD rejection — the invoke refused, the view destroyed
          // mid-replay — is the same as an error envelope.
          outcome = { error: (error && error.message) || String(error) };
        }
        if (outcome.error !== 'busy') break;
        const wait = attempt < 3 ? 400 : 1000;
        if (attempt >= 3 && (attempt - 3 + 1) * 1000 > 12000) break;
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      if (outcome.error) {
        const err = new Error(outcome.error);
        err.status = outcome.status;
        if (outcome.error === 'busy') err.busy = true;
        throw err;
      }
      const page = lib.recommendationsFromMusicHome(outcome.parsed && outcome.parsed.data);
      if (!page.envelope) throw new Error('music home response was not the expected envelope');
      pages.push(page);
      if (!page.nextCursor || page.nextCursor === cursor) break;
      cursor = page.nextCursor;
    }
    return { sections: lib.mergeMusicHomeSectionPages(pages), pages: pages.length };
  },

  // The page flow over the session's home (AMAZON_HOMES): the music tab, or
  // the full home once the music tab was refused this session. A refusal
  // (HTTP 294 — a Prime account's music tab is refused while its full home
  // answers 200 in the same envelope, #1328) switches and runs the flow once
  // more on the full home. The switch lasts the session (the session
  // generation change forgets it); a failure that isn't a 294 never switches.
  // The cost is one refused music-tab load per session for such an account.
  musicHomePageFlow: async function () {
    const lib = this.requireLib();
    try {
      return await this.homePageFlow();
    } catch (error) {
      if (error && error.homeRefused && this._musicHomeVariant !== 'browse') {
        console.log('[Amazon] music home refused (HTTP ' + lib.HOME_REFUSED_STATUS + '); reading the full home for this session');
        this._musicHomeVariant = 'browse';
        this._musicHomeTemplate = null;
        return this.homePageFlow();
      }
      throw error;
    }
  },

  // The queued page flow behind getRecommendations (the BACKGROUND lane of
  // the plugin's two-lane page-flow queue — see getRecommendations): load the
  // home page through the bridge with the capture window inside the load,
  // capture its own MusicHomePage (or BrowseHomePage) request, mint the
  // template, replay verbatim, parse pure. The mint prefers the capture with
  // the FRESHEST
  // csrf-ts among the page's OWN requests: the home request's variables are
  // constant, so our own concurrent template replay echoes into the capture
  // byte-identical to a fresh request (unlike the spec search, where
  // variables.searchText distinguishes them) and its session-aged headers
  // must not be re-certified as fresh — an echo never mints (the M5/M6 echo
  // rule), and among the page's own captures a re-render's newest headers
  // ride the freshest csrf-ts.
  homePageFlow: async function () {
    const lib = this.requireLib();
    const ws = window.electron && window.electron.webSession;
    if (!ws) throw lib.notReady('not-ready', 'Amazon webSession bridge not available');
    const home = lib.AMAZON_HOMES[this._musicHomeVariant === 'browse' ? 'browse' : 'music'];
    const load = await ws.load(lib.SESSION, home.url, {
      capture: {
        urlPrefixes: [lib.GQL_URL + '*'],
        quietMs: lib.PAGE_CAPTURE_QUIET_MS,
        budgetMs: lib.PAGE_CAPTURE_BUDGET_MS
      }
    });
    if (!load || !load.success) {
      // A refused load: 'load-failed' (the page never finished), 'superseded'
      // (a sign-out cleared the session mid-load), 'not-ready' (no host
      // window). Transient/wiring classes, never a miss and never a sign-in
      // prompt.
      throw lib.notReady((load && load.reason) || 'load-failed', (load && load.error) || 'Amazon home page did not finish loading');
    }
    // The after-load URL re-check: a genuinely dead session is caught
    // mid-flight (the page redirected to a sign-in wall while it loaded).
    if (lib.pageBlocksPlayback(load.finalUrl)) {
      console.warn('[Amazon] home recommendations blocked: ' + load.finalUrl);
      throw lib.notReady('not-signed-in', 'Choose an Amazon Music profile');
    }
    // The entries must have their headers (the host pairs bodies with headers
    // by request id) and must be the page's OWN — an echo is our replay
    // traffic and never mints.
    const captured = (load.captures || []).filter(r => r.headers && !r.echo);
    let entry = null;
    let request = null;
    let bestTs = -1;
    for (const r of captured) {
      const req = lib.amazonMusicHomeRequest([r.body], home.operationName);
      if (!req) continue;
      const ts = Number(r.headers['csrf-ts'] || r.headers['Csrf-ts']) || 0;
      if (ts >= bestTs) { bestTs = ts; entry = r; request = req; }
    }
    if (!entry || !request) {
      // The page loaded but never ran its recommendations query: a hornet
      // rename (or an SPA failure). Log what it did fire so a rename reads
      // as a rename instead of a silent run of failed loads — the ops list
      // is built from the UNFILTERED captures (echoes included; a rename
      // must not hide behind our own traffic).
      const ops = lib.capturedOperationNames((load.captures || []).map(r => r.body)).join(', ') || 'none';
      console.warn('[Amazon] ' + home.url + ' never fired ' + home.operationName + '; gql operations seen: ' + ops);
      throw lib.notReady('not-ready', 'Amazon home page never issued its recommendations query');
    }
    const template = lib.makeSpecSearchTemplate({ url: entry.url, headers: entry.headers, body: request, capturedAt: Date.now() });
    if (!template) throw lib.notReady('not-ready', 'Amazon home page capture could not build a template');
    this._musicHomeTemplate = template;
    // The minted template carries the page's own firstLimit-5 variables — the
    // walk replays it with the bumped firstLimit and the cursor pages.
    try {
      const walked = await this.walkMusicHomePages(template);
      console.log('[Amazon] home recommendations page flow returning ' + walked.sections.length + ' sections over ' + walked.pages + ' page(s)');
      return walked.sections;
    } catch (error) {
      console.warn('[Amazon] home recommendations walk failed after a fresh capture: ' + ((error && error.message) || error));
      const err = lib.notReady('not-ready', 'Amazon home recommendations response was not the expected shape');
      if (error && error.status === lib.HOME_REFUSED_STATUS) err.homeRefused = true;
      throw err;
    }
  },

  // The home page rotates its sections per load (live-observed 2026-11: four
  // different section sets in four loads) and does not always render a
  // playlists section — but the playlists STRATEGY answers the see-more route
  // regardless. Its first page carries the user's mixes ("My Discovery Mix",
  // "My Recent Plays and More") plus curated playlists, all /playlists/<id>
  // URLs the plugin's own playlist import (M7) already handles. So when the
  // home page's sections carry no playlist items, pull the strategy's first
  // page as a "Playlists for You" section, with the route's continuation
  // cursor riding on it (the plugin contract's section.nextCursor) so the
  // page's Load more paginates it. A renamed strategy or a route failure
  // soft-fails: the home page's own sections are unaffected.
  withPlaylistsSection: async function (sections) {
    const lib = this.requireLib();
    const hasPlaylists = (sections || []).some(s => (s.items || []).some(i => i.type === 'playlist'));
    if (hasPlaylists) return sections;
    try {
      const parsed = await this.expandRecommendationSectionParsed(lib.PLAYLISTS_SECTION_ID, null);
      if (parsed && parsed.section && parsed.section.items && parsed.section.items.length) {
        const section = { id: lib.PLAYLISTS_SECTION_ID, title: parsed.section.title || 'Playlists for You', items: parsed.section.items };
        if (parsed.nextCursor) section.nextCursor = parsed.nextCursor;
        console.log('[Amazon] home recommendations synthesized "' + section.title + '" (' + section.items.length + ' playlists' + (section.nextCursor ? ', more available' : '') + ')');
        return [...(sections || []), section];
      }
    } catch (error) {
      console.warn('[Amazon] playlists section unavailable: ' + (error && (error.reason ? error.reason + ' ' + error.message : (error.message || error))));
    }
    return sections;
  },

  // The next page of a titled recommendation section ("Load more"): one page
  // of the see-more route. Cached per section+cursor for the session. Returns
  // the full parsed result ({ section: { title, items }, nextCursor }) — a
  // section the route has nothing for carries a null section (a real
  // nothing-more, not an error). expandRecommendationSection shapes it into
  // the plugin contract; withPlaylistsSection reads the title off it.
  expandRecommendationSectionParsed: async function (sectionId, afterCursor) {
    const lib = this.requireLib();
    if (!(await this.isSignedIn())) {
      throw lib.notReady('not-signed-in', 'Sign in and choose an Amazon Music profile');
    }
    // The id the see-more REQUEST carries for this section: the see-more page
    // prefixes browse-home even onto a music-home strategy
    // (seeMoreSectionIdFor), so the echo guard and the replay's id patch key
    // on THIS id, never the section's own uri.
    const seeMoreId = lib.seeMoreSectionIdFor(sectionId);
    if (!seeMoreId) {
      throw lib.notReady('not-ready', 'Not an Amazon recommendation section id');
    }
    const cacheKey = sectionId + '|' + (afterCursor || '');
    const cached = this._seeMorePages && this._seeMorePages.get(cacheKey);
    if (cached) return cached;
    // The fast-path attempt: whatever template is current at call time (a
    // parallel flow may have re-minted one while this call queued).
    const tryFast = (noun, { keepTemplate = false } = {}) => {
      const template = this._seeMoreTemplate;
      return this.trySeeMoreReplay({
        template,
        // Drop only if nobody re-minted meanwhile — a page flow that ran in
        // parallel already put a fresh template in place. keepTemplate (the
        // cursor page off a just-minted template): the mint is fresh, a
        // replay error is not its fault.
        drop: keepTemplate ? () => {} : () => { if (this._seeMoreTemplate === template) this._seeMoreTemplate = null; },
        bodyFor: (body) => lib.seeMoreBodyWithVars(body, { sectionId: seeMoreId, afterCursor }),
        parse: lib.recommendationsFromSeeMore,
        noun
      });
    };
    const fast = await tryFast('see-more');
    if (fast) {
      this.cacheSeeMorePage(cacheKey, fast);
      return fast;
    }
    // Cold template: the see-more ROUTE (its first page) mints one. Even for
    // a cursor page — the route always answers page 1, but the minted
    // template then replays any section+cursor. The route flow rides the
    // BACKGROUND lane of the per-instance two-lane page-flow queue (a page
    // load is a real navigation; #1423's semantics, the playlist layer's
    // lane split) — a see-more expansion is speculative work a page asked
    // for, and a playlist the user opened (lookupPlaylistFlow, the
    // foreground lane) goes ahead of it. withPlaylistsSection's synthesized
    // "Playlists for You" section rides this same flow.
    const first = this.enqueuePageFlow(async () => {
      // The page flow that ran while this one waited may have refreshed
      // the template — one refresh heals every expansion queued behind it.
      const warmed = await tryFast('see-more');
      if (warmed) return warmed;
      return this.seeMorePageFlow(sectionId);
    });
    const firstParsed = await first;
    if (!afterCursor) {
      this.cacheSeeMorePage(cacheKey, firstParsed);
      return firstParsed;
    }
    // The route answered page 1 while a cursor page was wanted: replay the
    // freshly minted template with the cursor.
    const page = await tryFast('see-more cursor page', { keepTemplate: true });
    if (!page) throw lib.notReady('not-ready', 'Amazon see-more replay failed after a fresh capture');
    this.cacheSeeMorePage(cacheKey, page);
    return page;
  },

  // The plugin-contract shape of one expansion page ("Load more" of a titled
  // section, paginated by the offset cursor the flow returns). Same miss
  // policy as getRecommendations; an exhausted section answers no items and
  // no cursor, which the page renders as the end of the section.
  expandRecommendationSection: async function (sectionId, afterCursor, config) {
    try {
      if (!window.electron || !window.electron.webSession) {
        console.warn('Amazon Music: webSession bridge not available');
        return { items: [], nextCursor: null };
      }
      var id = (sectionId || '').trim();
      if (!id) return { items: [], nextCursor: null };
      // Only a strategy shelf has a see-more page (the route is keyed on the
      // strategy name). The editorial shelves (UUID ids, GET_STARTED) show
      // what the home page sent, so their "Load more" is at its end at
      // once, instead of loading a page that isn't there in the hidden view
      // — which here would load /browse/music-items/home/recommendation/<uuid>
      // (a route that does not exist), hold the page-flow queue for the
      // capture budget, and throw not-ready: an error on the shelf instead
      // of its end. The check rides ahead of any replay or load, so it
      // answers even before the signed-in read.
      if (!/Strategy$/.test(id.split('?')[0].split('/').pop())) return { items: [], nextCursor: null };
      var parsed = await this.expandRecommendationSectionParsed(id, afterCursor || null);
      var items = ((parsed && parsed.section && parsed.section.items) || []).filter(function (i) { return i && (i.name || i.title); });
      return { items: items, nextCursor: (parsed && parsed.nextCursor) || null };
    } catch (error) {
      if (error && error.notReady) throw error;
      var reason = error && error.reason;
      if (reason) {
        // A readiness failure (or any unmapped failure — the page must never
        // cache a failure as a miss) is notReady, never a quiet miss.
        var err = new Error('Amazon Music not ready');
        err.notReady = true;
        err.code = reason;
        throw err;
      }
      console.error('Amazon Music recommendations see-more error:', error);
      return { items: [], nextCursor: null };
    }
  },

  cacheSeeMorePage: function (key, page) {
    const lib = this.requireLib();
    if (!this._seeMorePages) this._seeMorePages = new Map();
    this._seeMorePages.set(key, page);
    while (this._seeMorePages.size > lib.SEE_MORE_CACHE_MAX) {
      this._seeMorePages.delete(this._seeMorePages.keys().next().value);
    }
  },

  // The replay-first fast path for the see-more flow: the same gates as
  // trySpecReplay (a fresh template, a live session generation, an
  // Amazon-origin page world) around one replay with the id/afterCursor
  // patched. Returns the parsed result (an object with envelope true), or
  // null for any template miss — the caller queues the page flow, which
  // re-mints. A structural-looking response (200 with data but no envelope)
  // drops the template and defers to the page flow, the #1152 rule: only a
  // fresh capture can prove a hornet rename.
  trySeeMoreReplay: async function ({ template, drop, bodyFor, parse, noun }) {
    const lib = this.requireLib();
    if (!lib.specTemplateIsFresh(template, Date.now())) return null;
    const state = await this.sessionState();
    if (!state) return null;
    // The generation check inside sessionState may have dropped the template
    // (a sign-out the plugin cannot see the event of): the local snapshot
    // belongs to the previous account — its csrf headers must never replay
    // into this one. A template replaced meanwhile (a page flow re-mint) is
    // simply a miss — the caller falls to its page flow.
    if (this._seeMoreTemplate !== template) return null;
    const href = state.url;
    if (!href || !lib.isAmazonMusicPage(href)) return null;
    if (lib.pageBlocksPlayback(href)) {
      // A MISS, never a throw (the M5 rule — see tryMusicHomeWalk): the page
      // flow's own after-load re-check is where the verdict is made.
      console.warn('[Amazon] ' + noun + ' replay blocked: ' + href + '; the page flow will navigate it off');
      return null;
    }
    const body = bodyFor(template.body);
    let outcome;
    try {
      outcome = await this.replayGql(template, body);
    } catch (error) {
      // A HARD rejection — the invoke refused, the view destroyed mid-replay
      // (signOut, host close) — is the same miss as an error envelope: the
      // fallback page flow re-evaluates view state itself.
      outcome = { error: (error && error.message) || String(error) };
    }
    if (outcome.error) {
      // A busy gate (a concurrent navigation holds the host's readers/writer
      // gate) is a miss that KEEPS the template (the M5 rule): the chained
      // page flow queues behind the same navigation anyway.
      if (outcome.error === 'busy') return null;
      console.warn('[Amazon] ' + noun + ' template replay failed (' + outcome.error + '); the page flow will re-capture');
      drop();
      return null;
    }
    const parsed = parse(outcome.parsed && outcome.parsed.data);
    if (!parsed || parsed.envelope === false) {
      console.warn('[Amazon] ' + noun + ' template replay was not the expected envelope; dropping the template');
      drop();
      return null;
    }
    return parsed;
  },

  // The queued page flow behind expandRecommendationSection (the BACKGROUND
  // lane of the plugin's two-lane page-flow queue — see
  // expandRecommendationSectionParsed): load the see-more route for the
  // section through the bridge with the capture window inside the load,
  // capture its own RecommenderSeeMorePage request, mint the
  // template (one serves every section+cursor), replay verbatim, parse pure.
  // Only THIS section's request mints or answers: our own concurrent
  // template replay of a DIFFERENT section echoes into the capture with the
  // same operationName (unlike the spec search, where variables.searchText
  // distinguishes echo from page — a see-more echo differs only in
  // variables.id), and minting or returning it would serve the wrong
  // section's items, session-cached under this key. The comparison id is the
  // SEE-MORE id (browse-home-prefixed), never the section's own uri — a
  // music-home section's page request never carries its own id.
  seeMorePageFlow: async function (sectionId) {
    const lib = this.requireLib();
    const ws = window.electron && window.electron.webSession;
    if (!ws) throw lib.notReady('not-ready', 'Amazon webSession bridge not available');
    const url = lib.amazonSeeMorePageUrl(sectionId);
    const seeMoreId = lib.seeMoreSectionIdFor(sectionId);
    if (!url || !seeMoreId) throw lib.notReady('not-ready', 'Not an Amazon recommendation section id');
    const load = await ws.load(lib.SESSION, url, {
      capture: {
        urlPrefixes: [lib.GQL_URL + '*'],
        quietMs: lib.PAGE_CAPTURE_QUIET_MS,
        budgetMs: lib.PAGE_CAPTURE_BUDGET_MS
      }
    });
    if (!load || !load.success) {
      throw lib.notReady((load && load.reason) || 'load-failed', (load && load.error) || 'Amazon see-more page did not finish loading');
    }
    // The after-load wall re-check: a genuinely dead session is caught
    // mid-flight.
    if (lib.pageBlocksPlayback(load.finalUrl)) {
      console.warn('[Amazon] see-more blocked: ' + load.finalUrl);
      throw lib.notReady('not-signed-in', 'Choose an Amazon Music profile');
    }
    // The page's OWN requests only (an echo never mints), and only this
    // section's, preferring the freshest csrf-ts (a re-render fires the op
    // again with fresher headers). The id guard is stricter than the host's
    // copy was (it skipped a request only when variables.id was present and
    // different): a see-more request with NO id is skipped too — the route's
    // own request always carries the see-more id (live-verified), so an
    // id-less RecommenderSeeMorePage body is some other page's call, never
    // this section's mint.
    const captured = (load.captures || []).filter(r => r.headers && !r.echo);
    let entry = null;
    let request = null;
    let bestTs = -1;
    for (const r of captured) {
      const req = lib.amazonSeeMoreRequest([r.body]);
      if (!req) continue;
      // No id is not this section's id either: skip, don't guess.
      if (!req.variables || req.variables.id !== seeMoreId) continue;
      const ts = Number(r.headers['csrf-ts'] || r.headers['Csrf-ts']) || 0;
      if (ts >= bestTs) { bestTs = ts; entry = r; request = req; }
    }
    if (!entry || !request) {
      const ops = lib.capturedOperationNames((load.captures || []).map(r => r.body)).join(', ') || 'none';
      console.warn('[Amazon] see-more page never fired RecommenderSeeMorePage; gql operations seen: ' + ops);
      throw lib.notReady('not-ready', 'Amazon see-more page never issued its query');
    }
    const template = lib.makeSpecSearchTemplate({ url: entry.url, headers: entry.headers, body: request, capturedAt: Date.now() });
    if (template) this._seeMoreTemplate = template;
    // Replay the route's own request verbatim (the section's FIRST page). A
    // busy gate (a concurrent navigation) is transient, not a failed flow:
    // the same bounded backoff the other replay flows carry rides it out.
    let outcome;
    for (let attempt = 0; ; attempt++) {
      try {
        outcome = await this.replayGql(entry, request);
      } catch (error) {
        outcome = { error: (error && error.message) || String(error) };
      }
      if (outcome.error !== 'busy') break;
      const wait = attempt < 3 ? 400 : 1000;
      if (attempt >= 3 && (attempt - 3 + 1) * 1000 > 12000) break;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    if (outcome.error) throw lib.notReady('not-ready', outcome.error);
    const parsed = lib.recommendationsFromSeeMore(outcome.parsed && outcome.parsed.data);
    if (!parsed.envelope) {
      console.warn('[Amazon] see-more response was not the expected envelope');
      throw lib.notReady('not-ready', 'Amazon see-more response was not the expected shape');
    }
    console.log('[Amazon] see-more flow returning ' + (parsed.section ? parsed.section.items.length : 0) + ' items');
    return parsed;
  },
};
