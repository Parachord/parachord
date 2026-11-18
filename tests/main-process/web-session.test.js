/**
 * main-process/web-session.js — the generic web-session host (#1356), the
 * half of the Amazon split that stays in every app: the hidden view, the
 * request capture, the page-world fetch, the cookie-jar fetch, sign-in and
 * the view lifecycle. This file pins the concurrency contract (see the
 * module header): loads serialize, navigations wait out in-flight
 * pageFetches, the idle park never blanks a busy view, captures flag the
 * host's own page traffic, and the capture window is quiet-bounded.
 *
 * Everything runs against a mocked electron (WebContentsView, BrowserWindow,
 * session.fromPartition with webRequest + cookies, net.request) — the same
 * jest.mock factory pattern as tests/main-process/widevine-amazon-provider.
 */

// ── the electron mock ────────────────────────────────────────────────────────
// jest.mock factories are hoisted and may only reference mock*-prefixed
// module state; every construction helper lives inside the factory.

const mockPartitions = new Map(); // partition → fake session
let mockWebContentsSeq = 0;       // ids for the webRequest webContentsId filter
const mockViews = [];            // every WebContentsView the host created
const mockAuthWindows = [];      // every BrowserWindow the host created
const mockNetRequests = [];
const mockNetHandlers = [];
let mockJarCookies = [];

jest.mock('electron', () => {
  function hostOf(url) {
    try { return '.' + new URL(url).hostname.split('.').slice(-2).join('.'); } catch (e) { return null; }
  }

  function makeWebContents({ startUrl = 'about:blank' } = {}) {
    const pending = [];
    const wc = {
      _url: startUrl,
      _handlers: {},
      id: ++mockWebContentsSeq, // what webRequest details carry as webContentsId
      isDestroyed: () => false,
      getURL() { return wc._url; },
      loadURL: jest.fn(async (url) => {
        wc._url = url;
        if (wc._hangNextLoad) {
          wc._hangNextLoad = false;
          await new Promise((resolve) => pending.push(resolve)); // freed by close()
          if (url !== 'about:blank') throw new Error('ERR_ABORTED (view destroyed)');
        }
      }),
      executeJavaScript: jest.fn(),
      setUserAgent: jest.fn(),
      setBackgroundThrottling: jest.fn(),
      setWindowOpenHandler: jest.fn(),
      close: jest.fn(() => {
        wc._url = 'about:blank';
        pending.splice(0).forEach((resolve) => resolve());
        wc.isDestroyed = () => true;
        (wc._handlers.destroyed || []).forEach((cb) => cb());
      }),
      on(event, cb) { (wc._handlers[event] = wc._handlers[event] || []).push(cb); }
    };
    return wc;
  }

  class MockWebContentsView {
    constructor({ webPreferences }) {
      this.webPreferences = webPreferences;
      this.webContents = makeWebContents();
      this.bounds = null;
      mockViews.push(this);
    }
    setBounds(b) { this.bounds = b; }
  }

  class MockBrowserWindow {
    constructor(opts) {
      // Copy named fields only: Object.assign(this, opts) would shadow the
      // show() method with the show: true OPTION (a live bug these tests
      // caught by existing).
      this.webPreferences = opts.webPreferences;
      this.parent = opts.parent;
      this.title = opts.title;
      this.showOpt = opts.show;
      this.skipTaskbar = opts.skipTaskbar;
      this.webContents = makeWebContents();
      this._handlers = {};
      this.isDestroyed = () => false;
      this.shown = false;
      mockAuthWindows.push(this);
    }
    async loadURL(url) { this.webContents._url = url; }
    show() { this.shown = true; }
    focus() { this.focused = true; }
    close() {
      this.isDestroyed = () => true;
      (this._handlers.closed || []).forEach((cb) => cb());
    }
    on(event, cb) { (this._handlers[event] = this._handlers[event] || []).push(cb); }
  }

  function partitionSession(partition) {
    if (!mockPartitions.has(partition)) {
      const listeners = { _onBeforeRequest: null, _onBeforeSendHeaders: null };
      mockPartitions.set(partition, {
        webRequest: {
          onBeforeRequest: jest.fn((_filter, cb) => { listeners._onBeforeRequest = cb; }),
          onBeforeSendHeaders: jest.fn((_filter, cb) => { listeners._onBeforeSendHeaders = cb; })
        },
        __listeners: listeners,
        cookies: {
          get: jest.fn(async ({ url } = {}) => {
            let host = null;
            try { host = new URL(url).hostname; } catch (e) { host = null; }
            return mockJarCookies.filter((c) =>
              host && (c.domain === host || c.domain === '.' + host || host.endsWith(c.domain.replace(/^\\./, ''))));
          }),
          // The jar write path for response cookies (the host builds the
          // request Cookie header itself, so Chromium does not save them).
          set: jest.fn(async (cookie) => {
            const key = cookie.name + '|' + (cookie.domain || '');
            const i = mockJarCookies.findIndex((c) => c.name + '|' + (c.domain || '') === key);
            if (i >= 0) mockJarCookies.splice(i, 1);
            mockJarCookies.push({ name: cookie.name, value: cookie.value, domain: cookie.domain || hostOf(cookie.url) });
          })
        },
        setPermissionRequestHandler: jest.fn(),
        setPermissionCheckHandler: jest.fn(),
        clearStorageData: jest.fn().mockResolvedValue(undefined)
      });
    }
    return mockPartitions.get(partition);
  }

  return {
    WebContentsView: MockWebContentsView,
    BrowserWindow: MockBrowserWindow,
    session: { fromPartition: (p) => partitionSession(p) },
    net: {
      // A mock of net.request's redirect OUTCOME (#1432 advisory
      // verification, 2026-11-17): the real request is built with no
      // redirectStrategy option, so Electron's default 'follow' strategy
      // runs — the loader still emits 'redirect' per hop, followRedirect()
      // is a no-op there, and abort() cancels the loader BEFORE the follow.
      // This mock models the same outcome the other way up: followRedirect()
      // flips the flag that lets the hop proceed; no follow means the
      // request dies (the abort/no-response shape the host relies on).
      request: (opts) => {
        const headers = {};
        const record = { opts, headers, body: null, handlers: {}, aborted: false };
        mockNetRequests.push(record);
        const respond = () => {
          const handler = mockNetHandlers.shift() || (() => ({ status: 200, text: '{}' }));
          const out = handler({ url: opts.url, headers, body: record.body });
          // A handler returning nothing hangs the request (the timeout path).
          if (!out) return;
          if (out.redirect) {
            if (typeof record.handlers.redirect === 'function') {
              record.followedRedirect = false;
              record.handlers.redirect(out.status || 301, opts.method || 'GET', out.redirect, {});
              if (!record.followedRedirect) return; // cancelled: nothing follows
              opts.url = out.redirect;
              setImmediate(respond);
              return;
            }
            opts.url = out.redirect; // no listener: net follows by default
            setImmediate(respond);
            return;
          }
          const { status, text, headers: resHeaders } = out;
          const res = {
            statusCode: status,
            headers: resHeaders || { 'content-type': 'application/json' },
            on: (ev, cb) => {
              if (ev === 'data') setImmediate(() => cb(Buffer.from(text)));
              if (ev === 'end') setImmediate(() => cb());
              return res;
            }
          };
          record.handlers.response(res);
        };
        const req = {
          setHeader: (k, v) => { headers[k] = v; },
          abort: () => { record.aborted = true; },
          followRedirect: () => { record.followedRedirect = true; },
          on: (event, cb) => { record.handlers[event] = cb; return req; },
          end: (body) => {
            record.body = body;
            respond();
          }
        };
        return req;
      }
    }
  };
});

// ── harness ─────────────────────────────────────────────────────────────────

const { createWebSessionHost } = require('../../main-process/web-session');

const PARTITION = 'persist:testsvc';

const theSession = () => mockPartitions.get(PARTITION);

function makeHostWindow() {
  const kids = [];
  const win = {
    isDestroyed: () => false,
    contentView: {
      children: kids,
      addChildView: (v) => kids.push(v),
      removeChildView: (v) => { const i = kids.indexOf(v); if (i >= 0) kids.splice(i, 1); }
    },
    _handlers: {},
    on(event, cb) { (this._handlers[event] = this._handlers[event] || []).push(cb); },
    off(event, cb) { this._handlers[event] = (this._handlers[event] || []).filter((f) => f !== cb); },
    close() { (this._handlers.closed || []).forEach((cb) => cb()); }
  };
  return win;
}

function newSession(overrides = {}) {
  return createWebSessionHost({
    id: 'testsvc',
    partition: PARTITION,
    cookieDomains: ['testsvc.com'],
    // The exact-host allowlist, deliberately narrower than the cookie domain
    // (the #1432 finding-1 shape: the domain is the account, the hosts are
    // the service — like Amazon's music + gql hosts).
    allowedHosts: ['music.testsvc.com', 'gql.testsvc.com'],
    preload: '/path/to/preload.js',
    userAgent: 'UA/1.0',
    ...overrides
  });
}

// A host with its hidden view created and parked on an origin page — the
// usual starting state for capture/replay flows (the view materializes on
// the first load, like amazon-web-player's).
async function warmSession(overrides = {}) {
  const host = newSession({ warmMs: 60000, ...overrides });
  const win = makeHostWindow();
  host.setHost(win);
  await host.load('https://music.testsvc.com/home');
  const view = host._view;
  return { host, win, view };
}

// Fire a captured request into the session's webRequest listeners, the way a
// real page would: onBeforeRequest (body) fires before onBeforeSendHeaders
// (headers) — the pairing the capture must survive.
// The hidden view's webContents id: the last alive view the mock created —
// the usual page-traffic shape in every capture flow.
function currentViewId() {
  for (let i = mockViews.length - 1; i >= 0; i -= 1) {
    const wc = mockViews[i] && mockViews[i].webContents;
    if (wc && !wc.isDestroyed()) return wc.id;
  }
  return null;
}

// Fire a captured request into the session's webRequest listeners, the way a
// real page would: onBeforeRequest (body) fires before onBeforeSendHeaders
// (headers) — the pairing the capture must survive. webContentsId defaults to
// the hidden view's; pass another id to fire as another window on the same
// partition, or null-ABSENT the property to fire as a worker (Electron
// leaves the id off worker-issued traffic — the capture must KEEP those,
// #1432 review round 2: the refusal keys on the sign-in window's id only).
function fireCaptured(opts) {
  const { id, url = 'https://gql.testsvc.com/', method = 'POST', body = '{"query":"q"}', headers, resourceType = 'xhr' } = opts;
  const webContentsId = Object.prototype.hasOwnProperty.call(opts, 'webContentsId') ? opts.webContentsId : currentViewId();
  const listeners = theSession().__listeners;
  // A detached capture (a late request after the load window closed) is a
  // real state, not a crash — drop it.
  if (typeof listeners._onBeforeRequest !== 'function') return;
  listeners._onBeforeRequest({ id, url, method, resourceType, webContentsId, uploadData: body ? [{ bytes: Buffer.from(body) }] : [] }, () => {});
  listeners._onBeforeSendHeaders({ id, url, method, resourceType, webContentsId, requestHeaders: headers || { 'x-api-key': 'k' } }, () => {});
}

beforeEach(() => {
  jest.useFakeTimers();
  mockPartitions.clear();
  mockViews.length = 0;
  mockAuthWindows.length = 0;
  mockNetRequests.length = 0;
  mockNetHandlers.length = 0;
  mockJarCookies = [];
});

afterEach(() => {
  jest.useRealTimers();
});

// ── load — navigation, capture, the quiet window ───────────────────────────

describe('load — navigation, capture, the quiet window', () => {
  test('returns finalUrl and captures with headers paired by request id', async () => {
    const { host, view } = await warmSession();
    const pending = host.load('https://music.testsvc.com/search/x/songs', {
      capture: { urlPrefixes: ['https://gql.testsvc.com/*'], quietMs: 1000 }
    });
    await jest.advanceTimersByTimeAsync(0);
    // onBeforeRequest fires milliseconds BEFORE onBeforeSendHeaders. The
    // view's webContentsId rides each detail (kept unless it is the sign-in
    // window's; data request types only).
    const listeners = theSession().__listeners;
    const viewId = view.webContents.id;
    listeners._onBeforeRequest({ id: 7, url: 'https://gql.testsvc.com/', method: 'POST', resourceType: 'xhr', webContentsId: viewId, uploadData: [{ bytes: Buffer.from('{"operationName":"Search"}') }] }, () => {});
    listeners._onBeforeSendHeaders({ id: 7, url: 'https://gql.testsvc.com/', method: 'POST', resourceType: 'xhr', webContentsId: viewId, requestHeaders: { 'csrf-token': 'tok' } }, () => {});
    await jest.advanceTimersByTimeAsync(1200);
    const result = await pending;
    expect(result.finalUrl).toBe('https://music.testsvc.com/search/x/songs');
    expect(result.captures).toEqual([
      expect.objectContaining({
        url: 'https://gql.testsvc.com/',
        method: 'POST',
        body: '{"operationName":"Search"}',
        headers: { 'csrf-token': 'tok' },
        echo: false
      })
    ]);
  });

  test('body-less requests (preflights) are captured too, body null', async () => {
    const { host } = await warmSession();
    const pending = host.load('https://music.testsvc.com/', {
      capture: { urlPrefixes: ['https://gql.testsvc.com/*'], quietMs: 1000 }
    });
    await jest.advanceTimersByTimeAsync(0);
    fireCaptured({ id: 1, method: 'OPTIONS', body: null });
    await jest.advanceTimersByTimeAsync(1200);
    const result = await pending;
    expect(result.captures[0].method).toBe('OPTIONS');
    expect(result.captures[0].body).toBeNull();
    expect(result.captures[0].headers).toEqual({ 'x-api-key': 'k' });
  });

  test('captured headers carry no cookie keys, in any case spelling (values never cross the boundary)', async () => {
    const { host } = await warmSession();
    const pending = host.load('https://music.testsvc.com/', {
      capture: { urlPrefixes: ['https://gql.testsvc.com/*'], quietMs: 1000 }
    });
    await jest.advanceTimersByTimeAsync(0);
    // The page's request rides the jar (Chromium attached it); the stored
    // copy must not — a snapshot crosses to the renderer via webSession:load.
    fireCaptured({
      id: 9,
      headers: {
        'csrf-token': 'tok',
        Cookie: 'at-main=SECRET',
        cookie: 'session-id=SECRET',
        COOKIE: 'x-main=SECRET',
        cOoKiE: 'ubid-main=SECRET',
        Cookie2: 'c2=SECRET',
        COOKIE2: 'c2b=SECRET',
        'x-api-key': 'k'
      }
    });
    await jest.advanceTimersByTimeAsync(1200);
    const result = await pending;
    expect(result.captures[0].headers).toEqual({ 'csrf-token': 'tok', 'x-api-key': 'k' });
  });

  test("captures refuse ONLY the sign-in window's requests — a worker's (no id) and any other window's are KEPT (#1432 review, round 2)", async () => {
    const { host } = await warmSession();
    // Open the real sign-in window — the refusal keys on ITS webContents id,
    // read live. The hidden-view keep-list this replaced would have dropped
    // worker-issued traffic (Electron leaves their id off), and a capture a
    // page's workers drive would have come back empty.
    const signInRun = host.signIn('https://music.testsvc.com/', { decide: () => false });
    await jest.advanceTimersByTimeAsync(0);
    const auth = mockAuthWindows[mockAuthWindows.length - 1];
    const signInId = auth.webContents.id;
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const pending = host.load('https://music.testsvc.com/', {
      capture: { urlPrefixes: ['https://gql.testsvc.com/*'], quietMs: 1000 }
    });
    await jest.advanceTimersByTimeAsync(0);
    // The sign-in window shares the partition: its POST bodies (a sign-in
    // form carries the password) must never land in a caller's captures.
    fireCaptured({ id: 1, body: '{"from":"the hidden view"}' });
    fireCaptured({ id: 2, body: '{"from":"the sign-in window","email":"a@b.c","password":"hunter2"}', webContentsId: signInId });
    fireCaptured({ id: 3, body: '{"from":"a worker"}', webContentsId: undefined });            // no id: KEPT
    fireCaptured({ id: 4, body: '{"from":"another window"}', webContentsId: 4242 });           // unknown id ≠ sign-in window: KEPT
    await jest.advanceTimersByTimeAsync(1200);
    const result = await pending;
    expect(result.captures).toHaveLength(3);
    expect(result.captures.map((c) => c.body)).toEqual([
      '{"from":"the hidden view"}',
      '{"from":"a worker"}',
      '{"from":"another window"}'
    ]);
    // The field-readable trace: the refusal COUNT logged at detach, no
    // URLs, no body — a regression where the sign-in window starts producing
    // capture-matched traffic, or every capture comes back empty, is
    // readable from this one line.
    const refusedLines = logSpy.mock.calls
      .map((args) => args.map(String).join(' '))
      .filter((s) => s.includes('refused'));
    expect(refusedLines).toHaveLength(1);
    expect(refusedLines[0]).toMatch(/refused 1 request/);
    for (const leak of ['hunter2', 'a@b.c', 'gql.testsvc.com']) {
      expect(refusedLines[0]).not.toContain(leak);
    }
    logSpy.mockRestore();
    // Close the sign-in window so its run settles { signedIn: false }.
    auth.close();
    await expect(signInRun).resolves.toEqual({ signedIn: false });
  });

  test('captures record only DATA requests — a navigation to a prefix host never lands, URL and all (#1432 advisory, 2026-11-17 follow-up)', async () => {
    const { host } = await warmSession();
    const pending = host.load('https://music.testsvc.com/', {
      capture: { urlPrefixes: ['https://gql.testsvc.com/*'], quietMs: 1000 }
    });
    await jest.advanceTimersByTimeAsync(0);
    // A main-frame hop to a prefix-matched URL can carry a return-leg
    // credential in the query — a navigation is NOT data, so it is never
    // recorded (its URL included).
    fireCaptured({ id: 1, url: 'https://gql.testsvc.com/return?assertion=leak-me', body: null, resourceType: 'mainFrame' });
    fireCaptured({ id: 2, body: '{"from":"the page flow"}', resourceType: 'xhr' });
    fireCaptured({ id: 3, body: '{"from":"a fetch()"}', resourceType: 'fetch' });
    await jest.advanceTimersByTimeAsync(1200);
    const result = await pending;
    expect(result.captures).toHaveLength(2);
    expect(result.captures.map((c) => c.body)).toEqual(['{"from":"the page flow"}', '{"from":"a fetch()"}']);
  });

  test('a cold view whose first capture lands past quietMs is still returned (the budget covers it)', async () => {
    // Zero captures is NOT quiet — the page has not started. The wait runs
    // to budgetMs for the first request, so a cold view whose first gql
    // fires well after load-finish is captured instead of reading "never
    // fired" (the old in-flow poll's unconditional window; the plugin sizes
    // its quietMs for the same gap).
    const { host } = await warmSession();
    const pending = host.load('https://music.testsvc.com/', {
      capture: { urlPrefixes: ['https://gql.testsvc.com/*'], quietMs: 1000, budgetMs: 2000 }
    });
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(1500); // past quietMs, still zero captures
    fireCaptured({ id: 1 }); // the cold view's first gql, 1.5s in
    await jest.advanceTimersByTimeAsync(1100); // quiet since the capture
    const result = await pending;
    expect(result.captures.length).toBe(1);
  });

  test('the capture window ends on quiet, bounded by budget', async () => {
    const { host } = await warmSession();
    const pending = host.load('https://music.testsvc.com/', {
      capture: { urlPrefixes: ['https://gql.testsvc.com/*'], quietMs: 1000, budgetMs: 2000 }
    });
    await jest.advanceTimersByTimeAsync(0);
    let n = 0;
    const rain = setInterval(() => fireCaptured({ id: ++n }), 500); // never quiet
    await jest.advanceTimersByTimeAsync(3000);
    clearInterval(rain);
    const result = await pending;
    expect(result.captures.length).toBeGreaterThanOrEqual(4); // the budget, not quiet, ended it
  });

  test('doneWhen ends the capture window at the matching header-complete capture — BEFORE did-finish-load (rule 5)', async () => {
    const { host, view } = await warmSession();
    // The page never finishes loading (a slow subresource): without the
    // early stop the window cannot even start (the quiet poll waits for the
    // navigation to settle), and a 10s quiet tail would answer past any
    // caller's patience. doneWhen is the caller naming its match as data, and
    // the host stopping on it is still rule 5 — the host never stops on a
    // match it can't see, the caller TOLD it what the match is.
    view.webContents._hangNextLoad = true;
    const loadRun = host.load('https://music.testsvc.com/albums/B1', {
      capture: {
        urlPrefixes: ['https://gql.testsvc.com/*'],
        quietMs: 5000,
        budgetMs: 15000,
        doneWhen: { bodyIncludes: '"AlbumDetailPage"' }
      }
    });
    await jest.advanceTimersByTimeAsync(0);
    fireCaptured({ id: 1, body: '{"operationName":"AlbumSeo"}' });        // captured, not the match
    fireCaptured({ id: 2, body: '{"operationName":"AlbumDetailPage"}' }); // the match: the window ends here
    await jest.advanceTimersByTimeAsync(100); // one poll — far under quietMs
    const result = await loadRun;
    expect(result.captures.map((c) => c.body)).toEqual([
      '{"operationName":"AlbumSeo"}',
      '{"operationName":"AlbumDetailPage"}'
    ]);
    // The still-loading navigation is the loser: freeing it later (its
    // ERR_ABORTED rejection) must never surface as an unhandled rejection —
    // the load answered, the navigation's fate is nobody's news.
    view.webContents.close();
    await jest.advanceTimersByTimeAsync(0);
  });

  test('doneWhen ends the quiet window the moment the match lands after load too', async () => {
    const { host } = await warmSession();
    const loadRun = host.load('https://music.testsvc.com/albums/B1', {
      capture: {
        urlPrefixes: ['https://gql.testsvc.com/*'],
        quietMs: 5000,
        budgetMs: 15000,
        doneWhen: { bodyIncludes: '"AlbumDetailPage"' }
      }
    });
    await jest.advanceTimersByTimeAsync(0); // the load settles; the window is open
    await jest.advanceTimersByTimeAsync(1000); // nothing captured yet
    fireCaptured({ id: 1, body: '{"operationName":"AlbumDetailPage"}' });
    await jest.advanceTimersByTimeAsync(50); // under one poll — the match ends the window itself
    const result = await loadRun;
    expect(result.captures.map((c) => c.body)).toEqual(['{"operationName":"AlbumDetailPage"}']);
  });

  test('captures that do not satisfy doneWhen wait out the quiet window, exactly as without it', async () => {
    const { host } = await warmSession();
    const loadRun = host.load('https://music.testsvc.com/albums/B1', {
      capture: {
        urlPrefixes: ['https://gql.testsvc.com/*'],
        quietMs: 1000,
        budgetMs: 15000,
        doneWhen: { bodyIncludes: '"AlbumDetailPage"' } // never arrives
      }
    });
    await jest.advanceTimersByTimeAsync(0);
    fireCaptured({ id: 1, body: '{"operationName":"AlbumSeo"}' });
    fireCaptured({ id: 2, body: '{"operationName":"PlaybackContextSeed"}' });
    await jest.advanceTimersByTimeAsync(800); // still inside the quiet tail
    let settled = false;
    loadRun.then(() => { settled = true; });
    await jest.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false); // the window is still open
    await jest.advanceTimersByTimeAsync(300); // a poll past quietMs since the last capture
    const result = await loadRun;
    expect(result.captures).toHaveLength(2); // both kept, matched nothing
  });

  test('a doneWhen with no capture at all does nothing weird: the zero-capture budget rule holds', async () => {
    const { host } = await warmSession();
    // The needle never lands (the page fired nothing): the cold-view rule —
    // zero captures is NOT quiet — runs the wait to the budget, the early
    // stop simply never firing.
    const loadRun = host.load('https://music.testsvc.com/albums/B1', {
      capture: {
        urlPrefixes: ['https://gql.testsvc.com/*'],
        quietMs: 1000,
        budgetMs: 2000,
        doneWhen: { bodyIncludes: '"AlbumDetailPage"' }
      }
    });
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(1500); // past quietMs, still zero captures
    let settled = false;
    loadRun.then(() => { settled = true; });
    await jest.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(600); // the budget, not quiet, ends it
    const result = await loadRun;
    expect(result.captures).toEqual([]);
  });

  test('an ECHOED capture never satisfies doneWhen — our own replay traffic is not the page\'s answer (rules 4+5)', async () => {
    const { host, view } = await warmSession();
    let releaseFetch;
    view.webContents.executeJavaScript.mockImplementation(() => new Promise((resolve) => { releaseFetch = resolve; }));
    const fetchRun = host.pageFetch({ url: 'https://gql.testsvc.com/' });
    await jest.advanceTimersByTimeAsync(0);
    const loadRun = host.load('https://music.testsvc.com/albums/B1', {
      capture: {
        urlPrefixes: ['https://gql.testsvc.com/*'],
        quietMs: 1000,
        budgetMs: 3000,
        doneWhen: { bodyIncludes: '"AlbumDetailPage"' }
      }
    });
    await jest.advanceTimersByTimeAsync(300);
    // Our own in-flight replay of the detail op — the exact needle, flagged
    // echo — must not end the window; the page's own request does, after it.
    fireCaptured({ id: 1, body: '{"operationName":"AlbumDetailPage"}' }); // echo: true
    releaseFetch({ status: 200, text: '{}' });
    await fetchRun;
    fireCaptured({ id: 2, body: '{"operationName":"AlbumDetailPage"}' }); // the page's own
    await jest.advanceTimersByTimeAsync(200); // one poll past the match
    const result = await loadRun;
    expect(result.captures.map((c) => c.echo)).toEqual([true, false]);
  });

  test('a malformed doneWhen is invalid before any state is touched, like bad prefixes', async () => {
    const { host } = await warmSession();
    for (const doneWhen of [
      'AlbumDetailPage',                                   // not an object
      {},                                                 // no condition — matches nothing
      { needle: 'x' },                                    // unknown key
      { bodyIncludes: 42 },                               // not a string
      { bodyIncludes: '' },                               // matches everything — a bug, not a wait
      { bodyIncludes: 'x'.repeat(513) }                   // not a needle the caller writes
    ]) {
      await expect(host.load('https://music.testsvc.com/albums/B1', {
        capture: { urlPrefixes: ['https://gql.testsvc.com/*'], doneWhen }
      })).rejects.toMatchObject({ reason: 'invalid' });
    }
  });

  test('a stalled navigation with NOTHING captured still throws load-failed and detaches the capture', async () => {
    // The no-requests case of the budget timeout: nothing redeems it (rule
    // 5's escape below needs captures in hand).
    const { host, view } = await warmSession();
    view.webContents._hangNextLoad = true;
    const attempt = host.load('https://music.testsvc.com/', {
      timeoutMs: 500,
      capture: { urlPrefixes: ['https://gql.testsvc.com/*'] }
    });
    attempt.catch(() => {}); // its rejection fires inside the timer advance
    await jest.advanceTimersByTimeAsync(600);
    await expect(attempt).rejects.toMatchObject({ reason: 'load-failed' });
    // The capture listeners are detached (webRequest has one listener slot).
    const webRequest = theSession().webRequest;
    expect(webRequest.onBeforeRequest).toHaveBeenLastCalledWith(expect.anything(), null);
    expect(webRequest.onBeforeSendHeaders).toHaveBeenLastCalledWith(expect.anything(), null);
  });

  test("a stalled navigation with captures held still throws load-failed when the caller did NOT opt in (the default contract)", async () => {
    // The escape is opt-in per load (#1437 review round 2, New 1): a budget
    // that fires with captures held used to resolve for EVERY capture load,
    // and the flows that never read loadTimedOut misread it — a spec search
    // read a half-loaded page's captures as a structural "never searched"
    // and tripped the breaker, the album lookup read a miss where its
    // lagging detail op never even got its quiet window. The default keeps
    // the old contract: load-failed, transient, exactly what those flows
    // already handle.
    const { host, view } = await warmSession();
    view.webContents._hangNextLoad = true;
    const attempt = host.load('https://music.testsvc.com/', {
      timeoutMs: 500,
      capture: { urlPrefixes: ['https://gql.testsvc.com/*'], quietMs: 1000 }
    });
    attempt.catch(() => {}); // its rejection fires inside the timer advance
    await jest.advanceTimersByTimeAsync(0);
    // The page fired its gql while the navigation hangs — the capture holds
    // it, and the budget still throws.
    fireCaptured({ id: 11, body: '{"operationName":"playlistDetail"}' });
    await jest.advanceTimersByTimeAsync(600);
    await expect(attempt).rejects.toMatchObject({ reason: 'load-failed' });
    // The capture listeners are detached and the gate was released either way.
    const webRequest = theSession().webRequest;
    expect(webRequest.onBeforeRequest).toHaveBeenLastCalledWith(expect.anything(), null);
    expect(webRequest.onBeforeSendHeaders).toHaveBeenLastCalledWith(expect.anything(), null);
    expect(host.tryEnterReplay()).toBe(true);
    host.exitReplay();
  });

  test('a non-boolean returnOnTimeout is invalid before any state is touched, like a bad prefix', async () => {
    const { host } = await warmSession();
    for (const returnOnTimeout of ['yes', 1]) {
      await expect(host.load('https://music.testsvc.com/', {
        capture: { urlPrefixes: ['https://gql.testsvc.com/*'], returnOnTimeout }
      })).rejects.toMatchObject({ reason: 'invalid' });
    }
  });

  test("a stalled navigation with captures already held returns them with loadTimedOut when the caller OPTED IN (rule 5's escape, the #1423 bug class)", async () => {
    // One slow subresource keeps did-finish-load from firing long after the
    // page fired its gql: the request was the point of the load, not the
    // finished document. The host cannot judge the capture (the matcher is
    // the caller's), so the caller that knows how opts in
    // (capture.returnOnTimeout) and gets what the window holds with the
    // flag; the not-opted-in case is the test below.
    const { host, view } = await warmSession();
    view.webContents._hangNextLoad = true;
    const pending = host.load('https://music.testsvc.com/', {
      timeoutMs: 500,
      capture: { urlPrefixes: ['https://gql.testsvc.com/*'], quietMs: 1000, returnOnTimeout: true }
    });
    await jest.advanceTimersByTimeAsync(0);
    // The page fired its gql while the navigation hangs.
    fireCaptured({ id: 11, body: '{"operationName":"playlistDetail"}' });
    await jest.advanceTimersByTimeAsync(600);
    const result = await pending;
    expect(result.loadTimedOut).toBe(true);
    expect(result.finalUrl).toBe('https://music.testsvc.com/');
    expect(result.captures).toEqual([
      expect.objectContaining({ body: '{"operationName":"playlistDetail"}', headers: { 'x-api-key': 'k' } })
    ]);
    // Resolving at once: the quiet window never runs past a budget that
    // already fired (the result above would still be waiting on quietMs).
    // The capture listeners are detached and the gate was released either way.
    const webRequest = theSession().webRequest;
    expect(webRequest.onBeforeRequest).toHaveBeenLastCalledWith(expect.anything(), null);
    expect(webRequest.onBeforeSendHeaders).toHaveBeenLastCalledWith(expect.anything(), null);
    expect(host.tryEnterReplay()).toBe(true);
    host.exitReplay();
  });

  test('no host window → not-ready', async () => {
    const host = newSession();
    await expect(host.load('https://music.testsvc.com/')).rejects.toMatchObject({ reason: 'not-ready' });
  });
});

describe('the load chain — rule 1: loads serialize', () => {
  test('a foreground job starts before every queued background job, after the running one', async () => {
    const host = newSession();
    const order = [];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    host.enqueue(async () => { order.push('running'); await gate; });
    const bg = host.enqueue(async () => { order.push('bg'); });
    const fg = host.enqueue(async () => { order.push('fg'); return 'fg'; }, { lane: 'foreground' });
    await Promise.resolve(); // the queue's pump runs the first job on a microtask
    expect(order).toEqual(['running']); // the running job is never interrupted
    release();
    expect(await fg).toBe('fg');
    await bg;
    expect(order).toEqual(['running', 'fg', 'bg']); // foreground jumped the queued background job
  });

  test('a second load waits for the first (captures never interleave)', async () => {
    const { host, view } = await warmSession();
    const loads = [];
    let releaseFirst;
    view.webContents.loadURL.mockImplementation(async (url) => {
      loads.push(url);
      if (url === 'https://music.testsvc.com/a' && !releaseFirst) {
        await new Promise((resolve) => { releaseFirst = resolve; });
      }
    });
    // A small budgetMs too: with zero captures the quiet window runs to
    // budgetMs (not quietMs), and the second load below fires no captures.
    const capture = { urlPrefixes: ['https://gql.testsvc.com/*'], quietMs: 100, budgetMs: 200 };
    const first = host.load('https://music.testsvc.com/a', { capture });
    const second = host.load('https://music.testsvc.com/b', { capture });
    await jest.advanceTimersByTimeAsync(0);
    expect(loads).toEqual(['https://music.testsvc.com/a']);
    // The webRequest single listener slot is the point: while the first load
    // is mid-flight, ONLY its capture is attached — the second's cannot
    // replace it (that would interleave two loads' captures).
    const webRequest = theSession().webRequest;
    expect(webRequest.onBeforeRequest).toHaveBeenCalledTimes(1);
    releaseFirst();
    // One captured request as the page settles: the quiet window (100ms) is
    // what ends the first load's capture — with zero captures the wait runs
    // to budgetMs instead (a page that has not fired anything is not quiet;
    // see the cold-view window test).
    fireCaptured({ id: 1 });
    await jest.advanceTimersByTimeAsync(500); // the first load's quiet window ends, the chain releases
    expect(loads).toEqual(['https://music.testsvc.com/a', 'https://music.testsvc.com/b']);
    await first;
    await second;
    // Full order: attach, detach, attach, detach — never two attaches alive.
    expect(webRequest.onBeforeRequest).toHaveBeenCalledTimes(4);
    const order = webRequest.onBeforeRequest.mock.invocationCallOrder;
    expect(order[0]).toBeLessThan(order[1]); // attach then detach
    expect(order[1]).toBeLessThan(order[2]); // the second attaches only after the first detached
    expect(order[2]).toBeLessThan(order[3]);
  });
});

describe('the gate — rule 2: navigations and pageFetches', () => {
  test('a load waits out an in-flight pageFetch before navigating', async () => {
    const { host, view } = await warmSession();
    let releaseFetch;
    view.webContents.executeJavaScript.mockImplementation(() => new Promise((resolve) => { releaseFetch = resolve; }));
    const fetchRun = host.pageFetch({ url: 'https://gql.testsvc.com/', headers: {}, body: '{}' });
    await jest.advanceTimersByTimeAsync(0);
    expect(view.webContents.loadURL).not.toHaveBeenCalledWith('https://music.testsvc.com/next');

    const loadRun = host.load('https://music.testsvc.com/next');
    await jest.advanceTimersByTimeAsync(0);
    // The navigation has not started: the pageFetch still holds the gate.
    expect(view.webContents.loadURL).not.toHaveBeenCalledWith('https://music.testsvc.com/next');

    releaseFetch({ status: 200, text: '{}' });
    await jest.advanceTimersByTimeAsync(300);
    expect(view.webContents.loadURL).toHaveBeenCalledWith('https://music.testsvc.com/next');
    await fetchRun;
    await loadRun;
  });

  test('a pageFetch during a navigation resolves { error: busy }', async () => {
    const { host, view } = await warmSession();
    view.webContents._hangNextLoad = true;
    const loadRun = host.load('https://music.testsvc.com/x', { timeoutMs: 5000 });
    loadRun.catch(() => {}); // its rejection fires inside the timer advance below
    await jest.advanceTimersByTimeAsync(0);
    await expect(host.pageFetch({ url: 'https://gql.testsvc.com/' })).resolves.toEqual({ error: 'busy' });
    await jest.advanceTimersByTimeAsync(5000);
    await expect(loadRun).rejects.toMatchObject({ reason: 'load-failed' });
  });

  test('a pageFetch arriving DURING a load reader drain is refused (the flag flips before the drain)', async () => {
    const { host, view } = await warmSession();
    let releaseFetch;
    view.webContents.executeJavaScript.mockImplementation(() => new Promise((resolve) => { releaseFetch = resolve; }));
    const first = host.pageFetch({ url: 'https://gql.testsvc.com/' });
    await jest.advanceTimersByTimeAsync(0);

    const loadRun = host.load('https://music.testsvc.com/next'); // beginNavigation: flag up, draining
    await jest.advanceTimersByTimeAsync(0);
    // A reader arriving mid-drain must be refused — if the flag flipped only
    // AFTER the drain, this would enter and the navigation would starve.
    await expect(host.pageFetch({ url: 'https://gql.testsvc.com/' })).resolves.toEqual({ error: 'busy' });
    releaseFetch({ status: 200, text: '{}' });
    await first;
    await jest.advanceTimersByTimeAsync(300);
    await loadRun;
    expect(view.webContents.loadURL).toHaveBeenCalledWith('https://music.testsvc.com/next');
  });

  test('a readerHeld pageFetch runs under a navigation waiting out the caller\'s outer reader (a mid-walk page)', async () => {
    // The maintainer's repro shape: a multi-page walk holds ONE reader for the
    // whole walk (tryEnterReplay once), each page is a pageFetch — a
    // navigation starting between two pages would make page 2 come back busy
    // and fail the whole walk. readerHeld is the escape: the caller's outer
    // reader covers the gate for the walk's own pages.
    const { host, view } = await warmSession();
    view.webContents.executeJavaScript.mockResolvedValue({ status: 200, text: '{}' });
    expect(host.tryEnterReplay()).toBe(true); // the walk's outer reader
    let navigationDone = false;
    try {
      // Page 1 of the walk: takes the gate fine (no navigation yet).
      await expect(host.pageFetch({ url: 'https://gql.testsvc.com/' })).resolves.toEqual({ status: 200, text: '{}' });
      // A navigation starts between the walk's pages: the writer flag is up,
      // and it waits for the walk's outer reader to drain.
      const navigation = host.beginNavigation();
      navigation.then(() => { navigationDone = true; host.endNavigation(); });
      await jest.advanceTimersByTimeAsync(100);
      // An untethered pageFetch is still busy under the navigation...
      await expect(host.pageFetch({ url: 'https://gql.testsvc.com/' })).resolves.toEqual({ error: 'busy' });
      // ...but the walk's next page runs: its caller holds the outer reader.
      await expect(host.pageFetch({ url: 'https://gql.testsvc.com/' }, { readerHeld: true }))
        .resolves.toEqual({ status: 200, text: '{}' });
    } finally {
      host.exitReplay(); // the walk ends; the navigation may drain
    }
    await jest.advanceTimersByTimeAsync(200);
    expect(navigationDone).toBe(true); // the writer ran the moment the walk's reader left
  });

  test('an idle park and a load exclude each other (two writers never abort each others navigation)', async () => {
    const { host, view } = await warmSession({ warmMs: 1000 });
    let releasePark;
    view.webContents.loadURL.mockImplementation(async (url) => {
      if (url === 'about:blank') await new Promise((resolve) => { releasePark = resolve; });
    });
    host.cancelPark();
    host.schedulePark();
    await jest.advanceTimersByTimeAsync(1100); // the fuse fires; park holds the writer gate
    expect(view.webContents.loadURL).toHaveBeenCalledWith('about:blank');

    const loadRun = host.load('https://music.testsvc.com/next'); // a second writer: waits
    await jest.advanceTimersByTimeAsync(300);
    expect(view.webContents.loadURL).not.toHaveBeenCalledWith('https://music.testsvc.com/next');
    releasePark();
    await jest.advanceTimersByTimeAsync(500);
    expect(view.webContents.loadURL).toHaveBeenCalledWith('https://music.testsvc.com/next');
    await loadRun;
  });

  test('the idle park waits out an in-flight pageFetch (a blank is a navigation too)', async () => {
    const { host, view } = await warmSession({ warmMs: 1000 });
    let releaseFetch;
    view.webContents.executeJavaScript.mockImplementation(() => new Promise((resolve) => { releaseFetch = resolve; }));
    const fetchRun = host.pageFetch({ url: 'https://gql.testsvc.com/' });
    await jest.advanceTimersByTimeAsync(0);
    host.schedulePark(); // arm the fuse while the fetch is in flight
    await jest.advanceTimersByTimeAsync(1200);
    expect(view.webContents.loadURL).not.toHaveBeenCalledWith('about:blank'); // busy at fire time: re-arm
    releaseFetch({ status: 200, text: '{}' });
    await fetchRun;
    await jest.advanceTimersByTimeAsync(2500); // the re-armed fuse fires, the gate is free now
    expect(view.webContents.loadURL).toHaveBeenCalledWith('about:blank');
  });

  test('exitReplay never drives the reader counter negative (an unmatched exit is clamped)', async () => {
    const { host } = await warmSession();
    // The old createReplayGate warned loudly on an unmatched exit (its unit
    // test pinned this same clamp); the host's gate clamps silently —
    // Math.max(0, readers - 1) — so an unmatched exit cannot steal a live
    // reader's slot by burying the counter below zero.
    host.exitReplay(); // zero readers in flight: the unmatched exit
    expect(host.tryEnterReplay()).toBe(true); // the gate still admits a reader
    host.exitReplay(); // the paired exit
    expect(host._replayReaders).toBe(0); // back to zero, never below it
  });
});

describe('the fuse — rule 3: the idle park', () => {
  test('an idle view parks on about:blank after warmMs', async () => {
    const { host, view } = await warmSession({ warmMs: 1000 });
    host.cancelPark(); // warmSession armed its own fuse; arm a fresh one
    host.schedulePark();
    await jest.advanceTimersByTimeAsync(500);
    expect(view.webContents.loadURL).not.toHaveBeenCalledWith('about:blank');
    await jest.advanceTimersByTimeAsync(600);
    expect(view.webContents.loadURL).toHaveBeenCalledWith('about:blank');
  });

  test('a load schedules the park; a pageFetch re-arms it at its tail', async () => {
    const { host, view } = await warmSession({ warmMs: 1000 });
    await host.load('https://music.testsvc.com/page');
    await jest.advanceTimersByTimeAsync(800);
    view.webContents.executeJavaScript.mockResolvedValue({ status: 200, text: '{}' });
    await host.pageFetch({ url: 'https://gql.testsvc.com/' });
    // The fetch re-armed the fuse: no blank at the ORIGINAL fire time...
    await jest.advanceTimersByTimeAsync(300);
    expect(view.webContents.loadURL).not.toHaveBeenCalledWith('about:blank');
    // ...and the blank comes one warmMs after the fetch settled, not never.
    await jest.advanceTimersByTimeAsync(800);
    expect(view.webContents.loadURL).toHaveBeenCalledWith('about:blank');
  });
});

describe('echo attribution — rule 4: captures flag our own page traffic', () => {
  test('a capture seen while a pageFetch is in flight is flagged echo', async () => {
    const { host, view } = await warmSession();
    let releaseFetch;
    view.webContents.executeJavaScript.mockImplementation(() => new Promise((resolve) => { releaseFetch = resolve; }));
    const fetchRun = host.pageFetch({ url: 'https://gql.testsvc.com/' });
    await jest.advanceTimersByTimeAsync(0);

    const loadRun = host.load('https://music.testsvc.com/next', {
      capture: { urlPrefixes: ['https://gql.testsvc.com/*'], quietMs: 1000, budgetMs: 3000 }
    });
    await jest.advanceTimersByTimeAsync(300);
    fireCaptured({ id: 1, body: '{"a":1}' }); // while the pageFetch is in flight
    releaseFetch({ status: 200, text: '{}' });
    await fetchRun;
    fireCaptured({ id: 2, body: '{"b":2}' }); // after it settled
    await jest.advanceTimersByTimeAsync(2500);
    const result = await loadRun;
    const echoes = Object.fromEntries(result.captures.map((c) => [c.body, c.echo]));
    expect(echoes['{"a":1}']).toBe(true);
    expect(echoes['{"b":2}']).toBe(false);
  });
});

describe('pageFetch — the page-world fetch', () => {
  test('executes the fetch in the page world with the given request', async () => {
    const { host, view } = await warmSession();
    view.webContents.executeJavaScript.mockResolvedValue({ status: 200, text: '{"data":{}}' });
    const out = await host.pageFetch({
      url: 'https://gql.testsvc.com/',
      method: 'POST',
      headers: { 'csrf-token': 'tok' },
      body: '{"query":"q"}'
    });
    expect(out).toEqual({ status: 200, text: '{"data":{}}' });
    const script = view.webContents.executeJavaScript.mock.calls[0][0];
    expect(script).toContain('"https://gql.testsvc.com/"');
    expect(script).toContain('"csrf-token":"tok"');
    expect(script).toContain('credentials');
  });

  test('a parked (about:blank) view is no-origin-page; a missing view is no-view', async () => {
    const host = newSession();
    await expect(host.pageFetch({ url: 'https://gql.testsvc.com/' })).resolves.toEqual({ error: 'no-view' });
    host.setHost(makeHostWindow());
    await host.load('https://music.testsvc.com/home');
    // Park it: the load scheduled the fuse; fire it to blank the view.
    host.cancelPark();
    await host.park();
    await expect(host.pageFetch({ url: 'https://gql.testsvc.com/' })).resolves.toEqual({ error: 'no-origin-page' });
  });

  test('an evaluate failure and a timeout are recoverable { error } results, never throws', async () => {
    const { host, view } = await warmSession({ pageFetchTimeoutMs: 1000 });
    view.webContents.executeJavaScript.mockRejectedValue(new Error('frame torn'));
    await expect(host.pageFetch({ url: 'https://gql.testsvc.com/' })).resolves.toEqual({ error: 'frame torn' });

    view.webContents.executeJavaScript.mockImplementation(() => new Promise(() => {}));
    const run = host.pageFetch({ url: 'https://gql.testsvc.com/' });
    await jest.advanceTimersByTimeAsync(1200);
    await expect(run).resolves.toMatchObject({ error: expect.stringContaining('exceeded') });
  });
});

describe('fetch — the outside-page request with the session jar', () => {
  beforeEach(() => {
    // The net mock delivers responses over setImmediate, which fake timers
    // starve; fetch itself has no timers to fake.
    jest.useRealTimers();
  });

  test('a caller-supplied Cookie header is dropped — the host owns what is sent', async () => {
    const host = newSession();
    mockNetHandlers.push(() => ({ status: 200, text: '{"ok":true}' }));
    const out = await host.fetch({
      url: 'https://music.testsvc.com/api/thing',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: 'smuggled=1', cookie: 'smuggled=2' },
      body: '{"x":1}'
    });
    expect(out).toEqual({ status: 200, headers: expect.objectContaining({ 'content-type': 'application/json' }), text: '{"ok":true}' });
    const record = mockNetRequests[0];
    expect(record.headers.Cookie).toBeUndefined(); // dropped, never forwarded
    expect(record.headers.cookie).toBeUndefined();
    expect(record.opts.method).toBe('POST');
    expect(record.body).toBe('{"x":1}');
  });

  test('an object body is serialized; a bad request resolves, never throws', async () => {
    const host = newSession();
    mockNetHandlers.push(() => ({ status: 204, text: '' }));
    await host.fetch({ url: 'https://music.testsvc.com/a', body: { a: 1 } });
    expect(mockNetRequests[0].body).toBe('{"a":1}');
    mockNetHandlers.push(() => ({ status: 500, text: 'no' }));
    await expect(host.fetch({ url: 'https://music.testsvc.com/b' })).resolves.toMatchObject({ status: 500 });
  });
});

describe('fetch — the allowed-hosts scope, initial URL and every redirect hop (#1432 review, finding 1)', () => {
  beforeEach(() => {
    // The net mock delivers responses over setImmediate, which fake timers
    // starve; fetch itself has no timers to fake.
    jest.useRealTimers();
  });

  test('a URL on the cookie domain but off the allowlist is refused before net.request exists (amazon.com is the account, not the service)', async () => {
    const host = newSession();
    // www.testsvc.com is under the declared cookie domain testsvc.com — the
    // exact case the finding is about: the cookie domain covers the whole
    // account, the allowlist is the service.
    await expect(host.fetch({ url: 'https://www.testsvc.com/orders' })).rejects.toMatchObject({ reason: 'invalid' });
    await expect(host.fetch({ url: 'https://gql.testsvc.com/ok', method: 'POST', body: '{}' })).resolves.toMatchObject({ status: 200 }); // an allowed host passes
    expect(mockNetRequests).toHaveLength(1);
    expect(mockNetRequests[0].opts.url).toBe('https://gql.testsvc.com/ok');
  });

  test('http: URLs are refused — the jar must never ride in the clear', async () => {
    const host = newSession();
    await expect(host.fetch({ url: 'http://music.testsvc.com/api' })).rejects.toMatchObject({ reason: 'invalid' });
    expect(mockNetRequests).toHaveLength(0);
  });

  test('a redirect hop that stays on the allowlist is followed; a hop off it aborts the request', async () => {
    const host = newSession();
    // Hop 1 stays on the list: followed to the final answer.
    mockNetHandlers.push(() => ({ status: 301, redirect: 'https://gql.testsvc.com/next' }));
    mockNetHandlers.push(() => ({ status: 200, text: '{"ok":2}' }));
    await expect(host.fetch({ url: 'https://music.testsvc.com/a' })).resolves.toMatchObject({ status: 200, text: '{"ok":2}' });
    expect(mockNetRequests[0].aborted).toBe(false);

    // A hop to any other host — under the cookie domain or off it — is not
    // followed: net.request follows redirects by default, so the re-check is
    // the 'redirect' listener, and not following cancels the request.
    mockNetHandlers.push(() => ({ status: 302, redirect: 'https://www.testsvc.com/ap/steal' }));
    const out = await host.fetch({ url: 'https://music.testsvc.com/b' });
    expect(out.status).toBe(-1);
    expect(out.text).toMatch(/refused a redirect hop off the session's allowed hosts/);
    expect(mockNetRequests[1].aborted).toBe(true);
    expect(mockNetRequests[1].followedRedirect).toBe(false);
  });
});

describe('fetch — response cookies and the budget (review on #1399)', () => {
  beforeEach(() => {
    // The net mock delivers responses over setImmediate, which fake timers
    // starve; fetch itself has no timers to fake.
    jest.useRealTimers();
  });

  test('Chromium owns the jar: useSessionCookies, no hand-built Cookie header, set-cookie as names only', async () => {
    const host = newSession();
    mockNetHandlers.push(() => ({
      status: 200,
      text: '{"ok":true}',
      headers: { 'content-type': 'application/json', 'set-cookie': ['session-token=ROTATED; Domain=.testsvc.com; Path=/; Secure; HttpOnly'] }
    }));
    const out = await host.fetch({ url: 'https://music.testsvc.com/api/thing' });
    // The request rides the session's own cookie handling — attach on every
    // hop (redirects included) and response cookies saved by browser rules.
    // (The old note that net does not attach a partition jar was this:
    // useSessionCookies defaults to false.)
    expect(mockNetRequests[0].opts.useSessionCookies).toBe(true);
    // The host builds NO Cookie header, and never parses Set-Cookie.
    expect(mockNetRequests[0].headers.Cookie).toBeUndefined();
    expect(theSession().cookies.set).not.toHaveBeenCalled();
    // Names only — the value never crosses the boundary in either direction.
    expect(out.headers['set-cookie']).toEqual(['session-token']);
  });

  test('a default budget with a real abort: a stalled fetch never runs on', async () => {
    const host = newSession({ loadTimeoutMs: 60 });
    mockNetHandlers.push(() => null); // hang: no response ever
    const out = await host.fetch({ url: 'https://music.testsvc.com/stall' });
    expect(out.status).toBe(-1);
    expect(out.text).toMatch(/exceeded 60ms/);
    expect(mockNetRequests[0].aborted).toBe(true);
  });
});

describe('clear() during a load (review on #1399)', () => {
  test("the old load's detach never removes the new load's capture; it never re-arms the park", async () => {
    const { host } = await warmSession({ warmMs: 60000 });
    const a = host.load('https://music.testsvc.com/first', {
      capture: { urlPrefixes: ['https://gql.testsvc.com/*'], quietMs: 5000, budgetMs: 20000 }
    });
    await jest.advanceTimersByTimeAsync(0); // navigation done; A is in its quiet window

    await host.clear(); // cuts the chain, destroys the view, bumps the generation
    // B starts immediately — the chain was cut — and attaches its capture.
    // B's quiet window is long: B must still be MID-FLIGHT when A's teardown
    // runs, so a wrongly-armed fuse would be visible.
    const b = host.load('https://music.testsvc.com/second', {
      capture: { urlPrefixes: ['https://gql.testsvc.com/*'], quietMs: 6000, budgetMs: 30000 }
    });
    await jest.advanceTimersByTimeAsync(0);

    // A's quiet window sees the generation change and returns; its finally
    // must NOT detach B's capture (the registration identity guard) and must
    // NOT re-arm the park fuse (B, still in flight, owns the fuse now — its
    // own re-arm on settle is correct and expected).
    await jest.advanceTimersByTimeAsync(3000);
    // A REJECTS with superseded: its captures belong to the old account, and
    // a caller must never mint a template from them.
    await expect(a).rejects.toMatchObject({ reason: 'superseded' });
    expect(host._parkTimer).toBeNull(); // neither A (superseded) nor B (mid-flight) armed one

    // B's capture is intact: the page fires its request and B returns it.
    fireCaptured({ id: 42, body: '{"b":1}' });
    await jest.advanceTimersByTimeAsync(7000);
    const bOut = await b;
    expect(bOut.captures).toEqual([expect.objectContaining({ body: '{"b":1}' })]);
  });

  test('attachCapture is identity-guarded directly: only the current registration detaches', async () => {
    const { host } = await warmSession();
    const webRequest = theSession().webRequest;
    const first = host.attachCapture(['https://gql.testsvc.com/*']);
    const second = host.attachCapture(['https://gql.testsvc.com/*']); // replaces as current
    first.detach(); // superseded: must NOT clear the slot
    expect(webRequest.onBeforeRequest).toHaveBeenLastCalledWith(expect.anything(), expect.any(Function));
    fireCaptured({ id: 1, body: '{"x":1}' });
    expect(second.captured.length).toBe(1);
    second.detach(); // current: clears the slot
    expect(webRequest.onBeforeRequest).toHaveBeenLastCalledWith(expect.anything(), null);
  });

  test('clear() DETACHES the current registration — no stale listener records the sign-in window', async () => {
    const { host } = await warmSession();
    const webRequest = theSession().webRequest;
    const registration = host.attachCapture(['https://gql.testsvc.com/*']);
    await host.clear();
    // The listener is released, not just forgotten: the sign-in window shares
    // this partition, and a stale registration would record its requests —
    // bodies included — into an array nothing reads.
    expect(webRequest.onBeforeRequest).toHaveBeenLastCalledWith(expect.anything(), null);
    expect(webRequest.onBeforeSendHeaders).toHaveBeenLastCalledWith(expect.anything(), null);
    expect(registration.captured.length).toBe(0);
    expect(host._capture).toBeNull();
  });
});

describe('signIn — one ticker per open window (review on #1399)', () => {
  test('a second signIn while the window is open joins the pending promise (no double ticking)', async () => {
    const { host } = await warmSession();
    const decide = jest.fn(() => false);
    const first = host.signIn('https://music.testsvc.com/', { decide });
    await jest.advanceTimersByTimeAsync(0);
    const auth = mockAuthWindows[mockAuthWindows.length - 1];
    await jest.advanceTimersByTimeAsync(2000);
    expect(decide).toHaveBeenCalledTimes(2);

    const second = host.signIn('https://music.testsvc.com/', { decide });
    expect(auth.focused).toBe(true); // the second call focuses the open window
    await jest.advanceTimersByTimeAsync(2000);
    expect(decide).toHaveBeenCalledTimes(4); // still one decide per second — no second interval

    auth.close();
    // Both callers settle with the same verdict from the same one ticker.
    expect(await first).toEqual({ signedIn: false });
    expect(await second).toEqual({ signedIn: false });
  });
});

describe('pageFetch — the verb default (review on #1399)', () => {
  test('defaults to GET, same as fetch (one verb per omitted method)', async () => {
    const { host, view } = await warmSession();
    view.webContents.executeJavaScript.mockResolvedValue({ status: 200, text: '{}' });
    await host.pageFetch({ url: 'https://gql.testsvc.com/', headers: {} });
    expect(view.webContents.executeJavaScript.mock.calls[0][0]).toContain('"GET"');
  });

  test("never follows a redirect ('error') — a replay never redirects; a credentialed hop to wherever an allowed host redirects is not made (#1432 advisory, 2026-11-17 follow-up)", async () => {
    const { host, view } = await warmSession();
    view.webContents.executeJavaScript.mockResolvedValue({ error: 'TypeError: Failed to fetch' });
    await expect(host.pageFetch({ url: 'https://gql.testsvc.com/' })).resolves.toEqual({ error: 'TypeError: Failed to fetch' });
    expect(view.webContents.executeJavaScript.mock.calls[0][0]).toContain("redirect: 'error'");
  });
});

describe('the hidden view — the will-redirect leash (#1432 advisory, 2026-11-17 follow-up)', () => {
  function fireRedirect(view, url, isMainFrame = true) {
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    (view.webContents._handlers['will-redirect'] || []).forEach((cb) => cb(event, url, false, isMainFrame));
    return event.defaultPrevented;
  }

  test('a main-frame hop OFF the cookie domains is refused; the service’s own hosts and sub-frame hops stay free', async () => {
    const { view } = await warmSession();
    // An open redirect under an allowed host could otherwise browse the
    // view — partition cookies attached — to a caller-chosen site.
    expect(fireRedirect(view, 'https://evil.example/steal')).toBe(true);
    expect(fireRedirect(view, 'https://www.eviltestsvc.com/')).toBe(true);
    expect(fireRedirect(view, 'not a url')).toBe(true);
    // The cookie-domain shape, not the allowlist: the service's identity
    // hop (music → identity → music) must stay free.
    expect(fireRedirect(view, 'https://www.testsvc.com/accounts/signin')).toBe(false);
    expect(fireRedirect(view, 'https://music.testsvc.com/home')).toBe(false);
    // Sub-frame redirects are not main-frame navigations (an iframe ad
    // network redirecting is not what the guard keys on).
    expect(fireRedirect(view, 'https://evil.example/frame', false)).toBe(false);
  });

  test('the sign-in window gets NO leash — following the identity hops is the point', async () => {
    const { host } = await warmSession();
    const run = host.signIn('https://music.testsvc.com/', { decide: () => false });
    await jest.advanceTimersByTimeAsync(0);
    const auth = mockAuthWindows[mockAuthWindows.length - 1];
    expect(auth.webContents._handlers['will-redirect'] || []).toHaveLength(0);
    auth.close();
    await run;
  });
});

describe('the hidden view — page-started navigations (#1432 advisory, round 3)', () => {
  function fireNavigate(view, url) {
    const event = { url, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    (view.webContents._handlers['will-navigate'] || []).forEach((cb) => cb(event, url));
    return event.defaultPrevented;
  }

  test('a navigation the page starts that leaves the cookie domains is refused, like a redirect', async () => {
    const { view } = await warmSession();
    expect(fireNavigate(view, 'https://evil.example/')).toBe(true);
    expect(fireNavigate(view, 'https://www.eviltestsvc.com/')).toBe(true);
    expect(fireNavigate(view, 'not a url')).toBe(true);
    // The service's own pages, identity host included, stay free.
    expect(fireNavigate(view, 'https://www.testsvc.com/accounts/signin')).toBe(false);
    expect(fireNavigate(view, 'https://music.testsvc.com/albums/x')).toBe(false);
  });

  test('the url comes from the event when the handler gets no second argument (newer Electron)', async () => {
    const { view } = await warmSession();
    const event = { url: 'https://evil.example/', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    (view.webContents._handlers['will-navigate'] || []).forEach((cb) => cb(event));
    expect(event.defaultPrevented).toBe(true);
  });

  test('the sign-in window gets no navigation guard either', async () => {
    const { host } = await warmSession();
    const run = host.signIn('https://music.testsvc.com/', { decide: () => false });
    await jest.advanceTimersByTimeAsync(0);
    const auth = mockAuthWindows[mockAuthWindows.length - 1];
    expect(auth.webContents._handlers['will-navigate'] || []).toHaveLength(0);
    auth.close();
    await run;
  });
});

describe('pageFetch runs only in a page on an allowed host (#1432 advisory, round 3)', () => {
  test('a page on a cookie-domain host that is not on the allowlist runs nothing', async () => {
    const { host, view } = await warmSession();
    view.webContents._url = 'https://www.testsvc.com/accounts/signin';
    view.webContents.executeJavaScript.mockResolvedValue({ status: 200, text: '{"secret":1}' });
    await expect(host.pageFetch({ url: 'https://gql.testsvc.com/' })).resolves.toEqual({ error: 'page-off-host' });
    expect(view.webContents.executeJavaScript).not.toHaveBeenCalled();
  });

  test('a page anywhere else runs nothing', async () => {
    const { host, view } = await warmSession();
    view.webContents._url = 'https://evil.example/';
    await expect(host.pageFetch({ url: 'https://gql.testsvc.com/' })).resolves.toEqual({ error: 'page-off-host' });
    expect(view.webContents.executeJavaScript).not.toHaveBeenCalled();
  });

  test('a result from a page that changed while the fetch ran is dropped', async () => {
    const { host, view } = await warmSession();
    view.webContents.executeJavaScript.mockImplementation(async () => {
      view.webContents._url = 'https://www.testsvc.com/elsewhere';
      return { status: 200, text: '{"secret":1}' };
    });
    await expect(host.pageFetch({ url: 'https://gql.testsvc.com/' })).resolves.toEqual({ error: 'page-off-host' });
  });

  test('on an allowed page it runs as before', async () => {
    const { host, view } = await warmSession();
    view.webContents.executeJavaScript.mockResolvedValue({ status: 200, text: '{}' });
    await expect(host.pageFetch({ url: 'https://gql.testsvc.com/' })).resolves.toEqual({ status: 200, text: '{}' });
  });
});

describe('state — the facts, nothing judged', () => {
  test('url + signInUrl + cookie names + generation (values never; empties dropped)', async () => {
    mockJarCookies = [
      { name: 'at-main', value: 'SECRET', domain: '.testsvc.com' },
      { name: 'session-id', value: 'SID', domain: '.testsvc.com' },
      { name: 'dying', value: '', domain: '.testsvc.com' },
      { name: 'other-svc', value: 'X', domain: '.othersvc.com' }
    ];
    const { host, view } = await warmSession();
    view.webContents._url = 'https://music.testsvc.com/search/x/songs';
    const state = await host.state();
    expect(state).toEqual({
      url: 'https://music.testsvc.com/search/x/songs',
      signInUrl: null,
      cookieNames: ['at-main', 'session-id'],
      generation: 0
    });
  });

  test('clear() bumps the generation state() carries — the sign-out signal a plugin compares', async () => {
    // A plugin cannot see the host's sign-out event; the generation is how
    // it detects one — sign out, sign in as another account with no search
    // between, and the next state read observes the bump and drops the
    // caches minted under the old account (the plugin's plan reading and
    // request template).
    const { host } = await warmSession();
    expect((await host.state()).generation).toBe(0);
    await host.clear();
    expect((await host.state()).generation).toBe(1);
    await host.clear();
    expect((await host.state()).generation).toBe(2);
  });
});

describe('signIn — the visible window with the plugin verdict', () => {
  test('decide() truthy closes the window and resolves signed-in; ticks carry url, cookieNames, stableTicks', async () => {
    mockJarCookies = [{ name: 'at-main', value: 'AT', domain: '.testsvc.com' }];
    const { host } = await warmSession();
    const ticks = [];
    const run = host.signIn('https://music.testsvc.com/', {
      decide: (tick) => {
        ticks.push({ ...tick });
        return tick.cookieNames.includes('at-main') && tick.stableTicks >= 2;
      }
    });
    await jest.advanceTimersByTimeAsync(0);
    const auth = mockAuthWindows[mockAuthWindows.length - 1];
    expect(auth.shown).toBe(true);
    expect(auth.webPreferences.preload).toBeNull(); // behaves like a normal browser window
    expect(auth.showOpt).toBe(true); // visible from the start
    expect(auth.title).toBe('Sign in to testsvc'); // the host-config fallback — never a caller choice

    await jest.advanceTimersByTimeAsync(1000);
    expect(ticks.length).toBe(1);
    expect(ticks[0]).toEqual({ url: 'https://music.testsvc.com/', cookieNames: ['at-main'], stableTicks: 0 });
    await jest.advanceTimersByTimeAsync(1000);
    expect(ticks[1].stableTicks).toBe(1); // same url on tick 2
    await jest.advanceTimersByTimeAsync(1000);
    expect(ticks[2].stableTicks).toBe(2); // verdict true on the third stable tick
    const result = await run;
    expect(result).toEqual({ signedIn: true });
    await jest.advanceTimersByTimeAsync(700); // the close delay
    expect(auth.isDestroyed()).toBe(true);
  });

  test('the person closing the window first resolves not signed-in', async () => {
    const { host } = await warmSession();
    const decide = jest.fn(() => false);
    const run = host.signIn('https://music.testsvc.com/', { decide });
    await jest.advanceTimersByTimeAsync(0);
    const auth = mockAuthWindows[mockAuthWindows.length - 1];
    auth.close();
    await expect(run).resolves.toEqual({ signedIn: false });
    expect(decide).not.toHaveBeenCalled();
  });

  test('the window title comes from host config (signInTitle) — a caller-chosen title is a phishing surface, so there is no title option to pass (#1432 review, finding 3)', async () => {
    const { host } = await warmSession({ signInTitle: 'Sign in to TestSvc' });
    const run = host.signIn('https://music.testsvc.com/', {
      decide: () => false,
      // A title key in the options is inert: the signature has no such
      // option, so a caller cannot name the window anything.
      title: 'Sign in to Your Bank'
    });
    await jest.advanceTimersByTimeAsync(0);
    const auth = mockAuthWindows[mockAuthWindows.length - 1];
    expect(auth.title).toBe('Sign in to TestSvc'); // the host config, not the option
    auth.close();
    await run;
  });

  test('the sign-in window carries no preload; the hidden view does', async () => {
    const { host, view } = await warmSession();
    expect(view.webPreferences.preload).toBe('/path/to/preload.js');
    const run = host.signIn('https://music.testsvc.com/', { decide: () => false });
    await jest.advanceTimersByTimeAsync(0);
    const auth = mockAuthWindows[mockAuthWindows.length - 1];
    expect(auth.webPreferences.preload).toBeNull();
    auth.close();
    await run;
  });
});

describe('clear — sign out', () => {
  test('destroys the views, closes the sign-in window, clears the partition, cuts the chain', async () => {
    const { host, view } = await warmSession();
    const signInRun = host.signIn('https://music.testsvc.com/', { decide: () => false });
    await jest.advanceTimersByTimeAsync(0);
    const auth = mockAuthWindows[mockAuthWindows.length - 1];

    await host.clear();
    expect(view.webContents.close).toHaveBeenCalled();
    expect(auth.isDestroyed()).toBe(true);
    expect(theSession().clearStorageData).toHaveBeenCalled();
    await signInRun; // the sign-in promise settles through the closed window
    expect(host.viewUrl()).toBeNull();
  });

  test('a load hung on the old chain does not wedge the next one', async () => {
    const { host, view } = await warmSession();
    view.webContents._hangNextLoad = true;
    const hung = host.load('https://music.testsvc.com/stall', { timeoutMs: 10000 });
    hung.catch(() => {});
    await jest.advanceTimersByTimeAsync(0);

    await host.clear(); // destroys the view → the hung load rejects → the gate frees
    await jest.advanceTimersByTimeAsync(50);
    const next = host.load('https://music.testsvc.com/fresh');
    await jest.advanceTimersByTimeAsync(1100);
    const out = await next;
    expect(out.finalUrl).toBe('https://music.testsvc.com/fresh');
    // The view's destruction aborts the hung navigation (a raw rejection, the
    // same shape loadURLBudgeted propagates today) — and the chain moved on.
    await expect(hung).rejects.toThrow(/ERR_ABORTED/);
  });

  test('clear() cuts BOTH lanes: queued jobs from the old account never wedge the new one', async () => {
    const { host } = await warmSession();
    const order = [];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    // A running background job that never settles, a foreground and a
    // background job queued behind it — the old account's in-flight work.
    host.enqueue(async () => { order.push('running'); await gate; });
    host.enqueue(async () => { order.push('bg-queued'); });
    host.enqueue(async () => { order.push('fg-queued'); }, { lane: 'foreground' });
    await jest.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['running']);

    await host.clear(); // cuts the queue: both lanes start clean
    const next = host.load('https://music.testsvc.com/fresh'); // the new account's first load
    await jest.advanceTimersByTimeAsync(1100);
    expect(await next).toMatchObject({ finalUrl: 'https://music.testsvc.com/fresh' });
    expect(order).toEqual(['running']); // the orphaned jobs never ran
    release();
  });
});

describe('construction and argument validation', () => {
  test('cookieDomains and allowedHosts are required (the allowlist is the fetch scope — absent is not "all of the cookie domain")', () => {
    expect(() => createWebSessionHost({ id: 'x', partition: 'persist:x' }))
      .toThrow(/cookieDomains is required/);
    expect(() => createWebSessionHost({ id: 'x', partition: 'persist:x', cookieDomains: ['testsvc.com'] }))
      .toThrow(/allowedHosts is required/);
    expect(() => createWebSessionHost({ id: 'x', partition: 'persist:x', cookieDomains: ['testsvc.com'], allowedHosts: [] }))
      .toThrow(/allowedHosts is required/);
    expect(() => createWebSessionHost({ id: 'x', partition: 'persist:x', cookieDomains: ['testsvc.com'], allowedHosts: ['ok.testsvc.com', 42] }))
      .toThrow(/allowedHosts is required/);
    expect(() => createWebSessionHost({ id: 'x' })).toThrow(/partition is required/);
    expect(() => createWebSessionHost({})).toThrow(/config.id is required/);
  });

  test('the host carries only allowedHosts publicly (the IPC bridge scopes by it; cookieDomains stays closed-over — no copy for a bridge to drift from)', async () => {
    const { host } = await warmSession({ cookieDomains: ['testsvc.com', '.music.testsvc.com'], allowedHosts: ['music.testsvc.com', 'gql.testsvc.com'] });
    expect(host.allowedHosts).toEqual(['music.testsvc.com', 'gql.testsvc.com']);
    expect(host.cookieDomains).toBeUndefined();
    // A copy, not a handle into the host's config: mutating the exposed array
    // must not re-scope fetch (the bridge reads it, so it cannot be a live
    // handle).
    mockJarCookies = [{ name: 'at-main', value: 'AT', domain: '.testsvc.com' }];
    expect((await host.state()).cookieNames).toEqual(['at-main']);
    host.allowedHosts.push('drift.example');
    await expect(host.fetch({ url: 'https://drift.example/x' })).rejects.toMatchObject({ reason: 'invalid' });
  });

  test('an invalid capture rejects before any state is touched (the fuse stays armed)', async () => {
    const { host, view } = await warmSession({ warmMs: 1000 });
    await expect(host.load('https://music.testsvc.com/x', { capture: {} }))
      .rejects.toMatchObject({ reason: 'invalid' });
    await expect(host.load('https://music.testsvc.com/x', { capture: { urlPrefixes: 'nope' } }))
      .rejects.toMatchObject({ reason: 'invalid' });
    // The invalid argument disarmed nothing: the fuse still parks the view.
    await jest.advanceTimersByTimeAsync(1200);
    expect(view.webContents.loadURL).toHaveBeenCalledWith('about:blank');
  });
});

describe('view hardening', () => {
  test('the hidden view: UA mask, no throttling, window-open denied, offscreen on use', async () => {
    const host = newSession();
    const win = makeHostWindow();
    host.setHost(win);
    host.ensureView();
    const view = host._view;
    expect(view.webContents.setUserAgent).toHaveBeenCalledWith('UA/1.0');
    expect(view.webContents.setBackgroundThrottling).toHaveBeenCalledWith(false);
    expect(view.webContents.setWindowOpenHandler).toHaveBeenCalledWith(expect.any(Function));
    expect(view.webContents.setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: 'deny' });
    expect(view.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 }); // born collapsed
    await host.load('https://music.testsvc.com/home');
    // Offscreen at a real size, not 0×0: SPAs collapse widgets to max-width: 0
    // in a 0×0 view, and the page's own requests then never fire.
    expect(view.bounds).toEqual({ x: -1200, y: 0, width: 1100, height: 800 });
    expect(host._host).toBe(win);
  });

  test('permissions are allowlist-only, warned once', async () => {
    const host = newSession();
    const win = makeHostWindow();
    host.setHost(win);
    await host.load('https://music.testsvc.com/home'); // session() installs the handlers
    const ses = theSession();
    expect(ses.setPermissionRequestHandler).toHaveBeenCalled();
    const handler = ses.setPermissionRequestHandler.mock.calls[0][0];
    let grant;
    handler({}, 'fullscreen', (v) => { grant = v; });
    expect(grant).toBe(true);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    handler({}, 'media', (v) => { grant = v; });
    expect(grant).toBe(false);
    handler({}, 'media', (v) => { grant = v; });
    expect(warn).toHaveBeenCalledTimes(1); // once per permission name
    warn.mockRestore();
  });

  test('host window closed → the view is destroyed and the session stops hosting', async () => {
    const host = newSession();
    const win = makeHostWindow();
    host.setHost(win);
    await host.load('https://music.testsvc.com/home');
    const view = host._view;
    win.close();
    expect(view.webContents.close).toHaveBeenCalled();
    expect(host._host).toBeNull();
  });
});
