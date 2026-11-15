// main-process/ipc/web-session-bridge.js — the IPC bridge over registered
// web-session hosts (#1356): sender gating (main window top frame only),
// the { success, reason, error } IPC error contract, fetch/pageFetch URL
// scoping to the session's cookie domains, and the signIn
// tick/decide/settled shuttle (including the two-calls join: one window, one
// ticker, two callIds, both settled). The bridge is dependency-injected
// (ipcMain, isAllowedSender, sendToRenderer, the hosts themselves), so these
// tests need no electron mock — the fake hosts carry the host contract.

const {
  registerWebSession,
  registerWebSessionBridgeIpc,
  urlUnderDomains
} = require('../../main-process/ipc/web-session-bridge');
const { createWebSessionHost } = require('../../main-process/web-session');

// ── fakes ───────────────────────────────────────────────────────────────────

function makeFakeHost(overrides = {}) {
  return {
    cookieDomains: ['amazon.com', 'music.amazon.com'],
    load: jest.fn(async () => ({ finalUrl: 'https://music.amazon.com/' })),
    pageFetch: jest.fn(async () => ({ status: 200, text: '[]' })),
    fetch: jest.fn(async () => ({ status: 200, headers: { 'content-type': 'application/json' }, text: 'ok' })),
    state: jest.fn(async () => ({ url: 'https://music.amazon.com/', signInUrl: null, cookieNames: ['at-main'] })),
    clear: jest.fn(async () => ({ success: true })),
    signIn: jest.fn(),
    ...overrides
  };
}

// A host signIn with a drivable run: tick() fires one host tick through the
// bridge-supplied decide(), settle()/reject() resolve the host promise the
// way the real host's does (verdict-true closes the window; a closed window
// settles { signedIn: false }).
function fakeSignInFlow() {
  let resolveRun;
  let rejectRun;
  let decide = null;
  const run = new Promise((resolve, reject) => { resolveRun = resolve; rejectRun = reject; });
  return {
    signIn: jest.fn(async (_url, { decide: d }) => { decide = d; return run; }),
    tick: async (tick) => (decide ? decide(tick) : false),
    settle: resolveRun,
    reject: rejectRun
  };
}

function makeBridge({ host = makeFakeHost(), isAllowedSender } = {}) {
  if (host) registerWebSession('amazon-music', host);
  const handlers = {};
  const ipcMain = { handle: (name, fn) => { handlers[name] = fn; } };
  const sent = [];
  const sendToRenderer = jest.fn((channel, payload) => { sent.push({ channel, payload }); });
  const gate = isAllowedSender || ((event) => !!(event && event.senderFrame && event.senderFrame.top === event.senderFrame));
  registerWebSessionBridgeIpc({ ipcMain, isAllowedSender: gate, sendToRenderer });
  const byChannel = (channel) => sent.filter((s) => s.channel === channel).map((s) => s.payload);
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  return { handlers, byChannel, flush };
}

// The same sender shapes the widevine bridge tests use: a top frame and an
// iframe sharing the sender webContents.
const topFrame = {};
Object.defineProperty(topFrame, 'top', { value: topFrame });
const mainFrameEvent = { sender: { id: 1 }, senderFrame: topFrame };
const iframeEvent = { sender: { id: 1 }, senderFrame: { top: {}, different: true } };

// ── the registry ────────────────────────────────────────────────────────────

describe('registerWebSession', () => {
  test('a host must implement the six primitives and carry cookieDomains', () => {
    expect(() => registerWebSession('', makeFakeHost())).toThrow(/session id/);
    expect(() => registerWebSession('x')).toThrow(/must implement/);
    const missingClear = makeFakeHost();
    delete missingClear.clear;
    expect(() => registerWebSession('x', missingClear)).toThrow(/must implement/);
    expect(() => registerWebSession('x', makeFakeHost({ cookieDomains: undefined }))).toThrow(/cookieDomains/);
    expect(() => registerWebSession('x', makeFakeHost({ cookieDomains: [] }))).toThrow(/cookieDomains/);
    expect(() => registerWebSession('x', makeFakeHost({ cookieDomains: ['amazon.com', 42] }))).toThrow(/cookieDomains/);
  });

  test('a registered session answers; an unknown id is not-ready everywhere', async () => {
    const { handlers } = makeBridge();
    const out = await handlers['webSession:state'](mainFrameEvent, { id: 'amazon-music' });
    expect(out).toMatchObject({ success: true, url: 'https://music.amazon.com/', signInUrl: null, cookieNames: ['at-main'] });
    for (const [channel, payload] of [
      ['webSession:load', { id: 'nope', url: 'https://music.amazon.com/' }],
      ['webSession:pageFetch', { id: 'nope', request: { url: 'https://music.amazon.com/' } }],
      ['webSession:fetch', { id: 'nope', request: { url: 'https://music.amazon.com/' } }],
      ['webSession:state', { id: 'nope' }],
      ['webSession:clear', { id: 'nope' }],
      ['webSession:signIn', { id: 'nope', url: 'https://music.amazon.com/' }]
    ]) {
      expect(await handlers[channel](mainFrameEvent, payload)).toMatchObject({ success: false, reason: 'not-ready' });
    }
  });

  test('a real createWebSessionHost registers (the primitive names stay in step)', () => {
    const host = createWebSessionHost({ id: 'testsvc', partition: 'persist:testsvc', cookieDomains: ['testsvc.com'] });
    expect(() => registerWebSession('testsvc', host)).not.toThrow();
    expect(host.cookieDomains).toEqual(['testsvc.com']);
  });
});

// ── sender gating ───────────────────────────────────────────────────────────

describe('sender gate', () => {
  test('iframes are denied on every channel', async () => {
    const { handlers } = makeBridge();
    for (const [channel, payload] of [
      ['webSession:load', { id: 'amazon-music', url: 'https://music.amazon.com/' }],
      ['webSession:pageFetch', { id: 'amazon-music', request: { url: 'https://music.amazon.com/x' } }],
      ['webSession:fetch', { id: 'amazon-music', request: { url: 'https://music.amazon.com/x' } }],
      ['webSession:state', { id: 'amazon-music' }],
      ['webSession:clear', { id: 'amazon-music' }],
      ['webSession:signIn', { id: 'amazon-music', url: 'https://music.amazon.com/' }],
      ['webSession:sign-in-decide', { callId: 'anything', verdict: true }]
    ]) {
      const out = await handlers[channel](iframeEvent, payload);
      expect(out).toMatchObject({ success: false, reason: 'denied' });
    }
  });
});

// ── load / state / clear: payloads and the error contract ──────────────────

describe('webSession:load', () => {
  test('success spreads the host payload; opts pass through', async () => {
    const host = makeFakeHost();
    const { handlers } = makeBridge({ host });
    const opts = { timeoutMs: 5000, capture: { urlPrefixes: ['https://gql.music.amazon.com/*'] } };
    const out = await handlers['webSession:load'](mainFrameEvent, { id: 'amazon-music', url: 'https://music.amazon.com/search/x/songs', opts });
    expect(out).toEqual({ success: true, finalUrl: 'https://music.amazon.com/' });
    expect(host.load).toHaveBeenCalledWith('https://music.amazon.com/search/x/songs', opts);
  });

  test('a host reason crosses verbatim; a reasonless throw maps to load-failed', async () => {
    const host = makeFakeHost({
      load: jest.fn(async () => {
        const err = new Error('the session was cleared while this load ran');
        err.reason = 'superseded';
        throw err;
      })
    });
    const { handlers } = makeBridge({ host });
    const out = await handlers['webSession:load'](mainFrameEvent, { id: 'amazon-music', url: 'https://music.amazon.com/' });
    expect(out).toMatchObject({ success: false, reason: 'superseded' });
    expect(out.error).toMatch(/cleared while this load ran/);

    const bare = makeFakeHost({ load: jest.fn(async () => { throw new Error('boom'); }) });
    const { handlers: h2 } = makeBridge({ host: bare });
    expect(await h2['webSession:load'](mainFrameEvent, { id: 'amazon-music', url: 'https://music.amazon.com/' }))
      .toMatchObject({ success: false, reason: 'load-failed', error: 'boom' });
  });

  test('a missing url is invalid before the host is touched', async () => {
    const host = makeFakeHost();
    const { handlers } = makeBridge({ host });
    expect(await handlers['webSession:load'](mainFrameEvent, { id: 'amazon-music' }))
      .toMatchObject({ success: false, reason: 'invalid' });
    expect(host.load).not.toHaveBeenCalled();
  });
});

describe('webSession:state / webSession:clear', () => {
  test('state spreads the host facts', async () => {
    const { handlers } = makeBridge();
    const out = await handlers['webSession:state'](mainFrameEvent, { id: 'amazon-music' });
    expect(out).toEqual({ success: true, url: 'https://music.amazon.com/', signInUrl: null, cookieNames: ['at-main'] });
  });

  test('a host clear failure maps to clear-failed (the channel contract) like a throw does; success passes through', async () => {
    const host = makeFakeHost({ clear: jest.fn(async () => ({ success: false, error: 'clearStorageData refused' })) });
    const { handlers } = makeBridge({ host });
    expect(await handlers['webSession:clear'](mainFrameEvent, { id: 'amazon-music' }))
      .toEqual({ success: false, reason: 'clear-failed', error: 'clearStorageData refused' });
    host.clear = jest.fn(async () => ({ success: true }));
    expect(await handlers['webSession:clear'](mainFrameEvent, { id: 'amazon-music' }))
      .toEqual({ success: true });
  });

  test('a throwing clear answers clear-failed', async () => {
    const { handlers } = makeBridge({ host: makeFakeHost({ clear: jest.fn(async () => { throw new Error('gone'); }) }) });
    expect(await handlers['webSession:clear'](mainFrameEvent, { id: 'amazon-music' }))
      .toMatchObject({ success: false, reason: 'clear-failed', error: 'gone' });
  });
});

// ── fetch / pageFetch: payloads and URL scoping ─────────────────────────────

describe('webSession:pageFetch', () => {
  test('a hit and a recoverable miss are both success; the error key distinguishes', async () => {
    const host = makeFakeHost({
      pageFetch: jest.fn(async () => ({ error: 'busy' }))
    });
    const { handlers } = makeBridge({ host });
    const busy = await handlers['webSession:pageFetch'](mainFrameEvent, {
      id: 'amazon-music', request: { url: 'https://gql.music.amazon.com/x', method: 'POST', headers: {}, body: '{}' }
    });
    expect(busy).toEqual({ success: true, error: 'busy' });
    host.pageFetch = jest.fn(async () => ({ status: 200, text: '{"ok":1}' }));
    const hit = await handlers['webSession:pageFetch'](mainFrameEvent, {
      id: 'amazon-music', request: { url: 'https://gql.music.amazon.com/x', method: 'POST' }
    });
    expect(hit).toEqual({ success: true, status: 200, text: '{"ok":1}' });
  });

  test('a URL off the session domains is invalid before the host is touched', async () => {
    const host = makeFakeHost();
    const { handlers } = makeBridge({ host });
    const out = await handlers['webSession:pageFetch'](mainFrameEvent, {
      id: 'amazon-music', request: { url: 'https://evil.example.com/replay' }
    });
    expect(out).toMatchObject({ success: false, reason: 'invalid' });
    expect(out.error).toMatch(/cookie domains/);
    expect(host.pageFetch).not.toHaveBeenCalled();
  });

  test('subdomains of a declared domain pass; lookalikes do not', async () => {
    const host = makeFakeHost();
    const { handlers } = makeBridge({ host });
    expect((await handlers['webSession:pageFetch'](mainFrameEvent, { id: 'amazon-music', request: { url: 'https://gql.music.amazon.com/x' } })).success).toBe(true);
    expect((await handlers['webSession:pageFetch'](mainFrameEvent, { id: 'amazon-music', request: { url: 'https://amazon.com.evil.com/x' } })).success).toBe(false);
  });
});

describe('webSession:fetch', () => {
  test('success spreads status/headers/text', async () => {
    const host = makeFakeHost();
    const { handlers } = makeBridge({ host });
    const out = await handlers['webSession:fetch'](mainFrameEvent, {
      id: 'amazon-music', request: { url: 'https://music.amazon.com/api/thing', method: 'POST', body: '{}' }
    });
    expect(out).toEqual({ success: true, status: 200, headers: { 'content-type': 'application/json' }, text: 'ok' });
    expect(host.fetch).toHaveBeenCalledWith({ url: 'https://music.amazon.com/api/thing', method: 'POST', body: '{}' });
  });

  test('off-domain and unparseable URLs are invalid; a host throw carries its reason', async () => {
    const host = makeFakeHost({
      fetch: jest.fn(async () => { const e = new Error('web-session fetch needs a url'); e.reason = 'invalid'; throw e; })
    });
    const { handlers } = makeBridge({ host });
    expect(await handlers['webSession:fetch'](mainFrameEvent, { id: 'amazon-music', request: { url: 'https://evil.example.com/' } }))
      .toMatchObject({ success: false, reason: 'invalid' });
    expect(await handlers['webSession:fetch'](mainFrameEvent, { id: 'amazon-music', request: { url: 'not a url' } }))
      .toMatchObject({ success: false, reason: 'invalid' });
    expect(host.fetch).not.toHaveBeenCalled();
    // On-domain: the host's own invalid throw crosses with its reason.
    expect(await handlers['webSession:fetch'](mainFrameEvent, { id: 'amazon-music', request: { url: 'https://music.amazon.com/x' } }))
      .toMatchObject({ success: false, reason: 'invalid' });
  });
});

describe('urlUnderDomains (the scope predicate)', () => {
  const domains = ['.amazon.com', 'music.amazon.com'];
  test('cookie-domain semantics: equal, subdomain, leading dot', () => {
    expect(urlUnderDomains('https://amazon.com/', domains)).toBe(true);
    expect(urlUnderDomains('https://music.amazon.com/', domains)).toBe(true);
    expect(urlUnderDomains('https://gql.music.amazon.com/graphql', domains)).toBe(true);
  });
  test('lookalikes, other schemes and garbage are out', () => {
    expect(urlUnderDomains('https://amazon.com.evil.com/', domains)).toBe(false);
    expect(urlUnderDomains('https://notamazon.com/', domains)).toBe(false);
    expect(urlUnderDomains('file:///etc/hosts', domains)).toBe(false);
    expect(urlUnderDomains('', domains)).toBe(false);
  });
});

// ── signIn over IPC: the tick / decide / settled shuttle ────────────────────

describe('webSession:signIn', () => {
  test('returns a callId, forwards every tick, latches the verdict, settles once', async () => {
    const flow = fakeSignInFlow();
    const host = makeFakeHost({ signIn: flow.signIn });
    const { handlers, byChannel, flush } = makeBridge({ host });
    const reply = await handlers['webSession:signIn'](mainFrameEvent, {
      id: 'amazon-music',
      url: 'https://music.amazon.com/',
      window: { width: 480, height: 320, title: 'Sign in to the service' }
    });
    expect(reply).toMatchObject({ success: true });
    const { callId } = reply;
    expect(typeof callId).toBe('string');
    expect(flow.signIn).toHaveBeenCalledTimes(1);
    expect(flow.signIn.mock.calls[0][0]).toBe('https://music.amazon.com/');
    expect(flow.signIn.mock.calls[0][1]).toMatchObject({ decide: expect.any(Function), width: 480, height: 320, title: 'Sign in to the service' });

    // Tick 1: forwarded to the renderer; no verdict yet, so the host sees false.
    await flow.tick({ url: 'https://music.amazon.com/ap/signin', cookieNames: [], stableTicks: 0 });
    expect(byChannel('webSession:sign-in-tick')).toEqual([
      { callId, url: 'https://music.amazon.com/ap/signin', cookieNames: [], stableTicks: 0 }
    ]);
    await expect(flow.tick({ url: 'https://music.amazon.com/', cookieNames: ['at-main'], stableTicks: 0 })).resolves.toBe(false);

    // The renderer's verdict lands on the NEXT tick (the latch), and settles.
    await handlers['webSession:sign-in-decide'](mainFrameEvent, { callId, verdict: true });
    await expect(flow.tick({ url: 'https://music.amazon.com/', cookieNames: ['at-main'], stableTicks: 1 })).resolves.toBe(true);
    flow.settle({ signedIn: true });
    await flush();
    expect(byChannel('webSession:sign-in-settled')).toEqual([{ callId, signedIn: true }]);
    // A tick the (broken) host fires after settling is forwarded for the
    // unsubscribed wrapper to drop — but settled never fires twice.
    await flow.tick({ url: 'https://music.amazon.com/', cookieNames: ['at-main'], stableTicks: 2 });
    expect(byChannel('webSession:sign-in-settled')).toHaveLength(1);
  });

  test('the person closing the window settles signed-in false (never an error)', async () => {
    const flow = fakeSignInFlow();
    const { handlers, byChannel, flush } = makeBridge({ host: makeFakeHost({ signIn: flow.signIn }) });
    const { callId } = await handlers['webSession:signIn'](mainFrameEvent, { id: 'amazon-music', url: 'https://music.amazon.com/' });
    await flow.tick({ url: 'https://music.amazon.com/ap/signin', cookieNames: [], stableTicks: 0 });
    flow.settle({ signedIn: false });
    await flush();
    expect(byChannel('webSession:sign-in-settled')).toEqual([{ callId, signedIn: false }]);
  });

  test('a host rejection settles every callId with the error', async () => {
    const flow = fakeSignInFlow();
    const { handlers, byChannel, flush } = makeBridge({ host: makeFakeHost({ signIn: flow.signIn }) });
    const { callId } = await handlers['webSession:signIn'](mainFrameEvent, { id: 'amazon-music', url: 'https://music.amazon.com/' });
    flow.reject(new Error('ERR_ABORTED'));
    await flush();
    expect(byChannel('webSession:sign-in-settled')).toEqual([{ callId, signedIn: false, error: 'ERR_ABORTED' }]);
  });

  test('a synchronous host.signIn throw still settles the call', async () => {
    const host = makeFakeHost({ signIn: jest.fn(() => { throw new Error('no BrowserWindow'); }) });
    const { handlers, byChannel } = makeBridge({ host });
    const { callId } = await handlers['webSession:signIn'](mainFrameEvent, { id: 'amazon-music', url: 'https://music.amazon.com/' });
    expect(byChannel('webSession:sign-in-settled')).toEqual([{ callId, signedIn: false, error: 'no BrowserWindow' }]);
  });

  test('a missing url is invalid; a bad window option is dropped, not thrown', async () => {
    const flow = fakeSignInFlow();
    const { handlers } = makeBridge({ host: makeFakeHost({ signIn: flow.signIn }) });
    expect(await handlers['webSession:signIn'](mainFrameEvent, { id: 'amazon-music' }))
      .toMatchObject({ success: false, reason: 'invalid' });
    const reply = await handlers['webSession:signIn'](mainFrameEvent, {
      id: 'amazon-music', url: 'https://music.amazon.com/', window: { width: 'wide', title: 7 }
    });
    expect(reply).toMatchObject({ success: true });
    expect(flow.signIn.mock.calls[0][1]).toEqual({ decide: expect.any(Function) });
  });
});

describe('webSession:signIn — two calls join one run (the host joins; so does the bridge)', () => {
  test('one host.signIn, two callIds, both ticked and both settled', async () => {
    const flow = fakeSignInFlow();
    const { handlers, byChannel, flush } = makeBridge({ host: makeFakeHost({ signIn: flow.signIn }) });
    const first = await handlers['webSession:signIn'](mainFrameEvent, { id: 'amazon-music', url: 'https://music.amazon.com/' });
    const second = await handlers['webSession:signIn'](mainFrameEvent, {
      id: 'amazon-music', url: 'https://music.amazon.com/', window: { width: 1, height: 1 } // ignored: the open window's flow runs
    });
    expect(flow.signIn).toHaveBeenCalledTimes(1); // no second window, no second ticker
    expect(second.callId).not.toBe(first.callId);

    await flow.tick({ url: 'https://music.amazon.com/ap/signin', cookieNames: [], stableTicks: 0 });
    expect(byChannel('webSession:sign-in-tick').map((p) => p.callId).sort())
      .toEqual([first.callId, second.callId].sort());

    // Either joined call's verdict settles the shared window.
    await handlers['webSession:sign-in-decide'](mainFrameEvent, { callId: second.callId, verdict: true });
    await expect(flow.tick({ url: 'https://music.amazon.com/', cookieNames: ['at-main'], stableTicks: 1 })).resolves.toBe(true);
    flow.settle({ signedIn: true });
    await flush();
    const settled = byChannel('webSession:sign-in-settled');
    expect(settled.map((p) => p.callId).sort()).toEqual([first.callId, second.callId].sort());
    expect(settled.every((p) => p.signedIn === true)).toBe(true);
  });
});

describe('webSession:sign-in-decide', () => {
  test('an unknown or settled callId is invalid', async () => {
    const flow = fakeSignInFlow();
    const { handlers, flush } = makeBridge({ host: makeFakeHost({ signIn: flow.signIn }) });
    expect(await handlers['webSession:sign-in-decide'](mainFrameEvent, { callId: 'never-minted', verdict: true }))
      .toMatchObject({ success: false, reason: 'invalid' });
    const { callId } = await handlers['webSession:signIn'](mainFrameEvent, { id: 'amazon-music', url: 'https://music.amazon.com/' });
    expect(await handlers['webSession:sign-in-decide'](mainFrameEvent, { callId, verdict: true }))
      .toEqual({ success: true });
    flow.settle({ signedIn: false });
    await flush();
    expect(await handlers['webSession:sign-in-decide'](mainFrameEvent, { callId, verdict: true }))
      .toMatchObject({ success: false, reason: 'invalid' });
  });

  test('a false verdict re-arms: the latch holds the latest answer, not the first', async () => {
    const flow = fakeSignInFlow();
    const { handlers } = makeBridge({ host: makeFakeHost({ signIn: flow.signIn }) });
    const { callId } = await handlers['webSession:signIn'](mainFrameEvent, { id: 'amazon-music', url: 'https://music.amazon.com/' });
    await handlers['webSession:sign-in-decide'](mainFrameEvent, { callId, verdict: true });
    await handlers['webSession:sign-in-decide'](mainFrameEvent, { callId, verdict: false });
    await expect(flow.tick({ url: 'https://music.amazon.com/', cookieNames: [], stableTicks: 0 })).resolves.toBe(false);
    await handlers['webSession:sign-in-decide'](mainFrameEvent, { callId, verdict: true });
    await expect(flow.tick({ url: 'https://music.amazon.com/', cookieNames: [], stableTicks: 1 })).resolves.toBe(true);
  });

  test('re-registering the IPC (init-time) kills pending sign-in calls', async () => {
    const flow = fakeSignInFlow();
    const host = makeFakeHost({ signIn: flow.signIn });
    const { handlers } = makeBridge({ host });
    const { callId } = await handlers['webSession:signIn'](mainFrameEvent, { id: 'amazon-music', url: 'https://music.amazon.com/' });
    const second = makeBridge({ host });
    expect(await second.handlers['webSession:sign-in-decide'](mainFrameEvent, { callId, verdict: true }))
      .toMatchObject({ success: false, reason: 'invalid' });
  });
});
