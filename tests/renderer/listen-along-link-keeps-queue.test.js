/**
 * parachord://listen-along (#1343). Starting Listen Along in the app keeps the
 * queue, which plays on when the session ends (#1319); the link cleared it
 * first, so there was nothing to come back to. It also put a "Connecting to …"
 * placeholder in the playbar before checking that the friend was listening, so
 * a friend who wasn't left the placeholder there, and one who was put the
 * placeholder, not the track it replaced, on the play history.
 * Mobile: parachord-mobile#613 / #652.
 */
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
const caseStart = app.indexOf("case 'listen-along': {");
const listenAlongCase = app.slice(caseStart, app.indexOf("case 'collection-radio':", caseStart));

describe('parachord://listen-along', () => {
  test('the case was found', () => {
    expect(caseStart).toBeGreaterThan(-1);
    expect(listenAlongCase).toContain('activateListenAlongRef.current(friend);');
  });

  test('keeps the queue, like an in-app start', () => {
    expect(listenAlongCase).not.toContain('clearQueue(');
  });

  test('still ends a spinoff before starting', () => {
    expect(listenAlongCase).toMatch(/if \(spinoffModeRef\.current && exitSpinoffRef\.current\) \{\s*exitSpinoffRef\.current\(\);\s*\}\s*activateListenAlongRef\.current\(friend\);/);
  });

  test('puts no placeholder in the playbar before the friend check', () => {
    expect(app).not.toMatch(/command === 'listen-along' \|\|/);
    expect(app).not.toContain('`Connecting to ${params.user || \'friend\'}…` :');
    // The acknowledgement toast still says it.
    expect(app).toContain('Connecting to ${');
  });
});

// The album and playlist links still show a loading placeholder while they look
// the release up. The track that was on screen rides on it: the play records
// that track on the history, and a link that fails puts it back, playing if it
// was (nothing stops the engine before handlePlay). "Nothing to play" used to
// leave the placeholder up, and an error cleared the playbar.
describe('album and playlist link placeholders', () => {
  const queueHook = fs.readFileSync(path.join(__dirname, '../../src/renderer/hooks/use-playback-queue.js'), 'utf8');
  const restore = app.slice(app.indexOf('const restoreProtocolPlaceholder = () => {'), app.indexOf('const cleanup = window.electron.onProtocolUrl('));

  test('the placeholder carries the track it replaced and whether it was playing', () => {
    expect(app).toContain('_replaces: trackBehindPlaceholder(shown),');
    expect(app).toContain('_replacedWasPlaying: shown?._protocolLoading ? !!shown._replacedWasPlaying : !!isPlayingRef.current,');
  });

  test('a failure puts the track back instead of clearing the playbar', () => {
    expect(restore).toContain('setCurrentTrack(prev => (prev?._protocolLoading ? trackBehindPlaceholder(prev) : prev));');
    expect(restore).toMatch(/shown\._replacedWasPlaying && trackBehindPlaceholder\(shown\)\) setIsPlaying\(true\)/);
    expect(restore).toContain('setTrackLoading(false);');
    expect(app).not.toContain('setCurrentTrack(prev => prev?._protocolLoading ? null : prev);');
  });

  test('every failure path before the play restores it', () => {
    expect(app).toMatch(/showToast\(`Nothing to play: \$\{displayName \|\| 'Untitled'\}`\);\s*restoreProtocolPlaceholder\(\);\s*break;/);
    expect(app).toMatch(/showToast\(`Play failed: \$\{err\.message\}`\);\s*restoreProtocolPlaceholder\(\);/);
    expect(app).toMatch(/showToast\(`Protocol error: \$\{error\.message\}`\);[\s\S]{0,300}?restoreProtocolPlaceholder\(\);/);
  });

  test('the saved queue keeps the track behind a placeholder, not the placeholder', () => {
    expect(queueHook).toContain('const currentTrack = trackBehindPlaceholder(currentTrackRef.current);');
  });
});

