// The plugin-mediated DRM path (#1356 M4): widevine:open-session (a manifest
// supplied renderer-side) and the licence relays it opens — against the same
// fake-ipcMain seam widevine-amazon-provider.test.js drives, then end to end
// through a mocked electron with the real preload wrapper (the
// web-session-bridge-preload harness pattern). What these pin:
//
//   - open-session runs the SAME gates a provider manifest runs (sender, the
//     shared per-resolver manifest rate window) and rotates sessions under
//     the same supersession rule;
//   - a plugin-mediated relay forwards the challenge to the renderer
//     (widevine:plugin-license — the challenge and its ids ONLY: no plugin
//     context rides the broadcast) and pairs the answer by requestId,
//     bounded by a timeout, while the 30-relay/session cap, matched-close
//     and rotation-wakes-waiters apply unchanged;
//   - a plugin relayLicense rejection carries licenseDenied/denialReason/
//     reason into the licence reply in exactly the provider path's shape;
//   - provider sessions never touch the forward (byte-identical relays).

const { registerWidevineProvider, registerWidevineBridgeIpc } = require('../../main-process/widevine-bridge');

// ── the bridge, against fake ipcMain ───────────────────────────────────────

function makeHarness() {
  const handlers = {};
  const pushes = []; // every sender.send the bridge made
  const topFrame = {};
  Object.defineProperty(topFrame, 'top', { value: topFrame });
  const mainFrameEvent = {
    sender: { id: 1, send: (channel, payload) => { pushes.push({ channel, payload }); } },
    senderFrame: topFrame
  };
  const iframeEvent = {
    sender: { id: 1, send: () => {} },
    senderFrame: { top: {}, different: true }
  };
  registerWidevineBridgeIpc({
    ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
    isAllowedSender: (event) => !!(event && event.senderFrame && event.senderFrame.top === event.senderFrame)
  });
  return { handlers, pushes, mainFrameEvent, iframeEvent };
}

const PLUGIN_MANIFEST = '<MPD the plugin fetched/>';
const flush = () => new Promise((resolve) => setImmediate(resolve));

async function openPluginSession(handlers, event, { resolverId, manifest = PLUGIN_MANIFEST }) {
  const open = await handlers['widevine:open-session'](event, { resolverId, manifestLength: manifest.length, type: 'dash', drm: 'widevine' });
  expect(open).toMatchObject({ success: true });
  expect(typeof open.sessionId).toBe('string');
  return open;
}

// One plugin-mediated relay round-trip: forward the challenge, answer it.
// Returns the reply; the forward's push stays in `pushes` for the caller.
async function relayPlugin(handlers, event, pushes, { resolverId, sessionId, license, error, expectedForwards = 1 }) {
  const before = pushes.length;
  const relayP = handlers['widevine:license'](event, { resolverId, challenge: 'Q0FRPQ==', sessionId });
  await flush(); // the forward is out
  expect(pushes).toHaveLength(before + expectedForwards);
  const push = pushes[pushes.length - 1];
  if (error) {
    await handlers['widevine:plugin-license-answer'](event, { requestId: push.payload.requestId, ok: false, error });
  } else {
    await handlers['widevine:plugin-license-answer'](event, { requestId: push.payload.requestId, ok: true, license });
  }
  return relayP;
}

describe('widevine:open-session — the plugin-mediated session open', () => {
  test('sender gate: iframes are denied like every other channel', async () => {
    const { handlers, iframeEvent } = makeHarness();
    const denied = await handlers['widevine:open-session'](iframeEvent, { resolverId: 'plug', manifestLength: PLUGIN_MANIFEST.length });
    expect(denied).toMatchObject({ success: false, reason: 'denied' });
  });

  test('an empty or missing manifest is the plugin\'s fetch having failed — playback-failed, no session minted', async () => {
    const { handlers, mainFrameEvent } = makeHarness();
    for (const manifestLength of [undefined, null, 0, -3.5, 'x', {}]) {
      const out = await handlers['widevine:open-session'](mainFrameEvent, { resolverId: 'plug', manifestLength });
      expect(out).toMatchObject({ success: false, reason: 'playback-failed' });
    }
    // No session was minted: a relay has nothing to ride (and no provider is
    // registered for a plugin-only resolver).
    const relay = await handlers['widevine:license'](mainFrameEvent, { resolverId: 'plug', challenge: 'Q0FRPQ==', sessionId: 'whatever' });
    expect(relay).toMatchObject({ success: false, reason: 'not-ready' });
  });

  test('a missing resolverId is invalid', async () => {
    const { handlers, mainFrameEvent } = makeHarness();
    const out = await handlers['widevine:open-session'](mainFrameEvent, { manifestLength: PLUGIN_MANIFEST.length });
    expect(out).toMatchObject({ success: false, reason: 'invalid' });
  });

  test('the manifest rate window is SHARED with the provider path — in both directions', async () => {
    const { handlers, mainFrameEvent } = makeHarness();
    registerWidevineProvider('shared', {
      getManifest: async () => ({ manifest: '<MPD/>' }),
      relayLicense: async () => 'LIC'
    });
    // 8 provider manifests fill the window; the 9th — an open-session — is rate-limited.
    for (let i = 0; i < 8; i++) {
      expect(await handlers['widevine:manifest'](mainFrameEvent, { resolverId: 'shared', entity: { asin: String(i) } }))
        .toMatchObject({ success: true });
    }
    expect(await handlers['widevine:open-session'](mainFrameEvent, { resolverId: 'shared', manifestLength: PLUGIN_MANIFEST.length }))
      .toMatchObject({ success: false, reason: 'rate-limited' });

    // And the other way: open-sessions fill the window for the provider path.
    // (A fresh registration — the window is init-time session state, cleared
    // with the sessions.)
    const second = makeHarness();
    for (let i = 0; i < 8; i++) {
      expect(await second.handlers['widevine:open-session'](second.mainFrameEvent, { resolverId: 'shared', manifestLength: PLUGIN_MANIFEST.length }))
        .toMatchObject({ success: true });
    }
    expect(await second.handlers['widevine:manifest'](second.mainFrameEvent, { resolverId: 'shared', entity: {} }))
      .toMatchObject({ success: false, reason: 'rate-limited' });
  });

  test('an open-session supersedes a provider session, and a provider manifest supersedes a plugin one', async () => {
    const { handlers, pushes, mainFrameEvent } = makeHarness();
    registerWidevineProvider('both', {
      getManifest: async () => ({ manifest: '<MPD/>' }),
      relayLicense: async () => 'PROVIDER-LIC'
    });
    const provider = await handlers['widevine:manifest'](mainFrameEvent, { resolverId: 'both', entity: {} });
    const plugin = await openPluginSession(handlers, mainFrameEvent, { resolverId: 'both' });
    // The provider session is rotated out: its relays fail, the plugin's relay.
    expect(await handlers['widevine:license'](mainFrameEvent, { resolverId: 'both', challenge: 'Q0FRPQ==', sessionId: provider.sessionId }))
      .toMatchObject({ success: false, reason: 'invalid' });
    expect(await relayPlugin(handlers, mainFrameEvent, pushes, { resolverId: 'both', sessionId: plugin.sessionId, license: 'UExVR0lO' }))
      .toMatchObject({ success: true, license: 'UExVR0lO' });
    // And back: a newer provider manifest rotates the plugin session out.
    const provider2 = await handlers['widevine:manifest'](mainFrameEvent, { resolverId: 'both', entity: {} });
    expect(await handlers['widevine:license'](mainFrameEvent, { resolverId: 'both', challenge: 'Q0FRPQ==', sessionId: plugin.sessionId }))
      .toMatchObject({ success: false, reason: 'invalid' });
    expect(await handlers['widevine:license'](mainFrameEvent, { resolverId: 'both', challenge: 'Q0FRPQ==', sessionId: provider2.sessionId }))
      .toMatchObject({ success: true, license: 'PROVIDER-LIC' });
  });

  test('one open-session supersedes the previous one for the same resolver', async () => {
    const { handlers, mainFrameEvent } = makeHarness();
    const first = await openPluginSession(handlers, mainFrameEvent, { resolverId: 'plug' });
    const second = await openPluginSession(handlers, mainFrameEvent, { resolverId: 'plug' });
    expect(first.sessionId).not.toBe(second.sessionId);
    expect(await handlers['widevine:license'](mainFrameEvent, { resolverId: 'plug', challenge: 'Q0FRPQ==', sessionId: first.sessionId }))
      .toMatchObject({ success: false, reason: 'invalid' });
  });
});

describe('the plugin-mediated licence relay (widevine:license → forward → answer)', () => {
  test('the forward carries only the challenge and its ids — no plugin context rides the broadcast', async () => {
    // The review's finding: widevine:plugin-license is a push any renderer
    // code (any installed plugin) can subscribe to, and the first answer
    // wins — so nothing a plugin wouldn't publish itself may ride it. The
    // plugin's context is renderer-side state (the router holds it).
    const { handlers, pushes, mainFrameEvent } = makeHarness();
    const open = await openPluginSession(handlers, mainFrameEvent, { resolverId: 'plug' });
    const relayP = handlers['widevine:license'](mainFrameEvent, { resolverId: 'plug', challenge: 'Q0FRPQ==', sessionId: open.sessionId });
    await flush();
    expect(pushes).toHaveLength(1);
    expect(pushes[0].channel).toBe('widevine:plugin-license');
    // toEqual, not toMatchObject: exactly these keys and no others.
    expect(pushes[0].payload).toEqual({
      requestId: expect.any(String),
      resolverId: 'plug',
      sessionId: open.sessionId,
      challenge: 'Q0FRPQ=='
    });
    await handlers['widevine:plugin-license-answer'](mainFrameEvent, { requestId: pushes[0].payload.requestId, ok: true, license: 'UExVR0lO' });
    expect(await relayP).toMatchObject({ success: true, license: 'UExVR0lO' });
  });

  test('a plugin relayLicense rejection carries licenseDenied/denialReason/reason into the reply shape the provider path produces', async () => {
    const { handlers, pushes, mainFrameEvent } = makeHarness();
    const open = await openPluginSession(handlers, mainFrameEvent, { resolverId: 'plug' });
    const reply = await relayPlugin(handlers, mainFrameEvent, pushes, {
      resolverId: 'plug',
      sessionId: open.sessionId,
      error: {
        message: 'Amazon refused the license for this content (CUSTOMER_NOT_ELIGIBLE): not eligible',
        reason: 'playback-failed',
        licenseDenied: false,
        denialReason: 'CUSTOMER_NOT_ELIGIBLE'
      }
    });
    expect(reply).toMatchObject({
      success: false,
      reason: 'playback-failed',
      licenseDenied: false,
      denialReason: 'CUSTOMER_NOT_ELIGIBLE'
    });
    // licenseDenied/denialReason are exactly the fields the renderer's #1262
    // family-failure latch keys on — the same assertion the provider path's
    // denial test makes over the same channel.
  });

  test('a cert-class refusal (licenseDenied) crosses the same way', async () => {
    const { handlers, pushes, mainFrameEvent } = makeHarness();
    const open = await openPluginSession(handlers, mainFrameEvent, { resolverId: 'plug' });
    const reply = await relayPlugin(handlers, mainFrameEvent, pushes, {
      resolverId: 'plug',
      sessionId: open.sessionId,
      error: { message: 'This build needs a production VMP signature', reason: 'playback-failed', licenseDenied: true }
    });
    expect(reply).toMatchObject({ success: false, licenseDenied: true, denialReason: null });
  });

  test('an answered-empty relay is the answered-empty the provider path reports', async () => {
    const { handlers, pushes, mainFrameEvent } = makeHarness();
    const open = await openPluginSession(handlers, mainFrameEvent, { resolverId: 'plug' });
    const reply = await relayPlugin(handlers, mainFrameEvent, pushes, { resolverId: 'plug', sessionId: open.sessionId, license: '' });
    expect(reply).toMatchObject({ success: false, reason: 'playback-failed' });
  });

  test('answers pair once: an unknown or repeated requestId is invalid', async () => {
    const { handlers, pushes, mainFrameEvent } = makeHarness();
    const open = await openPluginSession(handlers, mainFrameEvent, { resolverId: 'plug' });
    expect(await handlers['widevine:plugin-license-answer'](mainFrameEvent, { requestId: 'never-opened', ok: true, license: 'X' }))
      .toMatchObject({ success: false, reason: 'invalid' });
    const reply = await relayPlugin(handlers, mainFrameEvent, pushes, { resolverId: 'plug', sessionId: open.sessionId, license: 'TElDRU5TRQ==' });
    expect(reply).toMatchObject({ success: true });
    // The waiter is gone: a second answer for the settled request is invalid.
    expect(await handlers['widevine:plugin-license-answer'](mainFrameEvent, { requestId: pushes[0].payload.requestId, ok: true, license: 'TElDRU5TRQ==' }))
      .toMatchObject({ success: false, reason: 'invalid' });
  });

  test('a renderer that never answers is bounded by the timeout, never a hung invoke', async () => {
    jest.useFakeTimers();
    try {
      const { handlers, pushes, mainFrameEvent } = makeHarness();
      const open = await openPluginSession(handlers, mainFrameEvent, { resolverId: 'plug' });
      const relayP = handlers['widevine:license'](mainFrameEvent, { resolverId: 'plug', challenge: 'Q0FRPQ==', sessionId: open.sessionId });
      expect(pushes).toHaveLength(1); // the forward went out synchronously
      jest.advanceTimersByTime(31000);
      const reply = await relayP;
      expect(reply).toMatchObject({ success: false, reason: 'playback-failed', error: expect.stringContaining('timed out') });
      // The timed-out waiter is gone: a late answer finds nothing pending.
      expect(await handlers['widevine:plugin-license-answer'](mainFrameEvent, { requestId: pushes[0].payload.requestId, ok: true, license: 'late' }))
        .toMatchObject({ success: false, reason: 'invalid' });
    } finally {
      jest.useRealTimers();
    }
  });

  test('a session closed mid-relay fails its in-flight forwards fast instead of waiting out the timeout', async () => {
    const { handlers, pushes, mainFrameEvent } = makeHarness();
    const open = await openPluginSession(handlers, mainFrameEvent, { resolverId: 'plug' });
    const relayP = handlers['widevine:license'](mainFrameEvent, { resolverId: 'plug', challenge: 'Q0FRPQ==', sessionId: open.sessionId });
    await flush(); // the forward is out, unanswered
    expect(pushes).toHaveLength(1);
    // A matched 'stopped' closes the session while the forward waits: the
    // relay must settle NOW, in the same shape a plugin rejection answers
    // with — not 30s later.
    await handlers['widevine:player-event'](mainFrameEvent, { resolverId: 'plug', event: { type: 'stopped', sessionId: open.sessionId } });
    const reply = await relayP;
    expect(reply).toMatchObject({
      success: false,
      reason: 'playback-failed',
      licenseDenied: false,
      denialReason: null,
      error: expect.stringContaining('aborted')
    });
    // The woken waiter is gone: a late answer finds nothing pending.
    expect(await handlers['widevine:plugin-license-answer'](mainFrameEvent, { requestId: pushes[0].payload.requestId, ok: true, license: 'late' }))
      .toMatchObject({ success: false, reason: 'invalid' });
  });

  test('a session ROTATED mid-relay (a newer open-session, or a provider manifest) fails its in-flight forwards fast too', async () => {
    // The review's note: rotation never called closeSession, so an in-flight
    // forward for the rotated-out session used to wait out the full 30s
    // timeout. The mint wakes them — supersession is teardown for the old
    // session's forwards, same shape a rejection answers with.
    const { handlers, pushes, mainFrameEvent } = makeHarness();
    registerWidevineProvider('plug', {
      getManifest: async () => ({ manifest: '<MPD/>' }),
      relayLicense: async () => 'PROVIDER-LIC'
    });
    const first = await openPluginSession(handlers, mainFrameEvent, { resolverId: 'plug' });
    const relayP = handlers['widevine:license'](mainFrameEvent, { resolverId: 'plug', challenge: 'Q0FRPQ==', sessionId: first.sessionId });
    await flush(); // the forward is out, unanswered
    expect(pushes).toHaveLength(1);
    await openPluginSession(handlers, mainFrameEvent, { resolverId: 'plug' });
    await expect(relayP).resolves.toMatchObject({
      success: false,
      reason: 'playback-failed',
      licenseDenied: false,
      denialReason: null,
      error: expect.stringContaining('aborted')
    });
    // The woken waiter is gone: a late answer finds nothing pending.
    expect(await handlers['widevine:plugin-license-answer'](mainFrameEvent, { requestId: pushes[0].payload.requestId, ok: true, license: 'late' }))
      .toMatchObject({ success: false, reason: 'invalid' });
    // And a PROVIDER manifest rotating a plugin session wakes the same way.
    const second = await openPluginSession(handlers, mainFrameEvent, { resolverId: 'plug' });
    const relay2P = handlers['widevine:license'](mainFrameEvent, { resolverId: 'plug', challenge: 'Q0FRPQ==', sessionId: second.sessionId });
    await flush();
    expect(pushes).toHaveLength(2);
    await handlers['widevine:manifest'](mainFrameEvent, { resolverId: 'plug', entity: {} });
    await expect(relay2P).resolves.toMatchObject({
      success: false,
      reason: 'playback-failed',
      error: expect.stringContaining('aborted')
    });
    // The newest session (the provider one) relays to the provider untouched.
    const provider = await handlers['widevine:manifest'](mainFrameEvent, { resolverId: 'plug', entity: {} });
    expect(await handlers['widevine:license'](mainFrameEvent, { resolverId: 'plug', challenge: 'Q0FRPQ==', sessionId: provider.sessionId }))
      .toMatchObject({ success: true, license: 'PROVIDER-LIC' });
  });

  test('the session/cap gates apply unchanged: 30 relays per plugin session, matched close on stopped', async () => {
    const { handlers, pushes, mainFrameEvent } = makeHarness();
    const open = await openPluginSession(handlers, mainFrameEvent, { resolverId: 'plug' });
    for (let i = 0; i < 30; i++) {
      const reply = await relayPlugin(handlers, mainFrameEvent, pushes, { resolverId: 'plug', sessionId: open.sessionId, license: 'TElDRU5TRQ==' });
      expect(reply).toMatchObject({ success: true });
    }
    const capped = await handlers['widevine:license'](mainFrameEvent, { resolverId: 'plug', challenge: 'Q0FRPQ==', sessionId: open.sessionId });
    expect(capped).toMatchObject({ success: false, reason: 'invalid', error: expect.stringContaining('cap') });

    // A new session relays again; a matched 'stopped' closes it.
    const second = await openPluginSession(handlers, mainFrameEvent, { resolverId: 'plug' });
    await handlers['widevine:player-event'](mainFrameEvent, { resolverId: 'plug', event: { type: 'stopped', sessionId: second.sessionId } });
    expect(await handlers['widevine:license'](mainFrameEvent, { resolverId: 'plug', challenge: 'Q0FRPQ==', sessionId: second.sessionId }))
      .toMatchObject({ success: false, reason: 'invalid' });
  });

  test('no live session or a stale sessionId: no forward at all (the oracle stays closed)', async () => {
    const { handlers, pushes, mainFrameEvent } = makeHarness();
    await openPluginSession(handlers, mainFrameEvent, { resolverId: 'plug' });
    expect(await handlers['widevine:license'](mainFrameEvent, { resolverId: 'plug', challenge: 'Q0FRPQ==', sessionId: 'stale' }))
      .toMatchObject({ success: false, reason: 'invalid' });
    expect(pushes).toHaveLength(0);
  });

  test('a bad challenge is refused before any forward', async () => {
    const { handlers, pushes, mainFrameEvent } = makeHarness();
    const open = await openPluginSession(handlers, mainFrameEvent, { resolverId: 'plug' });
    expect(await handlers['widevine:license'](mainFrameEvent, { resolverId: 'plug', sessionId: open.sessionId }))
      .toMatchObject({ success: false, reason: 'invalid' });
    expect(pushes).toHaveLength(0);
  });

  test('a plugin session needs no provider registered — and a provider session never touches the forward', async () => {
    const { handlers, pushes, mainFrameEvent } = makeHarness();
    registerWidevineProvider('mixed', {
      getManifest: async () => ({ manifest: '<MPD/>' }),
      relayLicense: async (challenge) => 'PROVIDER-' + challenge.slice(0, 4)
    });
    // The provider path: byte-identical — the provider relays, nothing is pushed.
    const provider = await handlers['widevine:manifest'](mainFrameEvent, { resolverId: 'mixed', entity: {} });
    expect(await handlers['widevine:license'](mainFrameEvent, { resolverId: 'mixed', challenge: 'Q0FRPQ==', sessionId: provider.sessionId }))
      .toMatchObject({ success: true, license: 'PROVIDER-Q0FR' });
    expect(pushes).toHaveLength(0);
    // The plugin session on the same resolver (the newest session wins) forwards.
    const plugin = await openPluginSession(handlers, mainFrameEvent, { resolverId: 'mixed' });
    expect(await relayPlugin(handlers, mainFrameEvent, pushes, { resolverId: 'mixed', sessionId: plugin.sessionId, license: 'UExVR0lO' }))
      .toMatchObject({ success: true, license: 'UExVR0lO' });
  });
});

// ── the preload wrapper against the bridge, end to end ────────────────────
//
// Same harness as web-session-bridge-preload.test.js: a mocked electron
// captures what the preload exposes, the bridge's handlers answer the
// invokes, and the bridge's sender.send drives the preload's listener. This
// pins the renderer half as it will actually run: onPluginLicenseRequest
// runs the plugin's relayLicense per forwarded challenge and answers with
// the licence or the thrown fields.

const mockWorld = {};
const mockIpcListeners = new Map();
let mockHandlers = {};
let mockSenderSend = null;

jest.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (name, value) => { mockWorld[name] = value; }
  },
  ipcRenderer: {
    invoke: (channel, payload) => {
      const handler = mockHandlers[channel];
      if (!handler) return Promise.resolve({ success: false, reason: 'not-ready', error: `no handler for ${channel}` });
      return handler({ sender: { id: 1, send: (c, p) => { if (mockSenderSend) mockSenderSend(c, p); } } }, payload);
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

require('../../preload');

describe('the preload wrapper against the bridge (plugin-mediated relay, end to end)', () => {
  beforeEach(() => {
    mockIpcListeners.clear();
    mockHandlers = {};
    mockSenderSend = null;
    registerWidevineBridgeIpc({
      ipcMain: { handle: (name, fn) => { mockHandlers[name] = fn; } },
      // The fake invoke events carry no senderFrame, so the gate keys on the
      // sender every invoke above provides — the real predicate is pinned by
      // the bridge-level describes above.
      isAllowedSender: (event) => !!(event && event.sender)
    });
    // The bridge's forward pushes to event.sender.send; this routes that push
    // to whatever the preload subscribed — the real renderer's ipc bus.
    mockSenderSend = (channel, payload) => {
      for (const listener of mockIpcListeners.get(channel) || []) listener({}, payload);
    };
  });

  test('window.electron.widevine exposes openSession + onPluginLicenseRequest', () => {
    expect(typeof mockWorld.electron.widevine.openSession).toBe('function');
    expect(typeof mockWorld.electron.widevine.onPluginLicenseRequest).toBe('function');
  });

  test('a relay round-trips: challenge → plugin relayLicense(challenge) → licence, through the real wrapper', async () => {
    const relayCalls = [];
    const unsubscribe = mockWorld.electron.widevine.onPluginLicenseRequest(async (request) => {
      relayCalls.push([request.challenge, request.context]);
      return 'TElDRU5TRQ==';
    });
    const open = await mockWorld.electron.widevine.openSession('plugsvc', 4096, 'dash', 'widevine');
    expect(open).toMatchObject({ success: true });
    const reply = await mockWorld.electron.widevine.relayLicense('plugsvc', 'Q0FRPQ==', open.sessionId);
    expect(reply).toMatchObject({ success: true, license: 'TElDRU5TRQ==' });
    // The plugin saw only its challenge — no context rode the push. Its
    // context is its own renderer-side state; the host's router hands it
    // back, and nothing crosses IPC.
    expect(relayCalls).toEqual([['Q0FRPQ==', undefined]]);
    unsubscribe();
  });

  test('a thrown plugin error answers with its fields in the licence reply\'s error shape', async () => {
    const unsubscribe = mockWorld.electron.widevine.onPluginLicenseRequest(async () => {
      const err = new Error('Amazon refused the license for this content (CUSTOMER_NOT_ELIGIBLE): not eligible');
      err.reason = 'playback-failed';
      err.licenseDenied = false;
      err.denialReason = 'CUSTOMER_NOT_ELIGIBLE';
      throw err;
    });
    const open = await mockWorld.electron.widevine.openSession('plugsvc', 4096, 'dash', 'widevine');
    const reply = await mockWorld.electron.widevine.relayLicense('plugsvc', 'Q0FRPQ==', open.sessionId);
    expect(reply).toMatchObject({
      success: false,
      reason: 'playback-failed',
      licenseDenied: false,
      denialReason: 'CUSTOMER_NOT_ELIGIBLE'
    });
    unsubscribe();
  });

  test('a non-Error throw (a string) still answers, as a plain playback-failed', async () => {
    const unsubscribe = mockWorld.electron.widevine.onPluginLicenseRequest(async () => {
      throw 'plugin bug'; // not an Error — pin what the wrapper does with one
    });
    const open = await mockWorld.electron.widevine.openSession('plugsvc', 4096, 'dash', 'widevine');
    const reply = await mockWorld.electron.widevine.relayLicense('plugsvc', 'Q0FRPQ==', open.sessionId);
    // The wrapper answers with the string itself as the message and no
    // reason field, so main maps it to a plain playback-failed.
    expect(reply).toMatchObject({ success: false, reason: 'playback-failed', error: 'plugin bug' });
    unsubscribe();
  });

  test('the licence relay subscription is single-owner: a second call does not replace the first handler', async () => {
    // #1434 review: main takes the FIRST answer for a requestId, so a second
    // subscriber could race its own bytes ahead of the router's answer and
    // decide the play. The first registration owns the relay; later calls
    // get a warning and null instead of an unsubscribe, so they can tell they
    // were refused, and nothing they do can unregister the owner.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const seenBy = [];
    const unsubscribeFirst = mockWorld.electron.widevine.onPluginLicenseRequest(async (request) => {
      seenBy.push(['first', request.challenge]);
      return 'RklSU1Q=';
    });
    const unsubscribeSecond = mockWorld.electron.widevine.onPluginLicenseRequest(async () => {
      seenBy.push(['second']);
      return 'U0VDT05E';
    });
    expect(warn).toHaveBeenCalledTimes(1);
    // A refused registration answers null, so the caller can tell (the
    // player's router fails its play with a message that says why).
    expect(unsubscribeSecond).toBeNull();
    const open = await mockWorld.electron.widevine.openSession('plugsvc', 4096, 'dash', 'widevine');
    const reply = await mockWorld.electron.widevine.relayLicense('plugsvc', 'Q0FRPQ==', open.sessionId);
    expect(reply).toMatchObject({ success: true, license: 'RklSU1Q=' });
    expect(seenBy).toEqual([['first', 'Q0FRPQ==']]); // the second callback never ran
    warn.mockRestore();

    // Ownership releases when the owner unsubscribes: a later call registers
    // (the router is bound once per page today, but the release is the
    // honest single-owner rule, not a forever-latch).
    unsubscribeFirst();
    const unsubscribeThird = mockWorld.electron.widevine.onPluginLicenseRequest(async () => 'VEhJUkQ=');
    const open2 = await mockWorld.electron.widevine.openSession('plugsvc', 4096, 'dash', 'widevine');
    const reply2 = await mockWorld.electron.widevine.relayLicense('plugsvc', 'Q0FRPQ==', open2.sessionId);
    expect(reply2).toMatchObject({ success: true, license: 'VEhJUkQ=' });
    unsubscribeThird();
  });
});
