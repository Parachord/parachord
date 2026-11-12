/**
 * A restored queue resumes where it was (parachord#1319 item 4, the mobile
 * apps' rule). Desktop saved no position, so a restored track always started
 * at 0:00. Now the position is saved beside the queue (saved_queue_position,
 * keyed by track), the first track resumes there unless that's in its first
 * 5 s or last 10 s, and a seek or Previous on a track that isn't loaded yet
 * moves where Play will start.
 */
const fs = require('fs');
const path = require('path');

const {
  resumeStartPosition, RESUME_MIN_SECONDS, RESUME_END_MARGIN_SECONDS, trackPositionKey
} = require('../../src/renderer/lib/playback-helpers');

const root = path.join(__dirname, '../..');
const app = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'src/renderer/hooks/use-playback-engine.js'), 'utf8');
const store = fs.readFileSync(path.join(root, 'main-process/ipc/store.js'), 'utf8');

describe('resumeStartPosition', () => {
  test('mobile\'s margins: not in the first 5 s or the last 10 s', () => {
    expect(RESUME_MIN_SECONDS).toBe(5);
    expect(RESUME_END_MARGIN_SECONDS).toBe(10);
  });

  test('mid-track resumes where it was', () => {
    expect(resumeStartPosition({ position: 92.4, duration: 197 })).toBe(92.4);
    expect(resumeStartPosition({ position: 5, duration: 197 })).toBe(5);
    expect(resumeStartPosition({ position: 187, duration: 197 })).toBe(187);
  });

  test('barely started, or as good as finished, starts over', () => {
    expect(resumeStartPosition({ position: 4.9, duration: 197 })).toBe(0);
    expect(resumeStartPosition({ position: 187.5, duration: 197 })).toBe(0);
    expect(resumeStartPosition({ position: 196, duration: 197 })).toBe(0);
  });

  test('an unknown duration only applies the first rule; junk starts over', () => {
    expect(resumeStartPosition({ position: 300, duration: null })).toBe(300);
    expect(resumeStartPosition({ position: undefined, duration: 197 })).toBe(0);
    expect(resumeStartPosition({ position: 'x', duration: 197 })).toBe(0);
  });
});

describe('trackPositionKey', () => {
  test('the id when there is one', () => {
    expect(trackPositionKey({ id: 'abc', artist: 'A', title: 'T' })).toBe('abc');
  });
  test('artist, title and album for a track without an id (a friend\'s track, some link plays)', () => {
    expect(trackPositionKey({ artist: 'Archers of Loaf', title: 'Harnessed in Slums', album: 'Vee Vee' }))
      .toBe('archers of loaf|harnessed in slums|vee vee');
  });
  test('nothing to key on is null, so an id-less position never matches another id-less track', () => {
    expect(trackPositionKey({ title: 'T' })).toBeNull();
    expect(trackPositionKey(null)).toBeNull();
  });
});

describe('the wiring', () => {
  test('the key is allowed to persist and is loaded with the queue', () => {
    expect(store).toMatch(/'saved_queue', 'saved_queue_position',/);
    expect(app).toMatch(/'saved_queue', 'saved_queue_position', 'saved_playback_context', 'saved_shuffle_state',/);
  });

  test('the restored first track resumes at its own saved position only', () => {
    expect(app).toMatch(/const firstTrackKey = trackPositionKey\(firstTrack\);\s*if \(firstTrackKey && savedQueuePosition && savedQueuePosition\.trackKey === firstTrackKey\) \{\s*const startAt = resumeStartPosition\(\{ position: savedQueuePosition\.position, duration: firstTrack\.duration \}\);\s*if \(startAt > 0\) \{\s*pendingStartPositionRef\.current = \{ trackKey: firstTrackKey, position: startAt, \.\.\.\(savedQueuePosition\.scrobbled \? \{ scrobbled: true \} : \{\}\) \};\s*setProgress\(startAt\);/);
  });

  test('the position is saved every 5 s while playing and on pause, keyed by the track', () => {
    expect(app).toMatch(/const trackKey = trackPositionKey\(track\);\s*if \(!trackKey \|\| track\._protocolLoading\) return;[\s\S]{0,600}?Promise\.resolve\(window\.electron\.store\.set\('saved_queue_position', \{ trackKey, position: progressRef\.current, \.\.\.\(scrobbled \? \{ scrobbled: true \} : \{\}\) \}\)\)/);
    expect(app).toMatch(/if \(!isPlaying\) \{ save\(\); return undefined; \}\s*const timer = setInterval\(save, 5000\);/);
  });

  test('a pending position is applied once its track plays, and dropped for any other track', () => {
    expect(app).toMatch(/if \(trackPositionKey\(currentTrack\) !== pending\.trackKey\) \{\s*pendingStartPositionRef\.current = null;\s*return;\s*\}\s*if \(!isPlaying\) return;\s*pendingStartPositionRef\.current = null;\s*if \(pending\.position > 0\) setTimeout\(\(\) => handleSeekRef\.current\?\.\(pending\.position\), 500\);/);
    expect(app).toMatch(/handleSeekRef\.current = handleSeek;/);
  });

  test('a seek on a track that isn\'t loaded yet moves where Play will start', () => {
    expect(app).toMatch(/if \(trackNeedsExplicitStart\.current && !isPlayingRef\.current\) \{[\s\S]{0,400}?pendingStartPositionRef\.current = \{ trackKey, position: newPosition, [^\n]*\};\s*setProgress\(newPosition\);\s*return;/);
  });

  test('Previous on a track that isn\'t loaded yet moves the start back to 0 without playing', () => {
    expect(engine).toMatch(/if \(action === 'restart' && trackNeedsExplicitStart\.current && !isPlayingRef\.current\) \{\s*pendingStartPositionRef\.current = null;\s*setProgress\(0\);\s*return;/);
  });
});
