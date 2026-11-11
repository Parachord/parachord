/**
 * End of the queue and Previous (parachord#1319), matching the mobile apps'
 * shared rules (parachord-mobile QueueAdvancePolicy):
 *   - when the queue (and any spinoff pool) runs out, playback stops and the
 *     current track is cleared; it goes to the play history first, so
 *     Previous brings it back. Desktop used to stop with the track still on
 *     screen.
 *   - Previous restarts the track when more than 3 s in, or when nothing is
 *     before it; otherwise it goes to the previous track. Desktop always went
 *     back.
 */
const fs = require('fs');
const path = require('path');

const { previousAction, PREVIOUS_RESTART_AFTER_SECONDS } = require('../../src/renderer/lib/playback-helpers');

describe('previousAction', () => {
  test('the threshold is 3 seconds, as on mobile', () => {
    expect(PREVIOUS_RESTART_AFTER_SECONDS).toBe(3);
  });

  test('more than 3 s into a track restarts it', () => {
    expect(previousAction({ hasCurrentTrack: true, positionSeconds: 3.5, historyLength: 4 })).toBe('restart');
    expect(previousAction({ hasCurrentTrack: true, positionSeconds: 200, historyLength: 1 })).toBe('restart');
  });

  test('in the first 3 s it goes back to the previous track', () => {
    expect(previousAction({ hasCurrentTrack: true, positionSeconds: 0, historyLength: 2 })).toBe('previous');
    expect(previousAction({ hasCurrentTrack: true, positionSeconds: 3, historyLength: 2 })).toBe('previous');
  });

  test('with nothing before it, the track restarts wherever it is', () => {
    expect(previousAction({ hasCurrentTrack: true, positionSeconds: 1, historyLength: 0 })).toBe('restart');
    expect(previousAction({ hasCurrentTrack: true, positionSeconds: 90, historyLength: 0 })).toBe('restart');
  });

  test('with no current track (the end of the queue cleared it), Previous brings back the last track', () => {
    expect(previousAction({ hasCurrentTrack: false, positionSeconds: 0, historyLength: 3 })).toBe('previous');
    expect(previousAction({ hasCurrentTrack: false, positionSeconds: 0, historyLength: 0 })).toBe('none');
  });

  test('a missing position counts as the start', () => {
    expect(previousAction({ hasCurrentTrack: true, positionSeconds: undefined, historyLength: 1 })).toBe('previous');
  });
});

describe('the engine wiring', () => {
  const engine = fs.readFileSync(path.join(__dirname, '../../src/renderer/hooks/use-playback-engine.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  const nextStart = engine.indexOf('const handleNext = async (userInitiated = false) => {');
  const prevStart = engine.indexOf('const handlePrevious = async () => {');
  const handleNext = engine.slice(nextStart, prevStart);
  const handlePrevious = engine.slice(prevStart, engine.indexOf('const handlePlayPause = async () => {', prevStart));

  test('the end of the queue stops, sends the track to history, and clears it', () => {
    const end = handleNext.slice(handleNext.indexOf('const endOfQueue = (why) => {'));
    expect(end).toMatch(/if \(track\) \{\s*playHistoryRef\.current = \[\.\.\.playHistoryRef\.current, track\];/);
    expect(end).toMatch(/setIsPlaying\(false\);\s*isPlayingRef\.current = false;\s*setProgress\(0\);\s*setPlaybackContext\(null\);\s*setCurrentTrack\(null\);\s*currentTrackRef\.current = null;/);
  });

  test('both ways the queue runs out end it: empty, and nothing playable left', () => {
    expect(handleNext).toMatch(/if \(queue\.length === 0\) \{\s*endOfQueue\('End of the queue'\);\s*return;/);
    expect(handleNext).toMatch(/if \(nextTrackIndex === -1\) \{\s*endOfQueue\('No playable tracks left in the queue'\);\s*return;/);
  });

  test('a Listen Along session waiting for the friend keeps its track (it returns before the end of the queue)', () => {
    const waiting = handleNext.indexOf("waiting for their next track");
    const endOfQueue = handleNext.indexOf('const endOfQueue');
    expect(waiting).toBeGreaterThan(-1);
    expect(waiting).toBeLessThan(endOfQueue);
  });

  test('Previous decides with previousAction, on the live position and history', () => {
    expect(handlePrevious).toMatch(/const action = previousAction\(\{\s*hasCurrentTrack: !!track,\s*positionSeconds: progressRef\.current,\s*historyLength: playHistoryRef\.current\.length\s*\}\);\s*if \(action === 'none'\) return;/);
    expect(handlePrevious).toMatch(/if \(action === 'previous'\) \{/);
    expect(handlePrevious).not.toMatch(/if \(!track\) return;/);
    // nothing to tell the scrobbler when no track is current
    expect(handlePrevious).toMatch(/if \(track && window\.scrobbleManager\) \{\s*window\.scrobbleManager\.onTrackEnd\(\);/);
  });

  test('the Previous button stays enabled after the queue ends, while there is history', () => {
    expect(app).toMatch(/onClick: handlePrevious,\s*disabled: !currentTrack && playHistoryRef\.current\.length === 0,/);
  });
});
