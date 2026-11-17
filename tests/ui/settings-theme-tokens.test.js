/**
 * #1383 step 4: pages move from Tailwind palette classes to the theme-token
 * colours in tailwind.config.js (ink-*, surface-*, line-*, accent-*,
 * control-off, status-*), which read index.html's variables and so need no
 * .dark remap. Settings is the first page converted.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const app = require('../helpers/renderer-source').appWithPages(); // app.js and the pages moved out of it (#1451)
const config = require(path.join(root, 'tailwind.config.js'));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// The Settings page (components/settings-page.js, #1451).
const settings = fs.readFileSync(path.join(root, 'src/renderer/components/settings-page.js'), 'utf8');

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
  for (const f of ['src/renderer/app.js', 'src/renderer/components/settings-page.js', 'src/renderer/components/settings-cards.js']) {
    expect([f, read(f).includes('bg-control-knob')]).toEqual([f, false]);
  }
  const fields = read('src/renderer/components/fields.js');
  expect(fields).toMatch(/bg-control-knob/);
  expect(fields).toMatch(/checked \? 'bg-accent-fill' : tone === 'dark' \? 'bg-\[var\(--on-dark-fill\)\]' : 'bg-control-off'/);
  expect(html).toMatch(/--control-knob: #ffffff;/);
  const dark = html.slice(html.indexOf('.dark {'));
  expect(dark).toMatch(/--control-off: #707070;/);
});

// Pages converted after Settings. Their own page colour (Concerts' teal)
// waits for step 5's PAGE_COLOR, and skeleton bars keep bg-gray-200 for now.
const PAGES = [
  ['Charts', 'const ChartsPage = React.memo(', 'module.exports', 'components/charts-page.js'],
  // Fresh Drops is its own module (#1451): the whole page component.
  ['Fresh Drops', 'const FreshDropsPage = React.memo(', 'module.exports', 'components/fresh-drops-page.js'],
  ['Critical Darlings', 'const CriticsPicksPage = React.memo(', 'module.exports', 'components/critics-picks-page.js'],
  ['Concerts', 'const ConcertsPage = React.memo(', 'module.exports', 'components/concerts-page.js'],
  ['Recommendations', 'const RecommendationsPage = React.memo(', 'module.exports', 'components/recommendations-page.js'],
  ['History', 'const HistoryPage = React.memo(', 'module.exports', 'components/history-page.js'],
];
test.each(PAGES)('%s uses no grey/purple text, border or fill classes, and no theme ternaries for them', (_name, from, to, file) => {
  const src = file ? fs.readFileSync(path.join(root, 'src/renderer', file), 'utf8') : app;
  const i = src.indexOf(from);
  expect(i).toBeGreaterThan(-1);
  const seg = src.slice(i, src.indexOf(to, i));
  expect(seg.length).toBeGreaterThan(file ? 3000 : 5000);
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
  const app = require('../helpers/renderer-source').appWithPages(); // app.js and the pages moved out of it (#1451)
  // Plugin panels name their switch; General's are named by their SettingRow.
  // The plug-in switch sits in a SettingRow, which names it (aria-labelledby) "Use <service>" (#1498 step 2).
  expect(app).toMatch(/React\.createElement\(SettingRow, \{\s*label: `Use \$\{selectedResolver\.name\}`[\s\S]{0,200}React\.createElement\(Switch, \{ checked: state\.checked/);
  expect(read('src/renderer/components/settings-cards.js')).toMatch(/React\.createElement\(Switch, \{ checked: config\?\.enabled, onToggle: handleToggleEnabled, 'aria-label': `Scrobble to \$\{scrobbler\.name\}`/);
  expect(app).toContain('React.createElement(Switch, { checked: skipExternalPrompt,');
});
