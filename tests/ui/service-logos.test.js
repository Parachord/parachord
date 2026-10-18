/**
 * Every bundled content resolver (a plugins-src plugin with a search
 * capability) must have a card logo in SERVICE_LOGOS (the plugin settings
 * card, the marketplace detail, the playbar source picker) and a small badge
 * via SERVICE_LOGO_PATHS or SERVICE_LOGO_IMAGES (track rows, the playbar).
 * Amazon Music and Subsonic shipped with the emoji fallback (2026-10-17).
 * Bitmap logos must point at files that exist, since a bad path renders as a
 * broken image on every row.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const app = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'app.js'), 'utf8');

function block(startMarker) {
  const s = app.indexOf(startMarker);
  expect(s).toBeGreaterThan(-1);
  const e = app.indexOf('\n};', s);
  return app.slice(s, e);
}

const logosBlock = block('const SERVICE_LOGOS = {');
const pathsBlock = block('const SERVICE_LOGO_PATHS = {');
const imagesBlock = block('const SERVICE_LOGO_IMAGES = {');

const cardLogos = new Set([...logosBlock.matchAll(/^\s*(\w+): React\.createElement/gm)].map((m) => m[1]));
const badgePaths = new Set([...pathsBlock.matchAll(/^\s*(\w+): (?:'|\{)/gm)].map((m) => m[1]));
const badgeImages = new Set([...imagesBlock.matchAll(/^\s*(\w+): \{ src:/gm)].map((m) => m[1]));

const contentResolvers = fs.readdirSync(path.join(ROOT, 'plugins-src')).filter((id) => {
  const manifestPath = path.join(ROOT, 'plugins-src', id, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return false;
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return !!(m.capabilities && m.capabilities.search);
});

describe('service logos', () => {
  test('the fixture sees the bundled content resolvers', () => {
    expect(contentResolvers).toEqual(expect.arrayContaining(['spotify', 'applemusic', 'amazonmusic', 'subsonic', 'localfiles']));
  });

  test.each(contentResolvers)('%s has a card logo', (id) => {
    expect(cardLogos.has(id)).toBe(true);
  });

  test.each(contentResolvers)('%s has a small badge (path or image)', (id) => {
    expect(badgePaths.has(id) || badgeImages.has(id)).toBe(true);
  });

  test('every bitmap logo points at a file that exists', () => {
    const srcs = [...logosBlock.matchAll(/src: '([^']+)'/g), ...imagesBlock.matchAll(/src: '([^']+)'/g)].map((m) => m[1]);
    expect(srcs.length).toBeGreaterThanOrEqual(4); // soundcloud x2, subsonic x2
    for (const src of srcs) {
      expect(fs.existsSync(path.join(ROOT, src))).toBe(true);
    }
  });

  test('a badge path entry drawn in its own box carries a viewBox', () => {
    expect(pathsBlock).toMatch(/amazonmusic: \{\s*viewBox: '[-\d. ]+',\s*d: 'M/);
  });
});
