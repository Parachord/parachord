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

test('it is the shared Button: sentence-case actions, an icon-only Close', () => {
  const edit = renderToStaticMarkup(React.createElement(HeaderControl, null, 'Edit'));
  expect(edit).toMatch(/^<button[^>]*class="[^"]*bg-surface-card[^"]*"[^>]*>Edit<\/button>$/);
  expect(edit).not.toContain('header-control');
  expect(renderToStaticMarkup(React.createElement(HeaderControl, { tone: 'primary' }, 'Done'))).toContain('bg-accent-fill');
  const close = renderToStaticMarkup(React.createElement(HeaderControl, { tone: 'dark', close: true }, 'Close'));
  expect(close).toContain('aria-label="Close"');
  expect(close).toContain('data-tooltip="Close"');
  expect(close).toMatch(/data-icon="X"/);
  expect(close).not.toMatch(/>Close</);
});

test('no uppercase header-control style is left, and labels stay sentence case', () => {
  expect(read('index.html')).not.toMatch(/\.header-control \{/);
  for (const f of ['src/renderer/app.js', 'src/renderer/components/playlist-view-page.js', 'src/renderer/components/search-page.js']) {
    expect([f, /HeaderControl, \{[^}]*\}[^)]*'(CLOSE|EDIT|SAVE|CANCEL|CLEAR|UNSHUFFLE|REFRESH)'/.test(read(f))]).toEqual([f, false]);
  }
});

test('the page headers and the queue drawer use it', () => {
  // app.js and the panels moved out of it (#1451): the queue drawer's are in queue-drawer.js.
  expect((require('../helpers/renderer-source').appWithPages().match(/React\.createElement\(HeaderControl, \{/g) || []).length).toBeGreaterThanOrEqual(6);
  // 7: the link-update buttons (Check now + Stop updating, or Keep updated)
  // became one Auto-update menu trigger, a HeaderControl too (2026-11-17);
  // the loading state's is counted since #1451.
  const pvp = read('src/renderer/components/playlist-view-page.js');
  expect((pvp.match(/React\.createElement\(HeaderControl, (?:\{|Object\.assign\()/g) || []).length).toBe(7);
  expect(pvp).toMatch(/label: 'Auto-update',/);
  expect(pvp).toMatch(/toggle: \{ checked: on, onChange: setOn/);
  expect(pvp).not.toMatch(/'Stop updating'|'Check now'/);
});
