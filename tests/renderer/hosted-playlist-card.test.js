// A hosted XSPF playlist's card says "Hosted" and nothing else: hosted
// already means it updates from its link, so a check-now button beside it
// repeated the badge (2026-11-16). Refresh now stays on the playlist's page
// (its Auto-update menu),
// and on cards for other playlists kept updated from a link, which have no
// badge to say so.
const { appWithPages } = require('./../helpers/renderer-source');
const app = appWithPages();

test('the grid card shows the Hosted badge alone; other auto-updating playlists keep Check now', () => {
  expect(app).toMatch(/cornerBadges: linkUpdateMode\(playlist\) === 'auto'\s*\? \(playlist\.source === 'hosted-xspf'\s*\? React\.createElement\(Badge, \{ tone: 'surface', icon: Icons\.Globe[^\n]*'Hosted'\)\s*: React\.createElement\(Button,/);
});

test('the list row has no Check now for a hosted playlist', () => {
  expect(app).toContain("linkUpdateMode(playlist) === 'auto' && playlist.source !== 'hosted-xspf' && React.createElement('button', {");
});

test("Refresh now is still on a playlist's page", () => {
  const page = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/components/playlist-view-page.js'), 'utf8');
  expect(page).toMatch(/try \{ await refreshHostedPlaylist\(id\); \}/);
});
