// Source of truth for plugins/amazonmusic.axe v1.16.0.
// Imported from the .axe by `node scripts/build-axes.js --import`.
// Edit here, bump manifest.version in manifest.json, then run `node scripts/build-axes.js`.
// The functions materialize fully isolated (resolver-loader.js uses
// new Function) — no shared scope between them; helpers shared across
// functions live in the _lib factory below (evaluated once per resolver
// instance, pure: helpers and constants only — no I/O, no timers, no window;
// per-instance state lives on `this`).
//
// ── The searches, the catalog, the playlist import and the recommendations
// run in the plugin (#1356 M5/M6/M7/M8) ──────────────────────────────────
// The spec-search runner family (the SpecSearchSeeMorePage capture-and-replay
// flows: the track search, M5, plus the album search and the artist-image
// lookup, M6), the album-detail flow (lookupAlbum's candidate-ranking replay),
// the playlist import (M7 — the playlistDetail capture, the verbatim replay
// and the token-driven pagination) and the recommendations (M8 — the
// music-home walk, the see-more route and the synthesized playlists section)
// are the plugin's: they drive the ONE host web-session instance (registered
// as 'amazon-music') through the window.electron.webSession bridge —
// pageFetch replays the captured request from the page world, load(url,
// {capture}) runs the chained page flow with the capture window inside the
// load (the quiet-bounded returned captures replace the old in-flow poll; our
// own replay traffic arrives as echo-flagged captures and is never trusted),
// and state() supplies the facts the signed-in verdict composes — and the
// session generation whose change (a sign-out the plugin cannot see the event
// of) drops its session-scoped caches. The host-side runner that used to
// serve the album/artist tabs, the host-side playlist import and the
// host-side recommendations flows are deleted; every helper those flows use
// lives here (copies of the amazon-music-logic.js originals, whose remaining
// copies serve the session mint, the diagnostic capture and the dmls flow
// until their moves). What remains host-side is the session mint, the
// diagnostic capture, sign-in/out and getStatus.
module.exports = {
  // ── The plugin library (#1356) ────────────────────────────────────────
  // Pure helpers and constants, evaluated once per resolver instance and
  // frozen by the loader. Every copy below mirrors its original in
  // amazon-music-logic.js / amazon-web-player.js. The copies whose flows
  // have moved (the track search in #1356 M5; the album search, album lookup
  // and artist images in M6; the playlist import in M7; the recommendations
  // in M8) are now the ONLY copy — the host's died with its flows. The rest
  // still serve the host-side flows that have not moved (the session mint,
  // the diagnostic capture, dmls); each copy notes which, and dies when its
  // flow moves in.
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

    // ── Walls and session cookies (amazon-music-logic.js owns the originals,
    // which the host's sign-in/status flows still use) ───────────────────────

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

    // ── The search URL and request matching (amazon-music-logic.js owns the
    // originals; its amazonAlbumSearchUrl/amazonArtistSearchUrl call the same
    // builder for the host-side album/artist searches) ──────────────────────

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
    // account) never become album-detail candidates (copies of the originals
    // in amazon-music-logic.js, which gqlRequestIsAboutSubject — the debug
    // capture that stays host-side — still uses).
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
    // The host's dmls gate (amazon-dmls.js) reads the same file for playback;
    // these copies feed the plugin's own search gate. UNLIMITED… →
    // unlimited, PRIME → prime, anything else, missing or unreadable →
    // unknown, which BLOCKS too (a format change on Amazon's side must show
    // up as a message, not as plays the plan may not cover).

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
      amazonPlanMessage
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
  // is its only rider): it starts before every queued BACKGROUND job (the
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
    // a playlist the user opened (lookupPlaylistFlow, the foreground lane)
    // goes ahead of every job queued here. The host's own remaining loads
    // (the session mint, the diagnostic capture) serialize against them on
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
  // The album/artist flows (M6) hold no session-scoped state of their own:
  // the album search and the artist image ride the SHARED template above,
  // and the album lookup caches nothing (every lookup is a fresh page
  // load), so the two drops here cover them too. The recommendations state
  // (M8) is dropped here the same way: the music-home/see-more templates
  // embed the old session's csrf headers, the parsed caches carry the old
  // account's content, and the music-home variant (a Prime account's refused
  // music tab, #1328) belongs to the old account — the next may read the
  // music tab.
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
        this._planState = null;
        this._specSearchTemplate = null;
        // The recommendations caches and templates (M8) — the sign-out
        // forgets the variant, the caches and the templates (the host's
        // signOut dropped its own copies for exactly this reason).
        this._musicHomeTemplate = null;
        this._seeMoreTemplate = null;
        this._recommendationsCache = null;
        this._seeMorePages = new Map();
        this._musicHomeVariant = null;
        // The search breaker too: its failure counts may be session-shaped
        // (a parked-wall run of structural misses), and a fresh session is
        // the recovery path — a genuine hornet rename re-trips it in three.
        this._searchBreaker = null;
      }
    }
    return state;
  },

  // ── The signed-in verdict ──────────────────────────────────────────────────
  // The plugin's composition of the host's facts (webSession.state() →
  // { url, signInUrl, cookieNames } — read through sessionState, which also
  // runs the generation check) with Amazon's pure predicates — the same
  // composition amazon-web-player.js's isSignedIn runs for the host's
  // flows. Ready means signed in AND a profile chosen (a window still on the
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
  // sign-in prompt — and before searching. The plugin cannot hear the host's
  // amazonmusic-plan-changed event, so the refusal TTL is the upgrade path's
  // backstop: an upgrade unblocks the search a minute later at the worst,
  // sooner when the renderer's plan-changed handler drops this cache (it
  // clears the resolver instance's _planState alongside the misses).
  getPlan: async function ({ refresh } = {}) {
    const lib = this.requireLib();
    const ws = window.electron && window.electron.webSession;
    if (!ws) return 'unknown';
    const now = Date.now();
    const s = this._planState;
    // dmls's own shape (amazon-dmls.js getPlan): a FORCED re-read skips the
    // cache entirely — it exists to catch a change — and a scheduled read
    // serves it within the TTL. Only an UNLIMITED reading earns the 30-min
    // TTL. The plugin cannot hear the host's amazonmusic-plan-changed event
    // (Settings' refreshPlan path refreshes only the host's dmls cache), so a
    // refused reading (prime / unknown) re-reads within the 1-min TTL: an
    // upgrade unblocks search a minute later at the worst, without any
    // refresh channel. The harmful error is a false refusal (an Unlimited
    // account blocked); a false unlimited reading costs at most one failed
    // play's manifest refusal.
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
        this._planState = { plan, at: Date.now() };
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

  // Throws plan-ineligible unless the account is on Music Unlimited. The
  // resolver treats plan-ineligible as not-ready, so nothing is cached as a
  // 30-day noMatch and an upgrade re-resolves.
  assertPlanPlays: async function () {
    const lib = this.requireLib();
    const plan = await this.getPlan();
    if (plan !== 'unlimited') {
      throw lib.notReady('plan-ineligible', lib.amazonPlanMessage(plan) || lib.amazonPlanMessage('unknown'));
    }
    return plan;
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
    // shared Widevine player (Shaka on the shared audio element, manifest and
    // license bytes via window.electron.widevine from the main-process dmls
    // provider). What used to live here — playTrack IPC, prompt-then-retry —
    // lives in the host's widevine branch, which also keeps the
    // not-signed-in → prompt → retry contract.
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
  // Chain discipline (the M5 pattern): the page flows (the loads) ride the
  // per-instance page-flow chain, serialized against the spec-search, catalog
  // and playlist-import flows so one flow's navigation never interleaves
  // another's; the replays around them run parallel-safe (pageFetch is reader
  // traffic; a busy gate is ridden out or read as a miss, never a failure).
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
  // the walk parsed — the personal filter is applied on the way out, so the
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
        return { sections: this.personalSections(cached.sections) };
      }
      let sections = null;
      const fast = await this.tryMusicHomeWalk();
      if (fast) {
        sections = fast.sections;
      } else {
        // The chained page flow (the M5 pattern): the load rides the
        // per-instance page-flow chain, and the walk's replays after the
        // mint run inside the same chained job — a whole multi-page walk
        // must never interleave another flow's navigation.
        const run = (this._pageFlowChain || Promise.resolve())
          .then(async () => {
            // The page flow that ran while this one waited may have
            // refreshed the template — one refresh heals every walk queued
            // behind it.
            const warmed = await this.tryMusicHomeWalk();
            if (warmed) return warmed.sections;
            return this.musicHomePageFlow();
          });
        this._pageFlowChain = run.then(() => {}, () => {});
        sections = await run;
      }
      // Outside the chain (the job above has completed): the home page
      // rotates its sections per load and often does not render the
      // playlists one.
      sections = await this.withPlaylistsSection(sections);
      this._recommendationsCache = { sections, fetchedAt: Date.now() };
      console.log('[Amazon] resolver recommendations', sections.length, 'sections,', sections.reduce((n, s) => n + s.items.length, 0), 'items');
      return { sections: this.personalSections(sections) };
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

  // The personal-shelf filter, applied on the way out of every
  // getRecommendations answer (the walk parses and caches every section;
  // only the personal ones reach the page). Only the personal sections:
  // Amazon's personal shelves are named strategies
  // ("…mp3YmlRecentPlaybackStrategy", "…playlistStrategy"); its editorial
  // ones ("Top Playlists", "Featured This Week", "Amazon Music Live",
  // "Recently Played") carry UUID ids and the onboarding shelf is
  // GET_STARTED. The genre shelf ("Soundtracks") is a strategy but a promo,
  // so it is named out. Live-captured 2026-11-12.
  personalSections: function (sections) {
    const EDITORIAL_STRATEGIES = { mp3GenreForYouStrategy: true };
    const strategyName = (id) => String(id || '').split('/').pop().replace(/^(browse|music)-home_/, '');
    const isPersonal = (id) => {
      const last = strategyName(id);
      return /Strategy$/.test(last) && !EDITORIAL_STRATEGIES[last];
    };
    // The category the Recommendations page files a playlist section under.
    // The playlist strategies and the album strategies say; the rest send
    // none (their items land in More playlists or More albums).
    const categoryOf = (id) => {
      const last = strategyName(id);
      if (last === 'playlistStrategy') return 'personal';
      if (last === 'mp3YmlRecentPlaybackStrategy' || last === 'mp3PrimeAlbumsStrategy') return 'personal';
      if (last === 'mp3ByArtistStrategy') return 'artist';
      if (last === 'mp3CommunityPlaylistsStrategy') return 'community';
      return undefined;
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
      .filter((s) => s && Array.isArray(s.items) && s.items.length > 0 && isPersonal(s.id))
      .map((s) => {
        // The synthesized "Playlists for You" section carries its first
        // page's continuation cursor — pass it through so the page's first
        // "Load more" starts from it.
        const category = categoryOf(s.id);
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

  // The chained page flow behind getRecommendations: load the home page
  // through the bridge with the capture window inside the load, capture its
  // own MusicHomePage (or BrowseHomePage) request, mint the template, replay
  // verbatim, parse pure. The mint prefers the capture with the FRESHEST
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
      return this.tryRecommendationReplay({
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
    // per-instance page-flow chain (a page load is a real navigation).
    const first = (this._pageFlowChain || Promise.resolve())
      .then(async () => {
        // The page flow that ran while this one waited may have refreshed
        // the template — one refresh heals every expansion queued behind it.
        const warmed = await tryFast('see-more');
        if (warmed) return warmed;
        return this.seeMorePageFlow(sectionId);
      });
    this._pageFlowChain = first.then(() => {}, () => {});
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
  tryRecommendationReplay: async function ({ template, drop, bodyFor, parse, noun }) {
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

  // The chained page flow behind expandRecommendationSection: load the
  // see-more route for the section through the bridge with the capture window
  // inside the load, capture its own RecommenderSeeMorePage request, mint the
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
    // again with fresher headers).
    const captured = (load.captures || []).filter(r => r.headers && !r.echo);
    let entry = null;
    let request = null;
    let bestTs = -1;
    for (const r of captured) {
      const req = lib.amazonSeeMoreRequest([r.body]);
      if (!req) continue;
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
