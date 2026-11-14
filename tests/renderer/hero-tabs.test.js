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
  const app = read('app.js');
  for (const l of ['Charts', 'History', 'Friend history']) expect(app.match(new RegExp(`createElement\\(HeroTabs, \\{[\\s\\S]*?label: '${l}'`, 'g'))).toHaveLength(2);
  expect(read('components/collection-page.js').match(/createElement\(HeroTabs, \{/g)).toHaveLength(2);
  const artist = read('components/artist-page.js');
  expect(artist.match(/role: 'tab',/g)).toHaveLength(2);
  expect(artist.match(/role: 'tablist',/g)).toHaveLength(2);
  expect(app).toContain("'aria-current': settingsTab === 'plugins' ? 'page' : undefined,");
});
