// src/renderer/components/charts-page.js: Pop of the Tops (activeView
// 'discover'): the albums chart (iTunes, by country) and the songs chart
// (Apple Music or Last.fm), in hero tabs (#1451, moved out of app.js).
//
// A React.memo'd page fed stable props, like the other pages: state,
// setters, refs and memos by value, plain functions through
// useStableHandlers (CHARTS_PAGE_HANDLERS, pinned by
// tests/renderer/page-memo.test.js). The markup moved as it was; window is
// read only inside handlers.

const Icons = require('./icons');
const { TrackRow, TrackRowSkeleton } = require('./track-lists');
const { FilterBox } = require('./filter-box');
const { PageHero } = require('./page-hero');
const { CardSkeleton } = require('./home-skeletons');
const { AlbumCard, AlbumRankBadge } = require('./album-card');
const { SortMenu } = require('./sort-menu');
const { HeroTabs } = require('./hero-tabs');
const { EmptyState, ErrorState } = require('./states');
const { releaseMenu } = require('../lib/item-menus');
const { CHARTS_COUNTRIES } = require('../lib/charts-countries');

const CHARTS_PAGE_HANDLERS = [
  'albumCardActions',
  'chartAlbumYear',
  'copyParachordLink',
  'fetchArtistData',
  'loadAppleMusicSongsCharts',
  'loadCharts',
  'loadLastfmCharts',
  'observedRowRef',
  'openChartsAlbum',
  'patchListArt',
  'playTrackRow',
  'prefetchChartsTracks',
  'retryBrokenListArt',
];

const ChartsPage = React.memo(function ChartsPage(props) {
  const {
    albumCardActions,
    allResolvers,
    appleMusicSongsCharts,
    appleMusicSongsChartsLoaded,
    appleMusicSongsChartsLoading,
    cacheLoaded,
    chartAlbumYear,
    charts,
    chartsCountry,
    chartsError,
    chartsHeaderCollapsed,
    chartsLoaded,
    chartsLoading,
    chartsSearch,
    chartsSearchOpen,
    chartsSongsSource,
    chartsTab,
    copyParachordLink,
    currentTrack,
    fetchArtistData,
    filterCharts,
    handleChartsScroll,
    isPlaying,
    lastfmCharts,
    lastfmChartsLoaded,
    lastfmChartsLoading,
    lastfmChartsObserverRef,
    lastfmChartsRowRefs,
    lastfmChartsScrollContainerRef,
    loadAppleMusicSongsCharts,
    loadCharts,
    loadLastfmCharts,
    observedRowRef,
    openChartsAlbum,
    patchListArt,
    playTrackRow,
    playbackResolvers,
    prefetchChartsTracks,
    prefetchedReleases,
    resolverOrder,
    retryBrokenListArt,
    setCharts,
    setChartsCountry,
    setChartsError,
    setChartsSearch,
    setChartsSearchOpen,
    setChartsSongsSource,
    setChartsTab,
    setLastfmChartsScrollContainerReady,
    trackSources,
  } = props;
  return React.createElement('div', {
          className: 'flex-1 flex flex-col h-full',
          style: { overflow: 'hidden', minHeight: 0 }
        },
          // Header section (outside scrollable area)
          React.createElement(PageHero, {
collapsed: chartsHeaderCollapsed,
page: 'discover',
title: 'Pop of the Tops',
onTitleContextMenu: copyParachordLink,
expanded: React.createElement(React.Fragment, null,
React.createElement('div', {
                  className: 'flex items-center gap-1 mt-4',
                  style: { textShadow: 'var(--hero-text-shadow-line)' }
                },
                  React.createElement(HeroTabs, { items: ['albums', 'songs'], isSelected: (tab) => chartsTab === tab, onSelect: (tab) => {
                        setChartsTab(tab);
                        // Load charts based on selected source when switching to songs tab
                        if (tab === 'songs' && cacheLoaded) {
                          if (chartsSongsSource === 'apple' && !appleMusicSongsChartsLoaded && !appleMusicSongsChartsLoading) {
                            loadAppleMusicSongsCharts({ country: chartsCountry });
                          } else if (chartsSongsSource === 'lastfm' && !lastfmChartsLoaded && !lastfmChartsLoading) {
                            loadLastfmCharts({ country: chartsCountry });
                          }
                        }
                      }, renderLabel: (tab) => (tab === 'songs' ? 'Tracks' : 'Albums'), label: 'Charts' })
                ),
React.createElement('p', {
                  className: 'mt-4 text-white/80 text-sm'
                }, chartsTab === 'albums'
                  ? 'Top 50 most played albums on Apple Music'
                  : chartsSongsSource === 'apple'
                    ? 'Top 50 most played tracks on Apple Music'
                    : 'Top 50 most played tracks on Last.fm')),
collapsedContent: React.createElement(React.Fragment, null,
React.createElement('div', {
                  className: 'flex items-center gap-1'
                },
                  React.createElement(HeroTabs, { items: ['albums', 'songs'], isSelected: (tab) => chartsTab === tab, onSelect: (tab) => {
                        setChartsTab(tab);
                        if (tab === 'songs' && cacheLoaded) {
                          if (chartsSongsSource === 'apple' && !appleMusicSongsChartsLoaded && !appleMusicSongsChartsLoading) {
                            loadAppleMusicSongsCharts({ country: chartsCountry });
                          } else if (chartsSongsSource === 'lastfm' && !lastfmChartsLoaded && !lastfmChartsLoading) {
                            loadLastfmCharts({ country: chartsCountry });
                          }
                        }
                      }, renderLabel: (tab) => (tab === 'songs' ? 'Tracks' : 'Albums'), label: 'Charts' })
                ),
React.createElement('div', { className: 'flex-1' }),
React.createElement('span', {
                  className: 'text-sm font-medium uppercase tracking-wider text-white/80'
                }, chartsTab === 'albums'
                  ? `${charts.length} Albums`
                  : `${chartsSongsSource === 'apple' ? appleMusicSongsCharts.length : lastfmCharts.length} Tracks`))
}),
          // Filter bar (outside scrollable area)
          React.createElement('div', {
            className: 'flex items-center px-6 py-3',
            style: { flexShrink: 0, backgroundColor: 'var(--bg-primary)', borderBottom: '1px solid var(--border-default)' }
          },
              // Source (components/sort-menu.js); a pick loads that source's chart
              chartsTab === 'songs' && React.createElement(SortMenu, {
                value: chartsSongsSource,
                options: [{ value: 'apple', label: 'Apple Music' }, { value: 'lastfm', label: 'Last.fm' }],
                label: 'Chart source',
                prefix: 'Source:',
                onChange: (v) => {
                  setChartsSongsSource(v);
                  if (v === 'apple' && cacheLoaded && !appleMusicSongsChartsLoaded && !appleMusicSongsChartsLoading) {
                    loadAppleMusicSongsCharts({ country: chartsCountry });
                  }
                  if (v === 'lastfm' && !lastfmChartsLoaded && !lastfmChartsLoading) {
                    loadLastfmCharts({ country: chartsCountry });
                  }
                },
              }),
              // Region (components/sort-menu.js). Apple Music has no global
              // chart, so an empty region means the US there; Last.fm offers Global.
              chartsTab === 'songs' && React.createElement('div', { className: 'ml-2' },
                React.createElement(SortMenu, {
                  value: chartsSongsSource === 'apple' && !chartsCountry ? 'us' : chartsCountry,
                  options: (chartsSongsSource === 'lastfm' ? [{ value: '', label: 'Global' }] : [])
                    .concat(CHARTS_COUNTRIES.map(c => ({ value: c.code, label: c.name }))),
                  label: 'Chart region',
                  prefix: 'Region:',
                  placeholder: 'United States',
                  onChange: (v) => {
                    setChartsCountry(v);
                    if (!v) loadLastfmCharts({ forceReload: true });
                    else if (chartsSongsSource === 'apple') loadAppleMusicSongsCharts({ country: v, forceReload: true });
                    else loadLastfmCharts({ country: v, forceReload: true });
                  },
                })
              ),
              React.createElement('div', { className: 'flex-1' }),
              // Search
              React.createElement(FilterBox, { value: chartsSearch, onChange: setChartsSearch, open: chartsSearchOpen, onOpenChange: setChartsSearchOpen })
          ),
          // Content area (scrollable)
          React.createElement('div', {
            className: 'scrollable-content scroll-edge',
            ref: (el) => {
              lastfmChartsScrollContainerRef.current = el;
              if (el && chartsTab === 'songs') {
                setLastfmChartsScrollContainerReady(true);
              }
            },
            style: {
              flex: 1,
              overflowY: 'scroll',
              pointerEvents: 'auto',
              padding: '24px'
            },
            onScroll: handleChartsScroll
          },
            // ALBUMS TAB - Error state
            chartsTab === 'albums' && chartsError && !chartsLoading && React.createElement(ErrorState, { title: 'Couldn’t load the charts', body: chartsError, onRetry: () => { setChartsError(null); loadCharts(); } }),

            // ALBUMS TAB: the shared card's placeholder (title, artist, year).
            chartsTab === 'albums' && !chartsError && (chartsLoading || !chartsLoaded) && React.createElement('div', {
              className: 'card-grid gap-4 pb-6'
            },
              Array.from({ length: 15 }).map((_, i) => React.createElement(CardSkeleton, { key: `skeleton-${i}`, index: i, lines: 2 }))
            ),

            // ALBUMS TAB - Album grid content
            chartsTab === 'albums' && chartsLoaded && !chartsLoading && (() => {
              const filtered = filterCharts(charts);

              if (filtered.length === 0 && chartsSearch) {
                return React.createElement(EmptyState, { icon: Icons.Search, title: 'No albums match your search', body: 'Try other words, or clear the filter.' });
              }

              if (filtered.length === 0) {
                return React.createElement(EmptyState, { title: 'No chart data yet', body: 'The chart didn’t load. Try again in a moment.' });
              }

              return React.createElement('div', { role: 'list',
                className: 'card-grid gap-x-4 gap-y-5 pb-6'
              },
                // The shared album card (components/album-card.js), with the
                // chart rank on the cover.
                filtered.map((item, index) => React.createElement(AlbumCard, Object.assign({
                  key: item.id,
                  role: 'listitem',
                  album: { id: item.id, title: item.title, artist: item.artist, imageUrl: item.albumArt || null },
                  imageLoading: item.albumArt === undefined,
                  cornerBadge: item.rank != null && React.createElement(AlbumRankBadge, { rank: item.rank }),
                  // The release year (Apple's date; a chart cached before the
                  // field kept only pubDate, read in UTC). Always a line, so
                  // the cards line up.
                  subtitle: chartAlbumYear(item) || '\u00a0',
                  animationDelay: Math.min(index * 30, 300),
                  // The card waits 250ms before this (its own dwell).
                  onHoverPrefetch: () => prefetchChartsTracks(item),
                  onOpen: () => openChartsAlbum(item),
                  onOpenArtist: () => fetchArtistData(item.artist),
                  onContextMenu: () => {
                    const prefetched = prefetchedReleases[item.id];
                    window.showItemMenu(releaseMenu(item, { tracks: prefetched?.tracks }));
                  },
                  onArtError: () => retryBrokenListArt(item.albumArt, { artist: item.artist, album: item.title, id: item.id }, patchListArt(setCharts))
                }, albumCardActions({ title: item.title, artist: item.artist, id: item.id, getTracks: () => prefetchChartsTracks(item) }))))
              );
            })(),

            // SONGS TAB: the shared track row's placeholder, in its columns.
            chartsTab === 'songs' && (
              (chartsSongsSource === 'apple' && (appleMusicSongsChartsLoading || !appleMusicSongsChartsLoaded)) ||
              (chartsSongsSource === 'lastfm' && (lastfmChartsLoading || !lastfmChartsLoaded))
            ) && React.createElement('div', { className: 'space-y-0' },
              Array.from({ length: 20 }).map((_, i) => React.createElement(TrackRowSkeleton, {
                key: `skeleton-row-${i}`, index: i, duration: true,
                cells: chartsSongsSource === 'lastfm' ? [{ key: 'listeners', width: '90px', align: 'right' }] : []
              }))
            ),

            // SONGS TAB - Table of tracks (Apple Music or Last.fm)
            chartsTab === 'songs' && (
              (chartsSongsSource === 'apple' && appleMusicSongsChartsLoaded && !appleMusicSongsChartsLoading) ||
              (chartsSongsSource === 'lastfm' && lastfmChartsLoaded && !lastfmChartsLoading)
            ) && (() => {
              const songsData = chartsSongsSource === 'apple' ? appleMusicSongsCharts : lastfmCharts;
              const filtered = filterCharts(songsData);

              if (filtered.length === 0 && chartsSearch) {
                return React.createElement(EmptyState, { icon: Icons.Search, title: 'No tracks match your search', body: 'Try other words, or clear the filter.' });
              }

              if (filtered.length === 0) {
                return React.createElement(EmptyState, { title: 'No chart data yet', body: 'The chart didn’t load. Try again in a moment.' });
              }

              return React.createElement('div', { role: 'list', className: 'space-y-0' },
                filtered.map((track, index) => {
                  const isCurrentTrack = currentTrack?.title === track.title && currentTrack?.artist === track.artist;
                  const isNowPlaying = isCurrentTrack && isPlaying;

                  return React.createElement(TrackRow, {
                    role: 'listitem',
                    key: track.id,
                    track,
                    number: String(track.rank).padStart(2, '0'),
                    isNowPlaying,
                    sources: { trackSources, playbackResolvers, resolverOrder },
                    allResolvers,
                    rowRef: observedRowRef(lastfmChartsRowRefs, lastfmChartsObserverRef, track.id),
                    // Sources (resolved or empty) go along so playback resolves
                    // what isn't yet; the source buttons share the row's context.
                    onPlay: (resolverId) => playTrackRow(
                      { id: track.id, title: track.title, artist: track.artist, album: '', sources: trackSources[track.id] || {} },
                      filtered.slice(index + 1).map(t => ({ id: t.id, title: t.title, artist: t.artist, album: '', sources: trackSources[t.id] || {} })),
                      { type: 'songs-charts', name: chartsSongsSource === 'apple' ? 'Apple Music Charts' : 'Last.fm Charts' },
                      resolverId),
                    onOpenArtist: fetchArtistData,
                    onContextMenu: () => window.showItemMenu({
                      type: 'track',
                      track: { id: track.id, title: track.title, artist: track.artist, album: '' }
                    }),
                    duration: true,
                    // Last.fm's chart says how many listen; the column is
                    // always there on Last.fm so the rows line up.
                    cells: chartsSongsSource === 'lastfm' ? [{ key: 'listeners', content: track.listeners > 0 ? `${(track.listeners / 1000).toFixed(0)}K listeners` : '', width: '90px', align: 'right' }] : []
                  });
                })
              );
            })()
          )
        );
});

module.exports = { ChartsPage, CHARTS_PAGE_HANDLERS };
