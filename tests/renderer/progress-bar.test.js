const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
global.React = React;
const { ProgressBar } = require('../../src/renderer/components/progress-bar');
const h = React.createElement;

test('a progressbar with its value, and a fill at that share', () => {
  const out = renderToStaticMarkup(h(ProgressBar, { value: 3, max: 12, label: 'Scanning folders' }));
  expect(out).toContain('role="progressbar"');
  expect(out).toContain('aria-label="Scanning folders"');
  expect(out).toContain('aria-valuenow="3"');
  expect(out).toContain('width:25%');
});

test('nothing to count yet: an empty bar, never NaN', () => {
  expect(renderToStaticMarkup(h(ProgressBar, { value: 0, max: 0 }))).toContain('width:0%');
});

test('the scan and the sync setup use it, not their own divs', () => {
  const fs = require('fs'); const path = require('path');
  // The folder scan is the plug-in dialog's watch-folders section
  // (components/plugin-extras.js, #1498 step 5).
  for (const f of ['plugin-extras.js', 'sync-setup-dialog.js']) {
    const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/components', f), 'utf8');
    expect(src).toMatch(/(?:React\.createElement|\be)\(ProgressBar,/);
    expect(src).not.toMatch(/\* 100\}%`/);
  }
});
