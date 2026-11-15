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
const app = read('src/renderer/app.js');
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
  expect(app).toMatch(/newPlaylistDialogName !== null && \(\(\) => \{[\s\S]{0,1600}title: 'New playlist'/);
  expect(app).not.toContain("bg-green-600 hover:bg-green-700");
});

test("a chat playlist card finds its playlist when clicked, not from the render's list", () => {
  const i = app.indexOf('const handlePlaylistCardClick = () => {');
  const fn = app.slice(i, app.indexOf('\n        };', i));
  expect(fn).toContain('const all = playlistsRef.current || [];');
  expect(fn).not.toMatch(/\bplaylists\.find\(/);
  expect(fn).toMatch(/showToast\('Couldn’t find that playlist/);
});
