// lib/playlist-import-sources.js: the Import playlist dialog names the
// plug-ins that can import a playlist link, from the registry (#1019).
const fs = require('fs');
const path = require('path');
const { playlistImportServices, playlistImportLabel } = require('../../src/renderer/lib/playlist-import-sources');

const lookup = () => null;
const plugins = [
  { id: 'listenbrainz', name: 'ListenBrainz', lookupPlaylist: lookup },
  { id: 'youtube', name: 'YouTube', lookupPlaylist: lookup },
  { id: 'lastfm', name: 'Last.fm' },
  { id: 'soundcloud', name: 'SoundCloud', lookupPlaylist: lookup },
  { id: 'spotify', name: 'Spotify', lookupPlaylist: lookup },
  { id: 'amazonmusic', name: 'Amazon Music', lookupPlaylist: lookup },
  { id: 'applemusic', name: 'Apple Music', lookupPlaylist: lookup },
];

test('only plug-ins that implement lookupPlaylist, in the usual service order, then the rest by name', () => {
  expect(playlistImportServices(plugins)).toEqual(['Spotify', 'Apple Music', 'Amazon Music', 'SoundCloud', 'YouTube', 'ListenBrainz']);
});

test('a new plug-in with lookupPlaylist shows up on its own', () => {
  const withNew = [...plugins, { id: 'tidal', name: 'Tidal', lookupPlaylist: lookup }];
  expect(playlistImportServices(withNew)).toContain('Tidal');
});

test('the label ends with hosted XSPF, and names no file extension', () => {
  expect(playlistImportLabel(plugins)).toBe('Spotify, Apple Music, Amazon Music, SoundCloud, YouTube, ListenBrainz, or a hosted XSPF playlist');
  expect(playlistImportLabel([])).toBe('A link to a hosted XSPF playlist');
  expect(playlistImportLabel(undefined)).toBe('A link to a hosted XSPF playlist');
  expect(playlistImportLabel(plugins)).not.toMatch(/\.xspf/);
});

test('the dialog shows the label from the registry, not a hard-coded list', () => {
  const dialog = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/url-import-dialog.js'), 'utf8');
  expect(dialog).not.toMatch(/'Spotify, Apple Music/);
  expect(dialog).toContain('importSourcesLabel');
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  expect(app).toMatch(/importSourcesLabel: playlistImportSourcesLabel/);
});
