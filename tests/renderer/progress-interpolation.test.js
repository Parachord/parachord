/**
 * Spotify and native Apple Music play outside the renderer, so the playbar
 * estimates their position between polls from a baseline (the last poll's
 * position and time). Clicking another track used to leave that estimate
 * running while the new one loaded: the old track was already paused, but the
 * bar kept moving under the loading shimmer (2026-11-14). A loading track
 * holds its position.
 */
const fs = require('fs');
const path = require('path');
const { interpolatedProgress } = require('../../src/renderer/lib/progress-interpolation');

const baseline = { progress: 30, timestamp: 1_000_000, isPlaying: true };

describe('interpolatedProgress', () => {
  test('counts forward from the baseline while playing', () => {
    expect(interpolatedProgress({ baseline, now: 1_005_000, duration: 200 })).toBe(35);
  });

  test('holds while a new track is loading (the old one is already paused)', () => {
    expect(interpolatedProgress({ baseline, now: 1_005_000, duration: 200, loading: true })).toBeNull();
  });

  test('holds while the user drags the seek bar', () => {
    expect(interpolatedProgress({ baseline, now: 1_005_000, duration: 200, seeking: true })).toBeNull();
  });

  test('holds with no poll yet, or when the service reported a pause', () => {
    expect(interpolatedProgress({ baseline: { progress: 0, timestamp: 0, isPlaying: false }, now: 5, duration: 200 })).toBeNull();
    expect(interpolatedProgress({ baseline: { ...baseline, isPlaying: false }, now: 1_005_000, duration: 200 })).toBeNull();
  });

  test('never runs past the end or before the start, and needs a duration', () => {
    expect(interpolatedProgress({ baseline, now: 1_500_000, duration: 200 })).toBeNull();
    expect(interpolatedProgress({ baseline: { ...baseline, progress: -5 }, now: 1_000_000, duration: 200 })).toBeNull();
    expect(interpolatedProgress({ baseline, now: 1_005_000, duration: 0 })).toBeNull();
  });
});

describe('the Spotify and Apple Music estimates use it, and hold while loading', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  const calls = app.match(/interpolatedProgress\(\{[^}]*\}\)/g) || [];

  test('both estimates call it with the loading state', () => {
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(call).toContain('loading: trackLoading');
  });

  test('both effects re-run when loading changes', () => {
    expect(app).toContain('}, [isPlaying, trackLoading, currentTrack, browserPlaybackActive]);');
    expect(app).toContain('}, [isPlaying, trackLoading, currentTrack]);');
  });
});
