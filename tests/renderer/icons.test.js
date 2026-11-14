const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
global.React = React;
const Icons = require('../../src/renderer/components/icons');

test.each(Icons.ICON_NAMES)('%s renders an SVG that honours size and className', (name) => {
  const html = renderToStaticMarkup(React.createElement(Icons[name], { size: 18, className: 'w-4 h-4 text-ink-tertiary' }));
  expect(html).toMatch(/^<svg /);
  expect(html).toContain('width="18"');
  expect(html).toContain('class="');
  expect(html).toContain('w-4 h-4 text-ink-tertiary');
  expect(html).toMatch(/aria-hidden="true"/);
});

test('no icon falls back to a text glyph', () => {
  for (const name of Icons.ICON_NAMES) {
    const html = renderToStaticMarkup(React.createElement(Icons[name]));
    expect(html).not.toMatch(/[▶⏸⏭⏮🔊♫👥📻♥🔍⚙✕]/u);
  }
});

test('transport icons are solid by default; others are outlines', () => {
  expect(renderToStaticMarkup(React.createElement(Icons.Play))).toContain('fill="currentColor"');
  expect(renderToStaticMarkup(React.createElement(Icons.X))).toContain('fill="none"');
  expect(renderToStaticMarkup(React.createElement(Icons.Play, { fill: 'none' }))).toContain('fill="none"');
});

test('an icon with a title is announced', () => {
  const html = renderToStaticMarkup(React.createElement(Icons.Info, { title: 'About this' }));
  expect(html).toContain('role="img"');
  expect(html).toContain('<title>About this</title>');
  expect(html).not.toContain('aria-hidden');
});

// #1384: text glyphs standing in for icons (✕ × ✓ ℹ ⚠ ◌ ⟳ ⏳ ▲ ▼) are the
// icon set now. ▶ stays where it's text (drag labels, track numbers).
test('no text glyph is used as an icon in the renderer', () => {
  const fs = require('fs');
  const path = require('path');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (
    e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
  const hits = [];
  for (const f of walk(path.join(__dirname, '../../src/renderer'))) {
    if (f.endsWith('icons.js')) continue;
    const src = fs.readFileSync(f, 'utf8');
    const m = src.match(/'(✕|×|✓|ℹ|⚠|◌|⟳|⏳|▼|▲)'/g);
    if (m) hits.push([path.basename(f), m]);
  }
  expect(hits).toEqual([]);
});
