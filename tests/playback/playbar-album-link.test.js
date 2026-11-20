/**
 * The playbar's album-art click must open the album page from any playback
 * context. It used to require track.album, which is empty for tracks played
 * from search, chat, playlists and radio. These test the two pure helpers the
 * click now relies on, extracted from app.js.
 */

const fs = require('fs');
const path = require('path');

const app = require('../helpers/renderer-source').appWithPages();

function extract(startMarker, endMarker) {
  const s = app.indexOf(startMarker);
  expect(s).toBeGreaterThan(-1);
  const e = app.indexOf(endMarker, s);
  expect(e).toBeGreaterThan(s);
  return app.slice(s, e);
}

// normalizeStr comes from the canonical module (sync-providers/confidence-scoring.js);
// app.js consumes it as a window.ConfidenceScoring alias.
const { normalizeStr } = require('../../sync-providers/confidence-scoring');
const helpersSrc = extract('window.pickAlbumNameForTrack = ', '// Coalesce bursts of per-key state writes');
const win = {};
const { isPlaceholderAlbum } = require('../../src/renderer/lib/collection-ids');
new Function('window', 'normalizeStr', 'isPlaceholderAlbum', helpersSrc)(win, normalizeStr, isPlaceholderAlbum);
const { pickAlbumNameForTrack } = win;
// The release-group pick is shared with every other album opener
// (album-catalog.js); the window helper is a thin alias so a track's album
// click picks the same result as a card's.
const { pickReleaseGroupForAlbum } = require('../../src/renderer/lib/album-catalog');

describe('pickAlbumNameForTrack', () => {
  test('uses the track\'s own album first', () => {
    expect(pickAlbumNameForTrack({ album: ' OK Computer ', sources: { spotify: { album: 'Other' } } })).toBe('OK Computer');
  });
  test('a placeholder on the track itself doesn\'t count, so the sources get their turn', () => {
    expect(pickAlbumNameForTrack({ album: 'Single', sources: { spotify: { album: 'In Rainbows' } } })).toBe('In Rainbows');
    expect(pickAlbumNameForTrack({ album: 'SoundCloud', sources: { soundcloud: {}, spotify: { album: 'In Rainbows' } } })).toBe('In Rainbows');
    expect(pickAlbumNameForTrack({ album: 'Single', sources: {} })).toBe('');
  });
  test('a real album named like a service still counts when the track has no such source', () => {
    expect(pickAlbumNameForTrack({ album: 'YouTube', sources: { spotify: {} } })).toBe('YouTube');
  });
  test('falls back to a resolved source\'s album, skipping Apple\'s "Single" filler and noMatch slots', () => {
    expect(pickAlbumNameForTrack({ album: '', sources: { applemusic: { album: 'Single' }, spotify: { album: 'In Rainbows' } } })).toBe('In Rainbows');
    expect(pickAlbumNameForTrack({ sources: { bandcamp: { album: 'Wrong', noMatch: true }, youtube: {} } })).toBe('');
  });
  test('falls back to the mapper\'s canonical release name, else empty', () => {
    expect(pickAlbumNameForTrack({ artist: 'Lustmord', title: 'Black Star', sources: {} }, { release_name: 'The Place Where the Black Stars Hang' })).toBe('The Place Where the Black Stars Hang');
    expect(pickAlbumNameForTrack({ sources: {} }, null)).toBe('');
    expect(pickAlbumNameForTrack(null)).toBe('');
  });
});

describe('pickReleaseGroupForAlbum', () => {
  // The picker itself (joint credits, title closeness, the fallback order) is
  // tested in tests/renderer/album-catalog.test.js; this pins that the
  // playbar's window helper is that pick, called with the album's title, so a
  // track's album click opens what every other opener opens.
  const rg = (title, artist, type) => ({ id: `${artist}-${title}`, title, 'primary-type': type, 'artist-credit': [{ name: artist }] });
  test('a studio edition of the album, not a same-titled album by someone else', () => {
    const results = [rg('Black Star', 'Someone Else', 'Album'), rg('Black Star', 'Lustmord', 'Single'), rg('Black Star', 'Lustmord', 'Album')];
    expect(pickReleaseGroupForAlbum(results, { artist: 'Lustmord', title: 'Black Star' }).id).toBe('Lustmord-Black Star');
    expect(pickReleaseGroupForAlbum([], { artist: 'A' })).toBeNull();
    expect(pickReleaseGroupForAlbum(undefined, { artist: 'A' })).toBeNull();
  });
  test('app.js\'s window helper delegates to it with the title', () => {
    expect(app).toMatch(/window\.pickReleaseGroupForAlbum = \(results, artist, title = ''\) =>\s*pickReleaseGroupForAlbum\(results, \{ artist, title \}\);/);
    expect(app).toMatch(/window\.pickReleaseGroupForAlbum\(data\['release-groups'\], track\.artist, albumName\)/);
  });
});

describe('the playbar uses the always-works path', () => {
  test('album-art click calls openAlbumForTrack and no longer gates on currentTrack.album', () => {
    const i = app.indexOf('openAlbumForTrack(currentTrack);');
    expect(i).toBeGreaterThan(-1);
    const around = app.slice(i - 600, i);
    expect(around).not.toMatch(/if \(currentTrack\.album && currentTrack\.artist\)/);
  });
});
