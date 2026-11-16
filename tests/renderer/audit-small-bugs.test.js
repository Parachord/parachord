/**
 * Small design-audit bugs (#1382), pinned at the source.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const app = require('../helpers/renderer-source').appWithPages(); // app.js and the pages moved out of it (#1451)
// The pages moved out of app.js (#1451) are read with it.
const fresh = fs.readFileSync(path.join(root, 'src/renderer/components/fresh-drops-page.js'), 'utf8');
const pv = fs.readFileSync(path.join(root, 'src/renderer/components/playlist-view-page.js'), 'utf8');

test('no window.alert / alert() left in the renderer pages (bug 25)', () => {
  expect(pv).not.toMatch(/window\.alert\(/);
  expect(app).not.toMatch(/(?<![\w.])alert\('(Tutorial reset|Failed to reset application|Failed to save ID3 tags)/);
  expect(pv).toMatch(/showToast\(`Couldn’t send your changes to \$\{providerName\}\. Try again\.`, 'error'\)/);
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
  // The release page reads RELEASE_BADGE_STYLES; the cards (the shared
  // AlbumCard's on-art badge) and the filter chips read the same palette,
  // lib/release-types.js.
  expect(cards.match(/const badgeStyles = RELEASE_BADGE_STYLES;/g)).toHaveLength(1);
  expect(cards).toContain("const { RELEASE_TYPE_COLORS } = require('../lib/release-types');");
  expect(fs.readFileSync(path.join(root, 'src/renderer/components/card-art.js'), 'utf8')).toContain("require('../lib/release-types')");
  global.React = require('react');
  const { RELEASE_BADGE_STYLES: B } = require('../../src/renderer/components/cards');
  expect(B.ep.color).toBe('#a855f7');
  expect(B.single.color).toBe('#db2777');
});

test('Recommendations says so when it loads with nothing to show (bug 2)', () => {
  expect(app).toMatch(/filteringOne \? 'Nothing from this source yet' : 'No recommendations yet'/);
});

test('Fresh Drops and Concerts show their skeleton before the caches load (bug 28)', () => {
  expect(fresh).toContain("!newReleasesError && (newReleasesLoading || !cacheLoaded) && newReleases.length === 0 && e('div', { className: 'card-grid gap-4' },");
  expect(app).toContain("(concertsLoading || !cacheLoaded) && !concertsError && concerts.length === 0 && React.createElement('div', {");
});

test('the closed queue drawer is inert, and it never grows past the window (bug 24)', () => {
  expect(app).toMatch(/inert: queueDrawerOpen \? undefined : '',/);
  expect(app).toMatch(/const maxHeight = Math\.min\(600, window\.innerHeight - 85 - QUEUE_DRAWER_TOP_GAP\);/);
});

test('the queue keyframes move rows with translate, not transform (bug 13)', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const block = html.slice(html.indexOf('@keyframes queue-track-drop'), html.indexOf('.queue-track-insert {'));
  expect(block).not.toMatch(/transform:/);
  expect(block).toMatch(/translate: 0 40px;/);
  expect(block).toMatch(/translate: 0 -20px;/);
});

test("the marketplace's model picker lists the plugin's models, not a hard-coded set (bug 30)", () => {
  expect(app).not.toMatch(/'GPT-4o Mini \(Recommended\)'/);
  expect(app).not.toMatch(/'Gemini 2\.5 Flash \(Recommended\)'/);
  expect(app).toMatch(/modelSetting\?\.fallbackOptions \|\| modelSetting\?\.options \|\| \[\]/);
});
