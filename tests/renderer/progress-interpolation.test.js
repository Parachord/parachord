/**
 * Spotify and native Apple Music play outside the renderer, so the playbar
 * estimates their position between polls from a baseline (the last poll's
 * position and time). Clicking another track used to leave that estimate
 * running while the new one loaded: the old track was already paused, but the
 * bar kept moving under the loading shimmer (2026-11-14). The bar now
 * resets to 0:00 when a new track starts loading (to the resume position for
 * a resume), and the estimate holds until the new track starts.
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

describe('a new track starts the bar at 0:00 as soon as it loads', () => {
  const hook = fs.readFileSync(path.join(__dirname, '../../src/renderer/hooks/use-playback-engine.js'), 'utf8');

  test('handlePlay resets the bar right after it sets the loading state, keeping a resume position', () => {
    const at = hook.indexOf('setTrackLoading(true); // Show loading state in playbar');
    expect(at).toBeGreaterThan(-1);
    const after = hook.slice(at, at + 800);
    expect(after).toContain('setProgress(startAt > 0 ? startAt : 0);');
    // startAt (the resume position) is worked out before the loading state.
    expect(hook.indexOf('const startAt = pendingStartAt(')).toBeLessThan(at);
  });
});
