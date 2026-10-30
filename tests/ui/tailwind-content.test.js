/**
 * The release CSS must not depend on the generated renderer bundle.
 *
 * v0.9.10 shipped an unstyled window (#1160): tailwind.config.js scanned the
 * root app.js for class names, but that file has been a gitignored esbuild
 * output since #1052, and every prebuild hook runs `build:css` before
 * `build-renderer`. On CI's fresh checkout Tailwind found almost nothing and
 * emitted ~10KB of CSS instead of ~46KB. Local builds looked fine because a
 * dev checkout always has a stale app.js lying around.
 *
 * So: content must name the renderer sources, never the bundle, and the CSS
 * compiled from the config alone (whatever is or isn't on disk) must carry
 * the classes the UI uses.
 */

const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const config = require(path.join(ROOT, 'tailwind.config.js'));

describe('tailwind content', () => {
  test('scans the renderer sources, not the generated bundle', () => {
    expect(config.content).toContain('./src/renderer/**/*.js');
    expect(config.content).not.toContain('./app.js');
  });

  test('the compiled CSS carries the classes the UI uses', () => {
    const css = execFileSync(
      process.execPath,
      [path.join(ROOT, 'node_modules', 'tailwindcss', 'lib', 'cli.js'), '-i', 'tailwind-input.css', '-c', 'tailwind.config.js'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    // Sizing classes are what collapsed in #1160 (icons rendered full-width).
    // flex/grid alone were still present, from index.html.
    for (const cls of ['.w-5', '.h-5', '.w-4', '.h-4', '.rounded-lg', '.truncate']) {
      expect(css).toContain(`${cls} {`);
    }
    expect(css.length).toBeGreaterThan(40000);
  }, 60000);
});
