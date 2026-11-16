// Source of truth for plugins/amazonmusic.axe v1.13.0.
// Imported from the .axe by `node scripts/build-axes.js --import`.
// Edit here, bump manifest.version in manifest.json, then run `node scripts/build-axes.js`.
// The functions materialize fully isolated (resolver-loader.js uses
// new Function) — no shared scope between them; helpers shared across
// functions live in the _lib factory below (evaluated once per resolver
// instance, pure: helpers and constants only — no I/O, no timers, no window;
// per-instance state lives on `this`).
//
// ── The track search runs in the plugin (#1356 M5) ───────────────────────────
// The spec-search runner (the songs-tab SpecSearchSeeMorePage capture-and-
// replay flow that used to live in amazon-web-player.js) is the plugin's: it
// drives the ONE host web-session instance (registered as 'amazon-music')
// through the window.electron.webSession bridge — pageFetch replays the
// captured request from the page world, load(url, {capture}) runs the chained
// page flow with the capture window inside the load (the quiet-bounded
// returned captures replace the old in-flow poll; our own replay traffic
// arrives as echo-flagged captures and is never trusted), and state()
// supplies the facts the signed-in verdict composes. The album/artist spec
// searches still run host-side (their milestone hasn't come): they drive the
// same host instance through amazon-web-player.js's copy of the runner, and
// the matchers agree because they are copies of the same pure helpers in
// amazon-music-logic.js.
module.exports = {
  // ── The plugin library (#1356) ────────────────────────────────────────────
  // Pure helpers and constants, evaluated once per resolver instance and
  // frozen by the loader. Every copy below mirrors its original in
  // amazon-music-logic.js / amazon-web-player.js, whose copies still serve
  // the host-side flows that have not moved yet (album/artist search,
  // playlist import, recommendations, dmls); each copy notes which. The
  // copies die one by one as those flows move in.
  _lib: function () {
    // The session this plugin drives — the id main.js registered the ONE
    // host instance under (registerWebSession('amazon-music', …)). The
    // plugin owns the knowledge of which session it drives.
    const SESSION = 'amazon-music';
    const GQL_URL = 'https://gql.music.amazon.com/';
    const CONFIG_URL = 'https://music.amazon.com/config.json';

    // The page flow's capture window: the bridge's load returns its
    // captures once the page's request burst goes quiet (quietMs, the host's
    // default), never later than this budget after the load finishes — the
    // same 15s window the old in-flow poll (60 × 250ms) allowed a slow page.
    const PAGE_CAPTURE_BUDGET_MS = 15000;

    // #1220: the plan is read from config.json and cached 30 min (1 min when
    // unknown), the same TTLs the host's dmls gate uses.
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
      const quote = (value) => '"' + String(value || '').replace(/"/g, '').trim() + '"';
      let q = '';
      if ((title && String(title).trim()) || (artist && String(artist).trim())) {
        const titlePart = title && String(title).trim() ? quote(title) : '';
        const artistPart = artist && String(artist).trim() ? quote(artist) : '';
        q = titlePart && artistPart
          ? titlePart + ' by ' + artistPart + ' OR ' + titlePart + ' ' + artistPart + ' OR ' + artistPart + ' ' + titlePart
          : titlePart || artistPart;
      } else {
        q = String(query || '').trim();
      }
      if (!q) return null;
      return { url: 'https://music.amazon.com/search/' + encodeURIComponent(q) + '/songs', searchText: q };
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
      PAGE_CAPTURE_BUDGET_MS, PLAN_TTL_MS, PLAN_UNKNOWN_TTL_MS,
      notReady,
      pageBlocksPlayback,
      amazonAuthCookieState,
      isAmazonMusicPage,
      amazonSongSearchUrl,
      amazonSpecSearchRequest,
      makeSpecSearchTemplate,
      specTemplateIsFresh,
      specBodyWithVars,
      createSearchBreaker,
      capturedOperationNames,
      amazonGqlFetchHeaders,
      searchTracksFromGql,
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
      throw new Error('Amazon Music needs a newer Parachord — please update the app.');
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

  // The shared runner for the spec searches. The fast path first; any
  // template miss falls to the chained page flow, whose capture re-mints the
  // template — the fallback IS the old flow, so the failure semantics never
  // change. Only real page navigation is serialized (the per-instance page
  // flow chain below + the host's load chain); replays run in parallel.
  specSearch: async function ({ url, searchText, specType, parse, noun }) {
    const lib = this.requireLib();
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
    // navigation holds the gate answers { error: 'busy' }). Host-side flows
    // (the album/artist searches that have not moved) serialize against the
    // loads on the same host chain.
    const run = (this._pageFlowChain || Promise.resolve())
      .then(() => this.specSearchPageFlow({ url, searchText, specType, parse, noun }));
    this._pageFlowChain = run.then(() => {}, () => {});
    return run;
  },

  // specSearch's fast path: replay the cached request with fresh variables
  // from the warm view. Returns the parsed rows, or null for any template
  // miss (the caller then runs the page flow, which re-mints the template).
  // Throws not-signed-in on a wall URL, exactly like the page flow. A
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
    const ws = window.electron && window.electron.webSession;
    if (!ws) return null;
    const template = this._specSearchTemplate;
    if (!lib.specTemplateIsFresh(template, Date.now())) return null;
    // A replay needs an Amazon-origin page world (cookies, CORS): a parked
    // or never-loaded view means the page flow runs instead, and a wall URL
    // means the session died mid-flight (the same URL re-check every load
    // does).
    const state = await ws.state(lib.SESSION);
    if (!state || !state.success) return null;
    const href = state.url;
    if (!href || !lib.isAmazonMusicPage(href)) return null;
    if (lib.pageBlocksPlayback(href)) {
      console.warn('[Amazon] ' + specType + ' replay blocked: ' + href);
      throw lib.notReady('not-signed-in', 'Choose an Amazon Music profile');
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
  // goes quiet — never later than PAGE_CAPTURE_BUDGET_MS, the old in-flow
  // poll's 15s window.
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
      capture: { urlPrefixes: [lib.GQL_URL + '*'], budgetMs: lib.PAGE_CAPTURE_BUDGET_MS }
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
      // evidence. Echoes are OUR replay traffic (this plugin's, or the
      // host-side album/artist runner's): reading one as "the page searched
      // another spec" is exactly the #1152 poisoning, so an echoed candidate
      // degrades the diagnosis to "never searched".
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
    const entry = captured.find(r => lib.amazonSpecSearchRequest([r.body], searchText, { spec: specType }));

    // Replay the page's own request verbatim. (Capturing the page's own
    // response in the page world instead — the stream-capture pattern —
    // does NOT work here: hornet binds its fetch at module init, before
    // any preload-injected wrapper can install, so the page's own search
    // bypasses the wrapper. The replay's cost is one request on top of the
    // ~9 ops the page load itself fires.)
    // Mint BEFORE this flow's own replay runs: the template captures the
    // page's own fresh request, which is valid whether or not the replay
    // that follows answers well — a later replay error drops it again
    // anyway. Never mint from OUR OWN echo (echo: true): the echoed capture
    // is a replay of some template, and minting from it would re-store
    // session-aged headers with a fresh capturedAt, keeping a stale header
    // set certified-fresh indefinitely (#1152 — bodyMatchesTemplate in the
    // host copy guarded this by comparing bytes; the bridge's echo flag
    // says it outright). The skip applies only while the existing template
    // is fresh: a stale template is exactly what the page flow is healing,
    // so a real page capture always re-mints.
    const agedTemplate = !lib.specTemplateIsFresh(this._specSearchTemplate, Date.now());
    if (!agedTemplate && entry.echo) {
      console.log('[Amazon] search matched our own replay in the capture; keeping the existing template');
    } else {
      const template = lib.makeSpecSearchTemplate({ url: entry.url, headers: entry.headers, body: request, capturedAt: Date.now() });
      if (template) this._specSearchTemplate = template;
      else console.warn('[Amazon] spec search captured a request that is not template-shaped; staying page-load-per-search');
    }
    const outcome = await this.replayGql(entry, request);
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

  // ── The signed-in verdict ──────────────────────────────────────────────────
  // The plugin's composition of the host's facts (webSession.state() →
  // { url, signInUrl, cookieNames }) with Amazon's pure predicates — the
  // same composition amazon-web-player.js's isSignedIn runs for the host's
  // flows. Ready means signed in AND a profile chosen (a window still on the
  // profile picker is not ready, even with a cookie set); a page is never
  // proof of a session, and only the sign-in window's URL is authoritative
  // (the hidden view keeps whatever URL its last navigation left behind).
  isSignedIn: async function () {
    const lib = this.requireLib();
    const ws = window.electron && window.electron.webSession;
    if (!ws) return false;
    const state = await ws.state(lib.SESSION);
    if (!state || !state.success) return false;
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
  // fetch), mapped by amazonPlanFromTier, cached 30 min (1 min when unknown —
  // a refused read is retried soon) and unknown BLOCKS (a format change on
  // Amazon's side must show up as a message, not as plays the plan may not
  // cover). Search checks it only when signed in — a signed-out search must
  // still answer not-signed-in, the sign-in prompt — and before searching.
  getPlan: async function () {
    const lib = this.requireLib();
    const ws = window.electron && window.electron.webSession;
    if (!ws) return 'unknown';
    const now = Date.now();
    const s = this._planState;
    if (s) {
      const ttl = s.plan === 'unknown' ? lib.PLAN_UNKNOWN_TTL_MS : lib.PLAN_TTL_MS;
      if (now - s.at < ttl) return s.plan;
    }
    if (this._planPromise) return this._planPromise;
    this._planPromise = (async () => {
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
      this._planState = { plan, at: Date.now() };
      return plan;
    })();
    try {
      return await this._planPromise;
    } finally {
      this._planPromise = null;
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
      console.error('Amazon Music search error:', error);
      return [];
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
  // capabilities.albumSearch (docs/architecture/plugins.md, "searchAlbums"):
  // the album-page catalog fallback. searchAlbums finds an album by
  // artist+title or free text over the albums tab of Amazon's spec search;
  // lookupAlbum loads what searchAlbums returned (the host calls it on this
  // plugin) by replaying the album page's own AlbumDetailPage gql request.
  // Both still ride the host's runner through the amazonMusic IPC bridge
  // (their move into the plugin is a later #1356 milestone); the track
  // search above is the first flow that moved.
  searchAlbums: async function (query, config) {
    try {
      if (!window.electron || !window.electron.amazonMusic) {
        console.warn('Amazon Music: bridge not available');
        return [];
      }
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
      const result = await window.electron.amazonMusic.searchAlbums(payload);
      console.log(
        '[Amazon] resolver album search',
        payload,
        result && result.success,
        result && result.reason,
        result && result.albums && result.albums.length,
      );
      if (!result || !result.success) {
        var reason = result && result.reason;
        if (
          reason === 'not-ready' ||
          reason === 'not-signed-in' ||
          reason === 'no-cdm' ||
          reason === 'load-failed'
        ) {
          var err = new Error('Amazon Music not ready');
          err.notReady = true;
          err.code = reason;
          throw err;
        }
        return [];
      }
      return (result.albums || []).map(function (a) {
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
      console.error('Amazon Music album search error:', error);
      return [];
    }
  },
  // capabilities.artistImage (docs/architecture/plugins.md,
  // "searchArtistImage"): a photo of an artist by name, from the artists tab
  // of the same spec search the track and album searches use
  // (docs/architecture/amazon-music.md). The bridge returns the photo URL or
  // null: not signed in is null WITHOUT a request — the artist-image chain
  // just asks the next source (Deezer needs no account) — a miss is null,
  // and the exact-name check happens main-side, so a wrong artist's photo
  // can never reach the persisted image cache. A host whose bridge predates
  // this capability is a quiet no-op.
  searchArtistImage: async function (artistName, config) {
    try {
      if (
        !window.electron ||
        !window.electron.amazonMusic ||
        typeof window.electron.amazonMusic.searchArtistImage !== 'function'
      ) {
        return null;
      }
      var name = (artistName || '').trim();
      if (name.length < 2) return null;
      var result = await window.electron.amazonMusic.searchArtistImage(name);
      console.log(
        '[Amazon] resolver artist image',
        name,
        result && result.success ? 'ok' : result && result.reason,
        result && result.imageUrl ? 'hit' : 'miss',
      );
      if (!result || !result.success || !result.imageUrl) return null;
      var url = result.imageUrl;
      // The bridge only returns credential-free https CDN URLs, but this URL
      // is persisted in the image cache — check before trusting.
      if (typeof url !== 'string' || !/^https:\/\//i.test(url) || url.indexOf('?') !== -1) return null;
      return url;
    } catch (error) {
      console.error('Amazon Music artist image error:', error);
      return null;
    }
  },
  lookupAlbum: async function (url, config) {
    var mapAlbum = function (a) {
      return {
        id: 'amazonmusic-album-' + a.asin,
        name: a.name,
        artist: a.artist || null,
        albumArt: a.albumArt || null,
        releaseDate: a.releaseDate || null,
        // The bridge reports the album's own trackCount; keep it so a
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
    var result = null;
    try {
      if (!window.electron || !window.electron.amazonMusic) {
        console.warn('Amazon Music: bridge not available');
        return null;
      }
      result = await window.electron.amazonMusic.lookupAlbum(url);
      console.log(
        '[Amazon] resolver album lookup',
        url,
        result && result.success,
        result && result.reason,
        result && result.album && result.album.tracks && result.album.tracks.length,
      );
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
          result = await window.electron.amazonMusic.lookupAlbum(url);
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
      reason === 'lookup-failed'
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
