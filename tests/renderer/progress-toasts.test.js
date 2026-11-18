/**
 * A toast that says something is under way ("Loading Album…", "Adding 12
 * tracks…") is plain: no info icon. The "i" read as a notice about a
 * problem. (A success that goes on, "Apple Music connected — finishing
 * setup…", keeps its tick.)
 */
const fs = require('fs');
const path = require('path');

const files = ['src/renderer/app.js', ...fs.readdirSync(path.join(__dirname, '../../src/renderer/components')).map((f) => `src/renderer/components/${f}`)];

test('no progress toast carries a severity', () => {
  const bad = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
    for (const m of src.matchAll(/showToast\((`[^`]*…`|'[^']*…')\s*,\s*'info'/g)) bad.push(`${f}: ${m[1]}`);
  }
  expect(bad).toEqual([]);
});

// Adding to the queue pulses the queue icon (addToQueue, triggerQueueAnimation)
// and adding to the Collection puts a +N badge on its sidebar item
// (showSidebarBadge), so a toast saying the same thing is noise.
test('no toast repeats what the queue and Collection animations already say', () => {
  const bad = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
    for (const m of src.matchAll(/showToast\(`Added [^`]*`|showToast\(`[^`]*saved to collection`/g)) bad.push(`${f}: ${m[0]}`);
  }
  expect(bad).toEqual([]);
  const app = require('../helpers/renderer-source').appWithPages() /* app.js and the pages moved out of it (#1451) */;
  const bulk = app.slice(app.indexOf('const addTracksToCollection = useCallback('), app.indexOf('const handleCollectionDrop = useCallback('));
  expect(bulk).toContain("showSidebarBadge('collection', addedCount);");
});

// Every way something arrives plays its animation: the queue pulse, the
// Collection and Playlists sidebar badges, a friend sliding into the sidebar.
test('each arrival path plays its animation', () => {
  const app = require('../helpers/renderer-source').appWithPages() /* app.js and the pages moved out of it (#1451) */;
  const fn = (name) => { const i = app.indexOf(`const ${name} = `); expect(i).toBeGreaterThan(-1); return app.slice(i, app.indexOf('\n  };\n', i)); };
  // The embed's "add to queue".
  expect(app).toMatch(/embed\.onQueue\([\s\S]{0,200}setCurrentQueue\(prev => \[\.\.\.prev, track\]\);\s*triggerQueueAnimation\(\);/);
  // Every new playlist badges Playlists.
  for (const name of ['handleSaveQueueConfirm', 'createPlaylistFromChat', 'handleImportPlaylistFromUrl']) {
    expect([name, fn(name).includes("showSidebarBadge('playlists')")]).toEqual([name, true]);
  }
  // Adding a friend slides them in.
  expect(fn('addFriendCore')).toContain('setNewlyPinnedFriendIds(prev => new Set([...prev, newFriend.id]));');
  // And no toast says it again.
  expect(app).not.toMatch(/showToast\(`[^`]*(pinned to sidebar|Following \$\{|Saved playlist: )/);
});

// A Play / Add to queue that has to fetch an album's tracks first uses what
// the fetch returns. Reading prefetchedReleases after awaiting it read the
// render before the fetch, so Pop of the Tops (Charts) and Critics Picks
// albums only played on a second click.
test('album actions play what the fetch returned, not the pre-fetch render', () => {
  const app = require('../helpers/renderer-source').appWithPages() /* app.js and the pages moved out of it (#1451) */;
  const page = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/artist-page.js'), 'utf8');
  for (const src of [app, page]) {
    expect(src).not.toMatch(/await prefetch\w+\([^)]*\);\s*\n\s*(?:let |const )?\w+ = prefetchedReleases(?:Ref\.current)?\[/);
  }
  // Pop of the Tops' card actions (albumCardActions) play, queue and add the
  // tracks getTracks resolved to: prefetchChartsTracks' own result.
  expect(app).toContain('albumCardActions({ title: item.title, artist: item.artist, id: item.id, getTracks: () => prefetchChartsTracks(item) })');
  const at = app.indexOf('const albumCardActions = ({ title, artist, id, getTracks, context }) => {');
  expect(at).toBeGreaterThan(-1);
  const actions = app.slice(at, app.indexOf('\n  };\n', at));
  expect(actions).toContain('const tracks = await getTracks();');
  expect(actions).toContain('return tracks;');
  // Play shows the playbar's loading state while the tracks are fetched.
  expect(actions).toMatch(/onPlay: async \(\) => \{\s*setTrackLoading\(true\);\s*const t = await load\(\);\s*if \(t\) playTrackCollection\(t, ctx\); else setTrackLoading\(false\);/);
  expect(actions).toContain('onQueue: async () => { const t = await load(); if (t) addToQueue(t, ctx); },');
  expect(app).toMatch(/const prefetchChartsTracks = \(album\) => sharedReleasePrefetch\(album\.id,/);
  expect(app).toMatch(/const prefetchCriticsPicksTracks = \(album\) => sharedReleasePrefetch\(album\.id,/);
  expect(page).toContain('const newPrefetched = { tracks: await prefetchReleaseTracks(rel, currentArtist) };');
});

// Listening along, the queue button's badge is the friend's avatar (their
// queue decides what's next), not a grayed-out count.
test('the queue badge shows the listen-along friend', () => {
  const app = require('../helpers/renderer-source').appWithPages() /* app.js and the pages moved out of it (#1451) */;
  expect(app).toMatch(/\? React\.createElement\('span', \{\s*'data-listen-along-badge': ''/);
  // A hexagon, like every user avatar.
  expect(app).toMatch(/'data-listen-along-badge'[\s\S]{0,300}clipPath: LISTENER_HEXAGON/);
  expect(app).toContain("backgroundColor: spinoffMode ? 'var(--on-dark-fill-muted)' : 'var(--accent-fill)'");
});
