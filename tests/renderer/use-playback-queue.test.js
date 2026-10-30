/**
 * usePlaybackQueue Node render probe — the guard for the queue hook's
 * destructure contract (Track 2b slice 2, parachord#1098).
 *
 * Same discipline as use-volume.test.js's probe: the names are derived
 * from src/renderer/app.js's actual usePlaybackQueue destructure (an
 * indent-anchored source scan), NOT a hand-kept list — a hook return that
 * forgets a name silently binds undefined in the bundle (the #1061
 * class), and app.js never executes under jest, so this probe is the only
 * gate. Render is via react-dom/server: the module must load and render
 * through a function component under plain Node; stateful behavior
 * (toggle/addition flows) is out of scope here — setState on a server-
 * rendered component is a no-op, and the suite's effect-bearing tests
 * live in the maintainer's live verification.
 */

const fs = require('fs');
const path = require('path');

const { usePlaybackQueue } = require('../../src/renderer/hooks/use-playback-queue.js');

// Position-based derivation (same reasoning as use-volume.test.js': forward
// regex matching between 'const {' and '} = usePlaybackQueue({' would
// capture whichever sibling destructure sits between them).
function destructureKeysFrom(src, marker) {
  const closeIdx = src.indexOf(marker);
  if (closeIdx === -1) {
    throw new Error(marker + ' not found — the hook call moved or changed shape');
  }
  const openIdx = src.lastIndexOf('\n  const {\n', closeIdx);
  if (openIdx === -1) {
    throw new Error(marker + ' opening not found');
  }
  return src
    .slice(openIdx + '\n  const {\n'.length, closeIdx)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\w+(\s+as\s+\w+)?$/.test(s))
    .map((s) => s.split(/\s+as\s+/).pop());
}

const appSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');
const EXPECTED_KEYS = destructureKeysFrom(appSrc, '  } = queueDomain;');
// Guard direction note (review nit): this checks hook-returns-everything-
// destructure-expects — the direction that turned React module-scope
// destructures into runtime #130s. A name dropped from the app.js
// destructure shrinks the derived list, passes silently, and the runtime
// caller ReferenceErrors — caught by the maintainer's live audit instead,
// since the legacy tier carries no no-undef. Same accepted trade-off as the
// useVolume probe; tightening it means parsing call sites, not worth it.

describe('usePlaybackQueue (Node render probe)', () => {
  test('module loads under plain Node and returns every name app.js destructures', () => {
    expect(EXPECTED_KEYS.length).toBeGreaterThan(15);

    global.React = require('react');
    global.ReactDOM = require('react-dom');
    const ReactDOMServer = require('react-dom/server');

    const ref = () => ({ current: null });
    const Probe = () => {
      const out = usePlaybackQueue({
        cacheLoaded: false,
        rememberQueue: false,
        handlePlayRef: ref(),
        enrichTracksWithMbidsRef: ref(),
      });
      for (const key of EXPECTED_KEYS) {
        if (out[key] === undefined) throw new Error('usePlaybackQueue did not return "' + key + '"');
      }
      // Sanity: the queue starts empty + unshuffled, animation idle.
      if (out.currentQueue.length !== 0) throw new Error('currentQueue did not initialize to []');
      if (out.queueAnimating !== false) throw new Error('queueAnimating did not initialize to false');
      return out.currentQueue.length;
    };

    expect(() => ReactDOMServer.renderToStaticMarkup(global.React.createElement(Probe))).not.toThrow();
  });

  test('playTrackCollection safely no-ops on empty input', () => {
    global.React = require('react');
    const ReactDOMServer = require('react-dom/server');
    let out;
    const ref = () => ({ current: null });
    const Probe = () => {
      out = usePlaybackQueue({
        cacheLoaded: false,
        rememberQueue: false,
        handlePlayRef: ref(),
        enrichTracksWithMbidsRef: ref(),
      });
      return 0;
    };
    ReactDOMServer.renderToStaticMarkup(global.React.createElement(Probe));
    expect(() => {
      out.playTrackCollection(null);
      out.playTrackCollection([]);
    }).not.toThrow();
  });
});
