// #1449: overlays come from the shared components. A full-window layer
// (fixed inset-0) is Modal's or SidePanel's (components/modal.js); a menu at
// the pointer is ContextMenu (components/menu.js).
const fs = require('fs');
const path = require('path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
global.React = React;

const dir = path.join(__dirname, '../../src/renderer');
const files = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((f) => {
  const full = path.join(d, f.name);
  return f.isDirectory() ? files(full) : f.name.endsWith('.js') && !f.name.endsWith('.generated.js') ? [full] : [];
});

test('no fixed inset-0 overlay outside components/modal.js', () => {
  const hits = files(dir)
    .filter((f) => path.relative(dir, f) !== path.join('components', 'modal.js'))
    .filter((f) => /\bfixed inset-0\b/.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(dir, f));
  expect(hits).toEqual([]);
});

describe('SidePanel', () => {
  const { SidePanel } = require('../../src/renderer/components/modal');
  test('a labelled modal dialog over a scrim that can leave the sidebar uncovered', () => {
    const out = renderToStaticMarkup(React.createElement(SidePanel, { label: 'Add to playlist', onClose() {}, scrimStyle: { left: '256px' }, panelStyle: { width: '384px' } }, 'body'));
    expect(out).toMatch(/role="dialog" aria-modal="true" aria-label="Add to playlist" tabindex="-1"/);
    expect(out).toContain('left:256px');
    expect(out).toContain('width:384px');
    expect(out).toContain('body');
  });
});

test("SidePanel's Escape is the panel's own keydown, after inner fields", () => {
  const src = fs.readFileSync(path.join(dir, 'components/modal.js'), 'utf8');
  expect(src).toMatch(/useDialogFocus\(open, panelRef, \{ onClose, dismissible, escapeInside: true \}\)/);
  expect(src).toMatch(/if \(ev\.key === 'Escape' && dismissible && !ev\.defaultPrevented\)/);
});

describe('ContextMenu', () => {
  const { ContextMenu } = require('../../src/renderer/components/menu');
  test('the shared menu panel with its items', () => {
    const out = renderToStaticMarkup(React.createElement(ContextMenu, {
      label: 'Link', at: { x: 10, y: 20 }, onClose() {},
      items: [{ key: 'a', label: 'Copy link' }, false, { key: 'b', label: 'Copy parachord:// link' }],
    }));
    expect(out).toMatch(/role="menu" aria-label="Link"/);
    expect((out.match(/role="menuitem"/g) || []).length).toBe(2);
    expect(out).toContain('Copy parachord:// link');
  });
  test('the page header link menu uses it', () => {
    const app = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
    expect(app).toMatch(/parachordLinkMenu && React\.createElement\(ContextMenu, \{/);
  });
});
