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
  const app = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/app.js'), 'utf8');
  expect((app.match(/React\.createElement\(SortMenu, \{/g) || []).length).toBeGreaterThanOrEqual(7);
  expect(app).toMatch(/React\.createElement\(SortMenu, \{ value: historyPeriod, options: historyPeriodOptions, onChange: \(option\) => \{ setHistoryPeriod\(option\); [^}]*loadTopTracks\(option\)/);
});
