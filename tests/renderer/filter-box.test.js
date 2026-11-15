/**
 * The shared filter box and sticky bar (components/filter-box.js): every
 * page's "Filter…" box and the strip it sits in.
 */
global.React = require('react');
const fs = require('fs');
const path = require('path');
const { renderToStaticMarkup } = require('react-dom/server');
const { FilterBox, StickyBar } = require('../../src/renderer/components/filter-box');

const h = (el) => renderToStaticMarkup(el);

test('closed, it is one search button named Filter', () => {
  const html = h(React.createElement(FilterBox, { value: '', onChange() {}, open: false, onOpenChange() {} }));
  expect(html).toMatch(/<button type="button" aria-label="Filter" data-tooltip="Filter"/);
  expect(html).not.toContain('<input');
});

test('open, it is the focused box; ✕ shows only with text, and is named', () => {
  const empty = h(React.createElement(FilterBox, { value: '', onChange() {}, open: true, onOpenChange() {} }));
  expect(empty).toContain('placeholder="Filter…"');
  expect(empty).not.toContain('Clear filter');
  const typed = h(React.createElement(FilterBox, { value: 'rad', onChange() {}, open: true, onOpenChange() {} }));
  expect(typed).toContain('aria-label="Clear filter"');
  expect(typed).toContain('width:150px');
  expect(h(React.createElement(FilterBox, { value: 'x', onChange() {}, open: true, onOpenChange() {}, size: 'sm' }))).toContain('width:120px');
});

test('the sticky bar: the page background and a bottom border, in two paddings', () => {
  expect(h(React.createElement(StickyBar, null, 'x'))).toMatch(/class="sticky top-0 z-10 flex items-center px-6 py-3"/);
  expect(h(React.createElement(StickyBar, { variant: 'header' }, 'x'))).toMatch(/class="sticky top-0 z-10 flex items-center px-6 justify-between py-4"/);
});

test('no page hand-builds a filter box or a sticky bar any more', () => {
  const dir = path.join(__dirname, '../../src/renderer');
  for (const f of ['app.js', 'components/search-page.js', 'components/collection-page.js', 'components/artist-page.js', 'components/playlist-view-page.js']) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    expect([f, src.includes('filter-pill')]).toEqual([f, false]);
    expect([f, /'sticky top-0/.test(src)]).toEqual([f, false]);
  }
});
