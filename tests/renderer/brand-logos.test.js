/**
 * Logos live in components/brand-logos.js (the service kit, BrandMark for
 * the elephant, the browsers and the social networks, Parachord's
 * wordmark), as UI glyphs live in icons.js; nothing pastes a copy.
 */
global.React = require('react');
const fs = require('fs');
const path = require('path');
const { renderToStaticMarkup } = require('react-dom/server');
const { BrandMark, BRAND_MARKS } = require('../../src/renderer/components/brand-logos');
const read = (f) => fs.readFileSync(path.join(__dirname, '../../src/renderer', f), 'utf8');

test('BrandMark draws a one-colour mark in its fill, a multicolour one in its own', () => {
  const x = renderToStaticMarkup(React.createElement(BrandMark, { id: 'x', size: 14 }));
  expect(x).toContain('width="14"');
  expect(x).toContain('fill="currentColor"');
  expect(x).toContain('aria-hidden="true"');
  const chrome = renderToStaticMarkup(React.createElement(BrandMark, { id: 'chrome', size: 32 }));
  expect(chrome).toContain('fill="#EA4335"');
  expect(chrome).not.toContain('fill="currentColor"');
  expect(renderToStaticMarkup(React.createElement(BrandMark, { id: 'nope' }))).toBe('');
});

test('every mark has a viewBox and shapes', () => {
  for (const id of ['x', 'instagram', 'facebook', 'youtube', 'shuffleupagus', 'chrome']) {
    expect(BRAND_MARKS[id].viewBox).toMatch(/^[\d. ]+$/);
    expect(BRAND_MARKS[id].shapes.length).toBeGreaterThan(0);
  }
});

test('no pasted copies of these logos are left', () => {
  const app = read('app.js');
  expect(app).not.toContain('M51.57,34.4'); // the elephant
  expect(app).not.toContain("fill: '#EA4335'"); // Chrome
  expect(app).not.toContain("viewBox: pid === 'spotify'");
  const artist = read('components/artist-page.js');
  for (const d of ['M18.244 2.25', 'M12 2.163c3.204', 'M24 12.073', 'M23.498 6.186']) expect(artist).not.toContain(d);
  expect(artist).toContain("React.createElement(BrandMark, { id: 'instagram', size: 14");
});

test('ui-atoms still exports the kit and the wordmark (no import changes)', () => {
  const ui = require('../../src/renderer/components/ui-atoms');
  for (const k of ['SERVICE_LOGO_PATHS', 'SERVICE_LOGO_IMAGES', 'ResolverIcon', 'SERVICE_LOGOS', 'ParachordWordmark']) expect(ui[k]).toBeDefined();
});

// #1511: the Wikipedia badge path had a malformed vertex in the W's first
// join (its bottom-left stroke drew cut off at an angle). It is Simple Icons'
// Wikipedia path (CC0, viewBox 0 0 24 24), which mobile's icon generator also
// compares against (parachord-mobile#710).
test("Wikipedia's badge path is Simple Icons' W, with the join intact", () => {
  const { SERVICE_LOGO_PATHS } = require('../../src/renderer/components/brand-logos');
  const d = SERVICE_LOGO_PATHS.wikipedia;
  expect(typeof d).toBe('string'); // the default 24x24 box
  expect(d.startsWith('M12.09 13.119c-.936 1.932-2.217 4.548-2.853 5.728')).toBe(true);
  expect(d).toContain('4.818 10.521l.136.046 2.411-4.81-.482-1.067-1.658-3.264');
  expect(d).not.toContain('l2.681-5.476-2.607-5.24');
  expect(d.endsWith('-2.646-5.71l.053-.036z')).toBe(true);
  expect(d).toHaveLength(1295);
});
