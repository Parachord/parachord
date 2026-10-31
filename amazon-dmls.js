// amazon-dmls.js — Amazon's widevine-bridge provider.
//
// The per-resolver half of native playback: fetch a track's DASH manifest and
// relay Widevine license bytes, both over Amazon's Digital Music Locator
// Service (dmls). Everything else about playing that stream — decoding,
// variant selection by the global quality setting, transport, the media
// session, the shared HTMLAudioElement — is the renderer player; this
// module knows nothing about it.
//
// Network contract (all live-verified 2026-10):
//   manifest  POST https://music.amazon.com/<REGION>/api/dmls/
//             X-Amz-Target …DigitalMusicLocatorServiceExternal.getDashManifestsV2
//             customerId optional (cookies carry it); customerInfo
//             (marketplace/territory), deviceToken and a format-valid
//             musicAgent are required. Response carries the FULL MPD inline
//             (Widevine cenc:pssh embedded; per-rendition signed CloudFront
//             BaseURLs; SIREN_KATANA mid-tier + spatial renditions.
//   license   same endpoint, target …getLicenseForPlaybackV2 — Amazon is its
//             own Widevine proxy; the CDM's challenge bytes round-trip
//             opaquely. CAQ= empty challenge once per session first (cert).
//             A 400 here means Amazon refused this build's VMP signature
//             (development certificate) — surfaced as licenseDenied.
//   session   GET /config.json (cookies only) answers customerId /
//             marketplaceId / musicTerritory / siteRegion / deviceId; the
//             CSRF triplet mints via amazon-web-player.mintSessionHeaders
//             (placeholder-filtered; its "REQUIRED_COOKIES_MISSING" is the
//             bad-csrf / session-rot symptom → refresh and retry once).
//
// Auth surface: cookies from persist:amazon-music read via ses.cookies.get
// into an explicit Cookie header — Electron's net module does not attach
// that session's jar reliably (400 NO_COOKIES otherwise).

'use strict';

const {
  amazonDmlsManifestBody,
  amazonDmlsLicenseBody,
  amazonDmlsRegion,
  amazonNativeSessionFromConfig,
  amazonAuthCookieState,
  mpdContentProtectionSets,
  DML_TARGET_PREFIX,
  WIDEVINE_CERT_CHALLENGE
} = require('./amazon-music-logic');

// hornet reports times relative to this offset format; cheap local copy.
function deviceTimeZoneString() {
  try {
    const offsetMinutes = -new Date().getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMinutes);
    return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  } catch {
    return null;
  }
}

const PARTITION = 'persist:amazon-music';
const MUSIC_AGENT_SDK = 'Vinyl/2.0';
const MUSIC_AGENT_CLIENT = 'GreenHornet_Web/1.0.1458';

function electron() { return require('electron'); }
function searchHost() { return require('./amazon-web-player.js'); }

function musicAgent() {
  let appVersion = 'dev';
  try { appVersion = (electron().app && electron().app.getVersion && electron().app.getVersion()) || 'dev'; } catch { /* not ready */ }
  return `${MUSIC_AGENT_SDK} ${MUSIC_AGENT_CLIENT} (Parachord/${appVersion})`;
}

const adapter = {
  deps: { store: null },
  telemetryHealth: { last: null, dropped: 0 },
  sessionContext: null, // volatile: { customerId, marketplaceId, territoryId, region, tier, deviceId, csrfToken, csrfRnd, csrfTs }
  sessionContextPromise: null,
  certSessionReady: false,

  init({ store } = {}) {
    this.deps.store = store || null;
  },

  async cookieHeader() {
    const ses = electron().session.fromPartition(PARTITION);
    const cookies = await ses.cookies.get({ url: 'https://music.amazon.com/' });
    // Keyed on amazonAuthCookieState's 'known' bucket (#1166): Amazon renamed
    // its auth cookies in the past and may again — exact at-main matching
    // would strand a live session as not-signed-in.
    const names = cookies.map((c) => c.name);
    if (amazonAuthCookieState(names) !== 'known') {
      const err = new Error('Sign in to Amazon Music first');
      err.reason = 'not-signed-in';
      throw err;
    }
    // Values are verbatim — cookie values cannot contain CRLF (Chromium
    // enforces it on set), so this cannot smuggle headers.
    return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  },

  async ensureSessionContext({ refresh } = {}) {
    if (!refresh && this.sessionContext) return this.sessionContext;
    if (this.sessionContextPromise) return this.sessionContextPromise;
    this.sessionContextPromise = this.mintSessionContext().then((ctx) => {
      this.sessionContext = ctx;
      this.sessionContextPromise = null;
      console.log(`[Amazon dmls] session context ok (territory ${ctx.territoryId}, region ${ctx.region}, tier ${ctx.tier || 'unknown'})`);
      return ctx;
    }).catch((err) => {
      this.sessionContextPromise = null;
      throw err;
    });
    return this.sessionContextPromise;
  },

  async mintSessionContext() {
    // Benign mint query: the user's own most recent search (already in their
    // Amazon history, so the one-shot page flow pollutes nothing).
    let lastQuery = null;
    try {
      const history = (this.deps.store && typeof this.deps.store.get === 'function' && this.deps.store.get('search_history')) || [];
      const first = Array.isArray(history) && history[0];
      if (first && typeof first.query === 'string' && first.query.trim().length >= 2) lastQuery = first.query.trim();
    } catch { /* history is optional */ }
    const [config, headers] = await Promise.all([
      this.fetchConfigJson(),
      searchHost().mintSessionHeaders({ query: lastQuery })
    ]);
    const session = amazonNativeSessionFromConfig(config);
    const ctx = {
      customerId: session.customerId,
      marketplaceId: session.marketplaceId || 'ATVPDKIKX0DER',
      territoryId: session.territoryId || 'US',
      region: session.region || amazonDmlsRegion(session.territoryId),
      tier: session.tier,
      deviceType: session.deviceType || null,
      // config.json's deviceId is the registered device; the captured header
      // is the fallback (the page sometimes reports placeholder values).
      deviceId: session.deviceId || (headers && headers.deviceId) || null,
      csrfToken: headers && headers.csrfToken,
      csrfRnd: headers && headers.csrfRnd,
      csrfTs: headers && headers.csrfTs
    };
    if (!ctx.deviceId || !ctx.csrfToken) {
      const err = new Error('Amazon session context incomplete (no device id / csrf)');
      err.reason = 'load-failed'; // transient — never a sign-in prompt
      throw err;
    }
    return ctx;
  },

  async fetchConfigJson() {
    const { net } = electron();
    const ses = electron().session.fromPartition(PARTITION);
    const cookie = await this.cookieHeader();
    const text = await new Promise((resolve) => {
      const req = net.request({ method: 'GET', url: 'https://music.amazon.com/config.json', session: ses });
      req.setHeader('Cookie', cookie);
      req.setHeader('Accept', 'application/json');
      req.setHeader('Referer', 'https://music.amazon.com/');
      const chunks = [];
      req.on('response', (res) => { res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); });
      req.on('error', () => resolve(''));
      req.end();
    });
    try { return JSON.parse(text); } catch { return {}; }
  },

  async dmls(ctx, target, body, { authRetry = true } = {}) {
    const { net } = electron();
    const ses = electron().session.fromPartition(PARTITION);
    const url = `https://music.amazon.com/${ctx.region}/api/dmls/`;
    const cookie = await this.cookieHeader();
    const headers = {
      'Content-Type': 'application/json',
      'Content-Encoding': 'amz-1.0',
      'X-Amz-Target': DML_TARGET_PREFIX + target,
      'csrf-token': ctx.csrfToken,
      'csrf-rnd': ctx.csrfRnd,
      'csrf-ts': ctx.csrfTs,
      Referer: 'https://music.amazon.com/',
      Origin: 'https://music.amazon.com',
      Accept: '*/*',
      Cookie: cookie
    };
    const out = await new Promise((resolve) => {
      const req = net.request({ method: 'POST', url, session: ses });
      for (const [k, v] of Object.entries(headers)) req.setHeader(k, v);
      const chunks = [];
      req.on('response', (res) => { res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') })); });
      req.on('error', (e) => resolve({ status: -1, text: String(e) }));
      req.end(JSON.stringify(body));
    });
    // Session rot — drop the cached context, re-mint once, retry once. A
    // second refusal is the session ITSELF being dead (the cookie-first
    // predicate can't see it before a round-trip): map to not-signed-in so
    // the renderer's prompt-then-retry contract applies (review I7).
    if (out.status === 400 && /Unauthorized|Authentication|REQUIRED_COOKIES/i.test(out.text)) {
      if (!authRetry) {
        this.sessionContext = null;
        const err = new Error('Amazon Music session expired — sign in again');
        err.reason = 'not-signed-in';
        throw err;
      }
      console.log('[Amazon dmls] session rejected — refreshing context and retrying once');
      this.sessionContext = null;
      let fresh;
      try {
        fresh = await this.ensureSessionContext({ refresh: true });
      } catch (mintErr) {
        this.sessionContext = null;
        throw mintErr;
      }
      return this.dmls(fresh, target, body, { authRetry: false });
    }
    return out;
  },

  // ── the widevine provider ───────────────────────────────────────────────

  // CAQ= cert pre-charge once per session (the page world used to do this in
  // its Shaka setup; warm it lazily on the first successful manifest).
  kickCertWarm() {
    if (this.certSessionReady || this._certWarmInFlight) return;
    this._certWarmInFlight = true;
    void this.warmCertSession().catch(() => {}).finally(() => { this._certWarmInFlight = false; });
  },

  async getManifest({ asin } = {}) {
    if (!asin) {
      const err = new Error('amazon-dmls: getManifest needs an ASIN');
      err.reason = 'invalid';
      throw err;
    }
    if (!(await searchHost().isSignedIn())) {
      const err = new Error('Sign in and choose an Amazon Music profile');
      err.reason = 'not-signed-in';
      throw err;
    }
    const ctx = await this.ensureSessionContext();
    const body = amazonDmlsManifestBody({
      asin,
      customerId: ctx.customerId,
      marketplaceId: ctx.marketplaceId,
      territoryId: ctx.territoryId,
      deviceId: ctx.deviceId,
      musicAgent: musicAgent()
    });
    if (!body) {
      const err = new Error('amazon-dmls: manifest body incomplete');
      err.reason = 'invalid';
      throw err;
    }
    const { status, text } = await this.dmls(ctx, 'getDashManifestsV2', body);
    let json = null;
    try { json = JSON.parse(text); } catch { /* fall through */ }
    if (status !== 200 || !json) {
      const err = new Error(`amazon-dmls: manifest HTTP ${status}: ${text.slice(0, 160)}`);
      err.reason = status === -1 ? 'load-failed' : 'playback-failed';
      throw err;
    }
    const entry = json.contentResponseList && json.contentResponseList[0];
    if (!entry || entry.contentResponseStatusCode !== 'SUCCESS' || !entry.manifest) {
      const err = new Error(`amazon-dmls: manifest error ${entry ? entry.contentResponseStatusCode : 'empty'}: ${(entry && entry.contentResponseStatusMessage) || ''}`.trim());
      err.reason = 'playback-failed';
      throw err;
    }
    const protectionSets = mpdContentProtectionSets(entry.manifest);
    console.log(`[Amazon dmls] manifest ${asin}${entry.substituteAsin ? ` → substitute ${entry.substituteAsin}` : ''} (${Math.round(entry.manifest.length / 1024)}KB, ${protectionSets.map((g) => `${g.family}:KID-${(g.kid || '?').slice(0, 6)}`).join(' ')})`);
    this.kickCertWarm();
    return { manifest: entry.manifest, substituteAsin: entry.substituteAsin || null, musicDashVersion: entry.musicDashVersion || null, cdnType: entry.cdnType || null, protectionSets };
  },

  async relayLicense(challengeB64) {
    const challenge = String(challengeB64 || '');
    // CDM challenges are ~7KB observed; b64 alphabet only. An oversize or
    // non-b64 blob would 400 opaquely downstream.
    if (!/^[A-Za-z0-9+/=]+$/.test(challenge) || challenge.length > 65536) {
      throw new Error('amazon-dmls: invalid license challenge');
    }
    const ctx = await this.ensureSessionContext();
    const body = amazonDmlsLicenseBody({
      challenge: String(challengeB64),
      customerId: ctx.customerId,
      deviceId: ctx.deviceId,
      musicAgent: musicAgent()
    });
    if (!body) throw new Error('amazon-dmls: license body incomplete');
    const { status, text } = await this.dmls(ctx, 'getLicenseForPlaybackV2', body);
    if (status === 400) {
      // Amazon refusing this build's Widevine certificate (development VMP) —
      // surfaced to the renderer player as licenseDenied, mirroring the
      // hornet path's error text.
      const err = new Error('Amazon refused the Widevine license. This build needs a production VMP signature.');
      err.reason = 'playback-failed';
      err.licenseDenied = true;
      throw err;
    }
    let json = null;
    try { json = JSON.parse(text); } catch { /* fall through */ }
    if (status !== 200 || !json || typeof json.license !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(json.license)) {
      const err = new Error(`amazon-dmls: license HTTP ${status}: ${text.slice(0, 160)}`);
      err.reason = status === -1 ? 'load-failed' : 'playback-failed';
      throw err;
    }
    return json.license;
  },

  // CAQ= cert pre-charge once per session (the page world used to do this in
  // its Shaka setup; the relay necessitates our side).
  async warmCertSession() {
    if (this.certSessionReady) return;
    try {
      await this.relayLicense(WIDEVINE_CERT_CHALLENGE);
      console.log('[Amazon dmls] license cert session warm');
    } catch (e) {
      // Tolerated: some sessions accept first-party challenges without it;
      // the real per-track exchange decides.
      console.log('[Amazon dmls] cert pre-charge failed (continuing):', e && e.message);
    }
    this.certSessionReady = true;
  },

  // ── telemetry (hornet's /telemetry/v1/events streaming reports) ────────

  telemetry() {
    if (!this._telemetry) {
      const { createAmazonTelemetry } = require('./main-process/amazon-telemetry');
      const crypto = require('crypto');
      this._telemetry = createAmazonTelemetry({
        post: (envelope) => this.postTelemetryEvent(envelope),
        context: () => ({
          ...(this.sessionContext || {}),
          deviceTimeZone: deviceTimeZoneString()
        }),
        randomUUID: () => crypto.randomUUID()
      });
    }
    return this._telemetry;
  },

  // The widevine bridge's third channel: renderer player lifecycle events.
  handlePlayerEvent(event = {}) {
    try {
      const t = this.telemetry();
      switch (event.type) {
        case 'play-started': return t.onPlayStarted(event);
        case 'seek': return t.onSeek(event);
        case 'pause': return t.onPause(event);
        case 'resume': return t.onResume(event);
        case 'ended': return t.onEnded(event);
        case 'stopped': return t.onStopped(event);
        default: return undefined;
      }
    } catch (e) {
      console.log('[Amazon telemetry] event dropped:', e && e.message);
      return undefined;
    }
  },

  async postTelemetryEvent(envelope) {
    const ctx = await this.ensureSessionContext();
    const { net } = electron();
    const ses = electron().session.fromPartition(PARTITION);
    const cookie = await this.cookieHeader();
    // Captured hornet telemetry headers: csrf triplet + device registration
    // (x-amz- spellings, distinct from the gql template's x-amzn-device-id).
    const headers = {
      'Content-Type': 'application/json',
      'csrf-token': ctx.csrfToken,
      'csrf-rnd': ctx.csrfRnd,
      'csrf-ts': ctx.csrfTs,
      ...(ctx.deviceType ? { 'x-amz-device-type': ctx.deviceType } : { 'x-amz-device-type': 'A16ZV8BU3SN1N3' }),
      'x-amz-device-id': ctx.deviceId,
      Referer: 'https://music.amazon.com/',
      Origin: 'https://music.amazon.com',
      Accept: '*/*',
      Cookie: cookie
    };
    const actionName = envelope.clientActionList && envelope.clientActionList[0] && envelope.clientActionList[0].actionName;
    const { status, text } = await new Promise((resolve) => {
      const req = net.request({ method: 'POST', url: 'https://music.amazon.com/telemetry/v1/events', session: ses });
      for (const [k, v] of Object.entries(headers)) req.setHeader(k, v);
      const chunks = [];
      req.on('response', (res) => { res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') })); });
      req.on('error', (e) => resolve({ status: -1, text: String(e) }));
      req.end(JSON.stringify({ ...envelope, deviceId: ctx.deviceId || envelope.deviceId }));
    });
    // Telemetry health surfaces in getStatus (plays must be reported or the
    // subscription accounting drifts silently, exactly what the README
    // promises not to do). Console.warn + the dropped counter make a rotated
    // header set loud instead of invisible.
    this.telemetryHealth.last = { status, at: Date.now(), actionName: actionName || null };
    if (status !== 200) {
      this.telemetryHealth.dropped += 1;
      console.warn(`[Amazon telemetry] POST ${actionName} -> ${status}: ${(text || '').slice(0, 120)}`);
    }
    return { status };
  },

  // Sign-out invalidates everything session-scoped — but the stream that
  // was playing gets its FINAL accounting first (trackStreamed with the
  // accumulated sum = hornet's systemStop flow before the session dies).
  onSignOut() {
    try { this._telemetry && this._telemetry.onStopped({}); } catch { /* best-effort */ }
    this.sessionContext = null;
    this.certSessionReady = false;
    this._telemetry = null;
  },

  debugState() {
    return {
      provider: 'amazon-dmls',
      sessionContext: !!this.sessionContext,
      tier: this.sessionContext && this.sessionContext.tier,
      certSessionReady: this.certSessionReady,
      telemetry: {
        last: this.telemetryHealth.last,
        dropped: this.telemetryHealth.dropped
      }
    };
  }
};

function registerAmazonDmlsProvider({ registerWidevineProvider, store } = {}) {
  adapter.init({ store });
  registerWidevineProvider('amazonmusic', adapter);
  return adapter;
}

module.exports = { registerAmazonDmlsProvider, amazonDmls: adapter };
