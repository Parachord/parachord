// src/renderer/components/search-page.js — the Search page (the box, history,
// and results: artists, albums, tracks, playlists, plus the per-category
// detail views), moved out of the Parachord component (maintainability plan
// Track 2b, fifth state-domain slice; the others are collection-page.js,
// home-page.js, playlist-view-page.js and artist-page.js). Search has the
// most result rows of any page, and every unrelated Parachord setState
// (playback, sync, toasts) used to re-render all of them.
//
// React.memo, fed only stable props: state values, useState setters, refs,
// useCallback results, and Parachord's plain functions as stable wrappers
// (useStableHandlers in app.js; the list is SEARCH_PAGE_HANDLERS). Two
// caches are read during render: getCachedAlbumArt() (albumArtCache) as an
// art fallback, and getItemsPerRow() (searchContainerWidth, a prop). Search
// art arrives by updating searchResults (fetchSearchAlbumArt writes the
// cache, then setSearchResults), so the memo re-renders when it lands.
// tests/renderer/page-memo.test.js checks the call site.
//
// The body is the original render expression, unchanged: it reads its inputs
// from props under their old names.

const Icons = require('./icons');
const { transition } = require('../lib/motion');
const { TextField } = require('./fields');
const { FilterBox, StickyBar } = require('./filter-box');
const { HeaderControl } = require('./header-control');
const { CardButton } = require('./card-button');
const { EmptyState, ErrorState } = require('./states');
const { SortMenu } = require('./sort-menu');
const { SectionHeader, SECTION_HEADER_GAP } = require('./section-header');
const { artistOpenOptions, creditOpenOptions, trackArtistOpenOptions } = require('../lib/artist-open');
const { VirtualizedTrackList, TrackRow } = require('./track-lists');
const { visibleSources } = require('../lib/visible-sources');
const { generateArtistPattern, PlayTop10Icon, SearchHistoryItem } = require('./cards');
const { ArtistCard, ArtistCardSkeleton } = require('./artist-card');
const { AlbumCard } = require('./album-card');
const { heroTabClass } = require('./hero-tabs');
const { trackSlug, slug } = require('../lib/track-slug');
const { releaseMenu, artistMenu } = require('../lib/item-menus');
const { countOf } = require('../lib/plural');
const { PlaylistCard } = require('./playlist-card');
const { CardSkeleton } = require('./home-skeletons');
const { Chip } = require('./filter-chips');

const { Play } = Icons;
// The in-flight album prefetch set app.js keeps on window, shared so a
// prefetch started from either side is seen by both. globalThis is window in
// the renderer, and still loads under plain Node (the render smoke test).
const prefetchInProgress = (globalThis._prefetchInProgress = globalThis._prefetchInProgress || new Set());

// Plain functions from Parachord, passed as stable wrappers.
const SEARCH_PAGE_HANDLERS = [
  'addToQueue',
  'albumCardActions',
  'clearSearchHistory',
  'fetchArtistData',
  'fetchSearchAlbumTracksAsync',
  'getArtistImage',
  'getArtistTopTracks',
  'playArtistTopTracks',
  'getCachedAlbumArt',
  'getItemsPerRow',
  'handleAlbumClick',
  'handlePlay',
  'handlePlaylistClick',
  'handlePlaylistDragEnd',
  'handleSearchArtBroken',
  'handleSearchInput',
  'navigateBack',
  'openChartsAlbum',
  'playlistCardActions',
  'prefetchSearchAlbumTracks',
  'saveSearchHistory',
  'setQueueWithContext',
];

const SearchPage = React.memo(function SearchPage(props) {
  const {
    activeResolvers,
    activeView,
    addToQueue,
    albumCardActions,
    allPlaylistCovers,
    allResolvers,
    artistImageCache,
    clearSearchHistory,
    currentTrack,
    fetchArtistData,
    fetchSearchAlbumTracksAsync,
    filteredHistoryMatches,
    getArtistImage,
    getArtistTopTracks,
    playArtistTopTracks,
    getCachedAlbumArt,
    getItemsPerRow,
    handleAlbumClick,
    handlePlay,
    handlePlaylistClick,
    handlePlaylistDragEnd,
    handleSearchDetailScroll,
    handleSearchArtBroken,
    handleSearchInput,
    handleSearchScrollContainerRef,
    isPlaying,
    isSearching,
    navigateBack,
    openChartsAlbum,
    playlistCardActions,
    playbackContext,
    playlists,
    prefetchSearchAlbumTracks,
    prefetchedReleasesRef,
    resolverOrder,
    saveSearchHistory,
    searchContainerWidth,
    searchDetailCategory,
    searchHeaderCollapsed,
    searchHistory,
    searchInputRef,
    searchQuery,
    searchResults,
    searchResultsContainerRef,
    searchResultsFilter,
    searchResultsFilterOpen,
    searchResultsSort,
    searchScrollContainerRef,
    searchTracksObserverRef,
    searchTracksRowRefs,
    setAddToPlaylistPanel,
    setDraggingTrackForPlaylist,
    setQueueWithContext,
    setSearchDetailCategory,
    setSearchPreviewItem,
    setSearchResultsFilter,
    setSearchResultsFilterOpen,
    setSearchResultsSort,
    setTrackLoading,
    showToast,
    trackSources,
  } = props;
  return searchDetailCategory ?
        // DETAIL VIEW - Similar structure to artist page with collapsible header
        React.createElement('div', {
          className: 'flex-1 flex flex-col page-bg',
          style: { overflow: 'hidden' }
        },
          // Header section (outside scrollable area)
          React.createElement('div', {
            className: 'relative',
            style: {
              height: searchHeaderCollapsed ? '70px' : '120px',
              flexShrink: 0,
              transition: transition('height', 'slow', 'out'),
              overflow: 'hidden'
            }
          },
            // Background: the neutral hero gradient, dark enough for its
            // white text (the old grey was about 2.5:1).
            React.createElement('div', {
              className: 'absolute inset-0',
              style: {
                background: 'var(--hero-neutral-gradient)'
              }
            }),
            // Header content - matches artist page collapsed header style
            React.createElement('div', {
              className: 'absolute inset-0 flex items-center px-6 z-10'
            },
              // Left: Search icon + query in quotes
              React.createElement('div', { className: 'flex items-center gap-3 flex-shrink-0 mr-6' },
                React.createElement(Icons.Search, { className: 'w-5 h-5 text-white/70' }),
                React.createElement('span', {
                  className: 'text-2xl font-light text-white uppercase',
                  style: { textShadow: 'var(--text-shadow-soft)', letterSpacing: '0.2em' }
                }, `"${searchQuery}"`)
              ),
              // Tabs (next to title, like artist page)
              React.createElement('div', {
                className: 'flex items-center gap-1',
                style: { textShadow: 'var(--text-shadow-soft)' }
              },
                [
                  { key: 'artists', label: 'Artists', count: searchResults.artists.length },
                  { key: 'albums', label: 'Albums', count: searchResults.albums.length },
                  { key: 'tracks', label: 'Tracks', count: searchResults.tracks.length }
                ].map((tab, i) => React.createElement(React.Fragment, { key: tab.key },
                  i > 0 && React.createElement('span', {
                    className: 'text-white/50 mx-2'
                  }, '|'),
                  React.createElement('button', {
                    onClick: () => {
                      setSearchDetailCategory(tab.key);
                    },
                    // The hero tab look (heroTabClass).
                    className: `px-2 py-1 text-sm uppercase tracking-wider transition-colors no-drag ${heroTabClass(searchDetailCategory === tab.key)}`
                  }, `${tab.count} ${tab.label}`)
                ))
              )
            )
          ),
          // Scrollable content area - single column layout with grids/lists
          React.createElement('div', {
            ref: handleSearchScrollContainerRef,
            className: 'flex-1 overflow-y-auto page-bg scrollable-content scroll-edge',
            onScroll: handleSearchDetailScroll
          },
            // Sticky filter bar for Artists (sort dropdown + search on right like other pages)
            searchDetailCategory === 'artists' && React.createElement(StickyBar, null,
              // Sort dropdown
              React.createElement(SortMenu, { value: searchResultsSort, options: [
                    { value: 'relevance', label: 'Relevance' },
                    { value: 'name', label: 'Name' }
                  ], onChange: setSearchResultsSort, label: "Sort" }),
              React.createElement('div', { className: 'flex-1' }),
              // Search/filter on right
              React.createElement(FilterBox, { value: searchResultsFilter, onChange: setSearchResultsFilter, open: searchResultsFilterOpen, onOpenChange: setSearchResultsFilterOpen })
            ),

            // Sticky filter bar for Albums (sort dropdown + search like Critical Darlings)
            searchDetailCategory === 'albums' && React.createElement(StickyBar, null,
              // Sort dropdown
              React.createElement(SortMenu, { value: searchResultsSort, options: [
                    { value: 'relevance', label: 'Relevance' },
                    { value: 'title', label: 'Title' },
                    { value: 'artist', label: 'Artist' },
                    { value: 'year-desc', label: 'Year (Newest)' },
                    { value: 'year-asc', label: 'Year (Oldest)' }
                  ], onChange: setSearchResultsSort, label: "Sort" }),
              React.createElement('div', { className: 'flex-1' }),
              // Search/filter
              React.createElement(FilterBox, { value: searchResultsFilter, onChange: setSearchResultsFilter, open: searchResultsFilterOpen, onOpenChange: setSearchResultsFilterOpen })
            ),

            // Sticky filter bar for Songs (sort dropdown + search)
            searchDetailCategory === 'tracks' && React.createElement(StickyBar, null,
              // Sort dropdown
              React.createElement(SortMenu, { value: searchResultsSort, options: [
                    { value: 'relevance', label: 'Relevance' },
                    { value: 'title', label: 'Title' },
                    { value: 'artist', label: 'Artist' },
                    { value: 'duration-asc', label: 'Duration (Short)' },
                    { value: 'duration-desc', label: 'Duration (Long)' }
                  ], onChange: setSearchResultsSort, label: "Sort" }),
              React.createElement('div', { className: 'flex-1' }),
              // Search/filter
              React.createElement(FilterBox, { value: searchResultsFilter, onChange: setSearchResultsFilter, open: searchResultsFilterOpen, onOpenChange: setSearchResultsFilterOpen })
            ),

            // Content container with padding
            React.createElement('div', { className: 'px-6 py-6' },
              // Artists grid (like Recommendations)
              searchDetailCategory === 'artists' && (() => {
                // Filter and sort artists
                const filteredArtists = searchResultsFilter
                  ? searchResults.artists.filter(a => a.name?.toLowerCase().includes(searchResultsFilter.toLowerCase()))
                  : [...searchResults.artists];

                // Sort artists
                if (searchResultsSort === 'name') {
                  filteredArtists.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                }
                // 'relevance' keeps original order from search results

                return filteredArtists.length > 0 && React.createElement('div', { role: 'list',
                  className: 'grid gap-4',
                  style: { gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }
                },
                  ...filteredArtists.map((artist, index) => React.createElement(ArtistCard, {
                    key: artist._rowKey || artist.id,
                    role: 'listitem',
                    artist: { id: slug(artist.name || 'unknown'), name: artist.name },
                    image: artist.image,
                    imageLoaded: !!artist.imageLoaded,
                    animationDelay: Math.min(index * 30, 300),
                    onOpen: () => fetchArtistData(artist.name, artistOpenOptions(artist)),
                    onPlay: playArtistTopTracks,
                    onContextMenu: () => window.showItemMenu(artistMenu({ id: slug(artist.name || 'unknown'), name: artist.name, image: artist.image || null }))
                  }))
                );
              })(),

              // Artists empty state
              searchDetailCategory === 'artists' && (searchResultsFilter
                ? searchResults.artists.filter(a => a.name?.toLowerCase().includes(searchResultsFilter.toLowerCase())).length === 0
                : searchResults.artists.length === 0
              ) && React.createElement('div', {
                className: 'text-center py-12 text-ink-tertiary'
              }, searchResultsFilter ? 'No artists match your filter.' : 'No artists found.'),

              // Albums grid (like Critical Darlings)
              searchDetailCategory === 'albums' && (() => {
                // Filter and sort albums
                const filteredAlbums = searchResultsFilter
                  ? searchResults.albums.filter(a =>
                      a.title?.toLowerCase().includes(searchResultsFilter.toLowerCase()) ||
                      a['artist-credit']?.[0]?.name?.toLowerCase().includes(searchResultsFilter.toLowerCase())
                    )
                  : [...searchResults.albums];

                // Sort albums
                if (searchResultsSort === 'title') {
                  filteredAlbums.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
                } else if (searchResultsSort === 'artist') {
                  filteredAlbums.sort((a, b) =>
                    (a['artist-credit']?.[0]?.name || '').localeCompare(b['artist-credit']?.[0]?.name || '')
                  );
                } else if (searchResultsSort === 'year-desc') {
                  filteredAlbums.sort((a, b) => {
                    const yearA = parseInt(a['first-release-date']?.split('-')[0]) || 0;
                    const yearB = parseInt(b['first-release-date']?.split('-')[0]) || 0;
                    return yearB - yearA;
                  });
                } else if (searchResultsSort === 'year-asc') {
                  filteredAlbums.sort((a, b) => {
                    const yearA = parseInt(a['first-release-date']?.split('-')[0]) || 9999;
                    const yearB = parseInt(b['first-release-date']?.split('-')[0]) || 9999;
                    return yearA - yearB;
                  });
                }

                return filteredAlbums.length > 0 && React.createElement('div', { role: 'list',
                  className: 'card-grid gap-x-4 gap-y-5 pb-6'
                },
                  // The shared album card (components/album-card.js).
                  filteredAlbums.map((album, index) => {
                    const artistName = album['artist-credit']?.[0]?.name || 'Unknown';
                    return React.createElement(AlbumCard, Object.assign({
                      key: album._rowKey || album.id,
                      role: 'listitem',
                      album: { id: album.id, title: album.title, artist: artistName, imageUrl: album.albumArt || null },
                      animationDelay: Math.min(index * 30, 300),
                      dragData: () => ({
                        type: 'album',
                        album: {
                          id: trackSlug(artistName === 'Unknown' ? 'unknown' : artistName, album.title || 'untitled'),
                          title: album.title,
                          artist: artistName,
                          year: album['first-release-date']?.split('-')[0] ? parseInt(album['first-release-date'].split('-')[0]) : null,
                          art: album.albumArt || null,
                          trackCount: prefetchedReleasesRef.current[album.id]?.tracks?.length || null
                        }
                      }),
                      onHoverPrefetch: () => prefetchSearchAlbumTracks(album),
                      onOpen: () => handleAlbumClick(album),
                      onOpenArtist: () => fetchArtistData(album['artist-credit']?.[0]?.name, creditOpenOptions(album['artist-credit'])),
                      onContextMenu: () => {
                        const albumData = { ...album, artist: artistName, releaseGroupMbid: album.id }; // a MusicBrainz release group
                        const prefetched = prefetchedReleasesRef.current[album.id];
                        window.showItemMenu(releaseMenu(albumData, { tracks: prefetched?.tracks, loading: prefetchInProgress.has(album.id) }));
                      },
                      onArtError: () => handleSearchArtBroken('album', album, album.albumArt)
                    }, albumCardActions({
                      title: album.title, artist: artistName,
                      context: { type: 'album', id: album.id, name: album.title, artist: artistName },
                      getTracks: async () => (await fetchSearchAlbumTracksAsync(album))?.tracks
                    })));
                  })
                );
              })(),

              // Albums empty state
              searchDetailCategory === 'albums' && (() => {
                const filteredAlbums = searchResultsFilter
                  ? searchResults.albums.filter(a =>
                      a.title?.toLowerCase().includes(searchResultsFilter.toLowerCase()) ||
                      a['artist-credit']?.[0]?.name?.toLowerCase().includes(searchResultsFilter.toLowerCase())
                    )
                  : searchResults.albums;
                return filteredAlbums.length === 0;
              })() && React.createElement('div', {
                className: 'text-center py-12 text-ink-tertiary'
              }, searchResultsFilter ? 'No albums match your filter.' : 'No albums found.'),

              // Tracks list (like Recommended Songs)
              searchDetailCategory === 'tracks' && (() => {
                // Filter and sort tracks
                const filteredTracks = searchResultsFilter
                  ? searchResults.tracks.filter(t =>
                      t.title?.toLowerCase().includes(searchResultsFilter.toLowerCase()) ||
                      t.artist?.toLowerCase().includes(searchResultsFilter.toLowerCase())
                    )
                  : [...searchResults.tracks];

                // Sort tracks
                if (searchResultsSort === 'title') {
                  filteredTracks.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
                } else if (searchResultsSort === 'artist') {
                  filteredTracks.sort((a, b) => (a.artist || '').localeCompare(b.artist || ''));
                } else if (searchResultsSort === 'duration-asc') {
                  filteredTracks.sort((a, b) => (a.duration || 0) - (b.duration || 0));
                } else if (searchResultsSort === 'duration-desc') {
                  filteredTracks.sort((a, b) => (b.duration || 0) - (a.duration || 0));
                }

                return filteredTracks.length > 0 && React.createElement(VirtualizedTrackList, {
                  tracks: filteredTracks,
                  parentRef: searchScrollContainerRef,
                  renderRow: (track, index) => {
                    const isCurrentTrack = currentTrack?.id === track.id;
                    const isNowPlaying = isCurrentTrack && playbackContext?.type === 'search';

                    return React.createElement(TrackRow, {
                      key: track._rowKey || track.id,
                      track,
                      number: String(index + 1).padStart(2, '0'),
                      isNowPlaying: isNowPlaying && isPlaying,
                      sources: { trackSources, playbackResolvers: activeResolvers, resolverOrder },
                      allResolvers,
                      duration: true,
                      // The shimmer only while Search is still resolving this one.
                      resolving: !!track.resolving,
                      rowRef: (el) => {
                        if (el) {
                          searchTracksRowRefs.current.set(track.id, el);
                          if (searchTracksObserverRef.current) searchTracksObserverRef.current.observe(el);
                        } else {
                          searchTracksRowRefs.current.delete(track.id);
                        }
                      },
                      draggable: true,
                      onDragStart: (e) => {
                        setDraggingTrackForPlaylist(track);
                        e.dataTransfer.effectAllowed = 'copy';
                        e.dataTransfer.setData('text/plain', JSON.stringify({
                          type: 'track',
                          track: { id: track.id, title: track.title, artist: track.artist, album: track.album, duration: track.duration, albumArt: track.albumArt, sources: track.sources || {} }
                        }));
                      },
                      onDragEnd: () => handlePlaylistDragEnd(),
                      onPlay: (resolverId) => {
                        setQueueWithContext(filteredTracks.slice(index + 1), { type: 'search', name: searchQuery });
                        handlePlay(resolverId ? { ...track, preferredResolver: resolverId } : track);
                      },
                      onOpenArtist: () => fetchArtistData(track.artist, trackArtistOpenOptions(track)),
                      onContextMenu: () => window.showItemMenu({ type: 'track', track }),
                      cells: [{ key: 'album', content: track.album || '', onClick: track.album ? () => openChartsAlbum({ artist: track.artist, title: track.album, albumArt: track.albumArt }) : undefined }]
                    });
                  }
                });
              })(),

              // Tracks empty state
              searchDetailCategory === 'tracks' && (() => {
                const filteredTracks = searchResultsFilter
                  ? searchResults.tracks.filter(t =>
                      t.title?.toLowerCase().includes(searchResultsFilter.toLowerCase()) ||
                      t.artist?.toLowerCase().includes(searchResultsFilter.toLowerCase())
                    )
                  : searchResults.tracks;
                return filteredTracks.length === 0;
              })() && React.createElement('div', {
                className: 'text-center py-12 text-ink-tertiary'
              }, searchResultsFilter ? 'No tracks match your filter.' : 'No tracks found.'),

              // Playlists grid with cards
              searchDetailCategory === 'playlists' && searchResults.playlists.length > 0 && React.createElement('div', { role: 'list',
                className: 'card-grid gap-x-4 gap-y-5 pb-6'
              },
                searchResults.playlists.map((playlist, index) => {
                  return React.createElement(PlaylistCard, Object.assign({
                    role: 'listitem',
                    key: playlist.id || `${playlist.title}-${index}`,
                    // The playlist's own cover over its tracks' covers, as on
                    // the Playlists page (components/playlist-card.js).
                    playlist,
                    mosaic: allPlaylistCovers[playlist.id] || null,
                    subtitle: countOf(playlist.tracks?.length || 0, 'track'),
                    animationDelay: Math.min(index * 30, 300),
                    onOpen: () => handlePlaylistClick(playlist)
                  }, playlistCardActions(playlist)));
                })
              )
            )
          ) // end scrollable content
        ) // end detail view container
      :
        // MAIN VIEW - clean white layout matching reference
        React.createElement('div', {
          className: 'h-full overflow-y-auto page-bg'
        },
          // Header bar with SEARCH title and CLOSE button
          React.createElement('div', {
            className: 'flex items-center justify-between px-8 py-4 flex-shrink-0',
            style: {
              borderBottom: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--bg-secondary)'
            }
          },
            React.createElement('h1', {
              // The page's heading (#1386), drawn as the small header label.
              style: {
                margin: 0,
                fontSize: '11px',
                fontWeight: '600',
                letterSpacing: '0.08em',
                color: 'var(--text-tertiary)',
                textTransform: 'uppercase'
              }
            }, 'Search'),
            React.createElement(HeaderControl, { close: true, onClick: () => navigateBack() }, 'Close')
          ),

          // Content area
          React.createElement('div', { className: 'px-8 py-6', ref: searchResultsContainerRef },
        // Main view content
        React.createElement('div', null,
          // Large search input with cursor styling
          React.createElement('div', { className: 'mb-8' },
            // The shared text field (components/fields.js), bare: the page's
            // big type, where the caret is the focus sign.
            React.createElement(TextField, {
              bare: true,
              inputRef: (el) => {
                searchInputRef.current = el;
                if (el && activeView === 'search' && !searchQuery) el.focus();
              },
              value: searchQuery,
              onChange: (v) => handleSearchInput(v),
              onKeyDown: (e) => {
                // Prevent keyboard shortcuts from interfering while typing in search
                // Allow Escape to propagate for navigation, but stop other keys
                if (e.key !== 'Escape') {
                  e.stopPropagation();
                }
              },
              placeholder: '',
              className: 'w-full text-6xl font-extralight tracking-tight',
              style: {
                caretColor: 'var(--text-tertiary)',
                fontFamily: 'var(--font-sans)'
              }, 'aria-label': 'Search'
            })
          ),

        // Results area
        // Show search history when no query
        (!searchQuery) ?
          // Search history view
          (searchHistory.length > 0 ?
            React.createElement('div', { className: 'space-y-4' },
              // Header with clear all button
              React.createElement('div', { className: 'flex items-center justify-between' },
                React.createElement('h3', {
                  className: 'text-xs font-semibold text-ink-tertiary uppercase tracking-wider'
                }, 'Recent Searches'),
                React.createElement('button', {
                  onClick: () => clearSearchHistory(),
                  className: 'text-xs text-ink-tertiary hover:text-ink-danger transition-colors'
                }, 'Clear All')
              ),
              // History list
              React.createElement('div', { className: 'space-y-1' },
                ...searchHistory.slice(0, 10).map((entry, i) =>
                  React.createElement(SearchHistoryItem, {
                    key: `history-${i}-${entry.query}`,
                    entry,
                    onQueryClick: (query) => {
                      handleSearchInput(query);
                    },
                    onResultClick: (result) => {
                      // Navigate directly to the result
                      if (result.type === 'artist') {
                        fetchArtistData(result.name, artistOpenOptions(result));
                      } else if (result.type === 'album') {
                        handleAlbumClick({ id: result.id, title: result.name, 'artist-credit': [{ name: result.artist }] });
                      } else if (result.type === 'playlist') {
                        const playlist = playlists.find(p => p.id === result.id);
                        if (playlist) handlePlaylistClick(playlist);
                      } else if (result.type === 'track') {
                        // Play the track directly - create a minimal track object for resolution
                        const track = {
                          id: result.id,
                          title: result.name,
                          artist: result.artist,
                          albumArt: result.imageUrl,
                          sources: {}
                        };
                        handlePlay(track);
                      }
                    },
                    onRemove: (query) => clearSearchHistory(query)
                  })
                )
              )
            ) :
            // No history yet - show placeholder
            React.createElement(EmptyState, { icon: Icons.Search, title: 'Search your services', body: 'Start typing to find artists, albums, tracks and playlists.' })
          ) :
        // Skeletons only until the first results land: each category shows as
        // soon as it has rows (the services answer in a few hundred ms,
        // MusicBrainz's three requests seconds apart). Gating the whole list on
        // isSearching held every result back until the last request finished.
        isSearching &&
        searchResults.artists.length === 0 &&
        searchResults.albums.length === 0 &&
        searchResults.tracks.length === 0 &&
        searchResults.playlists.length === 0 ?
          // Loading skeletons - dynamically sized based on container width
          React.createElement('div', { className: 'space-y-10' },
            // Artists skeleton - square card style
            React.createElement('div', null,
              React.createElement(SectionHeader, { as: 'h3', title: 'Artists', style: SECTION_HEADER_GAP }),
              React.createElement('div', {
                className: 'grid gap-4',
                style: { gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }
              },
                ...Array(getItemsPerRow(160)).fill(null).map((_, i) =>
                  React.createElement(ArtistCardSkeleton, { key: `artist-skeleton-${i}`, index: i })
                )
              )
            ),
            // Songs skeleton - rounded style
            React.createElement('div', null,
              React.createElement(SectionHeader, { as: 'h3', title: 'Tracks', style: SECTION_HEADER_GAP }),
              React.createElement('div', { className: 'flex gap-4' },
                // The real row's count and width (getItemsPerRow(140)).
                ...Array(getItemsPerRow(140)).fill(null).map((_, i) => {
                  const skeletonWidth = Math.floor((searchContainerWidth - (getItemsPerRow(140) - 1) * 16) / getItemsPerRow(140));
                  return React.createElement('div', { key: `track-skeleton-${i}`, style: { width: skeletonWidth, flexShrink: 0 } }, React.createElement(CardSkeleton, { index: i, lines: 1 }));
                })
              )
            ),
            // Albums skeleton - rounded style
            React.createElement('div', null,
              React.createElement(SectionHeader, { as: 'h3', title: 'Albums', style: SECTION_HEADER_GAP }),
              React.createElement('div', { className: 'flex gap-4' },
                // The real row's count and width (getItemsPerRow(160)).
                ...Array(getItemsPerRow(160)).fill(null).map((_, i) => {
                  const skeletonWidth = Math.floor((searchContainerWidth - (getItemsPerRow(160) - 1) * 16) / getItemsPerRow(160));
                  return React.createElement('div', { key: `album-skeleton-${i}`, style: { width: skeletonWidth, flexShrink: 0 } }, React.createElement(CardSkeleton, { index: i, lines: 1 }));
                })
              )
            )
          )
        :
        // No results state (only show if no history matches either)
        searchResults.artists.length === 0 &&
        searchResults.albums.length === 0 &&
        searchResults.tracks.length === 0 &&
        searchResults.playlists.length === 0 &&
        filteredHistoryMatches.length === 0 ?
          React.createElement('div', { className: 'text-center py-12 text-ink-tertiary' },
            `No results found for "${searchQuery}"`
          )
        :
        // Results
        React.createElement('div', { className: 'space-y-10' },
          // Quick suggestions from search history (shown instantly while loading)
          filteredHistoryMatches.length > 0 && React.createElement('div', { className: 'mb-6' },
            React.createElement('h3', { className: 'text-xs font-semibold text-ink-tertiary uppercase tracking-wider mb-3' }, 'Suggestions'),
            React.createElement('div', { className: 'flex flex-wrap gap-2' },
              // The shared chip (components/filter-chips.js).
              ...filteredHistoryMatches.map((entry, i) =>
                React.createElement(Chip, {
                  key: `suggestion-${i}-${entry.query}`,
                  label: entry.selectedResult?.name || entry.query,
                  icon: entry.selectedResult?.imageUrl && React.createElement('img', {
                    src: entry.selectedResult.imageUrl, alt: '',
                    className: 'w-5 h-5 rounded-full object-cover'
                  }),
                  onClick: () => {
                    if (entry.selectedResult) {
                      // Navigate directly to the result
                      if (entry.selectedResult.type === 'artist') {
                        fetchArtistData(entry.selectedResult.name, artistOpenOptions(entry.selectedResult));
                      } else if (entry.selectedResult.type === 'album') {
                        handleAlbumClick({ id: entry.selectedResult.id, title: entry.selectedResult.name, 'artist-credit': [{ name: entry.selectedResult.artist }] });
                      } else if (entry.selectedResult.type === 'track') {
                        handlePlay({ id: entry.selectedResult.id, title: entry.selectedResult.name, artist: entry.selectedResult.artist, sources: {} });
                      }
                    } else {
                      handleSearchInput(entry.query);
                    }
                  }
                })
              )
            )
          ),
          // Artists section with image cards - responsive grid
          searchResults.artists.length > 0 && React.createElement('div', null,
            React.createElement(SectionHeader, {
              as: 'h3', title: 'Artists', style: SECTION_HEADER_GAP,
              action: searchResults.artists.length > 10 ? {
                label: 'Show more',
                onClick: () => {
                  setSearchDetailCategory('artists');
                  setSearchPreviewItem(searchResults.artists[0] || null);
                }
              } : null
            }),
            React.createElement('div', {
              className: 'flex gap-4'
            },
              ...searchResults.artists.slice(0, getItemsPerRow(160)).map(artist =>
                React.createElement(ArtistCard, {
                  key: artist._rowKey || artist.id,
                  artist: { id: slug(artist.name || 'unknown'), name: artist.name },
                  onOpen: () => {
                    // Get cached artist image if available
                    const normalizedName = artist.name?.trim().toLowerCase();
                    const cachedImage = normalizedName ? artistImageCache.current[normalizedName] : null;
                    saveSearchHistory(searchQuery, {
                      type: 'artist',
                      id: artist.id,
                      name: artist.name,
                      imageUrl: cachedImage?.url || null
                    });
                    fetchArtistData(artist.name, artistOpenOptions(artist));
                  },
                  getArtistImage: getArtistImage,
                  width: Math.floor((searchContainerWidth - (getItemsPerRow(160) - 1) * 16) / getItemsPerRow(160)),
                  onPlay: playArtistTopTracks,
                  onContextMenu: () => window.showItemMenu(artistMenu({ id: slug(artist.name || 'unknown'), name: artist.name, image: null }))
                })
              )
            )
          ),

          // Songs/Tracks section with album art cards - matching album card style
          searchResults.tracks.length > 0 && React.createElement('div', null,
            React.createElement(SectionHeader, {
              as: 'h3', title: 'Tracks', style: SECTION_HEADER_GAP,
              action: searchResults.tracks.length > 10 ? {
                label: 'Show more',
                onClick: () => {
                  setSearchDetailCategory('tracks');
                  setSearchPreviewItem(searchResults.tracks[0] || null);
                }
              } : null
            }),
            React.createElement('div', { role: 'list',
              className: 'flex gap-4'
            },
              ...searchResults.tracks.slice(0, getItemsPerRow(140)).map((track, index) => {
                const trackItemWidth = Math.floor((searchContainerWidth - (getItemsPerRow(140) - 1) * 16) / getItemsPerRow(140));
                const animationDelay = Math.min(index * 40, 300);
                return React.createElement(AlbumCard, {
                  role: 'listitem',
                  key: track._rowKey || track.id,
                  // A track card: the shared album card's shape (cover, title,
                  // artist, the overlay), labelled for the track.
                  album: { id: track.id, title: track.title, artist: track.artist, imageUrl: track.albumArt || getCachedAlbumArt(track.artist, track.album, track.releaseGroupId, track.releaseId) || null },
                  width: trackItemWidth,
                  animationDelay,
                  className: 'group',
                  label: `Play ${track.title} by ${track.artist}`,
                  onOpen: () => {
                    const cachedArt = getCachedAlbumArt(track.artist, track.album, track.releaseGroupId, track.releaseId);
                    saveSearchHistory(searchQuery, { type: 'track', id: track.id, name: track.title, artist: track.artist, imageUrl: track.albumArt || cachedArt });
                    handlePlay(track);
                  },
                  onPlay: () => {
                    const cachedArt = getCachedAlbumArt(track.artist, track.album, track.releaseGroupId, track.releaseId);
                    saveSearchHistory(searchQuery, { type: 'track', id: track.id, name: track.title, artist: track.artist, imageUrl: track.albumArt || cachedArt });
                    handlePlay(track);
                  },
                  onQueue: () => addToQueue([track]),
                  onAddToPlaylist: () => setAddToPlaylistPanel({ open: true, tracks: [track], sourceName: track.title, sourceType: 'track' }),
                  onArtError: () => handleSearchArtBroken('track', track, track.albumArt || getCachedAlbumArt(track.artist, track.album, track.releaseGroupId, track.releaseId)),
                  dragData: { type: 'track', track: { id: track.id, title: track.title, artist: track.artist, album: track.album, duration: track.duration, albumArt: track.albumArt, sources: track.sources || {} } },
                  onContextMenu: () => window.showItemMenu({
                    type: 'track',
                    track: { id: track.id, title: track.title, artist: track.artist, album: track.album, duration: track.duration, albumArt: track.albumArt, sources: track.sources || {} }
                  }),
                  // Source dots, bottom right (hidden on hover): the shared
                  // source-icon rule (lib/visible-sources), first four, each in
                  // its plugin's colour, dimmed like the row icons.
                  cornerBadge: (() => {
                    const dots = visibleSources(track, { trackSources, playbackResolvers: activeResolvers, resolverOrder }).slice(0, 4);
                    if (dots.length === 0) return null;
                    return React.createElement('div', {
                      className: 'absolute bottom-1.5 right-1.5 flex gap-1 transition-opacity group-hover:opacity-0'
                    },
                      ...dots.map(({ resolverId, dim }) => React.createElement('div', {
                        key: resolverId,
                        style: {
                          width: '7px', height: '7px', borderRadius: '50%',
                          backgroundColor: allResolvers.find(r => r.id === resolverId)?.color || 'var(--text-tertiary)',
                          opacity: dim ? 0.6 : 1,
                          boxShadow: 'var(--shadow-xs)'
                        }
                      }))
                    );
                  })()
                });
              })
            )
          ),

          // Albums section with album art cards - responsive grid
          searchResults.albums.length > 0 && React.createElement('div', null,
            React.createElement(SectionHeader, {
              as: 'h3', title: 'Albums', style: SECTION_HEADER_GAP,
              action: searchResults.albums.length > 8 ? {
                label: 'Show more',
                onClick: () => {
                  setSearchDetailCategory('albums');
                  setSearchPreviewItem(searchResults.albums[0] || null);
                }
              } : null
            }),
            React.createElement('div', { role: 'list',
              className: 'flex gap-x-4 gap-y-5'
            },
              // The shared album card (components/album-card.js), a fixed width
              // in the row; the year is its third line.
              ...searchResults.albums.slice(0, getItemsPerRow(160)).map((album, index) => {
                const artistName = album['artist-credit']?.[0]?.name || 'Unknown';
                return React.createElement(AlbumCard, Object.assign({
                  key: album._rowKey || album.id,
                  role: 'listitem',
                  width: Math.floor((searchContainerWidth - (getItemsPerRow(160) - 1) * 16) / getItemsPerRow(160)),
                  album: { id: album.id, title: album.title, artist: artistName, imageUrl: album.albumArt || null },
                  subtitle: album['first-release-date']?.split('-')[0] || null,
                  animationDelay: Math.min(index * 40, 300),
                  dragData: () => ({
                    type: 'album',
                    album: {
                      id: trackSlug(artistName === 'Unknown' ? 'unknown' : artistName, album.title || 'untitled'),
                      title: album.title,
                      artist: artistName,
                      year: album['first-release-date']?.split('-')[0] ? parseInt(album['first-release-date'].split('-')[0]) : null,
                      art: album.albumArt || null,
                      trackCount: prefetchedReleasesRef.current[album.id]?.tracks?.length || null
                    }
                  }),
                  onHoverPrefetch: () => prefetchSearchAlbumTracks(album),
                  onOpen: () => {
                    saveSearchHistory(searchQuery, {
                      type: 'album', id: album.id, name: album.title,
                      artist: album['artist-credit']?.[0]?.name, imageUrl: album.albumArt || null
                    });
                    handleAlbumClick(album);
                  },
                  onOpenArtist: () => fetchArtistData(album['artist-credit']?.[0]?.name, creditOpenOptions(album['artist-credit'])),
                  onContextMenu: () => {
                    const albumData = { ...album, artist: artistName, releaseGroupMbid: album.id };
                    const prefetched = prefetchedReleasesRef.current[album.id];
                    window.showItemMenu(releaseMenu(albumData, { tracks: prefetched?.tracks, loading: prefetchInProgress.has(album.id) }));
                  },
                  onArtError: () => handleSearchArtBroken('album', album, album.albumArt)
                }, albumCardActions({
                  title: album.title, artist: artistName,
                  context: { type: 'album', id: album.id, name: album.title, artist: artistName },
                  getTracks: async () => (await fetchSearchAlbumTracksAsync(album))?.tracks
                })));
              })
            )
          ),

          // Playlists section - single row with overflow hidden
          searchResults.playlists.length > 0 && React.createElement('div', null,
            React.createElement(SectionHeader, {
              as: 'h3', title: 'Playlists', style: SECTION_HEADER_GAP,
              action: searchResults.playlists.length > 5 ? {
                label: 'Show more',
                onClick: () => {
                  setSearchDetailCategory('playlists');
                  setSearchPreviewItem(searchResults.playlists[0] || null);
                }
              } : null
            }),
            React.createElement('div', {
              className: 'flex gap-4 overflow-hidden'
            },
              ...searchResults.playlists.slice(0, 20).map((playlist, index) => {
                return React.createElement(PlaylistCard, Object.assign({
                  key: playlist.id || `${playlist.title}-${index}`,
                  playlist,
                  mosaic: allPlaylistCovers[playlist.id] || null,
                  subtitle: countOf(playlist.tracks?.length || 0, 'track'),
                  width: '160px',
                  animationDelay: Math.min(index * 40, 300),
                  onOpen: () => {
                    saveSearchHistory(searchQuery, {
                      type: 'playlist',
                      id: playlist.id,
                      name: playlist.title,
                      imageUrl: null
                    });
                    handlePlaylistClick(playlist);
                  }
                }, playlistCardActions(playlist)));
              })
            )
          )
        )
        )
      )
    );
});

module.exports = { SearchPage, SEARCH_PAGE_HANDLERS };
