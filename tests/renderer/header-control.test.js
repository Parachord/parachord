/**
 * HeaderControl (components/header-control.js): a page header's small
 * uppercase controls, one look.
 */
global.React = require('react');
const fs = require('fs');
const path = require('path');
const { renderToStaticMarkup } = require('react-dom/server');
const { HeaderControl } = require('../../src/renderer/components/header-control');

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

test('a button with the shared class; tones and the close X', () => {
  expect(renderToStaticMarkup(React.createElement(HeaderControl, null, 'Edit'))).toBe('<button type="button" class="header-control no-drag">Edit</button>');
  expect(renderToStaticMarkup(React.createElement(HeaderControl, { tone: 'dark', close: true }, 'Close')))
    .toMatch(/^<button type="button" class="header-control no-drag header-control-dark">Close<svg[^>]*data-icon="X"/);
  expect(renderToStaticMarkup(React.createElement(HeaderControl, { tone: 'primary' }, 'Done'))).toContain('header-control-primary');
});

test('labels are sentence case in the source; CSS makes them uppercase', () => {
  expect(read('index.html')).toMatch(/\.header-control \{[^}]*text-transform: uppercase;/);
  for (const f of ['src/renderer/app.js', 'src/renderer/components/playlist-view-page.js', 'src/renderer/components/search-page.js']) {
    expect([f, /HeaderControl, \{[^}]*\}[^)]*'(CLOSE|EDIT|SAVE|CANCEL|CLEAR|UNSHUFFLE|REFRESH)'/.test(read(f))]).toEqual([f, false]);
  }
});

test('the page headers and the queue drawer use it', () => {
  expect((read('src/renderer/app.js').match(/React\.createElement\(HeaderControl, \{/g) || []).length).toBeGreaterThanOrEqual(6);
  expect((read('src/renderer/components/playlist-view-page.js').match(/React\.createElement\(HeaderControl, \{/g) || []).length).toBe(6);
});
