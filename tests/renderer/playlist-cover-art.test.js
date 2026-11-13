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
global.ReactVirtual = global.ReactVirtual || require('@tanstack/react-virtual');
const { renderToStaticMarkup } = require('react-dom/server');
const { PlaylistCoverImage } = require('../../src/renderer/components/playlist-cover');
const { PlaylistViewPage } = require('../../src/renderer/components/playlist-view-page');

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
    expect(src).toMatch(/React\.useEffect\(\(\) => \{ setBroken\(false\); \}, \[coverUrl\]\)/);
    // A non-string URL renders nothing, so callers pass a record's coverArt
    // straight through.
    expect(src).toContain('const coverUrl = (typeof url === \'string\' && url.trim()) ? url : null;');
  });

  test('is React.memo\'d like every kit component', () => {
    expect(read('src/renderer/components/playlist-cover.js')).toContain('React.memo(PlaylistCoverImageBase)');
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
    // The hero layers the cover over the tile/gradient backdrop (the <img>
    // reports its own death; a CSS background cannot). The slice is the hero
    // block only, so a later `playlistCover &&` elsewhere can't satisfy it.
    const hero = sliceFrom(view, '// Background with the first mosaic tile or the gradient', '// Gradient overlay');
    expect(hero).toContain('backgroundImage: playlistCoverArt[0]');
    expect(hero).toContain('playlistCover && React.createElement(PlaylistCoverImage, { url: playlistCover })');
    expect(view).toContain('albumArt: playlistCover || playlistCoverArt?.[0] || null');
  });

  // PAINT ORDER (the live-reported bug): the cover <img> and the mosaic's
  // tiles are both positioned, and positioned siblings paint in DOM order —
  // the cover must come AFTER the mosaic/placeholder or the tiles cover it.
  // The live failure: a recommended playlist showed its cover while the
  // tracks loaded (over the static placeholder) and the tiled mosaic replaced
  // it the moment they landed.
  test('the playlist view renders the cover ABOVE the mosaic tiles (paint order)', () => {
    const props = {
      activeResolvers: [], allPlaylistCovers: {}, allResolvers: [], currentTrack: null,
      draggedPlaylistTrack: null, editedPlaylistData: null, formatTime: (s) => String(s || ''),
      handlePlaylistTracksScrollRef: { current: null }, isPlaying: false, playbackContext: null,
      playlistCoverArt: [
        'https://img.example/tile1.jpg', 'https://img.example/tile2.jpg',
        'https://img.example/tile3.jpg', 'https://img.example/tile4.jpg'
      ],
      playlistDropTarget: null, playlistEditMode: false, playlistObserverRef: { current: null },
      playlistScrollContainerReady: false, playlistScrollContainerRef: { current: null },
      playlistTrackRowRefs: { current: new Map() }, playlistTracks: [],
      playlistTracksScrollRef: { current: null }, publishCollectionSmartLink: () => {},
      refreshingPlaylist: null, resolverLoaderRef: { current: null }, resolverOrder: [],
      selectedPlaylist: {
        id: 'test-1', title: 'Test Playlist', creator: 'Amazon Music', tracks: [],
        coverArt: 'https://img.example/cover.jpg'
      },
      setAddToPlaylistPanel: () => {}, setDraggedPlaylistTrack: () => {}, setDraggingTrackForPlaylist: () => {},
      setEditedPlaylistData: () => {}, setPlaylistCoverArt: () => {}, setPlaylistDropTarget: () => {},
      setPlaylistEditMode: () => {}, setPlaylistScrollContainerReady: () => {}, setPlaylistTracks: () => {},
      setPlaylists: () => {}, setRefreshingPlaylist: () => {}, setSelectedPlaylist: () => {},
      setSelectedPlaylistsForAdd: () => {}, setShareDropdownOpen: () => {}, setSyncDeleteDialog: () => {},
      setTrackLoading: () => {}, shareDropdownOpen: false, showToast: () => {}, trackSources: {},
      addToQueue: () => {}, copyParachordLink: () => {}, deletePlaylistLocally: () => {},
      getPlaylistMirrorTargets: () => [], handleExportPlaylist: () => {}, handleImportPlaylistFromUrl: () => {},
      handlePlay: () => {}, handlePlaylistDragEnd: () => {}, loadPlaylist: () => {}, navigateTo: () => {},
      navigateBack: () => {}, openCollection: () => {}, refreshHostedPlaylist: () => {}, setQueueWithContext: () => {},
      markPlaylistAsLocallyModified: () => {}, fetchArtistData: () => {},
    };
    const markup = renderToStaticMarkup(React.createElement(PlaylistViewPage, props));
    // lastIndexOf: the hero's blurred backdrop uses the same cover URL first;
    // the card's cover layer is the LAST occurrence.
    const coverIdx = markup.lastIndexOf('img.example/cover.jpg');
    const lastTileIdx = markup.lastIndexOf('img.example/tile4.jpg');
    const overlayIdx = markup.indexOf('title="Add to Playlist"');
    expect(coverIdx).toBeGreaterThan(-1);
    expect(lastTileIdx).toBeGreaterThan(-1);
    // The cover paints after (above) the mosaic tiles…
    expect(coverIdx).toBeGreaterThan(lastTileIdx);
    // …and before the hover overlay (the later sibling stays on top).
    expect(overlayIdx).toBeGreaterThan(coverIdx);
  });

  test('the Playlists grid card, table row and add-to-playlist panel: the cover comes after the mosaic in DOM order', () => {
    const orderAfter = (src, startMarker, endMarker, beforeMarker) => {
      const start = src.indexOf(startMarker);
      expect(start).toBeGreaterThan(-1);
      const block = src.slice(start, src.indexOf(endMarker, start));
      expect(block.length).toBeGreaterThan(0);
      const cover = block.indexOf('playlist.coverArt && React.createElement(PlaylistCoverImage');
      expect(cover).toBeGreaterThan(-1);
      expect(cover).toBeGreaterThan(block.indexOf(beforeMarker));
    };
    // Grid card and table thumbnail: anchored against the placeholder branch's
    // trailing svg path — the last markup before the cover — so a cover moved
    // INSIDE the mosaic map (between positioned tiles, where later tiles paint
    // over it) fails too, not just one moved before the ternary.
    const lastBeforeCover = 'M15 13.5v6l5.5-3-5.5-3z';
    orderAfter(app, '// The mosaic/placeholder; the playlist\'s own cover',
      '// Refresh for hosted XSPF (auto-polled)', lastBeforeCover);
    orderAfter(app, '// Thumbnail (the mosaic/placeholder', '// Playlist name', lastBeforeCover);
    // Add-to-playlist panel thumbnail: after the first-tile image.
    orderAfter(app, '// Playlist thumbnail (gray square)', '// Playlist name', 'allPlaylistCovers[playlist.id]?.[0]');
  });

  test('the Home page playlist row: the cover comes after the grid in DOM order', () => {
    const start = home.indexOf('// 2x2 album art grid or placeholder with hover play');
    expect(start).toBeGreaterThan(-1);
    const block = home.slice(start, home.indexOf('// Hover play button overlay', start));
    const cover = block.indexOf('playlist.coverArt && React.createElement(PlaylistCoverImage');
    expect(cover).toBeGreaterThan(block.indexOf('animate-shimmer'));
  });

  test('a pre-dedupe tiled cache entry self-heals at load (the same URL four times)', () => {
    const load = sliceFrom(app, '// Load playlist cover cache', '// Load charts cache');
    expect(load).toContain('dedupeCovers');
    expect(load).toContain('[...new Set(entry.covers)]');
  });
});
