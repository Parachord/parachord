// Settings' volume column picks "system volume" plug-ins by capability, never by
// id (#1522): Apple Music declares capabilities.systemVolume, and the column reads
// it for the disabled state, its note and its tooltip.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('Apple Music declares systemVolume, and it is hidden from the capability chips', () => {
  const manifest = JSON.parse(read('plugins-src/applemusic/manifest.json'));
  expect(manifest.capabilities.systemVolume).toBe(true);
  const { visibleCapabilities } = require('../../src/renderer/lib/capability-labels');
  expect(visibleCapabilities({ systemVolume: true, resolve: true })).toEqual(['resolve']);
});

test('the volume column reads the capability and names the plug-in, never its id', () => {
  const page = read('src/renderer/components/settings-page.js');
  expect(page).toContain('resolver.capabilities?.systemVolume');
  expect(page).toContain('`Use system volume to control ${resolver.name}`');
  expect(page).not.toMatch(/resolver\.id === 'applemusic'/);
  expect(page).not.toContain("'Use system volume to control Apple Music'");
});

test('a username plug-in\'s "Setup required" comes from its settings, never its id', () => {
  const page = read('src/renderer/components/settings-page.js');
  expect(page).toContain('service.settings?.configurable?.username');
  expect(page).not.toMatch(/service\.id === '/);
  for (const id of ['lastfm', 'listenbrainz', 'librefm']) {
    expect(JSON.parse(read(`plugins-src/${id}/manifest.json`)).settings.configurable.username).toBeTruthy();
  }
});
