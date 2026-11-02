// In-app Amazon Music player.
//
// Parachord runs on castlabs Electron, which ships a Widevine CDM. Playback
// and search are WebContentsViews on the main window with 0×0 bounds, so
// they cannot cover the app and there is no extra OS window. Sign-in is the
// only real window — the user has to see Amazon's page to pick a profile.
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
//                   name — and parsed pure (searchTracksFromGql); a page that
//                   never searches is a structural failure (not-ready), an
//                   empty edges list is a real miss
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
const {
  pageBlocksPlayback,
  signInLanded,
  amazonNowPlayingMismatch,
  amazonAuthCookieState,
  cdmStatusHealthy,
  amazonSongSearchUrl,
  amazonPlaylistIdFromUrl,
  amazonPlaylistDetailRequest,
  amazonSpecSearchRequest,
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
  searchTracksFromGql,
  searchAlbumsFromGql,
  amazonArtistSearchUrl,
  searchArtistImageFromGql,
  albumDetailFromGql,
  createSearchBreaker,
  paginatePlaylistTracks,
  amazonGqlFetchHeaders,
  capturedOperationNames,
  isAmazonMusicPage,
  gqlCaptureSubject,
  gqlRequestsIn,
  gqlRequestIsAboutSubject,
  redactGqlSample,
  summarizeGqlRequest
} = require('./amazon-music-logic');

// Replay fetch, evaluated in the page world of the search view. The page
// context supplies cookies (credentials: 'include') and the headers we copied
// from the request the page itself made (x-api-key, csrf-*, music-territory,
// x-amzn-*); the APQ hash in the body comes from that request too, so it is
// always current for this hornet deploy. The body is replayed VERBATIM —
// playlist pages and the songs search page both fire their own request for
// exactly what we asked, so there is nothing to rewrite.
const GQL_FETCH_SCRIPT = (url, headers, body) => `(async () => {
  try {
    const r = await fetch(${JSON.stringify(url)}, {
      method: 'POST',
      credentials: 'include',
      headers: ${JSON.stringify(headers)},
      body: ${JSON.stringify(body)}
    });
    return { status: r.status, text: await r.text() };
  } catch (e) {
    return { error: String(e && (e.message || e)) };
  }
})()`;

function electron() {
  return require('electron');
}

function chromeUserAgent() {
  const chrome = (process.versions && process.versions.chrome) || '131.0.0.0';
  const platform = process.platform === 'win32'
    ? 'Windows NT 10.0; Win64; x64'
    : process.platform === 'linux'
      ? 'X11; Linux x86_64'
      : 'Macintosh; Intel Mac OS X 10_15_7';
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
}

function notReady(reason, message) {
  const err = new Error(message || reason);
  err.reason = reason;
  return err;
}

// loadURL resolves on did-finish-load, which on a stalled network can hang for
// the Chromium network-stack timeout (minutes). Every other step in this module
// is budgeted (search 16×400ms, play 20×400ms, playlist 40×500ms); the loads
// themselves are the one unbounded wait — and searchTracks and lookupPlaylist
// share enqueueSearch, so one hung page wedges both surfaces and queues every
// later search behind it. Race the load: the loser keeps loading in the
// renderer (the next loadURL aborts it, or the failure paths blank it), we
// just stop waiting. A load that fails this way is transient (offline, captive
// portal, stall), so it throws notReady('load-failed') — NOT an empty result,
// which the resolver would cache as a 30-day noMatch.
const LOAD_URL_TIMEOUT_MS = 30000;

// The album catalog fallback on the renderer bounds each catalog step
// (withCatalogTimeout / CATALOG_STEP_TIMEOUT_MS in src/renderer/app.js), and
// getArtistImage bounds each chain step the same way
// (ARTIST_IMAGE_STEP_TIMEOUT_MS in src/renderer/lib/artist-image-chain.js —
// a Home or Search page can ask for 5-20 artist photos at once). An album or
// artist-image job that waits behind the shared Amazon search chain longer
// than that budget has a caller that already moved on: skip its page load
// and return the miss, so track resolution and playlist imports are not
// starved behind catalog/image jobs during a MusicBrainz outage. Mirrors
// the host budget on purpose — the web player cannot read the renderer
// constant.
const ALBUM_JOB_STALE_MS = 8000;

// How long the search view stays on its last Amazon page after a flow
// finishes. A gql template replay needs an Amazon-origin page world —
// about:blank has a null origin and can neither pass CORS nor attach the
// session cookies — so once a capture has minted a request template, later
// searches replay from this still-warm view instead of loading a page each.
// parkSearchView still runs, just on this fuse: the idle-SPA cost it was
// built to kill (backgroundThrottling is off) is bounded to the window,
// while a burst of searches (a playlist resolve, a page of catalog/image
// lookups) shares one page load instead of paying one per lookup.
const SEARCH_VIEW_WARM_MS = 30000;

// A template replay with no answer by now is abandoned (and the page flow's
// navigation never waits longer for readers to drain — readers are bounded
// by this timeout, so the writer's drain wait is too).
const REPLAY_TIMEOUT_MS = 12000;

// How long quality reads/writes wait for the __r trap to capture the live
// playbackController store. Live observation (2026-10, hornet 1.18x):
// storeCaptured stays false on track pages — hornet's factories appear to use
// a closure-scoped require, or the store materializes after require time — so
// this wait mostly times out. The persisted playback-controller localStorage
// entry is the working mechanism (hornet rehydrates from it at boot, i.e.
// "applies on the next track"); the live-store write is an opportunistic
// upgrade if a hornet deploy ever routes requires through the global __r.
// Keep this short so the settings panel does not spin on a first read.
async function loadURLBudgeted(page, url, timeoutMs = LOAD_URL_TIMEOUT_MS) {
  const loaded = page.loadURL(url);
  loaded.catch(() => {}); // a late rejection after the race lost must not be unhandled
  let timer = null;
  try {
    await Promise.race([
      loaded,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(notReady('load-failed', `Amazon Music page did not finish loading within ${timeoutMs}ms: ${url}`)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const amazonWebPlayer = {

  searchView: null,
  authWindow: null,
  host: null,
  searchChain: Promise.resolve(),

  cookieWarned: false,
  // Circuit breaker for search's structural failures — a hornet rename of the
  // search operation makes every search burn the full capture window before
  // failing not-ready, serially on the search chain (starving playlist
  // imports too). After consecutive structural failures this opens and
  // searchTracks fails fast for a cooldown (createSearchBreaker in
  // amazon-music-logic.js, unit-tested there).
  searchBreaker: createSearchBreaker(),
  // The captured spec-search request the replay-first fast path patches and
  // replays (makeSpecSearchTemplate / specBodyWithVars in
  // amazon-music-logic.js). Minted by every page-flow capture, dropped on
  // any replay error (a stale APQ hash or rotated session headers) and on
  // signOut. See specSearch.
  specSearchTemplate: null,
  // The delayed parkSearchView fuse (SEARCH_VIEW_WARM_MS) — canceled by new
  // search activity, re-armed at its end.
  searchViewParkTimer: null,
  // Reader/writer gate over the search view: template replays run in
  // parallel; a page load (the writer) waits out in-flight replays
  // (createReplayGate in amazon-music-logic.js, unit-tested).
  replayGate: createReplayGate(),
  // How many flows currently use the search view: every chained page flow
  // (incremented in enqueueSearch) plus every in-flight template replay.
  // The park fuse consults it at FIRE time — a fuse armed by flow A never
  // blanks the view under flow B (or under a 40s playlist import whose
  // pagination is replay-only), it re-arms while busy. Cancel-at-entry is
  // belt; the fire-time check is the suspenders.
  searchViewBusy: 0,
  // Monotone counter bumped on every template-replay entry. A page flow
  // reads it at start: replay traffic that overlaps its capture poll can
  // masquerade as the page's own other-spec request and poison the grace
  // fast-fail, so a changed mark degrades the grace to the full window
  // instead of a structural miss (see specSearchPageFlow).
  replayActivity: 0,
  _onHostClosed: null,
  // Audio representations parsed from the captured DASH manifest (+ init
  // segment STREAMINFO), scoped to the current play: nulled when a play
  // claims the player, filled asynchronously by readStreamRepresentations,
  // keyed to that play's generation + ASIN so a late capture from a superseded
  // play cannot land on the new track.


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

  session() {
    const { session } = electron();
    const ses = session.fromPartition(PARTITION);
    if (!ses.__parachordAmazonPerms) {
      // Allowlist, not a denylist. Playback needs no permission grant at all
      // (HTMLMediaElement and EME/Widevine are not gated by permission
      // handlers), so the hidden page gets fullscreen and nothing else. The
      // previous deny-list default-allowed everything it did not name -
      // including 'media', which is the umbrella getUserMedia permission for
      // camera/microphone on a hidden third-party page. Every denial is
      // logged once per permission name (checks fire often) so an unexpected
      // request is visible in the field without console spam.
      const allowed = new Set(['fullscreen']);
      const warned = new Set();
      const check = (permission) => {
        if (allowed.has(permission)) return true;
        if (!warned.has(permission)) {
          warned.add(permission);
          console.warn(`[Amazon] denied permission request: ${permission}`);
        }
        return false;
      };
      ses.setPermissionRequestHandler((_wc, permission, callback) => callback(check(permission)));
      ses.setPermissionCheckHandler((_wc, permission) => check(permission));
      ses.__parachordAmazonPerms = true;
    }
    return ses;
  },

  // 'known' | 'rotated' | 'none' (amazonAuthCookieState). Empty-valued
  // cookies are deletions in flight, not a session.
  async authCookieState() {
    try {
      const cookies = await this.session().cookies.get({});
      return amazonAuthCookieState(cookies.filter(c => c.value).map(c => c.name));
    } catch {
      return 'none';
    }
  },

  async hasAuthCookie() {
    return (await this.authCookieState()) !== 'none';
  },

  // Ready means signed in AND a profile has been chosen. A window still on
  // the profile picker or the sign-in page is not ready, even if a cookie
  // from an earlier step is already set.
  async isSignedIn() {
    const cookies = await this.authCookieState();
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
    const auth = this.authWindow;
    if (this.alive(auth) && pageBlocksPlayback(auth.webContents.getURL())) return false;
    return true;
  },

  setHost(win) {
    if (this.host && this._onHostClosed) {
      try { this.host.off('closed', this._onHostClosed); } catch { /* gone */ }
    }
    this.host = win && !win.isDestroyed() ? win : null;
    this._onHostClosed = null;
    if (!this.host) {
      this.destroyView(this.searchView);
      this.searchView = null;
      return;
    }
    this._onHostClosed = () => this.setHost(null);
    this.host.on('closed', this._onHostClosed);
    this.collapse(this.searchView);
  },

  // The hidden search view gets the full treatment: the preload's
  // visibility stub + __r trap. The sign-in window gets neither — it is the
  // one visible Amazon page and must behave like a normal browser window
  // (real focus events, real document.hidden, no tampering that Amazon's
  // sign-in flows or bot heuristics could trip over).
  webPreferences({ preload = PRELOAD } = {}) {
    return {
      partition: PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload,
      webSecurity: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required'
    };
  },

  windowOptions(show) {
    return {
      width: 1100,
      height: 760,
      show: !!show,
      title: 'Amazon Music',
      backgroundColor: '#000000',
      skipTaskbar: !show,
      webPreferences: this.webPreferences()
    };
  },

  alive(target) {
    return !!(target && target.webContents && !target.webContents.isDestroyed());
  },

  attachContents(wc) {
    const harden = () => {
      try { wc.setUserAgent(chromeUserAgent()); } catch { /* destroyed */ }
    };
    harden();
    try { wc.setBackgroundThrottling(false); } catch { /* destroyed */ }
    // A hidden page on the Amazon session must not spawn a visible window.
    // Electron's default is to create one, and that window would carry the
    // session cookies without the preload or the UA mask.
    try { wc.setWindowOpenHandler(() => ({ action: 'deny' })); } catch { /* destroyed */ }
    wc.on('did-start-navigation', harden);
    return wc;
  },

  attachWindow(win) {
    this.attachContents(win.webContents);
    win.on('closed', () => {
      if (this.authWindow === win) this.authWindow = null;
    });
    return win;
  },

  // 0×0 so a view painted above the page still cannot cover Parachord.
  collapse(view) {
    if (!view) return;
    try { view.setBounds({ x: 0, y: 0, width: 0, height: 0 }); } catch { /* gone */ }
  },

  destroyView(view) {
    if (!view) return;
    try {
      if (this.host && !this.host.isDestroyed()) this.host.contentView.removeChildView(view);
    } catch { /* detached */ }
    try {
      if (view.webContents && !view.webContents.isDestroyed()) view.webContents.close();
    } catch { /* gone */ }
  },

  pageOf(view) {
    const wc = view.webContents;
    return {
      webContents: wc,
      loadURL: (url) => wc.loadURL(url),
      isDestroyed: () => !wc || wc.isDestroyed()
    };
  },

  appView() {
    const host = this.host;
    if (!host || host.isDestroyed()) return null;
    const kids = host.contentView.children || [];
    return kids.find(v => v && v.webContents && v.webContents.id === host.webContents.id) || null;
  },

  // Search rows do not mount in a 0×0 view (the widget collapses to
  // max-width: 0). Park the search view at a real size but left of the
  // window so it cannot cover Parachord. Do not attach the debugger.
  layoutSearch(view) {
    if (!view) return 'none';
    try {
      view.setBounds({ x: -1200, y: 0, width: 1100, height: 800 });
    } catch { /* gone */ }
    return 'offscreen';
  },

  // Blank the search view when a search is done. The SPA would otherwise
  // keep running at full speed (backgroundThrottling is off), and a view
  // left parked on a sign-in wall poisons sign-in detection for the rest of
  // the session. Awaits the blank so the next queued page load (search or
  // playlist) cannot race it. Flows no longer call this directly — they
  // scheduleParkSearchView (a fuse long enough for template replays to run)
  // — but a hard park still cancels any pending fuse.
  async parkSearchView() {
    this.cancelSearchViewPark();
    const view = this.searchView;
    if (!this.alive(view)) return;
    this.collapse(view);
    // Blanking IS a navigation: gate it like every other, so a replay that
    // entered between the fuse's busy check and the load is waited out
    // instead of having its frame torn down mid-fetch.
    await this.replayGate.beginNavigation();
    try {
      const url = view.webContents.getURL();
      if (url && url !== 'about:blank') await view.webContents.loadURL('about:blank');
    } catch { /* gone */ } finally {
      this.replayGate.endNavigation();
    }
  },

  // Arm the delayed park of the search view, SEARCH_VIEW_WARM_MS out (the
  // constant's comment has the trade: bounded idle-SPA cost vs one page load
  // per search). Re-arming replaces a pending fuse; the timer is unref'd so
  // it never keeps the app alive.
  scheduleParkSearchView() {
    this.cancelSearchViewPark();
    this.searchViewParkTimer = setTimeout(() => {
      this.searchViewParkTimer = null;
      // A flow or replay is using the view: re-arm instead of blanking. A
      // fuse armed by flow A must never blank the view under flow B (a 40s
      // playlist import outlives the fuse, and a replay during it would
      // otherwise re-arm a blank into the middle of its pagination).
      if (this.searchViewBusy > 0) {
        this.scheduleParkSearchView();
        return;
      }
      this.parkSearchView().catch(() => {});
    }, SEARCH_VIEW_WARM_MS);
    if (typeof this.searchViewParkTimer.unref === 'function') this.searchViewParkTimer.unref();
  },

  // New search activity cancels a pending park — the view is about to be
  // used again (a template replay reaching in, or a page flow starting).
  // Without this an older fuse could blank the view mid-flow.
  cancelSearchViewPark() {
    if (this.searchViewParkTimer) {
      clearTimeout(this.searchViewParkTimer);
      this.searchViewParkTimer = null;
    }
  },

  // Structural failure reporting shared by the fast and page flows: record
  // on the search breaker (which opens after consecutive failures — see
  // searchBreaker) and make the not-ready error. A hornet rename must never
  // be confused with a miss, which resolution caches for 30 days.
  specStructuralError(message) {
    if (this.searchBreaker) {
      this.searchBreaker.recordFailure();
      const state = this.searchBreaker.state();
      if (state.open) console.warn(`[Amazon] search breaker open for ${Math.max(0, state.openUntil - Date.now())}ms (${state.failures} consecutive structural failures)`);
    }
    return notReady('not-ready', message);
  },

  ensureView(which) {
    const { WebContentsView } = electron();
    // Audio plays through the shared renderer player (widevine path) now —
    // the only Amazon view left is the SEARCH view, host for sign-in state,
    // spec searches/lookups and the session-header mint.
    const key = 'searchView';
    if (this.alive(this[key])) {
      this.collapse(this[key]);
      return this.pageOf(this[key]);
    }
    if (!this.host || this.host.isDestroyed()) {
      throw notReady('not-ready', 'Amazon Music has no host window');
    }
    this.session();
    const view = new WebContentsView({ webPreferences: this.webPreferences() });
    this.attachContents(view.webContents);
    this.host.contentView.addChildView(view);
    this.collapse(view);
    this[key] = view;
    view.webContents.on('destroyed', () => {
      if (this[key] === view) this[key] = null;
    });
    return this.pageOf(view);
  },

  async ensureWindow() {
    return this.ensureView('search');
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

  async openLogin() {
    const { BrowserWindow } = electron();
    let win = this.authWindow;
    if (!this.alive(win)) {
      this.session();
      const parent = this.host && !this.host.isDestroyed() ? this.host : null;
      win = this.attachWindow(new BrowserWindow({
        ...this.windowOptions(true),
        width: 980,
        height: 760,
        parent: parent || undefined,
        title: 'Sign in to Amazon Music',
        // No preload here: the visibility stub and __r trap are for the hidden
        // player views. This window is visible and must behave normally.
        webPreferences: this.webPreferences({ preload: null })
      }));
      this.authWindow = win;
      // Unbudgeted on purpose: this is the one window the user watches. A
      // stalled load here is visible (and recoverable by the user retrying),
      // and rejecting the openLogin promise at 30s would abandon a sign-in
      // flow that may still complete.
      await win.loadURL(HOME_URL);
    }
    win.show();
    win.focus();

    this._signInTracePage = null;
    this._signInTraceCookies = null;
    return new Promise((resolve) => {
      let settled = false;
      let lastUrl = null;
      let stableTicks = 0;
      const finish = (signedIn) => {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        resolve({ success: !!signedIn, signedIn: !!signedIn });
      };
      const timer = setInterval(async () => {
        if (win.isDestroyed()) return;
        const url = win.webContents.getURL();
        // Positive signal only (signInLanded): "not on a known wall" used to
        // close this window on a logged-out first paint of music.amazon.com/.
        // The cookie is one accepted signal, not a requirement — Amazon
        // rotating the cookie names must not leave this timer waiting forever;
        // a path off / or a third stable tick stands in for it.
        const hasCookie = await this.hasAuthCookie().catch(() => false);
        await this.traceSignIn(url).catch(() => {});
        const verdict = signInLanded({ url, lastUrl, stableTicks, hasCookie });
        lastUrl = url;
        stableTicks = verdict.stableTicks;
        if (!verdict.landed) return;
        console.log(`[Amazon] sign-in landed on ${this.signInTraceUrl(url)} (cookie: ${hasCookie}, stable ticks: ${verdict.stableTicks})`);
        clearInterval(timer);
        setTimeout(() => {
          if (win && !win.isDestroyed()) win.close();
        }, 600);
        finish(true);
      }, 1000);
      win.on('closed', () => finish(false));
    });
  },

  // Sign-in trace: each page the sign-in window visits (host + path only; the
  // query can carry tokens) and the Amazon session cookie NAMES as they
  // appear (never values), so a sign-in that closes too early or never
  // finishes can be read from the log.
  signInTraceUrl(url) {
    try {
      const u = new URL(url);
      return `${u.host}${u.pathname}`;
    } catch {
      return String(url || '').split('?')[0];
    }
  },

  async traceSignIn(url) {
    const page = this.signInTraceUrl(url);
    if (page !== this._signInTracePage) {
      this._signInTracePage = page;
      console.log(`[Amazon] sign-in page: ${page}`);
    }
    const cookies = await this.session().cookies.get({});
    const names = [...new Set(cookies.filter(c => /^(at-|sess-at-|x-main|session-token)/.test(c.name)).map(c => c.name))].sort().join(',');
    if (names !== this._signInTraceCookies) {
      this._signInTraceCookies = names;
      console.log(`[Amazon] sign-in cookies: ${names || '(none)'}`);
    }
  },

  // Serializes real page navigation: fallback spec searches, playlist
  // imports, album lookups and the diagnostic capture share the one view and
  // the webRequest listener slots, so they run one at a time. Every enqueued
  // job also holds searchViewBusy — the park fuse must not blank the view
  // under a flow it cannot see (a fuse has no idea what the chain is up to).
  enqueueSearch(fn) {
    const busy = async () => {
      this.searchViewBusy++;
      try {
        return await fn();
      } finally {
        this.searchViewBusy--;
      }
    };
    const run = this.searchChain.then(busy, busy);
    this.searchChain = run.then(() => {}, () => {});
    return run;
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
  async mintSessionHeaders({ query } = {}) {
    if (!(await this.isSignedIn())) {
      const err = new Error('Sign in to Amazon Music first');
      err.reason = 'not-signed-in';
      throw err;
    }
    // Fast path since the search template landed (#1152): the captured
    // spec-search request already carries exactly these headers from a real
    // page flow — the replay's freshness check is the mint's too.
    const t = this.specSearchTemplate;
    if (t && t.headers && typeof t.headers['csrf-token'] === 'string' &&
        t.headers['csrf-token'].length >= 20 &&
        /^\d+$/.test(String(t.headers['csrf-rnd'] || '')) &&
        /^\d+$/.test(String(t.headers['csrf-ts'] || ''))) {
      return {
        csrfToken: t.headers['csrf-token'],
        csrfRnd: t.headers['csrf-rnd'] || null,
        csrfTs: t.headers['csrf-ts'] || null,
        deviceId: t.headers['x-amzn-device-id'] || null
      };
    }
    return this.enqueueSearch(async () => {
      const ses = this.session();
      const win = await this.ensureWindow('search');
      const q = String(query || 'the').slice(0, 120);
      console.log(`[Amazon] session-headers mint: page flow for "${q}"`);
      const headers = await new Promise((resolve) => {
        const filter = { urls: ['https://gql.music.amazon.com/*', 'https://music.amazon.com/api/*', 'https://music.amazon.com/*/api/*'] };
        let done = false;
        const finish = (value) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          try { ses.webRequest.onBeforeSendHeaders(filter, null); } catch { /* none */ }
          resolve(value);
        };
        const timer = setTimeout(() => finish(null), 10000);
        // The page emits PLACEHOLDER csrf values (literally foo/bar) on
        // requests that do not need them — only the real spec-search-class
        // requests carry live ones. A dmls call made with placeholders fails
        // server-side (its "REQUIRED_COOKIES_MISSING" is the bad-csrf
        // symptom, live-verified 2026-10), so keep listening until values
        // that look real arrive.
        const tokenLooksReal = (h) =>
          typeof h['csrf-token'] === 'string' && h['csrf-token'].length >= 20 &&
          /^\d+$/.test(String(h['csrf-rnd'] || '')) && /^\d+$/.test(String(h['csrf-ts'] || ''));
        ses.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
          const h = details.requestHeaders || {};
          if (h['csrf-token'] && tokenLooksReal(h)) {
            finish({
              csrfToken: h['csrf-token'],
              csrfRnd: h['csrf-rnd'] || null,
              csrfTs: h['csrf-ts'] || null,
              deviceId: h['x-amzn-device-id'] || null
            });
          }
          callback({});
        });
        loadURLBudgeted(win, `https://music.amazon.com/search/${encodeURIComponent(q)}/songs`).catch(() => finish(null));
      });
      // Park on the warm fuse (template replays need an Amazon-origin page
      // world; parkSearchView's immediate blank only happens on real restarts).
      if (typeof this.scheduleParkSearchView === 'function') this.scheduleParkSearchView();
      if (!headers || !headers.csrfToken) {
        const err = new Error('session headers: the page fired no captured request');
        err.reason = 'load-failed'; // transient/network — never a sign-in prompt
        throw err;
      }
      console.log('[Amazon] session-headers mint ok');
      return headers;
    });
  },

  // Capture gql requests (bodies from onBeforeRequest, headers paired by
  // request id) while a page loads and fires its own queries. A registration
  // replaces any previous one — webRequest has a single listener slot per
  // method per session — and the search chain serializes searchTracks and
  // lookupPlaylist, so the two flows never interleave captures. Returns
  // { captured, detach } — detach in a finally so a stale capture does not
  // keep buffering every later page's gql bodies into a dead array.
  attachGqlCapture() {
    const ses = this.session();
    const gqlFilter = { urls: ['https://gql.music.amazon.com/*'] };
    const captured = [];
    const onRequest = (details, callback) => {
      try {
        if (details.uploadData && details.uploadData.length) {
          const body = details.uploadData.map(d => (d.bytes ? d.bytes.toString('utf8') : '')).join('');
          // Keep the URL the page itself used — replaying a hardcoded endpoint
          // rots the day Amazon puts a path or region segment on it.
          captured.push({ id: details.id, body, url: details.url });
        }
      } catch (e) { /* keep other requests flowing */ }
      callback({});
    };
    const onSendHeaders = (details, callback) => {
      const mine = captured.find(r => r.id === details.id);
      if (mine) mine.headers = details.requestHeaders;
      callback({ requestHeaders: details.requestHeaders });
    };
    try { ses.webRequest.onBeforeRequest(gqlFilter, onRequest); } catch { /* a second registration replaces */ }
    try { ses.webRequest.onBeforeSendHeaders(gqlFilter, onSendHeaders); } catch { /* a second registration replaces */ }
    const detach = () => {
      try { ses.webRequest.onBeforeRequest(gqlFilter, null); } catch { /* none */ }
      try { ses.webRequest.onBeforeSendHeaders(gqlFilter, null); } catch { /* none */ }
    };
    return { captured, detach };
  },

  // Replay a captured gql request from the page world of the search view.
  // The page context supplies cookies (credentials: 'include') and the
  // headers we copied from the request the page itself made; the APQ hash in
  // the body comes from that request too, so it is always current for this
  // hornet deploy. Returns { parsed } (the full response envelope) or
  // { error } — each flow decides which envelope shape it expects.
  async replayGql(win, entry, body) {
    const replayUrl = entry.url || 'https://gql.music.amazon.com/';
    const headers = amazonGqlFetchHeaders(entry.headers);
    const raw = JSON.stringify(body);
    const replay = await this.evalOn(win, GQL_FETCH_SCRIPT(replayUrl, headers, raw));
    if (!replay || replay.error) return { error: (replay && replay.error) || 'Amazon gql query failed' };
    if (replay.status !== 200) return { error: `Amazon gql query failed (${replay.status})` };
    let parsed = null;
    try { parsed = JSON.parse(replay.text); } catch (e) { /* leave null */ }
    if (!parsed) return { error: 'Amazon gql response was not JSON' };
    if (Array.isArray(parsed.errors) && parsed.errors.length && !parsed.data) {
      return { error: String((parsed.errors[0] || {}).message || 'Amazon gql query error') };
    }
    return { parsed };
  },

  // Shared runner for the spec searches — the songs tab (/search/<q>/songs)
  // fires the track-spec SpecSearchSeeMorePage, the albums tab (/search/<q>/
  // albums) the album spec; everything else about the flow is identical.
  // Search runs over the page's own GraphQL — the same capture-and-replay
  // pattern as lookupPlaylist. The tab page fires SpecSearchSeeMorePage with
  // our exact searchText; that request (URL, headers, APQ hash, variables) is
  // captured while the page loads and replayed verbatim, and the result is
  // parsed pure — no DOM scraping: no row-mount waits, no testid heuristics,
  // no like-button ASIN exclusion dance, and the rows carry cover art the DOM
  // never exposed. The request is matched on variables.searchText, not the
  // operation name, so a hornet rename of the operation cannot break it — and
  // only the requested spec is ever replayed: for tracks, an album/artist spec
  // edge must never import as a track (an album ASIN in the track slot passes
  // the confidence gate on self-titled releases).
  //
  // Structural failures (the page never searched, another spec searched but
  // ours never came, or the response carried no spec search envelope) throw
  // not-ready — never cached as a 30-day noMatch — and trip the shared search
  // breaker so a rename fails fast instead of burning the capture window on
  // every search of a resolution run. An envelope with empty edges IS a real
  // miss and returns [].
  //
  // Two paths ("Spec-search request templates" in amazon-music-logic.js):
  // the FAST path replays the last captured request with fresh variables
  // from the still-warm view — no page load, no chain, and replays run in
  // parallel (a playlist resolve or a burst of catalog/image lookups pays
  // one page load total, not one per lookup). Any template miss (none yet,
  // stale, view cold/parked, navigation in flight, replay error) falls back
  // to the chained page flow, whose capture re-mints the template — the
  // fallback IS the old flow, so the failure semantics never change. Only
  // real page navigation is serialized on the chain now (fallback searches,
  // playlist imports) — and it waits out in-flight replays first
  // (replayGate), instead of their frames being torn down mid-fetch.
  async specSearch({ url, searchText, specType, parse, noun, staleCheck = null }) {
    if (staleCheck && staleCheck()) {
      console.log(`[Amazon] ${specType} search skipped: past the ${ALBUM_JOB_STALE_MS}ms budget before it started — the caller already moved on`);
      return [];
    }
    if (this.searchBreaker && !this.searchBreaker.allows()) {
      const probe = this.searchBreaker.isProbe() ? ' (probing after cooldown)' : '';
      throw notReady('not-ready', `Amazon search is cooling down after repeated structural failures${probe}`);
    }
    const fast = await this.trySpecReplay({ searchText, specType, parse, noun });
    if (fast !== null) return fast;
    return this.enqueueSearch(async () => {
      if (staleCheck && staleCheck()) {
        console.log(`[Amazon] ${specType} search skipped: queued past the ${ALBUM_JOB_STALE_MS}ms catalog budget — the caller already moved on`);
        return [];
      }
      // The page flow that ran while we queued may have refreshed the
      // template — one refresh heals every search queued behind it.
      const warmed = await this.trySpecReplay({ searchText, specType, parse, noun });
      if (warmed !== null) return warmed;
      return this.specSearchPageFlow({ url, searchText, specType, parse, noun });
    });
  },

  // specSearch's fast path: replay the cached request with fresh searchText/
  // specType from the warm view. Returns the parsed rows, or null for any
  // template-miss (the caller then queues the page flow, which re-mints the
  // template). Throws not-signed-in on a wall URL, exactly like the page
  // flow. A structural-looking response (200 with data but no spec search
  // envelope) is NOT judged here: on the page flow that can only mean a
  // hornet rename (its request was captured seconds earlier), but on the
  // fast path it can equally mean the template went bad (a partial GraphQL
  // error — the auth-failed-field shape of rotated session headers — leaves
  // data.specificationSearch null). Replay-and-throw here made every later
  // search fail identically, probe included, with nothing able to heal the
  // template for 24h (review on #1152). So a missing envelope drops the
  // template and defers to the chained page flow, which makes the
  // structural call with a fresh capture.
  async trySpecReplay({ searchText, specType, parse, noun }) {
    const template = this.specSearchTemplate;
    if (!specTemplateIsFresh(template, Date.now())) return null;
    if (!this.replayGate.tryEnterReplay()) return null;
    // Hold the view: the park fuse consults searchViewBusy at fire time, and
    // a page flow's capture poll consults replayActivity before trusting its
    // other-spec grace (our own fetch can look like the page's request).
    this.searchViewBusy++;
    this.replayActivity++;
    try {
      this.cancelSearchViewPark();
      const win = this.searchView;
      if (!this.alive(win)) return null;
      let href = '';
      try { href = win.webContents.getURL(); } catch { return null; }
      // A replay needs an Amazon-origin page world (cookies, CORS): a parked
      // or never-loaded view means the page flow runs instead.
      if (!isAmazonMusicPage(href)) return null;
      if (pageBlocksPlayback(href)) {
        console.warn(`[Amazon] ${specType} replay blocked: ${href}`);
        throw notReady('not-signed-in', 'Choose an Amazon Music profile');
      }
      const body = specBodyWithVars(template.body, { searchText, specType });
      const slow = this.replayGql(win, template, body);
      slow.catch(() => {}); // a late rejection after the race lost must not be unhandled
      let timer = null;
      let outcome;
      try {
        outcome = await Promise.race([
          slow,
          new Promise(resolve => {
            timer = setTimeout(() => resolve({ error: `replay exceeded ${REPLAY_TIMEOUT_MS}ms` }), REPLAY_TIMEOUT_MS);
            if (typeof timer.unref === 'function') timer.unref();
          })
        ]);
      } catch (error) {
        // A HARD rejection — the view destroyed mid-replay (signOut, host
        // close), a navigation tearing the frame — is the same miss as an
        // error envelope: the fallback page flow re-evaluates view state
        // itself. The fast path must never break specSearch's throw contract.
        outcome = { error: (error && error.message) || String(error) };
      }
      clearTimeout(timer);
      if (outcome.error) {
        console.warn(`[Amazon] ${specType} template replay failed (${outcome.error}); refreshing via a page load`);
        // Drop only if nobody re-minted meanwhile — a page flow that ran in
        // parallel already put a fresh template in place.
        if (this.specSearchTemplate === template) this.specSearchTemplate = null;
        return null;
      }
      const parsed = outcome.parsed;
      const { rows, envelope } = parse(parsed && parsed.data);
      if (!envelope) {
        // Defer structure to the page flow (see the method comment): the
        // template may be stale, and only a fresh capture can prove a hornet
        // rename. The breaker gets involved only if the page flow also
        // fails structurally.
        console.warn(`[Amazon] ${specType} template replay was not a spec search envelope for ${JSON.stringify(searchText)}; dropping the template`);
        if (this.specSearchTemplate === template) this.specSearchTemplate = null;
        return null;
      }
      if (this.searchBreaker) this.searchBreaker.recordSuccess();
      const fromSpec = template.body && template.body.variables && template.body.variables.specType;
      console.log(`[Amazon] ${specType} replay${fromSpec && fromSpec !== specType ? ` (${fromSpec} template)` : ''} returning ${rows.length} ${noun} for ${JSON.stringify(searchText)}`);
      return rows;
    } finally {
      this.searchViewBusy--;
      this.replayGate.exitReplay();
      this.scheduleParkSearchView();
    }
  },

  // The page flow behind specSearch (one at a time on the search chain):
  // load the tab page in the shared view, capture the page's own search
  // request, replay it, parse pure. Mint the template the fast path replays.
  // The navigation is gated — it waits out in-flight template replays rather
  // than tearing their frame down mid-fetch.
  async specSearchPageFlow({ url, searchText, specType, parse, noun }) {
    // A fuse armed by an earlier flow must not blank the view mid-load.
    this.cancelSearchViewPark();
    // Read the replay-activity mark BEFORE anything else: replay traffic
    // overlapping ANY of this flow — navigation AND poll — degrades the
    // other-spec grace to the full capture window (see the poll below).
    // Reading at the poll would still let a span-past-the-boundary replay
    // poison it.
    const replayMark = this.replayActivity;
    const win = await this.ensureWindow('search');
    const mode = await this.layoutSearch(this.searchView);
    console.log(`[Amazon] search mode=${mode} ${url}`);
    const { captured, detach } = this.attachGqlCapture();
    try {
      await this.replayGate.beginNavigation();
      try {
        await loadURLBudgeted(win, url);
      } finally {
        this.replayGate.endNavigation();
      }
      // Wait for the page's own search request (boot + query is ~1-3s on a
      // warm view; the poll window covers a slow load). The entry must also
      // have its headers — onBeforeSendHeaders fires milliseconds *after*
      // onBeforeRequest, so accepting the body alone races it. ALL
      // header-complete bodies go to the matcher each poll — the matcher
      // only ever accepts the wanted spec, so a different-spec request that
      // arrives first cannot win by first-arrival.
      // Our own off-chain template replays ALSO hit this capture (the
      // listener is session-wide; pre-rework the chain made concurrent gql
      // impossible). A same-text different-spec replay body is rejected by
      // the matcher but ACCEPTED by the anySpec grace — and 8 polls later
      // the grace would conclude structurally even though the page's own
      // request may just be slow. Replay traffic overlapping this flow
      // degrades the grace to the full window instead of a spurious
      // structural failure (and a breaker tick we caused ourselves).
      let request = null;
      let entry = null;
      let otherSpecSeenAt = -1;
      for (let i = 0; i < 60 && !request; i++) {
        await new Promise(r => setTimeout(r, 250));
        const href = win.isDestroyed() ? '' : win.webContents.getURL();
        if (pageBlocksPlayback(href)) {
          console.warn(`[Amazon] search blocked: ${href}`);
          throw notReady('not-signed-in', 'Choose an Amazon Music profile');
        }
        const ready = captured.filter(r => r.headers);
        const bodies = ready.map(r => r.body);
        request = amazonSpecSearchRequest(bodies, searchText, { spec: specType });
        if (request) {
          entry = ready.find(r => amazonSpecSearchRequest([r.body], searchText, { spec: specType }));
          break;
        }
        // Another spec searched our text but ours has not arrived: give it
        // a short grace (the page may fire specs out of order), then
        // conclude structurally instead of burning the full window.
        if (otherSpecSeenAt < 0 && amazonSpecSearchRequest(bodies, searchText, { anySpec: true })) {
          otherSpecSeenAt = i;
          console.warn(`[Amazon] search: a non-${specType} spec searched for ${JSON.stringify(searchText)}; waiting briefly for the ${specType} spec`);
        }
        if (otherSpecSeenAt >= 0 && i - otherSpecSeenAt >= 8 && this.replayActivity === replayMark) break;
      }
      if (!request || !entry) {
        // The page loaded but never ran our search: a hornet rename of the
        // operation (or the search page itself), or an SPA failure. Log
        // what the page did fire so a rename reads as a rename instead of a
        // silent run of empty searches each cached as a 30-day noMatch.
        console.warn(`[Amazon] search: page never fired the ${specType} search for ${JSON.stringify(searchText)}; gql operations seen: ${capturedOperationNames(captured.map(c => c.body)).join(', ') || 'none'}`);
        throw this.specStructuralError(`Amazon search page never issued its ${specType} search`);
      }
      if (!request.variables || typeof request.variables !== 'object') {
        throw this.specStructuralError('Unexpected Amazon search query shape');
      }

      // Replay the page's own request verbatim. (Capturing the page's own
      // response in the page world instead — the stream-capture pattern —
      // does NOT work here: hornet binds its fetch at module init, before
      // any preload-injected wrapper can install, so the page's own search
      // bypasses the wrapper (live-verified 2026-10; the stream capture only
      // survives because media segments are fetched seconds later, at play
      // time). The replay's cost is one request on top of the ~9 ops the
      // page load itself fires.)
      // Mint the template the fast path replays — unless the matched
      // request is OUR OWN replay echoing back into the capture (duplicate
      // same-text same-spec activity overlapped the poll; see
      // bodyMatchesTemplate in amazon-music-logic.js): minting from it
      // would re-certify session-aged headers as fresh. The rows are still
      // correct — the replay below answers the same search either way. The
      // skip applies only while the existing template is fresh: a stale
      // template is exactly what the page flow is healing, so it always
      // re-mints (fresh headers are the point of the page capture).
      const agedTemplate = !specTemplateIsFresh(this.specSearchTemplate, Date.now());
      if (!agedTemplate && bodyMatchesTemplate(this.specSearchTemplate, request, { searchText, specType })) {
        console.log('[Amazon] search matched our own replay in the capture; keeping the existing template');
      } else {
        // Mint BEFORE this flow's own replay runs: the template captures the
        // page's own fresh request, which is valid whether or not the replay
        // that follows answers well — a replay error drops it again anyway.
        const template = makeSpecSearchTemplate({ url: entry.url, headers: entry.headers, body: request, capturedAt: Date.now() });
        if (template) this.specSearchTemplate = template;
        else console.warn('[Amazon] spec search captured a request that is not template-shaped; staying page-load-per-search');
      }
      const outcome = await this.replayGql(win, entry, request);
      if (outcome.error) throw notReady('not-ready', outcome.error);
      const parsed = outcome.parsed;
      const { rows, envelope } = parse(parsed && parsed.data);
      if (!envelope) {
        // The response carried no spec search envelope: hornet renamed the
        // response field. A rename must surface as not-ready, not as a
        // cached miss.
        console.warn(`[Amazon] search response was not a spec search envelope for ${JSON.stringify(searchText)}`);
        throw this.specStructuralError('Amazon search response was not a spec search envelope');
      }
      if (this.searchBreaker) this.searchBreaker.recordSuccess();
      console.log(`[Amazon] search returning ${rows.length} ${noun} for ${JSON.stringify(searchText)}`);
      return rows;
    } finally {
      detach();
      this.scheduleParkSearchView();
    }
  },

  async searchTracks(input) {
    const opts = typeof input === 'string' ? { query: input } : (input || {});
    const spec = amazonSongSearchUrl(opts);
    if (!spec) return [];
    if (!(await this.isSignedIn())) {
      throw notReady('not-signed-in', 'Sign in and choose an Amazon Music profile');
    }
    return this.specSearch({
      url: spec.url,
      searchText: spec.searchText,
      specType: 'track',
      noun: 'tracks',
      parse: (data) => {
        const { tracks, envelope } = searchTracksFromGql(data);
        return { rows: tracks, envelope };
      }
    });
  },

  // Album search for the album-page catalog fallback (the plugin's
  // capabilities.albumSearch): the albums tab of the same spec search, parsed
  // by searchAlbumsFromGql.
  async searchAlbums(input) {
    const opts = typeof input === 'string' ? { query: input } : (input || {});
    const spec = amazonAlbumSearchUrl(opts);
    if (!spec) return [];
    if (!(await this.isSignedIn())) {
      throw notReady('not-signed-in', 'Sign in and choose an Amazon Music profile');
    }
    const queuedAt = Date.now();
    return this.specSearch({
      url: spec.url,
      searchText: spec.searchText,
      specType: 'album',
      noun: 'albums',
      staleCheck: () => Date.now() - queuedAt > ALBUM_JOB_STALE_MS,
      parse: (data) => {
        const { albums, envelope } = searchAlbumsFromGql(data);
        return { rows: albums, envelope };
      }
    });
  },

  // Artist photos for the artist-image chain (the plugin's
  // capabilities.artistImage; docs/architecture/plugins.md,
  // "searchArtistImage"). The artists tab (/search/<q>/artists) of the same
  // spec search the track and album searches use — the photo comes out of
  // the Artist node in the response, so the whole lookup is the one page
  // load + one replay the runner already does. Unlike the track/album
  // searches this method never throws and never prompts for sign-in: not
  // signed in is `null` without a request (the chain just moves on to
  // Deezer), and the runner's structural notReady (which trips the shared
  // breaker) degrades to `null` here too, since an artist photo is always
  // optional. The name-match happens in the parser — only an exact
  // (normalized) name's photo is returned, never the top hit's when Amazon
  // ranks a different artist first.
  async searchArtistImage(artistName) {
    let rows;
    try {
      const spec = amazonArtistSearchUrl(artistName);
      if (!spec) return null;
      if (!(await this.isSignedIn())) {
        console.log(`[Amazon] artist image for ${String(artistName)} skipped: not signed in`);
        return null;
      }
      const queuedAt = Date.now();
      rows = await this.specSearch({
        url: spec.url,
        searchText: spec.searchText,
        specType: 'artist',
        noun: 'artist image',
        staleCheck: () => Date.now() - queuedAt > ALBUM_JOB_STALE_MS,
        parse: (data) => {
          const { url, envelope } = searchArtistImageFromGql(data, artistName);
          return { rows: url ? [url] : [], envelope };
        }
      });
    } catch (error) {
      // Catches the runner's structural notReady (which trips the shared
      // breaker) and anything the URL builder or sign-in check throws: the
      // artist-image chain contracts a miss, never an exception.
      console.warn(`[Amazon] artist image for ${String(artistName)} failed: ${error && error.reason} ${error && error.message}`);
      return null;
    }
    return (rows && rows[0]) || null;
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
      const win = await this.ensureWindow('search');
      const mode = await this.layoutSearch(this.searchView);
      console.log(`[Amazon] playlist lookup mode=${mode} ${rawUrl}`);

      // Capture gql requests (bodies from onBeforeRequest, headers paired by
      // request id) while the page loads and fires playlistDetail itself.
      const { captured, detach } = this.attachGqlCapture();
      try {
        await this.replayGate.beginNavigation();
        try {
          await loadURLBudgeted(win, rawUrl);
        } finally {
          this.replayGate.endNavigation();
        }
        // Wait for the page's own playlistDetail request. Boot + query is
        // ~2-4s on a cold view; the poll window covers a slow load. The
        // entry must also have its headers (onBeforeSendHeaders fires
        // milliseconds after onBeforeRequest — accepting the body alone
        // races that) before we take it.
        let entry = null;
        for (let i = 0; i < 40; i++) {
          await new Promise(r => setTimeout(r, 500));
          const href = win.isDestroyed() ? '' : win.webContents.getURL();
          if (pageBlocksPlayback(href)) {
            console.warn(`[Amazon] playlist blocked: ${href}`);
            throw notReady('not-signed-in', 'Choose an Amazon Music profile');
          }
          entry = captured.find(r => r.headers && amazonPlaylistDetailRequest([r.body], playlistId));
          if (entry) break;
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
          const out = await this.replayGql(win, entry, body);
          if (out.error) return { error: out.error };
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
    });
  },

  // Import an album page (music.amazon.com/albums/<ASIN>) via the page's own
  // GraphQL — the same capture-and-replay pattern as lookupPlaylist. The album
  // page fires AlbumDetailPage with variables.id = the ASIN — but it also
  // fires OTHER reads whose variables carry the ASIN: AlbumSeo (a header-only
  // op whose data.album has title/trackCount but no tracksConnection) arrives
  // FIRST on a real page (live-verified 2026-10), so the winner is never
  // name-matched alone: every captured candidate is replayed until one's
  // response carries data.album.tracksConnection (amazonAlbumDetailCandidates
  // ranks detail-named, then album-named, then — the hornet-rename hedge —
  // any read holding the ASIN; albumTracksConnectionIn is the arbiter).
  // Unlike playlistDetail the tracksConnection carries no pageInfo at all (a
  // 100-track album answers all 100 edges in one response — live-verified),
  // so there is no continuation to follow: a trackCount above the mapped
  // rows is logged as a truncation. data.album null in the winning response
  // is a legitimate not-found (deleted / other region) and returns null; a
  // response with no album field at all is a hornet rename and throws
  // lookup-failed instead of masquerading as a miss. Runs on the search
  // chain: album lookups share the search view with the searches and playlist
  // imports, so they must not interleave page loads.
  async lookupAlbum(rawUrl) {
    if (typeof rawUrl !== 'string' || !/^https:\/\/music\.amazon\.com\//i.test(rawUrl)) {
      throw notReady('not-ready', 'Not an Amazon Music album URL');
    }
    const asin = amazonAlbumAsinFromUrl(rawUrl);
    if (!asin) {
      throw notReady('not-ready', 'Not an Amazon Music album URL');
    }
    if (!(await this.isSignedIn())) {
      throw notReady('not-signed-in', 'Sign in and choose an Amazon Music profile');
    }
    const queuedAt = Date.now();
    return this.enqueueSearch(async () => {
      if (Date.now() - queuedAt > ALBUM_JOB_STALE_MS) {
        console.log(`[Amazon] album lookup skipped: queued past the ${ALBUM_JOB_STALE_MS}ms catalog budget — the caller already moved on`);
        return null;
      }
      // A fuse armed by an earlier flow must not blank the view mid-load.
      this.cancelSearchViewPark();
      const win = await this.ensureWindow('search');
      const mode = await this.layoutSearch(this.searchView);
      const url = `https://music.amazon.com/albums/${asin}`;
      console.log(`[Amazon] album lookup mode=${mode} ${url}`);

      // Capture gql requests (bodies from onBeforeRequest, headers paired by
      // request id) while the page loads and fires AlbumDetailPage itself.
      const { captured, detach } = this.attachGqlCapture();
      try {
        await this.replayGate.beginNavigation();
        try {
          await loadURLBudgeted(win, url);
        } finally {
          this.replayGate.endNavigation();
        }
        const pageUrl = win.isDestroyed() ? '' : win.webContents.getURL();
        if (!isAmazonMusicPage(pageUrl)) {
          throw notReady('not-ready', 'Amazon album page left music.amazon.com before replay');
        }

        // Wait for the page's own album-detail request and replay candidates
        // as they arrive. Boot + query is ~2-4s on a cold view; the poll
        // window covers a slow load. The entry must have its headers
        // (onBeforeSendHeaders fires milliseconds *after* onBeforeRequest —
        // accepting the body alone races that). Candidates are deduped by
        // operationName+variables and re-collected each poll, so a same-burst
        // sibling (AlbumSeo fires alongside the detail op on one page load)
        // is picked up whenever it lands. Replays are capped — the common
        // case is one (the detail op wins on the first try).
        const reqKey = (request) => `${(request && request.operationName) || ''}:${JSON.stringify((request && request.variables) || {})}`;
        const seen = new Set();
        const newCandidates = (anyName) => {
          const ready = captured.filter(r => r.headers);
          return amazonAlbumDetailCandidates(ready.map(r => r.body), asin, { anyName })
            .map((request) => ({
              request,
              entry: ready.find(r => amazonAlbumDetailCandidates([r.body], asin, { anyName: true })
                .some(c => reqKey(c) === reqKey(request)))
            }))
            .filter(p => p.entry && !seen.has(reqKey(p.request)));
        };
        let winner = null;      // { request, entry, data } — the replay that carried a tracksConnection
        let headerOnlyOp = null; // replayed op that had data.album but no tracksConnection (AlbumSeo)
        let lastReplayError = null;
        let replayCount = 0;
        const tryNewCandidates = async (anyName) => {
          for (const p of newCandidates(anyName)) {
            if (winner || replayCount >= 4) return;
            seen.add(reqKey(p.request));
            replayCount += 1;
            console.log(`[Amazon] album replaying ${p.request.operationName} via gql`);
            const outcome = await this.replayGql(win, p.entry, p.request);
            if (outcome.error) {
              lastReplayError = outcome.error;
              console.warn(`[Amazon] album replay of ${p.request.operationName} failed: ${outcome.error}`);
              continue;
            }
            const data = outcome.parsed && outcome.parsed.data;
            if (albumTracksConnectionIn(data)) {
              winner = { ...p, data };
              return;
            }
            if (data && data.album) {
              if (!headerOnlyOp) headerOnlyOp = p.request.operationName;
              console.log(`[Amazon] album replay of ${p.request.operationName} carried the header but no tracks connection`);
            }
          }
        };
        // A replay that won (the loop condition) or errored ends the wait;
        // while every replay so far was header-only, keep polling to the end
        // of the window — on a slow load the detail op can lag its SEO
        // sibling by more than a poll, and settling early here used to be a
        // bogus miss with the detail op still on its way (review on #1135).
        for (let i = 0; i < 40 && !winner; i++) {
          await new Promise(r => setTimeout(r, 500));
          const href = win.isDestroyed() ? '' : win.webContents.getURL();
          if (pageBlocksPlayback(href)) {
            console.warn(`[Amazon] album lookup blocked: ${href}`);
            throw notReady('not-signed-in', 'Choose an Amazon Music profile');
          }
          await tryNewCandidates(false);
          if (lastReplayError) break;
        }
        if (!winner) {
          // No winning replay from the album-named pool — either hornet
          // renamed the detail op (hedge: any read carrying the ASIN, still
          // judged by the tracks-connection response) or the page never
          // fetched tracks for this album (a pre-order header, an error
          // page). The same response check decides.
          await tryNewCandidates(true);
        }
        if (!winner) {
          if (headerOnlyOp) {
            console.warn(`[Amazon] album lookup: ${asin} header came from ${headerOnlyOp} but no operation exposed a tracks connection; gql operations seen: ${capturedOperationNames(captured.map(c => c.body)).join(', ') || 'none'}`);
            return null;
          }
          if (lastReplayError) throw notReady('lookup-failed', lastReplayError);
          // The page loaded but never asked for this album: deleted, not
          // available in the user's territory — or hornet renamed everything.
          // Log what the page did fire so a rename reads as a rename instead
          // of "every album is gone".
          console.warn(`[Amazon] album lookup: page never requested the album detail for ${asin}; gql operations seen: ${capturedOperationNames(captured.map(c => c.body)).join(', ') || 'none'}`);
          return null;
        }
        const { album, envelope } = albumDetailFromGql(winner.data);
        if (!envelope) {
          console.warn(`[Amazon] album lookup: response was not an album detail envelope for ${asin}`);
          throw notReady('lookup-failed', 'Amazon album response was not an album detail envelope');
        }
        if (album && album.trackCount > album.tracks.length) {
          console.warn(`[Amazon] album lookup truncated: got ${album.tracks.length} of ${album.trackCount} tracks`);
          if (album.tracks.length === 0) {
            // Every edge failed to map: either the server carries no rows for
            // this album (pre-order / delisted) or hornet changed the row
            // shape. Say which — a future "0 of N" in the field log should
            // not need a DevTools session to diagnose.
            const tc = winner.data && winner.data.album && winner.data.album.tracksConnection;
            const edges = tc && tc.edges;
            const first = Array.isArray(edges) && edges[0] && edges[0].node;
            console.warn(`[Amazon] album lookup: 0 of ${album.trackCount} mapped — edges=${Array.isArray(edges) ? edges.length : 'absent'}${first ? `, first node keys=${Object.keys(first).join(',')}` : ', first node null'}`);
          }
        }
        console.log(`[Amazon] album lookup returning ${album ? album.tracks.length : 0} tracks "${album ? album.name : ''}"`);
        return album;
      } finally {
        detach();
        this.scheduleParkSearchView();
      }
    });
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
      const win = await this.ensureWindow('search');
      await this.layoutSearch(this.searchView);
      const { captured, detach } = this.attachGqlCapture();
      try {
        await this.replayGate.beginNavigation();
        try {
          await loadURLBudgeted(win, rawUrl);
        } finally {
          this.replayGate.endNavigation();
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
  // like the Apple flow needs. In-flight plays are superseded by the
  // generation bump instead of fighting the teardown.
  async signOut() {
    try { this.destroyView(this.searchView); } catch { /* gone */ }
    this.searchView = null;
    if (this.alive(this.authWindow)) {
      try { this.authWindow.close(); } catch { /* gone */ }
    }
    this.authWindow = null;
    this.cookieWarned = false;
    this.searchChain = Promise.resolve();
    // The captured request template embeds the signed-out session's headers
    // and APQ hash — it must not replay into the next account.
    this.specSearchTemplate = null;
    this.cancelSearchViewPark();
    try {
      await this.session().clearStorageData();
    } catch (error) {
      return { success: false, error: String((error && error.message) || error) };
    }
    return { success: true };
  },
};

module.exports = amazonWebPlayer;
