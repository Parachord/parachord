// src/renderer/components/critics-picks-page.js: Critical Darlings
// (activeView 'critics-picks'): albums the critics rate highly, as wide
// review cards, with search and sort (#1451, moved out of app.js).
//
// A React.memo'd page fed stable props, like the other pages: state,
// setters and callbacks by value, plain functions through
// useStableHandlers (CRITICS_PICKS_PAGE_HANDLERS, pinned by
// tests/renderer/page-memo.test.js). The markup moved as it was; window is
// read only inside handlers.

const Icons = require('./icons');
const { releaseDateKey } = require('../lib/release-date');
const { formatCalendarDate } = require('../lib/calendar-date');
const { FilterBox } = require('./filter-box');
const { PageHero } = require('./page-hero');
const { ArtOverlay } = require('./card-art');
const { hoverDwell } = require('../lib/hover-dwell');
const { SortMenu } = require('./sort-menu');
const { EmptyState, ErrorState } = require('./states');
const { releaseMenu } = require('../lib/item-menus');
const { CardButton } = require('./card-button');
const { transition } = require('../lib/motion');
const { hasArtistPage } = require('../lib/artist-page-name');

// The sort menu's choices (a constant: as a prop built in app.js it was a
// new array each render).
const criticsSortOptions = [
  { value: 'recent', label: 'Date added' },
  { value: 'artist', label: 'Artist name' },
];

const CRITICS_PICKS_PAGE_HANDLERS = [
  'addCriticsPicksToQueue',
  'copyParachordLink',
  'fetchArtistData',
  'loadCriticsPicks',
  'openCriticsPicksAlbum',
  'patchListArt',
  'prefetchCriticsPicksTracks',
  'retryBrokenListArt',
];

const CriticsPicksPage = React.memo(function CriticsPicksPage(props) {
  const {
    addCriticsPicksToQueue,
    copyParachordLink,
    criticsHeaderCollapsed,
    criticsPicks,
    criticsPicksError,
    criticsPicksLoaded,
    criticsPicksLoading,
    criticsSearch,
    criticsSearchOpen,
    criticsSort,
    fetchArtistData,
    filterCriticsPicks,
    handleCriticsScroll,
    handlePlay,
    loadCriticsPicks,
    openCriticsPicksAlbum,
    patchListArt,
    prefetchCriticsPicksTracks,
    prefetchedReleases,
    recommendationReleaseDates,
    retryBrokenListArt,
    setAddToPlaylistPanel,
    setCriticsPicks,
    setCriticsPicksError,
    setCriticsSearch,
    setCriticsSearchOpen,
    setCriticsSort,
    setQueueWithContext,
    setTrackLoading,
    sortCriticsPicks,
  } = props;
  return React.createElement('div', {
          className: 'flex-1 flex flex-col h-full',
          style: { overflow: 'hidden', minHeight: 0 }
        },
          // Header section (outside scrollable area)
          React.createElement(PageHero, {
collapsed: criticsHeaderCollapsed,
page: 'critics-picks',
title: 'Critical Darlings',
onTitleContextMenu: copyParachordLink,
expanded: React.createElement(React.Fragment, null,
React.createElement('div', {
                  className: 'flex items-center gap-1 mt-6',
                  style: { textShadow: 'var(--hero-text-shadow-line)' }
                },
                  React.createElement('span', {
                    className: 'px-2 py-1 text-sm font-medium uppercase tracking-wider text-white'
                  }, `${criticsPicks.length} Albums`)
                ),
React.createElement('p', {
                  className: 'mt-2 text-white/80 text-sm'
                }, 'Top-rated albums from leading music publications')),
collapsedContent: React.createElement(React.Fragment, null,
React.createElement('div', { className: 'flex-1' }),
React.createElement('span', {
                  className: 'text-sm font-medium uppercase tracking-wider text-white/80'
                }, `${criticsPicks.length} Albums`))
}),
          // Filter bar (outside scrollable area)
          React.createElement('div', {
            className: 'flex items-center px-6 py-3',
            style: { flexShrink: 0, backgroundColor: 'var(--bg-primary)', borderBottom: '1px solid var(--border-default)' }
          },
            // Sort dropdown
              React.createElement(SortMenu, { value: criticsSort, options: criticsSortOptions, onChange: setCriticsSort, label: "Sort" }),
              React.createElement('div', { className: 'flex-1' }),
              // Search
              React.createElement(FilterBox, { value: criticsSearch, onChange: setCriticsSearch, open: criticsSearchOpen, onOpenChange: setCriticsSearchOpen })
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
            onScroll: handleCriticsScroll
          },
            // Error state for critics picks
            criticsPicksError && !criticsPicksLoading && criticsPicksError && !criticsPicksLoading && React.createElement(ErrorState, { title: 'Couldn’t load Critical Darlings', body: criticsPicksError, onRetry: () => { setCriticsPicksError(null); loadCriticsPicks(); } }),

            // Skeleton loading state - show when loading OR when critics picks haven't been loaded yet.
            // Same box as the album cards below (12px padding, 10px radius, card
            // background + shadow, 180px cover, 12px between cards, text column
            // centered with the same line heights), so the list doesn't jump
            // when the picks arrive.
            !criticsPicksError && (criticsPicksLoading || !criticsPicksLoaded) && React.createElement('div', {
              className: 'space-y-3 pb-6'
            },
            Array.from({ length: 8 }).map((_, i) => {
              // A shimmer bar of the given height inside a text line of lineHeight.
              const line = (lineHeight, barHeight, width, delay, marginTop = 0) => React.createElement('div', {
                style: { height: `${lineHeight}px`, marginTop: `${marginTop}px`, display: 'flex', alignItems: 'center' }
              },
                React.createElement('div', {
                  className: 'shimmer-light rounded animate-shimmer',
                  style: { height: `${barHeight}px`, width, backgroundSize: '200% 100%', animationDelay: `${i * 50 + delay}ms` }
                })
              );
              return React.createElement('div', {
                key: `skeleton-${i}`,
                className: 'flex gap-4',
                style: { padding: '12px', borderRadius: '10px', backgroundColor: 'var(--card-bg)', boxShadow: 'var(--card-shadow)' }
              },
                // Cover (the cards' 180px album-art-container)
                React.createElement('div', {
                  className: 'shimmer-light animate-shimmer',
                  style: { width: '180px', height: '180px', flexShrink: 0, borderRadius: '8px', backgroundSize: '200% 100%', animationDelay: `${i * 50}ms` }
                }),
                // Title (15px), artist (13px, 2px gap), two synopsis lines (12px, 8px
                // gap); every line at the base 1.5 line height
                React.createElement('div', {
                  style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }
                },
                  // Title (16px), artist, the release date line, the synopsis.
                  line(24, 14, '40%', 25),
                  line(19.5, 12, '25%', 50, 2),
                  line(18, 10, '18%', 60, 2),
                  line(18, 10, '100%', 75, 8),
                  line(18, 10, '80%', 100)
                )
              );
            })
          ),

          // Albums grid with filter/sort - only show when loaded and not loading
          criticsPicksLoaded && !criticsPicksLoading && (() => {
            const filtered = filterCriticsPicks(criticsPicks);
            const sorted = sortCriticsPicks(filtered);

            if (sorted.length === 0 && criticsSearch) {
              return React.createElement(EmptyState, { icon: Icons.Search, title: 'No albums match your search', body: 'Try other words, or clear the filter.' });
            }

            if (sorted.length === 0) {
              return React.createElement(EmptyState, { title: 'No critics’ picks yet', body: 'The picks didn’t load. Try again in a moment.' });
            }

            return React.createElement('div', { role: 'list',
              className: 'space-y-3 pb-6'
            },
              sorted.map((album, index) =>
              React.createElement(CardButton, { role: 'listitem', label: `${album.title} by ${album.artist}`,
                key: album.id,
                className: 'group flex gap-4 cursor-grab active:cursor-grabbing release-card card-fade-up',
                style: {
                  padding: '12px',
                  borderRadius: '10px',
                  backgroundColor: 'var(--card-bg)',
                  border: 'none',
                  boxShadow: 'var(--card-shadow)',
                  animationDelay: `${Math.min(index * 40, 400)}ms`
                },
                draggable: true,
                onDragStart: (e) => {
                  e.dataTransfer.effectAllowed = 'copy';
                  const prefetched = prefetchedReleases[album.id];
                  const albumData = {
                    type: 'album',
                    album: {
                      id: album.id,
                      title: album.title,
                      artist: album.artist,
                      year: album.pubDate ? album.pubDate.getFullYear() : null,
                      art: album.albumArt || null,
                      trackCount: prefetched?.tracks?.length || null
                    }
                  };
                  e.dataTransfer.setData('text/plain', JSON.stringify(albumData));
                },
                // The track lookup after a 250ms dwell (a scroll past doesn't fetch).
                ...hoverDwell(() => prefetchCriticsPicksTracks(album)),
                onActivate: () => openCriticsPicksAlbum(album),
                onContextMenu: (e) => {
                  e.preventDefault();
                  if (window.electron?.contextMenu?.showTrackMenu) {
                    const prefetched = prefetchedReleases[album.id];
                    window.showItemMenu(releaseMenu(album, { tracks: prefetched?.tracks }));
                  }
                }
              },
                // Album art - left column - Cinematic Light design
                React.createElement('div', {
                  className: `album-art-container ${album.albumArt === undefined ? 'animate-shimmer' : ''}`,
                  style: {
                    width: '180px',
                    height: '180px',
                    flexShrink: 0,
                    borderRadius: '8px',
                    overflow: 'hidden',
                    position: 'relative',
                    background: album.albumArt === null
                      ? 'var(--placeholder-bg)'
                      : album.albumArt === undefined
                        ? 'linear-gradient(to right, var(--shimmer-from), var(--shimmer-via), var(--shimmer-to))'
                        : 'var(--placeholder-bg-light)',
                    backgroundSize: album.albumArt === undefined ? '200% 100%' : undefined
                  }
                },
                  // Placeholder icon - only show when art fetch completed with no result (null)
                  album.albumArt === null && React.createElement('div', {
                    style: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }
                  },
                    React.createElement('svg', {
                      style: { width: '32px', height: '32px', color: 'var(--on-dark-track)' },
                      fill: 'none',
                      viewBox: '0 0 24 24',
                      stroke: 'currentColor',
                      strokeWidth: 1
                    },
                      React.createElement('circle', { cx: 12, cy: 12, r: 10 }),
                      React.createElement('circle', { cx: 12, cy: 12, r: 3 }),
                      React.createElement('circle', { cx: 12, cy: 12, r: 6, strokeDasharray: '2 2' })
                    )
                  ),
                  // Image - show when we have a URL string
                  typeof album.albumArt === 'string' && React.createElement('img', {
                    key: album.albumArt,
                    src: album.albumArt,
                    alt: album.title,
                    style: {
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      opacity: 0,
                      transition: transition([['opacity', 'slow', 'out'], ['transform', 'slow']])
                    },
                    className: 'group-hover:scale-105',
                    ref: (el) => { if (el && el.complete && el.naturalWidth > 0) el.style.opacity = '1'; },
                    onLoad: (e) => { e.target.style.opacity = '1'; },
                    onError: (e) => {
                      e.target.style.display = 'none';
                      retryBrokenListArt(album.albumArt, { artist: album.artist, album: album.title, id: album.id }, patchListArt(setCriticsPicks));
                    }
                  }),
                  // Hover overlay with action buttons (Add to Playlist, Play, Queue)
                  // The app's art overlay, shown by CSS on hover or keyboard focus.
React.createElement(ArtOverlay, {
title: album.title,
onAddToPlaylist: () => {
const prefetched = prefetchedReleases[album.id];
                        if (prefetched?.tracks?.length > 0) {
                          setAddToPlaylistPanel({
                            open: true,
                            tracks: prefetched.tracks,
                            sourceName: album.title,
                            sourceType: 'album'
                          });
                        }
                      },
onPlay: async () => {
setTrackLoading(true);
                        const tracks = await prefetchCriticsPicksTracks(album);
                        if (tracks?.length > 0) {
                          const context = { type: 'album', id: album.id, name: album.title, artist: album.artist };
                          const [firstTrack, ...remainingTracks] = tracks;
                          // Tag the first track with context so queue navigation works correctly
                          const taggedFirstTrack = { ...firstTrack, _playbackContext: context };
                          setQueueWithContext(remainingTracks, context, true);
                          handlePlay(taggedFirstTrack);
                        } else {
                          setTrackLoading(false);
                        }
                      },
onQueue: () => {
addCriticsPicksToQueue(album);
                      }
})
                ),
                // Album info - right column - refined typography
                React.createElement('div', {
                  style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }
                },
                  React.createElement('div', {
                    style: {
                      fontWeight: 500,
                      fontSize: '16px',
                      color: 'var(--text-primary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      transition: transition('color', 'fast')
                    }
                  }, album.title),
                  // Plain text for "Various Artists", which has no page.
                  React.createElement(hasArtistPage(album.artist) ? 'button' : 'div', Object.assign({
                    style: {
                      fontSize: '13px',
                      color: 'var(--text-secondary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      marginTop: '2px'
                    }
                  }, hasArtistPage(album.artist) ? {
                    type: 'button',
                    className: 'block max-w-full text-left hover:text-accent cursor-pointer transition-colors duration-fast',
                    onClick: (e) => {
                      e.stopPropagation();
                      fetchArtistData(album.artist);
                    }
                  } : { className: 'block max-w-full text-left' }), album.artist),
                  // The release date, from MusicBrainz (the feed's date is
                  // when the pick was published). Its line is kept while the
                  // lookup runs, so the card doesn't move when it lands.
                  React.createElement('div', {
                    style: { fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '2px' }
                  }, (() => {
                    const known = recommendationReleaseDates[releaseDateKey(album.artist || '', album.title || '')];
                    return (known && known.date && formatCalendarDate(known.date, 'long')) || '\u00a0';
                  })()),
                  // Synopsis
                  album.description && React.createElement('p', {
                    style: {
                      fontSize: '12px',
                      color: 'var(--text-tertiary)',
                      marginTop: '8px',
                      lineHeight: '1.5'
                    }
                  }, album.description)
                )
              )
            )
            );
          })()
          )
        );
});

module.exports = { CriticsPicksPage, CRITICS_PICKS_PAGE_HANDLERS };
