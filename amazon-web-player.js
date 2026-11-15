// In-app Amazon Music player.
//
// Parachord runs on castlabs Electron, which ships a Widevine CDM. Search
// and playlist import run in a hidden WebContentsView on the main window
// (0×0 when parked, a real size left of the window when in use), so they
// cannot cover the app and there is no extra OS window. Sign-in is the only
// real window — the user has to see Amazon's page to pick a profile.
//
// ── One owner of the partition (docs/architecture/web-session.md) ───────────
// Every piece of web-session machinery here — the hidden view, the webRequest
// capture, the page-world fetch, the load chain, the readers/writer gate,
// the idle-park fuse, the sign-in window, sign-out — lives on ONE
// createWebSessionHost instance (the module-scope `webSession` below). This
// module owns the FLOWS: which URL loads, which request to capture and how to
// patch, replay and parse it, what a wall or a session looks like. It
// composes them over the host's primitives and never registers a webRequest
// listener, creates a view, or takes a navigation outside that instance —
// the partition's single webRequest slot has exactly one owner.
//
// ── Amazon page contract ─────────────────────────────────────────────────────
// Everything in this module scrapes or hooks music.amazon.com (hornet), and
// hornet redeploys continuously. When playback/search breaks, check these
// assumptions first — they are the surfaces most likely to rot. Pure parsers
// live in amazon-music-logic.js (unit-tested); the scripts below serialize
// those functions into the page world.
//
//   URLs            /tracks/{10-char ASIN}, /albums/{ASIN}, /artists/{ASIN},
//                   /playlists/{id} and /my/playlists/{id},
//                   /search/{q}/songs (quoted terms; a loose combined query
//                   misses songs), /tracks/{asin}?do=play is what actually
//                   starts Widevine — a bare page's Play-button click() does not
//   Sign-in walls   every /ap/ page on an account host (signin, 2FA, approval),
//                   /identity/who-is-listening (pageBlocksPlayback)
//   Cookies         at-main|sess-at-main|at-acb; any x-main / at-* / sess-at-*
//                   if Amazon renames them (amazonAuthCookieState, isSignedIn).
//                   A page is never proof of a session: the logged-out home
//                   page is a non-wall music.amazon.com page too
//   Media element   the Widevine <video>; the page also has an empty <audio>
//                   decoy — HOOK_SCRIPT scores elements by paused/currentSrc/
//                   tagName so last-wins cannot latch onto it. The element's
//                   webkitAudioDecodedByteCount (demuxed compressed stream
//                   bytes — a Blink API, not a hornet surface) is what the
//                   poller pairs to measure the delivered bitrate
//   Search          the songs page (/search/<q>/songs) fires SpecSearchSeeMorePage
//                   with the exact searchText from the URL; the request is
//                   captured (URL, headers, APQ hash) and replayed verbatim,
//                   matched on variables.searchText — never the operation
//                   name — and parsed pure; a page that never searches is a
//                   structural failure (not-ready), an empty edges list is a
//                   real miss. (#1356 M5/M6: the track search AND the
//                   album/artist catalog flows moved into
//                   plugins-src/amazonmusic — they drive this same host
//                   instance through the window.electron.webSession bridge;
//                   the spec-search runner that used to live here is deleted.
//                   This module's remaining page flows — playlist import,
//                   recommendations, the diagnostic capture, the session
//                   mint — still ride the same capture-and-replay pattern.)
//   GraphQL         gql.music.amazon.com, persisted query (APQ) whose sha256Hash
//                   renumbers per redeploy — capture the page's own
//                   playlistDetail / SpecSearchSeeMorePage requests and
//                   replay them, never hardcode it
//   Quality store   metro module playbackController (audioQualitySettings),
//                   captured by the window.__r trap in the preload; persisted
//                   fallback under a localStorage key containing
//                   'playback-controller'
//   Stream manifest the DASH MPD + init segments the page itself fetches,
//                   captured by the preload's passive fetch/XHR hook
//                   (installAmazonStreamCapture) and parsed by pure helpers
//                   in amazon-music-logic — packager output, not hornet DOM
//   License refusal  POST /*/api/dmls/ answering 400 = this build's VMP
//                   signature refused (development certificate)

const path = require('path');
const HOME_URL = 'https://music.amazon.com/';
const PARTITION = 'persist:amazon-music';
const PRELOAD = path.join(__dirname, 'amazon-player-preload.js');
const { createWebSessionHost, chromeUserAgent } = require('./main-process/web-session');
const {
  pageBlocksPlayback,
  signInLanded,
  amazonNowPlayingMismatch,
  amazonAuthCookieState,
  cdmStatusHealthy,
  amazonPlaylistIdFromUrl,
  amazonPlaylistDetailRequest,
  makeSpecSearchTemplate,
  specTemplateIsFresh,
  recommendationsFromMusicHome,
  musicHomeBodyWithVars,
  mergeMusicHomeSectionPages,
  recommendationsFromSeeMore,
  amazonMusicHomeRequest,
  seeMoreSectionIdFor,
  amazonSeeMoreRequest,
  amazonSeeMorePageUrl,
  seeMoreBodyWithVars,
  paginatePlaylistTracks,
  amazonGqlFetchHeaders,
  gqlReplayOutcome,
  playlistPartialIsUsable,
  capturedOperationNames,
  isAmazonMusicPage,
  gqlCaptureSubject,
  gqlRequestsIn,
  gqlRequestIsAboutSubject,
  redactGqlSample,
  summarizeGqlRequest
} = require('./amazon-music-logic');

// ONE owner of the partition (see the header): every view, navigation, gate
// entry, capture registration and sign-in window for persist:amazon-music
// flows through this single host instance. The timings this module used to
// carry as constants are the host's defaults (warmMs 30 000, loadTimeoutMs
// 30 000, pageFetchTimeoutMs 12 000) — a flow that ever needs a different
// value passes it explicitly.
const webSession = createWebSessionHost({
  id: 'amazon-music',
  partition: PARTITION,
  preload: PRELOAD,
  userAgent: chromeUserAgent(),
  // The auth-cookie hedge (amazonAuthCookieState over the reported names)
  // reads FEWER cookies than the pre-refactor whole-partition read: the
  // host reads cookies.get({ url }) per declared domain, so a host-only
  // cookie on some other Amazon host, or one scoped to a path other than
  // '/', is no longer seen. The known auth cookies all live on `.amazon.com`
  // (at-main, sess-at-main, x-main); music.amazon.com and www.amazon.com
  // cover the hosts a host-only auth-shaped rotation could land on. state()
  // reports names only; Electron's clear() still wipes the whole partition.
  cookieDomains: ['amazon.com', 'music.amazon.com', 'www.amazon.com'],
  // The EXACT hosts the session's data-source primitives may reach (#1432
  // review, finding 1): fetch/pageFetch URLs, every redirect hop and
  // capture prefixes are scoped to this list, which is deliberately much
  // narrower than the cookie domains — amazon.com is the whole retail
  // account, and a session-bearing fetcher scoped only by the cookie
  // domains would read it. Exactly the hosts the flows call, nothing
  // broader: the home/search/dmls/config.json/telemetry host and the gql
  // host. A new host is added to this list deliberately, one entry per
  // service surface — never by widening a domain or falling back to the
  // cookie domains.
  allowedHosts: ['music.amazon.com', 'gql.music.amazon.com'],
  // The visible sign-in window's title (finding 3: host config, never a
  // caller choice).
  signInTitle: 'Sign in to Amazon Music'
});

function electron() {
  return require('electron');
}

function notReady(reason, message) {
  const err = new Error(message || reason);
  err.reason = reason;
  return err;
}

// lookupPlaylist's capture poll: every PLAYLIST_CAPTURE_POLL_MS while the page
// loads, then up to PLAYLIST_CAPTURE_POLLS_AFTER_LOAD more once it has loaded
// (20s: boot + query is ~2-4s on a cold view). The load itself rides the
// host's loadURLBudgeted (its budget is the host's loadTimeoutMs, 30s).
const PLAYLIST_CAPTURE_POLL_MS = 500;
const PLAYLIST_CAPTURE_POLLS_AFTER_LOAD = 40;

// How long the search view stays on its last Amazon page after a flow
// finishes is the host's idle-park fuse (warmMs, 30s — a gql template replay
// needs an Amazon-origin page world: about:blank has a null origin and can
// neither pass CORS nor attach the session cookies, so the host keeps the
// view warm that long after the last activity, then parks it). A burst of
// searches (a playlist resolve, a page of catalog/image lookups) shares one
// page load instead of paying one per lookup.

// A single template replay is bounded by the host's pageFetch timeout
// (pageFetchTimeoutMs, 12s). The multi-page home walk below additionally
// bounds the WHOLE walk with the same 12s — one slow page must not stretch a
// walk of four into a minute.
const REPLAY_TIMEOUT_MS = 12000;

// How long the parsed home-page sections (getRecommendations) stay fresh in
// the session cache: the Recommendations page refreshes at most hourly, and
// a replay is not free (a stale template costs a page load).
const RECOMMENDATIONS_CACHE_TTL_MS = 30 * 60 * 1000;

// Upper bound on cached see-more expansion pages (one entry per section+cursor
// a user expanded; the map is cleared on signOut).
const SEE_MORE_CACHE_MAX = 40;

// The home-connection walk: the section pages are fetched with firstLimit
// MUSIC_HOME_FIRST_LIMIT (live-verified 2026-11: the server honors it — the
// page's own is 5, and 25/30/50/100 answer HTTP 294), and the walk stops at
// MUSIC_HOME_MAX_PAGES no matter what the cursor says (a pathological
// rotation could keep serving fresh offsets of re-ranked sections forever).
const MUSIC_HOME_FIRST_LIMIT = 20;
const MUSIC_HOME_MAX_PAGES = 4;

// The home pages the recommendations flow reads, in order. The music tab is
// the first choice (no stations or audiobooks mixed in, #1310). A Prime
// account's music tab is refused: its MusicHomePage answers HTTP 294 to the
// page itself as well as to a replay, while the same account's full home
// answers BrowseHomePage with 200, in the same envelope, and walks the same
// way (firstLimit 5/10/20 and the offset cursor; live-verified 2026-11-11,
// #1328). So a 294 on the music tab switches the session to the full home.
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

const amazonWebPlayer = {

  // The one owner of the partition (see the module header): the hidden view,
  // the capture, the chain, the gate, the fuse, the sign-in window and the
  // sign-out all live here. Exposed for the flows, the diagnostics and the
  // machinery tests (the same white-box surface tests/main-process/
  // web-session.test.js uses).
  webSession,

  // The hidden search view (the host's slot). An accessor pair, not a copy:
  // preloadProbe and the flows read it, and the machinery tests drive fake
  // views through it — it is always exactly the host's view.
  get searchView() { return webSession._view; },
  set searchView(view) { webSession._view = view; },

  cookieWarned: false,
  // The captured music-home MusicHomePage request (the recommendations flow
  // — same makeSpecSearchTemplate contract: url + headers + APQ body; the
  // variables are the page's own and never patched). Dropped on any replay
  // error and on signOut. See getRecommendations.
  musicHomeTemplate: null,
  // The captured see-more ROUTE request (RecommenderSeeMorePage): one
  // template serves every section and cursor — replays patch the id/
  // afterCursor variables (seeMoreBodyWithVars). See expandRecommendationSection.
  seeMoreTemplate: null,
  // Session cache of the parsed home-page sections (getRecommendations) —
  // the Recommendations page refreshes hourly at most, and a replay is not
  // free (the template can go stale and cost a page load). Null until the
  // first successful fetch; cleared on signOut.
  recommendationsCache: null,
  // Session cache of see-more expansion pages, keyed `${sectionId}|${afterCursor}`.
  // Bounded (SEE_MORE_CACHE_MAX); cleared on signOut.
  seeMorePages: new Map(),

  // castlabs Electron exposes electron.components. Stock Electron does not,
  // and the old --widevine-cdm-path switch does nothing there. EME probe is
  // the real playback gate; this only answers "does this binary have a CDM".
  cdmAvailable() {
    try {
      const { components } = electron();
      if (!components) return false;
      if (typeof components.status !== 'function') return true;
      // Read the status fields only (cdmStatusHealthy) - substring-matching the
      // whole status JSON used to disable Amazon when an unrelated value
      // mentioned "failed". Unrecognized shapes are optimistic; probeEme is
      // the gate that actually matters.
      return cdmStatusHealthy(components.status() || {});
    } catch {
      return false;
    }
  },

  // The partition's session, through the one owner — the host installs the
  // permission allowlist (['fullscreen'], warn-once per name) on first use.
  session() {
    return webSession.session();
  },

  // Ready means signed in AND a profile has been chosen. A window still on
  // the profile picker or the sign-in page is not ready, even if a cookie
  // from an earlier step is already set. The composition is Amazon's (pure
  // logic over the host's facts: state() → { url, signInUrl, cookieNames }).
  async isSignedIn() {
    const { signInUrl, cookieNames } = await webSession.state();
    const cookies = amazonAuthCookieState(cookieNames);
    if (cookies === 'none') return false;
    // The auth-cookie names are an implementation detail Amazon can rotate.
    // A jar with no known name but another auth-shaped one (x-main, at-*,
    // sess-at-*) is a live session under new names: trust it, and say so
    // once. This hedge used to trust any rendered non-wall music.amazon.com
    // page instead, which Amazon Music's logged-out home page is: the app
    // reported signed in before the user had signed in at all.
    if (cookies === 'rotated' && !this.cookieWarned) {
      this.cookieWarned = true;
      console.warn('[Amazon] no auth cookie matched (at-main|sess-at-main|at-acb) but other Amazon session cookies are set — Amazon may have rotated cookie names');
    }
    // Only the sign-in window's URL is authoritative here. The player and
    // search views keep whatever URL their last navigation left behind — a
    // view that redirected to /ap/signin during an earlier failed search
    // stays there (nothing navigates it until a search/play runs, and those
    // refuse to while this returns false), so consulting them locked the
    // account out right after a successful sign-in. A genuinely dead
    // session is still caught mid-flight: search, lookup and play re-check
    // the URL after every load and throw not-signed-in on a redirect.
    if (signInUrl && pageBlocksPlayback(signInUrl)) return false;
    return true;
  },

  setHost(win) {
    webSession.setHost(win);
  },

  alive(target) {
    return !!(target && target.webContents && !target.webContents.isDestroyed());
  },

  pageOf(view) {
    const wc = view.webContents;
    return {
      webContents: wc,
      isDestroyed: () => !wc || wc.isDestroyed()
    };
  },

  // Search rows do not mount in a 0×0 view (the widget collapses to
  // max-width: 0). Park the search view at a real size but left of the
  // window so it cannot cover Parachord — the host's offscreen layout
  // (OFFSCREEN_BOUNDS in main-process/web-session.js). Do not attach the
  // debugger.
  layoutSearch(view = this.searchView) {
    return webSession.layoutOffscreen(view);
  },

  // Blank the search view when a search is done. The SPA would otherwise
  // keep running at full speed (backgroundThrottling is off), and a view
  // left parked on a sign-in wall poisons sign-in detection for the rest of
  // the session. The host's park gates the blank like every other
  // navigation. Flows no longer call this directly — they scheduleParkSearchView
  // (a fuse long enough for template replays to run) — but a hard park still
  // cancels any pending fuse.
  async parkSearchView() {
    await webSession.park();
  },

  // Arm the delayed park of the search view, warmMs (30s) out (the host's
  // fuse: bounded idle-SPA cost vs one page load per search). Re-arming
  // replaces a pending fuse; the timer is unref'd so it never keeps the app
  // alive.
  scheduleParkSearchView() {
    webSession.schedulePark();
  },

  // New search activity cancels a pending park — the view is about to be
  // used again (a template replay reaching in, or a page flow starting).
  // Without this an older fuse could blank the view mid-flow.
  cancelSearchViewPark() {
    webSession.cancelPark();
  },


  // The hidden search view, through the one owner. The host creates the
  // WebContentsView (the Amazon preload, the UA mask, the session's
  // permission handlers) and keeps it alive on the app window; pageOf keeps
  // the { webContents, isDestroyed } shape the flows read.
  async ensureWindow() {
    return this.pageOf(webSession.ensureView());
  },

  async evalOn(win, script) {
    if (!this.alive(win)) throw new Error('Amazon Music web player window is closed');
    return win.webContents.executeJavaScript(script);
  },

  // Diagnostic for the preload: did the stub/trap/hijack actually run in the
  // live player page? null = no page loaded yet (fresh start, about:blank) or
  // the page could not be read; false on a loaded music.amazon.com page means
  // the preload did not run there — the exact failure mode that hid for weeks
  // behind the localStorage fallback. storeCaptured is opportunistic: it
  // flips true only if the page's own requires route through the global __r —
  // observed false on track pages (2026-10), where the persisted localStorage
  // entry is what quality actually uses. mediaSessionShim is the
  // navigator.mediaSession hijack (embedded-player-kit.js) — on a loaded track
  // page it must be true, or the page's session is driving the OS media
  // surface again.
  // The sandboxed-preload canary. The hornet's trap/store probes are gone
  // with its player; the hijack install is what the preload provably DID.
  async preloadProbe() {
    const view = this.searchView;
    if (!this.alive(view)) return { stub: null };
    let url = '';
    try { url = view.webContents.getURL(); } catch { /* destroyed */ }
    if (!url || url === 'about:blank') return { stub: null };
    try {
      return await this.evalOn(view, `(() => ({
        stub: window.__parachordMediaSessionHijack === true
      }))()`);
    } catch {
      return { stub: null };
    }
  },

  // Sign-in, through the one owner: the host shows the visible window (no
  // preload — it must behave like a normal browser window), loads the page
  // (unbudgeted on purpose: this is the one window the person watches), and
  // ticks once a second with { url, cookieNames, stableTicks } (tracing every
  // page it visits and the cookie names as they appear). The verdict is
  // Amazon's: signInLanded over the tick's facts — positive signal only
  // ("not on a known wall" used to close this window on a logged-out first
  // paint of music.amazon.com/), the cookie one accepted signal, not a
  // requirement (Amazon rotating the cookie names must not leave the window
  // waiting forever; a path off / or a third stable tick stands in for it).
  // lastUrl/stableTicks are maintained here because signInLanded's tick
  // counting (an ok URL resets to 1, a wall to 0) is its own, not the host's.
  async openLogin() {
    let lastUrl = null;
    let stableTicks = 0;
    const { signedIn } = await webSession.signIn(HOME_URL, {
      width: 980,
      height: 760,
      decide: (tick) => {
        const hasCookie = amazonAuthCookieState(tick.cookieNames) !== 'none';
        const verdict = signInLanded({ url: tick.url, lastUrl, stableTicks, hasCookie });
        lastUrl = tick.url;
        stableTicks = verdict.stableTicks;
        return verdict.landed;
      }
    });
    return { success: signedIn, signedIn };
  },

  // Serializes real page navigation: fallback spec searches, playlist
  // imports, album lookups and the diagnostic capture share the one view and
  // the webRequest listener slots, so they run one at a time — the host's
  // chain, two lanes (webSession.enqueue(fn, { lane }), the #1423 semantics
  // living in the host now). A FOREGROUND job starts before every queued
  // BACKGROUND job; FIFO within a lane; a running job is never interrupted.
  // `lane: 'foreground'` is for a job the user is waiting on (a playlist
  // they opened from Recommendations): everything else — artist photos, the
  // recommendations refresh, catalog fallbacks, the session-header mint — is
  // background. Every enqueued job also holds the host's busy count, so the
  // park fuse must not blank the view under a flow it cannot see.
  enqueueSearch(fn, { lane = 'background' } = {}) {
    return webSession.enqueue(fn, { lane });
  },

  // One-shot session-header capture for the native playback engine
  // and the CSRF triplet that ride
  // every Amazon API request. The capture lens is the gql host (the page's
  // specSearch request always carries them), and the trigger page is a
  // search view load of a BENIGN query the caller supplies (the user's own
  // most recent search — it is already in their Amazon history, so the mint
  // adds nothing new). Rides enqueueSearch: webRequest has a single listener
  // slot per method per session, and the chain is what serializes this
  // against an in-flight search's own capture registration.
  async mintSessionHeaders({ query, refresh } = {}) {
    if (!(await this.isSignedIn())) {
      const err = new Error('Sign in to Amazon Music first');
      err.reason = 'not-signed-in';
      throw err;
    }
    // A dmls 400 REQUIRED_COOKIES means THESE headers were rejected. The
    // stored recommendation templates carry the same session headers —
    // reusing one makes the retry fail and the user get a sign-in prompt on
    // a live session. Drop them and mint from a page flow. (The spec-search
    // template that used to shortcut this mint lives in the plugin since the
    // searches moved there — #1356 M5/M6 — so the mint is always its own
    // page flow now.)
    if (refresh) {
      this.musicHomeTemplate = null;
      this.seeMoreTemplate = null;
    }
    return this.enqueueSearch(async () => {
      const win = await this.ensureWindow();
      // The bounds are deliberate, not inherited: the host's ensureView keeps a
      // LIVE view's layout, so without this the mint's load would run at
      // whatever the last flow left — offscreen after a recent flow, 0×0 on a
      // fresh view. A 0×0 view is the one where the search page's own
      // requests never fire (SPAs collapse widgets to max-width: 0), so the
      // mint lays its view out explicitly like every other flow.
      await this.layoutSearch(this.searchView);
      const q = String(query || 'the').slice(0, 120);
      console.log(`[Amazon] session-headers mint: page flow for "${q}"`);
      // The registration is the host's — webRequest has a single listener
      // slot per method per session, and the chain (this whole body rides it)
      // is what serializes the mint against an in-flight search's own capture
      // registration.
      const { captured, detach } = webSession.attachCapture([
        'https://gql.music.amazon.com/*',
        'https://music.amazon.com/api/*',
        'https://music.amazon.com/*/api/*'
      ]);
      try {
        // The page emits PLACEHOLDER csrf values (literally foo/bar) on
        // requests that do not need them — only the real spec-search-class
        // requests carry live ones. A dmls call made with placeholders fails
        // server-side (its "REQUIRED_COOKIES_MISSING" is the bad-csrf
        // symptom, live-verified 2026-10), so keep listening until values
        // that look real arrive.
        const tokenLooksReal = (h) =>
          typeof h['csrf-token'] === 'string' && h['csrf-token'].length >= 20 &&
          /^\d+$/.test(String(h['csrf-rnd'] || '')) && /^\d+$/.test(String(h['csrf-ts'] || ''));
        let loadError = null;
        let headers = null;
        // The writer side of the host's gate, like every other load here
        // (playlist imports, recommendations, the plugin's bridge loads): a
        // real navigation — this one included, which since the searches
        // moved into the plugin (#1356 M5/M6) is the mint's only path —
        // waits out in-flight pageFetch replays rather than tearing their
        // frame mid-fetch, and tells replays arriving meanwhile that a
        // navigation holds the gate. The gate covers the NAVIGATION only
        // (like every other flow here): the capture poll after it runs
        // off-gate, so it never answers replays busy for the whole 10s
        // window.
        const navigation = (async () => {
          await webSession.beginNavigation();
          try {
            await webSession.loadURLBudgeted(win, `https://music.amazon.com/search/${encodeURIComponent(q)}/songs`);
          } catch (error) {
            loadError = error;
          } finally {
            webSession.endNavigation();
          }
        })();
        const scan = () => {
          for (const entry of captured) {
            const h = entry.headers;
            if (h && h['csrf-token'] && tokenLooksReal(h)) {
              headers = {
                csrfToken: h['csrf-token'],
                csrfRnd: h['csrf-rnd'] || null,
                csrfTs: h['csrf-ts'] || null,
                deviceId: h['x-amzn-device-id'] || null
              };
              return;
            }
          }
        };
        for (let i = 0; i < 40 && !headers && !loadError; i++) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          scan();
        }
        await navigation;
        // A long navigation (waiting out in-flight replays, up to the 12s
        // pageFetch budget) can eat the whole poll window before the page
        // even loads — and the page's gql fires ~1-3s after it settles. Poll
        // on: a second bounded window after the navigation.
        for (let i = 0; i < 20 && !headers && !loadError; i++) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          scan();
        }
        // Park on the warm fuse (template replays need an Amazon-origin page
        // world; parkSearchView's immediate blank only happens on real restarts).
        this.scheduleParkSearchView();
        if (!headers || !headers.csrfToken) {
          const err = new Error('session headers: the page fired no captured request');
          err.reason = 'load-failed'; // transient/network — never a sign-in prompt
          throw err;
        }
        console.log('[Amazon] session-headers mint ok');
        return headers;
      } finally {
        detach();
      }
    });
  },

  // Capture gql requests (bodies from onBeforeRequest, headers paired by
  // request id) while a page loads and fires its own queries — the host's
  // registration for the gql host: a registration replaces any previous one
  // (webRequest has a single listener slot per method per session) and the
  // search chain serializes searchTracks and lookupPlaylist, so the two
  // flows never interleave captures. Returns { captured, detach } — detach
  // in a finally so a stale capture does not keep buffering every later
  // page's gql bodies into a dead array (identity-guarded: a superseded
  // registration's detach never clears a newer one's slot). Entries also
  // carry an `echo` flag (true when a pageFetch was in flight as the request
  // was seen — our own replay traffic) and `method`/`at` — extra host facts
  // the flows are free to ignore.
  attachGqlCapture() {
    return webSession.attachCapture(['https://gql.music.amazon.com/*']);
  },

  // Replay a captured gql request from the page world of the search view —
  // the host's pageFetch: the page context supplies the origin, cookies
  // (credentials: 'include') and CORS, and the headers we copied from the
  // request the page itself made; the APQ hash in the body comes from that
  // request too, so it is always current for this hornet deploy. The fetch
  // is bounded by the host's pageFetchTimeoutMs (12s) and never throws —
  // every failure is a recoverable { error }. Returns { parsed } (the full
  // response envelope) or { error } — each flow decides which envelope shape
  // it expects. (`win` is the search view the flow read; the host replays
  // from its own view — kept in the signature because it is always the same
  // view, and the flows and tests speak in its terms.)
  // `options.acceptPartial` opts a flow into HTTP 294 partial answers (see
  // GQL_PARTIAL_STATUS in amazon-music-logic.js): a predicate over the parsed
  // body that says whether the data the flow needs came back. Without it a
  // 294 is a failure with its status, which the home flow relies on.
  // `options.readerHeld` says the caller already holds the host's replay-gate
  // reader for a multi-page walk — pageFetch then skips its own reader (the
  // walk's pages must not come back `busy` under a navigation that is
  // waiting for that same outer reader to drain).
  async replayGql(win, entry, body, options = {}) {
    const replayUrl = entry.url || 'https://gql.music.amazon.com/';
    const headers = amazonGqlFetchHeaders(entry.headers);
    const raw = JSON.stringify(body);
    const replay = await webSession.pageFetch(
      { url: replayUrl, method: 'POST', headers, body: raw },
      { readerHeld: options.readerHeld === true }
    );
    return gqlReplayOutcome(replay, { acceptPartial: options.acceptPartial || null });
  },



  // Import a playlist page (music.amazon.com/playlists/<id>, /my/playlists/<id>
  // or /user-playlists/<id>) via the page's own GraphQL. Hornet fetches the
  // playlist with a persisted query (APQ) whose hash renumbers on every
  // redeploy, so nothing is hardcoded: the playlist page is loaded in the
  // (offscreen) search view, the gql request the page itself makes is captured
  // (URL, headers, APQ hash), and that exact request is replayed from the page
  // world verbatim. The server serves one page per request, so a longer
  // playlist continues via the playlist's own continuation: each response's
  // pageInfo.token (a composite continuation state) passed as the afterCursor
  // variable. Runs on the search chain: lookupPlaylist and searchTracks share
  // the search view, so they must not interleave page loads.
  async lookupPlaylist(rawUrl) {
    if (typeof rawUrl !== 'string' || !/^https:\/\/music\.amazon\.com\//i.test(rawUrl)) {
      throw notReady('not-ready', 'Not an Amazon Music playlist URL');
    }
    const playlistId = amazonPlaylistIdFromUrl(rawUrl);
    if (!playlistId) {
      throw notReady('not-ready', 'Not an Amazon Music playlist URL');
    }
    if (!(await this.isSignedIn())) {
      throw notReady('not-signed-in', 'Sign in and choose an Amazon Music profile');
    }
    return this.enqueueSearch(async () => {
      // A fuse armed by an earlier flow must not blank the view mid-load
      // (belt; the fuse's fire-time busy check is the suspenders).
      this.cancelSearchViewPark();
      const win = await this.ensureWindow();
      const mode = await this.layoutSearch(this.searchView);
      console.log(`[Amazon] playlist lookup mode=${mode} ${rawUrl}`);

      // Capture gql requests (bodies from onBeforeRequest, headers paired by
      // request id) while the page loads and fires playlistDetail itself.
      const { captured, detach } = this.attachGqlCapture();
      try {
        // Don't wait for the whole page to finish loading: the page fires
        // playlistDetail a few seconds in and can keep loading other things
        // long after (did-finish-load waits for every subresource). The poll
        // runs WHILE the page loads and takes the request the moment it is
        // captured; one slow resource used to time the lookup out at 30s
        // with the request already in hand (2026-11-15). The host load's own
        // budget still bounds a page that never fires it: a load that fails
        // or times out before the capture throws its load-failed error, and
        // a load that finishes without it gets the poll window below.
        // The entry must also have its headers (onBeforeSendHeaders fires
        // milliseconds after onBeforeRequest — accepting the body alone
        // races that) before we take it.
        await webSession.beginNavigation();
        let entry = null;
        try {
          const load = { done: false, error: null };
          webSession.loadURLBudgeted(win, rawUrl).then(
            () => { load.done = true; },
            (error) => { load.done = true; load.error = error; }
          );
          for (let afterLoad = 0; afterLoad < PLAYLIST_CAPTURE_POLLS_AFTER_LOAD;) {
            await new Promise(r => setTimeout(r, PLAYLIST_CAPTURE_POLL_MS));
            const href = win.isDestroyed() ? '' : win.webContents.getURL();
            if (pageBlocksPlayback(href)) {
              console.warn(`[Amazon] playlist blocked: ${href}`);
              throw notReady('not-signed-in', 'Choose an Amazon Music profile');
            }
            entry = captured.find(r => r.headers && amazonPlaylistDetailRequest([r.body], playlistId));
            if (entry) {
              if (!load.done) console.log('[Amazon] playlist request captured before the page finished loading; going ahead');
              break;
            }
            if (load.error) throw load.error;
            if (load.done) afterLoad++;
          }
        } finally {
          // A page still loading after the capture is the same document (the
          // SPA already booted and queried), so replays may run on it.
          webSession.endNavigation();
        }
        if (!entry) {
          // The page loaded but never asked for this playlist: deleted, private,
          // not available in the user's territory — or hornet renamed the
          // operation. Log what the page did fire so a rename reads as a rename
          // instead of "every playlist is deleted".
          console.warn(`[Amazon] playlist lookup: page never requested playlistDetail for ${playlistId}; gql operations seen: ${capturedOperationNames(captured.map(c => c.body)).join(', ') || 'none'}`);
          return null;
        }
        const request = amazonPlaylistDetailRequest([entry.body], playlistId);
        if (!request || !request.variables || typeof request.variables !== 'object') {
          throw notReady('lookup-failed', 'Unexpected Amazon playlist query shape');
        }

        // Replay the page's own request, to the URL the page itself used,
        // VERBATIM — the page's own firstLimit (100). Raising firstLimit is
        // useless: the server serves one page per request however high the
        // limit (100 rows observed at firstLimit 500), and the pagination
        // block below follows the playlist's own continuation instead.
        // The playlist-specific gql-error rule stays here: errors are fatal
        // unless data.playlist came back (a null playlist with errors is the
        // deleted/private shape, which surfaces as "Playlist not found").
        const sendPlaylistQuery = async (body) => {
          if (win.isDestroyed()) return { error: 'search view closed' };
          // A community playlist (/user-playlists/) answers 294: complete
          // data.playlist plus an error on a capabilities field we never
          // read. Amazon's own page renders it, so the lookup does too.
          const out = await this.replayGql(win, entry, body, { acceptPartial: playlistPartialIsUsable });
          if (out.error) return { error: out.error };
          if (out.partial) {
            const paths = (Array.isArray(out.parsed.errors) ? out.parsed.errors : [])
              .map(e => (Array.isArray(e && e.path) ? e.path.join('.') : '?'));
            console.log(`[Amazon] playlist partial answer (HTTP 294), using data.playlist; errors at: ${paths.join(', ') || 'none'}`);
          }
          const parsed = out.parsed;
          if (parsed && Array.isArray(parsed.errors) && parsed.errors.length && !(parsed.data && parsed.data.playlist)) {
            return { error: String((parsed.errors[0] || {}).message || 'Amazon playlist query error') };
          }
          return { parsed };
        };
        const pageUrl = win.isDestroyed() ? '' : win.webContents.getURL();
        if (!isAmazonMusicPage(pageUrl)) {
          throw notReady('not-ready', 'Amazon playlist page left music.amazon.com before replay');
        }
        console.log(`[Amazon] playlist replaying playlistDetail via gql`);
        const outcome = await sendPlaylistQuery(request);
        if (outcome.error) throw notReady('lookup-failed', outcome.error);
        // Follow the playlist's own pagination. The loop, its stop conditions
        // and its raw-edge progress checks live in paginatePlaylistTracks
        // (amazon-music-logic.js) where they are unit-tested — the poller
        // pattern. fetchPage replays the page's own request with the token as
        // afterCursor (live-verified 2026-10: the token is the only
        // continuation the server accepts; the Relay-style endCursor is a
        // decoy the server answers with page 1 for).
        const paginated = await paginatePlaylistTracks({
          firstPageData: outcome.parsed && outcome.parsed.data,
          fetchPage: async (token) => {
            if (win.isDestroyed()) return { error: 'search view closed' };
            const page = await sendPlaylistQuery({
              ...request,
              variables: { ...request.variables, afterCursor: token }
            });
            if (page.error) return { error: page.error };
            return { data: page.parsed && page.parsed.data };
          },
          log: (m) => console.log(`[Amazon] playlist ${m}`)
        });
        const playlist = paginated.playlist;
        if (playlist && playlist.trackCount > playlist.tracks.length) {
          // A shortfall is only a truncation when pages were left unfetched
          // (paginated.stop names why). When the server is out of pages
          // ('exhausted'), the missing rows are edges with node:null —
          // delisted tracks the response carries no data for at all; there is
          // nothing to import, and the natural end is not a failure.
          if (paginated.stop === 'exhausted') {
            console.log(`[Amazon] playlist complete: ${playlist.tracks.length} of ${playlist.trackCount} rows are importable (${playlist.trackCount - playlist.tracks.length} unavailable on Amazon)`);
          } else {
            console.warn(`[Amazon] playlist lookup truncated: got ${playlist.tracks.length} of ${playlist.trackCount} tracks (${paginated.stop})`);
          }
        }
        console.log(`[Amazon] playlist lookup returning ${playlist ? playlist.tracks.length : 0} tracks "${playlist ? playlist.name : ''}"`);
        return playlist;
      } finally {
        detach();
        this.scheduleParkSearchView();
      }
    }, { lane: 'foreground' });
  },

  // --- Recommendations (capabilities.recommendations in the plugin) --------
  // Two flows, both the capture-and-replay pattern everything here uses (the
  // APQ hash renumbers per hornet redeploy — never hardcode it):
  //
  //   getRecommendations: the home page's MUSIC tab
  //   (https://music.amazon.com/music — the music-only home; the full home at
  //   / fires BrowseHomePage with stations and audiobooks mixed in) fires
  //   MusicHomePage; capture it, replay verbatim, parse
  //   (recommendationsFromMusicHome). A fresh template (the same
  //   makeSpecSearchTemplate contract: url + headers + APQ body) replays from
  //   the parked view with NO page load — the variables are the page's own.
  //
  //   expandRecommendationSection: the see-more ROUTE
  //   (/browse/music-items/home/recommendation/<strategy>) fires
  //   RecommenderSeeMorePage; a section's first expansion pays the page load,
  //   which mints the see-more template, and every later page (any section,
  //   any cursor) replays it with the id/afterCursor patched
  //   (seeMoreBodyWithVars — the id is seeMoreSectionIdFor(sectionId): the
  //   see-more page prefixes browse-home even onto a music-home strategy) —
  //   one template serves all sections.
  //
  // Both page flows share the search chain (a page load is a real
  // navigation); replays run off it, in parallel. Results are cached per
  // process (the page refreshes at most hourly). NOT plan-gated, like the
  // album catalog and artist images: a Prime account's home page is still
  // its own recommendations, the plan gate stops playback, not discovery.
  // No breaker: recommendations are user-triggered, never on a resolution
  // path, so a structural failure costs one capture window, not a run of
  // them. Signed out: notReady, never cached as anything.
  //
  // The replay-first fast path shared by both flows. Modeled on
  // trySpecReplay (the same gates: replay readers, the park fuse, the wall
  // check, the 12s bound) minus the spec-search breaker. Returns the parse
  // result (an object with envelope true), or null for any template miss —
  // the caller queues the page flow, which re-mints. Structural responses
  // (200 with data but no envelope) drop the template and defer to the page
  // flow, the #1152 rule: only a fresh capture can prove a hornet rename.
  async tryRecommendationReplay({ template, drop, bodyFor, parse, noun }) {
    if (!specTemplateIsFresh(template, Date.now())) return null;
    // Take the host's reader side for the whole replay (a navigation waits it
    // out rather than tearing its frame mid-fetch).
    if (!webSession.tryEnterReplay()) return null;
    try {
      webSession.cancelPark();
      // A replay needs an Amazon-origin page world (cookies, CORS): a parked
      // or never-loaded view means the page flow runs instead.
      const href = webSession.viewUrl();
      if (!href || !isAmazonMusicPage(href)) return null;
      if (pageBlocksPlayback(href)) {
        console.warn(`[Amazon] recommendation replay blocked: ${href}`);
        throw notReady('not-signed-in', 'Choose an Amazon Music profile');
      }
      const body = bodyFor(template.body);
      let outcome;
      try {
        outcome = await this.replayGql(this.searchView, template, body);
      } catch (error) {
        outcome = { error: (error && error.message) || String(error) };
      }
      if (outcome.error) {
        console.warn(`[Amazon] ${noun} template replay failed (${outcome.error}); the page flow will re-capture`);
        drop();
        return null;
      }
      const parsed = parse(outcome.parsed && outcome.parsed.data);
      if (!parsed || parsed.envelope === false) {
        console.warn(`[Amazon] ${noun} template replay was not the expected envelope; dropping the template`);
        drop();
        return null;
      }
      return parsed;
    } finally {
      webSession.exitReplay();
      webSession.schedulePark();
    }
  },

  // The home-page sections for the recommendations provider. Cached per
  // process for RECOMMENDATIONS_CACHE_TTL_MS. The cached result includes the
  // synthesized playlists section (withPlaylistsSection below).
  async getRecommendations() {
    if (!(await this.isSignedIn())) {
      throw notReady('not-signed-in', 'Sign in and choose an Amazon Music profile');
    }
    const cached = this.recommendationsCache;
    if (cached && (Date.now() - cached.fetchedAt) < RECOMMENDATIONS_CACHE_TTL_MS) {
      return cached.sections;
    }
    const fast = await this.tryMusicHomeWalk();
    let sections = null;
    if (fast) {
      sections = fast.sections;
    } else {
      sections = await this.enqueueSearch(async () => {
        // The page flow that ran while we queued may have refreshed the
        // template — one refresh heals every expansion queued behind it.
        const warmed = await this.tryMusicHomeWalk();
        if (warmed) return warmed.sections;
        return this.musicHomePageFlow();
      });
    }
    // Outside the chain (the job above has completed): the home page rotates
    // its sections per load and often does not render the playlists one.
    sections = await this.withPlaylistsSection(sections);
    this.recommendationsCache = { sections, fetchedAt: Date.now() };
    return sections;
  },

  // The home page rotates its sections per load (live-observed 2026-11: four
  // different section sets in four loads) and does not always render a
  // playlists section — but the playlists STRATEGY answers the see-more route
  // regardless (live-verified 20 playlist items, cursor "...20"). Its first
  // page carries the user's mixes ("My Discovery Mix", "My Recent Plays and
  // More") plus curated playlists, all with /playlists/<id> URLs the resolver's
  // lookupPlaylist already handles. So when the home page's sections carry no
  // playlist items, pull the strategy's first page as a "Playlists for You"
  // section, with the route's continuation cursor riding on it (the plugin
  // contract's section.nextCursor) so the page's Load more paginates it.
  // A renamed strategy or a route failure soft-fails: the home page's own
  // sections are unaffected.
  async withPlaylistsSection(sections) {
    const hasPlaylists = (sections || []).some(s => (s.items || []).some(i => i.type === 'playlist'));
    if (hasPlaylists) return sections;
    try {
      const parsed = await this.expandRecommendationSectionParsed(PLAYLISTS_SECTION_ID, null);
      if (parsed && parsed.section && parsed.section.items && parsed.section.items.length) {
        const section = { id: PLAYLISTS_SECTION_ID, title: parsed.section.title || 'Playlists for You', items: parsed.section.items };
        if (parsed.nextCursor) section.nextCursor = parsed.nextCursor;
        console.log(`[Amazon] home recommendations synthesized "${section.title}" (${section.items.length} playlists${section.nextCursor ? ', more available' : ''})`);
        return [...sections, section];
      }
    } catch (error) {
      console.warn('[Amazon] playlists section unavailable:', error && (error.reason ? `${error.reason} ${error.message}` : (error.message || error)));
    }
    return sections;
  },

  // The full section walk over the home connection. The page's own request
  // carries firstLimit 5 — the walk asks for MUSIC_HOME_FIRST_LIMIT per page
  // and follows the connection's OFFSET cursor (pageInfo.token, passed back
  // as the afterCursor variable) until it runs out (hasNextPage false / no
  // token), a page repeats the cursor it was sent (no advance — the same rule
  // the see-more pagination enforces), or the page cap is hit. Sections dedupe
  // by id across pages: the server re-ranks per request, so an offset page can
  // re-serve a section an earlier page already carried. Throws plain Errors
  // for a replay failure and for a non-envelope response — the callers decide
  // which of those is a drop-the-template miss and which is structural.
  //
  // `readerHeld` (the tryMusicHomeWalk caller): the walk runs under ONE outer
  // replay-gate reader, so its pages pass { readerHeld: true } through to
  // pageFetch — a navigation that starts between two pages of the walk is
  // waiting for that same outer reader to drain, and page 2 answering
  // { error: 'busy' } under it would fail the whole walk (and drop the
  // template) for nothing. The chained page flow's walk (homePageFlow) takes
  // no reader of its own, so its pages each take their own.
  async walkMusicHomePages(win, template, { readerHeld = false } = {}) {
    const pages = [];
    let cursor = null;
    for (let i = 0; i < MUSIC_HOME_MAX_PAGES; i++) {
      const body = musicHomeBodyWithVars(template.body, {
        firstLimit: MUSIC_HOME_FIRST_LIMIT,
        afterCursor: cursor
      });
      const outcome = await this.replayGql(win, template, body, { readerHeld });
      if (outcome.error) {
        const err = new Error(outcome.error);
        err.status = outcome.status;
        throw err;
      }
      const page = recommendationsFromMusicHome(outcome.parsed && outcome.parsed.data);
      if (!page.envelope) throw new Error('music home response was not the expected envelope');
      pages.push(page);
      if (!page.nextCursor || page.nextCursor === cursor) break;
      cursor = page.nextCursor;
    }
    return { sections: mergeMusicHomeSectionPages(pages), pages: pages.length };
  },

  // The replay-first fast path for getRecommendations: same gates as
  // tryRecommendationReplay (replay readers, the park fuse, the wall check,
  // the 12s bound) around the whole page walk. Returns the merged sections,
  // or null for any template miss — the caller queues the page flow, which
  // re-mints. A mid-walk failure drops the template and defers to the page
  // flow (the #1152 rule: only a fresh capture can prove a hornet rename).
  async tryMusicHomeWalk() {
    const template = this.musicHomeTemplate;
    if (!specTemplateIsFresh(template, Date.now())) return null;
    // Take the host's reader side around the WHOLE walk (a navigation must
    // never tear the view between two pages of one walk).
    if (!webSession.tryEnterReplay()) return null;
    try {
      webSession.cancelPark();
      // A replay needs an Amazon-origin page world (cookies, CORS): a parked
      // or never-loaded view means the page flow runs instead.
      const href = webSession.viewUrl();
      if (!href || !isAmazonMusicPage(href)) return null;
      if (pageBlocksPlayback(href)) {
        console.warn(`[Amazon] home recommendations replay blocked: ${href}`);
        throw notReady('not-signed-in', 'Choose an Amazon Music profile');
      }
      let timer = null;
      const walked = await Promise.race([
        this.walkMusicHomePages(this.searchView, template, { readerHeld: true }),
        new Promise(resolve => {
          timer = setTimeout(() => resolve({ timeout: true }), REPLAY_TIMEOUT_MS);
          if (typeof timer.unref === 'function') timer.unref();
        })
      ]);
      clearTimeout(timer);
      if (walked && walked.timeout) {
        console.warn(`[Amazon] home recommendations walk exceeded ${REPLAY_TIMEOUT_MS}ms; the page flow will re-capture`);
        this.musicHomeTemplate = null;
        return null;
      }
      console.log(`[Amazon] home recommendations walk returning ${walked.sections.length} sections over ${walked.pages} page(s)`);
      return walked;
    } catch (error) {
      // A signed-out wall is not a template miss: re-throw it exactly like
      // the page flow would, instead of dropping the template and paying a
      // page load to rediscover the wall.
      if (error && error.reason === 'not-signed-in') throw error;
      console.warn(`[Amazon] home recommendations walk failed (${(error && error.message) || error}); the page flow will re-capture`);
      this.musicHomeTemplate = null;
      return null;
    } finally {
      webSession.exitReplay();
      webSession.schedulePark();
    }
  },

  // The chained page flow behind getRecommendations: load the home page's
  // MUSIC tab (the music-only home; the full home at / fires BrowseHomePage
  // with stations and audiobooks mixed in), capture its own MusicHomePage
  // request, mint the template, replay verbatim, parse pure. The mint prefers
  // the capture with the FRESHEST
  // csrf-ts: our own concurrent template replay echoes into the session-wide
  // capture with the same constant variables (the page's request body never
  // changes, so an echo is byte-identical to a fresh request — unlike the
  // spec search, where variables.searchText distinguishes them), and its
  // session-aged headers must not be re-certified as fresh.
  // The page flow over the session's home (AMAZON_HOMES): the music tab, or
  // the full home once the music tab was refused this session. A refusal
  // (HTTP 294) switches and runs the flow once more on the full home.
  async musicHomePageFlow() {
    try {
      return await this.homePageFlow();
    } catch (error) {
      if (error && error.homeRefused && this.musicHomeVariant !== 'browse') {
        console.log(`[Amazon] music home refused (HTTP ${HOME_REFUSED_STATUS}); reading the full home for this session`);
        this.musicHomeVariant = 'browse';
        this.musicHomeTemplate = null;
        return this.homePageFlow();
      }
      throw error;
    }
  },

  async homePageFlow() {
    const home = AMAZON_HOMES[this.musicHomeVariant === 'browse' ? 'browse' : 'music'];
    // A fuse armed by an earlier flow must not blank the view mid-load.
    this.cancelSearchViewPark();
    const win = await this.ensureWindow();
    await this.layoutSearch(this.searchView);
    console.log(`[Amazon] home recommendations: loading ${home.url}`);
    const { captured, detach } = this.attachGqlCapture();
    try {
      await webSession.beginNavigation();
      try {
        await webSession.loadURLBudgeted(win, home.url);
      } finally {
        webSession.endNavigation();
      }
      // Wait for the page's own MusicHomePage request (boot + query is ~1-3s
      // warm; the poll window covers a slow load). The entry must have its
      // headers — onBeforeSendHeaders fires milliseconds after
      // onBeforeRequest, so accepting the body alone races it.
      let entry = null;
      let request = null;
      let bestTs = -1;
      for (let i = 0; i < 60 && !entry; i++) {
        await new Promise(r => setTimeout(r, 250));
        const href = win.isDestroyed() ? '' : win.webContents.getURL();
        if (pageBlocksPlayback(href)) {
          console.warn(`[Amazon] home recommendations blocked: ${href}`);
          throw notReady('not-signed-in', 'Choose an Amazon Music profile');
        }
        for (const r of captured.filter(r => r.headers)) {
          const req = amazonMusicHomeRequest([r.body], home.operationName);
          if (!req) continue;
          const ts = Number(r.headers['csrf-ts'] || r.headers['Csrf-ts']) || 0;
          if (ts >= bestTs) { bestTs = ts; entry = r; request = req; }
        }
      }
      if (!entry || !request) {
        // The page loaded but never ran its recommendations query: a hornet
        // rename (or an SPA failure). Log what it did fire so a rename reads
        // as a rename instead of a silent run of failed loads.
        console.warn(`[Amazon] ${home.url} never fired ${home.operationName}; gql operations seen: ${capturedOperationNames(captured.map(c => c.body)).join(', ') || 'none'}`);
        throw notReady('not-ready', 'Amazon home page never issued its recommendations query');
      }
      const template = makeSpecSearchTemplate({ url: entry.url, headers: entry.headers, body: request, capturedAt: Date.now() });
      if (template) this.musicHomeTemplate = template;
      if (!template) throw notReady('not-ready', 'Amazon home page capture could not build a template');
      // The minted template carries the page's own firstLimit-5 variables —
      // the walk replays it with the bumped firstLimit and the cursor pages.
      try {
        const walked = await this.walkMusicHomePages(win, template);
        console.log(`[Amazon] home recommendations page flow returning ${walked.sections.length} sections over ${walked.pages} page(s)`);
        return walked.sections;
      } catch (error) {
        console.warn('[Amazon] home recommendations walk failed after a fresh capture:', (error && error.message) || error);
        const err = notReady('not-ready', 'Amazon home recommendations response was not the expected shape');
        if (error && error.status === HOME_REFUSED_STATUS) err.homeRefused = true;
        throw err;
      }
    } finally {
      detach();
      this.scheduleParkSearchView();
    }
  },

  // The next page of a titled recommendation section ("Load more"): one page
  // of the see-more route. Cached per section+cursor for the session. Returns
  // the full parsed result ({ section: { title, items }, nextCursor }) — a
  // section the route has nothing for carries a null section (a real
  // nothing-more, not an error). expandRecommendationSection shapes it into the
  // plugin contract; withPlaylistsSection reads the title off it.
  async expandRecommendationSectionParsed(sectionId, afterCursor = null) {
    if (!(await this.isSignedIn())) {
      throw notReady('not-signed-in', 'Sign in and choose an Amazon Music profile');
    }
    // The id the see-more REQUEST carries for this section: the see-more page
    // prefixes browse-home even onto a music-home strategy (seeMoreSectionIdFor),
    // so the echo guard and the replay's id patch key on THIS id, never the
    // section's own uri.
    const seeMoreId = seeMoreSectionIdFor(sectionId);
    if (!seeMoreId) {
      throw notReady('not-ready', 'Not an Amazon recommendation section id');
    }
    const cacheKey = sectionId + '|' + (afterCursor || '');
    const cached = this.seeMorePages.get(cacheKey);
    if (cached) return cached;
    const fast = await this.tryRecommendationReplay({
      template: this.seeMoreTemplate,
      drop: () => { this.seeMoreTemplate = null; },
      bodyFor: (body) => seeMoreBodyWithVars(body, { sectionId: seeMoreId, afterCursor }),
      parse: recommendationsFromSeeMore,
      noun: 'see-more'
    });
    if (fast) {
      this.cacheSeeMorePage(cacheKey, fast);
      return fast;
    }
    // Cold template: the see-more ROUTE (its first page) mints one. Even
    // for a cursor page — the route always answers page 1, but the minted
    // template then replays any section+cursor.
    const first = await this.enqueueSearch(async () => {
      const warmed = await this.tryRecommendationReplay({
        template: this.seeMoreTemplate,
        drop: () => { this.seeMoreTemplate = null; },
        bodyFor: (body) => seeMoreBodyWithVars(body, { sectionId: seeMoreId, afterCursor }),
        parse: recommendationsFromSeeMore,
        noun: 'see-more'
      });
      if (warmed) return warmed;
      return this.seeMorePageFlow(sectionId);
    });
    if (!afterCursor) {
      this.cacheSeeMorePage(cacheKey, first);
      return first;
    }
    // The route answered page 1 while the cursor page was wanted: replay the
    // freshly minted template with the cursor.
    const page = await this.tryRecommendationReplay({
      template: this.seeMoreTemplate,
      drop: () => {},
      bodyFor: (body) => seeMoreBodyWithVars(body, { sectionId: seeMoreId, afterCursor }),
      parse: recommendationsFromSeeMore,
      noun: 'see-more cursor page'
    });
    if (!page) throw notReady('not-ready', 'Amazon see-more replay failed after a fresh capture');
    this.cacheSeeMorePage(cacheKey, page);
    return page;
  },

  // The plugin-contract shape of one expansion page: { items, nextCursor }.
  async expandRecommendationSection(sectionId, afterCursor = null) {
    const parsed = await this.expandRecommendationSectionParsed(sectionId, afterCursor);
    return {
      items: (parsed && parsed.section && parsed.section.items) || [],
      nextCursor: (parsed && parsed.nextCursor) || null
    };
  },

  cacheSeeMorePage(key, page) {
    this.seeMorePages.set(key, page);
    while (this.seeMorePages.size > SEE_MORE_CACHE_MAX) {
      this.seeMorePages.delete(this.seeMorePages.keys().next().value);
    }
  },

  // The chained page flow behind expandRecommendationSection: load the
  // see-more route for the section, capture its own RecommenderSeeMorePage
  // request, mint the template (one serves every section+cursor), replay
  // verbatim, parse pure.
  async seeMorePageFlow(sectionId) {
    const url = amazonSeeMorePageUrl(sectionId);
    // The id the page's own see-more request carries for this section (the
    // browse-home prefix even for a music-home strategy — seeMoreSectionIdFor).
    const seeMoreId = seeMoreSectionIdFor(sectionId);
    if (!url || !seeMoreId) throw notReady('not-ready', 'Not an Amazon recommendation section id');
    // A fuse armed by an earlier flow must not blank the view mid-load.
    this.cancelSearchViewPark();
    const win = await this.ensureWindow();
    await this.layoutSearch(this.searchView);
    console.log(`[Amazon] see-more: loading ${url}`);
    const { captured, detach } = this.attachGqlCapture();
    try {
      await webSession.beginNavigation();
      try {
        await webSession.loadURLBudgeted(win, url);
      } finally {
        webSession.endNavigation();
      }
      let entry = null;
      let request = null;
      let bestTs = -1;
      for (let i = 0; i < 60 && !entry; i++) {
        await new Promise(r => setTimeout(r, 250));
        const href = win.isDestroyed() ? '' : win.webContents.getURL();
        if (pageBlocksPlayback(href)) {
          console.warn(`[Amazon] see-more blocked: ${href}`);
          throw notReady('not-signed-in', 'Choose an Amazon Music profile');
        }
        for (const r of captured.filter(r => r.headers)) {
          const req = amazonSeeMoreRequest([r.body]);
          if (!req) continue;
          // Only THIS section's request: our own concurrent template replay of
          // a DIFFERENT section echoes into the session-wide capture with the
          // same operationName (unlike the spec search, where
          // variables.searchText distinguishes echo from page — a see-more
          // echo differs only in variables.id). Minting or returning it would
          // serve the wrong section's items, session-cached under this key.
          // The comparison id is the SEE-MORE id (browse-home-prefixed), not
          // the section's own uri — a music-home section's page request never
          // carries its own id.
          if (req.variables && req.variables.id && req.variables.id !== seeMoreId) continue;
          const ts = Number(r.headers['csrf-ts'] || r.headers['Csrf-ts']) || 0;
          if (ts >= bestTs) { bestTs = ts; entry = r; request = req; }
        }
      }
      if (!entry || !request) {
        console.warn(`[Amazon] see-more page never fired RecommenderSeeMorePage; gql operations seen: ${capturedOperationNames(captured.map(c => c.body)).join(', ') || 'none'}`);
        throw notReady('not-ready', 'Amazon see-more page never issued its query');
      }
      const template = makeSpecSearchTemplate({ url: entry.url, headers: entry.headers, body: request, capturedAt: Date.now() });
      if (template) this.seeMoreTemplate = template;
      const outcome = await this.replayGql(win, entry, request);
      if (outcome.error) throw notReady('not-ready', outcome.error);
      const parsed = recommendationsFromSeeMore(outcome.parsed && outcome.parsed.data);
      if (!parsed.envelope) {
        console.warn('[Amazon] see-more response was not the expected envelope');
        throw notReady('not-ready', 'Amazon see-more response was not the expected shape');
      }
      console.log(`[Amazon] see-more flow returning ${parsed.section ? parsed.section.items.length : 0} items`);
      return parsed;
    } finally {
      detach();
      this.scheduleParkSearchView();
    }
  },



  // Diagnostic (a developer tool, no UI): load one Amazon Music album page
  // (/albums/<ASIN>) or search page (/search/<text>/<tab>) in the search view
  // and record the gql operations it fires — the diagnostic the plugin's
  // album search and album lookup were built from, since those shapes are
  // only visible from a live signed-in session. Every operation is listed (name, endpoint,
  // redacted variables, header NAMES only: their values carry the session);
  // only the page's own read queries about its subject (gqlRequestIsAboutSubject)
  // are replayed once each, so their response shapes can be read, and those
  // responses are redacted and trimmed (redactGqlSample) before they leave
  // this function. Runs on the search chain like every other page load here.
  async debugCaptureGql(rawUrl) {
    const subject = gqlCaptureSubject(rawUrl);
    if (!subject) {
      throw notReady('not-ready', 'Pass a music.amazon.com album URL (/albums/<ASIN>) or search URL (/search/<text>/<tab>)');
    }
    if (!(await this.isSignedIn())) {
      throw notReady('not-signed-in', 'Sign in and choose an Amazon Music profile');
    }
    return this.enqueueSearch(async () => {
      // A fuse armed by an earlier flow must not blank the view mid-load
      // (belt; the fuse's fire-time busy check is the suspenders).
      this.cancelSearchViewPark();
      const win = await this.ensureWindow();
      await this.layoutSearch(this.searchView);
      const { captured, detach } = this.attachGqlCapture();
      try {
        await webSession.beginNavigation();
        try {
          await webSession.loadURLBudgeted(win, rawUrl);
        } finally {
          webSession.endNavigation();
        }
        // Let the page fire its queries: stop after 3s with nothing new, at
        // most 20s.
        let lastCount = -1;
        let quietTicks = 0;
        for (let i = 0; i < 40 && quietTicks < 6; i++) {
          await new Promise(r => setTimeout(r, 500));
          const href = win.isDestroyed() ? '' : win.webContents.getURL();
          if (pageBlocksPlayback(href)) throw notReady('not-signed-in', 'Choose an Amazon Music profile');
          const count = captured.filter(r => r.headers).length;
          quietTicks = count === lastCount ? quietTicks + 1 : 0;
          lastCount = count;
        }
        const operations = [];
        for (const entry of captured.filter(r => r.headers)) {
          for (const req of gqlRequestsIn(entry.body)) {
            const op = summarizeGqlRequest(entry, req);
            if (gqlRequestIsAboutSubject(req, subject) && !win.isDestroyed()) {
              const out = await this.replayGql(win, entry, req);
              op.replayed = true;
              op.response = out.error ? { error: out.error } : redactGqlSample(out.parsed);
            }
            operations.push(op);
          }
        }
        console.log(`[Amazon] gql capture ${rawUrl}: ${operations.length} operation(s), ${operations.filter(o => o.replayed).length} replayed`);
        return {
          capturedAt: new Date().toISOString(),
          page: rawUrl,
          finalUrl: win.isDestroyed() ? null : win.webContents.getURL(),
          subject,
          operations
        };
      } finally {
        detach();
        this.scheduleParkSearchView();
      }
    });
  },

  // Full sign-out. The partition (persist:amazon-music) is Amazon-only, so a
  // whole-session clear is correctly scoped - no partial cookie-clear guessing
  // like the Apple flow needs. The machinery half is the host's clear(): the
  // views die, the sign-in window closes, the webRequest capture detaches,
  // the chain cuts and the storage clears. The FLOW state below (the captured
  // request templates and the parsed caches of the old account) is this
  // module's to drop.
  async signOut() {
    this.cookieWarned = false;
    // The captured request templates embed the signed-out session's headers
    // and APQ hash — they must not replay into the next account. The parsed
    // recommendations caches carry the old account's content. (The spec-search
    // template is plugin state since the searches moved there — #1356 M5/M6 —
    // and drops on the plugin's own session-generation check.)
    this.musicHomeTemplate = null;
    this.seeMoreTemplate = null;
    this.recommendationsCache = null;
    // The next account may read the music tab (only some plans are refused).
    this.musicHomeVariant = null;
    this.seeMorePages.clear();
    return await webSession.clear();
  },
};

module.exports = amazonWebPlayer;
