/**
 * Small design-audit bugs (#1382), pinned at the source.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const app = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
const pv = fs.readFileSync(path.join(root, 'src/renderer/components/playlist-view-page.js'), 'utf8');

test('no window.alert / alert() left in the renderer pages (bug 25)', () => {
  expect(pv).not.toMatch(/window\.alert\(/);
  expect(app).not.toMatch(/(?<![\w.])alert\('(Tutorial reset|Failed to reset application|Failed to save ID3 tags)/);
  expect(pv).toMatch(/showToast\(`Failed to push changes: \$\{result\?\.error \|\| 'Unknown error'\}`, 'error'\)/);
});

test('an emptied playlist title keeps the old one (bug 26)', () => {
  expect(pv).toMatch(/title: \(editedPlaylistData\.title \|\| ''\)\.trim\(\) \|\| selectedPlaylist\.title,/);
});

test('the AI results skeleton widths are fixed per row, not random per render (bug 32)', () => {
  expect(app).not.toMatch(/width: `\$\{\d+ \+ Math\.random\(\) \* \d+\}%`/);
});

test('the compact artist header can actually trigger (bug 22)', () => {
  expect(app).toMatch(/const isCompactHeader = mainContentWidth < 900;/);
});
