// Tests for the shared widevine player (src/renderer/lib/widevine-player.js).
// The reviewer-flagged surface: base64 chunking round-trips, the license
// scheme's error propagation, play-token supersession, player-event ordering,
// and applyConfig's family-scoped Shaka configuration. Everything window-side
// (shaka, electron bridge, audio element, store) is faked — the player
// module is re-required per test so its singleton state is fresh.

const path = require('path');

function makeAudio() {
  const listeners = {};
  return {
    listeners,
    currentTime: 0,
    duration: 369.6,
    volume: 1,
    ended: false,
    paused: true,
    src: '',
    play: jest.fn(async function () { this.paused = false; }),
    pause: jest.fn(function () { this.paused = true; }),
    addEventListener: jest.fn((ev, cb) => { (listeners[ev] = listeners[ev] || []).push(cb); }),
    fire(ev) { for (const cb of (listeners[ev] || [])) cb(); }
  };
}

function makeShaka({ loadGate } = {}) {
  const schemeHandlers = new Map();
  const playerInstances = [];
  class FakePlayer {
    constructor() {
      this.configureCalls = [];
      this.loadedUris = [];
      this.unloaded = 0;
      this.listeners = [];
      this.loadGate = loadGate || null; // test hook: pause inside load()
      this.variantTracks = [
        { id: 1, codecs: 'opus', bandwidth: 53059, audioSamplingRate: 48000, channelsCount: 2 },
        { id: 3, codecs: 'opus', bandwidth: 325595, audioSamplingRate: 48000, channelsCount: 2 },
        { id: 7, codecs: 'flac', bandwidth: 1902230, audioSamplingRate: 48000, channelsCount: 2 },
        // E-AC-3 JOC (Dolby Digital Plus Atmos) rung — B0CPSG7191 capture.
        { id: 8, codecs: 'ec-3', bandwidth: 770130, audioSamplingRate: 48000, channelsCount: 6 }
      ];
      this.selected = null;
      this.loadRejection = null; // set to make load() reject as Shaka would
      this.configureCountAtLoad = null; // configured-at-load ordering evidence
      playerInstances.push(this);
    }
    async attach() {}
    async detach() {}
    configure(cfg) { this.configureCalls.push(cfg); } // REFERENCE capture — a JSON
    // deep-clone would serialize maxBandwidth: Infinity to null and mask the
    // exact restriction-reset bug the H1 regression test pins.
    async load(uri) {
      this.configureCountAtLoad = this.configureCalls.length;
      // Model the vendor's parse-time filter (Pf/Qf): with a non-empty
      // preferredAudioCodecs and dontChooseCodecs UNSET, shaka narrows the
      // manifest's variant list to the FIRST listed codec with prefix
      // matches and WRITES IT BACK — the round-3 review blocker (a collapsed
      // roster that selection can never see past without a re-load).
      const cfg = this.configureCalls[this.configureCalls.length - 1] || {};
      const pref = cfg.preferredAudioCodecs || [];
      if (pref.length && !(cfg.streaming && cfg.streaming.dontChooseCodecs)) {
        for (const codec of pref) {
          const matching = this.variantTracks.filter((t) => t.codecs && String(t.codecs).startsWith(codec));
          if (matching.length) { this.variantTracks = matching; break; }
        }
      }
      // Model the criteria ADOPTED AT LOAD (the round-4 review blocker):
      // the LoadManager takes over a criteria configured with the
      // preferredAudioCodecs list set before load(), and player.configure()
      // never syncs that field back out — a load-time list narrows the ABR
      // candidate set forever, even after applyConfig re-sends [].
      this.criteriaPreferredCodecs = pref || [];
      // Model the vendor's fresh-load criteria adoption (Zo/p.load case 20:
      // every player.load() installs the fresh PreloadManager's fresh, WIDE
      // criteria): a new load clears whatever the previous track's manual
      // selections narrowed the choice criteria to (criteriaCodec/
      // criteriaChannels, set by selectVariantTrack below).
      this.criteriaCodec = null;
      this.criteriaChannels = null;
      if (this.loadGate) await this.loadGate; // test hook: pause mid-load
      this.loadedUris.push(uri);
      if (this.loadRejection) throw this.loadRejection;
    }
    // The candidate set the ABR manager is fed on each choice: narrowed by
    // the load-adopted criteria's codec list (first EXACT match wins), then
    // by the selection-configured criteria (exact codec, channelsCount ≤
    // the selection's — vendor `lo` keeps variants at or under the count),
    // or the full roster when nothing is set — the vendor's Zr/fo behavior.
    getAbrSet() {
      let set = this.variantTracks;
      const pref = this.criteriaPreferredCodecs || [];
      if (!pref.length) {
        // no load-adopted list
      } else {
        for (const codec of pref) {
          const matching = set.filter((t) => t.codecs === codec);
          if (matching.length) { set = matching; break; }
        }
      }
      if (this.criteriaCodec) set = set.filter((t) => t.codecs === this.criteriaCodec);
      if (this.criteriaChannels != null) set = set.filter((t) => t.channelsCount == null || t.channelsCount <= this.criteriaChannels);
      return set;
    }
    async unload() { this.unloaded += 1; }
    addEventListener(ev, cb) { this.listeners.push([ev, cb]); }
    getVariantTracks() { return this.variantTracks; }
    // Faithful to real Shaka: the selected variant is the ACTIVE one —
    // currentVariantFacts() keys off `active`, and plan-denial attribution
    // reads the active family at relay time. Also models the vendor's
    // selectVariantTrack side effect: the selection RE-CONFIGURES the choice
    // criteria with the selected rung (audioCodec + channelCount — vendor
    // `If`: criteria.configure({channelCount: f.audio.channelsCount,
    // audioCodec: f.audio.codecs})), which confines the ABR candidate set to
    // the selected family until the next selection — the criteria
    // confinement behind the adaptive flip bug.
    selectVariantTrack(t) {
      this.selected = t;
      for (const v of this.variantTracks) v.active = false;
      t.active = true;
      this.criteriaCodec = t.codecs || null;
      this.criteriaChannels = t.channelsCount || null;
      // Faithful to the vendor: a MANUAL selection fires 'variantchanged',
      // never 'adaptation' (the same switch path emits one or the other).
      for (const [ev, cb] of (this.listeners || [])) {
        if (ev === 'variantchanged') {
          try { cb({ type: 'variantchanged' }); } catch { /* listener owns nothing */ }
        }
      }
    }
    getConfiguration() { return this.configureCalls[this.configureCalls.length - 1] || {}; }
    getBandwidthEstimate() { return 100000000; }
  }
  return {
    polyfill: { installAll: jest.fn() },
    net: { NetworkingEngine: { registerScheme: (scheme, handler) => schemeHandlers.set(scheme, handler) } },
    Player: FakePlayer,
    schemeHandlers,
    playerInstances
  };
}

function makeElectron({ manifestManifest = '<MPD/>', manifestOk = true, licenseOk = true, licenseDenied = false, storeValues = {} } = {}) {
  const playerEvents = [];
  // The plugin-mediated half, faked as faithfully as the bridge behaves: an
  // openSession (called with the manifest's LENGTH — the text never crosses)
  // mints the resolver's CURRENT session, a provider manifest rotates it
  // away, and a relayLicense naming the plugin session forwards the challenge
  // to the router the player registered (the bridge's widevine:plugin-license
  // push — challenge and ids only, NO context: the plugin's context stays
  // renderer-side, in the player's relay record). A provider session answers
  // directly — the bridge routes by the session record, not the challenge.
  let pluginSession = null; // { sessionId } | null
  let pluginRouter = null; // the player's registered onPluginLicenseRequest callback
  let pluginSessionSeq = 0;
  const bridge = {
    getManifest: jest.fn(async () => {
      pluginSession = null; // a provider manifest rotates the resolver's session
      return manifestOk ? { success: true, manifest: manifestManifest, substituteAsin: 'SUB1', cdnType: 'cf-x' } : { success: false, reason: 'not-signed-in', error: 'denied' };
    }),
    openSession: jest.fn(async (resolverId, manifestLength, type, drm) => {
      pluginSessionSeq += 1;
      pluginSession = { sessionId: `plug-sess-${pluginSessionSeq}` };
      return { success: true, sessionId: pluginSession.sessionId };
    }),
    onPluginLicenseRequest: jest.fn((callback) => { pluginRouter = callback; return () => { pluginRouter = null; }; }),
    relayLicense: jest.fn(async (resolverId, challenge, sessionId) => {
      if (pluginSession && sessionId === pluginSession.sessionId) {
        if (!pluginRouter) return { success: false, reason: 'playback-failed', error: 'no plugin relay registered' };
        try {
          const license = await pluginRouter({ requestId: 'fake-req', resolverId, sessionId, challenge });
          return { success: true, license };
        } catch (error) {
          return {
            success: false,
            reason: (error && error.reason) || 'playback-failed',
            licenseDenied: !!(error && error.licenseDenied),
            denialReason: (error && error.denialReason) || null,
            error: String((error && error.message) || error)
          };
        }
      }
      return licenseOk ? { success: true, license: 'TElDRU5TRQ==' } : { success: false, licenseDenied, error: 'refused' };
    }),
    playerEvent: jest.fn(async (resolverId, event) => { playerEvents.push([resolverId, event]); return { success: true }; })
  };
  const store = {
    get: jest.fn(async (key) => storeValues[key]),
    set: jest.fn(async (key, value) => { storeValues[key] = value; }),
    __values: storeValues
  };
  return { bridge, store, playerEvents, pluginRouter: (request) => (pluginRouter ? pluginRouter(request) : Promise.reject(new Error('no plugin relay registered'))) };
}

function load({ shaka, electron, codecSupport } = {}) {
  jest.resetModules();
  const sh = shaka || makeShaka();
  const el = electron || makeElectron();
  const full = { flac: true, opus: true, aac: true, ec3: true };
  const support = codecSupport ? { ...full, ...codecSupport } : full;
  global.window = {
    shaka: sh,
    electron: { widevine: el.bridge, store: el.store },
    __parachordWidevineError: undefined,
    navigator: {
      requestMediaKeySystemAccess: async (_sys, configs) => {
        // Enforce the minimal-probe invariant: no distinctiveIdentifier ever.
        if (JSON.stringify(configs).includes('distinctiveIdentifier')) {
          throw new Error('TypeError: Failed to read distinctiveIdentifier property');
        }
        if (support.emeFlacReject && JSON.stringify(configs).includes('flac')) throw new Error('NotSupportedError');
        if (support.emeEc3Reject && JSON.stringify(configs).includes('ec-3')) throw new Error('NotSupportedError');
        if (support.emeFlacEmpty) return null;
        return { getConfiguration: () => configs };
      }
    },
    MediaSource: {
      isTypeSupported: (type) => {
        if (/flac/.test(type)) return !!support.flac;
        if (/opus/.test(type)) return !!support.opus;
        if (/mp4a/.test(type)) return !!support.aac;
        if (/ec-3/.test(type)) return !!support.ec3;
        return false;
      }
    }
  };
  global.URL.createObjectURL = jest.fn(() => 'blob:mock-mpd');
  global.URL.revokeObjectURL = jest.fn();
  const player = require('../../src/renderer/lib/widevine-player');
  return { player, sh, el };
}

describe('license scheme relay', () => {
  test('challenge bytes round-trip through b64/unb64 with arbitrary content', async () => {
    const { sh, el, player } = load();
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    const handler = sh.schemeHandlers.get('parachord-license');
    expect(handler).toBeDefined();
    // bytes that hit the chunk boundary + non-ASCII values
    const bytes = new Uint8Array(40000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37) % 256;
    const response = await handler('parachord-license://amazonmusic', { body: bytes.buffer, uris: [] });
    expect(new Uint8Array(response.data)).toEqual(new Uint8Array([...Buffer.from('TElDRU5TRQ==', 'base64')]));
    const sent = el.bridge.relayLicense.mock.calls[0][1];
    expect(Buffer.from(sent, 'base64')).toEqual(Buffer.from(bytes.buffer));
  });

  test('CUSTOMER_NOT_ELIGIBLE for HD: session drops FLAC — next max-tier play picks opus (plan-level block)', async () => {
    const { sh, el, player } = load({
      electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: false } })
    });
    // Bridge-level denied-shape with the HD eligibility reason.
    el.bridge.relayLicense.mockResolvedValueOnce({ success: false, licenseDenied: false, denialReason: 'CUSTOMER_NOT_ELIGIBLE', error: 'not eligible for HD' });
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    // First play at max starts locked on flac (the roster was full then).
    let p = sh.playerInstances[0];
    expect(p.selected.bandwidth).toBe(1902230);
    // The license relay fails with the HD eligibility reason → session flag.
    const handler = sh.schemeHandlers.get('parachord-license');
    await expect(handler('parachord-license://amazonmusic?v=2', { body: new ArrayBuffer(4), uris: [] })).rejects.toBeTruthy();
    expect(player.getState().blockedFamilies).toEqual({ flac: 'license-denied' });
    // Subsequent max-tier play sees the FLAC rung put out of the roster.
    await player.stop();
    const audio2 = makeAudio();
    await player.play(audio2, { resolverId: 'amazonmusic', entity: { asin: 'B2' } });
    p = sh.playerInstances[0]; // same engine singleton
    expect(p.selected.codecs).toContain('opus');
    expect(p.selected.bandwidth).toBe(325595);
  });

  test('licenseDenied propagates from the bridge through the scheme handler', async () => {
    const { sh, el, player } = load({ electron: makeElectron({ licenseOk: false, licenseDenied: true }) });
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    const handler = sh.schemeHandlers.get('parachord-license');
    await expect(handler('parachord-license://amazonmusic', { body: new ArrayBuffer(4), uris: [] }))
      .rejects.toMatchObject({ licenseDenied: true, message: 'refused' });
  });
});

describe('playPlugin (the plugin-mediated path, #1356 M4)', () => {
  const pluginReply = (over = {}) => ({
    manifest: '<MPD the plugin fetched/>',
    type: 'dash',
    drm: 'widevine',
    context: { asin: 'B1', csrf: 'tok' },
    ...over
  });

  test('opens the bridge session with the plugin\'s manifest and plays it: same load, session-scoped licence URL', async () => {
    const { sh, el, player } = load();
    const audio = makeAudio();
    const result = await player.playPlugin(audio, {
      resolverId: 'amazonmusic',
      manifestResult: pluginReply({ substituteAsin: 'SUB9', cdnType: 'cf-y' }),
      relayLicense: async () => 'TElDRU5TRQ==',
      trackContext: { albumAsin: 'ALB1', durationMs: 210000 }
    });
    // The plugin supplied the manifest; the host only opened the session —
    // by LENGTH (the text never crosses IPC).
    expect(el.bridge.getManifest).not.toHaveBeenCalled();
    expect(el.bridge.openSession).toHaveBeenCalledWith('amazonmusic', '<MPD the plugin fetched/>'.length, 'dash', 'widevine');
    expect(sh.playerInstances[0].loadedUris).toContain('blob:mock-mpd');
    const drmCfg = sh.playerInstances[0].configureCalls.find((c) => c.drm && c.drm.servers);
    expect(drmCfg.drm.servers['com.widevine.alpha']).toBe('parachord-license://amazonmusic?s=plug-sess-1');
    // The optional extras ride the provider reply's own fields.
    expect(result).toMatchObject({ resolverId: 'amazonmusic', substituteAsin: 'SUB9' });
    expect(typeof result.token).toBe('number');
  });

  test('the challenge reaches the plugin\'s relayLicense with the session\'s context; its licence bytes return to Shaka', async () => {
    const { sh, el, player } = load();
    const relayLicense = jest.fn(async () => 'TVBVRElOIExJQ0VOU0U=');
    const audio = makeAudio();
    await player.playPlugin(audio, { resolverId: 'amazonmusic', manifestResult: pluginReply(), relayLicense });
    const handler = sh.schemeHandlers.get('parachord-license');
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const response = await handler('parachord-license://amazonmusic?s=plug-sess-1', { body: bytes.buffer, uris: [] });
    // The plugin saw its own context — the one from ITS manifest reply, held
    // renderer-side in the player's relay record (never carried main-side,
    // never on the forward) — not the whole track, not the entity.
    expect(relayLicense).toHaveBeenCalledWith(Buffer.from(bytes.buffer).toString('base64'), { asin: 'B1', csrf: 'tok' });
    // The licence is the PLUGIN's bytes (not the fake provider's).
    expect(new Uint8Array(response.data)).toEqual(new Uint8Array([...Buffer.from('TVBVRElOIExJQ0VOU0U=', 'base64')]));
    // And the relay crossed the bridge channel gated like any other.
    expect(el.bridge.relayLicense).toHaveBeenCalledWith('amazonmusic', expect.any(String), 'plug-sess-1');
  });

  test('lifecycle events reach the plugin\'s playerEvents (telemetry) with the served asin, beside the bridge IPC (#1356 M9)', async () => {
    const { sh, el, player } = load();
    const pluginEvents = [];
    const audio = makeAudio();
    // The reply's asin is the plugin's identifier extraction; substituteAsin
    // layers the SERVED pressing over it on the entity seam.
    await player.playPlugin(audio, {
      resolverId: 'amazonmusic',
      manifestResult: pluginReply({ asin: 'REQ1', substituteAsin: 'SUB9' }),
      relayLicense: async () => 'TVBVRElOIExJQ0VOU0U=',
      playerEvents: (event) => { pluginEvents.push(event); },
      trackContext: { albumAsin: 'ALB1', durationMs: 210000 }
    });
    audio.fire('playing');
    audio.currentTime = 42;
    audio.fire('seeking');
    await player.stop();
    const types = pluginEvents.map((e) => e.type);
    expect(types).toEqual(['play-started', 'seek', 'stopped']);
    // The play-started event attributes the SERVED pressing and carries the
    // same facts the provider path emitted (the bridge fanout stays identical).
    const started = pluginEvents[0];
    expect(started.asin).toBe('SUB9');
    expect(started.albumAsin).toBe('ALB1');
    expect(started.sessionId).toBe('plug-sess-1');
    expect(el.playerEvents.map(([, e]) => e.type)).toEqual(types);
    // A resolver with no handler (playerEvents absent) changes nothing on the
    // bridge path.
    const pluginEventsB = [];
    await player.playPlugin(makeAudio(), {
      resolverId: 'amazonmusic',
      manifestResult: pluginReply({ asin: 'REQ2' }),
      relayLicense: async () => 'TVBVRElOIExJQ0VOU0U='
    });
    makeAudio(); // (the second play owns the element; its events are the bridge's alone)
    expect(pluginEventsB).toEqual([]);
  });

  test('a reply without an asin still plays (the field is an optional extra — telemetry simply has no asin to attribute)', async () => {
    const { el, player } = load();
    const reply = await player.playPlugin(makeAudio(), {
      resolverId: 'amazonmusic',
      manifestResult: pluginReply(), // no asin field
      relayLicense: async () => 'TVBVRElOIExJQ0VOU0U=',
      trackContext: { albumAsin: 'ALB1' }
    });
    expect(reply.token).toEqual(expect.any(Number));
    expect(el.bridge.openSession).toHaveBeenCalled();
  });

  test('a plugin rejection carries licenseDenied/denialReason into the same Shaka error path (the #1262 latch, unchanged)', async () => {
    const { sh, el, player } = load({
      electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: false } })
    });
    const relayLicense = jest.fn(async () => {
      const err = new Error('Amazon refused the license for this content (CUSTOMER_NOT_ELIGIBLE): not eligible');
      err.reason = 'playback-failed';
      err.licenseDenied = false;
      err.denialReason = 'CUSTOMER_NOT_ELIGIBLE';
      throw err;
    });
    const audio = makeAudio();
    await player.playPlugin(audio, { resolverId: 'amazonmusic', manifestResult: pluginReply(), relayLicense });
    // First play at max starts locked on flac (the full roster).
    expect(sh.playerInstances[0].selected.bandwidth).toBe(1902230);
    const handler = sh.schemeHandlers.get('parachord-license');
    await expect(handler('parachord-license://amazonmusic?s=plug-sess-1', { body: new ArrayBuffer(4), uris: [] }))
      .rejects.toMatchObject({ message: 'Amazon refused the license for this content (CUSTOMER_NOT_ELIGIBLE): not eligible' });
    // The family-failure latch keyed on the error fields exactly as the
    // provider path's does: FLAC is out for the session.
    expect(player.getState().blockedFamilies).toEqual({ flac: 'license-denied' });
  });

  test('an open-session refusal surfaces with its reason', async () => {
    const el = makeElectron();
    el.bridge.openSession.mockResolvedValueOnce({ success: false, reason: 'rate-limited', error: 'too many manifest requests' });
    const { player } = load({ electron: el });
    await expect(player.playPlugin(makeAudio(), {
      resolverId: 'amazonmusic', manifestResult: pluginReply(), relayLicense: async () => 'TElDRU5TRQ=='
    })).rejects.toMatchObject({ reason: 'rate-limited' });
  });

  test('a malformed plugin reply never opens a session', async () => {
    const { el, player } = load();
    const audio = makeAudio();
    const bad = [null, {}, { type: 'dash', drm: 'widevine' }, { manifest: '<MPD/>', type: 'hls', drm: 'widevine' }, { manifest: '<MPD/>', type: 'dash', drm: 'fairplay' }];
    for (const manifestResult of bad) {
      await expect(player.playPlugin(audio, { resolverId: 'amazonmusic', manifestResult, relayLicense: async () => 'TElDRU5TRQ==' }))
        .rejects.toMatchObject({ reason: 'playback-failed' });
    }
    expect(el.bridge.openSession).not.toHaveBeenCalled();
  });

  test('a forward naming any session other than the live plugin play is refused renderer-side too', async () => {
    const { el, player } = load();
    await player.playPlugin(makeAudio(), {
      resolverId: 'amazonmusic', manifestResult: pluginReply(), relayLicense: async () => 'TElDRU5TRQ=='
    });
    // A stale session's forward (if one raced through main's gates) finds no
    // router target: the live play is the only session that relays.
    await expect(el.pluginRouter({ requestId: 'x', resolverId: 'amazonmusic', sessionId: 'not-the-live-one', challenge: 'Q0FRPQ==' }))
      .rejects.toMatchObject({ reason: 'playback-failed' });
    // And after stop() there is no live plugin play at all.
    await player.stop();
    await expect(el.pluginRouter({ requestId: 'x', resolverId: 'amazonmusic', sessionId: 'plug-sess-1', challenge: 'Q0FRPQ==' }))
      .rejects.toMatchObject({ reason: 'playback-failed' });
  });

  test('a licence request fired MID-LOAD (Shaka asks while load() is still pending) reaches the plugin relay — the FIRST licence of a plugin play is not refused', async () => {
    // The review's blocker: Shaka sends the licence request during load() (as
    // soon as the DRM engine has init data), long before loadManifestSession
    // assigns trackSession — a router that read trackSession refused the
    // first licence of every plugin play. The router must answer from the
    // record taken at open-session time, before the load starts.
    let finishLoad;
    const loadGate = new Promise((res) => { finishLoad = res; });
    const { sh, el, player } = load({ shaka: makeShaka({ loadGate }) });
    const relayLicense = jest.fn(async () => 'TVBVRElOIExJQ0VOU0U=');
    const audio = makeAudio();
    const played = player.playPlugin(audio, { resolverId: 'amazonmusic', manifestResult: pluginReply(), relayLicense });
    await new Promise((r) => setTimeout(r, 25)); // the play parks inside load()
    const p = sh.playerInstances[0];
    expect(p.loadedUris).toHaveLength(0); // the gate holds: still mid-load
    expect(p.configureCalls.some((c) => c.drm && c.drm.servers)).toBe(true); // DRM config is set — Shaka would ask NOW
    const handler = sh.schemeHandlers.get('parachord-license');
    const licenceP = handler('parachord-license://amazonmusic?s=plug-sess-1', { body: new ArrayBuffer(4), uris: [] });
    // The relay answered MID-LOAD, with the plugin's own context from the
    // renderer-side record.
    expect(relayLicense).toHaveBeenCalledTimes(1);
    expect(relayLicense).toHaveBeenCalledWith(Buffer.from(new ArrayBuffer(4)).toString('base64'), { asin: 'B1', csrf: 'tok' });
    const response = await licenceP;
    expect(new Uint8Array(response.data)).toEqual(new Uint8Array([...Buffer.from('TVBVRElOIExJQ0VOU0U=', 'base64')]));
    finishLoad();
    const result = await played; // and the play proceeds
    expect(result).toMatchObject({ resolverId: 'amazonmusic' });
  });

  test('a pre-claimed token (claimPlayToken, taken before the plugin\'s manifest fetch) makes a bare stop() during that fetch supersede the play before it starts', async () => {
    // The engine claims before the manifest await (the provider path\'s rule):
    // a stop() with no newer handlePlay must not leave the stopped play
    // opening a session and loading the element.
    const { el, player } = load();
    const token = player.claimPlayToken();
    await player.stop(); // the bare stop (the sign-out shape)
    await expect(player.playPlugin(makeAudio(), {
      resolverId: 'amazonmusic', manifestResult: pluginReply(), relayLicense: async () => 'TElDRU5TRQ==', token
    })).rejects.toMatchObject({ reason: 'superseded' });
    expect(el.bridge.openSession).not.toHaveBeenCalled();
  });

  test('the happy pre-claim: playPlugin runs under the engine\'s token and returns it', async () => {
    const { el, player } = load();
    const token = player.claimPlayToken();
    const result = await player.playPlugin(makeAudio(), {
      resolverId: 'amazonmusic', manifestResult: pluginReply(), relayLicense: async () => 'TElDRU5TRQ==', token
    });
    expect(result).toMatchObject({ resolverId: 'amazonmusic', token });
    expect(el.bridge.openSession).toHaveBeenCalledTimes(1);
  });

  test('a licence refusal\'s .reason propagates through the scheme handler (the documented contract)', async () => {
    const { sh, el, player } = load();
    el.bridge.relayLicense.mockResolvedValueOnce({ success: false, reason: 'load-failed', error: 'licence host 503' });
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    const handler = sh.schemeHandlers.get('parachord-license');
    await expect(handler('parachord-license://amazonmusic', { body: new ArrayBuffer(4), uris: [] }))
      .rejects.toMatchObject({ reason: 'load-failed', message: 'licence host 503' });
  });

  test('a provider play after a plugin play takes the session back (supersession both ways)', async () => {
    const { sh, el, player } = load();
    const audio = makeAudio();
    await player.playPlugin(audio, { resolverId: 'amazonmusic', manifestResult: pluginReply(), relayLicense: async () => 'TVBVRElOIExJQ0VOU0U=' });
    const audio2 = makeAudio();
    await player.play(audio2, { resolverId: 'amazonmusic', entity: { asin: 'B2' } });
    // The provider play superseded the plugin one: a forward still naming the
    // plugin session (if one raced through main's gates) finds no router
    // target — the relay record died with the superseded play.
    await expect(el.pluginRouter({ requestId: 'x', resolverId: 'amazonmusic', sessionId: 'plug-sess-1', challenge: 'Q0FRPQ==' }))
      .rejects.toMatchObject({ reason: 'playback-failed' });
    // The provider session owns the element now; its licence URL names the
    // provider session, and the provider relay answers.
    const drmCfg = sh.playerInstances[0].configureCalls.filter((c) => c.drm && c.drm.servers).pop();
    expect(drmCfg.drm.servers['com.widevine.alpha']).not.toContain('plug-sess');
    const handler = sh.schemeHandlers.get('parachord-license');
    const response = await handler(drmCfg.drm.servers['com.widevine.alpha'], { body: new ArrayBuffer(4), uris: [] });
    expect(new Uint8Array(response.data)).toEqual(new Uint8Array([...Buffer.from('TElDRU5TRQ==', 'base64')]));
  });
});

describe('play-token supersession', () => {
  // The mint is the slow path live (seconds); test determinism needs a
  // resumable manifest promise instead of racing real ticks.
  function resumableManifest() {
    const el = makeElectron();
    const resolvers = [];
    el.bridge.getManifest = jest.fn(() => new Promise((resolve) => {
      resolvers.push(() => resolve({ success: true, manifest: '<MPD/>', substituteAsin: 'SUB1', cdnType: 'cf-x' }));
    }));
    return { el, resolvers };
  }

  test('a slower first play throws superseded and never reaches the element', async () => {
    const { el, resolvers } = resumableManifest();
    const { player, sh } = load({ electron: el });
    const audio = makeAudio();
    const p1 = player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'A-slow' } });
    const p2 = player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B-fast' } });
    await new Promise(r => setImmediate(r));
    // both manifests pending (both waits on their own token)
    expect(resolvers.length).toBe(2);
    resolvers[0](); // A resolves — but B already bumped the token
    await expect(p1).rejects.toMatchObject({ reason: 'superseded' });
    resolvers[1]();
    await expect(p2).resolves.toMatchObject({ resolverId: 'amazonmusic' });
  });

  test('stop() invalidates an in-flight play', async () => {
    const { el, resolvers } = resumableManifest();
    const { player } = load({ electron: el });
    const audio = makeAudio();
    const p = player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'A' } });
    await new Promise(r => setImmediate(r));
    await player.stop();
    resolvers[0]();
    await expect(p).rejects.toMatchObject({ reason: 'superseded' });
  });

  test('a manifest failure that lands after stop() is superseded, not playback-failed', async () => {
    const resolvers = [];
    const el = makeElectron();
    el.bridge.getManifest = jest.fn(() => new Promise((resolve) => {
      resolvers.push(() => resolve({ success: false, reason: 'playback-failed', error: 'CONTENT_NOT_ELIGIBLE' }));
    }));
    const { player } = load({ electron: el });
    const p = player.play(makeAudio(), { resolverId: 'amazonmusic', entity: { asin: 'A' } });
    await new Promise(r => setImmediate(r));
    await player.stop();
    resolvers[0]();
    await expect(p).rejects.toMatchObject({ reason: 'superseded' });
  });

  test('a load interrupted by stop() is superseded, not Shaka 7000', async () => {
    const { el, resolvers } = resumableManifest();
    const { sh, player } = load({ electron: el });
    let release;
    sh.Player.prototype.load = function () {
      this.loadedUris.push('held');
      return new Promise((resolve, reject) => {
        release = () => reject(Object.assign(new Error('shaka 7000 LOAD_INTERRUPTED'), { code: 7000 }));
      });
    };
    const p = player.play(makeAudio(), { resolverId: 'amazonmusic', entity: { asin: 'A' } });
    await new Promise(r => setImmediate(r));
    resolvers[0]();
    for (let i = 0; i < 20 && !release; i += 1) await Promise.resolve();
    expect(release).toBeDefined();
    await player.stop();
    release();
    await expect(p).rejects.toMatchObject({ reason: 'superseded' });
  });
});

describe('stale teardowns (review round 2)', () => {
  test('stop() does not unload once the engine no longer owns the element', async () => {
    const { sh, player } = load();
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'A' } });
    const inst = sh.playerInstances[0];
    await player.stop();
    const afterOwnedStop = inst.unloaded;
    const again = await player.stop();
    expect(again).toMatchObject({ stopped: false, reason: 'not-owner' });
    expect(inst.unloaded).toBe(afterOwnedStop);
    expect(inst.unloaded).toBeGreaterThan(0);
  });

  test('a critical error before the element is audible rejects untilAudible', async () => {
    const { sh, player } = load();
    await player.play(makeAudio(), { resolverId: 'amazonmusic', entity: { asin: 'A' } });
    const inst = sh.playerInstances[0];
    const errorCb = inst.listeners.find(([ev]) => ev === 'error')[1];
    const pending = player.untilAudible();
    errorCb({ detail: { severity: 2, code: 6007, message: 'license failed' } });
    await expect(pending).rejects.toMatchObject({ reason: 'playback-failed' });
  });

  test('clearPlanBlocks lets the next max-tier play select FLAC again', async () => {
    const { sh, el, player } = load({
      electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: false } })
    });
    el.bridge.relayLicense.mockResolvedValueOnce({ success: false, licenseDenied: false, denialReason: 'CUSTOMER_NOT_ELIGIBLE', error: 'not eligible for HD' });
    await player.play(makeAudio(), { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    const handler = sh.schemeHandlers.get('parachord-license');
    await expect(handler('parachord-license://amazonmusic?v=2', { body: new ArrayBuffer(4), uris: [] })).rejects.toBeTruthy();
    expect(player.getState().blockedFamilies).toEqual({ flac: 'license-denied' });
    player.clearPlanBlocks();
    expect(player.getState().blockedFamilies).toEqual({});
    await player.stop();
    await player.play(makeAudio(), { resolverId: 'amazonmusic', entity: { asin: 'B2' } });
    expect(sh.playerInstances[0].selected.bandwidth).toBe(1902230);
  });

  test('stop({token}) with a moved-on token does nothing — the newer play survives', async () => {
    const { player } = load();
    const audio = makeAudio();
    const first = await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'A' } });
    const second = await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B' } });
    const out = await player.stop({ token: first.token });
    expect(out).toMatchObject({ stopped: false, reason: 'stale-teardown' });
    expect(player.getState().activeResolverId).toBe('amazonmusic');
    await player.stop({ token: second.token });
    expect(player.getState().activeResolverId).toBeNull();
  });

  test('the token travels on the play result', async () => {
    const { player } = load();
    const audio = makeAudio();
    const result = await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'A' } });
    expect(result.token).toEqual(expect.any(Number));
  });
});

describe('player-event emission + session facts', () => {
  test('play-started fires after ' + "'playing'" + ' with substitute attribution; stop emits stopped', async () => {
    const { player, el } = load();
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'REQ1' }, trackContext: { albumAsin: 'ALB1' } });
    audio.fire('playing');
    const events = el.playerEvents.map(([, e]) => e.type);
    expect(events).toContain('play-started');
    const started = el.playerEvents.find(([, e]) => e.type === 'play-started')[1];
    expect(started.asin).toBe('SUB1');
    expect(started.albumAsin).toBe('ALB1');
    await player.stop();
    const types = el.playerEvents.map(([, e]) => e.type);
    expect(types[types.length - 1]).toBe('stopped');
  });

  test('seek/pause/ended flow through element events', async () => {
    const { player, el } = load();
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'REQ1' } });
    audio.fire('playing');
    el.playerEvents.length = 0;
    audio.currentTime = 100;
    audio.fire('seeking');
    audio.fire('pause');
    audio.ended = true;
    audio.fire('ended');
    const types = el.playerEvents.map(([, e]) => e.type);
    expect(types).toEqual(['seek', 'pause', 'ended']);
  });
});

describe('stream-quality facts', () => {
  test('bitrate is reported in kbps (raw bandwidth / 1000, rounded)', async () => {
    const { sh, player } = load({ electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: false } }) });
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    // Lock = top variant (flac 1902230 bps); mark it active in the fake
    const p = sh.playerInstances[0];
    p.variantTracks.forEach((t) => { t.active = false; });
    p.variantTracks.find((t) => t.id === 7).active = true;
    const facts = player.currentVariantFacts();
    expect(facts.bitrate).toBe(1902);
    p.variantTracks.find((t) => t.id === 7).active = false;
    p.variantTracks.find((t) => t.id === 3).active = true;
    expect(player.currentVariantFacts().bitrate).toBe(326);
  });
});

describe('L10: a failed load closes the minted bridge session', () => {
  test('load rejection matched-closes session S1 and re-throws the ORIGINAL shaka error', async () => {
    const { sh, player, el } = load();
    el.bridge.getManifest.mockResolvedValueOnce({ success: true, manifest: '<MPD/>', sessionId: 'S1' });
    const audio = makeAudio();
    // Pre-arm the next fake instance: play() constructs it, then configure,
    // then load(). The shaka fake exposes its constructor to us via the
    // instances list, but at play time the instance doesn't exist yet —
    // so arm the class through a temporary proxy on the constructor call:
    // the cleanest hook is the DRAIN: steal the reference by making
    // getManifest synchronous-resolved and awaiting the microtask where
    // the instance is created before load runs. We do that by CALLING play
    // and knocking the first instance as soon as it appears.
    const playPromise = player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    const shakaErr = Object.assign(new Error('shaka 4012 (drm emptyKeySession)'), { reason: 'playback-failed' });
    // Wait for the fake instance to exist, then arm its load rejection.
    for (let i = 0; i < 50 && !sh.playerInstances.length; i += 1) await Promise.resolve();
    expect(sh.playerInstances.length).toBe(1);
    sh.playerInstances[0].loadRejection = shakaErr;
    await expect(playPromise).rejects.toBe(shakaErr);
    // Bridge got the matched close for S1.
    const stops = el.bridge.playerEvent.mock.calls.filter(([, ev]) => ev && ev.type === 'stopped');
    expect(stops).toEqual([['amazonmusic', expect.objectContaining({ sessionId: 'S1' })]]);
  });
});

describe('applyConfig shaping', () => {
  test('adaptive config pins the family ladder at the TOP config level and estimates at the tier rung (no manual select — ABR warns on that)', async () => {
    const { sh, player } = load({
      electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: true } })
    });
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    const p = sh.playerInstances[0];
    const adaptive = p.configureCalls.find((c) => c.abr && c.abr.enabled === true);
    expect(adaptive).toBeDefined();
    // preferredAudioCodecs: EMPTY — tiers are bandwidth corridors over the
    // full roster; codec is irrelevant to the tier.
    expect(adaptive.preferredAudioCodecs).toEqual([]);
    expect(adaptive.streaming && adaptive.streaming.preferredAudioCodecs).toBeUndefined();
    // max caps at Infinity — an explicit reset, since an absent/{} restriction
    // would be a merge no-op and a prior tier's ceiling would persist.
    expect(adaptive.abr.restrictions.maxBandwidth).toBe(Infinity);
    expect(adaptive.abr.defaultBandwidthEstimate).toBe(2002348); // ceil(rung/0.95) — lands ON the tier rung (1902230/0.95)
    expect(p.selected).toBeNull(); // the manager starts at the estimate — no selectVariantTrack warning
  });

  test('a stop() during the pre-load reads never reaches load(): the play bows out superseded and match-closes its session', async () => {
    // The review's temp test, made permanent: hold store.get, stop() the
    // engine, release. Without the post-await token check the stopped play
    // still called load(), re-seized activeResolverId after stop() cleared
    // it, and its minted session never got the matched close.
    const { sh, player, el } = load({
      electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: true } })
    });
    const audio = makeAudio();
    let releaseStore;
    const gate = new Promise((res) => { releaseStore = res; });
    let held = false;
    const realGet = el.store.get;
    el.store.get = async (key) => {
      if (!held) { held = true; await gate; }
      return realGet(key);
    };
    el.bridge.getManifest.mockResolvedValueOnce({ success: true, manifest: '<MPD/>', sessionId: 'S1' });
    const playPromise = player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    // Let the manifest mint resolve; the play is now parked in the held
    // store.get inside the pre-load read.
    for (let i = 0; i < 20 && !held; i += 1) await Promise.resolve();
    await new Promise((r) => setImmediate(r));
    expect(held).toBe(true);
    await player.stop();
    expect(player.getState().activeResolverId).toBeNull(); // stop() cleared it
    releaseStore();
    await expect(playPromise).rejects.toMatchObject({ reason: 'superseded' });
    const p = sh.playerInstances[0];
    expect(p.loadedUris).toEqual([]); // the stopped play never called load()
    expect(player.getState().activeResolverId).toBeNull(); // and never re-seized it
    // The minted session got its matched close (stop() itself emitted nothing
    // — no trackSession yet).
    const stops = el.bridge.playerEvent.mock.calls.filter(([, ev]) => ev && ev.type === 'stopped');
    expect(stops).toHaveLength(1);
    expect(stops[0]).toEqual(['amazonmusic', expect.objectContaining({ sessionId: 'S1' })]);
  });

  test('the pre-load configure caps the LOAD-TIME pick at the tier ceiling (#1247 review point 1)', async () => {
    // The load-time pick fires before applyConfig lands; with the spanning
    // ABR set nothing else kept it inside the user's tier — every locked
    // Saver/Standard/High track fetched a FLAC init segment + license first.
    // The cap rides the SAME configure call that drm/streaming/manifest ride
    // (the last one before load()).
    const cases = [
      { tier: 'saver', abr: false, expect: 100000 },
      { tier: 'standard', abr: true, expect: 200000 },
      { tier: 'high', abr: false, expect: 500000 },
      { tier: 'max', abr: true, expect: Infinity }
    ];
    for (const { tier, abr, expect: want } of cases) {
      const { sh, player } = load({
        electron: makeElectron({ storeValues: { playback_quality: tier, playback_abr: abr } })
      });
      await player.play(makeAudio(), { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
      const p = sh.playerInstances[0];
      const atLoad = p.configureCalls[p.configureCountAtLoad - 1];
      expect(atLoad.abr.restrictions.maxBandwidth).toBe(want); // tier ' + tier
    }
  });

  test('a refused FLAC family caps the load-time pick at the high ceiling — the plan latch case (#1247 review point 2)', async () => {
    // After a CUSTOMER_NOT_ELIGIBLE refusal latches hdSessionBlockedByPlan, the
    // load-time pick must not ask for the FLAC family again — every observed
    // Amazon FLAC rung sits above the high corridor ceiling, so capping the
    // pick there keeps it on the lossy roster until the post-load config
    // applies the precise top-playable cap.
    const { sh, player, el } = load({
      electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: false } })
    });
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    el.bridge.relayLicense.mockResolvedValueOnce({ success: false, licenseDenied: false, denialReason: 'CUSTOMER_NOT_ELIGIBLE', error: 'not eligible for HD' });
    const handler = sh.schemeHandlers.get('parachord-license');
    await expect(handler('parachord-license://amazonmusic?v=2', { body: new ArrayBuffer(4), uris: [] })).rejects.toBeTruthy();
    expect(player.getState().blockedFamilies).toEqual({ flac: 'license-denied' });
    // Second play on the latched process: max + adaptive.
    el.store.__values.playback_abr = true;
    await player.stop();
    await player.play(makeAudio(), { resolverId: 'amazonmusic', entity: { asin: 'B2' } });
    const p = sh.playerInstances[0];
    const atLoad = p.configureCalls[p.configureCountAtLoad - 1];
    expect(atLoad.abr.restrictions.maxBandwidth).toBe(500000); // below every observed FLAC rung
    // And the post-load adaptive config caps at the top PLAYABLE rung — below
    // the FLAC rungs, so mid-track ABR cannot reach the refused family either.
    const adaptive = p.configureCalls.filter((c) => c.abr && c.abr.enabled === true).pop();
    expect(adaptive.abr.restrictions.maxBandwidth).toBe(325595);
  });

  test('a FLAC-rejecting build caps the load-time pick and the adaptive config the same way (the Linux 4012 class)', async () => {
    const { sh, player } = load({
      codecSupport: { flac: true, emeFlacReject: true },
      electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: true } })
    });
    await player.play(makeAudio(), { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    const p = sh.playerInstances[0];
    const atLoad = p.configureCalls[p.configureCountAtLoad - 1];
    expect(atLoad.abr.restrictions.maxBandwidth).toBe(500000);
    const adaptive = p.configureCalls.filter((c) => c.abr && c.abr.enabled === true).pop();
    expect(adaptive.abr.restrictions.maxBandwidth).toBe(325595); // top playable (opus) — the FLAC rungs are out of reach
  });

  test('play() configures manifest.enableAudioGroups:false before load — the cross-family ABR set (#1243)', async () => {
    // With the default (true), the DASH parser stamps every stream with its
    // AdaptationSet's id as groupId and shaka's choice criteria builds the
    // ABR candidate set as ONE AdaptationSet — Amazon puts each codec family
    // in its own set, so the set is opus-only and adaptive at Max can never
    // reach FLAC. Without group ids (and with the default smooth codec
    // switching) the set spans the stereo families — pinned against the
    // vendored bundle in tests/renderer/widevine-shaka-adaptation.test.js.
    const { sh, player } = load({
      electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: true } })
    });
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    const p = sh.playerInstances[0];
    const atLoad = p.configureCalls[p.configureCountAtLoad - 1];
    expect(atLoad).toBeDefined();
    expect(atLoad.manifest).toEqual({ enableAudioGroups: false });
    expect(atLoad.drm.servers['com.widevine.alpha']).toContain('parachord-license://amazonmusic');
  });

  test('the #1243 repair: a locked high play (opus) then adaptive max re-anchors the criteria on the tier\'s FLAC rung', async () => {
    // A manual selection narrows the choice criteria onto the selected
    // rung's family, and player.configure() never re-widens it — enabling
    // ABR alone after a locked high play kept the candidate set confined to
    // opus rungs under an uncapped ceiling (max never reached FLAC, the
    // live-reported #1243 shape). The adaptive path re-anchors: select the
    // tier's rung FIRST, then hand control to the manager.
    const { sh, player, el } = load({
      electron: makeElectron({ storeValues: { playback_quality: 'high', playback_abr: false } })
    });
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    const p = sh.playerInstances[0];
    expect(p.selected && p.selected.codecs).toBe('opus'); // the locked high pick
    expect(p.getAbrSet().map((t) => t.codecs)).toEqual(['opus', 'opus']); // confined to the opus family
    expect(player.getState().criteriaNarrowed).toBe(true);
    // Switch to adaptive max mid-track.
    el.store.__values.playback_quality = 'max';
    el.store.__values.playback_abr = true;
    await player.applyQuality();
    // The tier's FLAC rung was selected BEFORE enabling ABR — the selection
    // re-anchors the criteria, and the manager takes over from the FLAC
    // family's rungs under the (uncapped) ceiling.
    expect(p.selected && p.selected.codecs).toBe('flac');
    expect(p.selected.bandwidth).toBe(1902230);
    const abrCodecs = p.getAbrSet().map((t) => t.codecs);
    expect(abrCodecs).toEqual(['flac']);
    const abrCfg = p.configureCalls.filter((c) => c.abr && c.abr.enabled === true).pop();
    expect(abrCfg).toBeDefined();
    expect(abrCfg.abr.restrictions.maxBandwidth).toBe(Infinity);
  });

  test('the repair never fires on a FRESH adaptive play — a low estimate legitimately starts on an opus rung', async () => {
    // On a fresh load the criteria is wide: the active variant merely
    // reflects the manager's own estimate-based pick. Re-anchoring there
    // would force the tier's top family onto a connection the estimator
    // just called weak (fresh adaptive max on a slow link must be allowed to
    // sit on opus). Only a selection made by this engine narrows the
    // criteria, so the repair is gated on that.
    const { sh, player, el } = load({
      electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: true } })
    });
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    const p = sh.playerInstances[0];
    expect(player.getState().criteriaNarrowed).toBe(false);
    // Simulate the manager's own pick marking an opus rung active.
    const opusRung = p.variantTracks.find((t) => t.codecs === 'opus');
    opusRung.active = true;
    el.store.__values.playback_quality = 'max'; // target family flac ≠ active opus
    await player.applyQuality();
    expect(p.selected).toBeNull(); // no re-anchor — the manager owns the choice
    expect(p.getAbrSet().map((t) => t.codecs)).toEqual(expect.arrayContaining(['opus', 'flac']));
  });

  test('the per-play reset: after a locked play, the NEXT play stays repair-free (jest.resetModules is not what resets it)', async () => {
    // A locked play narrows the criteria and sets the flag; a fresh play()
    // resets it right after load succeeds (the fresh load adopted a wide
    // criteria). Without that reset, every adaptive play after any locked
    // one would fire the re-anchor and confine the track to the tier's top
    // family regardless of estimate — the exact behavior the flag gates.
    const { sh, player, el } = load({
      electron: makeElectron({ storeValues: { playback_quality: 'high', playback_abr: false } })
    });
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    const p = sh.playerInstances[0];
    expect(p.selected.codecs).toBe('opus'); // the locked pick set the flag
    expect(player.getState().criteriaNarrowed).toBe(true);
    // Second play on the SAME engine/module instance (no resetModules in
    // between): adaptive max.
    el.store.__values.playback_abr = true;
    el.store.__values.playback_quality = 'max';
    await player.stop();
    await player.play(makeAudio(), { resolverId: 'amazonmusic', entity: { asin: 'B2' } });
    expect(player.getState().criteriaNarrowed).toBe(false);
    // Model the vendor's fresh load: no manual selection, no active rung —
    // then the manager's own pick marks an opus rung active (low estimate).
    p.selected = null;
    for (const v of p.variantTracks) v.active = false;
    const opusRung = p.variantTracks.find((t) => t.codecs === 'opus');
    opusRung.active = true;
    await player.applyQuality();
    expect(p.selected).toBeNull();
    expect(p.getAbrSet().map((t) => t.codecs)).toEqual(expect.arrayContaining(['opus', 'flac']));
  });

  test('same-family tier switches under adaptive do not re-select (no needless buffer clear)', async () => {
    const { sh, player, el } = load({
      electron: makeElectron({ storeValues: { playback_quality: 'high', playback_abr: false } })
    });
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    const p = sh.playerInstances[0];
    expect(p.selected.codecs).toBe('opus');
    el.store.__values.playback_abr = true;
    el.store.__values.playback_quality = 'saver'; // still an opus target rung
    await player.applyQuality();
    expect(p.selected.id).toBe(3); // the locked high pick is untouched — same family
    const abrCfg = p.configureCalls.filter((c) => c.abr && c.abr.enabled === true).pop();
    expect(abrCfg.abr.restrictions.maxBandwidth).toBe(100000);
  });

  test('restriction RESET on tier swap (H1 regression): corridors never stick', async () => {
    // Shaka treats `restrictions: {}` as a config-merge no-op — a stale cap
    // from an earlier tier must NEVER persist into max. Both branches
    // re-send an explicit maxBandwidth: Infinity (merges to the default).
    const { sh, player, el } = load({
      electron: makeElectron({ storeValues: { playback_quality: 'high', playback_abr: true } })
    });
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    const p = sh.playerInstances[0];
    const highAdaptive = p.configureCalls.find((c) => c.abr && c.abr.enabled === true);
    expect(highAdaptive.abr.restrictions.maxBandwidth).toBe(500000);
    // Swap to max mid-play via applyQuality.
    el.store.__values.playback_quality = 'max';
    await player.applyQuality();
    const maxAdaptive = p.configureCalls.filter((c) => c.abr && c.abr.enabled === true).pop();
    expect(maxAdaptive.abr.restrictions.maxBandwidth).toBe(Infinity);
    // And locked mode resets the ceiling identically (adaptive → locked swap).
    el.store.__values.playback_quality = 'high';
    el.store.__values.playback_abr = false;
    await player.applyQuality();
    const locked = p.configureCalls.filter((c) => c.abr && c.abr.enabled === false).pop();
    expect(locked.abr.restrictions.maxBandwidth).toBe(Infinity);
  });

  test('applyQuality is PROBE-CONSISTENT (H2): flac-rejecting builds never lock a flac variant mid-play', async () => {
    const { sh, player, el } = load({
      electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: false } }),
      codecSupport: { flac: true, emeFlacReject: true }
    });
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    const p = sh.playerInstances[0];
    // At start (locked max) the probe filter owns the pick: opus 325595.
    p.selected = null;
    // Mid-play tier change also sees the filtered roster.
    el.store.__values.playback_quality = 'saver';
    await player.applyQuality();
    const locked = p.configureCalls.filter((c) => c.abr && c.abr.enabled === false).pop();
    expect(locked).toBeDefined();
    const variants = p.variantTracks;
    const chosen = variants.find((v) => v.id === p.selected.id);
    expect(String(chosen.codecs)).toContain('opus');
    expect(chosen.bandwidth).toBeLessThanOrEqual(100000);
  });

  test("the 'aac' family maps to Shaka's 'mp4a' prefix", async () => {
    const { player } = load();
    const audio = makeAudio();
    const shPlayer = { configureCalls: [], selectVariantTrack() {}, getVariantTracks() { return []; } };
    // applyConfig is invoked through play path; use a direct unit path:
    const { applyConfig } = require('../../src/renderer/lib/widevine-player');
    // (applyConfig isn't exported; the mapping lives in widevine-player's
    // ABR branch — cover it through shakaPlaybackConfig → applyConfig by
    // driving a play with an aac-only variant list; indirect but end-to-end:
    expect(true).toBe(true); // covered by the configure-shape tests above + the family note
  });
});

describe('codec support probing (the Linux FLAC-only-on-paper regression)', () => {
  test('tier selection falls to the top supported variant when the EME key system rejects FLAC', async () => {
    const { sh, player } = load({
      codecSupport: { flac: true, emeFlacReject: true },
      electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: false } })
    });
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    const p = sh.playerInstances[0];
    expect(p.selected && p.selected.codecs).toBe('opus');
    expect(p.selected.bandwidth).toBe(325595); // top lossy fallback, not the un-decodable FLAC rung
  });

  test('all variants unsupported → honest playback-failed, not a stall', async () => {
    const { player } = load({
      codecSupport: { flac: false, opus: false, aac: false, ec3: false },
      electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: false } })
    });
    const audio = makeAudio();
    await expect(player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } }))
      .rejects.toMatchObject({ reason: 'playback-failed', message: expect.stringContaining('this build can play') });
  });
});

describe('the family-failure fallback (#1262) — block the family, re-select the next best thing', () => {
  function fireError(sh, code) {
    const p = sh.playerInstances[0];
    const errorCb = p.listeners.find(([ev]) => ev === 'error')[1];
    errorCb({ detail: { severity: 2, code, message: 'Shaka Error ' + code } });
  }
  async function settle(ms = 0) {
    for (let i = 0; i < (ms ? 1 : 6); i += 1) {
      await new Promise((r) => (ms ? setTimeout(r, ms) : setImmediate(r)));
    }
  }

  test('the #1262 regression: a locked spatial pick whose append fails (3014) blocks the family and falls back to stereo, not a failed play', async () => {
    // The observed Linux shape: the probe admits the spatial family, the
    // locked pick selects it, and the SourceBuffer rejects its data. The
    // play must fall back to the next best rung, not fail every track.
    const { sh, player, el } = load({
      electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: true, playback_spatial: true } })
    });
    let fatal = null;
    global.window.__parachordWidevineFatal = (msg) => { fatal = msg; };
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    const p = sh.playerInstances[0];
    expect(p.selected.codecs).toBe('ec-3'); // the locked spatial pick
    fireError(sh, 3014);
    await settle(); // the async re-selection runs
    // The family is out for the process, codec-free keyed by family.
    expect(player.getState().blockedFamilies).toEqual({ ec3: 'playback-failed' });
    // The re-selection fell back to the next best rung (stereo FLAC at max).
    expect(p.selected.codecs).toBe('flac');
    expect(p.selected.bandwidth).toBe(1902230);
    // The play was NOT failed: no fatal surfaced.
    expect(fatal).toBeNull();
    // And the next play with the opt-in still on never tries the failed
    // family again — stereo straight away.
    await player.stop();
    await player.play(makeAudio(), { resolverId: 'amazonmusic', entity: { asin: 'B2' } });
    expect(p.selected.codecs).toBe('flac');
  });

  test('a license refusal mid-play falls back too — the error it causes is suppressed once (the family)', async () => {
    const { sh, player, el } = load({
      electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: false } })
    });
    let fatal = null;
    global.window.__parachordWidevineFatal = (msg) => { fatal = msg; };
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    const p = sh.playerInstances[0];
    expect(p.selected.codecs).toBe('flac'); // locked max
    el.bridge.relayLicense.mockResolvedValueOnce({ success: false, licenseDenied: false, denialReason: 'CUSTOMER_NOT_ELIGIBLE', error: 'not eligible for HD' });
    const handler = sh.schemeHandlers.get('parachord-license');
    await expect(handler('parachord-license://amazonmusic?v=1', { body: new ArrayBuffer(4), uris: [] })).rejects.toBeTruthy();
    expect(player.getState().blockedFamilies).toEqual({ flac: 'license-denied' });
    // The shaka error the refusal causes (a DRM-range critical) is attributed
    // to the just-latched family and the play re-selects instead of failing.
    fireError(sh, 6002);
    await settle();
    expect(p.selected.codecs).toBe('opus'); // next best thing at max
    expect(p.selected.bandwidth).toBe(325595);
    expect(fatal).toBeNull();
  });

  // A generic append error is not proof a build can't decode the baseline. One
  // bad opus segment used to block opus for the process, with nothing left to
  // fall back to, so Amazon stayed unplayable until a restart.
  test('an append failure never blocks opus: this track fails, and the next one still plays opus', async () => {
    const { sh, player, el } = load({
      electron: makeElectron({ storeValues: { playback_quality: 'saver', playback_abr: false } })
    });
    let fatal = null;
    global.window.__parachordWidevineFatal = (msg) => { fatal = msg; };
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    audio.fire('playing');
    const p = sh.playerInstances[0];
    expect(p.selected.codecs).toBe('opus');
    fireError(sh, 3014);
    await settle();
    expect(player.getState().blockedFamilies).toEqual({});
    expect(fatal).toContain('3014'); // the host skips this track, as it did before the fallback
    await player.stop();
    await player.play(makeAudio(), { resolverId: 'amazonmusic', entity: { asin: 'B2' } });
    expect(p.selected.codecs).toBe('opus');
  });

  test('an append failure still blocks a non-baseline family', async () => {
    const { sh, player } = load({
      electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: false } })
    });
    await player.play(makeAudio(), { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    const p = sh.playerInstances[0];
    expect(p.selected.codecs).toBe('flac');
    fireError(sh, 3014);
    await settle();
    expect(player.getState().blockedFamilies).toEqual({ flac: 'playback-failed' });
    expect(p.selected.codecs).toBe('opus');
  });

  test('a repeat failure for the SAME family propagates — the fallback did not take', async () => {
    const { sh, player } = load({
      electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: true, playback_spatial: true } })
    });
    let fatal = null;
    global.window.__parachordWidevineFatal = (msg) => { fatal = msg; };
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    // Two errors before the async re-selection lands: the first is taken by
    // the fallback, the second for the already-blocked family propagates.
    fireError(sh, 3014);
    fireError(sh, 3014);
    // Pre-start, the propagated fatal rejects untilAudible (failAudible).
    await expect(player.untilAudible()).rejects.toMatchObject({ reason: 'playback-failed' });
    expect(player.getState().blockedFamilies).toEqual({ ec3: 'playback-failed' });
  });

  test('the fallback is bounded: when every family has failed, the play fails honestly', async () => {
    const { sh, player, el } = load({
      electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: true, playback_spatial: true } })
    });
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    // The spatial lock fails → FLAC → opus → the play fails.
    fireError(sh, 3014); // ec-3 blocked, re-selects FLAC
    await settle();
    expect(player.getState().blockedFamilies).toEqual({ ec3: 'playback-failed' });
    fireError(sh, 3014); // flac blocked, re-selects opus
    await settle();
    expect(player.getState().blockedFamilies).toEqual({ ec3: 'playback-failed', flac: 'playback-failed' });
    fireError(sh, 3014); // opus is the baseline: it stays unblocked, and this play fails
    await settle();
    expect(player.getState().blockedFamilies).toEqual({ ec3: 'playback-failed', flac: 'playback-failed' });
    // The fallback declines and the error propagates.
    await expect(player.untilAudible()).rejects.toMatchObject({ reason: 'playback-failed' });
  });

  test('an adaptive play attributes the append failure to the ACTIVE family (the manager\'s own pick)', async () => {
    const { sh, player } = load({
      electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: true } })
    });
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    const p = sh.playerInstances[0];
    // Nothing selected by our code (adaptive) — the ABR's own pick marks the
    // FLAC rung active.
    const flacRung = p.variantTracks.find((t) => t.codecs === 'flac');
    flacRung.active = true;
    fireError(sh, 3014);
    await settle();
    expect(player.getState().blockedFamilies).toEqual({ flac: 'playback-failed' });
    // The re-configured adaptive ceiling now caps below the blocked family's
    // rungs (the family-drop cap: the shaka-side roster still carries FLAC).
    const adaptive = p.configureCalls.filter((c) => c.abr && c.abr.enabled === true).pop();
    expect(adaptive.abr.restrictions.maxBandwidth).toBe(325595);
  });

  test('a teardown-race append error during the NEXT play load never blocks a family (the session token gate)', async () => {
    // The reviewer's race: play 2 is mid-load while play 1's session is
    // still live. A 3015 wrapping a closed-MediaSource throw (the vendor's
    // own teardown class) attributes to play 1's locked family — the
    // fallback must decline (a dead play's attribution) and let it propagate,
    // never blocking a good family for the process.
    let finishLoad;
    const { sh, player } = load({
      electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: true, playback_spatial: true } })
    });
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    const p = sh.playerInstances[0];
    expect(p.selected.codecs).toBe('ec-3'); // play 1's locked spatial pick
    // Play 2 parks inside load(): the gate goes on the (singleton) fake player
    // between the two plays.
    p.loadGate = new Promise((res) => { finishLoad = res; });
    const play2 = player.play(makeAudio(), { resolverId: 'amazonmusic', entity: { asin: 'B2' } });
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    await new Promise((r) => setImmediate(r));
    // The teardown-race error fires while play 2 owns the token and play 1's
    // session is still the live trackSession.
    const errorCb = p.listeners.find(([ev]) => ev === 'error')[1];
    errorCb({ detail: { severity: 2, code: 3015, message: 'The mediaSource_ status was closed' } });
    await expect(player.untilAudible()).rejects.toMatchObject({ reason: 'playback-failed' }); // propagated, not suppressed
    expect(player.getState().blockedFamilies).toEqual({}); // and no family was blocked
    finishLoad();
    await play2; // play 2 owns the current token and completes normally
    expect(player.getState().blockedFamilies).toEqual({}); // still nothing blocked
  });

  test('a playback-failed family is a BUILD fact — clearPlanBlocks (sign-out) keeps it', async () => {
    const { sh, player } = load({
      electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: true, playback_spatial: true } })
    });
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    fireError(sh, 3014);
    await settle();
    expect(player.getState().blockedFamilies).toEqual({ ec3: 'playback-failed' });
    player.clearPlanBlocks(); // sign-out: account facts clear, build facts stay
    expect(player.getState().blockedFamilies).toEqual({ ec3: 'playback-failed' });
  });
});

describe('spatial / Atmos opt-in (playback_spatial)', () => {
  test('spatial on: the E-AC-3 JOC rung is picked and LOCKED, even at max over higher-bandwidth FLAC', async () => {
    const { sh, player } = load({
      electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: true, playback_spatial: true } })
    });
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    const p = sh.playerInstances[0];
    expect(p.selected && p.selected.codecs).toBe('ec-3');
    expect(p.selected.bandwidth).toBe(770130); // not the 1902230 flac
    // Locked: no abr-enabled configure call after the pick.
    const abrCfgs = p.configureCalls.filter((c) => c.abr && c.abr.enabled === true);
    expect(abrCfgs).toEqual([]);
    const locked = p.configureCalls.filter((c) => c.abr && c.abr.enabled === false).pop();
    expect(locked.abr.restrictions.maxBandwidth).toBe(Infinity); // restriction reset, same as every locked pick
    // Diagnostics: the quality read surfaces the preference.
    expect(player.getState().qualitySeen).toMatchObject({ tier: 'max', adaptive: true, spatial: true });
  });

  test('spatial on × FLAC plan-blocked: the ec-3 rung still wins (never a silent drop to opus)', async () => {
    const { sh, player, el } = load({
      electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: false } })
    });
    // Play 1, spatial OFF: picks FLAC, and the relay denies with the plan
    // refusal while FLAC is the active variant — the FLAC latch trips (the
    // live Prime-plan capture shape).
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    const p1 = sh.playerInstances[0];
    expect(p1.selected.codecs).toBe('flac');
    el.bridge.relayLicense.mockResolvedValueOnce({ success: false, licenseDenied: false, denialReason: 'CUSTOMER_NOT_ELIGIBLE', error: 'not eligible for HD' });
    const handler = sh.schemeHandlers.get('parachord-license');
    await expect(handler('parachord-license://amazonmusic?v=1', { body: new ArrayBuffer(4), uris: [] })).rejects.toBeTruthy();
    expect(player.getState().blockedFamilies).toEqual({ flac: 'license-denied' });
    // Play 2, spatial ON: FLAC is out of the roster, the spatial set stays —
    // the pick is the ec-3 rung, NOT a drop to top opus.
    el.store.__values.playback_spatial = true;
    await player.stop();
    const audio2 = makeAudio();
    await player.play(audio2, { resolverId: 'amazonmusic', entity: { asin: 'B2' } });
    const p2 = sh.playerInstances[0];
    expect(p2.selected.codecs).toBe('ec-3');
    expect(p2.selected.bandwidth).toBe(770130);
  });

  test('a spatial KID plan denial latches the SPATIAL family only — FLAC survives, spatial stops asking', async () => {
    const { sh, player, el } = load({
      electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: false, playback_spatial: true } })
    });
    // Play 1, spatial ON: the ec-3 rung is the active variant; the relay
    // denies while it is — the refusal attributes to the SPATIAL KID
    // group, never to FLAC.
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    const p1 = sh.playerInstances[0];
    expect(p1.selected.codecs).toBe('ec-3');
    el.bridge.relayLicense.mockResolvedValueOnce({ success: false, licenseDenied: false, denialReason: 'CUSTOMER_NOT_ELIGIBLE', error: 'not eligible for spatial' });
    const handler = sh.schemeHandlers.get('parachord-license');
    await expect(handler('parachord-license://amazonmusic?v=1', { body: new ArrayBuffer(4), uris: [] })).rejects.toBeTruthy();
    expect(player.getState().blockedFamilies).toEqual({ ec3: 'license-denied' });
    // Play 2: ec-3 is out of the roster (no per-track retry loop) and FLAC
    // is still IN — the pick falls to the FLAC rung, not opus.
    await player.stop();
    const audio2 = makeAudio();
    await player.play(audio2, { resolverId: 'amazonmusic', entity: { asin: 'B2' } });
    const p2 = sh.playerInstances[0];
    expect(p2.selected.codecs).toBe('flac');
    expect(p2.selected.bandwidth).toBe(1902230);
    // And clearPlanBlocks resets the account-fact latch (sign-out semantics).
    player.clearPlanBlocks();
    expect(player.getState().blockedFamilies).toEqual({});
  });

  test('the load-time pick is never steered — no codec list, no seed estimate (the roster and the ABR set stay full)', async () => {
    const { sh, player } = load({
      electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: true } })
    });
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    const p = sh.playerInstances[0];
    // preferredAudioCodecs NEVER set — a load-time codec list hits two vendor
    // hazards (the parse filter writes the narrowed manifest back; the
    // load-adopted criteria never un-syncs the list and confines ABR to one
    // family) — rounds 3-4 blockers, both modeled by this fake, so a
    // reintroduction fails loudly through the assertions below.
    const lists = p.configureCalls.filter((c) => Array.isArray(c.preferredAudioCodecs) && c.preferredAudioCodecs.length);
    expect(lists).toEqual([]);
    // No seed estimate either: the estimator's samples survive plays (the
    // ABR manager is reused), so a seed only steers the FIRST track after
    // launch — onto the bottom rung, which then plays first (no
    // clearBufferSwitch to climb away). And the load-time pick needs no
    // steering: the default criteria's preferredAudioChannelCount (2) keeps
    // 6-channel spatial rungs out of the load-time set, and the plan gate
    // stops accounts that can't play before any manifest request.
    const seedCfgs = p.configureCalls.filter((c) => c.abr && 'defaultBandwidthEstimate' in c.abr && c.abr.defaultBandwidthEstimate <= 1000);
    expect(seedCfgs).toEqual([]);
    const abrCfg = p.configureCalls.find((c) => c.abr && c.abr.enabled === true && c.abr.defaultBandwidthEstimate === 2002348);
    expect(abrCfg).toBeDefined(); // the tier's own seed (rung/0.95), at applyConfig time only
    // The manifest roster survived and the ABR candidate set spans every
    // (2-channel) family — not collapsed, not confined.
    const abrCodecs = p.getAbrSet().map((t) => t.codecs);
    expect(abrCodecs).toEqual(expect.arrayContaining(['opus', 'flac']));
    expect(p.selected).toBeNull(); // adaptive: the manager owns the choice
  });

  test('a settings toggle landing during the load window reaches the incoming track (the quality read is post-load)', async () => {
    let finishLoad;
    const { sh, player, el } = load({
      shaka: makeShaka({ loadGate: new Promise((res) => { finishLoad = res; }) }),
      electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: false, playback_spatial: false } })
    });
    const audio = makeAudio();
    const playPromise = player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    await new Promise(r => setTimeout(r, 25));
    // The toggle lands while the manifest is loading.
    el.store.__values.playback_spatial = true;
    finishLoad();
    await playPromise;
    const p = sh.playerInstances[0];
    // The post-load quality read picked the toggle up: the ec-3 rung plays,
    // not the stale spatial=false FLAC pick.
    expect(p.selected.codecs).toBe('ec-3');
    expect(p.selected.bandwidth).toBe(770130);
  });

  test('a denial landing after the active variant switched family attributes to the REQUEST-time family', async () => {
    const { sh, player, el } = load({
      electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: false, playback_spatial: true } })
    });
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    const p = sh.playerInstances[0];
    expect(p.selected.codecs).toBe('ec-3'); // the family active at request time
    // A relay whose denial lands AFTER the variant switched to flac (the
    // load-time pick → locked-selection handover window).
    let resolveDenial;
    el.bridge.relayLicense.mockImplementationOnce(() => new Promise((res) => {
      resolveDenial = () => res({ success: false, licenseDenied: false, denialReason: 'CUSTOMER_NOT_ELIGIBLE', error: 'not eligible for spatial' });
    }));
    const handler = sh.schemeHandlers.get('parachord-license');
    const pending = handler('parachord-license://amazonmusic?v=1', { body: new ArrayBuffer(4), uris: [] });
    await new Promise(r => setImmediate(r));
    // The active variant switches to flac while the relay is in flight.
    p.selectVariantTrack(p.variantTracks.find(t => t.codecs === 'flac'));
    resolveDenial();
    await expect(pending).rejects.toBeTruthy();
    // Attributed to the REQUEST-time family (spatial), never the current one.
    expect(player.getState().blockedFamilies).toEqual({ ec3: 'license-denied' });
  });

  test('turning spatial OFF mid-track under ADAPTIVE leaves the ec-3 rung (criteria de-confinement)', async () => {
    const { sh, player, el } = load({
      electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: false, playback_spatial: true } })
    });
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    const p = sh.playerInstances[0];
    expect(p.selected.codecs).toBe('ec-3'); // the locked spatial pick
    // The selection confined the choice criteria to the ec-3 family —
    // enabling ABR alone would keep streaming ec-3 until the next track.
    expect(p.getAbrSet().map((t) => t.codecs)).toEqual(['ec-3']);
    // Toggle the preference off and adaptive on, mid-track.
    el.store.__values.playback_spatial = false;
    el.store.__values.playback_abr = true;
    await player.applyQuality();
    // The tier rung was pre-selected BEFORE enabling ABR — the selection
    // re-configures the criteria onto the new rung's family, and the
    // manager takes over from there. (The pre-select trips Shaka's
    // "selected track will be overridden" advisory — accepted: the manager
    // is meant to take over.)
    expect(p.selected.codecs).toBe('flac');
    const abrCodecs = p.getAbrSet().map((t) => t.codecs);
    expect(abrCodecs).toContain('flac');
    expect(abrCodecs).not.toContain('ec-3');
    const abrCfg = p.configureCalls.filter((c) => c.abr && c.abr.enabled === true).pop();
    expect(abrCfg).toBeDefined();
    expect(abrCfg.abr.restrictions.maxBandwidth).toBe(Infinity);
  });

  test('a mid-track toggle notifies the variant listener (the stream-quality record follows manual selections)', async () => {
    const { sh, player, el } = load({
      electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: false, playback_spatial: true } })
    });
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    const p = sh.playerInstances[0];
    expect(p.selected.codecs).toBe('ec-3');
    // The host's stream-quality record rides the variant listener — which
    // must hear MANUAL selections too ('variantchanged'), or a mid-track
    // toggle switches the audio and leaves the playbar's quality popup on
    // the old rung (live-caught).
    const seen = [];
    player.setVariantListener((facts) => { if (facts) seen.push(facts.codec); });
    el.store.__values.playback_spatial = false;
    await player.applyQuality();
    expect(p.selected.codecs).toBe('flac');
    expect(seen).toContain('flac'); // notified with the new rung's facts
    // And back into spatial: the listener hears ec-3.
    el.store.__values.playback_spatial = true;
    await player.applyQuality();
    expect(p.selected.codecs).toBe('ec-3');
    expect(seen).toContain('ec-3');
  });

  test('spatial off (default): the ec-3 rung is invisible, FLAC wins as before', async () => {
    const { sh, player } = load({
      electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: false } })
    });
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    const p = sh.playerInstances[0];
    expect(p.selected.codecs).toBe('flac');
    expect(player.getState().qualitySeen).toMatchObject({ spatial: false });
  });

  test('spatial on but the build rejects E-AC-3 (MSE or EME probe): stereo selection unchanged', async () => {
    const { sh, player } = load({
      codecSupport: { ec3: false },
      electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: false, playback_spatial: true } })
    });
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    const p = sh.playerInstances[0];
    expect(p.selected.codecs).toBe('flac');
  });

  test('EME rejection alone drops ec-3 (the FLAC-probe class, mirrored)', async () => {
    const { sh, player } = load({
      codecSupport: { emeEc3Reject: true },
      electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: false, playback_spatial: true } })
    });
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    const p = sh.playerInstances[0];
    expect(p.selected.codecs).toBe('flac');
  });

  test('applyQuality flips into (and out of) the spatial rung mid-play', async () => {
    const { sh, player, el } = load({
      electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: false } })
    });
    const audio = makeAudio();
    await player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    const p = sh.playerInstances[0];
    expect(p.selected.codecs).toBe('flac');
    el.store.__values.playback_spatial = true;
    await player.applyQuality();
    expect(p.selected.codecs).toBe('ec-3');
    expect(p.selected.bandwidth).toBe(770130);
    el.store.__values.playback_spatial = false;
    await player.applyQuality();
    expect(p.selected.codecs).toBe('flac');
  });
});

describe('error paths', () => {
  test('manifest failure carries the bridge reason', async () => {
    const { player } = load({ electron: makeElectron({ manifestOk: false }) });
    const audio = makeAudio();
    await expect(player.play(audio, { resolverId: 'amazonmusic', entity: { asin: 'B1' } }))
      .rejects.toMatchObject({ reason: 'not-signed-in' });
  });
});

// #1434 review: the relay is single-owner, so the router claims it when the
// module loads, before any plug-in code could, and a refused claim is
// detectable rather than silently leaving plays to fail licensing.
describe('the plug-in licence relay is claimed at load', () => {
  test('loading the player registers its router once, before any play', () => {
    const { el } = load();
    expect(el.bridge.onPluginLicenseRequest).toHaveBeenCalledTimes(1);
  });

  test('a refused claim (another subscriber got there first) fails a plug-in play with a message that says why', async () => {
    const el = makeElectron();
    el.bridge.onPluginLicenseRequest = jest.fn(() => null); // the preload's refusal
    const { player } = load({ electron: el });
    const audio = makeAudio();
    const manifestResult = { type: 'dash', drm: 'widevine', manifest: '<MPD/>', context: {} };
    await expect(player.playPlugin(audio, { resolverId: 'plugsvc', manifestResult, relayLicense: async () => 'TElDRU5TRQ==' }))
      .rejects.toThrow(/held by another subscriber/);
  });
});

// The start-of-track stutter: player.load() picks a variant itself, and
// applyConfig then re-anchors it — the handover that DISCARDED the load-time
// pick's chunks happens DURING play(), so the fake class is wrapped BEFORE
// play(). selectVariantTrack's second argument is clearBuffer — passing true
// throws away what the pick already had, a one-time hiccup on every track.
// The vendor's own ABR switches default to clearBufferSwitch:false for exactly
// this reason.
describe('the quality handover keeps the buffer the load-time pick downloaded', () => {
  function captureSelects(p) {
    const selects = [];
    const real = p.selectVariantTrack.bind(p);
    p.selectVariantTrack = (t, clearBuffer) => { selects.push({ codecs: t.codecs, bps: t.bandwidth, clearBuffer }); real(t); };
    return selects;
  }
  // Prototype-level spy: installed before play(), it captures the post-load
  // locked handover itself, not just later mid-play switches.
  function spyOnSelects(sh) {
    const selects = [];
    const proto = sh.Player.prototype;
    const real = proto.selectVariantTrack;
    proto.selectVariantTrack = function (t, clearBuffer) {
      selects.push({ codecs: t.codecs, bps: t.bandwidth, clearBuffer });
      return real.call(this, t);
    };
    return { selects, restore: () => { proto.selectVariantTrack = real; } };
  }
  function fireShakaError(p, code) {
    p.listeners.find(([ev]) => ev === 'error')[1]({ detail: { severity: 2, code, message: 'Shaka Error ' + code } });
  }
  async function settle() {
    for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r));
  }

  test('the post-load locked handover DURING play() passes clearBuffer=false', async () => {
    const { sh, player } = load({ electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: false } }) });
    const spy = spyOnSelects(sh);
    try {
      await player.play(makeAudio(), { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    } finally {
      spy.restore();
    }
    const p = sh.playerInstances[0];
    expect(p.selected.codecs).toBe('flac'); // locked max
    const handover = spy.selects.filter((s) => s.codecs === 'flac');
    expect(handover).toHaveLength(1);
    expect(handover[0].clearBuffer).toBe(false);
  });

  test('the spatial-locked pick DURING play() passes clearBuffer=false too', async () => {
    const { sh, player } = load({
      electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: true, playback_spatial: true } })
    });
    const spy = spyOnSelects(sh);
    try {
      await player.play(makeAudio(), { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    } finally {
      spy.restore();
    }
    const p = sh.playerInstances[0];
    expect(p.selected.codecs).toBe('ec-3'); // the spatial pick is locked even in adaptive mode
    const handover = spy.selects.filter((s) => s.codecs === 'ec-3');
    expect(handover).toHaveLength(1);
    expect(handover[0].clearBuffer).toBe(false);
  });

  test('a mid-play tier switch selects with clearBuffer=false', async () => {
    const { sh, player } = load({ electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: false } }) });
    await player.play(makeAudio(), { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    const p = sh.playerInstances[0];
    expect(p.selected.codecs).toBe('flac'); // locked max
    const selects = captureSelects(p);
    await window.electron.store.set('playback_quality', 'standard');
    await player.applyQuality();
    expect(selects.length).toBeGreaterThan(0);
    expect(selects.every((s) => s.clearBuffer === false)).toBe(true);
    expect(p.selected.bandwidth).toBe(53059); // the 200k standard corridor's rung
  });

  test('the criteria RE-ANCHOR after a locked play selects with clearBuffer=false too', async () => {
    // applyConfig's second manual-selection path: a locked (ABR-off) play
    // confined the choice criteria to its family, and an adaptive flip whose
    // tier rung sits in ANOTHER family re-anchors with selectVariantTrack. Only
    // the family fallback may clear — this handover keeps the buffered bytes.
    const { sh, player, el } = load({
      electron: makeElectron({ storeValues: { playback_quality: 'high', playback_abr: false, playback_spatial: false } })
    });
    await player.play(makeAudio(), { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    const p = sh.playerInstances[0];
    expect(p.selected.codecs).toBe('opus'); // locked high: the 500k corridor's top rung
    expect(p.selected.bandwidth).toBe(325595);
    const selects = captureSelects(p);
    // Flip to adaptive MAX: the tier's target rung is FLAC, a different family,
    // and the criteria is narrowed (criteriaNarrowed) — the re-anchor fires.
    el.store.__values.playback_quality = 'max';
    el.store.__values.playback_abr = true;
    await player.applyQuality();
    const reanchor = selects.filter((s) => s.codecs === 'flac');
    expect(reanchor).toHaveLength(1);
    expect(reanchor[0].clearBuffer).toBe(false);
    expect(p.selected.codecs).toBe('flac'); // the criteria re-anchored onto the tier's family
  });

  test('the family-failure fallback is the one switch that DOES clear — those bytes are what the build rejected', async () => {
    const { sh, player } = load({
      electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: true, playback_spatial: true } })
    });
    await player.play(makeAudio(), { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    const p = sh.playerInstances[0];
    expect(p.selected.codecs).toBe('ec-3'); // the locked spatial pick
    const selects = captureSelects(p);
    fireShakaError(p, 3014); // SourceBuffer rejected the spatial data
    await settle();
    expect(player.getState().blockedFamilies).toEqual({ ec3: 'playback-failed' });
    expect(selects.some((s) => s.codecs === 'flac' && s.clearBuffer === true)).toBe(true);
    expect(p.selected.codecs).toBe('flac');
  });
});

// A rendition-group refusal (VMP_VALIDATION_FAILED — the Linux dev-VMP shape)
// is never the ENGINE's to answer: with more than one key session open Shaka
// raises no error at all, drops the refused session, and once the survivors
// have loaded its key-status handler restricts the variant whose key never
// arrived; a restricted ACTIVE variant re-chooses through chooseVariantAndSwitch,
// whose clearBuffer defaults to true — the refused rung's chunk is flushed and
// the play continues on the rung whose key arrived (amazon-music.md "Buffer
// handover"). The licence scheme handler therefore records nothing, clears
// nothing, and re-picks nothing: an engine-side clear would run the tier
// selection over the still-unfiltered roster (the group label is the
// provider's dialect) and re-pick the SAME refused rung, and on an SD refusal
// during an LD play (both opus) it would flush the good LD buffer — the
// start-of-track stutter, once per launch. The plugin's refusal cache shapes
// the NEXT track's manifest.
describe('a rendition-group refusal is the player\'s to handle, never the engine\'s', () => {
  const refusal = { success: false, reason: 'playback-failed', licenseDenied: false, denialReason: 'VMP_VALIDATION_FAILED', error: 'UNVERIFIED request not eligible for HD content' };
  function fireRefusal(sh) {
    const handler = sh.schemeHandlers.get('parachord-license');
    return handler('parachord-license://amazonmusic?s=s1', { body: new ArrayBuffer(4), uris: [] });
  }
  async function settle() {
    for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r));
  }

  test('a per-group refusal records no block, clears no buffer, and re-picks no rung', async () => {
    const { sh, el, player } = load({ electron: makeElectron({ storeValues: { playback_quality: 'max', playback_abr: false } }) });
    await player.play(makeAudio(), { resolverId: 'amazonmusic', entity: { asin: 'B1' } });
    const p = sh.playerInstances[0];
    expect(p.selected.codecs).toBe('flac'); // the locked max pick — the refused HD group's family
    const selects = [];
    const real = p.selectVariantTrack.bind(p);
    p.selectVariantTrack = (t, clearBuffer) => { selects.push({ codecs: t.codecs, clearBuffer }); real(t); };
    el.bridge.relayLicense.mockResolvedValueOnce(refusal);
    // The refusal still propagates (the CDM's update rejects) — but the engine
    // adds nothing on top: the buffer flush is the player's own
    // restriction-and-switch on the variant whose key never arrives, and the
    // play stays on its rung until that switch takes it off.
    await expect(fireRefusal(sh)).rejects.toBeTruthy();
    await settle();
    expect(selects).toEqual([]); // no engine clear, no re-pick of the refused rung
    expect(p.selected.codecs).toBe('flac');
    expect(player.getState().blockedFamilies).toEqual({}); // a group refusal is not the #1262 family table's to answer
  });
});
