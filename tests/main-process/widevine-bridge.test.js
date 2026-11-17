// The widevine bridge's PROVIDER path (main-process/widevine-bridge.js):
// registration, the IPC error contract, relay gating (sender, session, cap)
// and session ordering. These describes lived in
// widevine-amazon-provider.test.js until #1356 M9 moved Amazon's DRM pair
// into the plugin (its provider pins now drive the plugin in
// tests/resolver/amazon-music-plugin-drm.test.js; the plugin-mediated
// session's pins live in widevine-plugin-relay.test.js) — the provider path
// itself stays live for any future main-side provider.

const { registerWidevineProvider, registerWidevineBridgeIpc } = require('../../main-process/widevine-bridge');

const topFrame = {};
Object.defineProperty(topFrame, 'top', { value: topFrame });
const mainFrameEvent = { sender: { id: 1 }, senderFrame: topFrame };
const iframeEvent = { sender: { id: 1 }, senderFrame: { top: {}, different: true } };

describe('widevine bridge IPC (the provider path)', () => {
  test('unregistered resolver fails honestly; a registered provider round-trips', async () => {
    const handlers = {};
    const ipcMain = { handle: (name, fn) => { handlers[name] = fn; } };
    registerWidevineBridgeIpc({ ipcMain });

    const missing = await handlers['widevine:manifest'](null, { resolverId: 'nope', entity: {} });
    expect(missing).toMatchObject({ success: false, reason: 'not-ready' });

    registerWidevineProvider('mock', {
      getManifest: async (entity) => ({ manifest: '<MPD/>', note: entity.asin }),
      relayLicense: async (challenge) => (challenge === 'Q0FRPQ==' ? 'TElD' : 'BAD')
    });
    const manifest = await handlers['widevine:manifest'](null, { resolverId: 'mock', entity: { asin: 'B1' } });
    expect(manifest).toMatchObject({ success: true, manifest: '<MPD/>', note: 'B1' });
    expect(typeof manifest.sessionId).toBe('string');
    const license = await handlers['widevine:license'](null, { resolverId: 'mock', challenge: 'Q0FRPQ==', sessionId: manifest.sessionId });
    expect(license).toMatchObject({ success: true, license: 'TElD' });
    const bad = await handlers['widevine:license'](null, { resolverId: 'mock' });
    expect(bad).toMatchObject({ success: false, reason: 'invalid' });
  });

  test('the provider must implement both halves', () => {
    expect(() => registerWidevineProvider('half', { getManifest: async () => ({ manifest: '<MPD/>' }) }))
      .toThrow(/must implement getManifest \+ relayLicense/);
  });
});

describe('widevine bridge relay gating', () => {
  let handlers;
  const ipcMain = { handle: (name, fn) => { handlers[name] = fn; } };

  const provider = {
    getManifest: async () => ({ manifest: '<MPD/>' }),
    relayLicense: async (challenge) => 'LIC-' + challenge.slice(0, 6)
  };

  const isAllowedSender = (event) => event.senderFrame && event.senderFrame.top === event.senderFrame;

  beforeEach(() => {
    handlers = {};
    registerWidevineProvider('mock', provider);
    registerWidevineBridgeIpc({ ipcMain, isAllowedSender });
  });

  test('sender gate: iframes are denied on all channels', async () => {
    const manifest = await handlers['widevine:manifest'](iframeEvent, { resolverId: 'mock', entity: {} });
    expect(manifest).toMatchObject({ success: false, reason: 'denied' });
    const license = await handlers['widevine:license'](iframeEvent, { resolverId: 'mock', challenge: 'CAQ=', sessionId: 'x' });
    expect(license).toMatchObject({ success: false, reason: 'denied' });
  });

  test('manifest opens a session; license only relays inside it', async () => {
    const manifest = await handlers['widevine:manifest'](mainFrameEvent, { resolverId: 'mock', entity: {} });
    expect(manifest.success).toBe(true);
    expect(typeof manifest.sessionId).toBe('string');
    const license = await handlers['widevine:license'](mainFrameEvent, { resolverId: 'mock', challenge: 'CAQ=', sessionId: manifest.sessionId });
    expect(license).toMatchObject({ success: true, license: expect.stringContaining('LIC') });
  });

  test('no session → invalid (the oracle is closed without a live play)', async () => {
    const license = await handlers['widevine:license'](mainFrameEvent, { resolverId: 'mock', challenge: 'CAQ=', sessionId: 'never-opened' });
    expect(license).toMatchObject({ success: false, reason: 'invalid' });
  });

  test('a new manifest rotates the session — the stale play\'s relays fail', async () => {
    const first = await handlers['widevine:manifest'](mainFrameEvent, { resolverId: 'mock', entity: {} });
    const second = await handlers['widevine:manifest'](mainFrameEvent, { resolverId: 'mock', entity: {} });
    expect(first.sessionId).not.toBe(second.sessionId);
    expect(await handlers['widevine:license'](mainFrameEvent, { resolverId: 'mock', challenge: 'CAQ=', sessionId: first.sessionId }))
      .toMatchObject({ success: false, reason: 'invalid' });
    expect(await handlers['widevine:license'](mainFrameEvent, { resolverId: 'mock', challenge: 'CAQ=', sessionId: second.sessionId }))
      .toMatchObject({ success: true });
  });

  test('stop/end closes the session', async () => {
    const manifest = await handlers['widevine:manifest'](mainFrameEvent, { resolverId: 'mock', entity: {} });
    await handlers['widevine:player-event'](mainFrameEvent, { resolverId: 'mock', event: { type: 'stopped' } });
    expect(await handlers['widevine:license'](mainFrameEvent, { resolverId: 'mock', challenge: 'CAQ=', sessionId: manifest.sessionId }))
      .toMatchObject({ success: false, reason: 'invalid' });
  });

  test('relays per session are capped', async () => {
    const manifest = await handlers['widevine:manifest'](mainFrameEvent, { resolverId: 'mock', entity: {} });
    for (let i = 0; i < 30; i++) {
      const r = await handlers['widevine:license'](mainFrameEvent, { resolverId: 'mock', challenge: 'QnA=', sessionId: manifest.sessionId });
      expect(r.success).toBe(true);
    }
    const cap = await handlers['widevine:license'](mainFrameEvent, { resolverId: 'mock', challenge: 'QnE=', sessionId: manifest.sessionId });
    expect(cap).toMatchObject({ success: false, reason: 'invalid', error: expect.stringContaining('cap') });
  });

  test('the bridge relays the denialReason through the license reply', async () => {
    registerWidevineProvider('relay-denial', {
      getManifest: async () => ({ manifest: '<MPD/>' }),
      relayLicense: async () => {
        const e = new Error('Amazon refused the license for this content (CUSTOMER_NOT_ELIGIBLE): not eligible');
        e.reason = 'playback-failed'; e.licenseDenied = false; e.denialReason = 'CUSTOMER_NOT_ELIGIBLE';
        throw e;
      }
    });
    const manifest = await handlers['widevine:manifest'](mainFrameEvent, { resolverId: 'relay-denial', entity: {} });
    const reply = await handlers['widevine:license'](mainFrameEvent, { resolverId: 'relay-denial', challenge: 'CAQ=', sessionId: manifest.sessionId });
    expect(reply.success).toBe(false);
    expect(reply.licenseDenied).toBe(false);
    expect(reply.denialReason).toBe('CUSTOMER_NOT_ELIGIBLE');
  });
});

describe('widevine bridge session ORDERING (review round 2)', () => {
  let handlers;
  const ipcMain = { handle: (name, fn) => { handlers[name] = fn; } };
  const isAllowedSender = (event) => event.senderFrame && event.senderFrame.top === event.senderFrame;

  beforeEach(() => {
    handlers = {};
    registerWidevineBridgeIpc({ ipcMain, isAllowedSender });
  });

  test('a late-resolving manifest cannot rotate over the newer request', async () => {
    const resolvers = [];
    registerWidevineProvider('mock-order', {
      getManifest: () => new Promise((res) => resolvers.push(() => res({ manifest: '<MPD/>' }))),
      relayLicense: async () => 'LIC'
    });
    const oldP = handlers['widevine:manifest'](mainFrameEvent, { resolverId: 'mock-order', entity: { asin: 'OLD' } });
    const newP = handlers['widevine:manifest'](mainFrameEvent, { resolverId: 'mock-order', entity: { asin: 'NEW' } });
    await new Promise((r) => setImmediate(r));
    expect(resolvers).toHaveLength(2);
    resolvers[1](); // NEW resolves first
    const newer = await newP;
    expect(newer.success).toBe(true);
    resolvers[0](); // then OLD resolves late
    const older = await oldP;
    expect(older).toMatchObject({ success: false, reason: 'superseded' });
    const relay = await handlers['widevine:license'](mainFrameEvent, { resolverId: 'mock-order', challenge: 'CAQ=', sessionId: newer.sessionId });
    expect(relay).toMatchObject({ success: true });
  });

  test('a stopped/ended event closes ONLY the matching session', async () => {
    registerWidevineProvider('mock-close', {
      getManifest: async () => ({ manifest: '<MPD/>' }),
      relayLicense: async () => 'LIC'
    });
    const first = await handlers['widevine:manifest'](mainFrameEvent, { resolverId: 'mock-close', entity: {} });
    const second = await handlers['widevine:manifest'](mainFrameEvent, { resolverId: 'mock-close', entity: {} });
    await handlers['widevine:player-event'](mainFrameEvent, { resolverId: 'mock-close', event: { type: 'stopped', sessionId: first.sessionId } });
    const relay = await handlers['widevine:license'](mainFrameEvent, { resolverId: 'mock-close', challenge: 'CAQ=', sessionId: second.sessionId });
    expect(relay).toMatchObject({ success: true });
    await handlers['widevine:player-event'](mainFrameEvent, { resolverId: 'mock-close', event: { type: 'stopped', sessionId: second.sessionId } });
    const afterClose = await handlers['widevine:license'](mainFrameEvent, { resolverId: 'mock-close', challenge: 'CAQ=', sessionId: second.sessionId });
    expect(afterClose).toMatchObject({ success: false, reason: 'invalid' });
  });

  test('manifests are rate-limited per resolver', async () => {
    registerWidevineProvider('mock-rate', {
      getManifest: async () => ({ manifest: '<MPD/>' }),
      relayLicense: async () => 'LIC'
    });
    for (let i = 0; i < 8; i++) {
      const r = await handlers['widevine:manifest'](mainFrameEvent, { resolverId: 'mock-rate', entity: { asin: String(i) } });
      expect(r.success).toBe(true);
    }
    const ninth = await handlers['widevine:manifest'](mainFrameEvent, { resolverId: 'mock-rate', entity: {} });
    expect(ninth).toMatchObject({ success: false, reason: 'rate-limited' });
  });
});
