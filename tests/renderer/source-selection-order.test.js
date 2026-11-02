// handlePlay's source order (compareCandidateSources): the preferred resolver,
// then sources whose plugin did not flag limitedPlayback, then resolver
// priority, then confidence.
const fs = require('fs');
const path = require('path');
const { compareCandidateSources } = require('../../src/renderer/lib/playback-helpers');

const ROOT = path.join(__dirname, '..', '..');
const cand = (resolverId, priority, confidence, source = {}) => ({ resolverId, priority, confidence, source });
const order = (list, preferred) => [...list].sort((a, b) => compareCandidateSources(a, b, preferred)).map((c) => c.resolverId);

describe('source selection order', () => {
  test('resolver priority, then confidence (unchanged behavior)', () => {
    expect(order([cand('soundcloud', 4, 0.95), cand('spotify', 0, 0.8), cand('applemusic', 1, 0.99)]))
      .toEqual(['spotify', 'applemusic', 'soundcloud']);
    expect(order([cand('a', 2, 0.7), cand('b', 2, 0.9)])).toEqual(['b', 'a']);
  });

  test('a limitedPlayback source goes after every source that is not, whatever its priority', () => {
    const scPreview = cand('soundcloud', 0, 1, { limitedPlayback: true });
    expect(order([scPreview, cand('bandcamp', 3, 0.9), cand('youtube', 6, 0.8)]))
      .toEqual(['bandcamp', 'youtube', 'soundcloud']);
  });

  test('it is never dropped: alone, or among other limited sources, it still sorts normally', () => {
    expect(order([cand('soundcloud', 4, 0.9, { limitedPlayback: true })])).toEqual(['soundcloud']);
    expect(order([cand('x', 3, 0.9, { limitedPlayback: true }), cand('y', 1, 0.9, { limitedPlayback: true })]))
      .toEqual(['y', 'x']);
  });

  test("the preferred resolver still wins, even when it's limited", () => {
    expect(order([cand('spotify', 0, 1), cand('soundcloud', 4, 1, { limitedPlayback: true })], 'soundcloud'))
      .toEqual(['soundcloud', 'spotify']);
  });

  test('handlePlay sorts with it, and SoundCloud flags non-playable results', () => {
    const engine = fs.readFileSync(path.join(ROOT, 'src/renderer/hooks/use-playback-engine.js'), 'utf8');
    expect(engine).toContain('.sort((a, b) => compareCandidateSources(a, b, preferredResolver));');
    const sc = fs.readFileSync(path.join(ROOT, 'plugins-src/soundcloud/implementation.js'), 'utf8');
    expect(sc.match(/limitedPlayback: !!(?:track|t)\.access && (?:track|t)\.access !== 'playable'/g)).toHaveLength(3);
  });
});
