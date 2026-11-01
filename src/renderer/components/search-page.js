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
const { ResolverIcon } = require('./ui-atoms');
const { artistOpenOptions, creditOpenOptions, trackArtistOpenOptions } = require('../lib/artist-open');
const { VirtualizedTrackList, getBestSourceConfidence } = require('./track-lists');
const { generateArtistPattern, PlayTop10Icon, QueueTop10Icon, SearchArtistCard, SearchHistoryItem } = require('./cards');
const { trackSlug, slug } = require('../lib/track-slug');

const { Play } = Icons;
// The in-flight album prefetch set app.js keeps on window, shared so a
// prefetch started from either side is seen by both. globalThis is window in
// the renderer, and still loads under plain Node (the render smoke test).
const prefetchInProgress = (globalThis._prefetchInProgress = globalThis._prefetchInProgress || new Set());

// Plain functions from Parachord, passed as stable wrappers.
const SEARCH_PAGE_HANDLERS = [
  'addToQueue',
  'clearSearchHistory',
  'fetchArtistData',
  'fetchSearchAlbumTracksAsync',
  'getArtistImage',
  'getArtistTopTracks',
  'getCachedAlbumArt',
  'getItemsPerRow',
  'handleAlbumClick',
  'handlePlay',
  'handlePlaylistClick',
  'handlePlaylistDragEnd',
  'handleSearchInput',
  'navigateBack',
  'openChartsAlbum',
  'prefetchSearchAlbumTracks',
  'saveSearchHistory',
  'setQueueWithContext',
];

const SearchPage = React.memo(function SearchPage(props) {
  const {
    activeResolvers,
    activeView,
    addToQueue,
    allResolvers,
    artistImageCache,
    clearSearchHistory,
    currentTrack,
    fetchArtistData,
    fetchSearchAlbumTracksAsync,
    filteredHistoryMatches,
    formatTime,
    getArtistImage,
    getArtistTopTracks,
    getCachedAlbumArt,
    getItemsPerRow,
    handleAlbumClick,
    handlePlay,
    handlePlaylistClick,
    handlePlaylistDragEnd,
    handleSearchDetailScroll,
    handleSearchInput,
    handleSearchScrollContainerRef,
    isPlaying,
    isSearching,
    navigateBack,
    openChartsAlbum,
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
    searchResultsSortDropdownOpen,
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
    setSearchResultsSortDropdownOpen,
    setTrackLoading,
    showToast,
    trackSources,
  } = props;
  return searchDetailCategory ?
        // DETAIL VIEW - Similar structure to artist page with collapsible header
        React.createElement('div', {
          className: 'flex-1 flex flex-col bg-white',
          style: { overflow: 'hidden' }
        },
          // Header section (outside scrollable area)
          React.createElement('div', {
            className: 'relative',
            style: {
              height: searchHeaderCollapsed ? '70px' : '120px',
              flexShrink: 0,
              transition: 'height 300ms ease-out',
              overflow: 'hidden'
            }
          },
            // Background - light gray gradient
            React.createElement('div', {
              className: 'absolute inset-0',
              style: {
                background: 'linear-gradient(135deg, #6b7280 0%, #9ca3af 50%, #6b7280 100%)'
              }
            }),
            // Header content - matches artist page collapsed header style
            React.createElement('div', {
              className: 'absolute inset-0 flex items-center px-6 z-10'
            },
              // Left: Search icon + query in quotes
              React.createElement('div', { className: 'flex items-center gap-3 flex-shrink-0 mr-6' },
                React.createElement('svg', { className: 'w-5 h-5 text-white/70', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                  React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
                ),
                React.createElement('span', {
                  className: 'text-2xl font-light text-white uppercase',
                  style: { textShadow: '0 2px 10px rgba(0,0,0,0.3)', letterSpacing: '0.2em' }
                }, `"${searchQuery}"`)
              ),
              // Tabs (next to title, like artist page)
              React.createElement('div', {
                className: 'flex items-center gap-1',
                style: { textShadow: '0 1px 10px rgba(0,0,0,0.3)' }
              },
                [
                  { key: 'artists', label: 'Artists', count: searchResults.artists.length },
                  { key: 'albums', label: 'Albums', count: searchResults.albums.length },
                  { key: 'tracks', label: 'Songs', count: searchResults.tracks.length }
                ].map((tab, i) => React.createElement(React.Fragment, { key: tab.key },
                  i > 0 && React.createElement('span', {
                    className: 'text-white/50 mx-2'
                  }, '|'),
                  React.createElement('button', {
                    onClick: () => {
                      setSearchDetailCategory(tab.key);
                    },
                    className: `px-2 py-1 text-sm font-medium uppercase tracking-wider transition-colors no-drag ${
                      searchDetailCategory === tab.key ? 'text-white' : 'text-white/60 hover:text-white'
                    }`
                  }, `${tab.count} ${tab.label}`)
                ))
              )
            )
          ),
          // Scrollable content area - single column layout with grids/lists
          React.createElement('div', {
            ref: handleSearchScrollContainerRef,
            className: 'flex-1 overflow-y-auto bg-white scrollable-content',
            onScroll: handleSearchDetailScroll
          },
            // Sticky filter bar for Artists (sort dropdown + search on right like other pages)
            searchDetailCategory === 'artists' && React.createElement('div', {
              className: 'sticky top-0 z-10 flex items-center px-6 py-3',
              style: { backgroundColor: 'var(--bg-primary)', borderBottom: '1px solid var(--border-default)' }
            },
              // Sort dropdown
              React.createElement('div', { className: 'relative' },
                React.createElement('button', {
                  onClick: (e) => { e.stopPropagation(); setSearchResultsSortDropdownOpen(!searchResultsSortDropdownOpen); },
                  className: 'flex items-center gap-1 px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors no-drag'
                },
                  React.createElement('span', null,
                    searchResultsSort === 'relevance' ? 'Relevance' :
                    searchResultsSort === 'name' ? 'Name' : 'Sort'
                  ),
                  React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M19 9l-7 7-7-7' })
                  )
                ),
                searchResultsSortDropdownOpen && React.createElement('div', {
                  className: 'absolute left-0 top-full mt-1 bg-white rounded-lg shadow-lg py-1 min-w-[160px] z-30 border border-gray-200'
                },
                  [
                    { value: 'relevance', label: 'Relevance' },
                    { value: 'name', label: 'Name' }
                  ].map(option =>
                    React.createElement('button', {
                      key: option.value,
                      onClick: (e) => {
                        e.stopPropagation();
                        setSearchResultsSort(option.value);
                        setSearchResultsSortDropdownOpen(false);
                      },
                      className: `w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center justify-between no-drag ${
                        searchResultsSort === option.value ? 'text-gray-900 font-medium' : 'text-gray-600'
                      }`
                    },
                      option.label,
                      searchResultsSort === option.value && React.createElement('svg', {
                        className: 'w-4 h-4',
                        fill: 'none',
                        viewBox: '0 0 24 24',
                        stroke: 'currentColor'
                      },
                        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M5 13l4 4L19 7' })
                      )
                    )
                  )
                )
              ),
              React.createElement('div', { className: 'flex-1' }),
              // Search/filter on right
              React.createElement('div', { className: 'flex items-center' },
                searchResultsFilterOpen ?
                  React.createElement('div', { className: 'flex items-center border border-gray-300 rounded-full px-3 py-[5px] filter-pill' },
                    React.createElement('input', {
                      type: 'text',
                      value: searchResultsFilter,
                      onChange: (e) => setSearchResultsFilter(e.target.value),
                      onBlur: () => { if (!searchResultsFilter.trim()) setSearchResultsFilterOpen(false); },
                      autoFocus: true,
                      placeholder: 'Filter...',
                      className: 'bg-transparent text-gray-700 text-sm placeholder-gray-400 outline-none no-drag',
                      style: { width: '150px' }
                    }),
                    searchResultsFilter && React.createElement('button', {
                      onClick: () => { setSearchResultsFilter(''); setSearchResultsFilterOpen(false); },
                      className: 'ml-2 text-gray-400 hover:text-gray-600 no-drag'
                    },
                      React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M6 18L18 6M6 6l12 12' })
                      )
                    )
                  )
                :
                  React.createElement('button', {
                    onClick: () => setSearchResultsFilterOpen(true),
                    className: 'p-1.5 text-gray-400 hover:text-gray-600 transition-colors no-drag'
                  },
                    React.createElement('svg', { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
                    )
                  )
              )
            ),

            // Sticky filter bar for Albums (sort dropdown + search like Critical Darlings)
            searchDetailCategory === 'albums' && React.createElement('div', {
              className: 'sticky top-0 z-10 flex items-center px-6 py-3',
              style: { backgroundColor: 'var(--bg-primary)', borderBottom: '1px solid var(--border-default)' }
            },
              // Sort dropdown
              React.createElement('div', { className: 'relative' },
                React.createElement('button', {
                  onClick: (e) => { e.stopPropagation(); setSearchResultsSortDropdownOpen(!searchResultsSortDropdownOpen); },
                  className: 'flex items-center gap-1 px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors no-drag'
                },
                  React.createElement('span', null,
                    searchResultsSort === 'relevance' ? 'Relevance' :
                    searchResultsSort === 'title' ? 'Title' :
                    searchResultsSort === 'artist' ? 'Artist' :
                    searchResultsSort === 'year-desc' ? 'Year (Newest)' :
                    searchResultsSort === 'year-asc' ? 'Year (Oldest)' : 'Sort'
                  ),
                  React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M19 9l-7 7-7-7' })
                  )
                ),
                searchResultsSortDropdownOpen && React.createElement('div', {
                  className: 'absolute left-0 top-full mt-1 bg-white rounded-lg shadow-lg py-1 min-w-[160px] z-30 border border-gray-200'
                },
                  [
                    { value: 'relevance', label: 'Relevance' },
                    { value: 'title', label: 'Title' },
                    { value: 'artist', label: 'Artist' },
                    { value: 'year-desc', label: 'Year (Newest)' },
                    { value: 'year-asc', label: 'Year (Oldest)' }
                  ].map(option =>
                    React.createElement('button', {
                      key: option.value,
                      onClick: (e) => {
                        e.stopPropagation();
                        setSearchResultsSort(option.value);
                        setSearchResultsSortDropdownOpen(false);
                      },
                      className: `w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center justify-between no-drag ${
                        searchResultsSort === option.value ? 'text-gray-900 font-medium' : 'text-gray-600'
                      }`
                    },
                      option.label,
                      searchResultsSort === option.value && React.createElement('svg', {
                        className: 'w-4 h-4',
                        fill: 'none',
                        viewBox: '0 0 24 24',
                        stroke: 'currentColor'
                      },
                        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M5 13l4 4L19 7' })
                      )
                    )
                  )
                )
              ),
              React.createElement('div', { className: 'flex-1' }),
              // Search/filter
              React.createElement('div', { className: 'flex items-center' },
                searchResultsFilterOpen ?
                  React.createElement('div', { className: 'flex items-center border border-gray-300 rounded-full px-3 py-[5px] filter-pill' },
                    React.createElement('input', {
                      type: 'text',
                      value: searchResultsFilter,
                      onChange: (e) => setSearchResultsFilter(e.target.value),
                      onBlur: () => { if (!searchResultsFilter.trim()) setSearchResultsFilterOpen(false); },
                      autoFocus: true,
                      placeholder: 'Filter...',
                      className: 'bg-transparent text-gray-700 text-sm placeholder-gray-400 outline-none no-drag',
                      style: { width: '150px' }
                    }),
                    searchResultsFilter && React.createElement('button', {
                      onClick: () => { setSearchResultsFilter(''); setSearchResultsFilterOpen(false); },
                      className: 'ml-2 text-gray-400 hover:text-gray-600 no-drag'
                    },
                      React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M6 18L18 6M6 6l12 12' })
                      )
                    )
                  )
                :
                  React.createElement('button', {
                    onClick: () => setSearchResultsFilterOpen(true),
                    className: 'p-1.5 text-gray-400 hover:text-gray-600 transition-colors no-drag'
                  },
                    React.createElement('svg', { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
                    )
                  )
              )
            ),

            // Sticky filter bar for Songs (sort dropdown + search)
            searchDetailCategory === 'tracks' && React.createElement('div', {
              className: 'sticky top-0 z-10 flex items-center px-6 py-3',
              style: { backgroundColor: 'var(--bg-primary)', borderBottom: '1px solid var(--border-default)' }
            },
              // Sort dropdown
              React.createElement('div', { className: 'relative' },
                React.createElement('button', {
                  onClick: (e) => { e.stopPropagation(); setSearchResultsSortDropdownOpen(!searchResultsSortDropdownOpen); },
                  className: 'flex items-center gap-1 px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors no-drag'
                },
                  React.createElement('span', null,
                    searchResultsSort === 'relevance' ? 'Relevance' :
                    searchResultsSort === 'title' ? 'Title' :
                    searchResultsSort === 'artist' ? 'Artist' :
                    searchResultsSort === 'duration-asc' ? 'Duration (Short)' :
                    searchResultsSort === 'duration-desc' ? 'Duration (Long)' : 'Sort'
                  ),
                  React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M19 9l-7 7-7-7' })
                  )
                ),
                searchResultsSortDropdownOpen && React.createElement('div', {
                  className: 'absolute left-0 top-full mt-1 bg-white rounded-lg shadow-lg py-1 min-w-[160px] z-30 border border-gray-200'
                },
                  [
                    { value: 'relevance', label: 'Relevance' },
                    { value: 'title', label: 'Title' },
                    { value: 'artist', label: 'Artist' },
                    { value: 'duration-asc', label: 'Duration (Short)' },
                    { value: 'duration-desc', label: 'Duration (Long)' }
                  ].map(option =>
                    React.createElement('button', {
                      key: option.value,
                      onClick: (e) => {
                        e.stopPropagation();
                        setSearchResultsSort(option.value);
                        setSearchResultsSortDropdownOpen(false);
                      },
                      className: `w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center justify-between no-drag ${
                        searchResultsSort === option.value ? 'text-gray-900 font-medium' : 'text-gray-600'
                      }`
                    },
                      option.label,
                      searchResultsSort === option.value && React.createElement('svg', {
                        className: 'w-4 h-4',
                        fill: 'none',
                        viewBox: '0 0 24 24',
                        stroke: 'currentColor'
                      },
                        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M5 13l4 4L19 7' })
                      )
                    )
                  )
                )
              ),
              React.createElement('div', { className: 'flex-1' }),
              // Search/filter
              React.createElement('div', { className: 'flex items-center' },
                searchResultsFilterOpen ?
                  React.createElement('div', { className: 'flex items-center border border-gray-300 rounded-full px-3 py-[5px] filter-pill' },
                    React.createElement('input', {
                      type: 'text',
                      value: searchResultsFilter,
                      onChange: (e) => setSearchResultsFilter(e.target.value),
                      onBlur: () => { if (!searchResultsFilter.trim()) setSearchResultsFilterOpen(false); },
                      autoFocus: true,
                      placeholder: 'Filter...',
                      className: 'bg-transparent text-gray-700 text-sm placeholder-gray-400 outline-none no-drag',
                      style: { width: '150px' }
                    }),
                    searchResultsFilter && React.createElement('button', {
                      onClick: () => { setSearchResultsFilter(''); setSearchResultsFilterOpen(false); },
                      className: 'ml-2 text-gray-400 hover:text-gray-600 no-drag'
                    },
                      React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M6 18L18 6M6 6l12 12' })
                      )
                    )
                  )
                :
                  React.createElement('button', {
                    onClick: () => setSearchResultsFilterOpen(true),
                    className: 'p-1.5 text-gray-400 hover:text-gray-600 transition-colors no-drag'
                  },
                    React.createElement('svg', { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
                    )
                  )
              )
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

                return filteredArtists.length > 0 && React.createElement('div', {
                  className: 'grid gap-4',
                  style: { gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }
                },
                  ...filteredArtists.map((artist, index) => {
                    const animationDelay = Math.min(index * 30, 300);
                    const searchArtistPattern = generateArtistPattern(artist.name);
                    return React.createElement('div', {
                      key: artist.id,
                      className: 'rounded-lg overflow-hidden cursor-pointer group release-card card-fade-up',
                      style: { backgroundColor: 'var(--card-bg)', boxShadow: 'var(--card-shadow)', animationDelay: `${animationDelay}ms` },
                      draggable: true,
                      onDragStart: (e) => {
                        e.dataTransfer.effectAllowed = 'copy';
                        e.dataTransfer.setData('text/plain', JSON.stringify({
                          type: 'artist',
                          artist: {
                            id: slug(artist.name || 'unknown'),
                            name: artist.name,
                            image: artist.image || null
                          }
                        }));
                      },
                      onClick: () => fetchArtistData(artist.name, artistOpenOptions(artist)),
                      onContextMenu: (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (window.electron?.contextMenu?.showTrackMenu) {
                          window.electron.contextMenu.showTrackMenu({
                            type: 'artist',
                            artist: {
                              id: slug(artist.name || 'unknown'),
                              name: artist.name,
                              image: artist.image || null
                            }
                          });
                        }
                      }
                    },
                      // Square image container - gray while loading, pattern only when imageLoaded && no image
                      React.createElement('div', {
                        className: 'aspect-square relative group/art',
                        style: { background: artist.imageLoaded && !artist.image ? searchArtistPattern.gradient : 'var(--placeholder-bg)' }
                      },
                        // Shimmer while loading (imageLoaded not yet true)
                        !artist.imageLoaded && React.createElement('div', {
                          className: 'absolute inset-0 shimmer-strong animate-shimmer',
                          style: { backgroundSize: '200% 100%' }
                        }),
                        // Initials fallback (only show when imageLoaded && no image)
                        artist.imageLoaded && !artist.image && React.createElement('div', {
                          className: 'absolute inset-0 flex items-center justify-center',
                          style: { color: searchArtistPattern.textColor, opacity: 0.4 }
                        },
                          React.createElement('span', {
                            className: 'font-bold tracking-wider',
                            style: { fontSize: '2.5rem', textShadow: '0 2px 8px rgba(0,0,0,0.3)' }
                          }, searchArtistPattern.initials)
                        ),
                        // Artist image with fade-in
                        artist.image && React.createElement('img', {
                          src: artist.image,
                          alt: artist.name,
                          className: 'absolute inset-0 w-full h-full object-cover transition-all duration-300 group-hover/art:scale-105',
                          style: { opacity: 0 },
                          ref: (el) => { if (el && el.complete && el.naturalWidth > 0) el.style.opacity = '1'; },
                          onLoad: (e) => { e.target.style.opacity = '1'; },
                          onError: (e) => { e.target.style.display = 'none'; }
                        }),
                        // Hover overlay with Play and Queue buttons
                        React.createElement('div', {
                          className: 'absolute inset-0 bg-black/50 opacity-0 group-hover/art:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-3',
                          style: { pointerEvents: 'auto' }
                        },
                          // Play top 10 button
                          React.createElement('button', {
                            onClick: async (e) => {
                              e.stopPropagation();
                              setTrackLoading(true);
                              const tracks = await getArtistTopTracks(artist.name);
                              if (tracks.length > 0) {
                                const context = { type: 'artist', name: artist.name };
                                const [firstTrack, ...remainingTracks] = tracks;
                                const taggedFirstTrack = { ...firstTrack, _playbackContext: context };
                                setQueueWithContext(remainingTracks, context, true);
                                handlePlay(taggedFirstTrack);
                              } else {
                                setTrackLoading(false);
                                showToast(`No top tracks found for ${artist.name}`, 'error');
                              }
                            },
                            className: 'w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-110',
                            style: { border: 'none', cursor: 'pointer' },
                            title: 'Play top 10 tracks'
                          },
                            React.createElement(PlayTop10Icon, { size: 26, className: 'text-gray-800' })
                          ),
                          // Add top 10 to Queue button
                          React.createElement('button', {
                            onClick: async (e) => {
                              e.stopPropagation();
                              const tracks = await getArtistTopTracks(artist.name);
                              if (tracks.length > 0) {
                                addToQueue(tracks, { type: 'artist', name: artist.name });
                                showToast(`Added ${tracks.length} tracks from ${artist.name}`, 'success');
                              } else {
                                showToast(`No top tracks found for ${artist.name}`, 'error');
                              }
                            },
                            className: 'w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-110',
                            style: { backgroundColor: 'rgba(255, 255, 255, 0.15)', color: '#ffffff', border: 'none', cursor: 'pointer' },
                            onMouseEnter: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.25)',
                            onMouseLeave: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.15)',
                            title: 'Add top 10 to queue'
                          },
                            React.createElement(QueueTop10Icon, { size: 20 })
                          )
                        )
                      ),
                      // Artist name section
                      React.createElement('div', { className: 'p-3' },
                        React.createElement('p', {
                          className: 'font-medium text-gray-900 truncate text-sm transition-colors'
                        }, artist.name)
                      )
                    );
                  })
                );
              })(),

              // Artists empty state
              searchDetailCategory === 'artists' && (searchResultsFilter
                ? searchResults.artists.filter(a => a.name?.toLowerCase().includes(searchResultsFilter.toLowerCase())).length === 0
                : searchResults.artists.length === 0
              ) && React.createElement('div', {
                className: 'text-center py-12 text-gray-400'
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

                return filteredAlbums.length > 0 && React.createElement('div', {
                  className: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-4 gap-y-5 pb-6'
                },
                  filteredAlbums.map((album, index) => {
                    const animationDelay = Math.min(index * 30, 300);
                    return React.createElement('div', {
                      key: album.id,
                      className: 'group cursor-pointer release-card card-fade-up',
                      style: {
                        padding: '10px',
                        borderRadius: '10px',
                        backgroundColor: 'var(--card-bg)',
                        boxShadow: 'var(--card-shadow)',
                        animationDelay: `${animationDelay}ms`
                      },
                      draggable: true,
                      onDragStart: (e) => {
                        e.dataTransfer.effectAllowed = 'copy';
                        const prefetched = prefetchedReleasesRef.current[album.id];
                        e.dataTransfer.setData('text/plain', JSON.stringify({
                          type: 'album',
                          album: {
                            id: trackSlug(album['artist-credit']?.[0]?.name || 'unknown', album.title || 'untitled'),
                            title: album.title,
                            artist: album['artist-credit']?.[0]?.name || 'Unknown',
                            year: album['first-release-date']?.split('-')[0] ? parseInt(album['first-release-date'].split('-')[0]) : null,
                            art: album.albumArt || null,
                            trackCount: prefetched?.tracks?.length || null
                          }
                        }));
                      },
                      onMouseEnter: () => prefetchSearchAlbumTracks(album),
                      onClick: () => handleAlbumClick(album),
                      onContextMenu: (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const artistName = album['artist-credit']?.[0]?.name || 'Unknown';
                        const albumData = {
                          title: album.title,
                          artist: artistName,
                          year: album['first-release-date']?.split('-')[0] ? parseInt(album['first-release-date'].split('-')[0]) : null,
                          art: album.albumArt || null
                        };
                        const prefetched = prefetchedReleasesRef.current[album.id];
                        const isLoading = prefetchInProgress.has(album.id);
                        window.electron.contextMenu.showTrackMenu({
                          type: 'release',
                          name: album.title,
                          album: albumData,
                          tracks: prefetched?.tracks || [],
                          loading: isLoading
                        });
                      }
                    },
                      // Album art with dark placeholder and inner shadow
                      React.createElement('div', {
                        className: 'aspect-square rounded-lg overflow-hidden mb-2 relative album-art-container'
                      },
                        // Dark placeholder background
                        React.createElement('div', {
                          className: 'absolute inset-0',
                          style: { background: 'linear-gradient(145deg, #1f1f1f 0%, #2d2d2d 50%, #1a1a1a 100%)' }
                        }),
                        // Image with fade-in
                        album.albumArt && React.createElement('img', {
                          src: album.albumArt,
                          alt: album.title,
                          className: 'absolute inset-0 w-full h-full object-cover transition-all duration-300',
                          style: { opacity: 0 },
                          ref: (el) => { if (el && el.complete && el.naturalWidth > 0) el.style.opacity = '1'; },
                          onLoad: (e) => { e.target.style.opacity = '1'; },
                          onError: (e) => { e.target.style.display = 'none'; }
                        }),
                        // Hover overlay with action buttons (Add to Playlist, Play, Queue)
                        React.createElement('div', {
                          className: 'absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-3'
                        },
                          // Add to Playlist button
                          React.createElement('button', {
                            onClick: (e) => {
                              e.stopPropagation();
                              const prefetched = prefetchedReleasesRef.current[album.id];
                              if (prefetched?.tracks?.length > 0) {
                                setAddToPlaylistPanel({
                                  open: true,
                                  tracks: prefetched.tracks,
                                  sourceName: album.title,
                                  sourceType: 'album'
                                });
                              }
                            },
                            className: 'w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-110',
                            style: { backgroundColor: 'rgba(255, 255, 255, 0.15)', color: '#ffffff' },
                            onMouseEnter: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.25)',
                            onMouseLeave: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.15)',
                            title: 'Add to Playlist'
                          },
                            React.createElement('svg', { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2 },
                              React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M12 4v16m8-8H4' })
                            )
                          ),
                          // Play button (center, larger)
                          React.createElement('button', {
                            onClick: (e) => {
                              e.stopPropagation();
                              setTrackLoading(true);
                              const prefetched = prefetchedReleasesRef.current[album.id];
                              if (prefetched?.tracks?.length > 0) {
                                const context = { type: 'album', id: album.id, name: album.title, artist: album['artist-credit']?.[0]?.name };
                                const [firstTrack, ...remainingTracks] = prefetched.tracks;
                                // Tag the first track with context so queue navigation works correctly
                                const taggedFirstTrack = { ...firstTrack, _playbackContext: context };
                                setQueueWithContext(remainingTracks, context, true);
                                handlePlay(taggedFirstTrack);
                              } else {
                                setTrackLoading(false);
                              }
                            },
                            className: 'w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-110',
                            title: 'Play'
                          },
                            React.createElement(Play, { size: 22, className: 'text-gray-800 ml-0.5' })
                          ),
                          // Add to Queue button
                          React.createElement('button', {
                            onClick: (e) => {
                              e.stopPropagation();
                              const prefetched = prefetchedReleasesRef.current[album.id];
                              if (prefetched?.tracks?.length > 0) {
                                const context = { type: 'album', id: album.id, name: album.title, artist: album['artist-credit']?.[0]?.name };
                                addToQueue(prefetched.tracks, context);
                              }
                            },
                            className: 'w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-110',
                            style: { backgroundColor: 'rgba(255, 255, 255, 0.15)', color: '#ffffff' },
                            onMouseEnter: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.25)',
                            onMouseLeave: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.15)',
                            title: 'Add to Queue'
                          },
                            React.createElement('svg', { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2 },
                              React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M4 6h16M4 12h16M4 18h7' })
                            )
                          )
                        )
                      ),
                      // Album title - refined typography
                      React.createElement('div', {
                        className: 'truncate transition-colors',
                        style: {
                          fontSize: '13px',
                          fontWeight: '500',
                          color: 'var(--text-primary)',
                          marginTop: '6px'
                        }
                      }, album.title),
                      // Artist name - clickable
                      React.createElement('div', {
                        className: 'truncate hover:text-purple-600 hover:underline cursor-pointer transition-colors',
                        style: {
                          fontSize: '11px',
                          color: 'var(--text-secondary)',
                          marginTop: '2px'
                        },
                        onClick: (e) => {
                          e.stopPropagation();
                          fetchArtistData(album['artist-credit']?.[0]?.name, creditOpenOptions(album['artist-credit']));
                        }
                      }, album['artist-credit']?.[0]?.name || 'Unknown Artist')
                    );
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
                className: 'text-center py-12 text-gray-400'
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
                    // Use track.id to look up resolved sources from trackSources state
                    const resolvedSources = trackSources[track.id] || track.sources || {};
                    const hasResolved = Object.keys(resolvedSources).length > 0;
                    const isResolving = !hasResolved && track.resolving;
                    const isCurrentTrack = currentTrack?.id === track.id;
                    const isNowPlaying = isCurrentTrack && playbackContext?.type === 'search';

                    return React.createElement('div', {
                      key: track.id,
                      'data-track-id': track.id,
                      ref: (el) => {
                        if (el) {
                          searchTracksRowRefs.current.set(track.id, el);
                          if (searchTracksObserverRef.current) {
                            searchTracksObserverRef.current.observe(el);
                          }
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
                        track: {
                          id: track.id,
                          title: track.title,
                          artist: track.artist,
                          album: track.album,
                          duration: track.duration,
                          albumArt: track.albumArt,
                          sources: track.sources || {}
                        }
                      }));
                    },
                    onDragEnd: () => {
                      handlePlaylistDragEnd();
                    },
                    className: `flex items-center gap-4 py-3 px-4 cursor-grab active:cursor-grabbing transition-all group ${
                      isResolving ? 'opacity-60' : ''
                    } ${isNowPlaying && isPlaying ? 'bg-purple-50' : 'hover:bg-gray-50/80'}`,
                    style: {
                      borderRadius: '8px',
                      marginBottom: '2px'
                    },
                    onClick: () => {
                      const tracksAfter = filteredTracks.slice(index + 1);
                      const context = { type: 'search', name: searchQuery };
                      setQueueWithContext(tracksAfter, context);
                      handlePlay(track);
                    },
                    onContextMenu: (e) => {
                      e.preventDefault();
                      if (window.electron?.contextMenu?.showTrackMenu) {
                        window.electron.contextMenu.showTrackMenu({
                          type: 'track',
                          track: track
                        });
                      }
                    }
                  },
                    // Track number or playing indicator
                    React.createElement('span', {
                      className: 'flex-shrink-0 text-right',
                      style: {
                        pointerEvents: 'none',
                        width: '32px',
                        fontSize: '12px',
                        fontWeight: '500',
                        color: isNowPlaying && isPlaying ? 'var(--accent-secondary)' : 'var(--text-tertiary)'
                      }
                    }, isNowPlaying && isPlaying ? '▶' : String(index + 1).padStart(2, '0')),

                    // Track title - flexible column
                    React.createElement('span', {
                      className: 'truncate transition-colors',
                      style: {
                        pointerEvents: 'none',
                        flex: '1 1 0',
                        minWidth: 0,
                        fontSize: '13px',
                        fontWeight: isNowPlaying && isPlaying ? '500' : '400',
                        color: isNowPlaying && isPlaying ? 'var(--accent-primary)' : hasResolved ? 'var(--text-primary)' : 'var(--text-tertiary)'
                      }
                    }, track.title),

                    // Artist name - flexible column, clickable
                    React.createElement('span', {
                      className: 'truncate hover:text-purple-600 hover:underline cursor-pointer transition-colors',
                      style: {
                        flex: '0.7 1 0',
                        minWidth: 0,
                        fontSize: '13px',
                        color: 'var(--text-secondary)'
                      },
                      onClick: (e) => {
                        e.stopPropagation();
                        fetchArtistData(track.artist, trackArtistOpenOptions(track));
                      }
                    }, track.artist),

                    // Album name - flexible column, clickable
                    track.album ? React.createElement('span', {
                      className: 'truncate hover:text-purple-600 hover:underline cursor-pointer transition-colors',
                      style: {
                        flex: '0.5 1 0',
                        minWidth: 0,
                        fontSize: '13px',
                        color: 'var(--text-secondary)'
                      },
                      onClick: (e) => {
                        e.stopPropagation();
                        openChartsAlbum({ artist: track.artist, title: track.album, albumArt: track.albumArt });
                      }
                    }, track.album) : React.createElement('span', {
                      className: 'truncate',
                      style: {
                        pointerEvents: 'none',
                        flex: '0.5 1 0',
                        minWidth: 0,
                        fontSize: '13px',
                        color: 'var(--text-secondary)'
                      }
                    }, ''),

                    // Duration - right-justified before resolver icons
                    React.createElement('span', {
                      className: 'flex-shrink-0 tabular-nums',
                      style: {
                        pointerEvents: 'none',
                        width: '50px',
                        marginRight: '16px',
                        fontSize: '12px',
                        color: 'var(--text-tertiary)',
                        textAlign: 'right'
                      }
                    }, formatTime(track.duration)),

                    // Resolver icons - fixed width column
                    React.createElement('div', {
                      className: 'flex items-center gap-1 justify-end',
                      style: { width: '140px', flexShrink: 0, minHeight: '24px' }
                    },
                      isResolving ?
                        React.createElement('div', {
                          className: 'flex items-center gap-1'
                        },
                          React.createElement('div', {
                            className: 'w-5 h-5 rounded shimmer-light animate-shimmer',
                            title: 'Resolving track...'
                          }),
                          React.createElement('div', {
                            className: 'w-5 h-5 rounded shimmer-light animate-shimmer',
                            style: { animationDelay: '0.1s' }
                          })
                        )
                      : hasResolved ? (() => {
                          const bestConf = getBestSourceConfidence(resolvedSources);
                          return Object.entries(resolvedSources)
                            .filter(([resolverId]) => activeResolvers.includes(resolverId))
                            .sort(([aId], [bId]) => {
                              const aIndex = resolverOrder.indexOf(aId);
                              const bIndex = resolverOrder.indexOf(bId);
                              return aIndex - bIndex;
                            })
                            .map(([resolverId, source]) => {
                              const resolver = allResolvers.find(r => r.id === resolverId);
                              if (!resolver || !resolver.play) return null;
                              return React.createElement('button', {
                                key: resolverId,
                                className: 'no-drag',
                                onClick: (e) => {
                                  e.stopPropagation();
                                  const tracksAfter = filteredTracks.slice(index + 1);
                                  const context = { type: 'search', name: searchQuery };
                                  setQueueWithContext(tracksAfter, context);
                                  handlePlay({ ...track, preferredResolver: resolverId });
                                },
                                style: {
                                  width: '20px',
                                  height: '20px',
                                  borderRadius: '4px',
                                  backgroundColor: resolver.color,
                                  border: 'none',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  pointerEvents: 'auto',
                                  opacity: (source.confidence || 0) < bestConf ? 0.6 : 1,
                                  transition: 'transform 0.1s'
                                },
                                onMouseEnter: (e) => e.currentTarget.style.transform = 'scale(1.1)',
                                onMouseLeave: (e) => e.currentTarget.style.transform = 'scale(1)',
                                title: `Play from ${resolver.name}${source.confidence ? ` (${Math.round(source.confidence * 100)}% match)` : ''}`
                              }, React.createElement(ResolverIcon, { resolverId, size: 12 }));
                            });
                        })()
                      :
                        null
                    )
                  );
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
                className: 'text-center py-12 text-gray-400'
              }, searchResultsFilter ? 'No songs match your filter.' : 'No songs found.'),

              // Playlists grid with cards
              searchDetailCategory === 'playlists' && searchResults.playlists.length > 0 && React.createElement('div', {
                className: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-4 gap-y-5 pb-6'
              },
                searchResults.playlists.map((playlist, index) => {
                  const animationDelay = Math.min(index * 30, 300);
                  return React.createElement('div', {
                    key: playlist.title,
                    className: 'cursor-pointer group release-card card-fade-up',
                    style: {
                      padding: '10px',
                      borderRadius: '10px',
                      backgroundColor: 'var(--card-bg)',
                      boxShadow: 'var(--card-shadow)',
                      animationDelay: `${animationDelay}ms`
                    },
                    onClick: () => handlePlaylistClick(playlist)
                  },
                    // Playlist icon square with hover overlay
                    React.createElement('div', {
                      className: 'w-full aspect-square rounded-lg mb-2 relative overflow-hidden',
                      style: { background: 'linear-gradient(145deg, #1f1f1f 0%, #2d2d2d 50%, #1a1a1a 100%)' }
                    },
                      // Playlist icon
                      React.createElement('div', {
                        className: 'absolute inset-0 flex items-center justify-center'
                      },
                        React.createElement('svg', {
                          className: 'w-12 h-12 text-gray-500',
                          fill: 'none',
                          viewBox: '0 0 24 24',
                          stroke: 'currentColor',
                          strokeWidth: 1.5
                        },
                          React.createElement('path', {
                            strokeLinecap: 'round',
                            strokeLinejoin: 'round',
                            d: 'M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V4.5L9 7.5v9.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 13.125V9'
                          })
                        )
                      ),
                      // Hover overlay with action buttons
                      React.createElement('div', {
                        className: 'absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-3'
                      },
                        // Add to Playlist button
                        React.createElement('button', {
                          onClick: (e) => {
                            e.stopPropagation();
                            if (playlist.tracks?.length > 0) {
                              const tracksWithIds = playlist.tracks.map(track => ({
                                ...track,
                                id: trackSlug(track.artist || 'unknown', track.title || 'untitled'),
                                sources: {}
                              }));
                              setAddToPlaylistPanel({
                                open: true,
                                tracks: tracksWithIds,
                                sourceName: playlist.title,
                                sourceType: 'playlist'
                              });
                            }
                          },
                          className: 'w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-110',
                          style: { backgroundColor: 'rgba(255, 255, 255, 0.15)', color: '#ffffff' },
                          onMouseEnter: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.25)',
                          onMouseLeave: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.15)',
                          title: 'Add to Playlist'
                        },
                          React.createElement('svg', { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2 },
                            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M12 4v16m8-8H4' })
                          )
                        ),
                        // Play button (center, larger)
                        React.createElement('button', {
                          onClick: (e) => {
                            e.stopPropagation();
                            setTrackLoading(true);
                            if (playlist.tracks?.length > 0) {
                              const tracksWithIds = playlist.tracks.map(track => ({
                                ...track,
                                id: trackSlug(track.artist || 'unknown', track.title || 'untitled'),
                                sources: {}
                              }));
                              const context = { type: 'playlist', id: playlist.title, name: playlist.title };
                              const [firstTrack, ...remainingTracks] = tracksWithIds;
                              // Tag the first track with context so queue navigation works correctly
                              const taggedFirstTrack = { ...firstTrack, _playbackContext: context };
                              setQueueWithContext(remainingTracks, context, true);
                              handlePlay(taggedFirstTrack);
                            } else {
                              setTrackLoading(false);
                            }
                          },
                          className: 'w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-110',
                          title: 'Play'
                        },
                          React.createElement(Play, { size: 22, className: 'text-gray-800 ml-0.5' })
                        ),
                        // Add to Queue button
                        React.createElement('button', {
                          onClick: (e) => {
                            e.stopPropagation();
                            if (playlist.tracks?.length > 0) {
                              const tracksWithIds = playlist.tracks.map(track => ({
                                ...track,
                                id: trackSlug(track.artist || 'unknown', track.title || 'untitled'),
                                sources: {}
                              }));
                              const context = { type: 'playlist', id: playlist.title, name: playlist.title };
                              addToQueue(tracksWithIds, context);
                            }
                          },
                          className: 'w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-110',
                          style: { backgroundColor: 'rgba(255, 255, 255, 0.15)', color: '#ffffff' },
                          onMouseEnter: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.25)',
                          onMouseLeave: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.15)',
                          title: 'Add to Queue'
                        },
                          React.createElement('svg', { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2 },
                            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M4 6h16M4 12h16M4 18h7' })
                          )
                        )
                      )
                    ),
                    // Playlist title
                    React.createElement('div', {
                      className: 'truncate transition-colors',
                      style: {
                        fontSize: '13px',
                        fontWeight: '500',
                        color: 'var(--text-primary)',
                        marginTop: '6px'
                      }
                    }, playlist.title),
                    // Creator and track count
                    React.createElement('div', {
                      className: 'truncate',
                      style: {
                        fontSize: '11px',
                        color: 'var(--text-secondary)',
                        marginTop: '2px'
                      }
                    }, `${playlist.creator || 'Unknown'} • ${playlist.tracks?.length || 0} tracks`)
                  );
                })
              )
            )
          ) // end scrollable content
        ) // end detail view container
      :
        // MAIN VIEW - clean white layout matching reference
        React.createElement('div', {
          className: 'h-full overflow-y-auto bg-white'
        },
          // Header bar with SEARCH title and CLOSE button
          React.createElement('div', {
            className: 'flex items-center justify-between px-8 py-4 flex-shrink-0',
            style: {
              borderBottom: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--bg-secondary)'
            }
          },
            React.createElement('span', {
              style: {
                fontSize: '11px',
                fontWeight: '600',
                letterSpacing: '0.08em',
                color: 'var(--text-tertiary)',
                textTransform: 'uppercase'
              }
            }, 'Search'),
            React.createElement('button', {
              onClick: () => navigateBack(),
              className: 'flex items-center gap-2 no-drag transition-all',
              style: {
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: '500',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '6px',
                backgroundColor: 'transparent',
                cursor: 'pointer'
              }
            },
              'CLOSE',
              React.createElement('span', { style: { color: 'var(--text-tertiary)' } }, '×')
            )
          ),

          // Content area
          React.createElement('div', { className: 'px-8 py-6', ref: searchResultsContainerRef },
        // Main view content
        React.createElement('div', null,
          // Large search input with cursor styling
          React.createElement('div', { className: 'mb-8' },
            React.createElement('input', {
              ref: (el) => {
                searchInputRef.current = el;
                if (el && activeView === 'search' && !searchQuery) el.focus();
              },
              type: 'text',
              value: searchQuery,
              onChange: (e) => handleSearchInput(e.target.value),
              onKeyDown: (e) => {
                // Prevent keyboard shortcuts from interfering while typing in search
                // Allow Escape to propagate for navigation, but stop other keys
                if (e.key !== 'Escape') {
                  e.stopPropagation();
                }
              },
              placeholder: '',
              className: 'w-full text-6xl font-extralight text-gray-900 bg-transparent border-none outline-none tracking-tight',
              style: {
                caretColor: 'var(--text-tertiary)',
                fontFamily: 'var(--font-sans)'
              }
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
                  className: 'text-xs font-semibold text-gray-400 uppercase tracking-wider'
                }, 'Recent Searches'),
                React.createElement('button', {
                  onClick: () => clearSearchHistory(),
                  className: 'text-xs text-gray-400 hover:text-red-500 transition-colors'
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
            React.createElement('div', { className: 'text-center py-12' },
              React.createElement('svg', {
                className: 'w-12 h-12 mx-auto text-gray-300 mb-4',
                fill: 'none',
                stroke: 'currentColor',
                viewBox: '0 0 24 24'
              },
                React.createElement('path', {
                  strokeLinecap: 'round',
                  strokeLinejoin: 'round',
                  strokeWidth: 1.5,
                  d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'
                })
              ),
              React.createElement('p', { className: 'text-gray-400 text-sm' }, 'Start typing to search')
            )
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
              React.createElement('h3', { className: 'text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4' }, 'ARTISTS'),
              React.createElement('div', {
                className: 'grid gap-4',
                style: { gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }
              },
                ...Array(getItemsPerRow(160)).fill(null).map((_, i) =>
                  React.createElement('div', {
                    key: `artist-skeleton-${i}`,
                    className: 'bg-white rounded-lg overflow-hidden'
                  },
                    React.createElement('div', {
                      className: 'aspect-square shimmer-light animate-shimmer',
                      style: { backgroundSize: '200% 100%', animationDelay: `${i * 100}ms` }
                    }),
                    React.createElement('div', { className: 'p-3' },
                      React.createElement('div', {
                        className: 'h-4 shimmer-light w-3/4 rounded animate-shimmer',
                        style: { backgroundSize: '200% 100%', animationDelay: `${i * 100 + 50}ms` }
                      })
                    )
                  )
                )
              )
            ),
            // Songs skeleton - rounded style
            React.createElement('div', null,
              React.createElement('h3', { className: 'text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4' }, 'SONGS'),
              React.createElement('div', { className: 'flex gap-4' },
                ...Array(getItemsPerRow(110)).fill(null).map((_, i) => {
                  const skeletonWidth = Math.floor((searchContainerWidth - (getItemsPerRow(110) - 1) * 16) / getItemsPerRow(110));
                  return React.createElement('div', {
                    key: `track-skeleton-${i}`,
                    className: 'transition-all duration-300 ease-out',
                    style: { width: skeletonWidth }
                  },
                    React.createElement('div', {
                      className: 'w-full aspect-square rounded-lg shimmer-light mb-2 animate-shimmer',
                      style: { backgroundSize: '200% 100%', animationDelay: `${i * 100}ms` }
                    }),
                    React.createElement('div', {
                      className: 'h-3 shimmer-light w-3/4 mb-1 rounded animate-shimmer',
                      style: { backgroundSize: '200% 100%', animationDelay: `${i * 100 + 50}ms` }
                    }),
                    React.createElement('div', {
                      className: 'h-2 shimmer-light w-1/2 rounded animate-shimmer',
                      style: { backgroundSize: '200% 100%', animationDelay: `${i * 100 + 100}ms` }
                    }),
                    React.createElement('div', {
                      className: 'h-4 shimmer-light w-10 mt-1 rounded animate-shimmer',
                      style: { backgroundSize: '200% 100%', animationDelay: `${i * 100 + 150}ms` }
                    })
                  );
                })
              )
            ),
            // Albums skeleton - rounded style
            React.createElement('div', null,
              React.createElement('h3', { className: 'text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4' }, 'ALBUMS'),
              React.createElement('div', { className: 'flex gap-4' },
                ...Array(getItemsPerRow(150)).fill(null).map((_, i) => {
                  const skeletonWidth = Math.floor((searchContainerWidth - (getItemsPerRow(150) - 1) * 16) / getItemsPerRow(150));
                  return React.createElement('div', {
                    key: `album-skeleton-${i}`,
                    className: 'transition-all duration-300 ease-out',
                    style: { width: skeletonWidth }
                  },
                    React.createElement('div', {
                      className: 'w-full aspect-square rounded-lg shimmer-light mb-3 animate-shimmer',
                      style: { backgroundSize: '200% 100%', animationDelay: `${i * 100}ms` }
                    }),
                    React.createElement('div', {
                      className: 'h-3 shimmer-light w-3/4 mb-1 rounded animate-shimmer',
                      style: { backgroundSize: '200% 100%', animationDelay: `${i * 100 + 50}ms` }
                    }),
                    React.createElement('div', {
                      className: 'h-2 shimmer-light w-1/2 rounded animate-shimmer',
                      style: { backgroundSize: '200% 100%', animationDelay: `${i * 100 + 100}ms` }
                    })
                  );
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
          React.createElement('div', { className: 'text-center py-12 text-gray-400' },
            `No results found for "${searchQuery}"`
          )
        :
        // Results
        React.createElement('div', { className: 'space-y-10' },
          // Quick suggestions from search history (shown instantly while loading)
          filteredHistoryMatches.length > 0 && React.createElement('div', { className: 'mb-6' },
            React.createElement('h3', { className: 'text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3' }, 'SUGGESTIONS'),
            React.createElement('div', { className: 'flex flex-wrap gap-2' },
              ...filteredHistoryMatches.map((entry, i) =>
                React.createElement('button', {
                  key: `suggestion-${i}-${entry.query}`,
                  className: 'flex items-center gap-2 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-full text-sm text-gray-700 transition-colors',
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
                },
                  entry.selectedResult?.imageUrl && React.createElement('img', {
                    src: entry.selectedResult.imageUrl,
                    className: 'w-5 h-5 rounded-full object-cover'
                  }),
                  React.createElement('span', null, entry.selectedResult?.name || entry.query)
                )
              )
            )
          ),
          // Artists section with image cards - responsive grid
          searchResults.artists.length > 0 && React.createElement('div', null,
            React.createElement('div', { className: 'flex items-center justify-between mb-4' },
              React.createElement('h3', { className: 'text-xs font-semibold text-gray-400 uppercase tracking-wider' }, 'ARTISTS'),
              searchResults.artists.length > 10 &&
                React.createElement('button', {
                  onClick: () => {
                    setSearchDetailCategory('artists');
                    setSearchPreviewItem(searchResults.artists[0] || null);
                  },
                  className: 'text-xs text-gray-500 hover:text-gray-700'
                }, 'Show more')
            ),
            React.createElement('div', {
              className: 'flex gap-4'
            },
              ...searchResults.artists.slice(0, getItemsPerRow(160)).map(artist =>
                React.createElement(SearchArtistCard, {
                  key: artist.id,
                  artist: artist,
                  onClick: () => {
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
                  itemWidth: Math.floor((searchContainerWidth - (getItemsPerRow(160) - 1) * 16) / getItemsPerRow(160)),
                  onPlayTopTracks: async (artist) => {
                    setTrackLoading(true);
                    const tracks = await getArtistTopTracks(artist.name);
                    if (tracks.length > 0) {
                      const context = { type: 'artist', name: artist.name };
                      const [firstTrack, ...remainingTracks] = tracks;
                      // Tag the first track with context so queue navigation works correctly
                      const taggedFirstTrack = { ...firstTrack, _playbackContext: context };
                      setQueueWithContext(remainingTracks, context, true);
                      handlePlay(taggedFirstTrack);
                    } else {
                      setTrackLoading(false);
                      showToast(`No top tracks found for ${artist.name}`, 'error');
                    }
                  },
                  onAddToQueue: async (artist) => {
                    const tracks = await getArtistTopTracks(artist.name);
                    if (tracks.length > 0) {
                      addToQueue(tracks, { type: 'artist', name: artist.name });
                      showToast(`Added ${tracks.length} tracks from ${artist.name}`, 'success');
                    } else {
                      showToast(`No top tracks found for ${artist.name}`, 'error');
                    }
                  },
                  onContextMenu: (artist) => {
                    if (window.electron?.contextMenu?.showTrackMenu) {
                      window.electron.contextMenu.showTrackMenu({
                        type: 'artist',
                        artist: {
                          id: slug(artist.name || 'unknown'),
                          name: artist.name,
                          image: null
                        }
                      });
                    }
                  }
                })
              )
            )
          ),

          // Songs/Tracks section with album art cards - matching album card style
          searchResults.tracks.length > 0 && React.createElement('div', null,
            React.createElement('div', { className: 'flex items-center justify-between mb-4' },
              React.createElement('h3', { className: 'text-xs font-semibold text-gray-400 uppercase tracking-wider' }, 'SONGS'),
              searchResults.tracks.length > 10 &&
                React.createElement('button', {
                  onClick: () => {
                    setSearchDetailCategory('tracks');
                    setSearchPreviewItem(searchResults.tracks[0] || null);
                  },
                  className: 'text-xs text-gray-500 hover:text-gray-700'
                }, 'Show more')
            ),
            React.createElement('div', {
              className: 'flex gap-4'
            },
              ...searchResults.tracks.slice(0, getItemsPerRow(140)).map((track, index) => {
                const trackItemWidth = Math.floor((searchContainerWidth - (getItemsPerRow(140) - 1) * 16) / getItemsPerRow(140));
                const animationDelay = Math.min(index * 40, 300);
                return React.createElement('div', {
                  key: track.id,
                  className: 'group cursor-grab active:cursor-grabbing release-card card-fade-up',
                  style: {
                    width: trackItemWidth,
                    padding: '10px',
                    borderRadius: '10px',
                    backgroundColor: 'var(--card-bg)',
                    boxShadow: 'var(--card-shadow)',
                    animationDelay: `${animationDelay}ms`
                  },
                  draggable: true,
                  onClick: () => {
                    const cachedArt = getCachedAlbumArt(track.artist, track.album, track.releaseGroupId, track.releaseId);
                    saveSearchHistory(searchQuery, {
                      type: 'track',
                      id: track.id,
                      name: track.title,
                      artist: track.artist,
                      imageUrl: track.albumArt || cachedArt
                    });
                    handlePlay(track);
                  },
                  onDragStart: (e) => {
                    e.dataTransfer.effectAllowed = 'copy';
                    e.dataTransfer.setData('text/plain', JSON.stringify({
                      type: 'track',
                      track: {
                        id: track.id,
                        title: track.title,
                        artist: track.artist,
                        album: track.album,
                        duration: track.duration,
                        albumArt: track.albumArt,
                        sources: track.sources || {}
                      }
                    }));
                  },
                  onContextMenu: (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (window.electron?.contextMenu?.showTrackMenu) {
                      window.electron.contextMenu.showTrackMenu({
                        type: 'track',
                        track: {
                          id: track.id,
                          title: track.title,
                          artist: track.artist,
                          album: track.album,
                          duration: track.duration,
                          albumArt: track.albumArt,
                          sources: track.sources || {}
                        }
                      });
                    }
                  }
                },
                  // Album art with rounded corners
                  React.createElement('div', {
                    className: 'w-full aspect-square rounded-lg overflow-hidden mb-2 relative album-art-container group/art'
                  },
                    // Dark placeholder background
                    React.createElement('div', {
                      className: 'absolute inset-0',
                      style: { background: 'linear-gradient(145deg, #1f1f1f 0%, #2d2d2d 50%, #1a1a1a 100%)' }
                    }),
                    // Image with fade-in (check cache as fallback for immediate display)
                    // Use getCachedAlbumArt for consistent lookup (checks IDs + artist/album name)
                    (track.albumArt || getCachedAlbumArt(track.artist, track.album, track.releaseGroupId, track.releaseId)) && React.createElement('img', {
                      src: track.albumArt || getCachedAlbumArt(track.artist, track.album, track.releaseGroupId, track.releaseId),
                      alt: track.album,
                      className: 'absolute inset-0 w-full h-full object-cover transition-all duration-300 group-hover/art:scale-105',
                      style: { opacity: 0 },
                      ref: (el) => { if (el && el.complete && el.naturalWidth > 0) el.style.opacity = '1'; },
                      onLoad: (e) => { e.target.style.opacity = '1'; },
                      onError: (e) => { e.target.style.display = 'none'; }
                    }),
                    // Hover overlay with action buttons (Add to Playlist, Play, Queue)
                    React.createElement('div', {
                      className: 'absolute inset-0 bg-black/50 opacity-0 group-hover/art:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-1.5',
                      style: { pointerEvents: 'auto' }
                    },
                      // Add to Playlist button
                      React.createElement('button', {
                        onClick: (e) => {
                          e.stopPropagation();
                          setAddToPlaylistPanel({
                            open: true,
                            tracks: [track],
                            sourceName: track.title,
                            sourceType: 'track'
                          });
                        },
                        className: 'w-7 h-7 rounded-full flex items-center justify-center transition-all hover:scale-110',
                        style: { backgroundColor: 'rgba(255, 255, 255, 0.15)', color: '#ffffff', border: 'none', cursor: 'pointer' },
                        onMouseEnter: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.25)',
                        onMouseLeave: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.15)',
                        title: 'Add to Playlist'
                      },
                        React.createElement('svg', { className: 'w-3.5 h-3.5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2 },
                          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M12 4v16m8-8H4' })
                        )
                      ),
                      // Play button (center, larger)
                      React.createElement('button', {
                        onClick: (e) => {
                          e.stopPropagation();
                          const cachedArt = getCachedAlbumArt(track.artist, track.album, track.releaseGroupId, track.releaseId);
                          saveSearchHistory(searchQuery, {
                            type: 'track',
                            id: track.id,
                            name: track.title,
                            artist: track.artist,
                            imageUrl: track.albumArt || cachedArt
                          });
                          handlePlay(track);
                        },
                        className: 'w-9 h-9 bg-white rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-110',
                        style: { border: 'none', cursor: 'pointer' },
                        title: 'Play'
                      },
                        React.createElement(Play, { size: 16, className: 'text-gray-800 ml-0.5' })
                      ),
                      // Add to Queue button
                      React.createElement('button', {
                        onClick: (e) => {
                          e.stopPropagation();
                          addToQueue([track]);
                          showToast(`Added "${track.title}" to queue`, 'success');
                        },
                        className: 'w-7 h-7 rounded-full flex items-center justify-center transition-all hover:scale-110',
                        style: { backgroundColor: 'rgba(255, 255, 255, 0.15)', color: '#ffffff', border: 'none', cursor: 'pointer' },
                        onMouseEnter: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.25)',
                        onMouseLeave: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.15)',
                        title: 'Add to Queue'
                      },
                        React.createElement('svg', { className: 'w-3.5 h-3.5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2 },
                          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M4 6h16M4 12h16M4 18h7' })
                        )
                      )
                    ),
                    // Resolver dots - bottom right corner (hidden on hover)
                    track.sources && Object.keys(track.sources).filter(id => !track.sources[id]?.noMatch).length > 0 && React.createElement('div', {
                      className: 'absolute bottom-1.5 right-1.5 flex gap-1 transition-opacity group-hover/art:opacity-0'
                    },
                      ...Object.keys(track.sources).filter(id => !track.sources[id]?.noMatch).slice(0, 4).map(source => {
                        const colors = {
                          spotify: '#1DB954',
                          youtube: '#FF0000',
                          bandcamp: '#1DA0C3',
                          applemusic: '#FA243C',
                          localfiles: '#6B7280'
                        };
                        return React.createElement('div', {
                          key: source,
                          style: {
                            width: '7px',
                            height: '7px',
                            borderRadius: '50%',
                            backgroundColor: colors[source] || '#9CA3AF',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.3)'
                          }
                        });
                      })
                    )
                  ),
                  // Track title - refined typography
                  React.createElement('div', {
                    className: 'truncate',
                    style: {
                      fontSize: '13px',
                      fontWeight: '500',
                      color: 'var(--text-primary)',
                      marginTop: '6px'
                    }
                  }, track.title),
                  // Artist name
                  React.createElement('div', {
                    className: 'truncate',
                    style: {
                      fontSize: '11px',
                      color: 'var(--text-secondary)',
                      marginTop: '2px'
                    }
                  }, track.artist)
                );
              })
            )
          ),

          // Albums section with album art cards - responsive grid
          searchResults.albums.length > 0 && React.createElement('div', null,
            React.createElement('div', { className: 'flex items-center justify-between mb-4' },
              React.createElement('h3', { className: 'text-xs font-semibold text-gray-400 uppercase tracking-wider' }, 'ALBUMS'),
              searchResults.albums.length > 8 &&
                React.createElement('button', {
                  onClick: () => {
                    setSearchDetailCategory('albums');
                    setSearchPreviewItem(searchResults.albums[0] || null);
                  },
                  className: 'text-xs text-gray-500 hover:text-gray-700'
                }, 'Show more')
            ),
            React.createElement('div', {
              className: 'flex gap-x-4 gap-y-5'
            },
              ...searchResults.albums.slice(0, getItemsPerRow(160)).map((album, index) => {
                const albumItemWidth = Math.floor((searchContainerWidth - (getItemsPerRow(160) - 1) * 16) / getItemsPerRow(160));
                const animationDelay = Math.min(index * 40, 300);
                return React.createElement('div', {
                  key: album.id,
                  onClick: () => {
                    saveSearchHistory(searchQuery, {
                      type: 'album',
                      id: album.id,
                      name: album.title,
                      artist: album['artist-credit']?.[0]?.name,
                      imageUrl: album.albumArt || null
                    });
                    handleAlbumClick(album);
                  },
                  onMouseEnter: () => {
                    // Prefetch album tracks on hover for context menu
                    prefetchSearchAlbumTracks(album);
                  },
                  className: 'group cursor-grab active:cursor-grabbing release-card card-fade-up',
                  style: {
                    width: albumItemWidth,
                    padding: '10px',
                    borderRadius: '10px',
                    backgroundColor: 'var(--card-bg)',
                    boxShadow: 'var(--card-shadow)',
                    animationDelay: `${animationDelay}ms`
                  },
                  draggable: true,
                  onDragStart: (e) => {
                    e.dataTransfer.effectAllowed = 'copy';
                    const prefetched = prefetchedReleasesRef.current[album.id];
                    e.dataTransfer.setData('text/plain', JSON.stringify({
                      type: 'album',
                      album: {
                        id: trackSlug(album['artist-credit']?.[0]?.name || 'unknown', album.title || 'untitled'),
                        title: album.title,
                        artist: album['artist-credit']?.[0]?.name || 'Unknown',
                        year: album['first-release-date']?.split('-')[0] ? parseInt(album['first-release-date'].split('-')[0]) : null,
                        art: null,
                        trackCount: prefetched?.tracks?.length || null
                      }
                    }));
                  },
                  onContextMenu: (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (window.electron?.contextMenu?.showTrackMenu) {
                      const artistName = album['artist-credit']?.[0]?.name || 'Unknown';
                      const albumData = {
                        title: album.title,
                        artist: artistName,
                        year: album['first-release-date']?.split('-')[0] ? parseInt(album['first-release-date'].split('-')[0]) : null,
                        art: album.albumArt || null
                      };
                      // Check prefetched cache (use ref) and loading state (use module-level Set)
                      const prefetched = prefetchedReleasesRef.current[album.id];
                      const isLoading = prefetchInProgress.has(album.id);
                      window.electron.contextMenu.showTrackMenu({
                        type: 'release',
                        name: album.title,
                        album: albumData,
                        tracks: prefetched?.tracks || [],
                        loading: isLoading
                      });
                    }
                  }
                },
                  // Album art with rounded corners and inner shadow
                  React.createElement('div', {
                    className: 'w-full aspect-square rounded-lg overflow-hidden mb-2 relative album-art-container group/art'
                  },
                    // Dark placeholder background
                    React.createElement('div', {
                      className: 'absolute inset-0',
                      style: { background: 'linear-gradient(145deg, #1f1f1f 0%, #2d2d2d 50%, #1a1a1a 100%)' }
                    }),
                    // Image with fade-in
                    album.albumArt && React.createElement('img', {
                      src: album.albumArt,
                      alt: album.title,
                      className: 'absolute inset-0 w-full h-full object-cover transition-all duration-300 group-hover/art:scale-105',
                      style: { opacity: 0 },
                      ref: (el) => { if (el && el.complete && el.naturalWidth > 0) el.style.opacity = '1'; },
                      onLoad: (e) => { e.target.style.opacity = '1'; },
                      onError: (e) => { e.target.style.display = 'none'; }
                    }),
                    // Hover overlay with action buttons (Add to Playlist, Play, Queue)
                    React.createElement('div', {
                      className: 'absolute inset-0 bg-black/50 opacity-0 group-hover/art:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-2',
                      style: { pointerEvents: 'auto' }
                    },
                      // Add to Playlist button
                      React.createElement('button', {
                        onClick: async (e) => {
                          e.stopPropagation();
                          // Get prefetched tracks for playlist, or fetch them
                          let prefetched = prefetchedReleasesRef.current[album.id];
                          if (!prefetched?.tracks?.length) {
                            showToast('Loading album...', 'info');
                            await fetchSearchAlbumTracksAsync(album);
                            prefetched = prefetchedReleasesRef.current[album.id];
                          }
                          if (prefetched?.tracks?.length > 0) {
                            setAddToPlaylistPanel({
                              open: true,
                              tracks: prefetched.tracks,
                              sourceName: album.title,
                              sourceType: 'album'
                            });
                          } else {
                            showToast('Could not load album tracks', 'error');
                          }
                        },
                        className: 'w-8 h-8 rounded-full flex items-center justify-center transition-all hover:scale-110',
                        style: { backgroundColor: 'rgba(255, 255, 255, 0.15)', color: '#ffffff', border: 'none', cursor: 'pointer' },
                        onMouseEnter: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.25)',
                        onMouseLeave: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.15)',
                        title: 'Add to Playlist'
                      },
                        React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2 },
                          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M12 4v16m8-8H4' })
                        )
                      ),
                      // Play button (center, larger - plays album)
                      React.createElement('button', {
                        onClick: async (e) => {
                          e.stopPropagation();
                          saveSearchHistory(searchQuery, {
                            type: 'album',
                            id: album.id,
                            name: album.title,
                            artist: album['artist-credit']?.[0]?.name,
                            imageUrl: album.albumArt || null
                          });
                          // Play the album - fetch tracks if needed
                          let prefetched = prefetchedReleasesRef.current[album.id];
                          if (!prefetched?.tracks?.length) {
                            showToast('Loading album...', 'info');
                            await fetchSearchAlbumTracksAsync(album);
                            prefetched = prefetchedReleasesRef.current[album.id];
                          }
                          if (prefetched?.tracks?.length > 0) {
                            const context = { type: 'album', name: album.title, artist: album['artist-credit']?.[0]?.name };
                            const [firstTrack, ...remainingTracks] = prefetched.tracks;
                            const taggedFirstTrack = { ...firstTrack, _playbackContext: context };
                            setQueueWithContext(remainingTracks, context, true);
                            handlePlay(taggedFirstTrack);
                          } else {
                            showToast('Could not load album tracks', 'error');
                          }
                        },
                        className: 'w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-110',
                        style: { border: 'none', cursor: 'pointer' },
                        title: 'Play album'
                      },
                        React.createElement(Play, { size: 18, className: 'text-gray-800 ml-0.5' })
                      ),
                      // Add to Queue button
                      React.createElement('button', {
                        onClick: async (e) => {
                          e.stopPropagation();
                          // Fetch album tracks and add to queue
                          let prefetched = prefetchedReleasesRef.current[album.id];
                          if (!prefetched?.tracks?.length) {
                            showToast('Loading album...', 'info');
                            await fetchSearchAlbumTracksAsync(album);
                            prefetched = prefetchedReleasesRef.current[album.id];
                          }
                          if (prefetched?.tracks?.length > 0) {
                            addToQueue(prefetched.tracks, { type: 'album', name: album.title, artist: album['artist-credit']?.[0]?.name });
                            showToast(`Added ${prefetched.tracks.length} tracks from "${album.title}" to queue`, 'success');
                          } else {
                            showToast('Could not load album tracks', 'error');
                          }
                        },
                        className: 'w-8 h-8 rounded-full flex items-center justify-center transition-all hover:scale-110',
                        style: { backgroundColor: 'rgba(255, 255, 255, 0.15)', color: '#ffffff', border: 'none', cursor: 'pointer' },
                        onMouseEnter: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.25)',
                        onMouseLeave: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.15)',
                        title: 'Add to Queue'
                      },
                        React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2 },
                          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M4 6h16M4 12h16M4 18h7' })
                        )
                      )
                    )
                  ),
                  // Album title - refined typography
                  React.createElement('div', {
                    className: 'truncate',
                    style: {
                      fontSize: '13px',
                      fontWeight: '500',
                      color: 'var(--text-primary)',
                      marginTop: '6px'
                    }
                  }, album.title),
                  // Artist and year
                  React.createElement('div', {
                    className: 'truncate',
                    style: {
                      fontSize: '11px',
                      color: 'var(--text-secondary)',
                      marginTop: '2px'
                    }
                  },
                    `${album['artist-credit']?.[0]?.name || 'Unknown'} • ${album['first-release-date']?.split('-')[0] || ''}`
                  )
                );
              })
            )
          ),

          // Playlists section - single row with overflow hidden
          searchResults.playlists.length > 0 && React.createElement('div', null,
            React.createElement('div', { className: 'flex items-center justify-between mb-4' },
              React.createElement('h3', { className: 'text-xs font-semibold text-gray-400 uppercase tracking-wider' }, 'PLAYLISTS'),
              searchResults.playlists.length > 5 &&
                React.createElement('button', {
                  onClick: () => {
                    setSearchDetailCategory('playlists');
                    setSearchPreviewItem(searchResults.playlists[0] || null);
                  },
                  className: 'text-xs text-gray-500 hover:text-gray-700'
                }, 'Show more')
            ),
            React.createElement('div', {
              className: 'flex gap-4 overflow-hidden'
            },
              ...searchResults.playlists.slice(0, 20).map((playlist, index) => {
                const animationDelay = Math.min(index * 40, 300);
                return React.createElement('div', {
                  key: playlist.title,
                  onClick: () => {
                    saveSearchHistory(searchQuery, {
                      type: 'playlist',
                      id: playlist.id,
                      name: playlist.title,
                      imageUrl: null
                    });
                    handlePlaylistClick(playlist);
                  },
                  className: 'flex-shrink-0 cursor-pointer group release-card card-fade-up',
                  style: {
                    width: '160px',
                    padding: '12px',
                    borderRadius: '10px',
                    backgroundColor: 'var(--card-bg)',
                    boxShadow: 'var(--card-shadow)',
                    animationDelay: `${animationDelay}ms`
                  }
                },
                  // Playlist icon
                  React.createElement('div', {
                    className: 'w-full aspect-square rounded-lg mb-2 flex items-center justify-center',
                    style: { background: 'linear-gradient(145deg, #1f1f1f 0%, #2d2d2d 50%, #1a1a1a 100%)' }
                  },
                    React.createElement('svg', {
                      className: 'w-10 h-10 text-gray-500',
                      fill: 'none',
                      viewBox: '0 0 24 24',
                      stroke: 'currentColor',
                      strokeWidth: 1.5
                    },
                      React.createElement('path', {
                        strokeLinecap: 'round',
                        strokeLinejoin: 'round',
                        d: 'M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V4.5L9 7.5v9.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 13.125V9'
                      })
                    )
                  ),
                  // Playlist title
                  React.createElement('div', {
                    className: 'truncate',
                    style: {
                      fontSize: '13px',
                      fontWeight: '500',
                      color: 'var(--text-primary)'
                    }
                  }, playlist.title),
                  // Track count
                  React.createElement('div', {
                    className: 'truncate',
                    style: {
                      fontSize: '11px',
                      color: 'var(--text-secondary)',
                      marginTop: '2px'
                    }
                  },
                    `${playlist.tracks?.length || 0} tracks`
                  )
                );
              })
            )
          )
        )
        )
      )
    );
});

module.exports = { SearchPage, SEARCH_PAGE_HANDLERS };
