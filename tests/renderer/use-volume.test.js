/**
 * useVolume unit tests — the pure effective-volume math + the hook's
 * Node-load/render guard.
 *
 * computeEffectiveVolume is the verbatim extracted math from
 * src/renderer/hooks/use-volume.js: base volume + resolver dB offset +
 * per-track dB offset, converted to a linear multiplier
 * (10^(dB/20)), clamped to 0-100.
 *
 * The render probe mirrors component-render-smoke's discipline for the
 * hooks tier: the module must load under plain Node and render-through-a-
 * function-component with vendor globals stubbed; only ReferenceErrors
 * count as failures (bare destructured hooks in the module — the class
 * the bundle hides but Node throws — surface here).
 */

const { computeEffectiveVolume, useVolume } = require('../../src/renderer/hooks/use-volume.js');

// Defaults mirroring defaultResolverVolumeOffsets() in the hook module.
const DEFAULT_OFFSETS = {
  spotify: 0,
  applemusic: 0,
  amazonmusic: 0,
  localfiles: 0,
  soundcloud: 0,
  subsonic: 0,
  bandcamp: -3,
  youtube: -6,
};

describe('computeEffectiveVolume', () => {
  test('no offsets → passthrough', () => {
    expect(computeEffectiveVolume(50, 'spotify', null, DEFAULT_OFFSETS, {})).toBe(50);
  });

  test('-3dB resolver offset removes ~29% volume (10^(-3/20) ≈ 0.7079)', () => {
    const v = computeEffectiveVolume(60, 'bandcamp', null, DEFAULT_OFFSETS, {});
    expect(v).toBeCloseTo(60 * Math.pow(10, -3 / 20), 4);
    expect(v).toBeCloseTo(42.47, 1);
  });

  test('-6dB YouTube offset halves volume (10^(-6/20) ≈ 0.5012)', () => {
    expect(computeEffectiveVolume(80, 'youtube', null, DEFAULT_OFFSETS, {})).toBeCloseTo(
      80 * 0.5011872336,
      4,
    );
  });

  test('per-track = resolver + track offsets stack in dB', () => {
    // bandcamp -3dB plus track -3dB ⇒ same as youtube -6dB
    const stacked = computeEffectiveVolume(80, 'bandcamp', 't1', DEFAULT_OFFSETS, { t1: -3 });
    expect(stacked).toBeCloseTo(computeEffectiveVolume(80, 'youtube', null, DEFAULT_OFFSETS, {}), 4);
  });

  test('unknown resolver with a positive offset clamps at 100', () => {
    expect(computeEffectiveVolume(90, 'localfiles', null, { localfiles: 6 }, {})).toBe(100);
  });

  test('very negative offset approaches 0, never negative', () => {
    const v = computeEffectiveVolume(5, 'youtube', 't', DEFAULT_OFFSETS, { t: -80 });
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(0.001);
  });

  test('track adjustment only applies when its id matches', () => {
    expect(computeEffectiveVolume(50, 'spotify', 'other', DEFAULT_OFFSETS, { t1: -12 })).toBe(50);
  });

  test('unknown resolver → zero offset', () => {
    expect(computeEffectiveVolume(42, 'noresolver', null, DEFAULT_OFFSETS, {})).toBe(42);
  });
});

// Keep in sync with the destructure in src/renderer/app.js's useVolume call.
const EXPECTED_KEYS = [
  'volume',
  'setVolume',
  'isMuted',
  'setIsMuted',
  'volumeRef',
  'isMutedRef',
  'preMuteVolumeRef',
  'resolverVolumeOffsets',
  'setResolverVolumeOffsets',
  'resolverVolumeOffsetsRef',
  'trackVolumeAdjustments',
  'spotifyVolumeTimeoutRef',
  'amazonMusicVolumeTimeoutRef',
  'getEffectiveVolume',
  'setSpotifyVolume',
  'setSpotifyVolumeDebounced',
  'applyLocalFileVolume',
  'determineResolverIdFromTrack',
];

describe('useVolume (Node render probe)', () => {
  test('module loads under plain Node and renders in a probe component with stubbed globals', () => {
    global.React = require('react');
    global.ReactDOM = require('react-dom');
    const ReactDOMServer = require('react-dom/server');

    const ref = () => ({ current: null });
    const Probe = () => {
      const out = useVolume({
        cacheLoaded: false,
        activeResolversRef: ref(),
        resolverOrderRef: ref(),
        spotifyTokenRef: ref(),
        audioRef: ref(),
        currentTrackRef: ref(),
        isPlayingRef: ref(),
      });
      // Touch one value so the render genuinely exercises the hook's return.
      // Every name app.js destructures from the hook must exist — a missed
      // key silently binds undefined in the bundle (slice-2's #1061 class),
      // and app.js itself never executes under jest, so this probe is the
      // only gate that can catch it.
      for (const key of EXPECTED_KEYS) {
        if (out[key] === undefined) throw new Error('useVolume did not return "' + key + '"');
      }
      return out.volume;
    };

    expect(() => ReactDOMServer.renderToStaticMarkup(global.React.createElement(Probe))).not.toThrow();
  });
});
