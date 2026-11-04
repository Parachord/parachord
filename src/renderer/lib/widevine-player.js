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
const SPATIAL_STORE_KEY = 'playback_spatial';
const DEFAULT_QUALITY = 'max';
const DEFAULT_ABR = true;
const DEFAULT_SPATIAL = false;

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
    resolveAudible();
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
    // Snapshot BEFORE the await: a license round-trip can outlive a variant
    // switch (the load-time pick handing over to our locked selection), and a
    // plan refusal must be attributed to the family whose group was ASKED
    // FOR, not whichever variant is active when the denial lands.
    const factsAtRequest = currentVariantFacts();
    const result = await window.electron.widevine.relayLicense(resolverId, b64(request.body), sessionId);
    if (!result || result.success !== true) {
      const err = new Error((result && result.error) || 'license relay failed');
      if (result && result.licenseDenied) err.licenseDenied = true;
      // Eligibility refusals (CUSTOMER_NOT_ELIGIBLE — live-verified on a
      // Prime plan for the HD KID group, and the same refusal shape applies
      // to the spatial ec-3 KID group) are process-level facts: stop asking
      // for the refused family. Which group was refused is read off the
      // variant that was active WHEN THE REQUEST FIRED — the CDM asks for
      // the selected variant's group, and the challenge bytes are opaque.
      // The current play survives on the other KID groups unless the refused
      // group was the locked selection's own family (a locked spatial pick
      // whose KID is refused fails this play — the lossy and HD FLAC groups
      // keep playing); the NEXT selection drops the refused rungs.
      if (result && HD_CONTENT_DENIAL_STATUSES.has(result.denialReason)) {
        const activeCodec = factsAtRequest && factsAtRequest.codec ? String(factsAtRequest.codec).toLowerCase() : null;
        if (activeCodec === 'ec-3') spatialBlockedByPlan = true;
        else hdSessionBlockedByPlan = true;
      }
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
// Plan-level latches set once Amazon answers a license relay with an
// eligibility denial (CUSTOMER_NOT_ELIGIBLE — the Prime-plan capture): the
// refused KID group's family stops being asked for the whole account
// session (the refusal would otherwise repeat per track). Which group was
// refused is read off the variant active WHEN THE LICENSE REQUEST FIRED (a
// snapshot taken before the relay await — the round-trip can outlive a
// variant switch, so denial-time state may name the wrong family); the CDM
// asks for the selected variant's group; the challenge bytes are opaque.
// FLAC keeps the legacy unconditional latch; the spatial group (the ec-3
// KID set) latches its own flag so a spatial refusal drops the ec-3 rungs
// instead of wrongly taking FLAC down with it. Process-level, matching the
// dmls session it was issued under; both clear on sign-out.
let hdSessionBlockedByPlan = false;
let spatialBlockedByPlan = false;
const HD_CONTENT_DENIAL_STATUSES = new Set(['CUSTOMER_NOT_ELIGIBLE']);

// untilAudible(): resolves once the element is actually playing, rejects on a
// CRITICAL Shaka error before that (a license 4xx arrives as an error event
// after load(), and audio.play() can sit pending on a key that never comes).
let audibleWaiters = [];
let pendingFatal = null;
function clearAudible() {
  pendingFatal = null;
  audibleWaiters = [];
}
function failAudible(err) {
  pendingFatal = err;
  const waiters = audibleWaiters.splice(0);
  for (const w of waiters) w.reject(err);
}
function resolveAudible() {
  pendingFatal = null;
  const waiters = audibleWaiters.splice(0);
  for (const w of waiters) w.resolve();
}
function untilAudible() {
  if (trackSession && trackSession.started) return Promise.resolve();
  if (pendingFatal) return Promise.reject(pendingFatal);
  return new Promise((resolve, reject) => audibleWaiters.push({ resolve, reject }));
}
function clearPlanBlocks() {
  hdSessionBlockedByPlan = false;
  spatialBlockedByPlan = false;
}

let supportedCodecFamilies = null;
async function getSupportedCodecFamilies() {
  if (supportedCodecFamilies) return supportedCodecFamilies;
  const is = (t) => {
    try { return !!(window.MediaSource && window.MediaSource.isTypeSupported && window.MediaSource.isTypeSupported(t)); } catch { return false; }
  };
  const codecTypes = {
    flac: is('audio/mp4; codecs="flac"'),
    opus: is('audio/mp4; codecs="opus"'),
    aac: is('audio/mp4; codecs="mp4a.40.2"'),
    // E-AC-3 (the Dolby Digital Plus Atmos master's codec): decoded in
    // software by Chromium's ffmpeg — admitted only under the spatial
    // opt-in, and only when BOTH layers here say yes.
    ec3: is('audio/mp4; codecs="ec-3"')
  };
  const emeFamilies = { ...codecTypes };
  // The families whose premium rungs carry stronger output-protection
  // requirements get a deeper EME probe: FLAC, and ec-3 for spatial (Amazon
  // issues a separate KID group per rendition family, and the spatial group's
  // key may demand conditions a build's CDM refuses). When the key system
  // rejects the AUDIO robustness conditions that tier needs, treat the family
  // as unsupported on this build entirely rather than stalling at its first
  // segment. (A failed requestMediaKeySystemAccess = the CDM won't accept
  // even basic playback for that codec — treat unsupported.)
  const EME_PROBE_TYPES = { flac: 'flac', ec3: 'ec-3' };
  for (const [family, codec] of Object.entries(EME_PROBE_TYPES)) {
    if (!codecTypes[family]) continue;
    const contentType = `audio/mp4; codecs="${codec}"`;
    try {
      const nav = (typeof window !== 'undefined' && window.navigator) || (typeof navigator !== 'undefined' && navigator);
      // Minimal probe only — matches what Shaka's own setup asks. Anything
      // stricter (distinctiveIdentifier/robustness attributes) yields false
      // negatives on perfectly working L3 CDMs (observed on macOS, mac-build
      // FLAC regression reverted by this).
      const access = await nav.requestMediaKeySystemAccess('com.widevine.alpha', [{
        initDataTypes: ['cenc'],
        audioCapabilities: [{ contentType }]
      }]);
      if (!access) emeFamilies[family] = false;
    } catch (e) {
      console.log(`[widevine-player] ${family} key-system probe rejected:`, String(e && e.name || e), e && e.message);
      emeFamilies[family] = false;
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
  let spatial = DEFAULT_SPATIAL;
  try {
    const [q, a, s] = await Promise.all([
      window.electron.store.get(QUALITY_STORE_KEY),
      window.electron.store.get(ABR_STORE_KEY),
      window.electron.store.get(SPATIAL_STORE_KEY)
    ]);
    if (typeof q === 'string' && q) tier = q;
    if (typeof a === 'boolean') adaptive = a;
    if (typeof s === 'boolean') spatial = s;
  } catch { /* defaults */ }
  lastQualityRead = { tier, adaptive, spatial };
  return { tier, adaptive, spatial };
}

function applyConfig(config) {
  if (!player || !config) return;
  // maxBandwidth is ALWAYS sent — an empty restrictions object is a merge
  // no-op in Shaka config, so a previous tier's cap would persist forever
  // (lock/adaptive and any tier switch afterward included). Infinity resets
  // restrictions to the default. preferredAudioCodecs stays EMPTY: tiers
  // are bandwidth corridors across the full roster; codec is irrelevant.
  const restrictions = { maxBandwidth: (config.maxBandwidth || Infinity) };
  // Exact variant id first; nearest-bandwidth is the fallback (ties exist
  // in real Amazon manifests — two opus 53,059-ops reps share an id per
  // KID group).
  function configTargetTrack() {
    const tracks = player.getVariantTracks() || [];
    let target = tracks.find(t => String(t.id) === String(config.variantId)) || null;
    if (!target && config.variantBandwidth != null) {
      for (const t of tracks) {
        if (!target || Math.abs((t.bandwidth || 0) - config.variantBandwidth) < Math.abs((target.bandwidth || 0) - config.variantBandwidth)) target = t;
      }
    }
    return target;
  }
  if (config.abrEnabled) {
    // CRITERIA DE-CONFINEMENT (review: the adaptive flip-out-of-spatial bug):
    // a locked SPATIAL pick re-configured shaka's choice criteria with the
    // ec-3 rung (selectVariantTrack sets the criteria's channelCount/audioCodec
    // to the selected track — verified in the vendor), and player.configure()
    // never re-widens it. Enabling ABR alone would keep the candidate set
    // confined to the spatial rungs — turning the preference OFF mid-track
    // (adaptive) would keep streaming ec-3 until the next track. Select the
    // tier's rung FIRST — the selection re-configures the criteria onto the
    // new rung's family/channels — then hand control to the manager. This
    // trips Shaka's "selected track will be overridden" advisory; accepted:
    // the manager IS meant to take over from here.
    const active = (player.getVariantTracks() || []).find((t) => t.active);
    if (active && String(active.codecs || '').toLowerCase().startsWith('ec-3')) {
      const target = configTargetTrack();
      if (target) {
        try { player.selectVariantTrack(target, true); } catch { /* selection is best-effort */ }
      }
    }
    // The manager starts at the tier's rung via defaultBandwidthEstimate and
    // roams ≤ ceiling.
    player.configure({
      preferredAudioCodecs: [],
      abr: { enabled: true, restrictions, defaultBandwidthEstimate: config.variantBandwidth || undefined }
    });
    return;
  }
  player.configure({ abr: { enabled: false, restrictions: { maxBandwidth: Infinity } }, preferredAudioCodecs: [] });
  const target = configTargetTrack();
  if (target) {
    try { player.selectVariantTrack(target, true); } catch { /* selection is best-effort */ }
  }
}

// Bridge-ONLY player-event fanout (no telemetry): used when a session must
// be closed for a track that never started (load failure after mint), where
// emitPlayerEvent's telemetry side (streamingTerminated etc.) would be a lie.
function fanoutWidevineEvent(type, { resolverId, sessionId, ...payload } = {}) {
  if (!window.electron || !window.electron.widevine) return;
  try { void window.electron.widevine.playerEvent(resolverId, { type, sessionId, ...payload }); }
  catch { /* session close is best-effort; supersession/sign-out are the net */ }
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
// list through getSupportedCodecFamilies before tier selection runs. The
// spatial PREFERENCE (whether ec-3 may be picked at all) is applied later by
// shakaPlaybackConfig — this is only decompressability.
function playableVariants(tracks) {
  // Callers: await getSupportedCodecFamilies() once before selection.
  const support = { ...(supportedCodecFamilies || { flac: true, opus: true, aac: true, ec3: true }) };
  // Plan-level refusals: the FLAC KID group (hdSessionBlockedByPlan) or the
  // spatial ec-3 KID group (spatialBlockedByPlan) got CUSTOMER_NOT_ELIGIBLE
  // from the license relay — put the refused family out of the roster for
  // the process, each flag scoped to its own family.
  if (hdSessionBlockedByPlan) support.flac = false;
  if (spatialBlockedByPlan) support.ec3 = false;
  return (tracks || []).filter((t) => {
    const c = String(t && (t.codecs || t.codec) || '').toLowerCase();
    if (c.startsWith('flac')) return support.flac;
    if (c.startsWith('opus')) return support.opus;
    if (c.startsWith('mp4a') || c.startsWith('aac')) return support.aac;
    if (c.startsWith('ec-3')) return support.ec3;
    // ac-4 / mha1 / mhm1: no decoder in Chromium's ffmpeg on any build.
    return false;
  });
}

// NEVER steer the load-time pick with preferredAudioCodecs — two vendor
// hazards (review rounds 3-4, both verified against the vendored build):
// (1) the parse-time filter narrows the manifest to the first preferred
//     codec with prefix matches and WRITES THE NARROWED LIST BACK into the
//     manifest — the roster collapses for good (getVariantTracks never sees
//     the other families again);
// (2) the choice criteria ADOPTED AT LOAD keeps the list, and
//     player.configure() never syncs preferredAudioCodecs back out of it —
//     applyConfig's [] re-send is invisible to the criteria, and the ABR
//     manager is re-fed a one-family set on every choice, forever.
// preferredAudioCodecs stays EMPTY everywhere on this engine.

async function play(audio, { resolverId, entity, trackContext } = {}) {
  if (!audio || !resolverId) throw new Error('widevine-player: audio element and resolverId are required');
  if (!ensureLicenseScheme()) throw new Error('widevine-player: shaka did not load (index.html script tag)');
  if (!window.electron || !window.electron.widevine) throw new Error('widevine-player: bridge missing (preload)');

  const mine = ++playToken;
  lastError = null;
  clearAudible();
  loadStartStamp = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
  const result = await window.electron.widevine.getManifest(resolverId, entity || {});
  // A stop/skip during the mint wins over the manifest's own failure:
  // otherwise a superseded play reports playback-failed and the engine
  // auto-skips or dialogs over the track the user just picked.
  if (playToken !== mine) throw supersededError();
  if (!result || result.success !== true) {
    const err = new Error((result && result.error) || 'manifest fetch failed');
    err.reason = (result && result.reason) || 'playback-failed';
    throw err;
  }

  const shaka = window.shaka;
  if (!player) {
    player = new shaka.Player();
    player.addEventListener('adaptation', () => notifyVariantChange());
    // Manual selections (selectVariantTrack — the locked tier/spatial picks,
    // and the adaptive de-confinement pre-select) fire 'variantchanged', NOT
    // 'adaptation' (the vendor emits one or the other from the same switch
    // path). Without this listener a mid-track quality/spatial toggle
    // switches the audio but the host's stream-quality record — and the
    // playbar's quality popup — stays on the old rung (live-caught).
    player.addEventListener('variantchanged', () => notifyVariantChange());
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
      // CRITICAL (severity 2) or a DRM-range code: the player will not
      // recover. Before the element is audible this rejects untilAudible()
      // so a hung audio.play() still fails the source. After start, the
      // host skips rather than stalling the queue on a drained buffer.
      const critical = d.severity === 2 || (typeof d.code === 'number' && d.code >= 6000 && d.code < 7000);
      if (critical) {
        const fatal = new Error(lastError);
        fatal.reason = 'playback-failed';
        if (!trackSession || !trackSession.started) failAudible(fatal);
        else if (typeof window.__parachordWidevineFatal === 'function') window.__parachordWidevineFatal(lastError, activeResolverId);
      }
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
    // NO load-time steering: shaka's ABR picks a variant the moment load()
    // parses the manifest (the default estimate, or the browser's downlink)
    // and fires that variant's KID license request before our locked
    // selection lands. Steer it with a low defaultBandwidthEstimate and the
    // FIRST track starts on the bottom rung (no clearBufferSwitch to climb
    // away from it), while every later track ignores the seed — the
    // estimator's samples survive plays (the ABR manager is reused while the
    // factory is unchanged), so only the first track after launch is
    // affected. Pinning useNetworkInformation off to make the seed stick
    // also kills the estimator reset on network change. The load-time pick
    // needs no steering anyway: the default criteria narrows by
    // preferredAudioChannelCount (2), so 6-channel spatial rungs are never
    // the load-time pick, and the plan gate stops accounts that can't play
    // before any manifest request. preferredAudioCodecs stays EMPTY — see the
    // hazards above.
  });
  activeResolverId = resolverId;

  // Blob URL, not a data: URI — manifests can exceed Chromium's ~2MB URL cap.
  const blob = new Blob([result.manifest], { type: 'application/dash+xml' });
  const uri = URL.createObjectURL(blob);
  try {
    await player.load(uri);
  } catch (loadErr) {
    // The manifest mint already allocated a bridge session — a failed load
    // must close it (matched-close by sessionId), or the session idles open
    // until supersession/sign-out (review #5 L10). Direct fanout: the
    // telemetry path is guarded by trackSession, and no track ever started.
    if (result.sessionId) {
      fanoutWidevineEvent('stopped', { resolverId, sessionId: result.sessionId, positionMs: 0 });
    }
    // stop()'s unload interrupts load with Shaka 7000. That is supersession,
    // not a failure of this track — rethrowing the 7000 made the engine
    // auto-skip the track the user just picked, or dialog over it.
    if (playToken !== mine) throw supersededError();
    throw loadErr;
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

  const { tier, adaptive, spatial } = await readPlaybackQuality();
  await getSupportedCodecFamilies();
  // A stop during these awaits empties the variant list. Reporting that as
  // playback-failed is the same superseded-as-failure hole as the load catch.
  if (playToken !== mine) {
    if (trackSession && trackSession.sessionId) {
      fanoutWidevineEvent('stopped', { resolverId, sessionId: trackSession.sessionId, positionMs: 0 });
    }
    trackSession = null;
    if (activeResolverId === resolverId) activeResolverId = null;
    throw supersededError();
  }
  // Tier selection runs over what this build can decode (e.g. FLAC-only-on-
  // paper builds fall to top opus instead of stalling at an un-decodable
  // variant). The spatial opt-in (playback_spatial) admits the E-AC-3 JOC
  // (Dolby Digital Plus Atmos) rungs when this build decodes them — see
  // lib/widevine-quality.js for the selection semantics.
  const config = shakaPlaybackConfig(playableVariants(player.getVariantTracks()), tier, adaptive, { spatial });
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
  if (!player || !activeResolverId || !trackSession) return;
  const { tier, adaptive, spatial } = await readPlaybackQuality();
  // Probe-consistent: the re-selection must see the same roster play()
  // used — on a FLAC-rejecting build a mid-play tier change would
  // otherwise select an un-decodable variant (the Linux 4012 class).
  const config = shakaPlaybackConfig(await playableVariants(player.getVariantTracks()), tier, adaptive, { spatial });
  if (config) applyConfig(config);
}

async function stop({ token } = {}) {
  // Token-conditional teardown: refuse to cancel a play that's newer than the
  // caller's. Without a token, stop whatever WE own (explicit teardowns).
  if (typeof token === 'number' && token !== playToken) return { stopped: false, reason: 'stale-teardown' };
  // Own the element only while a widevine load/play is on it. Shaka's unload
  // and detach call removeAttribute('src') on the attached element, so an
  // unconditional unload silences a later local/html5 track (sign-out after
  // Amazon, or a stop that lands after the next source set src).
  const owned = !!(trackSession || activeResolverId);
  playToken += 1; // every stop invalidates all in-flight plays, owned or not
  if (!owned) return { stopped: false, reason: 'not-owner' };
  emitPlayerEvent('stopped', {
    positionMs: audioElement && Number.isFinite(audioElement.currentTime) ? Math.round(audioElement.currentTime * 1000) : 0
  });
  trackSession = null;
  activeResolverId = null;
  lastError = null;
  clearAudible();
  if (player) {
    try { await player.unload(); } catch { /* already unloaded */ }
    // Drop Shaka's element reference so a later unload cannot reach whatever
    // the host attached next (Lk no-ops once the element pointer is null).
    try { await player.detach(); } catch { /* already detached */ }
  }
  if (audioElement) {
    try { audioElement.pause(); } catch { /* element tolerance */ }
  }
  audioElement = null;
  return { stopped: true };
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
    hdSessionBlockedByPlan,
    spatialBlockedByPlan,
    shaka
  };
}

const api = { play, applyQuality, stop, getState, currentVariantFacts, setVariantListener, untilAudible, clearPlanBlocks, QUALITY_STORE_KEY, ABR_STORE_KEY, SPATIAL_STORE_KEY };
module.exports = api;
