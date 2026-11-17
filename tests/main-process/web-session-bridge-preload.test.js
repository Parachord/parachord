// The webSession bridge's renderer half (preload.js) against its main half
// (main-process/ipc/web-session-bridge.js), end to end through a mocked
// electron: contextBridge captures what the preload exposes, ipcRenderer's
// invoke is wired to the bridge's handlers and its on/removeListener to the
// bridge's sendToRenderer. This pins the signIn protocol as the renderer will
// actually run it: the wrapper runs decide() on every forwarded tick, answers
// with the verdict, and resolves from the settled event — including the
// one-tick latch latency and the unsubscribe on settle.

const {
  registerWebSession,
  registerWebSessionBridgeIpc
} = require('../../main-process/ipc/web-session-bridge');

// jest.mock factories are hoisted and may only reference mock*-prefixed state.
const mockWorld = {};            // what contextBridge.exposeInMainWorld published
const mockIpcListeners = new Map(); // channel → Set(listener), the renderer's ipcRenderer.on bus
const mockInvokes = [];          // { channel, payload } — every invoke the renderer made
let mockHandlers = {};           // channel → the bridge's ipcMain.handle fn

jest.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (name, value) => { mockWorld[name] = value; }
  },
  ipcRenderer: {
    invoke: (channel, payload) => {
      mockInvokes.push({ channel, payload });
      const handler = mockHandlers[channel];
      if (!handler) return Promise.resolve({ success: false, reason: 'not-ready', error: `no handler for ${channel}` });
      return handler({ ok: true }, payload);
    },
    on: (channel, fn) => {
      if (!mockIpcListeners.has(channel)) mockIpcListeners.set(channel, new Set());
      mockIpcListeners.get(channel).add(fn);
    },
    removeListener: (channel, fn) => {
      const set = mockIpcListeners.get(channel);
      if (set) set.delete(fn);
    }
  }
}));

// The preload's webSession wrapper is LIVE (#1356 M5 — the Amazon plugin's
// track search is the bridge's first consumer, and the layer that first
// drives the bridge turns the surface on): the preload exposes it
// unconditionally, so this suite requires the preload directly. The live
// exposure is pinned at the bottom of the file (no env seam anymore — the
// flag is gone).
require('../../preload');

const topFrame = {};
Object.defineProperty(topFrame, 'top', { value: topFrame });

function wireBridge(host) {
  registerWebSession('amazon-music', host);
  mockHandlers = {};
  registerWebSessionBridgeIpc({
    ipcMain: { handle: (name, fn) => { mockHandlers[name] = fn; } },
    isAllowedSender: (event) => !!(event && event.ok),
    sendToRenderer: (channel, payload) => {
      for (const listener of mockIpcListeners.get(channel) || []) listener({}, payload);
    }
  });
}

function fakeSignInFlow() {
  let resolveRun;
  let decide = null;
  const run = new Promise((resolve) => { resolveRun = resolve; });
  return {
    signIn: jest.fn(async (_url, { decide: d }) => { decide = d; return run; }),
    tick: async (tick) => (decide ? decide(tick) : false),
    settle: resolveRun
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  mockIpcListeners.clear();
  mockInvokes.length = 0;
});

describe('the exposed surface', () => {
  test('window.electron.webSession carries the six primitives; window.__parachordHostBridges advertises the bridges', () => {
    expect(mockWorld.electron.webSession).toBeTruthy();
    for (const name of ['load', 'pageFetch', 'fetch', 'state', 'clear', 'signIn']) {
      expect(typeof mockWorld.electron.webSession[name]).toBe('function');
    }
    expect([...mockWorld.__parachordHostBridges]).toEqual(['webSession']);
  });
});

describe('webSession.signIn — the preload wrapper against the bridge', () => {
  test('the wrapper runs decide() per forwarded tick, answers with the verdict, resolves from settled, and unsubscribes', async () => {
    const flow = fakeSignInFlow();
    wireBridge({
      cookieDomains: ['amazon.com'],
      allowedHosts: ['music.amazon.com', 'gql.music.amazon.com'],
      load: jest.fn(), pageFetch: jest.fn(), fetch: jest.fn(), state: jest.fn(), clear: jest.fn(),
      signIn: flow.signIn
    });
    const seen = [];
    const wrapper = mockWorld.electron.webSession.signIn('amazon-music', 'https://music.amazon.com/', {
      // The title is host config (finding 3): a caller-chosen one is stripped
      // here, never reaching the bridge.
      window: { width: 480, height: 320, title: 'Sign in to Your Bank' },
      decide: (tick) => {
        seen.push(tick);
        return tick.cookieNames.includes('at-main') && tick.stableTicks >= 1;
      }
    });
    await flush(); // the invoke reply set the wrapper's callId
    expect(flow.signIn).toHaveBeenCalledTimes(1);
    expect(flow.signIn.mock.calls[0][1]).toEqual({ decide: expect.any(Function), width: 480, height: 320 });

    // Tick 1: decide says false (not stable yet) — forwarded, answered, host sees false.
    await flow.tick({ url: 'https://music.amazon.com/', cookieNames: ['at-main'], stableTicks: 0 });
    expect(seen).toEqual([{ url: 'https://music.amazon.com/', cookieNames: ['at-main'], stableTicks: 0 }]);
    await expect(flow.tick({ url: 'https://music.amazon.com/', cookieNames: ['at-main'], stableTicks: 0 })).resolves.toBe(false);

    // Tick 2: decide says true — the latch carries it to the host on the NEXT tick.
    await flow.tick({ url: 'https://music.amazon.com/', cookieNames: ['at-main'], stableTicks: 1 });
    await expect(flow.tick({ url: 'https://music.amazon.com/', cookieNames: ['at-main'], stableTicks: 2 })).resolves.toBe(true);
    expect(seen).toHaveLength(4); // one decide per forwarded tick

    flow.settle({ signedIn: true });
    await expect(wrapper).resolves.toEqual({ success: true, signedIn: true });
    // Clean unsubscribe on settle: the wrapper stops answering, and a late
    // decide for the settled callId finds no pending run.
    const decide = mockInvokes.find((i) => i.channel === 'webSession:sign-in-decide');
    expect(decide).toBeTruthy(); // the wrapper answered at least one tick
    const settledDecide = await mockHandlers['webSession:sign-in-decide']({ ok: true }, { callId: decide.payload.callId, verdict: true });
    expect(settledDecide).toMatchObject({ success: false, reason: 'invalid' });
  });

  test('a refused invoke resolves success:false instead of hanging, and subscribes nothing that stays', async () => {
    const host = { cookieDomains: ['amazon.com'],
      allowedHosts: ['music.amazon.com', 'gql.music.amazon.com'], load: jest.fn(), pageFetch: jest.fn(), fetch: jest.fn(), state: jest.fn(), clear: jest.fn(), signIn: jest.fn() };
    wireBridge(host);
    const wrapper = mockWorld.electron.webSession.signIn('not-a-session', 'https://music.amazon.com/', { decide: () => true });
    await expect(wrapper).resolves.toMatchObject({ success: false, reason: 'not-ready' });
    expect(host.signIn).not.toHaveBeenCalled();
    expect(mockIpcListeners.get('webSession:sign-in-tick')?.size || 0).toBe(0);
    expect(mockIpcListeners.get('webSession:sign-in-settled')?.size || 0).toBe(0);
  });

  test('a settle that lands BEFORE the invoke reply (a synchronous host throw) is buffered and still resolves the wrapper', async () => {
    // The order the race lives on: the bridge settles a synchronously-throwing
    // host.signIn INSIDE the handler (startSignIn's catch), and this harness
    // delivers sendToRenderer synchronously inside the invoke — so the settled
    // event reaches the wrapper while its callId is still null, ahead of the
    // invoke's reply. A callId filter alone drops it and wedges the promise
    // forever; the wrapper must buffer it and resolve on the reply.
    wireBridge({
      cookieDomains: ['amazon.com'],
      allowedHosts: ['music.amazon.com', 'gql.music.amazon.com'],
      load: jest.fn(), pageFetch: jest.fn(), fetch: jest.fn(), state: jest.fn(), clear: jest.fn(),
      signIn: jest.fn(() => { throw new Error('no BrowserWindow'); })
    });
    const wrapper = mockWorld.electron.webSession.signIn('amazon-music', 'https://music.amazon.com/', { decide: () => true });
    await expect(wrapper).resolves.toEqual({ success: true, signedIn: false, error: 'no BrowserWindow' });
    // And the listeners came off exactly once: nothing stays subscribed.
    expect(mockIpcListeners.get('webSession:sign-in-tick')?.size || 0).toBe(0);
    expect(mockIpcListeners.get('webSession:sign-in-settled')?.size || 0).toBe(0);
  });

  test('a tick that lands BEFORE the invoke reply is buffered and flushed once the reply names the callId', async () => {
    // The same order, tick half: this fake host fires its first decide()
    // during the handler, so the forwarded tick beats the reply. The wrapper
    // buffers it, then runs the plugin's decide on it after the reply lands.
    let settleRun;
    const run = new Promise((resolve) => { settleRun = resolve; });
    const decide = jest.fn(() => false);
    wireBridge({
      cookieDomains: ['amazon.com'],
      allowedHosts: ['music.amazon.com', 'gql.music.amazon.com'],
      load: jest.fn(), pageFetch: jest.fn(), fetch: jest.fn(), state: jest.fn(), clear: jest.fn(),
      signIn: jest.fn(async (_url, { decide: d }) => {
        d({ url: 'https://music.amazon.com/ap/signin', cookieNames: [], stableTicks: 0 }); // the pre-reply tick
        return run;
      })
    });
    const wrapper = mockWorld.electron.webSession.signIn('amazon-music', 'https://music.amazon.com/', { decide });
    await flush(); // the reply lands; the buffered tick flushes through decide
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide).toHaveBeenCalledWith({ url: 'https://music.amazon.com/ap/signin', cookieNames: [], stableTicks: 0 });
    settleRun({ signedIn: true });
    await expect(wrapper).resolves.toEqual({ success: true, signedIn: true });
    expect(mockIpcListeners.get('webSession:sign-in-tick')?.size || 0).toBe(0);
    expect(mockIpcListeners.get('webSession:sign-in-settled')?.size || 0).toBe(0);
  });

  test('two wrapper signIn calls join one run: both deciders tick, both promises settle', async () => {
    const flow = fakeSignInFlow();
    wireBridge({
      cookieDomains: ['amazon.com'],
      allowedHosts: ['music.amazon.com', 'gql.music.amazon.com'],
      load: jest.fn(), pageFetch: jest.fn(), fetch: jest.fn(), state: jest.fn(), clear: jest.fn(),
      signIn: flow.signIn
    });
    const seenA = [];
    const seenB = [];
    const first = mockWorld.electron.webSession.signIn('amazon-music', 'https://music.amazon.com/', {
      decide: (tick) => { seenA.push(tick); return false; }
    });
    const second = mockWorld.electron.webSession.signIn('amazon-music', 'https://music.amazon.com/', {
      decide: (tick) => { seenB.push(tick); return tick.cookieNames.includes('at-main'); }
    });
    await flush();
    expect(flow.signIn).toHaveBeenCalledTimes(1); // the host joins: one window, one ticker

    await flow.tick({ url: 'https://music.amazon.com/', cookieNames: [], stableTicks: 0 });
    expect(seenA).toHaveLength(1);
    expect(seenB).toHaveLength(1);
    await expect(flow.tick({ url: 'https://music.amazon.com/', cookieNames: [], stableTicks: 0 })).resolves.toBe(false);

    await flow.tick({ url: 'https://music.amazon.com/', cookieNames: ['at-main'], stableTicks: 1 }); // B says true
    await expect(flow.tick({ url: 'https://music.amazon.com/', cookieNames: ['at-main'], stableTicks: 2 })).resolves.toBe(true);

    flow.settle({ signedIn: true });
    await expect(first).resolves.toEqual({ success: true, signedIn: true });
    await expect(second).resolves.toEqual({ success: true, signedIn: true });
  });
});

// ── the live exposure (#1356 M5 — the bridge's first consumer) ───────────────
//
// The shipped state: the wrapper is unconditional — window.electron carries
// webSession and the hostBridges advertisement includes it, no env seam. (It
// shipped held back in the layer below — the #1432 review's note-8 option —
// and went live with the track-search move, the bridge's first caller,
// together with the session registration in main.js.)

describe('the live exposure', () => {
  test('window.electron carries webSession and the advertisement lists it', () => {
    jest.resetModules();
    jest.isolateModules(() => {
      // The mocked electron's factory writes into the SAME mockWorld object
      // across a reset — clear it so the assertions below read only this
      // run's exposure.
      Object.keys(mockWorld).forEach((k) => { delete mockWorld[k]; });
      require('../../preload');
    });
    expect(mockWorld.electron.webSession).toBeTruthy();
    // The amazonMusic block died with the teardown (#1356 M11 deleted the
    // last host flow it served — the diagnostic capture moved into the
    // plugin, which reaches the bridge like every other flow).
    expect(mockWorld.electron.amazonMusic).toBeUndefined();
    expect(mockWorld.electron.widevine).toBeTruthy();
    expect([...mockWorld.__parachordHostBridges]).toEqual(['webSession']);
  });
});
