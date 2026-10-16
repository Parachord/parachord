/**
 * Plugins-src pipeline drift guard.
 *
 * scripts/build-axes.js owns three artifacts for every bundled plugin:
 *   plugins/<id>.axe              (the wire format the renderer + mobile load)
 *   app.js FALLBACK_RESOLVERS      (compact in-place copy)
 *   marketplace-manifest.json      (entry version sync)
 *
 * plugins-src/<id>/ is the only place edits should land. This test fails when
 * any artifact drifted — including a hand edit of an .axe (e.g. a reverse-sync
 * community edit) that was not absorbed via
 * `node scripts/build-axes.js --import --plugin <id>`.
 */

const { spawnSync } = require('child_process');
const path = require('path');

test('build-axes --check: every .axe artifact matches plugins-src', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '../../scripts/build-axes.js'), '--check'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error((result.stdout || '') + (result.stderr || ''));
  }
});
