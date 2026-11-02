// The Amazon dmls provider + the widevine bridge: session-context minting,
// manifest/license plumbing, and the IPC error contract — all against mocks.
// These tests would have caught the unregistered-provider call and the
// response-line syntax break that manual runs found.

const path = require('path');

// electron: net.request + session.fromPartition + app.getVersion
const requestHandlers = [];
const mockCookies = [
  { name: 'at-main', value: 'AT' },
  { name: 'session-id', value: 'SID' },
  { name: 'ubid-main', value: 'UB' }
];
const mockRequests = [];
jest.mock('electron', () => ({
  app: { getVersion: () => '9.9.9-test' },
  net: {
    request: (opts) => {
      const headers = {};
      const req = {
        setHeader: (k, v) => { headers[k] = v; },
        on: (event, cb) => { (req._handlers = req._handlers || {})[event] = cb; return req; },
        end: (body) => {
          req._body = body;
          const handler = requestHandlers.shift() || (() => ({ status: 500, text: 'no mock' }));
          const { status, text } = handler({ url: opts.url, headers, body });
          const res = { statusCode: status, on: (ev, cb) => { if (ev === 'data') setImmediate(() => cb(Buffer.from(text))); if (ev === 'end') setImmediate(() => cb()); return res; } };
          req._handlers.response(res);
        }
      };
      mockRequests.push({ opts, headers, getBody: () => req._body });
      return req;
    }
  },
  session: {
    fromPartition: () => ({
      cookies: { get: async () => mockCookies.slice() }
    })
  }
}));

// amazon-web-player: search host (sign-in predicate + header mint)
jest.mock('../../amazon-web-player', () => ({
  isSignedIn: jest.fn().mockResolvedValue(true),
  mintSessionHeaders: jest.fn().mockResolvedValue({
    csrfToken: 'tok-0123456789abcdef0123456789abcdef=',
    csrfRnd: '403697901',
    csrfTs: '1793304003',
    deviceId: '135'
  })
}));

const amazonWebPlayer = require('../../amazon-web-player');
const { amazonDmls, registerAmazonDmlsProvider } = require('../../amazon-dmls');
const { registerWidevineProvider, registerWidevineBridgeIpc } = require('../../main-process/widevine-bridge');

const CONFIG_JSON = JSON.stringify({
  customerId: 'CUST1',
  marketplaceId: 'MKT',
  musicTerritory: 'US',
  siteRegion: 'NA',
  deviceId: '14354613042605242',
  tier: { name: 'UNLIMITED_HD' }
});

const CONFIG_NO_TERRITORY = JSON.stringify({ customerId: 'CUST1', marketplaceId: 'MKT', siteRegion: 'NA', deviceId: '1435' });

function queueManifest({ status = 200, entry } = {}) {
  const body = JSON.stringify({ contentResponseList: [entry || {
    contentResponseStatusCode: 'SUCCESS',
    manifest: '<MPD minBufferTime="PT2S"/>',
    substituteAsin: 'SUB1',
    musicDashVersion: 'SIREN_KATANA'
  }] });
  requestHandlers.push(() => ({ status, text: body }));
}

beforeEach(() => {
  amazonDmls.sessionContext = null;
  amazonDmls.sessionContextPromise = null;
  amazonDmls.certSessionReady = false;
  amazonWebPlayer.isSignedIn.mockResolvedValue(true);
  amazonWebPlayer.mintSessionHeaders.mockClear();
  requestHandlers.length = 0;
  mockRequests.length = 0;
  amazonDmls.init({ store: { get: () => undefined, set: () => {} } });
});

describe('L9: telemetry bookkeeping survives a synchronous net.request throw', () => {
  test('net.request throwing resolves as status -1 and increments the dropped counter', async () => {
    const electron = jest.requireMock('electron');
    const orig = electron.net.request;
    // Prewarm the session context FIRST (its config.json fetch precedes the
    // guarded POST executor — flipping to throw first would fail there).
    requestHandlers.push(() => ({ status: 200, text: CONFIG_JSON }));
    await amazonDmls.ensureSessionContext();
    electron.net.request = () => { throw new Error('session is destroyed'); };
    try {
      const before = amazonDmls.telemetryHealth.dropped;
      const out = await amazonDmls.postTelemetryEvent({ clientActionList: [{ actionName: 'streamingTerminated' }] });
      expect(out.status).toBe(-1);
      expect(amazonDmls.telemetryHealth.dropped).toBe(before + 1);
      expect(amazonDmls.telemetryHealth.last.status).toBe(-1);
    } finally {
      electron.net.request = orig;
    }
  });
});

describe('amazon-dmls session context', () => {
  test('mints from config.json + the header capture, prefers config deviceId', async () => {
    requestHandlers.push(() => ({ status: 200, text: CONFIG_JSON })); // config.json
    const ctx = await amazonDmls.ensureSessionContext();
    expect(ctx.customerId).toBe('CUST1');
    expect(ctx.territoryId).toBe('US');
    expect(ctx.region).toBe('NA');
    expect(ctx.deviceId).toBe('14354613042605242'); // config.json first
    expect(ctx.csrfToken).toBe('tok-0123456789abcdef0123456789abcdef=');
    expect(ctx.tier).toBe('UNLIMITED_HD');
  });

  test('config.json deviceId wins over the captured header placeholder', async () => {
    amazonWebPlayer.mintSessionHeaders.mockResolvedValueOnce({ csrfToken: 'tok-0123456789abcdef0123456789abcdef=', csrfRnd: '1', csrfTs: '2', deviceId: 'foo' });
    requestHandlers.push(() => ({ status: 200, text: CONFIG_JSON }));
    const ctx = await amazonDmls.ensureSessionContext();
    expect(ctx.deviceId).toBe('14354613042605242');
  });

  test('not signed in (no at-main cookie) fails with not-signed-in', async () => {
    mockCookies.length = 0;
    mockCookies.push({ name: 'session-id', value: 'x' });
    await expect(amazonDmls.ensureSessionContext()).rejects.toMatchObject({ reason: 'not-signed-in' });
    mockCookies.unshift({ name: 'at-main', value: 'AT' });
  });
});

describe('amazon-dmls getManifest', () => {
  test('posts the manifest body with cookies + csrf and returns the inline MPD', async () => {
    requestHandlers.push(() => ({ status: 200, text: CONFIG_JSON }));
    queueManifest({});
    const result = await amazonDmls.getManifest({ asin: 'B00CRMX53S' });
    const dmlsReq = mockRequests.find((r) => r.opts.url.includes('/api/dmls/'));
    const headers = dmlsReq.headers;
    expect(headers['X-Amz-Target']).toContain('getDashManifestsV2');
    expect(headers['csrf-token']).toBe('tok-0123456789abcdef0123456789abcdef=');
    expect(headers['Cookie']).toContain('at-main=AT');
    expect(headers['Content-Encoding']).toBe('amz-1.0');
    const body = JSON.parse(dmlsReq.getBody());
    expect(body.contentIdList).toEqual([{ identifier: 'B00CRMX53S', identifierType: 'ASIN' }]);
    expect(body.customerId).toBe('CUST1');
    expect(body.deviceToken).toEqual({ deviceTypeId: 'A16ZV8BU3SN1N3', deviceId: '14354613042605242' });
    expect(body.appInfo.musicAgent).toMatch(/^Vinyl\/2\.0 GreenHornet_Web\//);
    expect(result.manifest).toContain('<MPD');
    expect(result.substituteAsin).toBe('SUB1');
  });

  test('not-signed-in without a request', async () => {
    amazonWebPlayer.isSignedIn.mockResolvedValue(false);
    await expect(amazonDmls.getManifest({ asin: 'B1' })).rejects.toMatchObject({ reason: 'not-signed-in' });
    expect(mockRequests.find((r) => r.opts.url.includes('/api/dmls/'))).toBeUndefined();
  });

  test('manifest HTTP error maps to playback-failed', async () => {
    requestHandlers.push(() => ({ status: 200, text: CONFIG_JSON }));
    requestHandlers.push(() => ({ status: 500, text: 'boom' }));
    await expect(amazonDmls.getManifest({ asin: 'B1' })).rejects.toMatchObject({ reason: 'playback-failed' });
  });

  test('a non-SUCCESS entry maps to playback-failed', async () => {
    requestHandlers.push(() => ({ status: 200, text: CONFIG_JSON }));
    queueManifest({ entry: { contentResponseStatusCode: 'CONTENT_NOT_FOUND', contentResponseStatusMessage: 'nf' } });
    await expect(amazonDmls.getManifest({ asin: 'B1' })).rejects.toMatchObject({ reason: 'playback-failed' });
  });

  test('session rot: 400 Unauthorized refreshes the context and retries once', async () => {
    requestHandlers.push(() => ({ status: 200, text: CONFIG_JSON })); // first config
    requestHandlers.push(() => ({ status: 400, text: '{"__type":"com.amazon.digitalmusiclocator#UnauthorizedException","message":"Request authentication failure : REQUIRED_COOKIES_MISSING"}' }));
    requestHandlers.push(() => ({ status: 200, text: CONFIG_NO_TERRITORY })); // refresher config
    queueManifest({});
    const result = await amazonDmls.getManifest({ asin: 'B1' });
    expect(result.manifest).toBeDefined();
    const dmlsCalls = mockRequests.filter((r) => r.opts.url.includes('/api/dmls/')).length;
    expect(dmlsCalls).toBe(2);
  });
});

describe('amazon-dmls relayLicense', () => {
  test('returns the license field, targets getLicenseForPlaybackV2', async () => {
    requestHandlers.push(() => ({ status: 200, text: CONFIG_JSON }));
    requestHandlers.push(() => ({ status: 200, text: '{"license":"TElDRU5TRQ=="}' }));
    const license = await amazonDmls.relayLicense('Y2hhbGxlbmdl');
    expect(license).toBe('TElDRU5TRQ==');
    const req = mockRequests.find((r) => r.opts.url.includes('/api/dmls/'));
    const body = JSON.parse(req.getBody());
    expect(body.DrmType).toBe('WIDEVINE');
    expect(body.licenseChallenge).toBe('Y2hhbGxlbmdl');
  });

  test('400 with an opaque/non-JSON body is a generic refusal, NOT claimed as the cert class', async () => {
    requestHandlers.push(() => ({ status: 200, text: CONFIG_JSON }));
    requestHandlers.push(() => ({ status: 400, text: 'denied' }));
    let err = null;
    try { await amazonDmls.relayLicense('CAQ='); } catch (e) { err = e; }
    expect(err.licenseDenied).toBe(false);
    expect(err.denialReason).toBeNull();
    expect(err.message).not.toContain('VMP');
  });

  test('400 denialReason=CUSTOMER_NOT_ELIGIBLE is a per-content refusal, NOT a build problem (Prime HD capture)', async () => {
    requestHandlers.push(() => ({ status: 200, text: CONFIG_JSON }));
    requestHandlers.push(() => ({
      status: 400,
      text: JSON.stringify({
        __type: 'com.amazon.digitalmusicdrmlicenseservice#ForbiddenException',
        denialReason: 'CUSTOMER_NOT_ELIGIBLE',
        message: 'customer is not eligible for HD content (EligibilityException CUSTOMER_NOT_ELIGIBLE)'
      })
    }));
    let err = null;
    try { await amazonDmls.relayLicense('CAQ='); } catch (e) { err = e; }
    expect(err.licenseDenied).toBe(false);
    expect(err.denialReason).toBe('CUSTOMER_NOT_ELIGIBLE');
    expect(err.message).toContain('not eligible for HD content');
    expect(err.message).not.toContain('VMP');
    // The plan-level HD block gets recorded for the session.
    expect(amazonDmls.hdSessionBlockedByPlan).toBe(true);
    expect(amazonDmls.debugState().hdSessionBlockedByPlan).toBe(true);
  });

  test('400 denialReason=UNTRUSTED_DEVICE_CERTIFICATE stays licenseDenied (build VMP problem)', async () => {
    amazonDmls.hdSessionBlockedByPlan = false; // reset plan-level flag for the assertion below
    requestHandlers.push(() => ({ status: 200, text: CONFIG_JSON }));
    requestHandlers.push(() => ({
      status: 400,
      text: JSON.stringify({ denialReason: 'UNTRUSTED_DEVICE_CERTIFICATE', message: 'device cert rejected' })
    }));
    await expect(amazonDmls.relayLicense('CAQ=')).rejects.toMatchObject({
      licenseDenied: true,
      message: expect.stringContaining('VMP')
    });
    expect(amazonDmls.hdSessionBlockedByPlan).toBe(false);
  });

  test('non-200 without license field is an error', async () => {
    requestHandlers.push(() => ({ status: 200, text: CONFIG_JSON }));
    requestHandlers.push(() => ({ status: 200, text: '{"notLicense":"x"}' }));
    await expect(amazonDmls.relayLicense('CAQ=')).rejects.toBeTruthy();
  });
});

describe('widevine bridge IPC', () => {
  test('unregistered resolver fails honestly; registered provider round-trips', async () => {
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

  test('registerAmazonDmlsProvider registers the amazon provider', () => {
    const registered = {};
    registerAmazonDmlsProvider({ registerWidevineProvider: (id, p) => { registered[id] = p; }, store: { get: () => undefined, set: () => {} } });
    expect(registered.amazonmusic).toBeDefined();
    expect(typeof registered.amazonmusic.getManifest).toBe('function');
    expect(typeof registered.amazonmusic.relayLicense).toBe('function');
  });
});

describe('widevine bridge relay gating', () => {
  test('bridge relays the denialReason through the license reply', async () => {
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


  let handlers;
  const ipcMain = { handle: (name, fn) => { handlers[name] = fn; } };

  const provider = {
    getManifest: async () => ({ manifest: '<MPD/>' }),
    relayLicense: async (challenge) => 'LIC-' + challenge.slice(0, 6)
  };

  const topFrame = {};
  Object.defineProperty(topFrame, 'top', { value: topFrame });
  const mainFrameEvent = { sender: { id: 1 }, senderFrame: topFrame };
  const iframeEvent = { sender: { id: 1 }, senderFrame: { top: {}, different: true } };
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
      // eslint-disable-next-line no-await-in-loop
      const r = await handlers['widevine:license'](mainFrameEvent, { resolverId: 'mock', challenge: 'QnA=', sessionId: manifest.sessionId });
      expect(r.success).toBe(true);
    }
    const cap = await handlers['widevine:license'](mainFrameEvent, { resolverId: 'mock', challenge: 'QnE=', sessionId: manifest.sessionId });
    expect(cap).toMatchObject({ success: false, reason: 'invalid', error: expect.stringContaining('cap') });
  });
});

describe('widevine bridge session ORDERING (review round 2)', () => {
  let handlers;
  const ipcMain = { handle: (name, fn) => { handlers[name] = fn; } };
  const topFrame = {};
  Object.defineProperty(topFrame, 'top', { value: topFrame });
  const mainFrameEvent = { sender: { id: 1 }, senderFrame: topFrame };
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
      // eslint-disable-next-line no-await-in-loop
      const r = await handlers['widevine:manifest'](mainFrameEvent, { resolverId: 'mock-rate', entity: { asin: String(i) } });
      expect(r.success).toBe(true);
    }
    const ninth = await handlers['widevine:manifest'](mainFrameEvent, { resolverId: 'mock-rate', entity: {} });
    expect(ninth).toMatchObject({ success: false, reason: 'rate-limited' });
  });
});
