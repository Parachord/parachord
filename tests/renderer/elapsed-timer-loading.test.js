/**
 * The wall-clock progress timer in app.js (the one that calls handleNext when
 * audioContext time since startTime passes the track's duration) must not run
 * while a track is loading.
 *
 * A track made current by a drag or a click has no _activeResolver until it
 * starts, so the timer took it for one it drives, while isPlaying and
 * startTime still belonged to the previous song. Elapsed time since that song
 * started was already past a short track's duration, so handleNext ran within
 * 100ms and cancelled the load. Seen live with a 30-second SoundCloud track
 * dropped on now-playing while another song played.
 */

const fs = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

const start = appSrc.indexOf('const elapsed = (audioContext.currentTime - startTime);');
const effectStart = appSrc.lastIndexOf('useEffect(() => {', start);
const effectEnd = appSrc.indexOf('}, [', start);
const effect = appSrc.slice(effectStart, appSrc.indexOf(']);', effectEnd) + 3);

describe('elapsed-time progress timer', () => {
  test('is the effect that auto-advances on elapsed time', () => {
    expect(start).toBeGreaterThan(0);
    expect(effect).toContain('if (elapsed >= currentTrack.duration)');
    expect(effect).toContain("handleNextRef.current(false, { trigger: 'ended' })");
  });

  test('does not start while a track is loading', () => {
    expect(effect).toMatch(/if \(isPlaying && !trackLoading && audioContext && currentTrack/);
  });

  test('re-evaluates when loading ends', () => {
    const deps = effect.slice(effect.lastIndexOf('}, ['));
    expect(deps).toMatch(/\btrackLoading\b/);
  });

  test('trackLoading is declared before the effect reads it (TDZ)', () => {
    const decl = appSrc.search(/^\s+trackLoading,$/m);
    expect(decl).toBeGreaterThan(0);
    expect(decl).toBeLessThan(effectStart);
  });
});
