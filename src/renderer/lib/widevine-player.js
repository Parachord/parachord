// widevine-player.js — the shared Widevine playback engine for the renderer.
//
// One Shaka Player bound to the shared HTMLAudioElement (the same element
// local files, SoundCloud and html5Stream resolvers share). Per-resolver
// differences stop at the widevine bridge: getManifest (entity → DASH MPD
// text) and relayLicense (CDM challenge bytes ↔ license bytes) are IPC
// handled by providers registered main-side — or, on the plugin-mediated
// path (#1356 M4, Amazon's DRM pair since M9), supplied renderer-side by a
// resolver that implements getPlaybackManifest/relayLicense: playPlugin() declares the
// manifest UP to the bridge's session open (only its length crosses — the
// text stays renderer-side), and the licence router answers main's forwarded
// challenges through the plugin's relayLicense with the context held
// renderer-side — no plugin data crosses the widevine:plugin-license push.
// Variant
// selection obeys the GLOBAL playback-quality setting ('playback_quality' /
// 'playback_abr' store keys) through lib/widevine-quality.js — no resolver
// gets its own quality vocabulary.
//
// Lifecycle:
//   widevine-player.play(audio, { resolverId, entity })
//      → bridge manifest → Shaka load → quality config → caller .play()s
//   widevine-player.playPlugin(audio, { resolverId, manifestResult, relayLicense, playerEvents })
//      → bridge session open (manifest supplied renderer-side) → same load
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

const { shakaPlaybackConfig, widevineCodecFamily, loadTimePickCap } = require('./widevine-quality');

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
// True when THIS track has had a manual selectVariantTrack from applyConfig
// (the locked tier/spatial picks, or the adaptive re-anchor below). Shaka's
// choice criteria survives configure() (player.configure never re-widens its
// audio fields), so any selection narrows the ABR candidate set to the
// selected rung's codec family until the next load() adopts a fresh, wide
// criteria — the flag is how the adaptive path knows the set is confined
// and a re-anchor is owed. A fresh load clears it (see play()).
let criteriaNarrowed = false;
let trackSession = null; // { resolverId, entity, trackContext, started }
// The plugin relay's router record (#1356 M4): { sessionId, relayLicense,
// context } | null. Shaka fires a plugin play's FIRST licence request during
// load() (as soon as the DRM engine has init data — a PSSH in the MPD fires
// at attach), long before loadManifestSession assigns trackSession below, so
// the router cannot read the relay off trackSession — it reads THIS record,
// taken the moment openSession mints the session, before the load starts.
// The record dies with its play: a newer play clears it at entry
// (supersession), and stop() tears it down. The context is the plugin's own
// reply field and never crosses IPC — the router is its renderer-side holder
// (review: no plugin data rides the widevine:plugin-license push, a channel
// any renderer code can subscribe to).
let pluginRelayRecord = null;
let loadStartStamp = 0;
let playToken = 0; // per-call token: a superseded play must never reach the element
let lastErrorDetail = null;
const recentErrors = [];

function supersededError() {
  const err = new Error('widevine: play superseded');
  err.reason = 'superseded';
  return err;
}

// Player lifecycle events to main (the bridge's session bookkeeping —
// matched-close on stop/end — plus any provider-owned telemetry;
// non-blocking) and, for a plugin-mediated session, to the PLUGIN's own
// handlePlayerEvent (telemetry is plugin-owned on that path: no main-side
// provider exists to receive them).
function emitPlayerEvent(type, payload) {
  if (!trackSession) return;
  const event = { type, sessionId: trackSession.sessionId, ...payload };
  if (window.electron && window.electron.widevine) {
    try {
      // sessionId matches the event to its license session — the bridge only
      // closes on a MATCH, so a late 'stopped' from an older play can't take
      // the newer play's relays down with it.
      void window.electron.widevine.playerEvent(trackSession.resolverId, event);
    } catch { /* telemetry must never reach playback */ }
  }
  if (trackSession.pluginEvents) {
    try { Promise.resolve(trackSession.pluginEvents(event)).catch(() => {}); } catch { /* telemetry must never reach playback */ }
  }
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
      // .reason is load-bearing contract (the engine's refusal handlers key
      // on it): propagate it, never drop it (review).
      err.reason = (result && result.reason) || 'playback-failed';
      if (result && result.licenseDenied) err.licenseDenied = true;
      // The refused group's FAMILY: read off the variant that was active WHEN
      // THE REQUEST FIRED — the CDM asks for the selected variant's group, and
      // the challenge bytes are opaque.
      const requestFamily = factsAtRequest && factsAtRequest.codec
        ? widevineCodecFamily(String(factsAtRequest.codec).split('.')[0]) : null;
      // Eligibility refusals (CUSTOMER_NOT_ELIGIBLE — live-verified on a
      // Prime plan for the HD KID group) are account-level facts: stop asking
      // for the refused family. Family-keyed and codec-free (#1262): whatever
      // family's KID was asked for is out, and the error this refusal causes
      // is handed to the family-failure fallback (next-best re-selection)
      // when it lands.
      if (result && HD_CONTENT_DENIAL_STATUSES.has(result.denialReason) && requestFamily) {
        blockedFamilies.set(requestFamily, 'license-denied');
        pendingDenialLatch = { family: requestFamily, playToken };
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
// Families this process has stopped asking for, and why — the ONE
// family-failure table (#1262), keyed by codec family (widevineCodecFamily
// vocabulary: flac/opus/aac/ec3/...), never by a hardcoded codec or a
// special spatial case. Two reasons with different lifetimes:
//   'license-denied'  the KID group for that family came back refused
//                     (CUSTOMER_NOT_ELIGIBLE) — an ACCOUNT fact, cleared on
//                     sign-out: the next account's plan may cover it. Which
//                     group was refused is read off the variant active WHEN
//                     THE LICENSE REQUEST FIRED (the challenge bytes are
//                     opaque; the round-trip can outlive a variant switch).
//   'playback-failed' the media stack rejected the family's data (the
//                     SourceBuffer append failed) — a BUILD fact, never
//                     cleared in-process: no retry changes the decoder.
// Whatever family fails, playableVariants drops it and the tier logic picks
// the best remaining rung — the next-best thing, family-agnostic.
const blockedFamilies = new Map(); // family -> 'license-denied' | 'playback-failed'
const HD_CONTENT_DENIAL_STATUSES = new Set(['CUSTOMER_NOT_ELIGIBLE']);
// A license refusal latched moments ago (the family + the play it happened
// in): the critical error the refusal causes is attributed to this family so
// the family-failure fallback can re-select instead of failing the play.
// Consumed by the error path; a stale one (the error never surfaced) is
// simply overwritten by the next denial.
let pendingDenialLatch = null; // { family, playToken } | null

// A refused rendition group's buffer is NOT the engine's to flush: Shaka
// handles it itself (the vendored bundle's licence path, #1446 review). With
// more than one key session open (Amazon's manifests open one per group) a
// failed licence request raises no error at all — Shaka drops that session,
// and once the survivors have loaded its key-status handler restricts the
// variant whose key never arrived (the manifest carries its own Widevine
// init data); a restricted ACTIVE variant re-chooses through
// chooseVariantAndSwitch, whose clearBuffer defaults to TRUE — the refused
// rung's chunk is flushed and the play continues on the rung whose key
// arrived, with no engine help. An engine-side clear ahead of that switch
// would only damage: it re-runs the tier selection over the still-unfiltered
// roster (the group label is the provider's dialect — the engine never sees
// it) and re-picks the SAME refused rung, and on an SD refusal during an LD
// play (both opus) it flushes the good LD buffer — the start-of-track stutter,
// back once per launch. The provider's refusal cache shapes the NEXT track's
// manifest; this play's buffer is the player's own to flush.

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
  // Sign-out: the license denials are ACCOUNT facts — the next account's
  // plan may cover the families this one was refused. The build facts
  // (append failures) stay: the decoder did not change with the account.
  for (const [family, reason] of Array.from(blockedFamilies)) {
    if (reason === 'license-denied') blockedFamilies.delete(family);
  }
}

// The SourceBuffer refused the appended data (the append error-event pair —
// 3014 MEDIA_SOURCE_OPERATION_FAILED / 3015 MEDIA_SOURCE_OPERATION_THREW):
// the stream this play is appending cannot be handled by this build.
const APPEND_FAILURE_CODES = new Set([3014, 3015]);
// The baseline every build decodes. An append error here is a bad segment, not a
// build that can't play the family: blocking it for the process would leave
// nothing to fall back to, so the service stays unplayable until a restart. The
// error surfaces instead, this track fails, and the next one tries again.
const NEVER_BLOCKED_ON_APPEND_FAILURE = new Set(['opus', 'aac']);

// Which family a failing stream belongs to. For a LOCKED selection the locked
// family is what this play is switching to — the vendor's active flag can
// still read the PRE-switch rung mid-switch (live-observed in the #1262
// dump: the ec-3 append failed while the active flag read the opus rung), so
// the locked target is the authoritative attribution. For an adaptive play
// the active variant is the manager's own pick and attributes correctly.
function failingFamilyForError() {
  if (trackSession && trackSession.lockedFamily) return trackSession.lockedFamily;
  const facts = currentVariantFacts();
  return facts && facts.codec ? widevineCodecFamily(String(facts.codec).split('.')[0]) : null;
}

// The family-failure fallback (#1262): an error attributable to a family —
// a license refusal that latched moments ago (pendingDenialLatch), or an
// append failure for the family this play is streaming — blocks that family
// and re-selects from the shrunken roster (the NEXT BEST THING: whatever the
// tier logic picks without the failed family) instead of failing the play.
// Codec-free by design: any family, any reason, the same next-best path. The one
// exception is NEVER_BLOCKED_ON_APPEND_FAILURE, the baseline an append error can't
// rule out.
// Returns true when the fallback took the error (the caller suppresses the
// error surfaces); false when it must propagate: no attributable family, a
// repeat for an already-failed family (the re-selection did not take), or no
// rung left to switch to. Terminating: every suppression latches a family,
// and the family count is finite.
function fallbackToNextBestFamily(err) {
  const code = err ? err.code : undefined;
  // Only the CURRENT play's session: a teardown-race error during the next
  // play's load/unload (3015 wrapping addSourceBuffer throws on a closed
  // MediaSource — the vendor's own "status was 'closed'" class) must not
  // block a good family for the process on a dead play's attribution.
  if (!trackSession || trackSession.playToken !== playToken) return false;
  let family = null;
  let reason = null;
  if (pendingDenialLatch) {
    // A license denial latched moments ago; the critical error it caused is
    // arriving now. Only a CRITICAL error (severity 2, the DRM range — a
    // license failure is always one) may consume the latch: an unrelated
    // recoverable error in the microtask window must not eat the suppression.
    // The latch is the once-guard for that denial; a fresh denial re-arms it
    // (a new license round trip), and if the re-selection keeps failing to
    // take, the still-selected family's appends fail and the append branch
    // propagates.
    const critical = (err && err.severity === 2) || (typeof code === 'number' && code >= 6000 && code < 7000);
    if (critical && pendingDenialLatch.playToken === playToken) {
      family = pendingDenialLatch.family;
      reason = 'license-denied';
    }
    pendingDenialLatch = null;
  }
  if (!family && APPEND_FAILURE_CODES.has(code)) {
    family = failingFamilyForError();
    if (NEVER_BLOCKED_ON_APPEND_FAILURE.has(family)) return false;
    if (!family || blockedFamilies.has(family)) return false; // a repeat — the earlier fallback did not take
    reason = 'playback-failed';
  }
  if (!family || !reason) return false;
  blockedFamilies.set(family, reason);
  // Is there a next best thing to switch to? Nothing left → the error must
  // propagate and the play fail honestly.
  const roster = player ? playableVariants(player.getVariantTracks()) : [];
  if (!roster.length) return false;
  // Re-select (async, best-effort). If the switch does not take, the same
  // family errors again — already blocked — and the error propagates. This is
  // the one caller that always asks for the buffer to be cleared — the buffered
  // bytes are exactly what this build's media stack rejected — but clearBuffer
  // only reaches selectVariantTrack where a manual selection is actually made:
  // in adaptive mode this re-selection only re-configures the manager and may
  // perform NO selection at all, leaving the buffer alone while the manager
  // roams its own candidate set — bounded by the bandwidth corridor, because
  // blockedFamilies is not expressible to Shaka's ABR (the known floor in the
  // docs: a blocked family cheaper than the corridor stays reachable, and the
  // repeat then propagates honestly).
  void applyQuality({ clearBuffer: true }).catch(() => {});
  return true;
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

function applyConfig(config, { clearBuffer = false } = {}) {
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
    // CRITERIA RE-ANCHOR (the general form of the de-confinement fix):
    // a MANUAL selection — selectVariantTrack — re-configures shaka's choice
    // criteria onto the selected rung's codec family and channel count
    // (verified in the vendor), and player.configure() never re-widens it,
    // so the ABR candidate set stays confined to that family. The ec-3 case
    // (a locked spatial pick flipping back to adaptive stereo) was the first
    // known instance; ANY locked play does it: locked high then adaptive max
    // kept roaming opus rungs under an uncapped ceiling, never reaching
    // FLAC. When this engine narrowed the criteria on this track AND the
    // tier's target rung sits in a different family, select the target rung
    // FIRST — the selection re-anchors the criteria onto the tier's family
    // (the ABR set then spans that family's rungs under the ceiling — known
    // floor: a weak link has no way DOWN below that family's cheapest rung
    // for the rest of the track, where a fresh adaptive play drops to the
    // family below; the next load re-widens) — then hand control to the
    // manager. This trips Shaka's "selected track will
    // be overridden" advisory; accepted: the manager IS meant to take over.
    // The criteriaNarrowed gate is load-bearing: on a FRESH play the criteria
    // is wide and the active variant merely reflects the manager's own
    // estimate-based pick (a low estimate legitimately starts adaptive max
    // on an opus rung) — re-anchoring there would force the tier's top family
    // onto a connection the estimator just called weak.
    const active = (player.getVariantTracks() || []).find((t) => t.active);
    const activeFamily = active ? widevineCodecFamily(active.codecs || active.codec) : null;
    if (criteriaNarrowed && active && activeFamily !== config.codecFamily) {
      const target = configTargetTrack();
      if (target) {
        // The switch target is what this play streams from here — the
        // family-failure attribution follows the LAST manual selection (the
        // vendor's active flag can still read the pre-switch rung mid-switch).
        if (trackSession) trackSession.lockedFamily = config.codecFamily;
        // clearBuffer matters only HERE, at a manual selection actually
        // made — and it defaults to false, matching the vendor's own ABR
        // switch default (clearBufferSwitch:false): clearing at this handover
        // discards what the pre-switch pick already downloaded, re-fetching
        // from 0 — the start-of-track stutter.
        try { player.selectVariantTrack(target, clearBuffer); } catch { /* selection is best-effort */ }
      }
    } else if (trackSession) {
      // No manual switch this round: the manager roams, and an error
      // attributes by the variant active WHEN IT FIRES — a stale manual
      // selection's family must not mis-attribute the manager's own pick.
      trackSession.lockedFamily = null;
    }
    // The manager starts at the tier's rung via defaultBandwidthEstimate and
    // roams ≤ ceiling. seedBandwidth (rung/0.95 — see widevine-quality.js)
    // lands the pre-sample estimate ON the tier rung, not one below it.
    player.configure({
      preferredAudioCodecs: [],
      abr: { enabled: true, restrictions, defaultBandwidthEstimate: config.seedBandwidth || config.variantBandwidth || undefined }
    });
    return;
  }
  player.configure({ abr: { enabled: false, restrictions: { maxBandwidth: Infinity } }, preferredAudioCodecs: [] });
  const target = configTargetTrack();
  if (target) {
    // What this play is trying to stream: the family-failure fallback
    // attributes append failures to the locked selection's family (the
    // vendor's active flag can still read the pre-switch rung mid-switch).
    if (trackSession) trackSession.lockedFamily = config.codecFamily;
    // Set before the try, conservatively: 4.16.55's selectVariantTrack runs
    // the switch FIRST and the criteria configure second, so a throw can land
    // on either side of the narrowing — a spuriously-true flag costs one
    // redundant best-effort re-anchor, a missed one re-confines ABR to the
    // wrong family.
    criteriaNarrowed = true;
    // Same handover, same rule: clearBuffer defaults to false (the vendor's
    // own ABR switch default) — only the family fallback may clear.
    try { player.selectVariantTrack(target, clearBuffer); } catch { /* selection is best-effort */ }
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
  // Family failures (#1262's one table): a family whose KID group was
  // refused (license-denied) or whose data the media stack rejected
  // (playback-failed) is out of the roster for the process/account; the
  // tier logic picks the best remaining rung — whatever family it is.
  for (const family of blockedFamilies.keys()) support[family] = false;
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

// Claim the play token for a play that has not reached play()/playPlugin()
// yet: the engine's plugin path claims BEFORE the plugin's getPlaybackManifest
// await (the provider path's play() claims ahead of its manifest mint), so a
// bare stop() during the manifest fetch — the sign-out path, which bumps no
// playback generation — makes the play superseded instead of loading onto a
// stopped engine. The returned token rides into playPlugin({ token }).
function claimPlayToken() {
  const mine = ++playToken;
  lastError = null;
  clearAudible();
  // A stale denial latch from a previous play never attributes this play's
  // errors (the playToken check covers it); drop it so a fresh play starts
  // clean.
  pendingDenialLatch = null;
  return mine;
}

async function play(audio, { resolverId, entity, trackContext, startTime } = {}) {
  if (!audio || !resolverId) throw new Error('widevine-player: audio element and resolverId are required');
  if (!ensureLicenseScheme()) throw new Error('widevine-player: shaka did not load (index.html script tag)');
  if (!window.electron || !window.electron.widevine) throw new Error('widevine-player: bridge missing (preload)');

  const mine = claimPlayToken();
  // A provider play supersedes any plugin play: its router record dies here
  // (the bridge rotates the session at the mint below — an in-flight forward
  // for the old session is refused renderer-side too, the same tail of that
  // rotation).
  pluginRelayRecord = null;
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
  return loadManifestSession(audio, {
    resolverId, result, entity: entity || {}, trackContext, startTime, mine
  });
}

// The post-manifest half of a play, shared by the provider path (play) and
// the plugin-mediated path (playPlugin): both arrive holding a minted session
// id and a manifest string, and everything below — Shaka setup, blob-URL
// load, quality config, the track-session bookkeeping — is agnostic to where
// the manifest came from. `mine` is the caller's playToken: a play
// superseded mid-load must not reach the element or close the newer play's
// session. A plugin play's relay lives in pluginRelayRecord, taken before
// this runs — Shaka asks for its first licence during load(), below.
async function loadManifestSession(audio, { resolverId, result, entity, trackContext, startTime, mine, playerEvents }) {
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
      // FAMILY-FAILURE FALLBACK (#1262): before surfacing anything, give the
      // error to the next-best mechanism. A family whose stream the engine
      // cannot take (a license refusal whose denial latched moments ago, or
      // the SourceBuffer rejecting the family's data — 3014/3015) is
      // blocked for the process and the play re-selects from the shrunken
      // roster instead of failing: whatever family it was, stereo is the next
      // best thing when the failed family was spatial, the lossy ladder when
      // it was FLAC — codec-free by design. The suppression is bounded: each
      // one latches a new family, and a repeat for an already-blocked family
      // (the re-selection did not take) propagates the fatal.
      if (fallbackToNextBestFamily(d)) return;
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
  // The tier read + codec probe run BEFORE load: the LOAD-TIME pick (the
  // variant shaka's ABR chooses the moment load() parses the manifest, before
  // applyConfig lands) must stay inside the user's tier — with the spanning
  // candidate set nothing else keeps a locked Saver track off the FLAC rungs
  // (review #1247 point 1: every locked Saver/Standard/High play fetched a
  // FLAC init segment + license first) — and off any family the process has
  // been refused (probe or plan latch). This is NOT the estimate seed or
  // preferredAudioCodecs (the two load-time hazards); it is a restriction,
  // which the post-load applyConfig re-sends with the authoritative value.
  const preload = await readPlaybackQuality();
  const support = await getSupportedCodecFamilies();
  // A stop/skip during these awaits (the review's temp test): without this
  // check the stopped play still calls load(), re-seizes activeResolverId
  // after stop() cleared it, and the minted session idles open — the matched
  // close the load catch does, thrown as the same supersession it is.
  if (playToken !== mine) {
    if (result.sessionId) {
      fanoutWidevineEvent('stopped', { resolverId, sessionId: result.sessionId, positionMs: 0 });
    }
    throw supersededError();
  }
  const flacRefused = blockedFamilies.has('flac') || support.flac === false;
  const loadCap = loadTimePickCap(preload.tier, { flacRefused });
  player.configure({
    drm: { servers: { 'com.widevine.alpha': licenseServerUri } },
    streaming: { rebufferingGoal: 2, bufferingGoal: 10 },
    // The load-time pick's cap (see loadTimePickCap): the tier ceiling — or,
    // when the process has been refused FLAC (probe/latch), the high ceiling,
    // which every observed Amazon FLAC rung sits above. Sent with an explicit
    // value: an absent restrictions object is a merge no-op.
    abr: { restrictions: { maxBandwidth: loadCap } },
    // enableAudioGroups: false — THE cross-family adaptive fix (#1243).
    // With it on (the default), the DASH parser stamps every stream with
    // its AdaptationSet's id as groupId, and the ABR candidate set shaka's
    // choice criteria builds (shaka.media.AdaptationSet) rejects variants
    // whose groupId differs from the anchor's — Amazon puts each codec
    // family in its own AdaptationSet (live capture: "three opus plus two
    // FLAC renditions across five adaptation sets"), so the set is ONE
    // family, anchored on the first variant in manifest order (an opus
    // rung). Adaptive at Max could therefore NEVER reach FLAC — the ABR
    // roamed opus rungs under an uncapped ceiling no matter the bandwidth
    // estimate, while locked plays crossed families fine via
    // selectVariantTrack. With no group ids, and the default smooth codec
    // switching (SourceBuffer.changeType — present in Electron), the set
    // spans the stereo families; the 6-channel ec-3 and channel-less
    // mha/mhm spatial rungs stay excluded by the channel guards. Verified
    // against the vendored 4.16.55: tests/renderer/widevine-shaka-adaptation.test.js.
    manifest: { enableAudioGroups: false }
    // NO estimate steering and NO codec list — only the restriction above
    // shapes the load-time pick. A low defaultBandwidthEstimate seed only
    // steers the FIRST track after launch (the estimator's samples survive
    // plays — the ABR manager is reused while the factory is unchanged) and
    // lands it on the bottom rung with no clearBufferSwitch to climb away;
    // pinning useNetworkInformation off to make a seed stick also kills the
    // estimator reset on network change. preferredAudioCodecs stays EMPTY —
    // the parse-time filter writes the narrowed manifest back and the
    // load-adopted criteria never un-syncs the list (two vendor hazards,
    // rounds 3-4). What the pick still may do within the cap: start on FLAC
    // under MAX on a fast estimate (the tier's own request — its license
    // fires before applyConfig, the accepted residual), and 6-channel
    // spatial rungs are never the pick (the default criteria narrows by
    // preferredAudioChannelCount: 2).
  });
  activeResolverId = resolverId;

  // Blob URL, not a data: URI — manifests can exceed Chromium's ~2MB URL cap.
  // (The AC-4 / MPEG-H rungs need no pre-filter: shaka's own playable filter
  // drops them — the CDM rejects their mediaCapabilities.decodingInfo probe —
  // so they never reach getVariantTracks() or the ABR candidate set.)
  const blob = new Blob([result.manifest], { type: 'application/dash+xml' });
  const uri = URL.createObjectURL(blob);
  try {
    // startTime: a resumed track starts where it was (#1319) instead of
    // playing from 0:00 until a seek lands.
    await player.load(uri, startTime > 0 ? startTime : undefined);
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
  // The fresh load just adopted a fresh, WIDE choice criteria (the vendor
  // creates one per parse and player.load installs it) — whatever a previous
  // track's selections narrowed is gone. Reset the flag HERE, before the
  // post-load awaits below: a settings-toggle applyQuality() landing in that
  // window passes its guards and would otherwise run adaptive config against
  // the PREVIOUS track's stale flag — firing the re-anchor on a fresh, wide
  // criteria and confining the new track to the tier's top family even on a
  // weak link, exactly what the flag's gate exists to prevent.
  criteriaNarrowed = false;
  bindElementEvents(audio);
  const kidGroupsByFamily = {};
  for (const group of (result.protectionSets || [])) {
    if (group && group.kid) kidGroupsByFamily[group.family || 'unknown'] = group.kid;
  }
  trackSession = {
    resolverId,
    playToken: mine, // the family-failure fallback only acts for the CURRENT play's session — a teardown-race error during the next play's load must not block this play's family
    sessionId: result.sessionId || null,
    kidGroupsByFamily,
    // Telemetry/stats attribute the SERVED pressing: Amazon's substitution
    // maps a catalog ASIN to a deliverable one (identical track, different id).
    entity: { ...(entity || {}), ...(result.substituteAsin ? { asin: result.substituteAsin, requestedAsin: entity && entity.asin } : {}) },
    trackContext: trackContext || {},
    cdnType: result.cdnType || null,
    // The plugin-mediated play's player-event handler (its handlePlayerEvent
    // — telemetry), fanned out alongside the bridge IPC above; null on the
    // provider path.
    pluginEvents: typeof playerEvents === 'function' ? playerEvents : null,
    started: false
  };

  const { tier, adaptive, spatial } = await readPlaybackQuality();
  // (The codec probe already ran pre-load; this call is the cached no-op.)
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
  // lib/widevine-quality.js for the selection semantics. The UNFILTERED roster
  // rides along (allVariants) so shakaPlaybackConfig can cap adaptive below a
  // family that playableVariants dropped (probe / plan latch): the shaka-side
  // ABR set never hears our filter.
  const allTracks = player.getVariantTracks();
  const config = shakaPlaybackConfig(playableVariants(allTracks), tier, adaptive, { spatial, allVariants: allTracks });
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

// The plugin-mediated licence router (#1356 M4). Main forwards a
// plugin-mediated session's licence challenge to the renderer; the router
// hands it to the CURRENT play's plugin relayLicense together with the
// session's context — held HERE, in pluginRelayRecord, since the
// open-session (review: the context never crosses IPC; the router is its
// renderer-side holder, and no plugin data rides the broadcast any renderer
// code can subscribe to). Registered once, on the first plugin-mediated
// play; a request naming any session other than the live one (a superseded
// play racing its last relay) is refused — main already gated the session,
// this is the renderer-side tail of the same rule. The record answers
// MID-LOAD requests too: Shaka fires the first licence request during
// load(), before trackSession exists — the record predates the load, so the
// first licence of a plugin play is answered, not refused.
//
// The subscription is single-owner (preload), so the router claims it when
// this module loads, before any plug-in code runs, rather than on the first
// plug-in play: code that subscribed first would otherwise own every licence
// answer for the session. A refused claim (the preload answers null) leaves
// the router unbound, so a plug-in play fails with a message that says why
// instead of a licence error that doesn't.
let pluginRelayRouterBound = false;
function ensurePluginRelayRouter(bridge) {
  if (pluginRelayRouterBound) return true;
  if (!bridge || typeof bridge.onPluginLicenseRequest !== 'function') return false;
  pluginRelayRouterBound = true;
  const unsubscribe = bridge.onPluginLicenseRequest(async (request) => {
    const record = pluginRelayRecord;
    if (!record || record.sessionId !== request.sessionId || typeof record.relayLicense !== 'function') {
      const err = new Error('widevine-player: no live plugin license relay for this session');
      err.reason = 'playback-failed';
      throw err;
    }
    const license = await record.relayLicense(request.challenge, record.context);
    if (typeof license !== 'string' || !license) {
      const err = new Error('widevine-player: the resolver\'s relayLicense answered empty');
      err.reason = 'playback-failed';
      throw err;
    }
    return license;
  });
  if (typeof unsubscribe !== 'function') {
    pluginRelayRouterBound = false;
    return false;
  }
  return true;
}
// Claim the relay at load (see above). A test or plain Node has no bridge.
try {
  if (typeof window !== 'undefined' && window.electron && window.electron.widevine) {
    ensurePluginRelayRouter(window.electron.widevine);
  }
} catch (_e) { /* claimed on the first plug-in play instead */ }

// The plugin-mediated play path (#1356 M4): a resolver that implements
// getPlaybackManifest supplies the manifest RENDERER-side (the engine calls
// it with the whole track); the host declares that manifest UP to main
// (widevine:open-session, by LENGTH — the text never crosses IPC), which
// opens the licence session under the same gates a provider manifest opens
// one — sender, rate window, supersession, matched close. The plugin's
// opaque `context` never crosses IPC either: it stays renderer-side, in the
// relay record below, and returns to the plugin with every licence
// challenge. The manifest extras the provider reply carries
// (protectionSets/substituteAsin/cdnType) are optional fields on the plugin's
// reply and ride the same seams; a plugin reply without them simply reports
// no substitution and no KID annotation.
// The reply's `asin` (the plugin's own identifier extraction — the host
// stopped pre-digesting one) fills the entity seam, so provenance and
// play-started telemetry attribute the served pressing like the provider
// path's engine-provided entity did. `playerEvents` is the plugin's
// handlePlayerEvent (telemetry is plugin-owned here — no main-side provider
// exists to receive the bridge's player-event channel).
async function playPlugin(audio, { resolverId, manifestResult, relayLicense, playerEvents, trackContext, startTime, token } = {}) {
  if (!audio || !resolverId) throw new Error('widevine-player: audio element and resolverId are required');
  if (!ensureLicenseScheme()) throw new Error('widevine-player: shaka did not load (index.html script tag)');
  const bridge = window.electron && window.electron.widevine;
  if (!bridge) throw new Error('widevine-player: bridge missing (preload)');
  if (typeof bridge.openSession !== 'function' || typeof bridge.onPluginLicenseRequest !== 'function') {
    throw new Error('widevine-player: plugin license bridge missing (preload)');
  }
  if (typeof relayLicense !== 'function') {
    const err = new Error('widevine-player: playPlugin needs the resolver\'s relayLicense');
    err.reason = 'playback-failed';
    throw err;
  }
  const reply = manifestResult && typeof manifestResult === 'object' ? manifestResult : null;
  if (!reply || typeof reply.manifest !== 'string' || !reply.manifest) {
    const err = new Error('widevine-player: the resolver\'s manifest reply carried no manifest');
    err.reason = 'playback-failed';
    throw err;
  }
  // This engine is DASH + Widevine (Shaka on the shared element): the
  // plugin's declared stream shape gates HERE, before a session is minted —
  // the bridge carries type/drm on the session record inertly, so a future
  // stream system declares itself without main learning wire formats.
  if (reply.type !== 'dash' || reply.drm !== 'widevine') {
    const err = new Error(`widevine-player: the resolver's manifest reply is ${reply.type || '?'}/${reply.drm || '?'} — this engine plays dash/widevine`);
    err.reason = 'playback-failed';
    throw err;
  }
  if (!ensurePluginRelayRouter(bridge)) {
    const err = new Error('widevine-player: the plug-in licence relay is held by another subscriber, so this play cannot be licensed');
    err.reason = 'playback-failed';
    throw err;
  }

  // A pre-claimed token (claimPlayToken — the engine claims before the
  // plugin's manifest fetch) can be stale: a stop() during that fetch
  // already invalidated it, and this play is superseded before it starts —
  // never claim a fresh token here (that would abort the newer play
  // instead). Without one, claim here (the direct-call shape).
  const mine = typeof token === 'number' ? token : claimPlayToken();
  if (playToken !== mine) throw supersededError();
  lastError = null;
  clearAudible();
  pendingDenialLatch = null;
  // A plugin play supersedes whatever was live (plugin or provider): the
  // previous play's router record dies here; the new one is taken below, the
  // moment the session is minted.
  pluginRelayRecord = null;
  loadStartStamp = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
  const open = await bridge.openSession(resolverId, reply.manifest.length, reply.type, reply.drm);
  // A stop/skip during the open wins over the open's own failure — the same
  // supersession rule the provider path applies to its manifest mint.
  if (playToken !== mine) throw supersededError();
  if (!open || open.success !== true) {
    const err = new Error((open && open.error) || 'license session open failed');
    err.reason = (open && open.reason) || 'playback-failed';
    throw err;
  }
  // The router's record, taken BEFORE the load starts: Shaka fires the
  // first licence request during load() (init data present at attach),
  // before trackSession exists — the router answers from this record, with
  // the plugin's own context held renderer-side.
  pluginRelayRecord = { sessionId: open.sessionId, relayLicense, context: reply.context || null };
  return loadManifestSession(audio, {
    resolverId,
    // The bridge-minted session id plus the plugin-supplied manifest, in the
    // result shape the provider path feeds downstream: sessionId drives the
    // licence URL and the matched close, and the optional extras ride the
    // provider reply's own fields.
    result: {
      manifest: reply.manifest,
      sessionId: open.sessionId,
      protectionSets: reply.protectionSets,
      substituteAsin: reply.substituteAsin,
      cdnType: reply.cdnType
    },
    // The plugin's identifier extraction rides the entity seam the provider
    // path's engine-provided entity filled; the loadManifestSession merge
    // layers the SERVED asin (substituteAsin) over it, so play-started
    // telemetry and provenance attribute the deliverable pressing.
    // `asin` is Amazon's word on a GENERIC plugin contract — accepted for
    // now (#1439 review); rename it to a neutral id when a second DRM
    // service appears (a Tidal resolver must not return an `asin`).
    entity: typeof reply.asin === 'string' && reply.asin ? { asin: reply.asin } : {},
    trackContext,
    startTime,
    mine,
    playerEvents: typeof playerEvents === 'function' ? playerEvents : null
  });
}

// Live re-apply of the global quality setting against the active manifest.
// { clearBuffer: true } (the family fallback) is the ONLY way a buffer flush
// rides this path — the default handover keeps what the previous pick
// buffered, and a refused rung's buffer is Shaka's own restriction-and-switch
// to flush (see the note above).
async function applyQuality({ clearBuffer = false } = {}) {
  if (!player || !activeResolverId || !trackSession) return;
  const { tier, adaptive, spatial } = await readPlaybackQuality();
  // Probe-consistent: the re-selection must see the same roster play()
  // used — on a FLAC-rejecting build a mid-play tier change would
  // otherwise select an un-decodable variant (the Linux 4012 class). The
  // unfiltered roster rides along for the family-drop cap (see play()).
  const allTracks = player.getVariantTracks();
  const config = shakaPlaybackConfig(await playableVariants(allTracks), tier, adaptive, { spatial, allVariants: allTracks });
  if (config) applyConfig(config, { clearBuffer });
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
  // The plugin relay dies with its play: a late forwarded challenge for the
  // stopped session finds no router target (main's matched close already
  // woke its in-flight forwards).
  pluginRelayRecord = null;
  activeResolverId = null;
  lastError = null;
  // Nothing is playing — the criteria state is stale either way, and a
  // truthful getState() diagnostic is worth the reset.
  criteriaNarrowed = false;
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
        playableBandwidths: tracks.map((t) => t.bandwidth).sort((a, b) => a - b).filter((v, i, arr) => arr.indexOf(v) === i),
        // The distinct codecs in the manifest as shaka serves them — answers
        // "what families did this track's roster actually carry" (the Linux
        // SD/LD-ladder reading, the Atmos-track AC-4 check) straight from
        // DevTools on a stock build.
        variantCodecs: tracks.map((t) => t.codecs).filter((v, i, arr) => arr.indexOf(v) === i).sort()
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
    criteriaNarrowed,
    blockedFamilies: Object.fromEntries(blockedFamilies),
    shaka
  };
}

const api = { play, playPlugin, claimPlayToken, applyQuality, stop, getState, currentVariantFacts, setVariantListener, untilAudible, clearPlanBlocks, QUALITY_STORE_KEY, ABR_STORE_KEY, SPATIAL_STORE_KEY };
module.exports = api;
