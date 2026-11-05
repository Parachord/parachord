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
// tier choice. Spatial/immersive codecs are a separate, deliberate
// preference (below), not a tier:
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
// BEST_AVAILABLE|HD→max, DATA_SAVER→saver} — direct tier names pass through.
// Adaptive floors at the cheapest playable variant when the corridor is
// empty (never a zero-variant restriction filter).
//
// SPATIAL / ATMOS (opt-in, `{ spatial: true }`): Amazon manifests carry
// immersive rendition sets alongside the stereo ladder — E-AC-3 JOC
// (`ec-3`, the Dolby Digital Plus Atmos master: 5.1 + JOC object
// metadata), Dolby AC-4 (`ac-4.02.02.00`, IMS) and MPEG-H (`mha1`/`mhm1`).
// Chromium's ffmpeg decodes E-AC-3 (software decode of the 5.1 core; the
// JOC object layer is folded into the bed — a downmix, not object
// rendering), but has NO AC-4 or MPEG-H decoder on any build, so ec-3 is
// the only spatial family ever admitted, and only when the user opts in
// (`playback_spatial` store key): when the preference is on and the
// manifest carries a decodable spatial set, the pick is made WITHIN the
// spatial rungs — the tier ceiling shapes which one, with the same
// flooring rule, for max/high (never a silent drop back to stereo) — while
// standard/saver let the CEILING win (a tier ceiling is the one promise the
// setting makes; a data-limiting tier never trades it for the family
// preference — no spatial rung under it means stereo). The pick is LOCKED (ABR's restrictions are
// bandwidth-only and cannot pin a codec family, so adaptive would roam
// off the spatial pick into stereo rungs under the same ceiling). A
// spatial-less manifest, or a build whose probe rejects E-AC-3, selects
// exactly as before. The runtime decode probe lives in widevine-player
// (`getSupportedCodecFamilies`); this module encodes only the policy.
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

// Codec bucket from a codec string: the stereo families plus the spatial
// ones. Used to admit/exclude spatial codecs from the playable roster
// (they carry spatial content, not a tier) and to report the pick's family.
function widevineCodecFamily(codec) {
  const c = String(codec || '').toLowerCase();
  if (c.startsWith('flac')) return 'flac';
  if (c.startsWith('opus')) return 'opus';
  if (c.startsWith('mp4a') || c.startsWith('aac')) return 'aac';
  // Spatial/immersive families.
  if (c.startsWith('ec-3')) return 'ec3';
  if (c.startsWith('ac-4')) return 'ac4';
  if (c.startsWith('mha') || c.startsWith('mhm')) return 'mpegh';
  return c || null;
}

// Spatial/immersive codec families. Chromium's ffmpeg has no AC-4 or MPEG-H
// decoder on ANY build (categorical, not per-build); E-AC-3 decodes in
// software (the 5.1 core — the JOC object layer is not rendered). The
// runtime probe (widevine-player's getSupportedCodecFamilies) decides
// whether THIS build takes ec-3; the policy here admits ec3 only, and only
// on the user's opt-in.
const SPATIAL_CODEC_FAMILIES = new Set(['ec3', 'ac4', 'mpegh']);

// Stereo/lossless families — always roster candidates (probe permitting).
const WIDEVINE_PLAYABLE_FAMILIES = new Set(['flac', 'opus', 'aac']);

function variantCodec(variant) {
  if (!variant) return null;
  return variant.codecs || variant.codec || null;
}

function variantSpatial(variant) {
  return !!variant && SPATIAL_CODEC_FAMILIES.has(widevineCodecFamily(variantCodec(variant)));
}

// Playable roster membership: stereo families always; `ec3` (E-AC-3 JOC,
// the Dolby Digital Plus Atmos master) only under the spatial opt-in;
// `ac4`/`mpegh` never (no Chromium decoder — categorical, probe-independent).
function variantPlayable(variant, spatialAllowed) {
  if (!variant) return false;
  const family = widevineCodecFamily(variantCodec(variant));
  if (family === 'ec3') return spatialAllowed === true;
  if (SPATIAL_CODEC_FAMILIES.has(family)) return false;
  return WIDEVINE_PLAYABLE_FAMILIES.has(family);
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

// The tier's variant from the manifest's playable audio. Rules:
//   spatial   when `{ spatial: true }` and the roster carries decodable
//             spatial rungs, the pick is made WITHIN them — for max/high the
//             tier ceiling shapes which rung with the same flooring rule
//             (never a silent drop back to stereo while spatial is
//             available); for standard/saver the CEILING WINS — a tier
//             ceiling is the one promise the setting makes, and a
//             data-limiting tier never trades it for the family preference,
//             so a spatial set with nothing under the ceiling falls back to
//             the stereo pick
//   max       the highest-bandwidth playable variant overall
//   other     the highest-bandwidth playable variant AT OR BELOW the tier
//             ceiling; if nothing is under it, the lowest-bandwidth playable
//             variant overall (flooring, never a ceiling break)
// Unknown tier (normalize fails) or empty list → null (the engine reports
// playback-failed).
function selectShakaVariant(variants, tier, opts) {
  if (!Array.isArray(variants) || variants.length === 0) return null;
  const t = normalizePlaybackQuality(tier) || 'max';
  const spatial = !!(opts && opts.spatial);
  let playable = variants.filter((v) => variantPlayable(v, spatial));
  if (spatial) {
    const spatialPlayable = playable.filter(variantSpatial);
    if (spatialPlayable.length) {
      const ceiling = TIER_CEILING_BPS[t];
      const underCeiling = ceiling != null ? spatialPlayable.filter((v) => (Number(v.bandwidth) || 0) <= ceiling) : spatialPlayable;
      if (t === 'standard' || t === 'saver') {
        // The ceiling wins: a spatial rung fits, or stereo takes the pick.
        playable = underCeiling.length ? underCeiling : playable.filter((v) => !variantSpatial(v));
      } else {
        // max/high: the preference outranks the ceiling — flooring inside
        // the spatial set, never a drop back to stereo.
        playable = spatialPlayable;
      }
    }
  }
  if (!playable.length) return null;
  const sorted = variantsSorted(playable);
  if (t === 'max') return sorted[0];
  const ceiling = TIER_CEILING_BPS[t];
  if (!ceiling) return null;
  const under = sorted.filter((v) => (Number(v.bandwidth) || 0) <= ceiling);
  return under.length ? under[0] : sorted[sorted.length - 1];
}

// The tier's cap for the LOAD-TIME pick (review #1247 point 1): shaka's ABR
// chooses a variant the moment load() parses the manifest — before
// applyConfig lands — and with the spanning ABR set nothing keeps that pick
// inside the user's tier: every locked Saver/Standard/High track fetched a
// FLAC init segment + license before the locked selection arrived. Capping
// the pre-load configure's abr.restrictions.maxBandwidth at the tier ceiling
// keeps the load-time pick on the tier's rung family without touching the
// estimate seed or preferredAudioCodecs (the two load-time hazards).
// `flacRefused` (a FLAC-rejecting probe, or the plan latch) further caps at
// the HIGH corridor ceiling: the load-time pick must never ask for a family
// the process has been refused — every observed Amazon FLAC/HD rung (≥ 850k)
// sits above it. Max with FLAC playable stays uncapped: a load-time FLAC
// request on a fast link IS what that tier asks for.
function loadTimePickCap(tier, opts) {
  const t = normalizePlaybackQuality(tier) || 'max';
  let cap = TIER_CEILING_BPS[t] != null ? TIER_CEILING_BPS[t] : Infinity;
  if (opts && opts.flacRefused) cap = Math.min(cap, TIER_CEILING_BPS.high);
  return cap;
}

// The family-drop cap for shakaPlaybackConfig (see its comment): the top
// selection-playable rung's bandwidth when the full roster carries a
// playable-family rung above the whole selection-playable roster, else null
// (no cap). "Selection-playable" = the same filter selectShakaVariant uses
// (variantPlayable with the spatial opt-in): the cap must sit at the top rung
// the tier can actually stream, not the top of the family-filtered roster —
// a probe-accepted ec-3 rung is never a stereo tier's rung.
function familyDropCapBps(playable, allVariants, opts) {
  if (!Array.isArray(allVariants) || !allVariants.length) return null;
  const spatial = !!(opts && opts.spatial);
  const sorted = variantsSorted(playable.filter((v) => variantPlayable(v, spatial)));
  if (!sorted.length) return null;
  const topPlayable = Number(sorted[0].bandwidth) || 0;
  if (!(topPlayable > 0)) return null; // bandwidth-less roster — nothing to cap at (the safe direction is uncapped)
  for (const v of allVariants) {
    const family = widevineCodecFamily(variantCodec(v));
    if (!WIDEVINE_PLAYABLE_FAMILIES.has(family)) continue; // spatial/categorical families are handled by the channel guard, the opt-in or the manifest filter
    if ((Number(v.bandwidth) || 0) > topPlayable) return topPlayable;
  }
  return null;
}

// The player's Shaka configuration for (tier, adaptive): locked strictly to
// the tier's rung; adaptive starts at the tier ceiling and roams below it.
// NO codec preference: tiers are bandwidth corridors across the full roster
// (the cross-family roster always visible — preference lists filtered
// getVariantTracks in an earlier iteration and are deleted on purpose).
// Codec family is reported for observability only, never for configuration.
// A SPATIAL pick is always locked (see the header): ABR's restrictions are
// bandwidth-shaped and cannot pin a codec family, so adaptive would roam off
// the deliberate spatial pick into stereo rungs under the same ceiling.
//
// FAMILY-DROP CAP (review #1247 point 2): pass the UNFILTERED manifest roster
// as opts.allVariants alongside the playable one. `playableVariants`
// (widevine-player) drops whole families — a FLAC-rejecting probe, the
// CUSTOMER_NOT_ELIGIBLE plan latch — but the ABR candidate set is built from
// the SHAKA-side manifest, which never hears about our filter: with the
// spanning set, adaptive at Max would pick the refused FLAC rung on a good
// link, mint the license, get refused again and fail the track — the repeat
// the latch exists to stop. When the full roster carries a playable-family
// rung ABOVE the whole playable roster (the observed refusal shape: Amazon's
// FLAC/HD rungs sit above every lossy rung), the adaptive maxBandwidth is
// capped at the top playable rung — the ABR roams the playable roster and
// cannot reach the refused family. Interior refused rungs (below the
// playable top) cannot be excluded by a one-sided band; no observed refusal
// has that shape.
function shakaPlaybackConfig(variants, tier, adaptive, opts) {
  const variant = selectShakaVariant(variants, tier, opts);
  if (!variant) return null;
  const bandwidth = Number(variant.bandwidth) || null;
  const family = widevineCodecFamily(variantCodec(variant));
  if (!adaptive || variantSpatial(variant)) {
    return { abrEnabled: false, variantId: variant.id, variantBandwidth: bandwidth, codecFamily: family, preferredCodecs: [] };
  }
  const t = normalizePlaybackQuality(tier) || 'max';
  const ceiling = t === 'max' ? null : TIER_CEILING_BPS[t];
  const familyDropCap = familyDropCapBps(variants, opts && opts.allVariants, opts);
  return {
    abrEnabled: true,
    codecFamily: family,
    variantId: variant.id,
    variantBandwidth: bandwidth,
    // The manager's pre-sample estimate seed. The vendored chooser picks a
    // rung when the estimate sits in [rung/0.95, nextRung/0.85] (its
    // bandwidthDowngradeTarget/bandwidthUpgradeTarget; consecutive windows
    // OVERLAP — nextRung/0.95 < nextRung/0.85 — and the higher rung wins the
    // overlap; the only unmatched region is BELOW the lowest rung's floor,
    // which falls back to the lowest rung), so seeding exactly the tier
    // rung's bandwidth lands ONE RUNG BELOW it: the rung's own bandwidth sits
    // below its own floor (bw < bw/0.95), matching only the rung below.
    // Seeding rung/0.95 lands ON the rung, and never overshoots into the
    // rung above: the next rung's bandwidth is strictly higher, so
    // ceil(rung/0.95) < nextRung/0.95 stays below the next rung's own
    // floor. CEIL, never round: the floor IS rung/0.95, and rounding
    // 1902230/0.95 down to 2002347 lands 0.37bps below it — back on the
    // rung below. Only matters before the EWMA has ~128KB sampled (first
    // track after launch; navigator.connection.downlink overrides the seed
    // pre-sample anyway when the browser reports one).
    seedBandwidth: Math.ceil(bandwidth / 0.95),
    // Adaptive floor mirrors the locked-mode floor: when the cheapest
    // playable variant exceeds the ceiling, cap at that variant instead —
    // capping below it leaves the restriction filter with zero variants
    // and the player with nothing (resolver-neutral class: a future
    // provider whose manifest starts at 320k). The family-drop cap composes
    // by min(): it only tightens below refused-family rungs.
    maxBandwidth: familyDropCap == null
      ? (ceiling == null ? null : Math.max(ceiling, bandwidth))
      : Math.min(familyDropCap, ceiling == null ? Infinity : Math.max(ceiling, bandwidth)),
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
  SPATIAL_CODEC_FAMILIES,
  WIDEVINE_PLAYABLE_FAMILIES,
  variantSpatial,
  variantPlayable,
  variantsSorted,
  selectShakaVariant,
  shakaPlaybackConfig,
  loadTimePickCap
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof globalThis !== 'undefined') globalThis.ParachordWidevineQuality = api;
