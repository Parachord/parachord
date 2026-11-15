/**
 * #1389: grid columns come from the content area (.card-grid's auto-fill),
 * never from Tailwind's window breakpoints.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const files = ['src/renderer/app.js', ...fs.readdirSync(path.join(ROOT, 'src/renderer/components')).map((f) => `src/renderer/components/${f}`)];

test('no window-breakpoint grid columns in the renderer', () => {
  const hits = files.filter((f) => /\b(sm|md|lg|xl|2xl):grid-cols-/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  expect(hits).toEqual([]);
});

test('.card-grid is defined once, as auto-fill over the content width', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  expect(html.match(/\.card-grid \{ display: grid; grid-template-columns: repeat\(auto-fill, minmax\(180px, 1fr\)\); \}/g)).toHaveLength(1);
  const uses = files.map((f) => (fs.readFileSync(path.join(ROOT, f), 'utf8').match(/'card-grid /g) || []).length).reduce((a, b) => a + b, 0);
  expect(uses).toBe(16);
});

test('plug-in tiles use .tile-grid, sized for a 120px tile', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  expect(html).toMatch(/\.tile-grid \{ display: grid; grid-template-columns: repeat\(auto-fill, minmax\(140px, 1fr\)\); justify-items: center; \}/);
  const app = fs.readFileSync(path.join(ROOT, 'src/renderer/app.js'), 'utf8');
  expect((app.match(/className: 'tile-grid gap-6'/g) || []).length).toBe(4);
});

test('page hero titles scale with the content area (.hero-title), not a fixed text-5xl', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  expect(html).toMatch(/\.hero-title \{ font-size: clamp\(28px, calc\(\(100vw - 256px\) \* 0\.055\), 48px\); line-height: 1; \}/);
  const src = files.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  expect(src).not.toMatch(/className: 'text-5xl font-light text-white'/);
  expect((src.match(/className: 'hero-title font-light text-white'/g) || []).length).toBe(9);
});

test('the playlist view\'s art and icon columns follow the content area, and so does its loading placeholder', () => {
  global.React = global.React || require('react');
  const pv = require('../../src/renderer/components/playlist-view-page');
  expect(pv.PLAYLIST_ART_COLUMN).toBe('clamp(184px, 26%, 240px)');
  expect(pv.PLAYLIST_ICON_COLUMN).toBe('clamp(72px, 14%, 140px)');
  const src = fs.readFileSync(path.join(ROOT, 'src/renderer/components/playlist-view-page.js'), 'utf8');
  expect((src.match(/width: PLAYLIST_ICON_COLUMN/g) || []).length).toBe(2);
  expect(src).toMatch(/width: PLAYLIST_ART_COLUMN, overflowY: 'auto'/);
  const app = fs.readFileSync(path.join(ROOT, 'src/renderer/app.js'), 'utf8');
  expect(app).toMatch(/style: \{ width: PLAYLIST_ART_COLUMN \}/);
});

test('collapsed page headers share .hero-bar: titles truncate, tabs scroll, one 24px gutter', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  expect(html).toContain('.hero-bar > * { flex-shrink: 0; }');
  expect(html).toContain('.hero-bar > h1, .hero-bar > h2 { flex-shrink: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }');
  expect(html).toContain('.hero-bar > [role="tablist"], .hero-bar > div:has([role="tablist"]) { flex-shrink: 1; min-width: 0; overflow-x: auto;');
  const src = files.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  expect((src.match(/className: 'hero-bar absolute inset-0 flex items-center px-6 z-10'/g) || []).length).toBe(11);
  expect(src).not.toMatch(/absolute inset-0 flex items-center px-16 z-10/);
});
