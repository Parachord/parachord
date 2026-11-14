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
        const record = { opts, headers, body: null, handlers: {} };
        mockNetRequests.push(record);
        const req = {
          setHeader: (k, v) => { headers[k] = v; },
          on: (event, cb) => { record.handlers[event] = cb; return req; },
          end: (body) => {
            record.body = body;
            const handler = mockNetHandlers.shift() || (() => ({ status: 200, text: '{}' }));
            const { status, text } = handler({ url: opts.url, headers, body });
            const res = {
              statusCode: status,
              headers: { 'content-type': 'application/json' },
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

  test('the host owns the Cookie header: built from the jar, caller-supplied ones dropped', async () => {
    mockJarCookies = [
      { name: 'at-main', value: 'SECRET', domain: '.testsvc.com' },
      { name: 'empty', value: '', domain: '.testsvc.com' }
    ];
    const host = newSession();
    mockNetHandlers.push(() => ({ status: 200, text: '{"ok":true}' }));
    const out = await host.fetch({
      url: 'https://music.testsvc.com/api/thing',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: 'smuggled=1', cookie: 'smuggled=2' },
      body: '{"x":1}'
    });
    expect(out).toEqual({ status: 200, headers: expect.objectContaining({ 'content-type': 'application/json' }), text: '{"ok":true}' });
    expect(mockNetRequests.length).toBe(1);
    const record = mockNetRequests[0];
    expect(record.headers.Cookie).toBe('at-main=SECRET'); // jar value, not the smuggled one
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
