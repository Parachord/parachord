// src/renderer/components/playlists-page.js: the Playlists page: its hero,
// filter and sort, the grid of playlist cards and the table view, and the
// Create and Import buttons (#1451, moved out of app.js).
//
// A React.memo'd page fed stable props: state, setters and callbacks by
// value, plain functions through useStableHandlers (PLAYLISTS_PAGE_HANDLERS,
// pinned by tests/renderer/page-memo.test.js). linkUpdateMode reads the
// plug-in loader during render (is this a provider import?), so the call
// site passes _allResolvers to re-render when plug-ins load. The markup
// moved as it was.

const Icons = require('./icons');
const { trackSlug } = require('../lib/track-slug');
const { countOf } = require('../lib/plural');
const { playlistsSortOptions } = require('../lib/playlists-sort');
const { playlistMenu } = require('../lib/item-menus');
const { PlaylistCoverImage } = require('./playlist-cover');
const { FilterBox } = require('./filter-box');
const { PageHero } = require('./page-hero');
const { CardSkeleton } = require('./home-skeletons');
const { PlaylistGlyph } = require('./card-art');
const { PlaylistCard } = require('./playlist-card');
const { Badge } = require('./badge');
const { Button } = require('./button');
const { SortMenu } = require('./sort-menu');
const { EmptyState } = require('./states');
const { CardButton } = require('./card-button');

const { Play } = Icons;

const PLAYLISTS_PAGE_HANDLERS = [
  'copyParachordLink',
  'handlePlaylistDrop',
  'linkUpdateMode',
  'loadPlaylist',
  'playlistCardActions',
  'playlistCardDrag',
  'playlistTracksWithIds',
  'refreshHostedPlaylist',
];

const PlaylistsPage = React.memo(function PlaylistsPage(props) {
  const {
    allPlaylistCovers,
    copyParachordLink,
    filterPlaylists,
    handlePlay,
    handlePlaylistDrop,
    handlePlaylistsScroll,
    linkUpdateMode,
    loadPlaylist,
    playlistCardActions,
    playlistCardDrag,
    playlistTracksWithIds,
    playlists,
    playlistsHeaderCollapsed,
    playlistsLoading,
    playlistsSearch,
    playlistsSearchOpen,
    playlistsSort,
    playlistsViewMode,
    refreshHostedPlaylist,
    refreshingPlaylist,
    setNewPlaylistDialogName,
    setPlaylistsSearch,
    setPlaylistsSearchOpen,
    setPlaylistsSort,
    setPlaylistsViewMode,
    setQueueWithContext,
    setRefreshingPlaylist,
    setShowUrlImportDialog,
    sortPlaylists,
  } = props;
  return React.createElement('div', {
        className: 'flex-1 flex flex-col h-full',
        style: { overflow: 'hidden', minHeight: 0 },
        onDragOver: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; },
        onDragEnter: (e) => { e.preventDefault(); },
        onDrop: handlePlaylistDrop
      },
        // Header section (outside scrollable area)
        React.createElement(PageHero, {
collapsed: playlistsHeaderCollapsed,
page: 'playlists',
title: 'Playlists',
onTitleContextMenu: copyParachordLink,
expanded: React.createElement(React.Fragment, null,
React.createElement('div', {
              className: 'flex items-center gap-1 mt-6',
              style: { textShadow: 'var(--hero-text-shadow-line)' }
            },
              playlistsLoading && playlists.length === 0
                ? React.createElement('div', {
                    className: 'h-5 w-24 rounded bg-white/20 animate-pulse'
                  })
                : React.createElement('span', {
                    className: 'px-2 py-1 text-sm font-medium uppercase tracking-wider text-white'
                  }, `${playlists.length} Playlist${playlists.length !== 1 ? 's' : ''}`)
            )),
collapsedContent: null
}),
        // Filter bar (outside scrollable area)
        React.createElement('div', {
          className: 'flex items-center px-6 py-3',
          style: { flexShrink: 0, backgroundColor: 'var(--bg-primary)', borderBottom: '1px solid var(--border-default)' }
        },
          // Sort dropdown
          React.createElement(SortMenu, { value: playlistsSort, options: playlistsSortOptions, onChange: setPlaylistsSort, label: "Sort playlists" }),
          React.createElement('div', { className: 'flex-1' }),
          // View mode toggle (grid/table)
          React.createElement('div', { className: 'flex items-center gap-1 mr-4' },
            React.createElement(Button, { variant: 'icon', size: 'sm', className: playlistsViewMode === 'grid' ? '!bg-line !text-ink-secondary' : '', onClick: () => setPlaylistsViewMode('grid'), 'aria-label': 'Grid view', 'data-tooltip': 'Grid view' }, React.createElement('svg', { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2 },
                React.createElement('rect', { x: 3, y: 3, width: 7, height: 7, rx: 1 }),
                React.createElement('rect', { x: 14, y: 3, width: 7, height: 7, rx: 1 }),
                React.createElement('rect', { x: 3, y: 14, width: 7, height: 7, rx: 1 }),
                React.createElement('rect', { x: 14, y: 14, width: 7, height: 7, rx: 1 })
              )),
            React.createElement(Button, { variant: 'icon', size: 'sm', className: playlistsViewMode === 'table' ? '!bg-line !text-ink-secondary' : '', onClick: () => setPlaylistsViewMode('table'), 'aria-label': 'Table view', 'data-tooltip': 'Table view' }, React.createElement(Icons.List, { className: 'w-5 h-5' }))
          ),
          // Search
          React.createElement(FilterBox, { value: playlistsSearch, onChange: setPlaylistsSearch, open: playlistsSearchOpen, onOpenChange: setPlaylistsSearchOpen }),
          // Import Playlist button: the outlined secondary style of the album
          // and playlist Share button (theme variables, card-style border and
          // hover), sized to sit level with the filled New button beside it.
          React.createElement(Button, { variant: 'secondary', size: 'sm', type: 'button', onClick: () => setShowUrlImportDialog(true), className: 'ml-3 no-drag' }, React.createElement(Icons.Download, { className: 'w-4 h-4' }), 'Import'),
          // Create: names the playlist first (the New playlist dialog), in
          // the accent primary like every primary button (it was green).
          React.createElement(Button, { variant: 'primary', size: 'sm', type: 'button', className: 'ml-2 no-drag', onClick: () => setNewPlaylistDialogName('') },
            React.createElement(Icons.Plus, { className: 'w-4 h-4' }),
            'Create'
          )
        ),
        // Content area (scrollable)
        React.createElement('div', {
          className: 'scrollable-content scroll-edge',
          style: {
            flex: 1,
            overflowY: 'scroll',
            pointerEvents: 'auto',
            padding: '24px'
          },
          onScroll: handlePlaylistsScroll
        },
          (() => {
            const filtered = filterPlaylists(playlists);
            const sorted = sortPlaylists(filtered);

            // Show loading skeletons while playlists are loading
            // The shared card's placeholder, in the real grid (its gaps too).
            if (playlistsLoading && sorted.length === 0) {
              return React.createElement('div', { className: 'card-grid gap-x-4 gap-y-5' },
                Array.from({ length: 10 }).map((_, i) =>
                  React.createElement(CardSkeleton, { key: `playlist-skeleton-${i}`, index: i, lines: 1 })
                )
              );
            }

            if (sorted.length === 0 && playlistsSearch) {
              return React.createElement(EmptyState, { icon: Icons.Search, title: 'No playlists match your search', body: 'Try other words, or clear the filter.' });
            }

            if (sorted.length === 0) {
              // The shared empty state, with the way in (#1387).
              return React.createElement(EmptyState, {
                title: 'No playlists yet',
                body: 'Import one from Spotify, Apple Music, Amazon Music, a link or an .xspf file.',
                actions: [{ label: 'Import playlist', variant: 'primary', onClick: () => setShowUrlImportDialog(true) }]
              });
            }

            // Grid view
            if (playlistsViewMode === 'grid') {
              return React.createElement('div', { role: 'list',
                key: `playlist-grid-${sorted.length}-${playlistsSearch}`,
                className: 'card-grid gap-x-4 gap-y-5'
              },
                sorted.map((playlist, index) => {
                  return React.createElement(PlaylistCard, Object.assign({
                    role: 'listitem',
                    key: playlist.id,
                    // The playlist's own cover (a provider's coverArt) over the
                    // mosaic of its tracks' covers (components/playlist-card.js).
                    playlist,
                    mosaic: allPlaylistCovers[playlist.id] || null,
                    subtitle: playlist.creator || countOf(playlist.tracks?.length || 0, 'track'),
                    animationDelay: Math.min(index * 30, 300),
                    dragData: playlistCardDrag(playlist),
                    onOpen: () => loadPlaylist(playlist),
                    onContextMenu: () => window.showItemMenu(playlistMenu(playlist, playlistTracksWithIds(playlist))),
                    titleBadge: playlist.syncedFrom?.isCollaborator === true && React.createElement('span', { className: 'shared-playlist-badge', style: { display: 'inline-flex' } },
                      React.createElement(Badge, { tone: 'accent', icon: Icons.Users, tooltip: 'You’re a collaborator on this playlist: your edits sync to the other collaborators' }, 'Shared')),
                    // A playlist kept updated from its link: a hosted XSPF
                    // shows the Hosted badge, which already says it updates
                    // (Check now is on its page); any other shows a check-now
                    // button. A snapshot shows neither: it never changes
                    // (lib/playlist-update-mode.js). An AI playlist says who
                    // made it.
                    cornerBadges: linkUpdateMode(playlist) === 'auto'
                      ? (playlist.source === 'hosted-xspf'
                        ? React.createElement(Badge, { tone: 'surface', icon: Icons.Globe, tooltip: 'Hosted playlist: updates from its link' }, 'Hosted')
                        : React.createElement(Button, { variant: 'icon', size: 'sm', className: '!rounded-full bg-surface-card', onClick: async (e) => {
                              e.stopPropagation();
                              if (refreshingPlaylist === playlist.id) return;
                              setRefreshingPlaylist(playlist.id);
                              try { await refreshHostedPlaylist(playlist.id); }
                              finally { setRefreshingPlaylist(null); }
                            }, 'aria-label': 'Check for updates now', 'data-tooltip': 'Updates on its own from its link. Check now' }, React.createElement(Icons.RefreshCw, { className: `w-3 h-3 text-ink-secondary ${refreshingPlaylist === playlist.id ? 'animate-spin' : ''}` })))
                      : (playlist.isAiPlaylist && !playlist.sourceUrl
                          ? React.createElement(Badge, { tone: 'surface', icon: Icons.Sparkles, tooltip: `Made by ${playlist.creator || 'Shuffleupagus'}` }, 'AI')
                          : null)
                  }, playlistCardActions(playlist)));
                }),
                // Trailing skeletons while hosted playlists are still loading
                ...(playlistsLoading ? Array.from({ length: 4 }).map((_, i) =>
                  React.createElement(CardSkeleton, { key: `trailing-skeleton-${i}`, index: i, lines: 1 })
                ) : [])
              );
            }

            // Table view
            return React.createElement('div', { role: 'list', className: 'space-y-0' },
              sorted.map((playlist, index) => {
                const covers = allPlaylistCovers[playlist.id] || [];
                const hasCachedCovers = covers.length > 0;
                const trackCount = playlist.tracks?.length || 0;

                return React.createElement(CardButton, { role: 'listitem', label: playlist.title,
                  key: playlist.id,
                  draggable: true,
                  onDragStart: (e) => {
                    const tracksWithIds = (playlist.tracks || []).map(track => {
                      const trackId = trackSlug(track.artist || 'unknown', track.title || 'untitled', track.album || 'noalbum');
                      return { ...track, id: trackId, sources: {} };
                    });
                    e.dataTransfer.effectAllowed = 'copy';
                    e.dataTransfer.setData('text/plain', JSON.stringify({
                      type: 'playlist',
                      playlist: {
                        id: playlist.id,
                        title: playlist.title,
                        creator: playlist.creator,
                        tracks: tracksWithIds
                      }
                    }));
                  },
                  onActivate: (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    loadPlaylist(playlist);
                  },
                  onContextMenu: (e) => {
                    e.preventDefault();
                    if (window.electron?.contextMenu?.showTrackMenu) {
                      const tracksWithIds = (playlist.tracks || []).map((track, idx) => {
                        const trackId = trackSlug(track.artist || 'unknown', track.title || 'untitled', track.album || 'noalbum');
                        return { ...track, id: trackId, sources: {} };
                      });
                      window.showItemMenu(playlistMenu(playlist, tracksWithIds));
                    }
                  },
                  className: `group flex items-center gap-4 py-3 px-4 cursor-pointer hover:bg-surface-hover transition-colors ${index > 0 ? 'border-t border-line-light' : ''}`
                },
                  // Thumbnail (the mosaic/placeholder, with the playlist's
                  // own cover AFTER it — the cover img and the tiles are both
                  // positioned, and positioned siblings paint in DOM order)
                  React.createElement('div', {
                    className: 'relative w-12 h-12 rounded overflow-hidden flex-shrink-0'
                  },
                    hasCachedCovers ?
                      React.createElement('div', { className: 'grid grid-cols-2 grid-rows-2 w-full h-full' },
                        [0, 1, 2, 3].map(idx => {
                          // A tile still loading is the placeholder grey, as
                          // the grid's mosaic is (components/card-art.js).
                          return React.createElement('div', {
                            key: idx,
                            className: 'relative w-full h-full bg-surface-placeholder'
                          },
                            covers[idx] && React.createElement('img', {
                              src: covers[idx],
                              alt: '',
                              className: 'absolute inset-0 w-full h-full object-cover transition-opacity duration-slow',
                              style: { opacity: 0 },
                              ref: (el) => { if (el && el.complete && el.naturalWidth > 0) el.style.opacity = '1'; },
                              onLoad: (e) => { e.target.style.opacity = '1'; }
                            })
                          );
                        })
                      )
                    :
                      // No covers: the grid's placeholder and glyph
                      // (components/card-art.js). The row's Hosted and AI
                      // badges say what kind it is.
                      React.createElement('div', {
                        className: 'w-full h-full flex items-center justify-center bg-surface-placeholder'
                      },
                        React.createElement(PlaylistGlyph)
                      ),
                    // The playlist's own cover, over the mosaic/placeholder
                    playlist.coverArt && React.createElement(PlaylistCoverImage, { url: playlist.coverArt })
                  ),
                  // Playlist name
                  React.createElement('div', { className: 'flex-1 min-w-0' },
                    React.createElement('div', { className: 'font-medium text-ink-primary truncate' },
                      playlist.title,
                      playlist.syncedFrom?.isCollaborator === true && React.createElement('span', { className: 'shared-playlist-badge', style: { marginLeft: '6px', verticalAlign: 'middle', display: 'inline-flex' } },
                        React.createElement(Badge, { tone: 'accent', icon: Icons.Users, tooltip: 'You’re a collaborator on this playlist: your edits sync to the other collaborators' }, 'Shared'))
                    ),
                    playlist.creator && React.createElement('div', { className: 'text-sm text-ink-tertiary truncate' }, playlist.creator)
                  ),
                  // Hosted badge (only for actual hosted XSPF, not Spotify/Apple Music imports)
                  playlist.sourceUrl && playlist.source === 'hosted-xspf' && React.createElement(Badge, { tone: 'surface', icon: Icons.Globe, tooltip: 'Hosted playlist: updates from its link' }, 'Hosted'),
                  // AI badge
                  playlist.isAiPlaylist && !playlist.sourceUrl && React.createElement(Badge, { tone: 'accent', icon: Icons.Sparkles, tooltip: `Made by ${playlist.creator || 'Shuffleupagus'}` }, 'AI'),
                  // Track count
                  React.createElement('div', { className: 'text-sm text-ink-tertiary flex-shrink-0 w-20 text-right' },
                    countOf(trackCount, 'track')
                  ),
                  // Check now, for a playlist kept updated from its link. A
                  // snapshot has none: it never changes. A hosted XSPF has
                  // none either: its Hosted badge already says it updates,
                  // and Check now is on its page.
                  linkUpdateMode(playlist) === 'auto' && playlist.source !== 'hosted-xspf' && React.createElement('button', {
                    onClick: async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (refreshingPlaylist === playlist.id) return;
                      setRefreshingPlaylist(playlist.id);
                      try { await refreshHostedPlaylist(playlist.id); }
                      finally { setRefreshingPlaylist(null); }
                    },
                    className: 'w-8 h-8 flex items-center justify-center opacity-0 group-hover:opacity-100 card-reveal transition-opacity flex-shrink-0',
                    'aria-label': 'Check for updates now', 'data-tooltip': 'Updates on its own from its link. Check now',
                  },
                    React.createElement(Icons.RefreshCw, { className: `w-4 h-4 text-ink-tertiary ${refreshingPlaylist === playlist.id ? 'animate-spin' : ''}` })
                  ),
                  // Play icon on hover
                  React.createElement('button', { type: 'button', 'aria-label': 'Play playlist',
                    className: 'w-8 h-8 flex items-center justify-center opacity-0 group-hover:opacity-100 card-reveal transition-opacity flex-shrink-0 cursor-pointer hover:scale-110 transition-transform',
                    onClick: (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      // Play the playlist starting from first track
                      const tracks = playlist.tracks || [];
                      if (tracks.length > 0) {
                        // Create track objects with IDs matching the playlist view format
                        const tracksWithIds = tracks.map(track => {
                          const trackId = trackSlug(track.artist || 'unknown', track.title || 'untitled', track.album || 'noalbum');
                          return { ...track, id: trackId, sources: {} };
                        });
                        const context = { type: 'playlist', name: playlist.title };
                        const [firstTrack, ...remainingTracks] = tracksWithIds;
                        const taggedFirstTrack = { ...firstTrack, _playbackContext: context };
                        setQueueWithContext(remainingTracks, context, true);
                        handlePlay(taggedFirstTrack);
                      }
                    }
                  },
                    React.createElement(Play, { size: 20, className: 'text-accent', fill: 'currentColor' })
                  )
                );
              }),
              // Trailing skeletons while hosted playlists are still loading (table view)
              ...(playlistsLoading ? Array.from({ length: 4 }).map((_, i) =>
                React.createElement('div', {
                  key: `trailing-table-skeleton-${i}`, 'aria-hidden': 'true',
                  className: `flex items-center gap-4 py-3 px-4 border-t border-line-light`
                },
                  // Skeleton thumbnail
                  React.createElement('div', {
                    className: 'w-12 h-12 rounded overflow-hidden flex-shrink-0 shimmer-light animate-shimmer',
                    style: { backgroundSize: '200% 100%', animationDelay: `${i * 50}ms` }
                  }),
                  // Skeleton title/creator
                  React.createElement('div', { className: 'flex-1 min-w-0' },
                    React.createElement('div', {
                      className: 'h-4 shimmer-light rounded w-48 mb-2 animate-shimmer',
                      style: { backgroundSize: '200% 100%', animationDelay: `${i * 50}ms` }
                    }),
                    React.createElement('div', {
                      className: 'h-3 shimmer-light rounded w-24 animate-shimmer',
                      style: { backgroundSize: '200% 100%', animationDelay: `${i * 50 + 25}ms` }
                    })
                  ),
                  // Skeleton track count
                  React.createElement('div', {
                    className: 'h-4 shimmer-light rounded w-16 flex-shrink-0 animate-shimmer',
                    style: { backgroundSize: '200% 100%', animationDelay: `${i * 50 + 50}ms` }
                  })
                )
              ) : [])
            );
          })()
        )
      );
});

module.exports = { PlaylistsPage, PLAYLISTS_PAGE_HANDLERS };
