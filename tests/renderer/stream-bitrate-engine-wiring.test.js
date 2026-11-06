// Stream-bitrate engine wiring — the source-marker guard for the measured
// streamQuality path (lib/stream-bitrate-meter.js). The meter, the Bandcamp
// adapter, the in-page script and the sanitizer are behavior-tested in their
// own suites; what only a marker test can pin is the ENGINE side, which a
// render probe can't drive (the shared element's listeners only run against a
// real media pipeline):
//   - the timeupdate listener feeds the meter for html5Stream owners only,
//   - an `emptied` (new load on the element) restarts the meter AND the
//     attach dedup — the cross-load bug a review round caught: a second
//     track whose median lands on the same integer as the previous track's
//     last attach (a CBR transcode, the common subsonic case) never got a
//     record,
//   - the embedded-player branch hands onStreamQuality facts to the same
//     attach entry point.

const fs = require('fs');
const path = require('path');

const engineSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'hooks', 'use-playback-engine.js'), 'utf8');

const lineOf = (needle) => {
  const idx = engineSrc.indexOf(needle);
  expect(idx).toBeGreaterThan(-1); // marker moved or removed
  return engineSrc.slice(0, idx).split('\n').length;
};

describe('stream-quality engine wiring (markers)', () => {
  test('the attach entry is declared before the shared element it feeds', () => {
    const attach = lineOf('const attachStreamQualityFacts = (resolverId, facts) => {');
    const element = lineOf('const ensureSharedAudioElement = (track) => {');
    expect(attach).toBeLessThan(element);
  });

  test('the attach entry keys on the resolver actually playing and the save-guard', () => {
    expect(engineSrc).toContain('if (!prev || prev._activeResolver !== resolverId) return prev;');
    expect(engineSrc).toContain('!window.isStreamQualityChange(existing, next)) return prev;');
  });

  test('the timeupdate listener samples, gated to html5Stream owners', () => {
    const sample = lineOf('const sampleStreamBitrate = () => {');
    const timeupdate = lineOf("audio.addEventListener('timeupdate', () => {");
    const gate = lineOf('if (!el || !owner || !isHtml5StreamResolver(owner)) return;');
    const feed = lineOf('attachStreamQualityFacts(owner, { bitrate, origin: \'measured\' });');
    // The sampler is built with the element, and the gate sits inside it.
    expect(sample).toBeGreaterThan(lineOf('const ensureSharedAudioElement = (track) => {'));
    expect(gate).toBeGreaterThan(sample);
    expect(feed).toBeGreaterThan(gate);
    // The listener calls it.
    expect(engineSrc).toContain('sampleStreamBitrate();');
    expect(timeupdate).toBeGreaterThan(sample);
    // The Chromium-only decoded-byte counter is the input, feature-detected.
    expect(engineSrc).toContain('el.webkitAudioDecodedByteCount');
  });

  test('every new load on the element restarts the meter and the attach dedup', () => {
    const emptied = lineOf("audio.addEventListener('emptied', () => {");
    const dedupGuard = lineOf('if (!bitrate || bitrate === lastAttachedBitrate) return;');
    // The resets are the listener's first statements — not merely somewhere
    // after it in a 3400-line file.
    expect(lineOf('      bitrateMeter.reset();')).toBe(emptied + 1);
    expect(lineOf('      lastAttachedBitrate = null;')).toBe(emptied + 2);
    expect(emptied).toBeGreaterThan(dedupGuard);
  });

  test('the embedded-player branch feeds the same attach entry', () => {
    const handler = lineOf('onStreamQuality: (facts) => {');
    const feed = lineOf('attachStreamQualityFacts(resolverId, facts);');
    expect(feed).toBeGreaterThan(handler);
  });
});
