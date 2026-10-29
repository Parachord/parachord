// Spike: native Amazon playback outside the hornet webview.
//
// What this proves:
//  - main fetches the DASH manifest itself (dmls getDashManifestsV2 without a page)
//  - a bundled Shaka in OUR window decrypts and plays it (EME + our CDM)
//  - license bytes relay through main (getLicenseForPlaybackV2), opaque to us
//
// Deliberately NOT wired into the app's playback plumbing (amplitude binding,
// resolvers, queue). Driven from CDP/dev IPC only. If the spike proves out,
// integration becomes its own tracked arc.

const path = require('path');

const DMLS_URL = 'https://music.amazon.com/NA/api/dmls/';
const DMLS_PREFIX = 'com.amazon.digitalmusiclocator.DigitalMusicLocatorServiceExternal.';

// CAQ= is the empty Widevine challenge the hornet page sends before its first
// real per-track license exchange (session/cert init). Mimic it once per
// session; Amazon may refuse first-party challenges issued without it.
const WIDEVINE_CERT_CHALLENGE = 'CAQ=';

function electron() { return require('electron'); }

const spike = {
  win: null,
  ready: false,
  certSent: false,
  licenseLog: [],

  dmlsHeaders(target) {
    const awp = require('./amazon-web-player.js');
    const t = awp.specSearchTemplate;
    if (!t || !t.headers || !t.headers['csrf-token']) throw new Error('native-player spike: no csrf source (run a search first)');
    return {
      'Content-Type': 'application/json',
      'Content-Encoding': 'amz-1.0',
      'X-Amz-Target': DMLS_PREFIX + target,
      'csrf-token': t.headers['csrf-token'],
      'csrf-rnd': t.headers['csrf-rnd'],
      'csrf-ts': t.headers['csrf-ts'],
      'Referer': 'https://music.amazon.com/',
      'Origin': 'https://music.amazon.com',
      'Accept': '*/*',
    };
  },

  async cookieHeader() {
    const ses = electron().session.fromPartition('persist:amazon-music');
    const cookies = await ses.cookies.get({ url: 'https://music.amazon.com/' });
    if (!cookies.some((c) => c.name === 'at-main')) throw new Error('native-player spike: not signed in (no at-main cookie)');
    return cookies.map((c) => c.name + '=' + c.value).join('; ');
  },

  // POST a dmls request from main. net.request does not attach the session
  // cookie jar reliably, so the Cookie header is set explicitly.
  async dmls(target, body) {
    const { net } = electron();
    const headers = { ...this.dmlsHeaders(target), Cookie: await this.cookieHeader() };
    return new Promise((resolve, reject) => {
      const r = net.request({ method: 'POST', url: DMLS_URL, session: electron().session.fromPartition('persist:amazon-music') });
      for (const [k, v] of Object.entries(headers)) r.setHeader(k, v);
      const chunks = [];
      r.on('response', (res) => {
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      });
      r.on('error', reject);
      r.end(typeof body === 'string' ? body : JSON.stringify(body));
    });
  },

  async fetchManifest(asin) {
    const awp = require('./amazon-web-player.js');
    const t = awp.specSearchTemplate;
    const body = {
      appInfo: { musicAgent: 'Vinyl/2.0 GreenHornet_Web/1.0.1458 (player-b spike)' },
      customerId: 'AVZDETJ7PU6TV',
      customerInfo: { marketplaceId: 'ATVPDKIKX0DER', territoryId: 'US' },
      contentIdList: [{ identifier: asin, identifierType: 'ASIN' }],
      deviceToken: { deviceTypeId: 'A16ZV8BU3SN1N3', deviceId: (t && t.headers['x-amzn-device-id']) || '14354613042605242' },
      musicDashVersionList: ['SIREN_KATANA'],
      contentProtectionList: ['TRACK_PSSH'],
      tryAsinSubstitution: true,
    };
    const { status, text } = await this.dmls('getDashManifestsV2', body);
    let json = null;
    try { json = JSON.parse(text); } catch { /* fall through */ }
    const entry = json && json.contentResponseList && json.contentResponseList[0];
    if (status !== 200 || !entry || entry.contentResponseStatusCode !== 'SUCCESS') {
      throw new Error(`native-player spike: manifest failed status=${status} detail=${text.slice(0, 200)}`);
    }
    return { mpd: entry.manifest, substituteAsin: entry.substituteAsin || null, musicDashVersion: entry.musicDashVersion };
  },

  // Shaka license scheme relay: challenge bytes (b64) -> license bytes (b64).
  async relayLicense(b64Challenge) {
    const awp = require('./amazon-web-player.js');
    const t = awp.specSearchTemplate;
    const body = {
      DrmType: 'WIDEVINE',
      licenseChallenge: b64Challenge,
      customerId: 'AVZDETJ7PU6TV',
      deviceToken: { deviceTypeId: 'A16ZV8BU3SN1N3', deviceId: (t && t.headers['x-amzn-device-id']) || '14354613042605242' },
      appInfo: { musicAgent: 'Vinyl/2.0 GreenHornet_Web/1.0.1458 (player-b spike)' },
    };
    const { status, text } = await this.dmls('getLicenseForPlaybackV2', body);
    let json = null;
    try { json = JSON.parse(text); } catch { /* fall through */ }
    this.licenseLog.push({ challengeLen: b64Challenge.length, status, responseHead: (text || '').slice(0, 160) });
    console.log('[player-b] license relay', b64Challenge.length, 'chars ->', status, (text || '').slice(0, 120));
    if (status !== 200 || !json) throw new Error(`native-player spike: license failed status=${status} detail=${(text || '').slice(0, 200)}`);
    const license = json.license || json.License || json.licenseResponse || json.licenseChallenge;
    if (license) return license;
    const strVals = [];
    JSON.stringify(json, (k, v) => { if (typeof v === 'string' && v.length > 100) strVals.push({ k, len: v.length }); return v; });
    throw new Error(`native-player spike: license response had no license field: ${JSON.stringify(strVals)}`);
  },

  async ensureWindow() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const { BrowserWindow } = electron();
    this.win = new BrowserWindow({
      width: 400, height: 300, show: false,
      webPreferences: {
        preload: path.join(__dirname, 'player-b-preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: false,
        autoplayPolicy: 'no-user-gesture-required',
        // Spike-only: segment fetches to CloudFront must skip CORS (Amazon
        // ACOA-pins its CDN to music.amazon.com). Production replaces this
        // with session.webRequest ACAO injection on the player partition.
        webSecurity: false,
      },
    });
    this.win.webContents.on('console-message', (_e, _l, msg) => console.log(msg));
    this.win.webContents.on('did-fail-load', (_e, code, desc) => console.log('[player-b] load fail', code, desc));
    const ready = new Promise((resolve) => {
      this.win.webContents.once('did-finish-load', () => { this.ready = true; resolve(); });
    });
    await this.win.loadFile(path.join(__dirname, 'player-b.html'));
    await ready;
    return this.win;
  },

  async playNative(asin) {
    if (!this.certSent) {
      try { await this.relayLicense(WIDEVINE_CERT_CHALLENGE); this.certSent = true; } catch (e) { console.log('[player-b] cert pre-challenge failed (continuing):', e.message); }
    }
    const { mpd, substituteAsin } = await this.fetchManifest(asin);
    const win = await this.ensureWindow();
    win.webContents.send('player-b:load', { asin, substituteAsin, mpd });
    return { sent: true, asin, substituteAsin };
  },

  async state() {
    if (!this.win || this.win.isDestroyed() || !this.ready) return { ready: false };
    const state = await this.win.webContents.executeJavaScript('window.__pbState ? __pbState() : null').catch(() => null);
    const events = await this.win.webContents.executeJavaScript('window.__pbEvents || []').catch(() => []);
    return { ready: true, state, events, licenseLog: this.licenseLog };
  },
};

module.exports = spike;
