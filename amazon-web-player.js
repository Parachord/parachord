// In-app Amazon Music player — the host half that remains after #1356.
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
// createWebSessionHost instance (the module-scope `webSession` below). Since
// #1356 M5–M10 every Amazon FLOW is the plugin's (plugins-src/amazonmusic):
// the searches, the catalog, the playlist import, the recommendations, the
// DRM pair, sign-in/out and the status read drive that instance through the
// window.electron.webSession bridge. What this module still owns is the
// MACHINERY (the host instance, the offscreen layout, the park fuse — all of
// it delegated to the host) and one page flow: the diagnostic capture. It
// composes them over the host's primitives and never registers a webRequest
// listener, creates a view, or takes a navigation outside that instance —
// the partition's single webRequest slot has exactly one owner. The teardown
// milestone deletes the rest.
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
//                   if Amazon renames them (amazonAuthCookieState).
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
//                   real miss. (#1356 M5–M10: the track search, the
//                   album/artist catalog flows, the playlist import, the
//                   recommendations, the DRM pair (the dmls manifest/
//                   licence flows, with their session-headers mint and the
//                   streaming telemetry) AND the session surfaces (sign-in,
//                   sign-out, the status read with its plan gate) moved into
//                   plugins-src/amazonmusic — they drive this same host
//                   instance through the window.electron.webSession bridge;
//                   the host-side runners, the amazon-dmls.js provider and the
//                   host's sign-in/out and getStatus surfaces that used to
//                   live here are deleted. This module's one remaining page
//                   flow — the diagnostic capture — still rides the same
//                   capture-and-replay pattern.)
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
const PARTITION = 'persist:amazon-music';
const PRELOAD = path.join(__dirname, 'amazon-player-preload.js');
const { createWebSessionHost, chromeUserAgent } = require('./main-process/web-session');
const {
  pageBlocksPlayback,
  amazonAuthCookieState,
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

function notReady(reason, message) {
  const err = new Error(message || reason);
  err.reason = reason;
  return err;
}

// The diagnostic capture's signed-in guard (the plugin's isSignedIn is the
// surface since #1356 M10; this is the same composition, private to this
// module's one remaining flow): cookies first (the auth-cookie name hedge),
// then the sign-in window's URL — a page is never proof of a session.
async function signedInNow() {
  const { signInUrl, cookieNames } = await webSession.state();
  if (amazonAuthCookieState(cookieNames) === 'none') return false;
  if (signInUrl && pageBlocksPlayback(signInUrl)) return false;
  return true;
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
  // the diagnostic capture and the layout helper read it — it is always
  // exactly the host's view.
  get searchView() { return webSession._view; },
  set searchView(view) { webSession._view = view; },

  // The partition's session, through the one owner — the host installs the
  // permission allowlist (['fullscreen'], warn-once per name) on first use.
  session() {
    return webSession.session();
  },

  setHost(win) {
    webSession.setHost(win);
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

  // (The session surfaces — preloadProbe, openLogin, isSignedIn, the plan
  // read and signOut — moved into plugins-src/amazonmusic with #1356 M10:
  // the plugin opens the sign-in window through the webSession bridge's
  // signIn protocol with its own decide rule, composes the signed-in verdict
  // from state(), reads the plan through fetch() and clears the session
  // through clear(). The teardown milestone deletes what remains here.)

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
    if (!(await signedInNow())) {
      throw notReady('not-signed-in', 'Sign in and choose an Amazon Music profile');
    }
    // Serialized on the host's load chain (rule 1: the one view and the
    // single webRequest listener slot) — webSession.enqueue directly, this
    // flow being the chain's only remaining consumer since #1356 M10.
    return webSession.enqueue(async () => {
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
};

module.exports = amazonWebPlayer;
