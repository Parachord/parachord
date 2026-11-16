const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
global.React = React;
const { HeroTabs } = require('../../src/renderer/components/hero-tabs');
const h = React.createElement;

test('a labelled tablist with one selected, tabbable tab', () => {
  const out = renderToStaticMarkup(h(HeroTabs, {
    items: ['albums', 'songs'], isSelected: (t) => t === 'songs', onSelect() {}, renderLabel: (t) => t, label: 'Charts',
  }));
  expect(out).toContain('role="tablist" aria-label="Charts"');
  expect(out.match(/role="tab"/g)).toHaveLength(2);
  expect(out).toMatch(/aria-selected="true" tabindex="0"[^>]*>songs/);
  expect(out).toMatch(/aria-selected="false" tabindex="-1"[^>]*>albums/);
  expect(out).toContain('aria-hidden="true"');
  expect(out).toContain('text-white/80');
  expect(out).not.toContain('text-white/60');
});

test('every hero tab row uses HeroTabs or tab roles', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (f) => fs.readFileSync(path.join(__dirname, '../../src/renderer', f), 'utf8');
  const app = require('../helpers/renderer-source').appWithPages() /* app.js and the pages moved out of it (#1451) */;
  for (const l of ['Charts', 'History', 'Friend history']) expect(app.match(new RegExp(`createElement\\(HeroTabs, \\{[\\s\\S]*?label: '${l}'`, 'g'))).toHaveLength(2);
  expect(read('components/collection-page.js').match(/createElement\(HeroTabs, \{/g)).toHaveLength(2);
  const artist = read('components/artist-page.js');
  expect(artist.match(/role: 'tab',/g)).toHaveLength(2);
  expect(artist.match(/role: 'tablist',/g)).toHaveLength(2);
  // Settings' sections are the sidebar's NavItem, which sets aria-current.
  expect(app).toContain("React.createElement(NavItem, { key: tab, page: 'home', label, active: settingsTab === tab, onClick: () => setSettingsTab(tab) })");
});

test('the selected tab stands out: semibold and underlined, not only brighter', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/components/hero-tabs.js'), 'utf8');
  expect(src).toContain("const HERO_TAB_SELECTED = 'text-white font-semibold underline decoration-2 underline-offset-[6px]';");
  expect(src).toContain("const HERO_TAB_IDLE = 'text-white/80 font-medium hover:text-white';");
  expect(src).toContain('heroTabClass(i === selectedIndex),');
});

test('rows that build their own tabs use the shared look (artist page, Search results)', () => {
  const read = (p) => require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer', p), 'utf8');
  expect((read('components/artist-page.js').match(/heroTabClass\(artistPageTab === tab\)/g) || []).length).toBe(2);
  expect(read('components/search-page.js')).toContain('heroTabClass(searchDetailCategory === tab.key)');
});

test('a line under hero tabs sits 16px below them (clear of the selected underline)', () => {
  const app = require('../helpers/renderer-source').appWithPages() /* app.js and the pages moved out of it (#1451) */;
  // Pop of the Tops, History, a friend's page: the line after the tabs. (A
  // subtitle right under a title, with no tabs, keeps mt-2.)
  const afterTabs = [...app.matchAll(/React\.createElement\(HeroTabs, \{[\s\S]{0,1500}?className: '(mt-\d) text-white\/80 text-sm'/g)].map(m => m[1]);
  expect(afterTabs.length).toBeGreaterThanOrEqual(3);
  for (const mt of afterTabs) expect(mt).toBe('mt-4');
});
