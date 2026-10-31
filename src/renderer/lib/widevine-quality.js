// widevine-quality.js — the global playback-quality setting for stream
// (Widevine/DASH-style) playback, and the pure mapping from a quality tier to
// one variant of a manifest.
//
// Resolver-neutral on purpose: any source that delivers an adaptive manifest
// (Amazon Music today; Tidal/Qobuz-style sources whenever) feeds its variant
// list through selectShakaVariant / shakaPlaybackConfig and gets the same
// behavior. License handling and manifest fetching stay per-resolver (the
// widevine bridge, main-process side); quality is NOT per-resolver — the
// user sets it once here and every stream source honors it.
//
// Tiers (store key 'playback_quality', abr toggle 'playback_abr'):
//   max       the best playable audio the manifest offers (lossless preferred)
//   high      the best LOSSY audio (FLAC-capped — quality without lossless data)
//   balanced  ≈256 kbps ceiling (highest variant at or below it)
//   low       the lowest-bitrate variant (data saver)
// With 'playback_abr' on, the player adapts to network at or below the
// tier's bandwidth (cap + start at tier); off, it locks the tier's variant.
//
// Pure, module-global safe (tests run under bare node; the renderer loads
// this through the app bundle). Codec inputs look like Shaka's variant
// tracks ({ codecs }) or parsed manifest reps ({ codec }) — both are read
// defensively from either property name.

'use strict';

const PLAYBACK_QUALITY_TIERS = ['max', 'high', 'balanced', 'low'];

const TIER_BANDWIDTH_CEILING = {
  balanced: 256000
};

function normalizePlaybackQuality(value) {
  const v = String(value || '').toLowerCase();
  return PLAYBACK_QUALITY_TIERS.includes(v) ? v : null;
}

// Codec bucket from a codec string. Shaka reports e.g. 'flac', 'opus',
// 'mp4a.40.2'; manifest reps report raw DASH codecs — both shapes work.
function widevineCodecFamily(codec) {
  const c = String(codec || '').toLowerCase();
  if (c.startsWith('flac')) return 'flac';
  if (c.startsWith('opus')) return 'opus';
  if (c.startsWith('mp4a') || c.startsWith('aac')) return 'aac';
  return c || null;
}

// Chromium (and Shaka on it) cannot decode spatial/immersive codecs — Dolby
// AC-4 (mha1, Atmos JOC) and MPEG-H (mhm1) ride Amazon manifests alongside
// the stereo tiers (live-verified: Get Lucky's manifest has 5 spatial reps
// out of 16). The web player filters them silently; so do we, always.
const WIDEVINE_PLAYABLE_FAMILIES = new Set(['flac', 'opus', 'aac']);

function variantCodec(variant) {
  if (!variant) return null;
  return variant.codecs || variant.codec || null;
}

function variantPlayable(variant) {
  return !!variant && WIDEVINE_PLAYABLE_FAMILIES.has(widevineCodecFamily(variantCodec(variant)));
}

// Deterministic order: bandwidth desc, then sample rate desc, then channels
// desc, then id (stable for a given manifest).
function variantsSorted(variants) {
  return variants.slice().sort((a, b) => {
    const bw = (Number(b.bandwidth) || 0) - (Number(a.bandwidth) || 0);
    if (bw) return bw;
    const sr = (Number(b.audioSamplingRate || b.sampleRate) || 0) - (Number(a.audioSamplingRate || a.sampleRate) || 0);
    if (sr) return sr;
    const ch = (Number(b.channelsCount || b.channels) || 0) - (Number(a.channelsCount || a.channels) || 0);
    if (ch) return ch;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
}

// The tier FIRST variant of the manifest's playable audio, or null when the
// manifest has nothing playable or the tier is unknown (callers treat null
// as playback-failed).
function selectShakaVariant(variants, tier) {
  if (!Array.isArray(variants) || variants.length === 0) return null;
  const t = normalizePlaybackQuality(tier) || 'max';
  const playable = variants.filter(variantPlayable);
  if (!playable.length) return null;
  const sorted = variantsSorted(playable);
  if (t === 'max') return sorted[0];
  if (t === 'low') {
    // Cheapest audio; on bandwidth ties the first in order (deterministic).
    const lowest = sorted[sorted.length - 1];
    return sorted.find((v) => (Number(v.bandwidth) || 0) === (Number(lowest.bandwidth) || 0)) || lowest;
  }
  if (t === 'high') {
    // Best lossy. FLAC-only manifests answer the cheapest FLAC rather than
    // fail — the tier's data intent still holds.
    const lossy = sorted.filter((v) => widevineCodecFamily(variantCodec(v)) !== 'flac');
    if (lossy.length) return lossy[0];
    const lowest = sorted[sorted.length - 1];
    return sorted.find((v) => (Number(v.bandwidth) || 0) === (Number(lowest.bandwidth) || 0)) || lowest;
  }
  // balanced: highest variant at or below the ceiling; floor at the cheapest.
  const ceiling = TIER_BANDWIDTH_CEILING.balanced;
  const under = sorted.filter((v) => (Number(v.bandwidth) || 0) <= ceiling);
  return under.length ? under[0] : sorted[sorted.length - 1];
}

// The player's Shaka configuration for (tier, adaptive): a locked variant, or
// ABR within the tier's CODEC FAMILY capped at its bandwidth. The family pin
// is deliberate: Shaka's ABR never crosses opus↔FLAC boundaries mid-stream
// (a codec switch needs a SourceBuffer reload, which its smooth-switch ABR
// won't do), so without it ABR parks on the top rung of whatever family the
// initial estimate picked (observed live: 'max' stuck at 325k opus with a
// 163 Mbps estimate). Returns null when nothing is playable.
function shakaPlaybackConfig(variants, tier, adaptive) {
  const variant = selectShakaVariant(variants, tier);
  if (!variant) return null;
  const bandwidth = Number(variant.bandwidth) || null;
  if (!adaptive) {
    return { abrEnabled: false, variantId: variant.id, variantBandwidth: bandwidth };
  }
  return {
    abrEnabled: true,
    codecFamily: widevineCodecFamily(variantCodec(variant)),
    variantId: variant.id,
    variantBandwidth: bandwidth,
    maxBandwidth: bandwidth
  };
}

// Node/CommonJS + browser global (the app bundles for the renderer; tests
// require the module directly).
const api = {
  PLAYBACK_QUALITY_TIERS,
  normalizePlaybackQuality,
  widevineCodecFamily,
  WIDEVINE_PLAYABLE_FAMILIES,
  variantPlayable,
  variantsSorted,
  selectShakaVariant,
  shakaPlaybackConfig
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof globalThis !== 'undefined') globalThis.ParachordWidevineQuality = api;
