/**
 * The Playlists page and a playlist's page: shared Badge for Hosted / AI /
 * Shared and the sync services (named and coloured from their plugin), the
 * New playlist dialog behind Create and Cmd+N, and no green hover.
 */
global.React = require('react');
const fs = require('fs');
const path = require('path');
const { renderToStaticMarkup } = require('react-dom/server');
const { Badge } = require('../../src/renderer/components/badge');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const app = require('../helpers/renderer-source').appWithPages(); // app.js and the pages moved out of it (#1451)
const page = read('src/renderer/components/playlist-view-page.js');

test('Badge never wraps and tints with a service colour', () => {
  const html = renderToStaticMarkup(React.createElement(Badge, { color: '#fa233b' }, 'Apple Music'));
  expect(html).toContain('white-space:nowrap');
  expect(html).toContain('color-mix(in srgb, #fa233b 16%, transparent)');
});

test('no emoji or palette-class pills on the Playlists page', () => {
  expect(app).not.toMatch(/'🌐 Hosted'|'✨ AI'/);
  expect(app).not.toContain('group-hover:text-ink-success transition-colors');
  expect((app.match(/React\.createElement\(Badge, \{ tone: '(surface|info|accent)', icon: Icons\.(Globe|Sparkles)/g) || []).length).toBe(4);
});

test("a playlist's sync services come from their plugin, and the local-only switch is a button", () => {
  expect(page).not.toMatch(/pid === 'spotify' \? 'Spotify' : 'Apple Music'/);
  expect(page).toMatch(/const service = \(allResolvers \|\| \[\]\)\.find\(r => r\.id === pid\);/);
  expect(page).toMatch(/selectedPlaylist\.localOnly \? 'Resume syncing' : 'Keep local only'/);
});

test('Create and Cmd+N open the New playlist dialog', () => {
  expect(app).toContain("onClick: () => setNewPlaylistDialogName('')");
  expect(app).toMatch(/case 'new-playlist':[\s\S]{0,300}setNewPlaylistDialogName\(''\);/);
  expect(app).toMatch(/newPlaylistDialogName !== null && React\.createElement\(NewPlaylistDialog, \{/);
  expect(read('src/renderer/components/new-playlist-dialog.js')).toMatch(/return \(\(\) => \{[\s\S]{0,1600}title: 'New playlist'/);
  expect(app).not.toContain("bg-green-600 hover:bg-green-700");
});

test("a chat playlist card finds its playlist when clicked, not from the render's list", () => {
  const i = app.indexOf('const handlePlaylistCardClick = () => {');
  const fn = app.slice(i, app.indexOf('\n        };', i));
  expect(fn).toContain('const all = playlistsRef.current || [];');
  expect(fn).not.toMatch(/\bplaylists\.find\(/);
  // Never saved (the model wrote the card without creating it): a temporary
  // playlist page from the message's tracks, with Save, like a Weekly Jam.
  expect(fn).toMatch(/loadPlaylist\(\{[\s\S]{0,400}tracks: messageTracks,[\s\S]{0,200}isEphemeral: true,[\s\S]{0,200}origin: 'chat'/);
});

test('chat cards say what they are in their second line; the chat panel uses on-dark tokens', () => {
  expect(app).toMatch(/const chatCardKindLine = \(type, artist\) => \{/);
  expect(app).toContain('}, chatCardKindLine(type, artist))');
  expect(app).toContain("trackCount ? `Playlist · ${countOf(trackCount, 'track')}` : 'Playlist'");
  expect(app).not.toMatch(/textTransform: 'uppercase' \}\s*\}, (type|'playlist')\)/);
  expect(app).toContain("'Powered by')");
  expect(app).not.toContain("'powered by:'");
  // Send is the shared primary button (the fill accent, never --accent-primary).
  expect(app).toMatch(/React\.createElement\(Button, \{ variant: 'primary', size: 'sm', className: 'w-9 h-9 !p-0 !rounded-full[^}]*disabled: !aiChatInput\.trim\(\) \|\| aiChatLoading, 'aria-label': 'Send'/);
});

test('a failed chat save is a failure, never a playlist id nothing can open', () => {
  const i = app.indexOf('const createPlaylistFromChat = async');
  const fn = app.slice(i, app.indexOf('\n  };', i));
  expect(fn).toContain('if (!saveResult?.success) return null;');
  expect(app).toContain("if (!playlist) return { success: false, error: 'The playlist could not be saved.");
  expect(page).toContain("selectedPlaylist?.isEphemeral && selectedPlaylist.origin !== 'chat' ? 'Recommendations' : 'Playlists'");
});

test("a playlist's page: shared sync banner, fields and Delete; the breadcrumb stays", () => {
  expect(page).not.toMatch(/'Push Local'|'Pull Remote'|'Sync Conflict'|'Local Changes'/);
  expect(page).toMatch(/'Keep my version'/);
  expect(page).toMatch(/`Use \$\{providerName\}’s version`/);
  expect(page).toContain('const providerName = pluginName(provider);');
  expect(page).not.toContain('bg-green-600');
  expect(page).toContain("}, 'Delete playlist…')");
  expect(page).not.toContain("'Hosted XSPF'");
  expect(page).not.toContain("'Imported XSPF'");
  expect(page).not.toMatch(/onMouseEnter/);
  // The breadcrumb: Playlists (or Recommendations) / the playlist.
  expect(page).toContain("selectedPlaylist?.isEphemeral && selectedPlaylist.origin !== 'chat' ? 'Recommendations' : 'Playlists'");
});

test('the artist page: shared Play and Tickets buttons, plugin colours, no clickable headings', () => {
  const artist = read('src/renderer/components/artist-page.js');
  expect(artist).not.toMatch(/#E91E63|#10c9b4|#9333ea/);
  expect(artist).toMatch(/isCompactHeader \? 'Play' : 'Play top tracks'/);
  expect(artist).toContain("React.createElement(TicketsButton, { sources: event.ticketSources");
  expect(artist).toContain("const serviceColor = (id) => getServiceColor(id) || 'var(--accent-primary)';");
  expect(artist).not.toMatch(/value: 'both', label: 'Both'/);
  expect(artist).not.toMatch(/React\.createElement\('h1', \{\s*className: '[^']*cursor-pointer/);
  expect(artist).not.toContain("fontSize: '10px'");
});

test("the artist page's On Tour header is a sticky bar, in sentence case", () => {
  const artist = read('src/renderer/components/artist-page.js');
  // The shared StickyBar (components/filter-box.js).
  expect(artist).toMatch(/React\.createElement\(StickyBar, null,[\s\S]{0,400}countOf\(events\.length, 'upcoming concert'\)/);
  expect(artist).not.toMatch(/Upcoming Concert\$\{/);
  expect(artist).not.toContain('text-teal-500');
});

test('sort and period menus are sentence case, with en dashes in A–Z', () => {
  for (const label of ['Newest First', 'Oldest First', 'Recently Added', 'Artist Name', 'Last 7 Days', 'All Time', 'Created by Me']) {
    expect([label, app.includes(`label: '${label}'`)]).toEqual([label, false]);
  }
  expect(app).not.toMatch(/label: '(A-Z|Z-A)'/);
  expect(app).toContain("{ value: 'date-desc', label: 'Newest first' }");
});

test('the artist page shares its Achordion link: a Share menu, and right-click anywhere on the hero', () => {
  const artist = read('src/renderer/components/artist-page.js');
  expect(artist).toMatch(/React\.createElement\(Menu, \{\s*label: 'Share',\s*renderTrigger: \(t\) => React\.createElement\(ShareButton, t\),[\s\S]{0,700}publishArtistSmartLink\([\s\S]{0,300}\{ openInBrowser: true \}\)/);
  // The shared PageHero, its photo option, the menu on the whole hero.
  expect(artist).toMatch(/React\.createElement\(PageHero, \{[\s\S]{0,400}photo: \{ url: artistImage \|\| null, position: artistImagePosition \},[\s\S]{0,200}onContextMenu: copyParachordLink/);
});

test('page scroll areas share one scroll edge: a shadow once content scrolls under the bar above', () => {
  const html = read('index.html');
  expect(html).toMatch(/\.scroll-edge::before \{[^}]*position: sticky; height: 0;/);
  // A padded area: the marker is pulled to the true top and sides by the
  // padding the listener reads (a sticky element stays inside padding).
  expect(html).toMatch(/top: calc\(-1 \* var\(--edge-top, 0px\)\);/);
  expect(app).toMatch(/el\.style\.setProperty\('--edge-top', cs\.paddingTop\);/);
  expect(html).toMatch(/\.scroll-edge\[data-scrolled\]::before \{ box-shadow:/);
  expect(app).toMatch(/document\.addEventListener\('scroll', onScroll, \{ capture: true, passive: true \}\)/);
  const uses = { 'src/renderer/app.js': 2, 'src/renderer/components/playlists-page.js': 1, 'src/renderer/components/settings-page.js': 1, 'src/renderer/components/friend-history-page.js': 1, 'src/renderer/components/history-page.js': 1, 'src/renderer/components/critics-picks-page.js': 1, 'src/renderer/components/charts-page.js': 1, 'src/renderer/components/recommendations-page.js': 1, 'src/renderer/components/concerts-page.js': 1, 'src/renderer/components/artist-page.js': 1, 'src/renderer/components/collection-page.js': 1, 'src/renderer/components/home-page.js': 1, 'src/renderer/components/search-page.js': 1, 'src/renderer/components/playlist-view-page.js': 2 };
  for (const [f, n] of Object.entries(uses)) {
    expect([f, (read(f).match(/scroll-edge[ ']/g) || []).length >= n]).toEqual([f, true]);
  }
  expect(read('src/renderer/components/artist-page.js')).not.toContain('contentScrolled');
});

test('History restored at launch waits for the Last.fm key before loading', () => {
  expect(app).toMatch(/const \[lastfmKeyLoaded, setLastfmKeyLoaded\] = useState\(false\);/);
  expect(app).toMatch(/lastfmApiKey\.current = lfmKey;[\s\S]{0,400}setLastfmKeyLoaded\(true\);/);
  // And for a plug-in with a username and the plug-ins to be loaded (#1539 step 4).
  expect(app).toContain('if (cacheLoaded && pendingHistoryLoad.current && hasHistoryAccount && metaServices.length > 0 && lastfmKeyLoaded) {');
});

test("History and a friend's page: tokens and shared buttons, no JS hover", () => {
  // Both pages are their own modules (#1451).
  const seg = read('src/renderer/components/history-page.js') + read('src/renderer/components/friend-history-page.js');
  expect(seg).not.toMatch(/onMouseEnter: \(e\) => e\.currentTarget\.style/);
  expect(seg).not.toMatch(/bg-green-(400|500)|#8b5cf6/);
  expect(seg).toContain("'Pin to sidebar'");
  expect(seg).toContain("'On air'");
});
