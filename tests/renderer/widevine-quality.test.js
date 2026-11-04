// Tests for the global playback-quality → variant mapping (bandwidth-only;
// codecs never drive the tier). All-16 live fixture from an HD-tier Amazon
// manifest (2026-10), spatial reps included.

const {
  PLAYBACK_QUALITY_TIERS,
  TIER_CEILING_BPS,
  normalizePlaybackQuality,
  widevineCodecFamily,
  SPATIAL_CODEC_FAMILIES,
  variantSpatial,
  variantPlayable,
  selectShakaVariant,
  shakaPlaybackConfig
} = require('../../src/renderer/lib/widevine-quality');

const LIVE_VARIANTS = [
  { id: '1', codecs: 'opus', bandwidth: 53059, audioSamplingRate: 48000, channelsCount: 2 },
  { id: '2', codecs: 'opus', bandwidth: 197343, audioSamplingRate: 48000, channelsCount: 2 },
  { id: '3', codecs: 'opus', bandwidth: 325595, audioSamplingRate: 48000, channelsCount: 2 },
  { id: '4', codecs: 'opus', bandwidth: 53059, audioSamplingRate: 48000, channelsCount: 2 },
  { id: '5', codecs: 'opus', bandwidth: 165280, audioSamplingRate: 48000, channelsCount: 2 },
  { id: '6', codecs: 'flac', bandwidth: 1062133, audioSamplingRate: 44100, channelsCount: 2, bitDepth: 16 },
  { id: '7', codecs: 'flac', bandwidth: 1902230, audioSamplingRate: 48000, channelsCount: 2, bitDepth: 24 },
  { id: '8', codecs: 'mha1.0x0e', bandwidth: 1612557, audioSamplingRate: 48000, channelsCount: null },
  { id: '10', codecs: 'mhm1.0x0d', bandwidth: 1077894, audioSamplingRate: 48000, channelsCount: null },
  { id: '11', codecs: 'mha1.0x0d', bandwidth: 675720, audioSamplingRate: 48000, channelsCount: null },
  { id: '12', codecs: 'mhm1.0x0c', bandwidth: 339893, audioSamplingRate: 48000, channelsCount: null },
  { id: '13', codecs: 'mhm1.0x0e', bandwidth: 1610228, audioSamplingRate: 48000, channelsCount: null },
  { id: '14', codecs: 'mha1.0x0c', bandwidth: 341861, audioSamplingRate: 48000, channelsCount: null },
  { id: '15', codecs: 'mhm1.0x0c', bandwidth: 341861, audioSamplingRate: 48000, channelsCount: null }
];

describe('normalizePlaybackQuality', () => {
  test('accepts the 4 tiers and maps legacy names to them', () => {
    for (const t of PLAYBACK_QUALITY_TIERS) expect(normalizePlaybackQuality(t)).toBe(t);
    expect(normalizePlaybackQuality('low')).toBe('saver');
    expect(normalizePlaybackQuality('balanced')).toBe('standard');
    expect(normalizePlaybackQuality('STANDARD')).toBe('standard');
    expect(normalizePlaybackQuality('BEST_AVAILABLE')).toBe('max');
    expect(normalizePlaybackQuality('HD')).toBe('max');
    expect(normalizePlaybackQuality('DATA_SAVER')).toBe('saver');
    expect(normalizePlaybackQuality('MAX')).toBe('max');
  });
  test('rejects empty/garbage', () => {
    expect(normalizePlaybackQuality('')).toBeNull();
    expect(normalizePlaybackQuality(null)).toBeNull();
    expect(normalizePlaybackQuality('ultra-mega-whatever')).toBeNull();
  });
});

describe('TIER_CEILING_BPS / variantPlayable', () => {
  test('the ceilings are exactly the corridor values', () => {
    expect(TIER_CEILING_BPS.saver).toBe(100000);
    expect(TIER_CEILING_BPS.standard).toBe(200000);
    expect(TIER_CEILING_BPS.high).toBe(500000);
    expect(TIER_CEILING_BPS.max).toBeUndefined();
  });
  test('spatial codecs are excluded from the roster', () => {
    expect(variantPlayable({ codecs: 'mha1.0x0e' })).toBe(false);
    expect(variantPlayable({ codecs: 'mhm1.0x0c' })).toBe(false);
    expect(variantPlayable({ codecs: 'ec-3' })).toBe(false);
    expect(variantPlayable({ codecs: 'ac-4.02.02.00' })).toBe(false);
    expect(variantPlayable({ codecs: 'flac' })).toBe(true);
    expect(variantPlayable({ codecs: 'opus' })).toBe(true);
    expect(variantPlayable({ codecs: 'mp4a.40.2' })).toBe(true);
  });
});

describe('selectShakaVariant (bandwidth-only tiers)', () => {
  test('max picks highest bandwidth playable overall (never spatial)', () => {
    const v = selectShakaVariant(LIVE_VARIANTS, 'max');
    expect(v.bandwidth).toBe(1902230);
    expect(v.codecs).toBe('flac');
  });
  test('high picks highest ≤500k', () => {
    expect(selectShakaVariant(LIVE_VARIANTS, 'high').bandwidth).toBe(325595);
    expect(selectShakaVariant(LIVE_VARIANTS, 'high').codecs).toBe('opus');
  });
  test('standard picks highest ≤200k (never flac, since flac exceeds its ceiling)', () => {
    expect(selectShakaVariant(LIVE_VARIANTS, 'standard').bandwidth).toBe(197343);
  });
  test('saver picks highest ≤100k (tie: stable first by sampleRate/id)', () => {
    const a = selectShakaVariant(LIVE_VARIANTS, 'saver');
    expect(a.bandwidth).toBe(53059);
    expect(a.id).toBe('1');
    expect(selectShakaVariant(LIVE_VARIANTS, 'saver')).toEqual(a);
  });
  test('nothing under a corridor floor returns the cheapest overall (never breaks tier)', () => {
    const onlyHi = [
      { id: 'a', codecs: 'opus', bandwidth: 400000 },
      { id: 'b', codecs: 'opus', bandwidth: 300000 }
    ];
    expect(selectShakaVariant(onlyHi, 'saver').bandwidth).toBe(300000);
  });
  test('null for empty input or a manifest with only spatial audio', () => {
    expect(selectShakaVariant([], 'max')).toBeNull();
    expect(selectShakaVariant(LIVE_VARIANTS.filter((v) => v.codecs.startsWith('mh')), 'max')).toBeNull();
  });
});

describe('shakaPlaybackConfig', () => {
  test('locked with preferredCodecs empty — family-free selection', () => {
    expect(shakaPlaybackConfig(LIVE_VARIANTS, 'standard', false)).toEqual({
      abrEnabled: false, variantId: '2', variantBandwidth: 197343, codecFamily: 'opus', preferredCodecs: []
    });
  });
  test('adaptive caps at tier ceiling, not family', () => {
    expect(shakaPlaybackConfig(LIVE_VARIANTS, 'saver', true)).toEqual({
      abrEnabled: true, codecFamily: 'opus', variantId: '1', variantBandwidth: 53059, seedBandwidth: 55852, maxBandwidth: 100000, preferredCodecs: []
    });
    expect(shakaPlaybackConfig(LIVE_VARIANTS, 'max', true)).toEqual({
      abrEnabled: true, codecFamily: 'flac', variantId: '7', variantBandwidth: 1902230, seedBandwidth: 2002348, maxBandwidth: null, preferredCodecs: []
    });
  });
  test('adaptive FLOOR mirrors the locked floor (M3): never a zero-variant restriction', () => {
    // A manifest whose cheapest rung exceeds the saver corridor must cap at
    // that rung, not at the corridor ceiling (a cap BELOW every variant
    // leaves Shaka's restriction filter with nothing).
    const onlyHi = [
      { id: 'a', codecs: 'opus', bandwidth: 400000, audioSamplingRate: 48000 },
      { id: 'b', codecs: 'opus', bandwidth: 300000, audioSamplingRate: 48000 }
    ];
    const cfg = shakaPlaybackConfig(onlyHi, 'saver', true);
    expect(cfg.variantId).toBe('b');
    expect(cfg.maxBandwidth).toBe(300000);
  });
  test('null when nothing playable', () => {
    expect(shakaPlaybackConfig([], 'max', true)).toBeNull();
  });
});

// Spatial/Atmos opt-in ({ spatial: true }): the E-AC-3 JOC rungs of a real
// Atmos manifest (B0CPSG7191, live capture 2026-11: ec-3 770k/450k JOC,
// ac-4.02.02.00 IMS 260k/115k, 24-bit FLAC 1723k) are admitted, the pick is
// made within the spatial rungs, and ac-4/mpeg-h stay out categorically.
const SPATIAL_VARIANTS = [
  { id: '1', codecs: 'opus', bandwidth: 51352, audioSamplingRate: 48000, channelsCount: 2 },
  { id: '3', codecs: 'opus', bandwidth: 323352, audioSamplingRate: 48000, channelsCount: 2 },
  { id: '6', codecs: 'flac', bandwidth: 1018140, audioSamplingRate: 44100, channelsCount: 2 },
  { id: '7', codecs: 'flac', bandwidth: 1723851, audioSamplingRate: 44100, channelsCount: 2 },
  { id: '8', codecs: 'ec-3', bandwidth: 770130, audioSamplingRate: 48000, channelsCount: 6 },
  { id: '9', codecs: 'ec-3', bandwidth: 450130, audioSamplingRate: 48000, channelsCount: 6 },
  { id: '10', codecs: 'ac-4.02.02.00', bandwidth: 259980, audioSamplingRate: 48000, channelsCount: 2 },
  { id: '11', codecs: 'ac-4.02.02.00', bandwidth: 115479, audioSamplingRate: 48000, channelsCount: 2 }
];

describe('spatial / Atmos opt-in', () => {
  test('family mapping covers the spatial codec strings', () => {
    expect(widevineCodecFamily('ec-3')).toBe('ec3');
    expect(widevineCodecFamily('EC-3')).toBe('ec3');
    expect(widevineCodecFamily('ac-4.02.02.00')).toBe('ac4');
    expect(widevineCodecFamily('mha1.0x0e')).toBe('mpegh');
    expect(widevineCodecFamily('mhm1.0x0c')).toBe('mpegh');
    expect(SPATIAL_CODEC_FAMILIES.has('ec3')).toBe(true);
  });
  test('variantSpatial flags every immersive family; playable admits ONLY ec3, only on opt-in', () => {
    expect(variantSpatial({ codecs: 'ec-3' })).toBe(true);
    expect(variantSpatial({ codecs: 'ac-4.02.02.00' })).toBe(true);
    expect(variantSpatial({ codecs: 'mha1.0x0e' })).toBe(true);
    expect(variantSpatial({ codecs: 'flac' })).toBe(false);
    expect(variantPlayable({ codecs: 'ec-3' }, true)).toBe(true);
    expect(variantPlayable({ codecs: 'ec-3' }, false)).toBe(false);
    expect(variantPlayable({ codecs: 'ec-3' })).toBe(false);
    // No opt-in ever admits ac-4/mpeg-h (no Chromium decoder — categorical).
    expect(variantPlayable({ codecs: 'ac-4.02.02.00' }, true)).toBe(false);
    expect(variantPlayable({ codecs: 'mha1.0x0e' }, true)).toBe(false);
    expect(variantPlayable({ codecs: 'mhm1.0x0c' }, true)).toBe(false);
    // Stereo families unaffected by the flag.
    expect(variantPlayable({ codecs: 'flac' }, true)).toBe(true);
  });
  test('spatial on: max/high pick WITHIN the spatial rungs (ec-3 only); standard/saver let the CEILING win', () => {
    // max: the top ec-3 rung — NOT the 24-bit FLAC, whose bandwidth is higher.
    expect(selectShakaVariant(SPATIAL_VARIANTS, 'max', { spatial: true })).toMatchObject({ id: '8', codecs: 'ec-3' });
    // high (≤500k): the 450k ec-3 rung fits the corridor.
    expect(selectShakaVariant(SPATIAL_VARIANTS, 'high', { spatial: true })).toMatchObject({ id: '9' });
    // standard (≤200k) / saver (≤100k): no spatial rung fits, and the tier
    // ceiling is the one promise the setting makes — stereo takes the pick,
    // never a 450k spatial floor on a data-limiting tier.
    expect(selectShakaVariant(SPATIAL_VARIANTS, 'standard', { spatial: true })).toMatchObject({ id: '1', codecs: 'opus' });
    expect(selectShakaVariant(SPATIAL_VARIANTS, 'saver', { spatial: true })).toMatchObject({ id: '1', codecs: 'opus' });
    // A spatial rung that DOES fit a low corridor is still taken.
    const cheapSpatial = SPATIAL_VARIANTS.concat([{ id: '12', codecs: 'ec-3', bandwidth: 95000, audioSamplingRate: 48000, channelsCount: 6 }]);
    expect(selectShakaVariant(cheapSpatial, 'saver', { spatial: true })).toMatchObject({ id: '12' });
  });
  test('spatial on but no spatial rungs (or none this build decodes): unchanged selection', () => {
    const stereoOnly = SPATIAL_VARIANTS.filter((v) => !variantSpatial(v));
    expect(selectShakaVariant(stereoOnly, 'max', { spatial: true })).toMatchObject({ id: '7' });
    // The ac-4-only IMS manifest never selects spatial either way.
    const ac4Only = stereoOnly.concat([{ id: '10', codecs: 'ac-4.02.02.00', bandwidth: 259980 }]);
    expect(selectShakaVariant(ac4Only, 'max', { spatial: true })).toMatchObject({ id: '7' });
  });
  test('spatial off: identical picks to the pre-opt-in roster (no spatial, ever)', () => {
    expect(selectShakaVariant(SPATIAL_VARIANTS, 'max')).toMatchObject({ id: '7' });
    expect(selectShakaVariant(SPATIAL_VARIANTS, 'max', {})).toMatchObject({ id: '7' });
    expect(selectShakaVariant(SPATIAL_VARIANTS, 'max', { spatial: false })).toMatchObject({ id: '7' });
  });
  test('a spatial pick is always LOCKED — adaptive cannot pin a codec family', () => {
    expect(shakaPlaybackConfig(SPATIAL_VARIANTS, 'max', true, { spatial: true })).toEqual({
      abrEnabled: false, variantId: '8', variantBandwidth: 770130, codecFamily: 'ec3', preferredCodecs: []
    });
    // Locked flag agrees (same shape).
    expect(shakaPlaybackConfig(SPATIAL_VARIANTS, 'max', false, { spatial: true })).toEqual(
      shakaPlaybackConfig(SPATIAL_VARIANTS, 'max', true, { spatial: true })
    );
    // Spatial on but nothing spatial playable: adaptive behaves as before.
    expect(shakaPlaybackConfig(LIVE_VARIANTS, 'max', true, { spatial: true })).toEqual({
      abrEnabled: true, codecFamily: 'flac', variantId: '7', variantBandwidth: 1902230, seedBandwidth: 2002348, maxBandwidth: null, preferredCodecs: []
    });
  });
});
