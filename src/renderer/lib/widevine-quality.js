// widevine-quality.js — the global playback-quality setting for stream
// (Widevine/DASH-style) playback, and the pure mapping from a quality tier to
// one variant of a manifest.
//
// Resolver-neutral on purpose: any source that delivers an adaptive manifest
// (Amazon Music today; Tidal/Qobuz-style sources whenever) feeds its variant
// list through selectShakaVariant / shakaPlaybackConfig and gets the same
// behavior. License handling and manifest fetching stay per-resolver (the
// widevine bridge, main-process side); quality is NOT per-resolver — the
// user sets it once and every stream source honors it.
//
// Tiers are BANDWIDTH ceilings — nothing else. Codec is irrelevant to the
// tier choice (aside from the explicit spatial exclusion below):
//
//   saver    ≤ 100 kbps
//   standard ≤ 200 kbps
//   high     ≤ 500 kbps
//   max      best available (Ultra/HD/lossless when the build's codecs and
//              the content protection conditions allow)
//
// With adaptive playback the player starts at the tier ceiling and lets the
// network roam at or below it; locked = strictly the tier's rung. Stored
// values from earlier builds normalize: {low→saver, balanced→standard,
// standard→high, BEST_AVAILABLE|HD→max, DATA_SAVER→saver, high, max}.
//
// Spatial/immersive codecs (mha1 = Dolby AC-4 Atmos, mhm1 = MPEG-H) ride
// Amazon manifests at the top of the bandwidth ladder (up to 1.6 Mbps) but
// nothing in Chromium decodes them, so they're excluded by name — that is a
// decompressability filter, not a tier rule. Everything else is bps-driven.
//
// Pure, module-global safe (tests run under bare node; the renderer loads
// this through the app bundle).

'use strict';

// Ordered top→bottom exactly for the Settings card's select order.
const PLAYBACK_QUALITY_TIERS = ['max', 'high', 'standard', 'saver'];

// Ceiling bits-per-second for each tier. max has no ceiling.
const TIER_CEILING_BPS = {
  saver: 100000,
  standard: 200000,
  high: 500000
};

const LEGACY_TIER_MAP = {
  low: 'saver',
  balanced: 'standard',
  best_available: 'max',
  best: 'max',
  data_saver: 'saver',
  hd: 'max'
};

function normalizePlaybackQuality(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return null;
  if (PLAYBACK_QUALITY_TIERS.includes(v)) return v;
  return LEGACY_TIER_MAP[v] || null;
}

// Codec bucket from a codec string, only used to EXCLUDE spatial codecs
// from the playable roster (they carry spatial content, not a tier).
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
// out of 16, up to 1.6 Mbps). The web player filters them silently; so do
// we, always.
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

// The tier's variant from the manifest's playable audio (spatial excluded,
// everything else bandwidth-ordered). Rules:
//   max      the highest-bandwidth playable variant overall
//   other    the highest-bandwidth playable variant AT OR BELOW the tier
//            ceiling; if nothing is under it, the lowest-bandwidth playable
//            variant overall (flooring, never a ceiling break)
// Unknown tier (normalize fails) or empty list → null (the engine reports
// playback-failed).
function selectShakaVariant(variants, tier) {
  if (!Array.isArray(variants) || variants.length === 0) return null;
  const t = normalizePlaybackQuality(tier) || 'max';
  const playable = variants.filter(variantPlayable);
  if (!playable.length) return null;
  const sorted = variantsSorted(playable);
  if (t === 'max') return sorted[0];
  const ceiling = TIER_CEILING_BPS[t];
  if (!ceiling) return null;
  const under = sorted.filter((v) => (Number(v.bandwidth) || 0) <= ceiling);
  return under.length ? under[0] : sorted[sorted.length - 1];
}

// The player's Shaka configuration for (tier, adaptive): locked strictly to
// the tier's rung; adaptive starts at the tier ceiling and roams below it.
// NO codec preference: tiers are bandwidth corridors across the full roster
// (the cross-family roster always visible — preference lists filtered
// getVariantTracks in an earlier iteration and are deleted on purpose).
// Codec family is reported for observability only, never for configuration.
function shakaPlaybackConfig(variants, tier, adaptive) {
  const variant = selectShakaVariant(variants, tier);
  if (!variant) return null;
  const bandwidth = Number(variant.bandwidth) || null;
  const family = widevineCodecFamily(variantCodec(variant));
  if (!adaptive) {
    return { abrEnabled: false, variantId: variant.id, variantBandwidth: bandwidth, codecFamily: family, preferredCodecs: [] };
  }
  const t = normalizePlaybackQuality(tier) || 'max';
  const ceiling = t === 'max' ? null : TIER_CEILING_BPS[t];
  return {
    abrEnabled: true,
    codecFamily: family,
    variantId: variant.id,
    variantBandwidth: bandwidth,
    maxBandwidth: ceiling,
    preferredCodecs: []
  };
}

// Node/CommonJS + browser global (the app bundles for the renderer; tests
// require the module directly).
const api = {
  PLAYBACK_QUALITY_TIERS,
  TIER_CEILING_BPS,
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
