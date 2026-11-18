// A memo'd page that reads resolverLoaderRef during render (a service's
// name or colour) only re-renders on a prop change, and a ref changing is
// not one. Pages opened before the plug-ins load (the view saved at quit)
// kept ids like "seatgeek" on Concerts' chips. Each such page gets the
// plug-in lists as memo invalidators (2026-11-16).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../../src/renderer');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

const callProps = (comp) => {
  const at = app.indexOf(`React.createElement(${comp}, {`);
  expect(at).toBeGreaterThan(-1);
  return app.slice(at, app.indexOf('})', at));
};

test.each([
  ['ConcertsPage', 'concerts-page.js', ['_allResolvers: allResolvers', '_metaServices: metaServices']],
  ['RecommendationsPage', 'recommendations-page.js', ['_metaServices: metaServices']],
  ['FriendHistoryPage', 'friend-history-page.js', ['_metaServices: metaServices']],
])('%s re-renders when the plug-ins load', (comp, file, props) => {
  expect(fs.readFileSync(path.join(root, 'components', file), 'utf8')).toContain('resolverLoaderRef.current');
  const call = callProps(comp);
  for (const p of props) expect(call).toContain(p);
});

// The URL import dialog reads the plug-in loader and playlistsRef during
// render through two stable handlers (playlistLinkService,
// isPlaylistLinkImported), so their inputs are its invalidators.
test('UrlImportDialog re-renders when the plug-ins or playlists change', () => {
  const src = fs.readFileSync(path.join(root, 'components', 'url-import-dialog.js'), 'utf8');
  expect(src).toMatch(/playlistLinkService\(/);
  expect(src).toMatch(/isPlaylistLinkImported\(/);
  const call = callProps('UrlImportDialog');
  expect(call).toContain('_allResolvers: allResolvers');
  expect(call).toContain('_playlists: playlists');
});

// The Playlists page asks linkUpdateMode (a stable handler that reads the
// plug-in loader) whether each card is kept updated, so it re-renders when
// the plug-ins load.
test('PlaylistsPage re-renders when the plug-ins load', () => {
  expect(fs.readFileSync(path.join(root, 'components', 'playlists-page.js'), 'utf8')).toMatch(/linkUpdateMode\(playlist\)/);
  expect(callProps('PlaylistsPage')).toContain('_allResolvers: allResolvers');
});

test('every moved page that reads resolverLoaderRef at render has an invalidator', () => {
  const pages = fs.readdirSync(path.join(root, 'components')).filter((f) => /-page\.js$|-panel\.js$/.test(f));
  for (const f of pages) {
    const src = fs.readFileSync(path.join(root, 'components', f), 'utf8');
    if (!/resolverLoaderRef\.current/.test(src)) continue;
    const comp = (src.match(/const (\w+) = React\.memo\(/) || [])[1];
    if (!comp || app.indexOf(`React.createElement(${comp}, {`) < 0) continue;
    const call = callProps(comp);
    expect([f, /_metaServices: metaServices|allResolvers/.test(call)]).toEqual([f, true]);
  }
});
