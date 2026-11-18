// main-process/ipc/web-session-bridge.js — the IPC bridge over registered
// web-session hosts (#1356): sender gating (main window top frame only),
// the { success, reason, error } IPC error contract, fetch/pageFetch/
// load/signIn URL scoping to the session's exact-host allowlist, and the
// signIn tick/decide/settled shuttle (including the two-calls join: one window, one
// ticker, two callIds, both settled). The bridge is dependency-injected
// (ipcMain, isAllowedSender, sendToRenderer, the hosts themselves), so these
// tests need no electron mock — the fake hosts carry the host contract.

const {
  registerWebSession,
  registerWebSessionBridgeIpc
} = require('../../main-process/ipc/web-session-bridge');
// urlOnAllowedHost is the bridge's one URL predicate (fetch/pageFetch,
// capture prefixes, load/signIn — one list, one judgment).
const { createWebSessionHost, urlOnAllowedHost } = require('../../main-process/web-session');

// ── fakes ───────────────────────────────────────────────────────────────────

function makeFakeHost(overrides = {}) {
  return {
    // The bridge never reads this — every URL scope goes by allowedHosts —
    // but a real host's jar still scopes by it (web-session cfg), and its
    // presence here pins that the narrow list, not the account-wide domain,
    // is what gates load/signIn below (www.amazon.com is under amazon.com,
    // and it is INVALID as a load/signIn URL).
    cookieDomains: ['amazon.com', 'music.amazon.com'],
    // The exact-host allowlist, deliberately NARROWER than the cookie domains
    // (amazon.com is the whole retail account) — the finding-1 shape.
    allowedHosts: ['music.amazon.com', 'gql.music.amazon.com'],
    load: jest.fn(async () => ({ finalUrl: 'https://music.amazon.com/' })),
    pageFetch: jest.fn(async () => ({ status: 200, text: '[]' })),
    fetch: jest.fn(async () => ({ status: 200, headers: { 'content-type': 'application/json' }, text: 'ok' })),
    state: jest.fn(async () => ({ url: 'https://music.amazon.com/', signInUrl: null, cookieNames: ['at-main'], generation: 0 })),
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

// The default gate is literally () => true — a test that means to allow says
// so (#1432 review, note 5); pass null to register WITHOUT a predicate and pin
// the fail-closed default.
function makeBridge({ host = makeFakeHost(), isAllowedSender = () => true } = {}) {
  if (host) registerWebSession('amazon-music', host);
  const handlers = {};
  const ipcMain = { handle: (name, fn) => { handlers[name] = fn; } };
  const sent = [];
  const sendToRenderer = jest.fn((channel, payload) => { sent.push({ channel, payload }); });
  registerWebSessionBridgeIpc({ ipcMain, isAllowedSender, sendToRenderer });
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
  test('a host must implement the six primitives and carry allowedHosts', () => {
    expect(() => registerWebSession('', makeFakeHost())).toThrow(/session id/);
    expect(() => registerWebSession('x')).toThrow(/must implement/);
    const missingClear = makeFakeHost();
    delete missingClear.clear;
    expect(() => registerWebSession('x', missingClear)).toThrow(/must implement/);
    expect(() => registerWebSession('x', makeFakeHost({ allowedHosts: undefined }))).toThrow(/allowedHosts/);
    expect(() => registerWebSession('x', makeFakeHost({ allowedHosts: [] }))).toThrow(/allowedHosts/);
    expect(() => registerWebSession('x', makeFakeHost({ allowedHosts: ['music.amazon.com', ''] }))).toThrow(/allowedHosts/);
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
    const host = createWebSessionHost({
      id: 'testsvc', partition: 'persist:testsvc',
      cookieDomains: ['testsvc.com'], allowedHosts: ['music.testsvc.com']
    });
    expect(() => registerWebSession('testsvc', host)).not.toThrow();
    // The bridge's one scope reads allowedHosts off the host; the host still
    // requires cookieDomains at construction (state()/clear() read the
    // closed-over cfg directly — the host carries no public copy for a
    // bridge to drift from).
    expect(host.allowedHosts).toEqual(['music.testsvc.com']);
  });
});

// ── sender gating ───────────────────────────────────────────────────────────

describe('sender gate', () => {
  test('iframes are denied on every channel', async () => {
    // A gate shaped like main.js's top-frame predicate (the iframe shares the
    // sender webContents but not the top frame).
    const { handlers } = makeBridge({
      isAllowedSender: (event) => !!(event && event.senderFrame && event.senderFrame.top === event.senderFrame)
    });
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

  test('the gate FAILS CLOSED: a registration without isAllowedSender denies every caller (#1432 review, note 5)', async () => {
    // main.js always passes one; a gate that defaulted to allow would be one
    // refactor away from an open bridge. A test that means to allow passes
    // () => true (the makeBridge default below, the registration smoke).
    const { handlers } = makeBridge({ isAllowedSender: null });
    for (const [channel, payload] of [
      ['webSession:load', { id: 'amazon-music', url: 'https://music.amazon.com/' }],
      ['webSession:pageFetch', { id: 'amazon-music', request: { url: 'https://music.amazon.com/x' } }],
      ['webSession:fetch', { id: 'amazon-music', request: { url: 'https://music.amazon.com/x' } }],
      ['webSession:state', { id: 'amazon-music' }],
      ['webSession:clear', { id: 'amazon-music' }],
      ['webSession:signIn', { id: 'amazon-music', url: 'https://music.amazon.com/' }],
      ['webSession:sign-in-decide', { callId: 'anything', verdict: true }]
    ]) {
      const out = await handlers[channel](mainFrameEvent, payload);
      expect(out).toMatchObject({ success: false, reason: 'denied' });
    }
  });
});

// ── load / state / clear: payloads and the error contract ──────────────────

describe('webSession:load', () => {
  test('success spreads the host payload; opts pass through scoped and clamped', async () => {
    const host = makeFakeHost();
    const { handlers } = makeBridge({ host });
    const opts = { timeoutMs: 5000, capture: { urlPrefixes: ['https://gql.music.amazon.com/*'] } };
    const out = await handlers['webSession:load'](mainFrameEvent, { id: 'amazon-music', url: 'https://music.amazon.com/search/x/songs', opts });
    expect(out).toEqual({ success: true, finalUrl: 'https://music.amazon.com/' });
    expect(host.load).toHaveBeenCalledWith('https://music.amazon.com/search/x/songs', opts);
  });

  test('a URL off the allowed hosts or not https is invalid before the host is touched (#1432 review, finding 3’s follow-up)', async () => {
    const host = makeFakeHost();
    const { handlers } = makeBridge({ host });
    for (const url of [
      'https://www.amazon.com/ap/signin',       // UNDER the cookie domains, NOT on the allowlist — the finding-1 shape, now out for loads too
      'https://not-amazon.example/search',      // off both lists entirely
      'http://music.amazon.com/search',         // the host matches, the scheme is not https
      'not a url'
    ]) {
      const out = await handlers['webSession:load'](mainFrameEvent, { id: 'amazon-music', url, opts: {} });
      expect(out).toMatchObject({ success: false, reason: 'invalid' });
      expect(out.error).toMatch(/https on one of the session's allowed hosts/);
    }
    expect(host.load).not.toHaveBeenCalled();
  });

  test('capture prefixes off the session’s allowed hosts are invalid — a prefix chooses what gets recorded (#1432 review, findings 1-2)', async () => {
    const host = makeFakeHost();
    const { handlers } = makeBridge({ host });
    // www.amazon.com is UNDER the cookie domains but NOT on the allowlist —
    // the finding-1 shape: the sign-in form’s POST body lives there.
    const out = await handlers['webSession:load'](mainFrameEvent, {
      id: 'amazon-music',
      url: 'https://music.amazon.com/search/x/songs',
      opts: { capture: { urlPrefixes: ['https://www.amazon.com/ap/signin/*'] } }
    });
    expect(out).toMatchObject({ success: false, reason: 'invalid' });
    expect(out.error).toMatch(/allowed hosts/);
    expect(host.load).not.toHaveBeenCalled();
    // An http: prefix is out too, and so is a non-array.
    expect(await handlers['webSession:load'](mainFrameEvent, {
      id: 'amazon-music', url: 'https://music.amazon.com/',
      opts: { capture: { urlPrefixes: ['http://gql.music.amazon.com/*'] } }
    })).toMatchObject({ success: false, reason: 'invalid' });
    expect(await handlers['webSession:load'](mainFrameEvent, {
      id: 'amazon-music', url: 'https://music.amazon.com/',
      opts: { capture: { urlPrefixes: 'nope' } }
    })).toMatchObject({ success: false, reason: 'invalid' });
  });

  test('caller budgets are clamped to the ceilings: the host gets min(the value, the cap) (#1432 review, finding 2)', async () => {
    const host = makeFakeHost();
    const { handlers } = makeBridge({ host });
    const out = await handlers['webSession:load'](mainFrameEvent, {
      id: 'amazon-music',
      url: 'https://music.amazon.com/',
      opts: {
        timeoutMs: 600000, // ten minutes → 60s
        capture: {
          urlPrefixes: ['https://gql.music.amazon.com/*'],
          quietMs: 120000,  // two minutes → 10s
          budgetMs: 300000   // five minutes → 30s
        }
      }
    });
    expect(out).toMatchObject({ success: true });
    expect(host.load).toHaveBeenCalledWith('https://music.amazon.com/', {
      timeoutMs: 60000,
      capture: { urlPrefixes: ['https://gql.music.amazon.com/*'], quietMs: 10000, budgetMs: 30000 }
    });
    // Under the caps and non-numeric values pass through untouched (the
    // host’s own defaults and garbage handling apply).
    await handlers['webSession:load'](mainFrameEvent, {
      id: 'amazon-music', url: 'https://music.amazon.com/',
      opts: { timeoutMs: 5000, capture: { urlPrefixes: ['https://gql.music.amazon.com/*'], quietMs: 500, budgetMs: 4000 } }
    });
    expect(host.load).toHaveBeenLastCalledWith('https://music.amazon.com/', {
      timeoutMs: 5000,
      capture: { urlPrefixes: ['https://gql.music.amazon.com/*'], quietMs: 500, budgetMs: 4000 }
    });
    await handlers['webSession:load'](mainFrameEvent, {
      id: 'amazon-music', url: 'https://music.amazon.com/', opts: { timeoutMs: 'forever' }
    });
    expect(host.load).toHaveBeenLastCalledWith('https://music.amazon.com/', { timeoutMs: 'forever' });
  });

  test('capture.doneWhen passes through when well-formed and is rejected like a bad prefix when not (rule 5\'s data-only stop, as data)', async () => {
    const host = makeFakeHost();
    const { handlers } = makeBridge({ host });
    // Well-formed: the host's own shape, keys and all — one rule at both
    // seams (the host re-checks it; the bridge is the boundary the renderer
    // crosses). A doneWhen is data, not a budget — nothing is clamped.
    const doneWhen = { bodyIncludes: '"AlbumDetailPage"', urlIncludes: '/gql' };
    const out = await handlers['webSession:load'](mainFrameEvent, {
      id: 'amazon-music',
      url: 'https://music.amazon.com/albums/B1',
      opts: { capture: { urlPrefixes: ['https://gql.music.amazon.com/*'], quietMs: 4500, budgetMs: 15000, doneWhen } }
    });
    expect(out).toMatchObject({ success: true });
    expect(host.load).toHaveBeenCalledWith('https://music.amazon.com/albums/B1', {
      capture: { urlPrefixes: ['https://gql.music.amazon.com/*'], quietMs: 4500, budgetMs: 15000, doneWhen }
    });
    // Malformed: rejected before the host is touched, like a bad prefix — a
    // stop condition is a wait-ending power, so an unknown key or a
    // non-string value must not ride through on a typo.
    for (const bad of [
      '"AlbumDetailPage"',            // a string, not the declarative record
      {},                             // no condition — matches nothing
      { needle: 'AlbumDetailPage' },  // an unknown key
      { bodyIncludes: 42 },           // not a string
      { bodyIncludes: '' },           // matches everything — a bug, not a wait
      { bodyIncludes: 'x'.repeat(513) } // not a needle the caller writes
    ]) {
      const refused = await handlers['webSession:load'](mainFrameEvent, {
        id: 'amazon-music',
        url: 'https://music.amazon.com/albums/B1',
        opts: { capture: { urlPrefixes: ['https://gql.music.amazon.com/*'], doneWhen: bad } }
      });
      expect(refused).toMatchObject({ success: false, reason: 'invalid' });
    }
    expect(host.load).toHaveBeenCalledTimes(1); // only the well-formed one reached the host
  });

  test("capture.returnOnTimeout passes through as the escape's opt-in and is rejected when not a boolean", async () => {
    const host = makeFakeHost();
    const { handlers } = makeBridge({ host });
    // The opt-in to rule 5's budget escape is data, not a budget — nothing
    // to clamp. Only `true` is carried across; the default (absent/false)
    // keeps the old throws-load-failed contract.
    const out = await handlers['webSession:load'](mainFrameEvent, {
      id: 'amazon-music',
      url: 'https://music.amazon.com/playlists/PP1',
      opts: { capture: { urlPrefixes: ['https://gql.music.amazon.com/*'], returnOnTimeout: true } }
    });
    expect(out).toMatchObject({ success: true });
    expect(host.load).toHaveBeenCalledWith('https://music.amazon.com/playlists/PP1', {
      capture: { urlPrefixes: ['https://gql.music.amazon.com/*'], returnOnTimeout: true }
    });
    const off = await handlers['webSession:load'](mainFrameEvent, {
      id: 'amazon-music',
      url: 'https://music.amazon.com/playlists/PP1',
      opts: { capture: { urlPrefixes: ['https://gql.music.amazon.com/*'], returnOnTimeout: false } }
    });
    expect(off).toMatchObject({ success: true });
    expect(host.load).toHaveBeenLastCalledWith('https://music.amazon.com/playlists/PP1', {
      capture: { urlPrefixes: ['https://gql.music.amazon.com/*'] }
    });
    // Malformed: rejected before the host is touched, like a bad prefix —
    // the escape is a wait-ending power, so a typo must not ride through.
    for (const bad of ['yes', 1, {}]) {
      const refused = await handlers['webSession:load'](mainFrameEvent, {
        id: 'amazon-music',
        url: 'https://music.amazon.com/playlists/PP1',
        opts: { capture: { urlPrefixes: ['https://gql.music.amazon.com/*'], returnOnTimeout: bad } }
      });
      expect(refused).toMatchObject({ success: false, reason: 'invalid' });
    }
    expect(host.load).toHaveBeenCalledTimes(2); // only the well-formed ones reached the host
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
  test('state spreads the host facts (generation included — the clear()-bumped sign-out signal)', async () => {
    const { handlers } = makeBridge();
    const out = await handlers['webSession:state'](mainFrameEvent, { id: 'amazon-music' });
    expect(out).toEqual({ success: true, url: 'https://music.amazon.com/', signInUrl: null, cookieNames: ['at-main'], generation: 0 });
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

  test('a URL off the session’s ALLOWED HOSTS is invalid before the host is touched (#1432 review, finding 1)', async () => {
    const host = makeFakeHost();
    const { handlers } = makeBridge({ host });
    const out = await handlers['webSession:pageFetch'](mainFrameEvent, {
      id: 'amazon-music', request: { url: 'https://evil.example.com/replay' }
    });
    expect(out).toMatchObject({ success: false, reason: 'invalid' });
    expect(out.error).toMatch(/allowed hosts/);
    expect(host.pageFetch).not.toHaveBeenCalled();
  });

  test('a URL on the cookie domain but off the allowlist is invalid — www.amazon.com is the retail account, not the service (#1432 review, finding 1)', async () => {
    const host = makeFakeHost();
    const { handlers } = makeBridge({ host });
    const out = await handlers['webSession:pageFetch'](mainFrameEvent, {
      id: 'amazon-music', request: { url: 'https://www.amazon.com/gp/your-account' }
    });
    expect(out).toMatchObject({ success: false, reason: 'invalid' });
    expect(out.error).toMatch(/allowed hosts \(music\.amazon\.com, gql\.music\.amazon\.com\)/);
    expect(host.pageFetch).not.toHaveBeenCalled();
  });

  test('an http: URL is invalid — the jar must never ride in the clear', async () => {
    const host = makeFakeHost();
    const { handlers } = makeBridge({ host });
    const out = await handlers['webSession:pageFetch'](mainFrameEvent, {
      id: 'amazon-music', request: { url: 'http://music.amazon.com/x' }
    });
    expect(out).toMatchObject({ success: false, reason: 'invalid' });
    expect(host.pageFetch).not.toHaveBeenCalled();
  });

  test('exact hosts only: subdomains beyond the listed host and lookalikes do not pass', async () => {
    const host = makeFakeHost();
    const { handlers } = makeBridge({ host });
    expect((await handlers['webSession:pageFetch'](mainFrameEvent, { id: 'amazon-music', request: { url: 'https://gql.music.amazon.com/x' } })).success).toBe(true);
    expect((await handlers['webSession:pageFetch'](mainFrameEvent, { id: 'amazon-music', request: { url: 'https://evil.music.amazon.com/x' } })).success).toBe(false); // a subdomain of a listed host is a different host
    expect((await handlers['webSession:pageFetch'](mainFrameEvent, { id: 'amazon-music', request: { url: 'https://music.amazon.com.evil.com/x' } })).success).toBe(false);
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

  test('off-allowlist, on-cookie-domain-but-off-allowlist, non-https and unparseable URLs are invalid; a host throw carries its reason (#1432 review, finding 1)', async () => {
    const host = makeFakeHost({
      fetch: jest.fn(async () => { const e = new Error('web-session fetch needs a url'); e.reason = 'invalid'; throw e; })
    });
    const { handlers } = makeBridge({ host });
    expect(await handlers['webSession:fetch'](mainFrameEvent, { id: 'amazon-music', request: { url: 'https://evil.example.com/' } }))
      .toMatchObject({ success: false, reason: 'invalid' });
    // The finding-1 case: under the cookie domain, off the allowlist — this
    // fetch carries the session's jar, and www.amazon.com is the account.
    expect(await handlers['webSession:fetch'](mainFrameEvent, { id: 'amazon-music', request: { url: 'https://www.amazon.com/gp/your-orders' } }))
      .toMatchObject({ success: false, reason: 'invalid' });
    expect(await handlers['webSession:fetch'](mainFrameEvent, { id: 'amazon-music', request: { url: 'http://music.amazon.com/x' } }))
      .toMatchObject({ success: false, reason: 'invalid' });
    expect(await handlers['webSession:fetch'](mainFrameEvent, { id: 'amazon-music', request: { url: 'not a url' } }))
      .toMatchObject({ success: false, reason: 'invalid' });
    expect(host.fetch).not.toHaveBeenCalled();
    // On the allowlist: the host's own invalid throw crosses with its reason.
    expect(await handlers['webSession:fetch'](mainFrameEvent, { id: 'amazon-music', request: { url: 'https://music.amazon.com/x' } }))
      .toMatchObject({ success: false, reason: 'invalid' });
  });
});

describe('urlOnAllowedHost (the ONE fetch/pageFetch/capture/load/signIn scope predicate — https exact-host only)', () => {
  const hosts = ['music.amazon.com', 'gql.music.amazon.com'];
  test('exact-host semantics: any listed host; www.amazon.com is NOT a suffix match (the finding-3 follow-up shape)', () => {
    expect(urlOnAllowedHost('https://music.amazon.com/', hosts)).toBe(true);
    expect(urlOnAllowedHost('https://gql.music.amazon.com/graphql', hosts)).toBe(true);
    // The identity host is under the amazon.com cookie domain, but the list
    // is exact hosts — a load or sign-in off the list never reaches the
    // bridge's host.
    expect(urlOnAllowedHost('https://www.amazon.com/ap/signin', hosts)).toBe(false);
    expect(urlOnAllowedHost('https://amazon.com/', hosts)).toBe(false);
  });
  test('lookalikes, deeper subdomains, other schemes (http included — Amazon’s identity host is https) and garbage are out', () => {
    expect(urlOnAllowedHost('https://music.amazon.com.evil.com/', hosts)).toBe(false);
    expect(urlOnAllowedHost('https://x.gql.music.amazon.com/', hosts)).toBe(false);
    expect(urlOnAllowedHost('http://music.amazon.com/', hosts)).toBe(false);
    expect(urlOnAllowedHost('file:///etc/hosts', hosts)).toBe(false);
    expect(urlOnAllowedHost('', hosts)).toBe(false);
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
      window: { width: 480, height: 320, title: 'Sign in to Your Bank' } // the title is host config — a caller-chosen one is dropped (finding 3)
    });
    expect(reply).toMatchObject({ success: true });
    const { callId } = reply;
    expect(typeof callId).toBe('string');
    expect(flow.signIn).toHaveBeenCalledTimes(1);
    expect(flow.signIn.mock.calls[0][0]).toBe('https://music.amazon.com/');
    // Width/height cross; the caller's title does NOT (the host names the
    // window from its own config — a caller-chosen title on a window with no
    // URL bar is a phishing surface).
    expect(flow.signIn.mock.calls[0][1]).toEqual({ decide: expect.any(Function), width: 480, height: 320 });

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

  test('a URL off the allowed hosts or not https is invalid before the host is touched (#1432 review, finding 3’s follow-up)', async () => {
    const flow = fakeSignInFlow();
    const host = makeFakeHost({ signIn: flow.signIn });
    const { handlers } = makeBridge({ host });
    for (const url of [
      'https://www.amazon.com/ap/signin',   // UNDER the cookie domains, NOT on the allowlist — the service's sign-in starts on its music host
      'https://evil.example.com/ap/signin', // off both lists entirely
      'http://music.amazon.com/ap/signin',  // the host matches, the scheme is not https
      'not a url'
    ]) {
      const out = await handlers['webSession:signIn'](mainFrameEvent, { id: 'amazon-music', url });
      expect(out).toMatchObject({ success: false, reason: 'invalid' });
      expect(out.error).toMatch(/https on one of the session's allowed hosts/);
    }
    expect(flow.signIn).not.toHaveBeenCalled();
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
