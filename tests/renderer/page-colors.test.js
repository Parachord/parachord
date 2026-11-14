const fs = require('fs');
const path = require('path');
const { PAGE_COLORS, pageTint } = require('../../src/renderer/lib/page-colors');

const lum = (h) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const onWhite = (h) => 1.05 / (lum(h) + 0.05);
const hue = (cls) => cls.match(/from-([a-z]+)-/)[1];

test('every page has a colour, a tint, a white-text fill and a hero', () => {
  for (const [view, p] of Object.entries(PAGE_COLORS)) {
    expect(p.color).toBeTruthy();
    expect(p.hero).toMatch(/^bg-gradient-to-br from-[a-z]+-\d+ via-[a-z]+-\d+ to-[a-z]+-\d+$/);
    expect(pageTint(view)).not.toBe('transparent');
    if (p.fill.startsWith('#')) expect(onWhite(p.fill)).toBeGreaterThanOrEqual(4.5);
  }
});

// The audit's mismatches: two pages sharing a hero start or a near-identical
// colour read as the same page.
test('no two heroes start in the same colour family', () => {
  const starts = Object.values(PAGE_COLORS).map((p) => hue(p.hero));
  expect(new Set(starts).size).toBe(starts.length);
});

test('the sidebar, heroes and section links read the map, not their own copies', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  for (const view of ['history', 'new-releases', 'discover', 'critics-picks', 'concerts', 'recommendations', 'playlists']) {
    expect(app).toContain(`\${PAGE_COLORS['${view}'].hero}`);
  }
  expect(app).not.toMatch(/'#10b981' : 'var\(--nav-inactive\)'/);
  expect(app).not.toMatch(/linear-gradient\(135deg, #9333ea 0%, #c026d3 50%, #e11d48 100%\)/);
});

test('the playbar and Search take service colours from the plugin, not their own copies', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  const search = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/search-page.js'), 'utf8');
  expect(app).not.toMatch(/const resolverIconColors = \{/);
  expect(app).toMatch(/const currentIconColor = \(resolver\.color && resolver\.color !== '#888888'\) \? resolver\.color/);
  expect(search).toMatch(/backgroundColor: \(sourceResolver && sourceResolver\.color\) \|\| 'var\(--text-tertiary\)'/);
  expect(search).not.toMatch(/bandcamp: '#1DA0C3'/);
});
