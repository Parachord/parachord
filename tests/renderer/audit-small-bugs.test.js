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

test('counts in item menus and the repair toast pluralise (bug 38)', () => {
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  expect(main).not.toMatch(/\$\{data\.tracks(\?)?\.length( \|\| 0)?\} tracks\)/);
  expect(main).toMatch(/const trackCount = \(n\) => `\$\{n\} \$\{n === 1 \? 'track' : 'tracks'\}`;/);
  expect(app).not.toMatch(/copy\$\{[^}]*'ies'/);
});

test('the release page and release cards share one release-type palette (bug 4)', () => {
  const cards = fs.readFileSync(path.join(root, 'src/renderer/components/cards.js'), 'utf8');
  expect(cards.match(/const badgeStyles = RELEASE_BADGE_STYLES;/g)).toHaveLength(2);
  global.React = require('react');
  const { RELEASE_BADGE_STYLES: B } = require('../../src/renderer/components/cards');
  expect(B.ep.color).toBe('#a855f7');
  expect(B.single.color).toBe('#db2777');
});

test('Recommendations says so when it loads with nothing to show (bug 2)', () => {
  expect(app).toMatch(/filteringOne \? 'Nothing from this source yet' : 'No recommendations yet'/);
});

test('Fresh Drops and Concerts show their skeleton before the caches load (bug 28)', () => {
  expect(app).toContain("!newReleasesError && (newReleasesLoading || !cacheLoaded) && newReleases.length === 0 && React.createElement('div', {");
  expect(app).toContain("(concertsLoading || !cacheLoaded) && !concertsError && concerts.length === 0 && React.createElement('div', {");
});

test('the closed queue drawer is inert, and it never grows past the window (bug 24)', () => {
  expect(app).toMatch(/inert: queueDrawerOpen \? undefined : '',/);
  expect(app).toMatch(/const maxHeight = Math\.min\(600, window\.innerHeight - 85 - QUEUE_DRAWER_TOP_GAP\);/);
});
