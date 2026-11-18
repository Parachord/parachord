// main-process/web-session.js — the generic web-session host (#1356).
//
// One instance of this module is everything a host must supply so that a
// plugin can drive a cookie-session web service (Amazon Music today) through
// capture-and-replay: the hidden view, the request capture, the page-world
// fetch, the cookie-jar fetch, sign-in, sign-out and the view lifecycle. The
// service's own knowledge — which URL loads, which GraphQL request to
// capture, how to patch and parse it, what a wall or a session looks like —
// lives in the plugin, not here. This file must never grow a service name.
//
// The primitives (host-side; the IPC bridge adapts them for the renderer):
//
//   setHost(win)             — the app window that hosts the hidden view
//   load(url, opts)          → { finalUrl, captures? }   — a budgeted page
//                               navigation, serialized per session, with the
//                               requests the page fired captured for the caller
//                               (a load superseded by clear() rejects with
//                               reason 'superseded' — its captures belong to
//                               the old account)
//   pageFetch(request)       → { status, text } | { error } — a fetch from
//                               inside the page world (its origin, cookies,
//                               CORS), parallel-safe
//   fetch(request)           → { status, headers, text } — a request outside
//                               the page carrying the session's cookies; the
//                               URL must be https on one of the session's
//                               allowedHosts and EVERY redirect hop is
//                               re-checked (a hop off the list is not
//                               followed — the jar rides every hop); the host
//                               owns cookies in BOTH directions (the request
//                               header is built from the jar, the response's
//                               Set-Cookie is written into it, and the
//                               returned headers carry set-cookie NAMES
//                               only), it is budgeted like every other wait,
//                               and the request aborts when the budget fires
//   state()                  → { url, signInUrl, cookieNames, generation }
//                               — the facts a plugin composes its
//                               signed-in/wall verdicts from (names only,
//                               never values); the generation is the
//                               clear()-bumped session counter, a plugin's
//                               only window onto a sign-out it cannot see
//                               the event of (a cache minted under one
//                               generation must not serve the next)
//   signIn(url, { decide })  → { signedIn } — a visible window (title from
//                               host config, never a caller choice) ticked at
//                               the host; decide({url, cookieNames, stableTicks})
//                               is the plugin's pure verdict
//   clear()                  — sign out: views die, the storage clears
//
// ── The concurrency contract (the half the primitive signatures don't show) ──
//
// One hidden view serves every flow of the session, and it is shared state
// with sharp edges. The rules below are what the deleted amazon-web-player.js
// (the pre-#1356 Amazon host module) learned the hard way; they are the
// contract, not an implementation detail:
//
//   1. LOADS SERIALIZE. webRequest has a single listener slot per method per
//      session, so two page loads must never interleave captures. Every load
//      runs on the host's internal job queue (createLaneQueue): two lanes,
//      FOREGROUND and BACKGROUND. A foreground job — something the user is
//      waiting on, by the plugin's judgment — starts before every queued
//      background job; FIFO within a lane; the one running job is never
//      interrupted; clear() resets both lanes. A plugin that wants flow-level
//      serialization (a multi-step import) serializes itself; the host
//      guarantees no two of ITS loads overlap.
//   2. A NAVIGATION WAITS OUT IN-FLIGHT PAGEFETCHES. Tearing a frame mid-fetch
//      kills a replay; the readers/writer gate (pageFetch = reader, load and
//      the idle park = writer) drains readers before any navigation. A
//      pageFetch that arrives while a navigation holds the gate resolves
//      { error: 'busy' } — the caller falls back to its page flow. The one
//      exception: a pageFetch called with { readerHeld: true } — its caller
//      already holds a reader for a multi-page walk, and the walk's own
//      pages must not come back busy under a navigation that is waiting for
//      that same outer reader to drain.
//   3. THE IDLE PARK NEVER BLANKS A BUSY VIEW. A page fetch needs an
//      origin page world (about:blank is a null origin: no cookies, no CORS),
//      so the view stays warm for `warmMs` after the last activity and is
//      then parked on about:blank (an idle SPA runs at full speed forever
//      otherwise). The fuse re-arms at fire time while any load or pageFetch
//      is in flight. Known residual: a plugin flow's gaps BETWEEN host calls
//      (pure parsing) don't hold the view; keep inter-call gaps well under
//      warmMs or accept the re-mint.
//   4. CAPTURES FLAG OUR OWN TRAFFIC. The capture listener is session-wide,
//      so a pageFetch racing a load's capture window shows up in that load's
//      captures. Any capture observed while a pageFetch was in flight is
//      flagged echo: true — the plugin's matchers use that to skip template
//      re-mints and degrade fast-fail graces (the #1152 class: an echoed
//      replay once poisoned a template and left a breaker open for a day).
//   5. THE CAPTURE WINDOW IS QUIET-BOUNDED, AND CAN END ON THE CALLER'S OWN
//      NAMED MATCH. A load returns its captures when the page's request burst
//      goes quiet (quietMs without a new capture after the last capture,
//      never later than budgetMs; with zero captures the wait runs to budgetMs
//      — a page that has fired nothing has not started). The matcher is
//      the plugin's (pure, over the returned captures); the host cannot know
//      which request matters, so it must not stop early on a match it can't
//      see. The ONE exception is data: capture.doneWhen — a small declarative
//      record (bodyIncludes/urlIncludes, validated before any state is
//      touched) — names the request the caller waits for, and the window ends
//      the moment a header-complete, non-echo capture satisfies it, before
//      did-finish-load included (the navigation keeps loading in the
//      background). Echoed captures (rule 4) never satisfy it. The budget
//      has an OPT-IN escape in the same spirit (capture.returnOnTimeout: a
//      boolean): a navigation budget that fires with captures held throws
//      load-failed by default — the old contract every caller already treats
//      as transient — and only the caller that opted in gets the held
//      captures back with { loadTimedOut: true } instead, judging the
//      half-loaded page's captures itself.
//
// The capture listener itself pairs bodies (onBeforeRequest) with headers
// (onBeforeSendHeaders) by request id — onBeforeSendHeaders fires
// milliseconds AFTER onBeforeRequest, so a capture accepted on its body
// alone can race its own headers; and onBeforeSendHeaders also fires for
// requests with no body (preflights), so entries pair by id, never by order.
//
// Error convention: load() throws an Error with .reason ('load-failed',
// 'not-ready', 'invalid') for host failures — the same shape
// the old amazon-web-player's flows threw; pageFetch() never throws — every
// failure is { error } so a caller can treat it as a recoverable miss.

'use strict';

// The page-world fetch. Evaluated in the view's page context (executeJavaScript):
// the page supplies the origin, cookies (credentials: 'include') and CORS; the
// headers and body come from the caller (for Amazon, copied verbatim from the
// request the page itself fired — URL, headers, APQ hash stay current for the
// live deploy). The arguments are JSON.stringify'd by the host; the body is
// sent exactly as given.
const PAGE_FETCH_SCRIPT = (url, method, headers, body) => `(async () => {
  try {
    const r = await fetch(${JSON.stringify(url)}, {
      method: ${JSON.stringify(method)},
      credentials: 'include',
      redirect: 'error',
      headers: ${JSON.stringify(headers || {})},
      body: ${JSON.stringify(body === undefined ? undefined : body)}
    });
    return { status: r.status, text: await r.text() };
  } catch (e) {
    return { error: String(e && (e.message || e)) };
  }
})()`;

const DEFAULTS = {
  loadTimeoutMs: 30000,   // a budgeted navigation: a stalled network must not wedge the chain for minutes
  warmMs: 30000,          // how long the view stays warm after the last activity (the park fuse)
  pageFetchTimeoutMs: 12000, // a page fetch with no answer by now is abandoned
  captureQuietMs: 1000,   // the capture window: this long with no new captured request
  captureBudgetMs: 8000,  // …and never longer than this after the load finishes
  capturePollMs: 250,
  signInTickMs: 1000,
  permissionAllowlist: ['fullscreen']
};

function notReady(reason, message) {
  const err = new Error(message || reason);
  err.reason = reason;
  return err;
}

function sleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
}

// Whether a URL's HOST is under one of the session's cookie domains (suffix
// semantics — the WIDE judgment, the opposite of urlOnAllowedHost's exact
// hosts): the hidden view's will-redirect guard scopes by the JAR's shape,
// not the data-source allowlist, so a main-frame hop between a service's
// own hosts (music → identity → music) stays free while a hop off the
// account dies. Anything unparseable is NOT under the domains.
function urlUnderCookieDomains(url, domains) {
  try {
    const host = String(new URL(url).hostname || '').toLowerCase();
    return domains.some((domain) => {
      const d = String(domain).replace(/^\./, '').toLowerCase();
      return host === d || host.endsWith('.' + d);
    });
  } catch {
    return false;
  }
}

// Whether a URL is https on one of the session's allowed hosts — EXACT host
// equality, deliberately NOT cookie-domain semantics: a session-bearing
// fetcher that reaches the whole cookie domain reaches the whole account
// (amazon.com is the retail account; the service is music.amazon.com), so the
// scope is the exact hosts the session's flows actually call (#1432 review,
// finding 1). https only — an http: URL would send the jar in the clear. The
// host's fetch (initial URL + every redirect hop) and the IPC bridge
// (fetch/pageFetch URLs, capture prefixes) share this one predicate so the
// two layers can never drift on what "allowed" means.
function urlOnAllowedHost(url, hosts) {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'https:') return false;
    const host = String(hostname).toLowerCase();
    return (Array.isArray(hosts) ? hosts : []).some((h) => String(h).toLowerCase() === host);
  } catch {
    return false;
  }
}

// Rule 5's data-only stop condition: `capture.doneWhen`, a small DECLARATIVE
// record the caller passes with the capture — `{ bodyIncludes?, urlIncludes? }`,
// each value a short non-empty string — naming the request it waits for. The
// host applies it and never invents one (a host-chosen match would be a
// service name in host code); this validator is the whole shape, shared by
// the IPC bridge so both seams enforce one rule. Returns null when the record
// is well-formed (or absent — no early stop), else the refusal message:
// known keys only, non-empty strings capped at 512 chars (a needle the caller
// writes, not a page to scan), at least one key (a condition that matches
// nothing is a caller bug, not a wait).
const DONE_WHEN_KEYS = ['bodyIncludes', 'urlIncludes'];
const DONE_WHEN_MAX_LEN = 512;
function captureDoneWhenProblem(doneWhen) {
  if (doneWhen === undefined || doneWhen === null) return null;
  if (typeof doneWhen !== 'object' || Array.isArray(doneWhen)) {
    return 'capture.doneWhen must be an object (a declarative stop condition: { bodyIncludes?, urlIncludes? })';
  }
  const keys = Object.keys(doneWhen);
  if (!keys.length) return `capture.doneWhen needs at least one of ${DONE_WHEN_KEYS.join(', ')}`;
  for (const key of keys) {
    if (!DONE_WHEN_KEYS.includes(key)) return `capture.doneWhen has an unknown key (${key}; known: ${DONE_WHEN_KEYS.join(', ')})`;
    const value = doneWhen[key];
    if (typeof value !== 'string' || !value.length) return `capture.doneWhen.${key} must be a non-empty string`;
    if (value.length > DONE_WHEN_MAX_LEN) return `capture.doneWhen.${key} must be at most ${DONE_WHEN_MAX_LEN} chars`;
  }
  return null;
}

// A header-complete capture satisfies a caller's doneWhen record: every
// present needle a substring of the capture's own field (bodyIncludes of the
// request body — a null body never matches; urlIncludes of the URL). Echoes
// (rule 4: our own in-flight pageFetch traffic) never satisfy it — the page's
// answer is what the caller named, not our own replay of it.
function captureSatisfiesDoneWhen(doneWhen, entry) {
  if (!doneWhen || !entry || !entry.headers) return false;
  if (entry.echo) return false;
  if (doneWhen.bodyIncludes && !(typeof entry.body === 'string' && entry.body.includes(doneWhen.bodyIncludes))) return false;
  if (doneWhen.urlIncludes && !(typeof entry.url === 'string' && entry.url.includes(doneWhen.urlIncludes))) return false;
  return true;
}

// The hidden view parks at a real size LEFT OF the window, not at 0×0: SPAs
// collapse widgets to max-width: 0 in a 0×0 view, and rows then never mount
// (search results included). A real size the user cannot see is the fix.
const OFFSCREEN_BOUNDS = { x: -1200, y: 0, width: 1100, height: 800 };

// A hardened Chrome UA for a host that wants its hidden views to look like a
// plain browser (service fingerprinting reads the Electron default). The
// session host is UA-agnostic: the caller builds and passes config.userAgent.
function chromeUserAgent() {
  const chrome = (process.versions && process.versions.chrome) || '131.0.0.0';
  const platform = process.platform === 'win32'
    ? 'Windows NT 10.0; Win64; x64'
    : process.platform === 'linux'
      ? 'X11; Linux x86_64'
      : 'Macintosh; Intel Mac OS X 10_15_7';
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
}

// The host's job queue (rule 1's serialization): one job runs at a time —
// real page navigation on the shared view, and the single webRequest listener
// slot per method — in two lanes. A FOREGROUND job (something the user is
// waiting on, such as a page they clicked) starts before every queued
// BACKGROUND job (prefetches, refreshes, fallbacks), FIFO within each lane.
// Which of its flows a plugin marks foreground is the plugin's choice; the
// lanes are the host's. A running job is never interrupted: a foreground job
// waits at most for the one in progress. A job that throws rejects its own
// promise only; the queue moves on. (#1423's createLaneQueue, carried into
// the host when the plugin's own queue was removed: one owner of the
// serialization, on the same instance that owns the gate and the fuse.)
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
        lanes[lane === 'foreground' ? 'foreground' : 'background'].push({ fn, resolve, reject });
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

// One web session: a hidden persistent view (partition), a visible sign-in
// window when asked, and the primitives above. createWebSessionHost(config):
//
//   id                  log/registry id ('amazon-music')
//   partition           Electron partition ('persist:amazon-music')
//   cookieDomains       domains the session's cookies live under
//                       (['amazon.com']) — state() reports and clear()
//                       removes these; on Android every WebView shares one
//                       CookieManager, so a wipe must be domain-scoped
//   allowedHosts         the EXACT hosts the session's data-source primitives
//                       may reach (['music.amazon.com',
//                       'gql.music.amazon.com']) — fetch()'s URL and every
//                       redirect hop are checked against this list, and the
//                       IPC bridge scopes fetch/pageFetch, capture prefixes
//                       and load/signIn URLs by it, read off the host (the
//                       cookieDomains are wider than the service on purpose:
//                       amazon.com is the whole retail account, and a
//                       session-bearing fetcher that reaches it reads the
//                       account — #1432 review, finding 1; load/signIn
//                       scope by the same list — Amazon's flows only ever
//                       navigate music.amazon.com, and a service whose
//                       sign-in starts on another host adds a navigation
//                       allowlist when it arrives)
//   signInTitle          the visible sign-in window's title ('Sign in to
//                       Amazon Music') — host config, never a caller choice
//                       (#1432 review, finding 3: a caller-chosen title on a
//                       chromeless window is a phishing surface); null falls
//                       back to `Sign in to <id>`
//   preload             preload path for the hidden view (null: none)
//   signInPreload       preload for the sign-in window (null: it must behave
//                       like a normal browser window)
//   userAgent           hardened UA for the hidden view (null: Electron default)
//   …plus a timeout/budget override for any DEFAULTS key
function createWebSessionHost(config = {}) {
  const cfg = { ...DEFAULTS, ...config };
  if (!cfg.id) throw new Error('web-session: config.id is required');
  if (!cfg.partition) throw new Error(`web-session ${cfg.id}: config.partition is required`);
  if (!Array.isArray(cfg.cookieDomains) || cfg.cookieDomains.length === 0) {
    throw new Error(`web-session ${cfg.id}: config.cookieDomains is required (state() reports and clear() removes these — a shared-cookie-store host must be able to scope them)`);
  }
  if (!Array.isArray(cfg.allowedHosts) || !cfg.allowedHosts.length || !cfg.allowedHosts.every((h) => typeof h === 'string' && h)) {
    throw new Error(`web-session ${cfg.id}: config.allowedHosts is required (the exact hosts fetch may reach and every redirect hop is re-checked against — the cookie domains are wider than the service, so a session-bearing fetcher scoped only by them reaches the whole account)`);
  }

  function electron() { return require('electron'); }

  const host = {
    // View/session state. Directly parallel to the old amazon-web-player's
    // fields of the same names; see the concurrency contract above.
    _host: null,          // the app window hosting the hidden view
    _view: null,          // the hidden view (search/import view)
    _authWindow: null,    // the visible sign-in window
    _chain: createLaneQueue(),   // loads serialize here (rule 1), two lanes: a foreground job starts ahead of queued background work
    _chainBusy: 0,        // in-flight load/pageFetch calls (rule 3's fuse check)
    _replayReaders: 0,    // in-flight pageFetches (rule 2's gate)
    _navigating: false,   // a load/park holds the writer side of the gate
    _parkTimer: null,     // the delayed idle park (rule 3)
    _capture: null,       // the CURRENT capture registration (see attachCapture)
    _generation: 0,       // bumped by clear(): a superseded load's finally must not detach a newer capture or re-arm the park
    _signInRun: null,     // the pending signIn promise (one ticker per open window)

    // The declared cookie domains, copied: state()/clear() scope by them —
    // they are the jar's own shape (on Android every WebView shares one
    // CookieManager, so a wipe must be domain-scoped), which is exactly why
    // the data-source URL scopes (allowedHosts below) are NOT them: a
    // session-bearing reach the width of the cookie domain is a reach the
    // width of the whole account.
    // The allowed hosts, copied for the same reason: fetch()'s URL gate and
    // every redirect hop are checked against this list, and the IPC bridge
    // scopes fetch/pageFetch, capture prefixes AND load/signIn URLs by it —
    // narrower than the cookie domains on purpose (see the config doc above,
    // #1432 finding 1).
    allowedHosts: [...cfg.allowedHosts],

    // ── Electron plumbing ───────────────────────────────────────────────────

    session() {
      const { session } = electron();
      const ses = session.fromPartition(cfg.partition);
      if (!ses.__parachordWebSessionPerms) {
        // Allowlist, not a denylist: a hidden third-party page has no business
        // requesting anything beyond the allowlist. Every denial logs once per
        // permission name so an unexpected request is visible without spam.
        const allowed = new Set(cfg.permissionAllowlist);
        const warned = new Set();
        const check = (permission) => {
          if (allowed.has(permission)) return true;
          if (!warned.has(permission)) {
            warned.add(permission);
            console.warn(`[web-session ${cfg.id}] denied permission request: ${permission}`);
          }
          return false;
        };
        ses.setPermissionRequestHandler((_wc, permission, callback) => callback(check(permission)));
        ses.setPermissionCheckHandler((_wc, permission) => check(permission));
        ses.__parachordWebSessionPerms = true;
      }
      return ses;
    },

    alive(target) {
      return !!(target && target.webContents && !target.webContents.isDestroyed());
    },

    setHost(win) {
      if (this._host && this._onHostClosed) {
        try { this._host.off('closed', this._onHostClosed); } catch { /* gone */ }
      }
      this._host = win && !win.isDestroyed() ? win : null;
      this._onHostClosed = null;
      if (!this._host) {
        this.destroyView(this._view);
        this._view = null;
        return;
      }
      this._onHostClosed = () => this.setHost(null);
      this._host.on('closed', this._onHostClosed);
      this.collapse(this._view);
    },

    destroy() {
      this.setHost(null);
      if (this.alive(this._authWindow)) {
        try { this._authWindow.close(); } catch { /* gone */ }
      }
      this._authWindow = null;
      this.cancelPark();
    },

    webPreferences({ preload = cfg.preload } = {}) {
      return {
        partition: cfg.partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload,
        webSecurity: true,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required'
      };
    },

    attachContents(wc) {
      const harden = () => {
        if (cfg.userAgent) {
          try { wc.setUserAgent(cfg.userAgent); } catch { /* destroyed */ }
        }
      };
      harden();
      try { wc.setBackgroundThrottling(false); } catch { /* destroyed */ }
      // A hidden page on this session must not spawn a visible window: the
      // default WOULD create one, carrying the session cookies without the
      // preload or the UA mask.
      try { wc.setWindowOpenHandler(() => ({ action: 'deny' })); } catch { /* destroyed */ }
      wc.on('did-start-navigation', harden);
      return wc;
    },

    collapse(view) {
      if (!view) return;
      try { view.setBounds({ x: 0, y: 0, width: 0, height: 0 }); } catch { /* gone */ }
    },

    layoutOffscreen(view) {
      if (!view) return 'none';
      try { view.setBounds({ ...OFFSCREEN_BOUNDS }); } catch { /* gone */ }
      return 'offscreen';
    },

    destroyView(view) {
      if (!view) return;
      try {
        if (this._host && !this._host.isDestroyed()) this._host.contentView.removeChildView(view);
      } catch { /* detached */ }
      try {
        if (view.webContents && !view.webContents.isDestroyed()) view.webContents.close();
      } catch { /* gone */ }
    },

    ensureView() {
      const { WebContentsView } = electron();
      if (this.alive(this._view)) {
        // An alive view keeps its layout (a 0×0 collapse here would
        // transiently collapse a live SPA's widgets — the exact condition
        // the offscreen layout exists to avoid; load lays it out anyway).
        return this._view;
      }
      if (!this._host || this._host.isDestroyed()) {
        throw notReady('not-ready', `[web-session ${cfg.id}] no host window for the hidden view`);
      }
      this.session();
      const view = new WebContentsView({ webPreferences: this.webPreferences() });
      this.attachContents(view.webContents);
      this._host.contentView.addChildView(view);
      this.collapse(view);
      this._view = view;
      // A main-frame hop off the cookie DOMAINS is refused in the hidden
      // view (#1432 advisory, 2026-11-17 follow-up, optional-but-cheap): the
      // start URL is allowedHosts-scoped at the bridge, but an open redirect
      // under an allowed host could otherwise browse the view — the
      // partition's cookies attached — to a caller-chosen site. The cookie
      // domains, not the allowlist: a service's own identity hop
      // (music → identity → music) must stay free. The sign-in window needs
      // none of this: following identity hops there is the point, and its
      // START url is what keeps it on the service's pages.
      try {
        view.webContents.on('will-redirect', (event, url, _isInPlace, isMainFrame) => {
          if (!isMainFrame) return;
          try {
            if (!urlUnderCookieDomains(url, cfg.cookieDomains)) event.preventDefault();
          } catch { /* a dying view refuses nothing */ }
        });
        // The same rule for a navigation the PAGE starts (a script setting
        // location, a meta refresh, a link or form): will-redirect sees only
        // server redirects. The host's own loads (loadURL) don't fire
        // will-navigate; their URLs are scoped at the bridge. will-navigate
        // is main-frame only.
        view.webContents.on('will-navigate', (event, url) => {
          try {
            const target = url || (event && event.url);
            if (!urlUnderCookieDomains(target, cfg.cookieDomains)) event.preventDefault();
          } catch { /* a dying view refuses nothing */ }
        });
      } catch { /* destroyed */ }
      view.webContents.on('destroyed', () => {
        if (this._view === view) this._view = null;
      });
      return view;
    },

    viewUrl() {
      const view = this._view;
      if (!this.alive(view)) return null;
      try { return view.webContents.getURL(); } catch { return null; }
    },

    // ── rule 3: the idle park fuse ─────────────────────────────────────────

    cancelPark() {
      if (this._parkTimer) {
        clearTimeout(this._parkTimer);
        this._parkTimer = null;
      }
    },

    schedulePark() {
      this.cancelPark();
      this._parkTimer = setTimeout(() => {
        this._parkTimer = null;
        // Busy at fire time: re-arm instead of blanking. A fuse armed by flow
        // A must never blank the view under flow B — the check is at FIRE
        // time, not arm time (cancel-at-entry is belt; this is the
        // suspenders).
        if (this._chainBusy > 0) {
          this.schedulePark();
          return;
        }
        this.park().catch(() => {});
      }, cfg.warmMs);
      if (typeof this._parkTimer.unref === 'function') this._parkTimer.unref();
    },

    async park() {
      this.cancelPark();
      const view = this._view;
      if (!this.alive(view)) return;
      this.collapse(view);
      // Blanking IS a navigation: take the writer side of the gate (rule 2),
      // so a pageFetch that entered between the busy check and the load is
      // waited out instead of having its frame torn down mid-fetch.
      await this.beginNavigation();
      try {
        const url = view.webContents.getURL();
        if (url && url !== 'about:blank') await view.webContents.loadURL('about:blank');
      } catch { /* gone */ } finally {
        this.endNavigation();
      }
    },

    // ── rule 2: the readers/writer gate ────────────────────────────────────
    //
    // pageFetch is a reader (many at once); a navigation — load() or the idle
    // park — is the writer (waits for all readers, excludes new ones).

    async beginNavigation() {
      // Writers exclude each other (an idle park and a load must not abort
      // each other's navigation). The reader drain is bounded (pageFetch by
      // pageFetchTimeoutMs, a load by loadTimeoutMs); the writer wait can
      // additionally sit behind the park's unbudgeted about:blank load — a
      // same-origin internal navigation that in practice does not stall.
      // The check-then-claim below has no await between the two, so two
      // writers cannot both claim.
      while (this._navigating) {
        await sleep(50);
      }
      // The flag flips BEFORE the reader drain, not after: readers arriving
      // while the drain is in progress must be refused, or a stream of
      // parallel pageFetches (which the architecture deliberately allows
      // off-chain) starves the navigation forever (the "sync flag flip
      // first, then drain" rule the deleted amazon-music-logic.js's old
      // createReplayGate taught, now the host's own gate).
      this._navigating = true;
      while (this._replayReaders > 0) {
        await sleep(50);
      }
    },

    endNavigation() {
      this._navigating = false;
    },

    tryEnterReplay() {
      if (this._navigating) return false;
      this._replayReaders += 1;
      return true;
    },

    exitReplay() {
      this._replayReaders = Math.max(0, this._replayReaders - 1);
    },

    // ── rule 1: the load chain, two lanes ────────────────────────────────
    //
    // enqueue(fn) runs one job at a time, serialized (rule 1); every job also
    // holds the busy count so the park fuse never blanks the view under a
    // flow it cannot see (rule 3). enqueue(fn, { lane: 'foreground' }) puts
    // the job on the FOREGROUND lane: it starts before every queued
    // background job, after the one already running (never interrupted).
    // Which of a plugin's flows deserves the foreground lane is plugin
    // knowledge — the lanes themselves are the host's (createLaneQueue).
    enqueue(fn, { lane = 'background' } = {}) {
      const pending = this._chain.pending();
      if (lane === 'foreground' && pending.background > 0) {
        console.log(`[web-session ${cfg.id}] foreground job goes ahead of ${pending.background} queued background job(s)`);
      }
      const busy = async () => {
        this._chainBusy += 1;
        try {
          return await fn();
        } finally {
          this._chainBusy -= 1;
        }
      };
      return this._chain.run(busy, { lane });
    },

    // ── rule 5 + the capture pairing: the request capture ──────────────────
    //
    // Bodies from onBeforeRequest, headers paired by request id from
    // onBeforeSendHeaders (which fires milliseconds later, and also fires for
    // requests with no body — preflights — so entries pair by id, never by
    // order). Requests seen while a pageFetch is in flight are flagged echo
    // (rule 4). A registration replaces a previous one: webRequest has a
    // single listener slot per method per session, which is exactly why loads
    // serialize (rule 1).

    attachCapture(urlPrefixes, doneWhen = null) {
      const ses = this.session();
      const filter = { urls: urlPrefixes };
      const captured = [];
      // ONLY the sign-in window's requests are refused (#1432 review, New:
      // the hidden-view alternative shipped first, and the maintainer chose
      // this shape instead): the webRequest listener is session-wide, and the
      // sign-in window shares the partition — its requests (the sign-in form's
      // POST body, password included) must never land in a caller's captures.
      // Everything else is KEPT — including requests Electron leaves the
      // webContentsId off (service-worker and other worker-issued traffic): a
      // keep-list shaped on the hidden view's id would drop those silently,
      // and a worker-issued request the page's flow depends on would then
      // never land in a capture at all — every capture would come back empty.
      // A missing or unknown id is kept, not refused. The sign-in window's id
      // is read LIVE so a closed-and-reopened window is never mistaken for
      // the one to refuse.
      const fromSignInWindow = (details) => {
        const wc = this.alive(this._authWindow) ? this._authWindow.webContents : null;
        const id = wc ? wc.id : null;
        return !!(id !== null && details && details.webContentsId === id);
      };
      // The refusal count, no URLs: a future regression (the sign-in window
      // dropping live captures, or a capture coming back suspiciously empty)
      // is readable in the field from this one line.
      let signInDrops = 0;
      // Captures record ONLY data requests (#1432 advisory, 2026-11-17
      // follow-up): the prefixes the callers register are gql and /api/
      // endpoints, always xhr/fetch — a main-frame navigation or redirect hop
      // TO a prefix host would carry a return-leg URL (a signed assertion, a
      // code) into a caller's captures, URL and all. Chromium reports both
      // XHR and fetch() as 'xhr' (recent Electrons also emit 'fetch');
      // either spelling is data.
      const isDataRequest = (details) => !!(details && (details.resourceType === 'xhr' || details.resourceType === 'fetch'));
      // This registration is the session's CURRENT capture (the webRequest
      // slot is single). detach() only clears the slot if this registration
      // is still the current one: a superseded load's finally (the old load
      // outlives a clear() that cut the chain) must never remove the
      // capture a NEWER load attached — it would return captures: [] with
      // the page's requests silently dropped (#1399 review). The
      // registration carries its own detach so clear() can release the
      // CURRENT one (a stale listener would record the partition's requests
      // into a dead array).
      const registration = { captured, detached: false, detach: null, snapshot: null, matched: false };
      // Rule 5's data-only early stop: when the caller names its match
      // (doneWhen), the window ends the moment a HEADER-COMPLETE capture
      // satisfies it — so the check lives here, on the pairing listener, not
      // in a poll: the stop fires exactly when the named request's headers
      // land (a body seen alone is not yet a capture — the pairing rule
      // above). whenDone() lets load() race the navigation against it (the
      // window can end before did-finish-load); awaitCaptureQuiet checks
      // `matched` and stops waiting. An echo (rule 4 — our own pageFetch
      // traffic carrying the same needle) never ends the window: the page's
      // answer is what the caller named, not our own replay of it.
      const doneWaiters = [];
      registration.whenDone = () => new Promise((resolve) => {
        if (registration.matched) resolve();
        else doneWaiters.push(resolve);
      });
      const doneWhenSatisfied = (entry) => {
        if (registration.matched || !captureSatisfiesDoneWhen(doneWhen, entry)) return;
        registration.matched = true;
        for (const resolve of doneWaiters) resolve();
        doneWaiters.length = 0;
      };
      const onRequest = (details, callback) => {
        try {
          if (!isDataRequest(details)) { callback({}); return; }
          if (fromSignInWindow(details)) { signInDrops += 1; callback({}); return; }
          let body = null;
          if (details.uploadData && details.uploadData.length) {
            body = details.uploadData.map((d) => (d.bytes ? d.bytes.toString('utf8') : '')).join('');
          }
          captured.push({
            _id: details.id,
            url: details.url,
            method: details.method,
            body,
            at: Date.now(),
            // Rule 4: our own in-flight page traffic is flagged, not trusted.
            echo: this._replayReaders > 0
          });
        } catch { /* keep other requests flowing */ }
        callback({});
      };
      const onSendHeaders = (details, callback) => {
        // Pairing by request id alone: a request refused in onRequest (the
        // sign-in window's) was never recorded, so it has no entry to pair.
        const mine = captured.find((r) => r._id === details.id) || null;
        if (mine) {
          // Cookie values never enter host capture state in either direction
          // (fetch()'s boundary rule, stated in its own comment): a capture
          // snapshot crosses to the renderer (webSession:load), and the jar's
          // values must not ride it. No consumer loses anything — the
          // page-world replay attaches cookies itself (credentials:
          // 'include'), and main-process replay consumers drop cookie headers
          // anyway (the plugin _lib's amazonGqlFetchHeaders, the old
          // amazon-music-logic.js's copy's heir). Case-
          // insensitive, Cookie and Cookie2 both: Chromium sends 'Cookie',
          // the stored copy must not smuggle a value in any spelling.
          const headers = {};
          for (const [name, value] of Object.entries(details.requestHeaders || {})) {
            const lower = String(name).toLowerCase();
            if (lower === 'cookie' || lower === 'cookie2') continue;
            headers[name] = value;
          }
          mine.headers = headers;
          // The early stop fires on the PAIRED entry (body + headers), the
          // same header-complete bar a snapshot's consumers see.
          doneWhenSatisfied(mine);
        }
        callback({ requestHeaders: details.requestHeaders });
      };
      try { ses.webRequest.onBeforeRequest(filter, onRequest); } catch { /* a second registration replaces */ }
      try { ses.webRequest.onBeforeSendHeaders(filter, onSendHeaders); } catch { /* a second registration replaces */ }
      registration.detach = () => {
        if (this._capture !== registration || registration.detached) return; // a newer registration owns the slot
        registration.detached = true;
        this._capture = null;
        if (signInDrops > 0) {
          // No URLs, just the count — the field-readable trace of the refusal
          // above (a capture that came back empty with drops at 0, or drops
          // climbing on every capture, both mean something moved).
          console.log(`[web-session ${cfg.id}] capture refused ${signInDrops} request(s) from the sign-in window (bodies never land in a caller's captures)`);
        }
        try { ses.webRequest.onBeforeRequest(filter, null); } catch { /* none */ }
        try { ses.webRequest.onBeforeSendHeaders(filter, null); } catch { /* none */ }
      };
      registration.snapshot = () => captured.map(({ _id, ...rest }) => ({ ...rest }));
      this._capture = registration;
      return registration;
    },

    // The quiet window (rule 5): after the navigation settles, keep capturing
    // until quietMs passes with no new captured request, never longer than
    // budgetMs. A page that has fired NOTHING yet is not quiet — it has not
    // started: with zero captures the wait runs to budgetMs (the old in-flow
    // poll's unconditional window), so a cold view whose first gql lands well
    // after load-finish is captured instead of reading "never fired". A
    // doneWhen match (checked every poll, and once at entry — it can fire
    // while the navigation still runs) ends the wait the moment it lands.
    async awaitCaptureQuiet(state, { quietMs = cfg.captureQuietMs, budgetMs = cfg.captureBudgetMs } = {}, generation) {
      const startAt = Date.now();
      for (;;) {
        if (state.matched) return; // the caller's named match ended the window
        await sleep(cfg.capturePollMs);
        // A clear() superseded this load: stop waiting — the session moved on.
        if (generation !== undefined && generation !== this._generation) return;
        if (state.matched) return;
        const elapsed = Date.now() - startAt;
        if (!state.captured.length) {
          if (elapsed >= budgetMs) return;
          continue;
        }
        const lastAt = state.captured[state.captured.length - 1].at;
        if (Date.now() - lastAt >= quietMs) return;
        if (elapsed >= budgetMs) return;
      }
    },

    // A budgeted navigation: a stalled network must not wedge the session's
    // chain for the Chromium network-stack timeout (minutes). The loser keeps
    // loading in the renderer (the next load aborts it, or the failure paths
    // blank it); we just stop waiting. The budget's rejection is marked
    // `loadTimedOut` — the load() below distinguishes "the budget ran out"
    // (which a capture may redeem, rule 5's escape) from a navigation that
    // actually failed.
    async loadURLBudgeted(view, url, timeoutMs = cfg.loadTimeoutMs) {
      const loaded = view.webContents.loadURL(url);
      loaded.catch(() => {}); // a late rejection after the race lost must not be unhandled
      let timer = null;
      try {
        await Promise.race([
          loaded,
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              const timeout = notReady('load-failed', `[web-session ${cfg.id}] page did not finish loading within ${timeoutMs}ms: ${url}`);
              timeout.loadTimedOut = true;
              reject(timeout);
            }, timeoutMs);
          })
        ]);
      } finally {
        clearTimeout(timer);
      }
    },

    // ── the primitives ─────────────────────────────────────────────────────

    // load(url, { timeoutMs, capture: { urlPrefixes, quietMs, budgetMs, doneWhen, returnOnTimeout } })
    // → { finalUrl, captures } — captures present only when capture was asked
    // for. Serialized per session (rule 1); waits out in-flight pageFetches
    // (rule 2); captures flag echoes (rule 4) and end on quiet/budget, or on
    // the caller's doneWhen match — the data-only early stop (rule 5). A
    // budget that fires with captures held throws load-failed unless the
    // caller OPTED IN to rule 5's escape (capture.returnOnTimeout — the
    // caller that knows how to judge a half-loaded page's captures says so).
    async load(url, opts = {}) {
      // Validate before ANY state is touched: a bad argument must not leave
      // a created-but-never-laid-out view or a disarmed park fuse behind.
      if (opts.capture && (!Array.isArray(opts.capture.urlPrefixes) || !opts.capture.urlPrefixes.every((p) => typeof p === 'string'))) {
        throw notReady('invalid', `[web-session ${cfg.id}] capture needs urlPrefixes (an array of URL patterns)`);
      }
      const doneWhenProblem = captureDoneWhenProblem(opts.capture && opts.capture.doneWhen);
      if (doneWhenProblem) {
        throw notReady('invalid', `[web-session ${cfg.id}] ${doneWhenProblem}`);
      }
      if (opts.capture && opts.capture.returnOnTimeout !== undefined && opts.capture.returnOnTimeout !== null
        && typeof opts.capture.returnOnTimeout !== 'boolean') {
        throw notReady('invalid', `[web-session ${cfg.id}] capture.returnOnTimeout must be a boolean (the opt-in to rule 5's budget escape)`);
      }
      return this.enqueue(async () => {
        const generation = this._generation; // clear() bumps this: a superseded load's teardown must not touch the new session state
        const view = this.ensureView();
        // The offscreen size, not the 0×0 collapse: SPAs collapse widgets to
        // max-width: 0 in a 0×0 view, and the page's own requests then never
        // fire (the old amazon-web-player's layoutSearch ran per flow for exactly
        // this — a load without it captures nothing).
        this.layoutOffscreen(view);
        this.cancelPark();
        const captureState = opts.capture ? this.attachCapture(opts.capture.urlPrefixes, opts.capture.doneWhen) : null;
        try {
          let loadTimedOut = false;
          await this.beginNavigation();
          try {
            if (captureState && opts.capture.doneWhen) {
              // The data-only early stop (rule 5): the caller's named match
              // can land while the page is still loading — the window ends
              // AT the match, without waiting out did-finish-load (a slow
              // subresource must not hold the answer hostage). The loser
              // navigation keeps loading in the background; its late
              // rejection is handled here, never an unhandled one.
              const nav = this.loadURLBudgeted(view, url, opts.timeoutMs);
              nav.catch(() => {}); // the loser's late failure never surfaces as unhandled
              await Promise.race([nav, captureState.whenDone()]);
            } else {
              await this.loadURLBudgeted(view, url, opts.timeoutMs);
            }
          } catch (error) {
            // Rule 5's escape (the #1423 bug class), OPT-IN ONLY
            // (capture.returnOnTimeout): the navigation budget ran out, but
            // the capture already holds requests — the page's requests were
            // the point of the load, not the finished document (a slow
            // subresource keeps did-finish-load from firing long after the
            // page's gql). The host cannot know which request matters (the
            // matcher is plugin-side), so the caller that knows how to judge
            // a half-loaded page's captures opts in and gets what was
            // captured with the flag. Every other caller keeps the old
            // contract: a budget timeout — with captures held or not — or a
            // genuine navigation failure throws load-failed, which those
            // callers already treat as transient (a spec search must not
            // read a slow page as a structural "never searched").
            if (captureState && opts.capture.returnOnTimeout && error && error.loadTimedOut && captureState.snapshot().length) {
              loadTimedOut = true;
            } else {
              throw error;
            }
          } finally {
            this.endNavigation();
          }
          if (captureState && !loadTimedOut) {
            // The quiet window (rule 5) — raced against the caller's named
            // match when there is one: the window ends AT the match, not at
            // the next poll (a match that fired mid-navigation already
            // resolved whenDone, and this race is a no-op).
            if (opts.capture.doneWhen) {
              await Promise.race([
                this.awaitCaptureQuiet(captureState, opts.capture, generation),
                captureState.whenDone()
              ]);
            } else {
              await this.awaitCaptureQuiet(captureState, opts.capture, generation);
            }
          }
          // A clear() superseded this load: its captures belong to the OLD
          // account (a caller could mint a session-template from them) — the
          // load rejects, the plugin treats it as failed.
          if (this._generation !== generation) {
            throw notReady('superseded', `[web-session ${cfg.id}] the session was cleared while this load ran`);
          }
          const finalUrl = this.alive(view) ? view.webContents.getURL() : '';
          return {
            finalUrl,
            ...(captureState ? { captures: captureState.snapshot() } : {}),
            ...(loadTimedOut ? { loadTimedOut: true } : {})
          };
        } finally {
          if (captureState) captureState.detach();
          // A load superseded by clear() does not re-arm the park fuse: the
          // next session's view lifecycle is not its to schedule.
          if (this._generation === generation) this.schedulePark();
        }
      });
    },

    // pageFetch({ url, method, headers, body }, { readerHeld }) → { status, text } | { error }
    // — a fetch from inside the page world: the page supplies the origin,
    // cookies and CORS. Parallel-safe (a reader). Never throws: every failure
    // is a recoverable { error }.
    //
    // A pageFetch is itself a reader on the navigation gate (rule 2). A
    // caller that ALREADY holds a reader for a multi-page replay under one
    // tryEnterReplay (a walk over a captured connection) passes
    // { readerHeld: true }: its own pages must not come back `busy` under a
    // navigation that is waiting for that same outer reader to drain — the
    // walk's outer reader is the gate coverage for every page it fetches.
    async pageFetch(request = {}, { readerHeld = false } = {}) {
      if (!request.url || typeof request.url !== 'string') return { error: 'pageFetch needs a url' };
      if (!readerHeld && !this.tryEnterReplay()) return { error: 'busy' }; // a navigation holds the gate
      this._chainBusy += 1;
      this.cancelPark();
      try {
        const view = this._view;
        if (!this.alive(view)) return { error: 'no-view' };
        let href = '';
        try { href = view.webContents.getURL(); } catch { /* destroyed */ }
        // A fetch needs an origin page world (about:blank is a null origin:
        // no cookies, no CORS) — the caller reloads a page first.
        if (!href || href === 'about:blank') return { error: 'no-origin-page' };
        // The page world the fetch runs in is the page's own, so only one of
        // the session's allowed hosts may host it: a page anywhere else could
        // have replaced window.fetch. Checked again after the fetch, in case
        // the page changed while it ran; a result from another page is
        // dropped.
        if (!urlOnAllowedHost(href, cfg.allowedHosts)) return { error: 'page-off-host' };
        const body = request.body === undefined || request.body === null
          ? undefined
          : (typeof request.body === 'string' ? request.body : JSON.stringify(request.body));
        // GET like fetch(): the two primitives must not default to different
        // verbs for a caller that leaves method out (#1399 review).
        const script = PAGE_FETCH_SCRIPT(request.url, request.method || 'GET', request.headers || {}, body);
        let outcome;
        try {
          outcome = await Promise.race([
            view.webContents.executeJavaScript(script),
            new Promise((resolve) => {
              const timer = setTimeout(() => resolve({ error: `pageFetch exceeded ${cfg.pageFetchTimeoutMs}ms` }), cfg.pageFetchTimeoutMs);
              if (typeof timer.unref === 'function') timer.unref();
            })
          ]);
        } catch (error) {
          return { error: String((error && (error.message || error)) || error) };
        }
        let hrefAfter = '';
        try { hrefAfter = view.webContents.getURL(); } catch { /* destroyed */ }
        if (!urlOnAllowedHost(hrefAfter, cfg.allowedHosts)) return { error: 'page-off-host' };
        if (!outcome || typeof outcome !== 'object') return { error: 'pageFetch returned nothing' };
        if (outcome.error) return { error: String(outcome.error) };
        return { status: outcome.status, text: outcome.text };
      } finally {
        this._chainBusy -= 1;
        if (!readerHeld) this.exitReplay();
        // Re-arm the fuse: pageFetch activity keeps the view warm the same
        // warmMs as a load (a session whose last call was a pageFetch would
        // otherwise idle on the service page at full speed forever — the
        // fuse's whole reason).
        this.schedulePark();
      }
    },

    // The cookie jar read for a URL, names + values — host-internal only; a
    // cookie value never crosses the primitive boundary.
    async jarCookies(url) {
      const ses = this.session();
      try {
        return await ses.cookies.get({ url });
      } catch {
        return [];
      }
    },

    // fetch({ url, method, headers, body, timeoutMs }) → { status, headers, text }
    // — a request outside any page carrying the session's cookies. CHROMINIUM
    // OWNS THE JAR: useSessionCookies makes net.request attach the partition's
    // cookies on every hop (redirects included) and save/delete/reject
    // response cookies by browser rules — the host does not parse Set-Cookie
    // and does not build a Cookie header (the old "net does not attach a
    // partition jar reliably" note was this: useSessionCookies defaults to
    // false; verified against a live Electron 44 + local server, review on
    // #1399). The boundary rules stay: a caller's own Cookie header is
    // dropped (the host owns what is sent), and the returned headers carry
    // set-cookie NAMES only — values never cross the boundary in either
    // direction. Budgeted like every other wait (default loadTimeoutMs), and
    // the request is ABORTED when the budget fires.
    //
    // THE ALLOWLIST (finding 1): the URL must be https on one of the
    // session's allowedHosts, and EVERY redirect hop is re-checked — a hop
    // that leaves the list is not followed (the jar rides every hop, so a
    // hop to any other host is the same reach as an off-list initial URL;
    // net.request follows redirects by default, and a handled 'redirect'
    // event must followRedirect() synchronously or the request is CANCELLED —
    // which is exactly the abort we want).
    async fetch(request = {}) {
      if (!request.url || typeof request.url !== 'string') throw notReady('invalid', 'web-session fetch needs a url');
      if (!urlOnAllowedHost(request.url, cfg.allowedHosts)) {
        throw notReady('invalid', `web-session ${cfg.id} fetch: URL must be https on one of the session's allowed hosts (${cfg.allowedHosts.join(', ')}) — the cookie domains are wider than the service, and this fetch carries the session's cookies`);
      }
      const { net } = electron();
      const ses = this.session();
      const headers = { ...(request.headers || {}) };
      // The host owns what is sent. (Cookie values cannot contain CRLF —
      // Chromium enforces it on set — so this cannot smuggle headers.)
      delete headers.Cookie; delete headers.cookie; delete headers.Cookie2; delete headers.cookie2;
      const method = request.method || 'GET';
      const body = request.body === undefined || request.body === null
        ? undefined
        : (typeof request.body === 'string' ? request.body : JSON.stringify(request.body));
      const timeoutMs = request.timeoutMs || cfg.loadTimeoutMs;
      return await new Promise((resolve) => {
        let req;
        try {
          req = net.request({ method, url: request.url, session: ses, useSessionCookies: true });
        } catch (error) {
          resolve({ status: -1, headers: {}, text: String((error && (error.message || error)) || error) });
          return;
        }
        for (const [k, v] of Object.entries(headers)) {
          try { req.setHeader(k, v); } catch { /* bad header name */ }
        }
        const chunks = [];
        let settled = false;
        const finish = (out) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          // Chromium already saved the response cookies (it owns the jar);
          // names only out, never values.
          if (out.headers) {
            const setCookie = out.headers['set-cookie'] || out.headers['Set-Cookie'];
            if (setCookie) {
              const names = (Array.isArray(setCookie) ? setCookie : [setCookie])
                .map((line) => String(line).split('=')[0].trim())
                .filter(Boolean);
              delete out.headers['set-cookie'];
              delete out.headers['Set-Cookie'];
              if (names.length) out.headers['set-cookie'] = names;
            }
          }
          resolve(out);
        };
        const timer = setTimeout(() => {
          try { req.abort(); } catch { /* gone */ }
          finish({ status: -1, headers: {}, text: `web-session fetch exceeded ${timeoutMs}ms` });
        }, timeoutMs);
        if (typeof timer.unref === 'function') timer.unref();
        // Finding 1's hop rule: net.request follows redirects by default, so
        // the hop is re-checked here, host-side where the hops are visible.
        // On Electron's DEFAULT redirect strategy (this request sets none)
        // the loader still emits 'redirect' for every hop: followRedirect()
        // is a NO-OP there (the follow already happens), and abort() cancels
        // the loader BEFORE the follow — verified by reading Electron's
        // sources (#1432 advisory, 2026-11-17); the refusal settles below.
        req.on('redirect', (statusCode, method, redirectUrl) => {
          if (urlOnAllowedHost(redirectUrl, cfg.allowedHosts)) {
            try { req.followRedirect(); } catch { /* gone */ }
            return;
          }
          try { req.abort(); } catch { /* gone */ }
          finish({ status: -1, headers: {}, text: `web-session ${cfg.id} fetch refused a redirect hop off the session's allowed hosts (${cfg.allowedHosts.join(', ')}): ${redirectUrl}` });
        });
        req.on('response', (res) => {
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            finish({
              status: res.statusCode,
              headers: { ...(res.headers || {}) },
              text: Buffer.concat(chunks).toString('utf8')
            });
          });
        });
        req.on('error', (error) => finish({ status: -1, headers: {}, text: String((error && (error.message || error)) || error) }));
        req.end(body);
      });
    },

    // state() → { url, signInUrl, cookieNames, generation } — the facts,
    // nothing judged. url is the hidden view's current page (its last
    // navigation — a plugin reads walls from it); signInUrl the sign-in
    // window's (null when closed); cookieNames the names of the session's
    // cookies under its declared domains, empty-valued entries dropped (an
    // empty value is a deletion in flight, not a session); generation the
    // clear()-bumped session counter — the plugin cannot see the sign-out
    // event, so this is how it detects one and drops the caches it minted
    // under the old account.
    async state() {
      const url = this.viewUrl();
      let signInUrl = null;
      if (this.alive(this._authWindow)) {
        try { signInUrl = this._authWindow.webContents.getURL(); } catch { /* destroyed */ }
      }
      const cookieNames = await this.cookieNames();
      return { url, signInUrl, cookieNames, generation: this._generation };
    },

    // Cookie names for the session's declared domains (a shared-cookie-store
    // host — Android's one CookieManager for the whole app — must be able to
    // report and clear ONLY these; a whole-partition read is the desktop
    // shortcut, not the contract).
    async cookieNames() {
      const names = new Set();
      for (const domain of cfg.cookieDomains) {
        const url = `https://${domain.replace(/^\./, '')}/`;
        for (const cookie of await this.jarCookies(url)) {
          if (cookie.value) names.add(cookie.name);
        }
      }
      return [...names].sort();
    },

    // The sign-in trace: every page the window visits (host + path only; a
    // query can carry tokens) and the session cookie NAMES as they appear —
    // a sign-in that closes too early or never finishes reads from the log.
    traceUrl(url) {
      try {
        const u = new URL(url);
        return `${u.host}${u.pathname}`;
      } catch {
        return String(url || '').split('?')[0];
      }
    },

    async traceSignIn(url, cookieNames) {
      const page = this.traceUrl(url);
      if (page !== this._tracePage) {
        this._tracePage = page;
        console.log(`[web-session ${cfg.id}] sign-in page: ${page}`);
      }
      const names = cookieNames.join(',');
      if (names !== this._traceCookies) {
        this._traceCookies = names;
        console.log(`[web-session ${cfg.id}] sign-in cookies: ${names || '(none)'}`);
      }
    },

    // signIn(url, { decide, width, height }) → { signedIn }.
    //
    // The host shows a VISIBLE window on the session's partition and ticks
    // once a second; decide({ url, cookieNames, stableTicks }) — the plugin's
    // pure verdict — closes it (truthy) or keeps waiting. The person closing
    // it first resolves { signedIn: false }: closed-without-a-verdict is NOT a
    // signed-in. stableTicks counts consecutive same-url ticks (the host's
    // fact; the verdict that uses it is the plugin's). The window's TITLE is
    // host config (cfg.signInTitle, `Sign in to <id>` fallback) — never a
    // caller choice (#1432 review, finding 3: a caller-chosen title on a
    // window with no URL bar is a phishing surface).
    async signIn(url, { decide, width = 980, height = 760 } = {}) {
      if (typeof decide !== 'function') {
        throw notReady('invalid', `[web-session ${cfg.id}] signIn needs a decide() verdict`);
      }
      // One ticker per open window: a second signIn while the window is open
      // focuses it and JOINS the pending promise — running a second interval
      // would double every decide() call (#1399 review).
      if (this._signInRun) {
        const open = this._authWindow;
        if (open && !open.isDestroyed()) {
          open.show();
          open.focus();
        }
        return this._signInRun;
      }
      const { BrowserWindow } = electron();
      let win = this._authWindow;
      if (!this.alive(win)) {
        this.session();
        const parent = this._host && !this._host.isDestroyed() ? this._host : null;
        win = new BrowserWindow({
          width,
          height,
          show: true,
          title: cfg.signInTitle || `Sign in to ${cfg.id}`,
          backgroundColor: '#000000',
          skipTaskbar: false,
          parent: parent || undefined,
          webPreferences: this.webPreferences({ preload: cfg.signInPreload === undefined ? null : cfg.signInPreload })
        });
        this.attachContents(win.webContents);
        win.on('closed', () => {
          if (this._authWindow === win) this._authWindow = null;
        });
        this._authWindow = win;
        // Unbudgeted on purpose: this is the one window the person watches. A
        // stalled load is visible (and recoverable by retrying); rejecting
        // here would abandon a sign-in flow that may still complete.
        await win.loadURL(url);
      }
      win.show();
      win.focus();
      this._tracePage = null;
      this._traceCookies = null;
      const run = new Promise((resolve) => {
        let settled = false;
        let lastUrl = null;
        let stableTicks = 0;
        const finish = (signedIn) => {
          if (settled) return;
          settled = true;
          clearInterval(timer);
          if (this._signInRun === run) this._signInRun = null;
          resolve({ signedIn: !!signedIn });
        };
        const timer = setInterval(async () => {
          if (win.isDestroyed()) return; // 'closed' below settles it
          const url = win.webContents.getURL();
          const cookieNames = await this.cookieNames().catch(() => []);
          await this.traceSignIn(url, cookieNames).catch(() => {});
          stableTicks = url === lastUrl ? stableTicks + 1 : 0;
          lastUrl = url;
          let verdict = false;
          try {
            verdict = !!decide({ url, cookieNames, stableTicks });
          } catch (error) {
            console.warn(`[web-session ${cfg.id}] sign-in decide() threw (ignored):`, (error && error.message) || error);
          }
          if (!verdict) return;
          console.log(`[web-session ${cfg.id}] sign-in landed on ${this.traceUrl(url)} (stable ticks: ${stableTicks})`);
          clearInterval(timer);
          setTimeout(() => {
            if (win && !win.isDestroyed()) win.close();
          }, 600);
          finish(true);
        }, cfg.signInTickMs);
        win.on('closed', () => finish(false));
      });
      this._signInRun = run;
      return run;
    },

    // Sign out: the views die and the session's storage clears. On Electron a
    // partition clear is the whole partition (nothing else lives in it — a
    // superset of the declared cookieDomains, which is the portable contract
    // a shared-cookie-store host implements instead). A plugin's session-
    // scoped caches (request templates embedding the old session's headers,
    // parsed content of the old account) are the plugin's to drop — clear()
    // here is only the host half.
    async clear() {
      try { this.destroyView(this._view); } catch { /* gone */ }
      this._view = null;
      if (this.alive(this._authWindow)) {
        try { this._authWindow.close(); } catch { /* gone */ }
      }
      this._authWindow = null;
      this._chain = createLaneQueue(); // cut BOTH lanes: a new account starts clean
      // Supersede everything a load still in flight holds: the next
      // generation's captures are not its to detach, its fuse is not the
      // one to arm. The CURRENT registration is released here (not just
      // forgotten): a stale listener would keep recording the partition's
      // requests — the sign-in window shares it — into a dead array. The
      // bump is also state()'s sign-out signal: a plugin holding
      // session-scoped caches (a plan reading, a request template) compares
      // the generation it cached state against.
      this._generation += 1;
      if (this._capture) this._capture.detach();
      this._capture = null;
      this.cancelPark();
      try {
        await this.session().clearStorageData();
      } catch (error) {
        return { success: false, error: String((error && error.message) || error) };
      }
      return { success: true };
    }
  };

  return host;
}

module.exports = { createWebSessionHost, createLaneQueue, chromeUserAgent, urlOnAllowedHost, captureDoneWhenProblem };
