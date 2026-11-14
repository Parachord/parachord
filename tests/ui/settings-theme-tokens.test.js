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
test('every switch is the shared Switch, with a white knob on the control tokens', () => {
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  for (const f of ['src/renderer/app.js', 'src/renderer/components/settings-cards.js']) {
    expect([f, read(f).includes('bg-control-knob')]).toEqual([f, false]);
  }
  const fields = read('src/renderer/components/fields.js');
  expect(fields).toMatch(/bg-control-knob/);
  expect(fields).toMatch(/checked \? 'bg-accent-fill' : 'bg-control-off'/);
  expect(html).toMatch(/--control-knob: #ffffff;/);
  const dark = html.slice(html.indexOf('.dark {'));
  expect(dark).toMatch(/--control-off: #707070;/);
});

// Pages converted after Settings. Their own page colour (Concerts' teal)
// waits for step 5's PAGE_COLOR, and skeleton bars keep bg-gray-200 for now.
const PAGES = [
  ['Charts', "activeView === 'discover' && React.createElement('div', {", "activeView === 'new-releases' && React.createElement('div', {"],
  ['Fresh Drops', "activeView === 'new-releases' && React.createElement('div', {", "activeView === 'critics-picks' && React.createElement('div', {"],
  ['Critical Darlings', "activeView === 'critics-picks' && React.createElement('div', {", "activeView === 'concerts' && (() => {"],
  ['Concerts', "activeView === 'concerts' && (() => {", "activeView === 'recommendations' && React.createElement('div', {"],
  ['Recommendations', "activeView === 'recommendations' && React.createElement('div', {", "activeView === 'history' && React.createElement('div', {"],
  ['History', "activeView === 'history' && React.createElement('div', {", "activeView === 'settings' && React.createElement('div', {"],
];
test.each(PAGES)('%s uses no grey/purple text, border or fill classes, and no theme ternaries for them', (_name, from, to) => {
  const i = app.indexOf(from);
  const seg = app.slice(i, app.indexOf(to, i));
  expect(seg.length).toBeGreaterThan(5000);
  const hits = seg.match(/(?<![\w-])(?:hover:|focus:)?(?:text|border|ring|placeholder|divide)-(?:gray|purple|indigo)-\d{2,3}(?![\w-])|(?<![\w-])(?:hover:)?bg-(?:purple|gray-(?:50|100|700|800|900))(?:-\d{2,3})?(?![\w-])/g) || [];
  expect(hits).toEqual([]);
  expect(seg).not.toMatch(/isD(?:ark|kFlyout) \? '(?:text|bg|hover:bg)-/);
});

test.each(['search-page.js', 'artist-page.js', 'collection-page.js', 'playlist-view-page.js', 'settings-cards.js'])('%s uses no grey/purple text, border or surface classes', (file) => {
  const src = fs.readFileSync(path.join(root, 'src/renderer/components', file), 'utf8');
  const hits = src.match(/(?<![\w-])(?:hover:|focus:)?(?:text|border|placeholder|divide)-gray-\d{2,3}(?![\w-])|(?<![\w-])(?:hover:)?bg-(?:purple-(?:50|100|600)|gray-(?:50|100|700|800|900))(?![\w-])/g) || [];
  expect(hits).toEqual([]);
  expect(src).not.toMatch(/isDark \? '(?:text|bg|hover:bg)-/);
});

// #1385 step 7 / #1386: every switch says it's a switch, whether it's on,
// and what it switches.
test('every switch has role="switch", its state and a name', () => {
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  const fields = read('src/renderer/components/fields.js');
  expect(fields).toMatch(/role: 'switch',\n\s*'aria-checked': checked \? 'true' : 'false',/);
  const app = read('src/renderer/app.js');
  // Plugin panels name their switch; General's are named by their SettingRow.
  expect(app).toMatch(/React\.createElement\(Switch, \{ checked: activeResolvers\.includes\(selectedResolver\.id\), onToggle: [^\n]*'aria-label': `Use \$\{selectedResolver\.name\}`/);
  expect(read('src/renderer/components/settings-cards.js')).toMatch(/React\.createElement\(Switch, \{ checked: config\?\.enabled, onToggle: handleToggleEnabled, 'aria-label': `Scrobble to \$\{scrobbler\.name\}`/);
  expect(app).toContain('React.createElement(Switch, { checked: skipExternalPrompt,');
});
