/**
 * Root modules that index.html loads as classic scripts AND that main / jest
 * require(). In the renderer there is no `module`, so an unguarded
 * `module.exports = ...` throws "module is not defined" at load. That is what
 * sync-providers/confidence-scoring.js did on every launch (from #1051): the
 * window export ran first so scoring still worked, but the renderer logged an
 * uncaught ReferenceError. Each script is evaluated here the way the renderer
 * sees it: a `window` global and no `module`, `exports` or `require`.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// Every local classic script index.html loads before app.js, except vendored
// libraries and the generated bundle itself.
const scripts = [...indexHtml.matchAll(/<script\s+src="([^"]+)"/g)]
  .map(m => m[1])
  .filter(src => !/^https?:/.test(src) && !src.startsWith('vendor/') && src !== 'app.js');

function loadAsRenderer(src) {
  const sandbox = { console, setTimeout, clearTimeout, setInterval, clearInterval };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(root, src), 'utf8'), sandbox, { filename: src });
  return sandbox;
}

describe('renderer classic scripts load without CommonJS globals', () => {
  test('index.html still loads the dual-load modules', () => {
    expect(scripts).toEqual(expect.arrayContaining([
      'sync-providers/confidence-scoring.js',
      'stream-quality.js',
      'mbid-lookup.js',
      'recommendation-blocklist.js',
      'album-art-catalog.js',
      'resolver-limiter.js',
      'protocol-url.js',
    ]));
  });

  test.each(scripts)('%s evaluates with window and no module', (src) => {
    expect(() => loadAsRenderer(src)).not.toThrow();
  });

  test('confidence-scoring publishes window.ConfidenceScoring', () => {
    const w = loadAsRenderer('sync-providers/confidence-scoring.js');
    expect(typeof w.ConfidenceScoring.calculateConfidence).toBe('function');
    expect(w.ConfidenceScoring.MIN_CONFIDENCE_THRESHOLD).toBe(0.6);
  });

  test('confidence-scoring still exports for require()', () => {
    const mod = require('../../sync-providers/confidence-scoring');
    expect(typeof mod.calculateConfidence).toBe('function');
    expect(typeof mod.pickConfidentMatch).toBe('function');
  });
});
