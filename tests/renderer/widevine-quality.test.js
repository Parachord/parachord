// Tests for the global playback-quality → variant mapping. All-16 live
// fixture from an HD-tier Amazon manifest (2026-10), spatial reps included.

const {
  PLAYBACK_QUALITY_TIERS,
  normalizePlaybackQuality,
  widevineCodecFamily,
  variantPlayable,
  selectShakaVariant,
  shakaPlaybackConfig
} = require('../../src/renderer/lib/widevine-quality');

// Shaka-shaped variant tracks ({ codecs }) mixing in raw MPD rep ({ codec })
// coverage through the same selector.
const LIVE_VARIANTS = [
  { id: '1', codecs: 'opus', bandwidth: 53059, audioSamplingRate: 48000, channelsCount: 2 },
  { id: '2', codecs: 'opus', bandwidth: 197343, audioSamplingRate: 48000, channelsCount: 2 },
  { id: '3', codecs: 'opus', bandwidth: 325595, audioSamplingRate: 48000, channelsCount: 2 },
  { id: '4', codecs: 'opus', bandwidth: 53059, audioSamplingRate: 48000, channelsCount: 2 },
  { id: '5', codecs: 'opus', bandwidth: 165280, audioSamplingRate: 48000, channelsCount: 2 },
  { id: '6', codecs: 'flac', bandwidth: 1062133, audioSamplingRate: 44100, channelsCount: 2 },
  { id: '7', codecs: 'flac', bandwidth: 1902230, audioSamplingRate: 48000, channelsCount: 2 },
  { id: '8', codecs: 'mha1.0x0e', bandwidth: 1612557, audioSamplingRate: 48000, channelsCount: null },
  { id: '9', codecs: 'mha1.0x0d', bandwidth: 1077894, audioSamplingRate: 48000, channelsCount: null },
  { id: '10', codecs: 'mha1.0x0d', bandwidth: 675720, audioSamplingRate: 48000, channelsCount: null },
  { id: '11', codecs: 'mha1.0x0c', bandwidth: 339893, audioSamplingRate: 48000, channelsCount: null },
  { id: '12', codecs: 'mhm1.0x0e', bandwidth: 1610228, audioSamplingRate: 48000, channelsCount: null },
  { id: '13', codecs: 'mhm1.0x0d', bandwidth: 1077210, audioSamplingRate: 48000, channelsCount: null },
  { id: '14', codecs: 'mhm1.0x0d', bandwidth: 676478, audioSamplingRate: 48000, channelsCount: null },
  { id: '15', codecs: 'mhm1.0x0c', bandwidth: 341861, audioSamplingRate: 48000, channelsCount: null }
];

describe('normalizePlaybackQuality', () => {
  test('accepts the four tiers, rejects everything else', () => {
    for (const t of PLAYBACK_QUALITY_TIERS) expect(normalizePlaybackQuality(t)).toBe(t);
    expect(normalizePlaybackQuality('BEST_AVAILABLE')).toBeNull(); // hornet vocabulary is gone
    expect(normalizePlaybackQuality('')).toBeNull();
    expect(normalizePlaybackQuality(null)).toBeNull();
    expect(normalizePlaybackQuality('MAX')).toBe('max'); // case-insensitive
  });
});

describe('widevineCodecFamily / variantPlayable', () => {
  test('buckets known codecs', () => {
    expect(widevineCodecFamily('flac')).toBe('flac');
    expect(widevineCodecFamily('opus')).toBe('opus');
    expect(widevineCodecFamily('mp4a.40.2')).toBe('aac');
  });
  test('spatial codecs (Dolby AC-4 / MPEG-H) are never playable', () => {
    expect(variantPlayable({ codecs: 'mha1.0x0e' })).toBe(false);
    expect(variantPlayable({ codecs: 'mhm1.0x0c' })).toBe(false);
    expect(variantPlayable({ codec: 'mha1.0x0e' })).toBe(false); // raw rep shape
    expect(variantPlayable({ codecs: 'flac' })).toBe(true);
    expect(variantPlayable({ codecs: 'opus' })).toBe(true);
  });
});

describe('selectShakaVariant', () => {
  test('max picks the best playable (top FLAC, never spatial even at higher bandwidth)', () => {
    const v = selectShakaVariant(LIVE_VARIANTS, 'max');
    expect(v.codecs).toBe('flac');
    expect(v.bandwidth).toBe(1902230);
    const noFlac = LIVE_VARIANTS.filter((v) => v.codecs !== 'flac');
    // mha1.0x0e (1612557) outranks every lossy rep — must still not win.
    expect(selectShakaVariant(noFlac, 'max').codecs).toBe('opus');
  });
  test('high picks the best lossy, falling back to cheapest FLAC on FLAC-only', () => {
    expect(selectShakaVariant(LIVE_VARIANTS, 'high').bandwidth).toBe(325595);
    const flacOnly = LIVE_VARIANTS.filter((v) => v.codecs === 'flac');
    expect(selectShakaVariant(flacOnly, 'high').bandwidth).toBe(1062133);
  });
  test('balanced caps at its ceiling, flooring at the cheapest overall', () => {
    expect(selectShakaVariant(LIVE_VARIANTS, 'balanced').bandwidth).toBe(197343);
    // Both under the ceiling → the highest wins.
    const onlyLow = [{ id: 'x', codecs: 'opus', bandwidth: 48000 }, { id: 'y', codecs: 'opus', bandwidth: 60000 }];
    expect(selectShakaVariant(onlyLow, 'balanced').bandwidth).toBe(60000);
    // Nothing under the ceiling → the cheapest overall, never a ceiling break.
    const onlyHigh = [{ id: 'x', codecs: 'opus', bandwidth: 300000 }, { id: 'y', codecs: 'opus', bandwidth: 400000 }];
    expect(selectShakaVariant(onlyHigh, 'balanced').bandwidth).toBe(300000);
  });
  test('low picks the cheapest deterministically (id order on ties)', () => {
    const v = selectShakaVariant(LIVE_VARIANTS, 'low');
    expect(v.bandwidth).toBe(53059);
    expect(v.id).toBe('1');
  });
  test('unknown tier falls back to max semantics', () => {
    expect(selectShakaVariant(LIVE_VARIANTS, 'ultra-whatever').codecs).toBe('flac');
  });
  test('null for empty input or a manifest with only spatial audio', () => {
    expect(selectShakaVariant([], 'max')).toBeNull();
    const spatialOnly = LIVE_VARIANTS.filter((v) => v.codecs.startsWith('mh'));
    expect(selectShakaVariant(spatialOnly, 'max')).toBeNull();
  });
});

describe('shakaPlaybackConfig', () => {
  test('locked variant when adaptive is off', () => {
    expect(shakaPlaybackConfig(LIVE_VARIANTS, 'high', false)).toEqual({
      abrEnabled: false, variantId: '3', variantBandwidth: 325595, preferredCodecs: []
    });
  });
  test('adaptive config is a PREFERENCE ORDER (never a closed whitelist)', () => {
    // Preferred order ranks; getVariantTracks must never see a closed
    // family — that breaks live family switching (observed: mid-play pinned
    // flac even after switching tier to high).
    expect(shakaPlaybackConfig(LIVE_VARIANTS, 'low', true)).toEqual({
      abrEnabled: true, codecFamily: 'opus', preferredCodecs: ['opus', 'mp4a'], variantId: '1', variantBandwidth: 53059, maxBandwidth: 53059
    });
    const maxCfg = shakaPlaybackConfig(LIVE_VARIANTS, 'max', true);
    expect(maxCfg.codecFamily).toBe('flac');
    expect(maxCfg.maxBandwidth).toBe(1902230);
    expect(maxCfg.preferredCodecs).toEqual(['flac', 'opus', 'mp4a']);
    const highCfg = shakaPlaybackConfig(LIVE_VARIANTS, 'high', true);
    expect(highCfg.codecFamily).toBe('opus');
    expect(highCfg.preferredCodecs).toEqual(['opus', 'mp4a']);
  });
  test('null when nothing playable', () => {
    expect(shakaPlaybackConfig([], 'max', true)).toBeNull();
  });
});
