/**
 * The ephemeral-playlist SAVE button (PlaylistViewPage): a provider playlist
 * (a recommended playlist opened from the Recommendations page) saves through
 * the Import path — the same record the Import button produces — and the
 * Weekly Jams record spreads the whole playlist (buildPlaylistSavePayload's
 * rule: a field left out of a hand-picked list is deleted when the store
 * replaces the record).
 */

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/playlist-view-page.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

describe('the ephemeral playlist SAVE button', () => {
  const saveStart = src.indexOf('selectedPlaylist?.isEphemeral && !playlistEditMode && React.createElement');
  const saveEnd = src.indexOf("bg-orange-500", saveStart);
  const save = src.slice(saveStart, saveEnd);

  test('a provider playlist saves through the Import path (both buttons produce the same record)', () => {
    expect(saveStart).toBeGreaterThan(-1);
    expect(save).toContain('if (selectedPlaylist.sourceUrl) {');
    expect(save).toContain('await handleImportPlaylistFromUrl(');
    expect(save).toContain('selectedPlaylist.sourceUrl,');
  });

  test('the SAVE keeps the cover the view is showing: coverArt rides as a metadata override', () => {
    // A recommended playlist's cover (the image the Recommendations page's
    // card showed) must survive the save — not be replaced by a generated
    // mosaic. The override wins over the lookup's own cover so the image
    // never swaps on save.
    expect(save).toContain("selectedPlaylist.coverArt ? { coverArt: selectedPlaylist.coverArt } : null");
  });

  test('the Weekly Jams record spreads the whole playlist, no hand-picked field list', () => {
    const recStart = save.indexOf('const newPlaylist = {');
    const rec = save.slice(recStart, save.indexOf('setPlaylists(prev => [...prev, newPlaylist]', recStart));
    expect(rec).toContain('...selectedPlaylist');
    // The library-record specifics are overridden, the rest inherited.
    expect(rec).toContain('title: selectedPlaylist.weekLabel');
    expect(rec).toContain("creator: selectedPlaylist.creator || 'ListenBrainz'");
    expect(rec).toContain('tracks: playlistTracks');
    // The ephemeral flag must not leak into the saved library record.
    expect(rec).toContain('delete newPlaylist.isEphemeral');
  });

  test('handleImportPlaylistFromUrl is threaded as a stable handler on both sides', () => {
    // The handlers list and the props destructure in playlist-view-page.js…
    expect(src).toMatch(/PLAYLIST_VIEW_PAGE_HANDLERS = \[[\s\S]*'handleImportPlaylistFromUrl'/);
    expect(src).toMatch(/^\s{4}handleImportPlaylistFromUrl,$/m);
    // …and the useStableHandlers call in app.js (keys must match).
    expect(app).toMatch(/handleExportPlaylist, handleImportPlaylistFromUrl, handlePlay/);
  });
});
