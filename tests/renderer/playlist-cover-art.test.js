/**
 * A playlist's own cover (the playlist record's `coverArt` — the image the
 * provider gave for the playlist, e.g. an Amazon Music recommended playlist's
 * image) must be the SAME image at every step of the chain:
 *
 *   the Recommendations page's card (item.imageUrl)
 *     → the playlist view (openRecommendationPlaylist's coverArt — not a
 *        mosaic tiled 4x from the playlist cover stamped on every track)
 *     → the saved record (handleImportPlaylistFromUrl keeps the resolver's
 *        cover, and the ephemeral SAVE passes the cover it is showing as an
 *        override so the image never swaps)
 *     → the Playlists page / Home / the add-to-playlist panel (the saved
 *        record's coverArt, layered over the mosaic fallback)
 *
 * The bug chain this pins: the playlist cover used to be stamped on every
 * track's albumArt (so the 2x2 mosaic showed the same image four times), and
 * the import path threw the resolver's `albumArt` away (so a saved playlist
 * got a generated mosaic instead of the provider's cover). Dropped playlist
 * links import through the same handleImportPlaylistFromUrl, so they get the
 * cover too.
 */

const fs = require('fs');
const path = require('path');

global.React = global.React || require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { PlaylistCoverImage } = require('../../src/renderer/components/playlist-cover');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const app = read('src/renderer/app.js');
const view = read('src/renderer/components/playlist-view-page.js');
const home = read('src/renderer/components/home-page.js');

const sliceFrom = (src, marker, endMarker) => {
  const start = src.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf(endMarker, start);
  expect(end).toBeGreaterThan(-1);
  return src.slice(start, end);
};

describe('PlaylistCoverImage (the shared cover layer)', () => {
  test('renders the cover image for a URL, nothing without one', () => {
    const withUrl = renderToStaticMarkup(React.createElement(PlaylistCoverImage, { url: 'https://img.example/cover.jpg' }));
    expect(withUrl).toContain('src="https://img.example/cover.jpg"');
    expect(renderToStaticMarkup(React.createElement(PlaylistCoverImage, {}))).toBe('');
    expect(renderToStaticMarkup(React.createElement(PlaylistCoverImage, { url: null }))).toBe('');
  });

  test('a URL that fails to load removes itself (the mosaic underneath shows)', () => {
    const src = read('src/renderer/components/playlist-cover.js');
    expect(src).toContain('onError: () => setBroken(true)');
    // A fresh URL retries instead of staying dropped.
    expect(src).toMatch(/React\.useEffect\(\(\) => \{ setBroken\(false\); \}, \[url\]\)/);
  });
});

describe('opening a recommended playlist keeps the card\'s cover', () => {
  test('openRecommendationPlaylist carries the card image as coverArt', () => {
    const open = sliceFrom(app, 'const openRecommendationPlaylist = (item, section) => {', 'const artistCard = (item, index)');
    expect(open).toContain('...(imageFor(item) ? { coverArt: imageFor(item) } : {})');
  });

  test('the playlist cover is never stamped on a track (the 4x-tiled mosaic bug)', () => {
    const tracks = sliceFrom(app, 'const recommendationPlaylistTracks = async (item) => {', 'const playRecommendationPlaylist = async');
    expect(tracks).not.toContain('resolved.albumArt');
    // Only the lookup's own PER-TRACK art (the track's album cover) rides on a track.
    expect(tracks).toContain("...(t.albumArt ? { albumArt: t.albumArt } : {})");
  });

  test('getPlaylistCovers never tiles one URL four times', () => {
    const covers = sliceFrom(app, 'const getPlaylistCovers = async (playlistId, tracks) => {', 'const fetchPlaylistCovers = async');
    expect(covers).toContain('const seenCoverUrls = new Set()');
    expect(covers).toContain('!seenCoverUrls.has(track.albumArt)');
    expect(covers).toContain('!seenCoverUrls.has(artUrl)');
  });

  test('the provider lookup passes per-track art through (never the playlist cover)', () => {
    const resolve = sliceFrom(app, 'const resolveProviderPlaylistUrl = async (rawUrl) => {', '// Protocol URL handler (parachord:// deep links)');
    expect(resolve).toContain('if (t.albumArt) out.albumArt = t.albumArt;');
    // The playlist-level cover stays one level up, on the lookup result.
    expect(resolve).toContain('const albumArt = playlist.albumArt || playlist.image || playlist.artwork;');
  });
});

describe('importing (SAVE, dropped link, URL import) keeps the provider cover', () => {
  const imp = sliceFrom(app, 'const handleImportPlaylistFromUrl = async (url,', 'const handlePlaylistDrop = async (e) => {');

  test('the resolver branch takes the playlist\'s own cover onto the parsed record', () => {
    expect(imp).toContain('const playlistCoverArt = [playlist.albumArt, playlist.image, playlist.artwork]');
    expect(imp).toMatch(/\.\.\.\(playlistCoverArt \? \{ coverArt: playlistCoverArt \} : \{\}\)/);
  });

  test('new and updated records carry coverArt, and the SAVE override wins', () => {
    expect(imp).toContain('const playlistCover = (typeof metadataOverrides?.coverArt');
    expect(imp).toMatch(/const newPlaylist = \{[\s\S]*?\.\.\.\(playlistCover \? \{ coverArt: playlistCover \} : \{\}\)/);
    expect(imp).toMatch(/updatedPlaylist = \{[\s\S]*?\.\.\.\(playlistCover \? \{ coverArt: playlistCover \} : \{\}\)/);
  });

  test('the on-screen playlist takes a refreshed cover (a hosted refresh keeps the old one)', () => {
    const refresh = sliceFrom(app, 'const refreshHostedPlaylist = async (playlistId) => {', '// Poll hosted playlists for updates');
    expect(refresh).toMatch(/result\.playlist\.coverArt \? \{ coverArt: result\.playlist\.coverArt \} : \{\}/);
  });
});

describe('every playlist-cover surface renders the record\'s cover over the mosaic', () => {
  test('the playlist view: hero background, 192px card, share link', () => {
    expect(view).toContain('const playlistCover = (typeof selectedPlaylist?.coverArt');
    expect(view).toContain('backgroundImage: (playlistCover || playlistCoverArt[0])');
    expect(view).toContain("playlistCover && React.createElement(PlaylistCoverImage, { url: playlistCover })");
    expect(view).toContain('albumArt: playlistCover || playlistCoverArt?.[0] || null');
  });

  test('the Playlists page grid card and table row, and the add-to-playlist panel', () => {
    expect(app).toContain("playlist.coverArt && React.createElement(PlaylistCoverImage, { url: playlist.coverArt })");
  });

  test('the Home page playlist row', () => {
    expect(home).toContain("playlist.coverArt && React.createElement(PlaylistCoverImage, { url: playlist.coverArt })");
  });
});
