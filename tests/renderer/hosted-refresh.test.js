/**
 * src/renderer/lib/hosted-refresh.js: Parachord can only read a hosted XSPF
 * from its server, never write it, but the person can edit the playlist here,
 * and the edits go to its mirrors until the next update at the link replaces
 * them. A re-import (the launch reload, the 5-minute poll, a manual check)
 * keeps the local tracks unless the link's tracklist itself changed.
 */
const { linkTracksChanged, refreshedTracks } = require('../../src/renderer/lib/hosted-refresh');

const A = { title: 'One', artist: 'A' };
const B = { title: 'Two', artist: 'B' };
const C = { title: 'Three', artist: 'C' };

describe('linkTracksChanged', () => {
  test('the same tracklist is no change, whatever ids, sources and albums say', () => {
    expect(linkTracksChanged([A, B], [{ ...A, id: 'x', sources: { s: {} } }, { ...B, album: 'Other' }])).toBe(false);
  });

  test('an added, removed or reordered track is a change', () => {
    expect(linkTracksChanged([A, B], [A, B, C])).toBe(true);
    expect(linkTracksChanged([A, B], [A])).toBe(true);
    expect(linkTracksChanged([A, B], [B, A])).toBe(true);
  });

  test('nothing imported before counts as a change', () => {
    expect(linkTracksChanged(null, [A])).toBe(true);
    expect(linkTracksChanged(undefined, [])).toBe(true);
  });
});

describe('refreshedTracks', () => {
  const edited = { id: 'hosted-1', tracks: [A, C] }; // the person swapped B for C here

  test('an unchanged link keeps the local tracks, edits included', () => {
    expect(refreshedTracks(edited, { previousLinkTracks: [A, B], linkTracks: [A, B] })).toEqual({ tracks: [A, C], changed: false });
  });

  test('a changed link replaces them, edits included', () => {
    expect(refreshedTracks(edited, { previousLinkTracks: [A, B], linkTracks: [B] })).toEqual({ tracks: [B], changed: true });
  });

  test('a record with no tracks, or none imported before, takes the link', () => {
    expect(refreshedTracks({ id: 'h' }, { previousLinkTracks: [A], linkTracks: [A] })).toEqual({ tracks: [A], changed: true });
    expect(refreshedTracks(null, { previousLinkTracks: null, linkTracks: [A] })).toEqual({ tracks: [A], changed: true });
    expect(refreshedTracks(edited, { previousLinkTracks: null, linkTracks: [A, B] })).toEqual({ tracks: [A, B], changed: true });
  });
});

describe('the app uses it', () => {
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  const view = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/playlist-view-page.js'), 'utf8');
  const bodyOf = (src, marker, end) => {
    const i = src.indexOf(marker);
    expect(i).toBeGreaterThan(-1);
    return src.slice(i, src.indexOf(end, i));
  };

  test('savePlaylistToStore saves a hosted playlist\'s tracks, not only its title and creator', () => {
    const body = bodyOf(app, 'const savePlaylistToStore = async (playlist) => {', 'window.electron.playlists.save(');
    const hostedBlock = body.slice(body.indexOf("get('hosted_playlists')"), body.indexOf('stampPlaylist('));
    expect(hostedBlock).not.toMatch(/\breturn;/);
  });

  test('a re-import keeps the local tracks unless the link\'s tracklist changed', () => {
    const body = bodyOf(app, 'const handleImportPlaylistFromUrl = async', 'const handlePlaylistDrop = async');
    expect(body).toContain('refreshedTracks(existing,');
  });

  test('edit mode\'s Done saves locallyModified with the tracks, so the edit reaches the mirrors', () => {
    const done = bodyOf(view, '// Done button', 'setPlaylistEditMode(false);');
    expect(done).toMatch(/selectedPlaylist\.syncedFrom \|\| selectedPlaylist\.syncedTo\)[^]*locallyModified: true/);
  });
});
