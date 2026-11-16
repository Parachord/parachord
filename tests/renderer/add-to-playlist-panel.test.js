/**
 * The Add to playlist panel (app.js) follows the dialog rules and the tokens
 * (2026-11-15 page pass).
 */
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
const start = app.indexOf('addToPlaylistPanel.open && React.createElement(SidePanel, {');
const panel = app.slice(start, start + 30000);

test('it is the shared SidePanel: focus goes in, is trapped and comes back, and Escape closes it', () => {
  expect(start).toBeGreaterThan(0);
  expect(panel).toMatch(/React\.createElement\(SidePanel, \{\s*onClose: closeAddToPlaylistPanel,\s*label: 'Add to playlist',/);
  // No second copy of the focus handling (#1449).
  expect(app).not.toContain('addPanelRef');
  // An inner field's own Escape doesn't close the panel.
  expect(panel).toMatch(/\/\/ Closes the form only, not the panel around it\.\s*e\.preventDefault\(\);/);
});

test('its header is the Playlists gradient and the shared icon; no hex, no green button', () => {
  expect(panel).toContain('className: PAGE_COLORS.playlists.hero');
  expect(panel).toContain('React.createElement(Icons.ListPlus,');
  expect(panel).not.toMatch(/#f43f5e|#1f1f1f|bg-green-500|border-l-purple-500/);
  expect(panel).toContain("'Add to playlist')");
});

test('a dead cover thumbnail is reported to the art pipeline', () => {
  expect(panel).toMatch(/window\.reportBrokenAlbumArt\(t\.albumArt, \{ artist: t\.artist, album: t\.album \}\)/);
});
