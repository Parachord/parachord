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
//   pageFetch(request)       → { status, text } | { error } — a fetch from
//                               inside the page world (its origin, cookies,
//                               CORS), parallel-safe
//   fetch(request)           → { status, headers, text } — a request outside
//                               the page carrying the session's cookies; the
//                               host owns the Cookie header, and a cookie
//                               VALUE never crosses this boundary
//   state()                  → { url, signInUrl, cookieNames } — the facts a
//                               plugin composes its signed-in/wall verdicts
//                               from (names only, never values)
//   signIn(url, { decide })  → { signedIn } — a visible window ticked at the
//                               host; decide({url, cookieNames, stableTicks})
//                               is the plugin's pure verdict
//   clear()                  — sign out: views die, the storage clears
//
// ── The concurrency contract (the half the primitive signatures don't show) ──
//
// One hidden view serves every flow of the session, and it is shared state
// with sharp edges. The rules below are what amazon-web-player.js learned
// the hard way; they are the contract, not an implementation detail:
//
//   1. LOADS SERIALIZE. webRequest has a single listener slot per method per
//      session, so two page loads must never interleave captures. Every load
//      runs on an internal chain, one at a time. A plugin that wants flow-level
//      serialization (a multi-step import) serializes itself; the host
//      guarantees no two of ITS loads overlap.
//   2. A NAVIGATION WAITS OUT IN-FLIGHT PAGEFETCHES. Tearing a frame mid-fetch
//      kills a replay; the readers/writer gate (pageFetch = reader, load and
//      the idle park = writer) drains readers before any navigation. A
//      pageFetch that arrives while a navigation holds the gate resolves
//      { error: 'busy' } — the caller falls back to its page flow.
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
//   5. THE CAPTURE WINDOW IS QUIET-BOUNDED. A load returns its captures when
//      the page's request burst goes quiet (quietMs without a new capture
//      after the load finishes), never later than budgetMs. The matcher is
//      the plugin's (pure, over the returned captures); the host cannot know
//      which request matters, so it must not stop early on a match it can't
//      see.
//
// The capture listener itself pairs bodies (onBeforeRequest) with headers
// (onBeforeSendHeaders) by request id — onBeforeSendHeaders fires
// milliseconds AFTER onBeforeRequest, so a capture accepted on its body
// alone can race its own headers; and onBeforeSendHeaders also fires for
// requests with no body (preflights), so entries pair by id, never by order.
//
// Error convention: load() throws an Error with .reason ('load-failed',
// 'not-ready', 'invalid') for host failures — the same shape
// amazon-web-player's flows throw today; pageFetch() never throws — every
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

// One web session: a hidden persistent view (partition), a visible sign-in
// window when asked, and the primitives above. createWebSessionHost(config):
//
//   id                  log/registry id ('amazon-music')
//   partition           Electron partition ('persist:amazon-music')
//   cookieDomains       domains the session's cookies live under
//                       (['amazon.com']) — state() reports and clear()
//                       removes these; on Android every WebView shares one
//                       CookieManager, so a wipe must be domain-scoped
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

  function electron() { return require('electron'); }

  const host = {
    // View/session state. Directly parallel to amazon-web-player's fields of
    // the same names; see the concurrency contract above.
    _host: null,          // the app window hosting the hidden view
    _view: null,          // the hidden view (search/import view)
    _authWindow: null,    // the visible sign-in window
    _chain: Promise.resolve(), // loads serialize here (rule 1)
    _chainBusy: 0,        // in-flight load/pageFetch calls (rule 3's fuse check)
    _replayReaders: 0,    // in-flight pageFetches (rule 2's gate)
    _navigating: false,   // a load/park holds the writer side of the gate
    _parkTimer: null,     // the delayed idle park (rule 3)

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
      // off-chain) starves the navigation forever (createReplayGate's "sync
      // flag flip first, then drain" rule).
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

    // ── rule 1: the load chain ──────────────────────────────────────────────

    enqueue(fn) {
      const busy = async () => {
        this._chainBusy += 1;
        try {
          return await fn();
        } finally {
          this._chainBusy -= 1;
        }
      };
      const run = this._chain.then(busy, busy);
      this._chain = run.then(() => {}, () => {});
      return run;
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

    attachCapture(urlPrefixes) {
      const ses = this.session();
      const filter = { urls: urlPrefixes };
      const captured = [];
      const onRequest = (details, callback) => {
        try {
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
        const mine = captured.find((r) => r._id === details.id);
        if (mine) mine.headers = details.requestHeaders;
        callback({ requestHeaders: details.requestHeaders });
      };
      try { ses.webRequest.onBeforeRequest(filter, onRequest); } catch { /* a second registration replaces */ }
      try { ses.webRequest.onBeforeSendHeaders(filter, onSendHeaders); } catch { /* a second registration replaces */ }
      const detach = () => {
        try { ses.webRequest.onBeforeRequest(filter, null); } catch { /* none */ }
        try { ses.webRequest.onBeforeSendHeaders(filter, null); } catch { /* none */ }
      };
      return {
        captured,
        detach,
        snapshot() {
          return captured.map(({ _id, ...rest }) => ({ ...rest }));
        }
      };
    },

    // The quiet window (rule 5): after the navigation settles, keep capturing
    // until quietMs passes with no new captured request, never longer than
    // budgetMs.
    async awaitCaptureQuiet(state, { quietMs = cfg.captureQuietMs, budgetMs = cfg.captureBudgetMs } = {}) {
      const startAt = Date.now();
      for (;;) {
        await sleep(cfg.capturePollMs);
        const elapsed = Date.now() - startAt;
        const lastAt = state.captured.length ? state.captured[state.captured.length - 1].at : startAt;
        if (Date.now() - lastAt >= quietMs) return;
        if (elapsed >= budgetMs) return;
      }
    },

    // A budgeted navigation: a stalled network must not wedge the session's
    // chain for the Chromium network-stack timeout (minutes). The loser keeps
    // loading in the renderer (the next load aborts it, or the failure paths
    // blank it); we just stop waiting.
    async loadURLBudgeted(view, url, timeoutMs = cfg.loadTimeoutMs) {
      const loaded = view.webContents.loadURL(url);
      loaded.catch(() => {}); // a late rejection after the race lost must not be unhandled
      let timer = null;
      try {
        await Promise.race([
          loaded,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(notReady('load-failed', `[web-session ${cfg.id}] page did not finish loading within ${timeoutMs}ms: ${url}`)), timeoutMs);
          })
        ]);
      } finally {
        clearTimeout(timer);
      }
    },

    // ── the primitives ─────────────────────────────────────────────────────

    // load(url, { timeoutMs, capture: { urlPrefixes, quietMs, budgetMs } })
    // → { finalUrl, captures } — captures present only when capture was asked
    // for. Serialized per session (rule 1); waits out in-flight pageFetches
    // (rule 2); captures flag echoes (rule 4) and end on quiet/budget (rule 5).
    async load(url, opts = {}) {
      // Validate before ANY state is touched: a bad argument must not leave
      // a created-but-never-laid-out view or a disarmed park fuse behind.
      if (opts.capture && (!Array.isArray(opts.capture.urlPrefixes) || !opts.capture.urlPrefixes.every((p) => typeof p === 'string'))) {
        throw notReady('invalid', `[web-session ${cfg.id}] capture needs urlPrefixes (an array of URL patterns)`);
      }
      return this.enqueue(async () => {
        const view = this.ensureView();
        // The offscreen size, not the 0×0 collapse: SPAs collapse widgets to
        // max-width: 0 in a 0×0 view, and the page's own requests then never
        // fire (amazon-web-player's layoutSearch ran per flow for exactly
        // this — a load without it captures nothing).
        this.layoutOffscreen(view);
        this.cancelPark();
        const captureState = opts.capture ? this.attachCapture(opts.capture.urlPrefixes) : null;
        try {
          await this.beginNavigation();
          try {
            await this.loadURLBudgeted(view, url, opts.timeoutMs);
          } finally {
            this.endNavigation();
          }
          if (captureState) await this.awaitCaptureQuiet(captureState, opts.capture);
          const finalUrl = this.alive(view) ? view.webContents.getURL() : '';
          return {
            finalUrl,
            ...(captureState ? { captures: captureState.snapshot() } : {})
          };
        } finally {
          if (captureState) captureState.detach();
          this.schedulePark();
        }
      });
    },

    // pageFetch({ url, method, headers, body }) → { status, text } | { error }
    // — a fetch from inside the page world: the page supplies the origin,
    // cookies and CORS. Parallel-safe (a reader). Never throws: every failure
    // is a recoverable { error }.
    async pageFetch(request = {}) {
      if (!request.url || typeof request.url !== 'string') return { error: 'pageFetch needs a url' };
      if (!this.tryEnterReplay()) return { error: 'busy' }; // a navigation holds the gate
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
        const body = request.body === undefined || request.body === null
          ? undefined
          : (typeof request.body === 'string' ? request.body : JSON.stringify(request.body));
        const script = PAGE_FETCH_SCRIPT(request.url, request.method || 'POST', request.headers || {}, body);
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
        if (!outcome || typeof outcome !== 'object') return { error: 'pageFetch returned nothing' };
        if (outcome.error) return { error: String(outcome.error) };
        return { status: outcome.status, text: outcome.text };
      } finally {
        this._chainBusy -= 1;
        this.exitReplay();
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
    // — a request outside any page carrying the session's cookies. The host
    // owns the Cookie header (built from the jar for the request's own URL —
    // Electron's net does not attach a partition jar reliably): a caller's
    // own Cookie header is dropped, and cookie values never reach the caller.
    async fetch(request = {}) {
      if (!request.url || typeof request.url !== 'string') throw notReady('invalid', 'web-session fetch needs a url');
      const { net } = electron();
      const ses = this.session();
      const jar = await this.jarCookies(request.url);
      const cookieHeader = jar.filter((c) => c.value).map((c) => `${c.name}=${c.value}`).join('; ');
      const headers = { ...(request.headers || {}) };
      // The host owns cookies on this path. (Cookie values cannot contain
      // CRLF — Chromium enforces it on set — so this cannot smuggle headers.)
      delete headers.Cookie; delete headers.cookie; delete headers.Cookie2; delete headers.cookie2;
      if (cookieHeader) headers.Cookie = cookieHeader;
      const method = request.method || 'GET';
      const body = request.body === undefined || request.body === null
        ? undefined
        : (typeof request.body === 'string' ? request.body : JSON.stringify(request.body));
      const timeoutMs = request.timeoutMs || null;
      return await new Promise((resolve) => {
        let req;
        try {
          req = net.request({ method, url: request.url, session: ses });
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
          resolve(out);
        };
        const timer = timeoutMs
          ? setTimeout(() => finish({ status: -1, headers: {}, text: `web-session fetch exceeded ${timeoutMs}ms` }), timeoutMs)
          : null;
        req.on('response', (res) => {
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => finish({
            status: res.statusCode,
            headers: { ...(res.headers || {}) },
            text: Buffer.concat(chunks).toString('utf8')
          }));
        });
        req.on('error', (error) => finish({ status: -1, headers: {}, text: String((error && (error.message || error)) || error) }));
        req.end(body);
      });
    },

    // state() → { url, signInUrl, cookieNames } — the facts, nothing judged.
    // url is the hidden view's current page (its last navigation — a plugin
    // reads walls from it); signInUrl the sign-in window's (null when closed);
    // cookieNames the names of the session's cookies under its declared
    // domains, empty-valued entries dropped (an empty value is a deletion in
    // flight, not a session).
    async state() {
      const url = this.viewUrl();
      let signInUrl = null;
      if (this.alive(this._authWindow)) {
        try { signInUrl = this._authWindow.webContents.getURL(); } catch { /* destroyed */ }
      }
      const cookieNames = await this.cookieNames();
      return { url, signInUrl, cookieNames };
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

    // signIn(url, { decide, width, height, title }) → { signedIn }.
    //
    // The host shows a VISIBLE window on the session's partition and ticks
    // once a second; decide({ url, cookieNames, stableTicks }) — the plugin's
    // pure verdict — closes it (truthy) or keeps waiting. The person closing
    // it first resolves { signedIn: false }: closed-without-a-verdict is NOT a
    // signed-in. stableTicks counts consecutive same-url ticks (the host's
    // fact; the verdict that uses it is the plugin's).
    async signIn(url, { decide, width = 980, height = 760, title } = {}) {
      if (typeof decide !== 'function') {
        throw notReady('invalid', `[web-session ${cfg.id}] signIn needs a decide() verdict`);
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
          title: title || `Sign in to ${cfg.id}`,
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
      return new Promise((resolve) => {
        let settled = false;
        let lastUrl = null;
        let stableTicks = 0;
        const finish = (signedIn) => {
          if (settled) return;
          settled = true;
          clearInterval(timer);
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
      this._chain = Promise.resolve(); // cut the queue: a new account starts clean
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

module.exports = { createWebSessionHost, chromeUserAgent };
