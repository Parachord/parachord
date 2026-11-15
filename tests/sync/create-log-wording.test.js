/**
 * sync:create-playlist returns { linkedToExisting: true } when it reuses a
 * remote it already knows (by durable link or by name). The push loop logged
 * every success as "Created playlist", so relinking an existing Spotify copy
 * read as a new playlist being made on the person's account.
 */
const fs = require('fs');
const path = require('path');

test('the push loop logs a relink as a link, not a creation', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  const at = src.indexOf('[Sync] Created playlist "${playlist.title}" on ${providerId}');
  expect(at).toBeGreaterThan(-1);
  const around = src.slice(at - 400, at);
  expect(around).toMatch(/result\.linkedToExisting\s*\?/);
  expect(around).toMatch(/nothing created/);
});
