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
      request: (opts) => {
        const headers = {};
        const record = { opts, headers, body: null, handlers: {}, aborted: false };
        mockNetRequests.push(record);
        const req = {
          setHeader: (k, v) => { headers[k] = v; },
          abort: () => { record.aborted = true; },
          on: (event, cb) => { record.handlers[event] = cb; return req; },
          end: (body) => {
            record.body = body;
            const handler = mockNetHandlers.shift() || (() => ({ status: 200, text: '{}' }));
            const out = handler({ url: opts.url, headers, body });
            // A handler returning nothing hangs the request (the timeout path).
            if (!out) return;
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
function fireCaptured({ id, url = 'https://gql.testsvc.com/', method = 'POST', body = '{"query":"q"}', headers }) {
  const listeners = theSession().__listeners;
  // A detached capture (a late request after the load window closed) is a
  // real state, not a crash — drop it.
  if (typeof listeners._onBeforeRequest !== 'function') return;
  listeners._onBeforeRequest({ id, url, method, uploadData: body ? [{ bytes: Buffer.from(body) }] : [] }, () => {});
  listeners._onBeforeSendHeaders({ id, requestHeaders: headers || { 'x-api-key': 'k' } }, () => {});
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
    // onBeforeRequest fires milliseconds BEFORE onBeforeSendHeaders.
    const listeners = theSession().__listeners;
    listeners._onBeforeRequest({ id: 7, url: 'https://gql.testsvc.com/', method: 'POST', uploadData: [{ bytes: Buffer.from('{"operationName":"Search"}') }] }, () => {});
    listeners._onBeforeSendHeaders({ id: 7, requestHeaders: { 'csrf-token': 'tok' } }, () => {});
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

  test('a stalled navigation throws load-failed and detaches the capture', async () => {
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

  test('no host window → not-ready', async () => {
    const host = newSession();
    await expect(host.load('https://music.testsvc.com/')).rejects.toMatchObject({ reason: 'not-ready' });
  });
});

describe('the load chain — rule 1: loads serialize', () => {
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
    const capture = { urlPrefixes: ['https://gql.testsvc.com/*'], quietMs: 100 };
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
});

describe('state — the facts, nothing judged', () => {
  test('url + signInUrl + cookie names (values never; empties dropped)', async () => {
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
      cookieNames: ['at-main', 'session-id']
    });
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
});

describe('construction and argument validation', () => {
  test('cookieDomains is required', () => {
    expect(() => createWebSessionHost({ id: 'x', partition: 'persist:x' }))
      .toThrow(/cookieDomains is required/);
    expect(() => createWebSessionHost({ id: 'x' })).toThrow(/partition is required/);
    expect(() => createWebSessionHost({})).toThrow(/config.id is required/);
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
