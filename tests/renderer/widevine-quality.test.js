// Tests for the global playback-quality → variant mapping (bandwidth-only;
// codecs never drive the tier). All-16 live fixture from an HD-tier Amazon
// manifest (2026-10), spatial reps included.

const {
  PLAYBACK_QUALITY_TIERS,
  TIER_CEILING_BPS,
  normalizePlaybackQuality,
  widevineCodecFamily,
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
      abrEnabled: true, codecFamily: 'opus', variantId: '1', variantBandwidth: 53059, maxBandwidth: 100000, preferredCodecs: []
    });
    expect(shakaPlaybackConfig(LIVE_VARIANTS, 'max', true)).toEqual({
      abrEnabled: true, codecFamily: 'flac', variantId: '7', variantBandwidth: 1902230, maxBandwidth: null, preferredCodecs: []
    });
  });
  test('null when nothing playable', () => {
    expect(shakaPlaybackConfig([], 'max', true)).toBeNull();
  });
});
