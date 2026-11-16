// Source of truth for plugins/amazonmusic.axe v1.14.0.
// Imported from the .axe by `node scripts/build-axes.js --import`.
// Edit here, bump manifest.version in manifest.json, then run `node scripts/build-axes.js`.
// The functions materialize fully isolated (resolver-loader.js uses
// new Function) — no shared scope between them; helpers shared across
// functions live in the _lib factory below (evaluated once per resolver
// instance, pure: helpers and constants only — no I/O, no timers, no window;
// per-instance state lives on `this`).
//
// ── The searches and the catalog run in the plugin (#1356 M5/M6) ─────────────
// The spec-search runner family (the SpecSearchSeeMorePage capture-and-replay
// flows: the track search, M5, plus the album search and the artist-image
// lookup, M6) and the album-detail flow (lookupAlbum's candidate-ranking
// replay) are the plugin's: they drive the ONE host web-session instance
// (registered as 'amazon-music') through the window.electron.webSession
// bridge — pageFetch replays the captured request from the page world,
// load(url, {capture}) runs the chained page flow with the capture window
// inside the load (the quiet-bounded returned captures replace the old
// in-flow poll; our own replay traffic arrives as echo-flagged captures and
// is never trusted), and state() supplies the facts the signed-in verdict
// composes — and the session generation whose change (a sign-out the plugin
// cannot see the event of) drops its session-scoped caches. The host-side
// runner that used to serve the album/artist tabs is deleted; every helper
// those flows use lives here (copies of the amazon-music-logic.js originals,
// whose remaining copies serve the playlist import, recommendations and
// dmls until their moves).
module.exports = {
  // ── The plugin library (#1356) ────────────────────────────────────────────
  // Pure helpers and constants, evaluated once per resolver instance and
  // frozen by the loader. Every copy below mirrors its original in
  // amazon-music-logic.js / amazon-web-player.js. The copies whose flows
  // have moved (the track search in #1356 M5; the album search, album
  // lookup and artist images in M6) are now the ONLY copy — the host's died
  // with its flows. The rest still serve the host-side flows that have not
  // moved (playlist import, recommendations, dmls); each copy notes which,
  // and dies when its flow moves in.
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
    // The ALBUM page's own quiet window is deliberately longer: the real
    // album page fires AlbumSeo (header-only) FIRST and the detail op can lag
    // it by more than one gap. The old in-flow poll kept polling to the END
    // of its 20s window while every replay so far was header-only, exactly
    // because a detail op lagging its SEO sibling by more than a poll had
    // produced a bogus miss (the #1135 review — the "0 of 12 tracks"
    // truncation class). The bridge's quiet window replaces that poll, so the
    // shared 2500ms would cut the window 2.5s after the last capture and a
    // slow detail op would read as a header-only miss; 10s past the last
    // capture keeps it inside — sized to the old 20s poll's intent (the gap
    // it existed to cover), still capped by the shared 15s budget above.
    const ALBUM_CAPTURE_QUIET_MS = 10000;

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

    // ── The track mapper (the host copy in amazon-music-logic.js is
    // playlistTrackFromGqlEdge, shared with the playlist import that has not
    // moved; it dies when that flow moves) ──────────────────────────────────

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
      PAGE_CAPTURE_BUDGET_MS, PAGE_CAPTURE_QUIET_MS, ALBUM_CAPTURE_QUIET_MS, ALBUM_JOB_STALE_MS,
      PLAN_TTL_MS, PLAN_UNKNOWN_TTL_MS,
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
      capturedOperationNames,
      amazonGqlFetchHeaders,
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
      amazonNormalizeArtistName,
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
  replayGql: async function (entry, body) {
    const lib = this.requireLib();
    const ws = window.electron && window.electron.webSession;
    if (!ws) return { error: 'Amazon webSession bridge not available' };
    const replayUrl = (entry && entry.url) || lib.GQL_URL;
    const headers = lib.amazonGqlFetchHeaders(entry && entry.headers);
    const raw = JSON.stringify(body);
    const replay = await ws.pageFetch(lib.SESSION, { url: replayUrl, method: 'POST', headers, body: raw });
    if (!replay || !replay.success) return { error: (replay && replay.error) || 'Amazon web-session bridge unavailable' };
    if (replay.error) return { error: String(replay.error) };
    if (replay.status !== 200) return { error: 'Amazon gql query failed (' + replay.status + ')', status: replay.status };
    let parsed = null;
    try { parsed = JSON.parse(replay.text); } catch (e) { /* leave null */ }
    if (!parsed) return { error: 'Amazon gql response was not JSON' };
    if (Array.isArray(parsed.errors) && parsed.errors.length && !parsed.data) {
      return { error: String((parsed.errors[0] || {}).message || 'Amazon gql query error') };
    }
    return { parsed };
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
    // The per-instance page flow chain: the host's load chain serializes the
    // LOADS; this chain serializes the plugin's whole page flows (load + the
    // verbatim replay after it) so one flow's re-minted template heals every
    // search queued behind it, and one flow's replay is never run into the
    // teeth of the next flow's navigation (a pageFetch arriving while a
    // navigation holds the gate answers { error: 'busy' }). The album lookup
    // rides the same chain; the host-side flows that remain (playlist
    // import, recommendations) serialize against the loads on the host's
    // own chain.
    const run = (this._pageFlowChain || Promise.resolve())
      .then(() => {
        if (staleCheck && staleCheck()) {
          console.log('[Amazon] ' + specType + ' search skipped: queued past the ' + lib.ALBUM_JOB_STALE_MS + 'ms budget — the caller already moved on');
          return [];
        }
        return this.specSearchPageFlow({ url, searchText, specType, parse, noun });
      });
    this._pageFlowChain = run.then(() => {}, () => {});
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
    // A busy gate is transient (a concurrent navigation — a host-side playlist
    // import, an album/artist search or the session mint — holds the
    // readers/writer gate between this flow's load and its own replay), not a
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
      // Back off within a ~12s bound: a real navigation (a host-side playlist
      // import or the session mint) can hold the gate for its whole load
      // budget, and the capture already succeeded — the flow is one gate away
      // from its answer.
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
  // load), so the two drops here cover them too.
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
    const run = (this._pageFlowChain || Promise.resolve())
      .then(() => {
        if (Date.now() - queuedAt > lib.ALBUM_JOB_STALE_MS) {
          console.log('[Amazon] album lookup skipped: queued past the ' + lib.ALBUM_JOB_STALE_MS + 'ms catalog budget — the caller already moved on');
          return null;
        }
        return this.lookupAlbumPageFlow(asin);
      });
    this._pageFlowChain = run.then(() => {}, () => {});
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
  // runs over the complete candidate set. The quiet window is the album one
  // (ALBUM_CAPTURE_QUIET_MS), not the shared default: the detail op can lag
  // its SEO sibling by more than the shared 2.5s, and the old poll's rule was
  // to wait it out (#1135 review — a lagging detail op once read as a bogus
  // header-only miss).
  lookupAlbumPageFlow: async function (asin) {
    const lib = this.requireLib();
    const ws = window.electron && window.electron.webSession;
    if (!ws) throw lib.notReady('not-ready', 'Amazon webSession bridge not available');
    const url = 'https://music.amazon.com/albums/' + asin;
    const load = await ws.load(lib.SESSION, url, {
      capture: {
        urlPrefixes: [lib.GQL_URL + '*'],
        quietMs: lib.ALBUM_CAPTURE_QUIET_MS,
        budgetMs: lib.PAGE_CAPTURE_BUDGET_MS
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
      // A busy gate (a concurrent host-side navigation — a playlist import or
      // the session mint holds the readers/writer gate) is transient, not a
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
  lookupPlaylist: async function (url, config) {
    var mapResult = function (p) {
      return {
        id: 'amazonmusic-playlist-' + (p.id || ''),
        name: p.name || 'Amazon Music Playlist',
        owner: p.owner || null,
        albumArt: p.albumArt || null,
        // The bridge reports the playlist's own trackCount; keep it so a
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
    var result = null;
    try {
      if (!window.electron || !window.electron.amazonMusic) {
        console.warn('Amazon Music: bridge not available');
        return null;
      }
      result = await window.electron.amazonMusic.lookupPlaylist(url);
      console.log(
        '[Amazon] resolver playlist lookup',
        url,
        result && result.success,
        result && result.reason,
        result && result.playlist && result.playlist.tracks && result.playlist.tracks.length,
      );
      if (loaded(result)) return mapResult(result.playlist);
      // Only a sign-in problem is fixed by sign-in. load-failed is a network
      // condition and no-cdm is a playback problem - importing needs neither -
      // and prompting for sign-in on either points the user at the wrong fix.
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
          result = await window.electron.amazonMusic.lookupPlaylist(url);
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
      console.error('Amazon Music playlist lookup error:', error);
      return null;
    }
    // Outside the try so the catch does not swallow these.
    // Transient/wiring failures first: a stalled load must not be reported as a
    // missing playlist (or offered a sign-in prompt) - it is a network condition.
    var reason = result && result.reason;
    if (reason === 'load-failed' || reason === 'no-cdm' || reason === 'not-ready') {
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
      throw new Error('Amazon Music playlist import failed: ' + result.error);
    }
    if (result && result.success) {
      throw new Error(
        'Playlist not found on Amazon Music. It may have been deleted or made private.',
      );
    }
    return null;
  },
  // capabilities.recommendations (docs/architecture/plugins.md,
  // "Recommendations"): the home page's "Albums for You" / "Your Frequent
  // Plays" style sections, each item typed by what Amazon sent
  // (docs/architecture/amazon-music.md, "Recommendations"). Miss policy like
  // the album catalog's: not-ready failures throw notReady (never cached as a
  // miss, never a sign-in prompt — the Recommendations page is background),
  // a real miss is empty sections. A host whose bridge predates the
  // capability is a quiet empty provider.
  getRecommendations: async function (config) {
    try {
      if (
        !window.electron ||
        !window.electron.amazonMusic ||
        typeof window.electron.amazonMusic.getRecommendations !== 'function'
      ) {
        return { sections: [] };
      }
      var result = await window.electron.amazonMusic.getRecommendations();
      if (!result || !result.success) {
        var reason = result && result.reason;
        if (reason) {
          // A readiness failure (or any unmapped failure — the page must never
          // cache a failure as a miss) is notReady, never a quiet miss.
          var err = new Error('Amazon Music not ready');
          err.notReady = true;
          err.code = reason;
          throw err;
        }
        return { sections: [] };
      }
      // Every shelf but "Featured This Week" (a promo), each filed under one
      // of the Recommendations page's categories. Amazon's personal shelves
      // are named strategies ("…mp3YmlRecentPlaybackStrategy",
      // "…playlistStrategy"); its editorial ones ("Top Playlists", "A Whole
      // Mood", "On-Demand Albums This Week", "Amazon Music Live", "Recently
      // Played") carry UUID ids, the onboarding shelf is GET_STARTED, and the
      // genre shelf ("Soundtracks") is a strategy but a promo. Live-captured
      // 2026-11-12. The UUID shelves have no other mark, so the two that need
      // telling apart ("Featured This Week", "Recently Played") go by title.
      var strategyName = function (id) {
        return String(id || '').split('/').pop().replace(/^(browse|music)-home_/, '');
      };
      var isStrategy = function (id) {
        return /Strategy$/.test(strategyName(id));
      };
      var isFeatured = function (s) {
        return /^\s*featured\b/i.test(String((s && s.title) || ''));
      };
      // The category the Recommendations page files a section under (its
      // albums and playlists; songs and artists have no categories). A
      // strategy it doesn't know sends none, so the page files it under
      // "More …"; a shelf that isn't a strategy is Amazon's editors' pick.
      var STRATEGY_CATEGORIES = {
        playlistStrategy: 'personal',
        mp3YmlRecentPlaybackStrategy: 'personal',
        mp3PrimeAlbumsStrategy: 'personal',
        mp3YourHeaviestListeningStrategy: 'personal',
        newReleasesForYouStrategy: 'new',
        mp3ByArtistStrategy: 'artist',
        mp3CommunityPlaylistsStrategy: 'community',
        mp3GenreForYouStrategy: 'editorial'
      };
      var categoryOf = function (s) {
        if (isStrategy(s.id)) {
          var last = strategyName(s.id);
          return Object.prototype.hasOwnProperty.call(STRATEGY_CATEGORIES, last) ? STRATEGY_CATEGORIES[last] : undefined;
        }
        if (/^\s*recently played\s*$/i.test(String(s.title || ''))) return 'personal';
        return 'editorial';
      };
      // The artist a "by artist" shelf is seeded on: the one artist every
      // album shares (trimmed, case-insensitive, first spelling). Never read
      // from the shelf title.
      var seedArtistOf = function (items) {
        var seed = null;
        for (var i = 0; i < items.length; i++) {
          var a = items[i] && typeof items[i].artist === 'string' ? items[i].artist.trim() : '';
          if (!a) return undefined;
          if (seed === null) seed = a;
          else if (seed.toLowerCase() !== a.toLowerCase()) return undefined;
        }
        return seed === null ? undefined : seed;
      };
      var sections = (result.sections || []).filter(function (s) {
        return s && Array.isArray(s.items) && s.items.length > 0 && !isFeatured(s);
      }).map(function (s) {
        // The bridge's synthesized "Playlists for You" section carries its
        // first page's continuation cursor — pass it through so the page's
        // first "Load more" starts from it.
        var category = categoryOf(s);
        var out = s;
        if (s.nextCursor != null) {
          out = { id: s.id, title: s.title, description: s.description, items: s.items, nextCursor: String(s.nextCursor) };
        }
        if (category) out = Object.assign({}, out, { category: category });
        if (category === 'artist') {
          var seedArtist = seedArtistOf(s.items);
          if (seedArtist) out = Object.assign({}, out, { seedArtist: seedArtist });
        }
        return out;
      });
      console.log(
        '[Amazon] resolver recommendations',
        sections.length,
        'sections,',
        sections.reduce(function (n, s) {
          return n + s.items.length;
        }, 0),
        'items',
      );
      return { sections: sections };
    } catch (error) {
      if (error && error.notReady) throw error;
      console.error('Amazon Music recommendations error:', error);
      return { sections: [] };
    }
  },
  // The "Load more" of a titled section (the see-more route, paginated by
  // the offset cursor the bridge returns). Same miss policy as
  // getRecommendations; an exhausted section answers no items and no cursor,
  // which the page renders as the end of the section.
  expandRecommendationSection: async function (sectionId, afterCursor, config) {
    try {
      if (
        !window.electron ||
        !window.electron.amazonMusic ||
        typeof window.electron.amazonMusic.expandRecommendationSection !== 'function'
      ) {
        return { items: [], nextCursor: null };
      }
      var id = (sectionId || '').trim();
      if (!id) return { items: [], nextCursor: null };
      // Only a strategy shelf has a see-more page (the route is keyed on the
      // strategy name). The editorial shelves (UUID ids, GET_STARTED) show
      // what the home page sent, so their "Load more" is at its end at once,
      // instead of loading a page that isn't there in the hidden view.
      if (!/Strategy$/.test(id.split('?')[0].split('/').pop())) return { items: [], nextCursor: null };
      var result = await window.electron.amazonMusic.expandRecommendationSection(id, afterCursor || null);
      if (!result || !result.success) {
        var reason = result && result.reason;
        if (reason) {
          var err = new Error('Amazon Music not ready');
          err.notReady = true;
          err.code = reason;
          throw err;
        }
        return { items: [], nextCursor: null };
      }
      var items = (result.items || []).filter(function (i) {
        return i && (i.name || i.title);
      });
      return { items: items, nextCursor: result.nextCursor || null };
    } catch (error) {
      if (error && error.notReady) throw error;
      console.error('Amazon Music recommendations see-more error:', error);
      return { items: [], nextCursor: null };
    }
  },
};
