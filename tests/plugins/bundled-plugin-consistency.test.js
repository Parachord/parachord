/**
 * Keeps the three copies of each bundled plugin in step:
 *   plugins/<id>.axe            (source of truth, loaded from disk)
 *   marketplace-manifest.json   (version the marketplace advertises)
 *   FALLBACK_RESOLVERS in app.js (used only when the .axe is missing on disk)
 *
 * A manifest version that differs from the .axe makes every client re-download
 * the plugin on each launch and log a bogus "downgrade" (parachord#986). A
 * stale fallback silently runs old code when the disk copy is missing.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const manifest = readJson('marketplace-manifest.json');

describe('marketplace-manifest.json', () => {
  const bundled = manifest.plugins.filter((p) => fs.existsSync(path.join(ROOT, 'plugins', `${p.id}.axe`)));

  test.each(bundled.map((p) => [p.id, p.version]))('%s version matches its .axe file', (id, version) => {
    expect(version).toBe(readJson(`plugins/${id}.axe`).manifest.version);
  });
});

describe('FALLBACK_RESOLVERS in app.js', () => {
  const lines = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8').split('\n');
  const start = lines.findIndex((l) => l.startsWith('const FALLBACK_RESOLVERS = ['));
  const entries = [];
  for (let i = start + 1; lines[i].startsWith('  {"manifest"'); i++) {
    entries.push(JSON.parse(lines[i].trim().replace(/,$/, '')));
  }

  test('has entries', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  test.each(entries.map((e) => [e.manifest.id, e]))('%s is identical to its .axe file', (id, entry) => {
    expect(entry).toEqual(readJson(`plugins/${id}.axe`));
  });
});
