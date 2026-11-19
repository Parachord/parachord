const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
global.React = React;
const { SortMenu } = require('../../src/renderer/components/sort-menu');
const h = React.createElement;
const opts = [{ value: 'recent', label: 'Recently added' }, { value: 'az', label: 'A–Z' }];

test('closed, it is a labelled button that says what is picked', () => {
  const out = renderToStaticMarkup(h(SortMenu, { value: 'az', options: opts, onChange() {}, label: 'Sort playlists' }));
  expect(out).toContain('aria-haspopup="listbox"');
  expect(out).toContain('aria-expanded="false"');
  expect(out).toContain('aria-label="Sort playlists: A–Z"');
  expect(out).toContain('>A–Z<');
  expect(out).not.toContain('role="listbox"');
});

test('with no match it shows the placeholder', () => {
  expect(renderToStaticMarkup(h(SortMenu, { value: 'x', options: opts, onChange() {} }))).toContain('>Sort<');
});

test('the hand-built sort dropdowns in app.js are SortMenus, carrying their reloads', () => {
  const app = require('../helpers/renderer-source').appWithPages() /* app.js and the pages moved out of it (#1451) */;
  expect((app.match(/React\.createElement\(SortMenu, \{/g) || []).length).toBeGreaterThanOrEqual(7);
  expect(app).toMatch(/React\.createElement\(SortMenu, \{ value: historyPeriod, options: historyPeriodOptions, onChange: \(option\) => \{ setHistoryPeriod\(option\); [^}]*loadTopTracks\(option\)/);
});

test('Collection, Search, the artist page and Charts use SortMenu too', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (f) => fs.readFileSync(path.join(__dirname, '../../src/renderer', f), 'utf8');
  expect(read('components/collection-page.js')).toContain('React.createElement(SortMenu, {');
  expect((read('components/search-page.js').match(/React\.createElement\(SortMenu, \{/g) || []).length).toBe(3);
  expect(read('components/artist-page.js')).toContain("label: 'Sort releases', align: 'right'");
  const app = require('../helpers/renderer-source').appWithPages() /* app.js and the pages moved out of it (#1451) */;
  expect(app).toContain("label: 'Chart source',");
  expect(app).toContain("label: 'Chart region',");
  expect(app).not.toMatch(/set(?:Collection|SearchResults|Artist|ChartsSongsSource|ChartsCountry|Playlists|History|FriendHistory|Critics|AddToPlaylist)Sort\w*DropdownOpen\(!/);
});

test('a prefix shows before the value', () => {
  expect(renderToStaticMarkup(h(SortMenu, { value: 'az', options: opts, onChange() {}, prefix: 'Source:' }))).toMatch(/Source:<\/span><span>A–Z/);
});

test('the trigger never wraps or shrinks in a narrow window ("Newest first" broke onto two lines at 1000px)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/components/sort-menu.js'), 'utf8');
  expect(src).toContain("className: 'relative inline-block flex-shrink-0'");
  expect(src).toContain('no-drag flex items-center gap-1 whitespace-nowrap px-3');
});

test("variant 'button' draws the trigger as the small secondary Button (the Biography tab's Source picker)", () => {
  const { buttonClassName } = require('../../src/renderer/components/button');
  const out = renderToStaticMarkup(h(SortMenu, { value: 'az', options: opts, onChange() {}, prefix: 'Source:', variant: 'button', label: 'Biography source' }));
  for (const cls of buttonClassName({ variant: 'secondary', size: 'sm' }).split(' ')) expect(out).toContain(cls);
  expect(out).toContain('whitespace-nowrap');
  expect(out).toContain('aria-haspopup="listbox"');
  // The default stays the quiet toolbar trigger.
  expect(renderToStaticMarkup(h(SortMenu, { value: 'az', options: opts, onChange() {} }))).not.toContain('border-line-strong');
  const fs = require('fs');
  const path = require('path');
  expect(fs.readFileSync(path.join(__dirname, '../../src/renderer/components/artist-page.js'), 'utf8'))
    .toMatch(/variant: 'button',\s*value: artistBio\.source,[\s\S]{0,300}label: 'Biography source',\s*prefix: 'Source:'/);
});
