const fs = require('fs');
const path = require('path');
const { PAGE_COLORS, pageTint } = require('../../src/renderer/lib/page-colors');

const lum = (h) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const onWhite = (h) => 1.05 / (lum(h) + 0.05);

// The colours live in index.html (--page-<id>, -fill, -hero); the map names them.
const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
const token = (name) => (html.match(new RegExp(`\\s${name}:\\s*([^;]+);`)) || [])[1];
const id = (view) => view;

test('every page has a colour, a tint, a white-text fill and a hero, all index.html variables', () => {
  for (const [view, p] of Object.entries(PAGE_COLORS)) {
    expect(p.color).toBe(`var(--page-${id(view)})`);
    expect(p.fill).toBe(`var(--page-${id(view)}-fill)`);
    expect(p.hero).toBe(`page-hero-bg-${id(view)}`);
    expect(html).toContain(`.page-hero-bg-${id(view)} { background-image: var(--page-${id(view)}-hero); }`);
    expect(token(`--page-${id(view)}-hero`)).toMatch(/^linear-gradient\(to bottom right, /);
    expect(pageTint(view)).toBe(`color-mix(in srgb, var(--page-${id(view)}) 10%, transparent)`);
    const fill = token(`--page-${id(view)}-fill`);
    if (fill.startsWith('#')) expect(onWhite(fill)).toBeGreaterThanOrEqual(4.5);
  }
  // Home is the accent: its colours and hero are mixed from --accent-base.
  expect(token('--page-home')).toBe('var(--accent-primary)');
  expect(token('--page-home-hero')).toContain('var(--accent-base)');
});

// The audit's mismatches: two pages sharing a hero start or a near-identical
// colour read as the same page.
test('no two heroes start in the same colour', () => {
  const starts = Object.keys(PAGE_COLORS).map((view) => token(`--page-${id(view)}-hero`).match(/to bottom right, (color-mix\([^)]*\)\)?|[^,]+),/)[1]);
  expect(new Set(starts).size).toBe(starts.length);
});

test('the sidebar, heroes and section links read the map, not their own copies', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  // The heroes are the shared PageHero, which reads the page's gradient and
  // pattern from the map.
  for (const view of ['history', 'new-releases', 'discover', 'critics-picks', 'concerts', 'recommendations', 'playlists']) {
    expect(app).toContain(`page: '${view}'`);
  }
  const hero = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/page-hero.js'), 'utf8');
  expect(hero).toContain('const colors = PAGE_COLORS[page] || PAGE_COLORS.home;');
  expect(hero).toContain("className: `absolute inset-0 ${colors.hero}`");
  expect(app).not.toMatch(/backgroundImage: 'url\("data:image\/svg\+xml/);
  expect(app).not.toMatch(/'#10b981' : 'var\(--nav-inactive\)'/);
  expect(app).not.toMatch(/linear-gradient\(135deg, #9333ea 0%, #c026d3 50%, #e11d48 100%\)/);
});

test('the playbar and Search take service colours from the plugin, not their own copies', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  const search = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/search-page.js'), 'utf8');
  expect(app).not.toMatch(/const resolverIconColors = \{/);
  expect(app).toMatch(/const currentIconColor = \(resolver\.color && resolver\.color !== NO_PLUGIN_COLOR\) \? resolver\.color/);
  expect(search).toMatch(/backgroundColor: allResolvers\.find\(r => r\.id === resolverId\)\?\.color \|\| 'var\(--text-tertiary\)'/);
  expect(search).not.toMatch(/bandcamp: '#1DA0C3'/);
});
