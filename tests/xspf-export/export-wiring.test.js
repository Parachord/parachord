/**
 * parachord#1010: handleExportPlaylist and the playlists-export IPC existed
 * with no caller, so there was no way to export a playlist to a file. These
 * source-level checks pin the three entry points.
 */

const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
const app = read('src/renderer/app.js');
const main = read('main.js');

describe('playlist XSPF export is reachable', () => {
  test('the handler exists and generates XSPF when the playlist has none', () => {
    const start = app.indexOf('const handleExportPlaylist = async (playlist) => {');
    expect(start).toBeGreaterThan(-1);
    const src = app.slice(start, start + 1500);
    expect(src).toMatch(/playlist\.xspf \|\| generateXSPF\(/);
    expect(src).toMatch(/window\.electron\.playlists\.export\(defaultFilename, content\)/);
  });

  test('the playlist header Share menu, the context-menu action and the queue dialog call it', () => {
    // The playlist header (and its Share menu) moved into its own module in
    // the Track 2b split; the other two callers stay in app.js.
    const playlistView = read('src/renderer/components/playlist-view-page.js');
    expect([...app.matchAll(/handleExportPlaylist\(/g)].length).toBe(2); // context-menu action + queue "Save to file"
    expect([...playlistView.matchAll(/handleExportPlaylist\(/g)].length).toBe(1); // share menu
    expect(playlistView).toMatch(/'Export as XSPF…'/);
    expect(app).toMatch(/data\.action === 'export-playlist' && data\.playlistId/);
    expect(app).toMatch(/const handleSaveQueueToFile = async \(\) => \{/);
    expect(app).toMatch(/onClick: handleSaveQueueToFile,/);
  });

  test('the native playlist context menu offers the export action', () => {
    expect(main).toMatch(/label: 'Export as XSPF…',[\s\S]{0,200}action: 'export-playlist'/);
  });
});
