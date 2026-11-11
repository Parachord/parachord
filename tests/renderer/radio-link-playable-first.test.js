/**
 * A radio link must have something that plays before it replaces what's
 * playing (parachord#1319 item 5, the mobile apps' shared rule). Desktop
 * cleared the queue first: the artist-seed path (Mode B) then only checked
 * that Last.fm had similar tracks, and the pool path (Mode C) checked for a
 * playable first track after the queue was already gone.
 */
const fs = require('fs');
const path = require('path');

const {
  RADIO_SEED_PROBE_COUNT, noPlayableSimilarTracksMessage, hasPlayableSource
} = require('../../src/renderer/lib/playback-helpers');

const engine = fs.readFileSync(path.join(__dirname, '../../src/renderer/hooks/use-playback-engine.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

const between = (src, from, to) => {
  const a = src.indexOf(from);
  return src.slice(a, src.indexOf(to, a + from.length));
};
const startSpinoff = between(engine, 'const startSpinoff = async (track,', 'const exitSpinoff = () => {');
const fromPool = between(engine, 'const activateSpinoffFromPool = async (', 'const refillSpinoffPool = async () => {');

describe('the helpers', () => {
  test('the seed probe looks at the first 5 similar tracks, as mobile does', () => {
    expect(RADIO_SEED_PROBE_COUNT).toBe(5);
  });

  test('the refusal uses mobile\'s wording', () => {
    expect(noPlayableSimilarTracksMessage('Flume')).toBe('Couldn\'t find a playable track similar to "Flume"');
  });

  test('a playable source is any source that isn\'t a noMatch', () => {
    expect(hasPlayableSource({ sources: { spotify: { id: 'x' } } })).toBe(true);
    expect(hasPlayableSource({ sources: { spotify: { noMatch: true }, bandcamp: { url: 'u' } } })).toBe(true);
    expect(hasPlayableSource({ sources: { spotify: { noMatch: true } } })).toBe(false);
    expect(hasPlayableSource({ sources: {} })).toBe(false);
    expect(hasPlayableSource({})).toBe(false);
    expect(hasPlayableSource(null)).toBe(false);
  });
});

describe('the radio link checks before it clears the queue', () => {
  test('Mode B passes the probe and clearQueue to startSpinoff, and no longer clears first', () => {
    expect(app).toMatch(/if \(!seed\) break;[\s\S]{0,600}?await startSpinoffRef\.current\(seed, \{ requirePlayable: true, beforeStart: clearQueue \}\);/);
    expect(app).toMatch(/await startSpinoffRef\.current\(\{ pool: initialPool, displayName, refillUrl \}, \{ beforeStart: clearQueue \}\);/);
    const radioCase = between(app, "if (playKind === 'radio') {", '// Default: parachord://play?artist=X&title=Y');
    expect(radioCase).not.toMatch(/\n\s*clearQueue\(\);/);
  });

  test('startSpinoff probes the first tracks, refuses with mobile\'s wording, and only then runs beforeStart', () => {
    expect(startSpinoff).toMatch(/const startSpinoff = async \(track, \{ requirePlayable = false, beforeStart = null \} = \{\}\) => \{/);
    const probeAt = startSpinoff.indexOf('if (requirePlayable) {');
    const refuseAt = startSpinoff.indexOf('showToast(noPlayableSimilarTracksMessage(track.title));');
    const beforeStartAt = startSpinoff.indexOf('if (beforeStart) beforeStart();');
    const spinoffOnAt = startSpinoff.indexOf('setSpinoffMode(true);');
    expect(probeAt).toBeGreaterThan(-1);
    expect(startSpinoff).toMatch(/similarTracks\.slice\(0, RADIO_SEED_PROBE_COUNT\)/);
    expect(startSpinoff).toMatch(/if \(!probe\.some\(hasPlayableSource\)\) \{/);
    expect(refuseAt).toBeGreaterThan(probeAt);
    expect(beforeStartAt).toBeGreaterThan(refuseAt);
    expect(spinoffOnAt).toBeGreaterThan(beforeStartAt);
  });

  test('Listen Along ends only once the spinoff will start, not when it is refused', () => {
    expect(startSpinoff.indexOf('setListenAlongFriend(null);')).toBeGreaterThan(startSpinoff.indexOf('if (beforeStart) beforeStart();'));
  });

  test('the pool path finds its playable first track before beforeStart and spinoff mode', () => {
    const firstFoundAt = fromPool.indexOf('if (!first) {');
    const beforeStartAt = fromPool.indexOf('if (beforeStart) beforeStart();');
    const spinoffOnAt = fromPool.indexOf('setSpinoffMode(true);');
    expect(firstFoundAt).toBeGreaterThan(-1);
    expect(beforeStartAt).toBeGreaterThan(firstFoundAt);
    expect(spinoffOnAt).toBeGreaterThan(beforeStartAt);
    // a refusal puts back any running spinoff's pool instead of wiping it
    expect(fromPool).toMatch(/spinoffTracksRef\.current = previousRefs\.pool;/);
  });

  test('a radio link no longer puts a loading placeholder in the playbar, so a refusal leaves the current track', () => {
    expect(app).toMatch(/if \(command === 'listen-along' \|\| \['album', 'playlist'\]\.includes\(playKind\)\) \{/);
    expect(app).not.toMatch(/\['album', 'playlist', 'radio'\]\.includes\(playKind\)/);
  });

  test('a started Mode B radio plays its first similar track now', () => {
    expect(app).toMatch(/const started = await startSpinoffRef\.current\(seed, \{ requirePlayable: true, beforeStart: clearQueue \}\);[\s\S]{0,400}?if \(started\) handleNextRef\.current\?\.\(\);/);
    // handleNext reads the ref, which its sync effect would only set after the next render
    expect(startSpinoff).toMatch(/spinoffModeRef\.current = true;\s*setSpinoffMode\(true\);/);
    expect(fromPool).toMatch(/spinoffModeRef\.current = true;\s*setSpinoffMode\(true\);/);
  });

  test('the in-app Spinoff button doesn\'t probe (Last.fm answering is enough there, as on mobile)', () => {
    expect(app).toMatch(/startSpinoff\(currentTrack\);/);
  });
});
