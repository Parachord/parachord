/**
 * #1383 step 4: pages move from Tailwind palette classes to the theme-token
 * colours in tailwind.config.js (ink-*, surface-*, line-*, accent-*,
 * control-off, status-*), which read index.html's variables and so need no
 * .dark remap. Settings is the first page converted.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const app = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
const config = require(path.join(root, 'tailwind.config.js'));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const settings = app.slice(
  app.indexOf("activeView === 'settings' && React.createElement('div', {"),
  app.indexOf(') // Close settings container'),
);

test('the token colours read CSS variables that index.html defines', () => {
  const colors = config.theme.extend.colors;
  for (const group of ['ink', 'surface', 'line', 'accent', 'control', 'status']) {
    for (const v of Object.values(colors[group])) {
      const name = v.match(/^var\((--[\w-]+)\)$/)[1];
      expect(html).toContain(`${name}:`);
    }
  }
});

test('Settings uses no gray/purple/indigo/red palette classes', () => {
  expect(settings.length).toBeGreaterThan(10000);
  const hits = settings.match(/(?<![\w-])(?:hover:|focus:)?(?:text|bg|border|ring|placeholder)-(?:gray|purple|indigo|red|green|amber|blue)-\d{2,3}(?![\w-])/g) || [];
  expect(hits).toEqual([]);
});

test('Clear Cache confirms with a toast, not alert()', () => {
  expect(settings).not.toMatch(/alert\('Cache cleared successfully!'\)/);
  expect(settings).toMatch(/showToast\('Cache cleared'\)/);
});

// A switch's knob was bg-white, which dark mode remaps to the card colour,
// on an off track of rgba(0,0,0,.15): in dark mode the whole switch nearly
// vanished (2026-11, Settings > Playback's Atmos toggle).
test('every switch has a white knob on the control tokens', () => {
  const files = ['src/renderer/app.js', 'src/renderer/components/settings-cards.js']
    .map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
  const knobs = files.match(/absolute top-0\.5 left-0\.5 w-[45] h-[45][^'`]*/g) || [];
  expect(knobs.length).toBeGreaterThanOrEqual(12);
  for (const k of knobs) expect(k).toMatch(/bg-control-knob/);
  expect(files).not.toMatch(/'var\(--accent-primary\)' : 'rgba\(0, 0, 0, 0\.15\)'/);
  expect(html).toMatch(/--control-knob: #ffffff;/);
  const dark = html.slice(html.indexOf('.dark {'));
  expect(dark).toMatch(/--control-off: #707070;/);
});

// Pages converted after Settings. Their own page colour (Concerts' teal)
// waits for step 5's PAGE_COLOR, and skeleton bars keep bg-gray-200 for now.
const PAGES = [
  ['Concerts', "activeView === 'concerts' && (() => {", "activeView === 'recommendations' && React.createElement('div', {"],
];
test.each(PAGES)('%s uses no grey/purple text, border or fill classes, and no theme ternaries for them', (_name, from, to) => {
  const i = app.indexOf(from);
  const seg = app.slice(i, app.indexOf(to, i));
  expect(seg.length).toBeGreaterThan(5000);
  const hits = seg.match(/(?<![\w-])(?:hover:|focus:)?(?:text|border|ring|placeholder|divide)-(?:gray|purple|indigo)-\d{2,3}(?![\w-])|(?<![\w-])(?:hover:)?bg-(?:purple|indigo|gray-(?:50|100|700|800))(?:-\d{2,3})?(?![\w-])/g) || [];
  expect(hits).toEqual([]);
  expect(seg).not.toMatch(/isD(?:ark|kFlyout) \? '(?:text|bg|hover:bg)-/);
});
