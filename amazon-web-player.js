// In-app Amazon Music player.
//
// Parachord runs on castlabs Electron, which ships a Widevine CDM. Search
// and the page flows run in a hidden WebContentsView on the main window
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
//                   real miss. (#1356 M5/M6/M7/M8: the track search, the
//                   album/artist catalog flows, the playlist import AND the
//                   recommendations moved into plugins-src/amazonmusic — they
//                   drive this same host instance through the
//                   window.electron.webSession bridge; the spec-search
//                   runner, the playlist import and the recommendations
//                   flows that used to live here are deleted. This module's
//                   remaining page flows — the diagnostic capture and the
//                   session mint — still ride the same capture-and-replay
//                   pattern.)
//   GraphQL         gql.music.amazon.com, persisted query (APQ) whose sha256Hash
//                   renumbers per redeploy — capture the page's own request
//                   and replay it, never hardcode it
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
  amazonAuthCookieState,
  cdmStatusHealthy,
  amazonGqlFetchHeaders,
  gqlReplayOutcome,
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

// How long the search view stays on its last Amazon page after a flow
// finishes is the host's idle-park fuse (warmMs, 30s — a gql template replay
// needs an Amazon-origin page world: about:blank has a null origin and can
// neither pass CORS nor attach the session cookies, so the host keeps the
// view warm that long after the last activity, then parks it). A burst of
// searches (a playlist resolve, a page of catalog/image lookups) shares one
// page load instead of paying one per lookup.


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

  // Serializes real page navigation: the host's own page flows (the session
  // mint, the diagnostic capture) share the one view and the webRequest
  // listener slots, so they run one at a time — the host's chain, two lanes
  // (webSession.enqueue(fn, { lane }), the #1423 semantics living in the host
  // now). A FOREGROUND job starts before every queued BACKGROUND job; FIFO
  // within a lane; a running job is never interrupted. The host's remaining
  // riders are all background; the plugin's page flows — the spec searches,
  // the album lookups, the playlist import, the recommendations — load through
  // the bridge's webSession:load, which rides the same chain's background
  // lane. Every enqueued job also holds the host's busy count, so the park
  // fuse must not blank the view under a flow it cannot see.
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
    // A dmls 400 REQUIRED_COOKIES calls this with { refresh } — the headers
    // the caller held were rejected. The mint is always its own page flow now
    // (the request templates it could once reuse died with the recommendations
    // move, #1356 M8, and the spec-search template moved with the searches,
    // M5/M6 — the plugin drops its own session-scoped caches on the
    // generation bump a sign-out carries), so `refresh` needs no separate
    // handling here: the page flow always captures fresh headers.
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
        // (the plugin's bridge loads): a
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
  // remaining page flows (the diagnostic capture) never
  // interleave captures on the host's load chain. Returns { captured, detach } —
  // detach in a finally so a stale capture does not keep buffering every later
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
  // the chain cuts and the storage clears — and the clear() bumps the session
  // generation, which is how the plugin (whose request templates and parsed
  // caches are the old account's — the recommendations state since #1356 M8,
  // the spec-search template since M5/M6) learns of the sign-out it cannot
  // see the event of: its next state read drops them.
  async signOut() {
    this.cookieWarned = false;
    return await webSession.clear();
  },
};

module.exports = amazonWebPlayer;
