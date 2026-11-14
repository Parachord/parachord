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
