// widevine-player.js — the shared Widevine playback engine for the renderer.
//
// One Shaka Player bound to the shared HTMLAudioElement (the same element
// local files, SoundCloud and html5Stream resolvers share). Per-resolver
// differences stop at the widevine bridge: getManifest (entity → DASH MPD
// text) and relayLicense (CDM challenge bytes ↔ license bytes) are IPC
// handled by main-process providers (amazon-dmls today). Variant selection
// obeys the GLOBAL playback-quality setting ('playback_quality' /
// 'playback_abr' store keys) through lib/widevine-quality.js — no resolver
// gets its own quality vocabulary.
//
// Lifecycle:
//   widevine-player.play(audio, { resolverId, entity })
//      → bridge manifest → Shaka load → quality config → caller .play()s
//   widevine-player.applyQuality()         live re-select after a setting change
//   widevine-player.stop()                 unload; restore the element for plain URLs
//   widevine-player.currentVariantFacts()  stream-quality record fields
//
// Shaka is a window global (script tag in index.html). The license relay
// rides Shaka's static scheme registry: drm.servers for the loaded track
// points at parachord-license://<resolverId>, the scheme handler forwards
// the CDM's challenge bytes to main and returns the license bytes untouched
// — the renderer never parses DRM wire formats.

'use strict';

const { shakaPlaybackConfig } = require('./widevine-quality');

const QUALITY_STORE_KEY = 'playback_quality';
const ABR_STORE_KEY = 'playback_abr';
const DEFAULT_QUALITY = 'max';
const DEFAULT_ABR = true;

let player = null;
let audioElement = null;
let activeResolverId = null;
let lastError = null;
let variantListener = null;
let lastQualityRead = null; // debug: the tier/adaptive seen by the last play/applyQuality
let trackSession = null; // { resolverId, entity, trackContext, started }
let loadStartStamp = 0;
let playToken = 0; // per-call token: a superseded play must never reach the element
let lastErrorDetail = null;
const recentErrors = [];

function supersededError() {
  const err = new Error('widevine: play superseded');
  err.reason = 'superseded';
  return err;
}

// Player lifecycle events to main (provider-owned telemetry; non-blocking).
function emitPlayerEvent(type, payload) {
  if (!trackSession || !window.electron || !window.electron.widevine) return;
  try {
    // sessionId matches the event to its license session — the bridge only
    // closes on a MATCH, so a late 'stopped' from an older play can't take
    // the newer play's relays down with it.
    void window.electron.widevine.playerEvent(trackSession.resolverId, { type, sessionId: trackSession.sessionId, ...payload });
  } catch { /* telemetry must never reach playback */ }
}

let elementEventsBound = false;
function bindElementEvents(audio) {
  if (elementEventsBound || !audio || typeof audio.addEventListener !== 'function') return;
  elementEventsBound = true;
  audio.addEventListener('seeking', () => emitPlayerEvent('seek', { positionMs: Math.round((audio.currentTime || 0) * 1000) }));
  audio.addEventListener('pause', () => {
    if (audio.ended) return; // 'ended' carries its own boundary
    emitPlayerEvent('pause', { positionMs: Math.round((audio.currentTime || 0) * 1000) });
  });
  audio.addEventListener('playing', () => {
    if (!trackSession) return;
    if (trackSession.started) {
      emitPlayerEvent('resume', { positionMs: Math.round((audio.currentTime || 0) * 1000) });
      return;
    }
    trackSession.started = true;
    const delay = loadStartStamp ? Math.max(0, (performance.now() - loadStartStamp) / 1000) : null;
    const facts = currentVariantFacts();
    emitPlayerEvent('play-started', {
      asin: trackSession.entity && trackSession.entity.asin,
      albumAsin: trackSession.trackContext && trackSession.trackContext.albumAsin,
      durationMs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : (trackSession.trackContext && trackSession.trackContext.durationMs) || null,
      initialDelaySeconds: delay != null ? Number(delay.toFixed(3)) : undefined,
      variantFacts: facts && facts.bitrate ? {
        codec: facts.codec, sampleRate: facts.sampleRate, channels: facts.channels, bandwidth: facts.bitrate
      } : null,
      cdnType: trackSession.cdnType || null
    });
  });
  audio.addEventListener('ended', () => {
    emitPlayerEvent('ended', { positionMs: Math.round((audio.currentTime || 0) * 1000), durationMs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : null });
    if (trackSession) trackSession.started = false;
  });
}

// ABR switches (and our own locked selections) fire Shaka's 'adaptation'
// event; the host's stream-quality record follows the ACTIVE rendition.
function setVariantListener(cb) {
  variantListener = typeof cb === 'function' ? cb : null;
}
function notifyVariantChange() {
  if (!variantListener) return;
  try { variantListener(currentVariantFacts()); } catch { /* listener owns nothing */ }
}

const b64 = (buf) => {
  let s = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(s);
};
const unb64 = (str) => {
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
};

function ensureLicenseScheme() {
  const shaka = window.shaka;
  if (!shaka || ensureLicenseScheme.done) return ensureLicenseScheme.done === true;
  shaka.polyfill.installAll();
  shaka.net.NetworkingEngine.registerScheme('parachord-license', async (uri, request) => {
    const url = new URL(uri);
    const resolverId = url.host;
    const sessionId = url.searchParams.get('s');
    const result = await window.electron.widevine.relayLicense(resolverId, b64(request.body), sessionId);
    if (!result || result.success !== true) {
      const err = new Error((result && result.error) || 'license relay failed');
      if (result && result.licenseDenied) err.licenseDenied = true;
      throw err;
    }
    return { uri, data: unb64(result.license), headers: {}, originalRequest: request };
  });
  ensureLicenseScheme.done = true;
  return true;
}

// Codec support differs per build AND per protection tier: some builds
// decode a codec but their Widevine key system refuses playback conditions
// for its higher rungs (output-restriction / robustness gates — the FLAC
// tier fails shaka 4012 (RESTRICTIONS_CANNOT_BE_MET) there even though
// MediaSource is fine everywhere. Hornet-era Linux never played FLAC for the
// same underlying reason). Probe both layers once per process.
let supportedCodecFamilies = null;
async function getSupportedCodecFamilies() {
  if (supportedCodecFamilies) return supportedCodecFamilies;
  const is = (t) => {
    try { return !!(window.MediaSource && window.MediaSource.isTypeSupported && window.MediaSource.isTypeSupported(t)); } catch { return false; }
  };
  const codecTypes = {
    flac: is('audio/mp4; codecs="flac"'),
    opus: is('audio/mp4; codecs="opus"'),
    aac: is('audio/mp4; codecs="mp4a.40.2"')
  };
  const emeFamilies = { ...codecTypes };
  // Deeper EME probe: FLAC's premium tier typically carries stronger
  // output-protection requirements; when the key system rejects the AUDIO
  // robustness conditions that tier needs, treat the family as unsupported on
  // this build entirely rather than stalling at its first segment. (A failed
  // requestMediaKeySystemAccess = the CDM won't accept even basic playback
  // for that codec — treat unsupported.)
  if (codecTypes.flac) {
    try {
      const nav = (typeof window !== 'undefined' && window.navigator) || (typeof navigator !== 'undefined' && navigator);
      // Minimal probe only — matches what Shaka's own setup asks. Anything
      // stricter (distinctiveIdentifier/robustness attributes) yields false
      // negatives on perfectly working L3 CDMs (observed on macOS, mac-build
      // FLAC regression reverted by this).
      const access = await nav.requestMediaKeySystemAccess('com.widevine.alpha', [{
        initDataTypes: ['cenc'],
        audioCapabilities: [{ contentType: 'audio/mp4; codecs="flac"' }]
      }]);
      if (!access) emeFamilies.flac = false;
    } catch (e) {
      console.log('[widevine-player] flac key-system probe rejected:', String(e && e.name || e), e && e.message);
      emeFamilies.flac = false;
    }
  }
  supportedCodecFamilies = emeFamilies;
  const rejected = Object.entries(supportedCodecFamilies).filter(([, ok]) => !ok).map(([k]) => k);
  if (rejected.length) console.log('[widevine-player] codec support:', JSON.stringify(supportedCodecFamilies), `(selecting only supported; ${rejected.join(',')} filtered out)`);
  return supportedCodecFamilies;
}

async function readPlaybackQuality() {
  let tier = DEFAULT_QUALITY;
  let adaptive = DEFAULT_ABR;
  try {
    const [q, a] = await Promise.all([
      window.electron.store.get(QUALITY_STORE_KEY),
      window.electron.store.get(ABR_STORE_KEY)
    ]);
    if (typeof q === 'string' && q) tier = q;
    if (typeof a === 'boolean') adaptive = a;
  } catch { /* defaults */ }
  lastQualityRead = { tier, adaptive };
  return { tier, adaptive };
}

function applyConfig(config) {
  if (!player || !config) return;
  if (config.abrEnabled) {
    const restrictions = {};
    if (config.maxBandwidth) restrictions.maxBandwidth = config.maxBandwidth;
    // ABR is family-scoped (see shakaPlaybackConfig's codecFamily note):
    // pin the ladder to the tier's codec family (preferredAudioCodecs is a
    // TOP-LEVEL config key — nesting it under streaming is an unrecognized-
    // key warning and the pin silently dies) and let the network roam within
    // it. Instead of selectVariantTrack (which trips Shaka's "selected track
    // will be overridden" advisory when ABR is enabled), the manager starts
    // at the tier's rung via defaultBandwidthEstimate and roams ≤ ceiling.
    player.configure({
      // Shaka's preferredAudioCodecs expects codec PREFIXES ('mp4a' not 'aac').
      preferredAudioCodecs: config.codecFamily ? [config.codecFamily === 'aac' ? 'mp4a' : config.codecFamily] : [],
      abr: { enabled: true, restrictions, defaultBandwidthEstimate: config.variantBandwidth || undefined }
    });
    return;
  }
  // Top-level key here too (see the adaptive branch — nested it warns and no-ops).
  player.configure({ abr: { enabled: false }, preferredAudioCodecs: [] });
  if (config.variantBandwidth == null) return;
  let best = null;
  for (const t of (player.getVariantTracks() || [])) {
    if (!best || Math.abs((t.bandwidth || 0) - config.variantBandwidth) < Math.abs((best.bandwidth || 0) - config.variantBandwidth)) best = t;
  }
  if (best) {
    try { player.selectVariantTrack(best, true); } catch { /* selection is best-effort */ }
  }
}

// Facts for the stream-quality record (the poller-contract shape, renderer side):
// what Shaka is ACTUALLY streaming right now.
function currentVariantFacts() {
  if (!player || !activeResolverId) return null;
  try {
    const active = (player.getVariantTracks() || []).find((t) => t.active);
    if (!active) return null;
    const facts = { origin: 'measured' };
    // The record's bitrate is kbps (hornet-era schema): formatStreamQuality
    // renders `${bitrate} kbps`. Raw bandwidth is bps.
    if (active.bandwidth) facts.bitrate = Math.round(active.bandwidth / 1000);
    if (active.codecs) facts.codec = String(active.codecs).split('.')[0];
    if (active.audioSamplingRate) facts.sampleRate = active.audioSamplingRate;
    if (active.channelsCount != null) facts.channels = active.channelsCount;
    return facts;
  } catch {
    return null;
  }
}

// Variants the current build can ACTUALLY decode: filters the manifest's
// list through getSupportedCodecFamilies before tier selection runs.
function playableVariants(tracks) {
  // Callers: await getSupportedCodecFamilies() once before selection.
  const support = supportedCodecFamilies || { flac: true, opus: true, aac: true };
  return (tracks || []).filter((t) => {
    const c = String(t && (t.codecs || t.codec) || '').toLowerCase();
    if (c.startsWith('flac')) return support.flac;
    if (c.startsWith('opus')) return support.opus;
    if (c.startsWith('mp4a') || c.startsWith('aac')) return support.aac;
    return false;
  });
}

async function play(audio, { resolverId, entity, trackContext } = {}) {
  if (!audio || !resolverId) throw new Error('widevine-player: audio element and resolverId are required');
  if (!ensureLicenseScheme()) throw new Error('widevine-player: shaka did not load (index.html script tag)');
  if (!window.electron || !window.electron.widevine) throw new Error('widevine-player: bridge missing (preload)');

  const mine = ++playToken;
  lastError = null;
  loadStartStamp = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
  const result = await window.electron.widevine.getManifest(resolverId, entity || {});
  if (!result || result.success !== true) {
    const err = new Error((result && result.error) || 'manifest fetch failed');
    err.reason = (result && result.reason) || 'playback-failed';
    throw err;
  }
  // The mint can take seconds — a newer play may have started meanwhile.
  if (playToken !== mine) throw supersededError();

  const shaka = window.shaka;
  if (!player) {
    player = new shaka.Player();
    player.addEventListener('adaptation', () => notifyVariantChange());
    player.addEventListener('error', (e) => {
      const d = (e && e.detail) || {};
      lastError = ('shaka ' + (d.code !== undefined ? d.code : (e && e.message) || 'error')).slice(0, 240);
      // Diagnostics that travel: the code alone buries the segment URL / inner
      // error every platform-00-shaped 4012 investigation needs.
      const active = currentVariantFacts();
      const activeFamily = active && active.codec ? String(active.codec).split('.')[0].toLowerCase() : null;
      const kidForActive = trackSession && trackSession.kidGroupsByFamily && activeFamily
        ? trackSession.kidGroupsByFamily[activeFamily.startsWith('mp4a') || activeFamily.startsWith('aac') ? 'aac' : activeFamily] || null
        : null;
      lastErrorDetail = {
        kidForActiveVariant: trackSession && trackSession.kidGroupsByFamily && kidForActive ? kidForActive : null,
        kidGroups: trackSession && trackSession.kidGroupsByFamily ? { ...trackSession.kidGroupsByFamily } : null,
        code: d.code ?? null,
        category: d.category ?? null,
        severity: d.severity ?? null,
        message: String((d.message || '')).slice(0, 240),
        data: (() => { try { return JSON.stringify(d.data || null).slice(0, 400); } catch { return null; } })(),
        at: Date.now(),
        positionMs: audioElement && Number.isFinite(audioElement.currentTime) ? Math.round(audioElement.currentTime * 1000) : null
      };
      recentErrors.push(lastErrorDetail);
      if (recentErrors.length > 20) recentErrors.shift();
      if (typeof window.__parachordWidevineError === 'function') window.__parachordWidevineError(lastError, activeResolverId);
    });
  }
  if (audioElement !== audio) {
    if (audioElement && player) await player.detach();
    await player.attach(audio);
    audioElement = audio;
  }
  await player.unload();
  // The license session id from widevine:manifest rides the server URI; the
  // bridge validates it and caps relays per session (relay-gating rules).
  const licenseServerUri = `parachord-license://${resolverId}${result.sessionId ? `?s=${encodeURIComponent(result.sessionId)}` : ''}`;
  player.configure({
    drm: { servers: { 'com.widevine.alpha': licenseServerUri } },
    streaming: { rebufferingGoal: 2, bufferingGoal: 10 }
  });
  activeResolverId = resolverId;

  // Blob URL, not a data: URI — manifests can exceed Chromium's ~2MB URL cap.
  const blob = new Blob([result.manifest], { type: 'application/dash+xml' });
  const uri = URL.createObjectURL(blob);
  try {
    await player.load(uri);
  } finally {
    URL.revokeObjectURL(uri);
  }
  if (playToken !== mine) throw supersededError();
  bindElementEvents(audio);
  const kidGroupsByFamily = {};
  for (const group of (result.protectionSets || [])) {
    if (group && group.kid) kidGroupsByFamily[group.family || 'unknown'] = group.kid;
  }
  trackSession = {
    resolverId,
    sessionId: result.sessionId || null,
    kidGroupsByFamily,
    // Telemetry/stats attribute the SERVED pressing: Amazon's substitution
    // maps a catalog ASIN to a deliverable one (identical track, different id).
    entity: { ...(entity || {}), ...(result.substituteAsin ? { asin: result.substituteAsin, requestedAsin: entity && entity.asin } : {}) },
    trackContext: trackContext || {},
    cdnType: result.cdnType || null,
    started: false
  };

  const { tier, adaptive } = await readPlaybackQuality();
  await getSupportedCodecFamilies();
  // Tier selection runs over what this build can decode (e.g. FLAC-only-on-
  // paper builds fall to top opus instead of stalling at an un-decodable
  // variant).
  const config = shakaPlaybackConfig(playableVariants(player.getVariantTracks()), tier, adaptive);
  if (!config) {
    await player.unload();
    const err = new Error('manifest carried no audio variant this build can play');
    err.reason = 'playback-failed';
    throw err;
  }
  applyConfig(config);
  // The token lets callers make teardown CONDITIONAL on not having moved on
  // (review: a stale stop() after the generation advanced must not cancel the
  // newer play or close the newer license session).
  return { substituteAsin: result.substituteAsin || null, resolverId, token: mine };
}

// Live re-apply of the global quality setting against the active manifest.
async function applyQuality() {
  if (!player || !activeResolverId) return;
  const { tier, adaptive } = await readPlaybackQuality();
  const config = shakaPlaybackConfig(player.getVariantTracks(), tier, adaptive);
  if (config) applyConfig(config);
}

async function stop({ token } = {}) {
  // Token-conditional teardown: refuse to cancel a play that's newer than the
  // caller's. Without a token, stop whatever is playing (explicit teardowns).
  if (typeof token === 'number' && token !== playToken) return { stopped: false, reason: 'stale-teardown' };
  playToken += 1; // every stop invalidates all in-flight plays
  const hadTrack = !!trackSession;
  emitPlayerEvent('stopped', {
    positionMs: audioElement && Number.isFinite(audioElement.currentTime) ? Math.round(audioElement.currentTime * 1000) : 0
  });
  trackSession = null;
  activeResolverId = null;
  lastError = null;
  if (player) {
    try { await player.unload(); } catch { /* already unloaded */ }
  }
  // Only pause when the engine was the element's owner — a later html5/local
  // track that already claimed it must not be interrupted.
  if (audioElement && hadTrack) {
    try { audioElement.pause(); } catch { /* element tolerance */ }
  }
}

function getState() {
  let shaka = null;
  try {
    if (player) {
      const cfg = player.getConfiguration ? player.getConfiguration() : null;
      const tracks = player.getVariantTracks ? player.getVariantTracks() : [];
      shaka = {
        abrEnabled: cfg && cfg.abr && cfg.abr.enabled,
        preferredAudioCodecs: cfg && cfg.preferredAudioCodecs,
        restrictions: cfg && cfg.abr && cfg.abr.restrictions,
        bandwidthEstimate: player.getBandwidthEstimate ? player.getBandwidthEstimate() : null,
        variants: tracks.length,
        activeIds: tracks.filter((t) => t.active).map((t) => t.id),
        playableBandwidths: tracks.map((t) => t.bandwidth).sort((a, b) => a - b).filter((v, i, arr) => arr.indexOf(v) === i)
      };
    }
  } catch { /* debug only */ }
  return {
    activeResolverId,
    lastError,
    lastErrorDetail,
    recentErrors: recentErrors.slice(),
    attached: !!audioElement,
    positionMs: audioElement && Number.isFinite(audioElement.currentTime) ? Math.round(audioElement.currentTime * 1000) : null,
    durationMs: audioElement && Number.isFinite(audioElement.duration) ? Math.round(audioElement.duration * 1000) : null,
    paused: audioElement ? audioElement.paused : null,
    ended: audioElement ? audioElement.ended : null,
    errorCode: audioElement && audioElement.error ? audioElement.error.code : null,
    variantFacts: currentVariantFacts(),
    qualitySeen: lastQualityRead,
    shaka
  };
}

const api = { play, applyQuality, stop, getState, currentVariantFacts, setVariantListener, QUALITY_STORE_KEY, ABR_STORE_KEY };
module.exports = api;
