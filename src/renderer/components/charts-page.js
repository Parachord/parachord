// src/renderer/components/charts-page.js: Pop of the Tops (activeView
// 'discover'): an albums chart and a tracks chart, in hero tabs (#1451, moved
// out of app.js). Each comes from a plug-in with charts (lib/charts.js,
// #1539 step 3), picked in the Source menu; the Region menu lists that
// source's regions.
//
// A React.memo'd page fed stable props, like the other pages: state,
// setters, refs and memos by value, plain functions through
// useStableHandlers (CHARTS_PAGE_HANDLERS, pinned by
// tests/renderer/page-memo.test.js). The markup moved as it was; window is
// read only inside handlers.

const Icons = require('./icons');
const { TrackRow, TrackRowSkeleton, VirtualizedTrackList } = require('./track-lists');
const { FilterBox } = require('./filter-box');
const { PageHero } = require('./page-hero');
const { CardSkeleton } = require('./home-skeletons');
const { AlbumCard, AlbumRankBadge } = require('./album-card');
const { SortMenu } = require('./sort-menu');
const { HeroTabs } = require('./hero-tabs');
const { EmptyState, ErrorState } = require('./states');
const { releaseMenu } = require('../lib/item-menus');
const { chartLoadView } = require('../lib/chart-load-view');
const { errorText } = require('../lib/error-copy');
const { countOf } = require('../lib/plural');

const CHARTS_PAGE_HANDLERS = [
  'albumCardActions',
  'chartAlbumYear',
  'copyParachordLink',
  'fetchArtistData',
  'loadCharts',
  'loadSongsCharts',
  'observedRowRef',
  'openChartsAlbum',
  'patchListArt',
  'pickChart',
  'playTrackRow',
  'prefetchChartsTracks',
  'retryBrokenListArt',
];

const ChartsPage = React.memo(function ChartsPage(props) {
  const {
    albumCardActions,
    allResolvers,
    chartAlbumYear,
    charts,
    chartsError,
    chartsHeaderCollapsed,
    chartsLoaded,
    chartsLoading,
    chartsSearch,
    chartsSearchOpen,
    chartsPicks,
    chartsShown,
    chartSources,
    chartsTab,
    copyParachordLink,
    currentTrack,
    fetchArtistData,
    filterCharts,
    handleChartsScroll,
    isPlaying,
    songsCharts,
    songsChartsError,
    songsChartsLoaded,
    songsChartsLoading,
    songsChartsObserverRef,
    songsChartsRowRefs,
    songsChartsScrollContainerRef,
    loadCharts,
    loadSongsCharts,
    observedRowRef,
    openChartsAlbum,
    patchListArt,
    pickChart,
    playTrackRow,
    playbackResolvers,
    prefetchChartsTracks,
    prefetchedReleases,
    resolverOrder,
    retryBrokenListArt,
    setCharts,
    setChartsError,
    setChartsSearch,
    setChartsSearchOpen,
    setChartsTab,
    setSongsChartsScrollContainerReady,
    trackSources,
  } = props;
  // The tab's sources (plug-ins with charts, in the user's order) and the one
  // the menus show: the user's pick, else what the last load showed, else
  // the first. The region likewise, when that source has it.
  const sources = (chartSources && chartSources[chartsTab]) || [];
  const pick = (chartsPicks && chartsPicks[chartsTab]) || {};
  const shown = chartsShown && chartsShown[chartsTab];
  const current = sources.find(c => c.id === pick.source) || sources.find(c => c.id === (shown && shown.source)) || sources[0] || null;
  const offered = (v) => !!current && current.regions.some(r => r.value === v);
  const regionValue = pick.region != null && offered(pick.region) ? pick.region
    : (shown && current && shown.source === current.id && offered(shown.region) ? shown.region
      : (current && current.regions[0] ? current.regions[0].value : ''));
  const kindWord = chartsTab === 'albums' ? 'albums' : 'tracks';
  const subtitle = current
    ? `Top 50 most played ${kindWord} on ${current.label}${current.period ? ` ${current.period}` : ''}`
    : `The most played ${kindWord} right now`;
  const songsView = chartLoadView({ loading: songsChartsLoading, loaded: songsChartsLoaded, error: songsChartsError });
  // A row's play count, when the chart gives one (Last.fm: listeners;
  // ListenBrainz: plays this week). The column is always there on the Tracks
  // tab, so the rows line up with the skeleton whatever the source.
  // Short enough for the column: 940 plays, 325K listeners, 2.2M listeners.
  const countText = (n, word) => {
    if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M ${word}s`;
    if (n >= 1000) return `${Math.round(n / 1000)}K ${word}s`;
    return countOf(n, word);
  };
  const playCount = (track) => (track.listeners > 0 ? countText(track.listeners, 'listener') : (track.listens > 0 ? countText(track.listens, 'play') : ''));
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
                        // The Tracks chart loads from an effect once it can.
                        setChartsTab(tab);
                      }, renderLabel: (tab) => (tab === 'songs' ? 'Tracks' : 'Albums'), label: 'Charts' })
                ),
React.createElement('p', {
                  className: 'mt-4 text-white/80 text-sm'
                }, subtitle)),
collapsedContent: React.createElement(React.Fragment, null,
React.createElement('div', {
                  className: 'flex items-center gap-1'
                },
                  React.createElement(HeroTabs, { items: ['albums', 'songs'], isSelected: (tab) => chartsTab === tab, onSelect: (tab) => {
                        setChartsTab(tab);
                      }, renderLabel: (tab) => (tab === 'songs' ? 'Tracks' : 'Albums'), label: 'Charts' })
                ),
React.createElement('div', { className: 'flex-1' }),
React.createElement('span', {
                  className: 'text-sm font-medium uppercase tracking-wider text-white/80'
                }, chartsTab === 'albums'
                  ? `${charts.length} Albums`
                  : `${songsCharts.length} Tracks`))
}),
          // Filter bar (outside scrollable area)
          React.createElement('div', {
            className: 'flex items-center px-6 py-3',
            style: { flexShrink: 0, backgroundColor: 'var(--bg-primary)', borderBottom: '1px solid var(--border-default)' }
          },
              // Source (components/sort-menu.js): the plug-ins with this
              // tab's chart; a pick loads that source's chart.
              sources.length > 0 && React.createElement(SortMenu, {
                value: current ? current.id : '',
                options: sources.map(c => ({ value: c.id, label: c.label })),
                label: 'Chart source',
                prefix: 'Source:',
                onChange: (v) => pickChart(chartsTab, { source: v }),
              }),
              // Region (components/sort-menu.js): the source's regions (Global
              // and countries); none when it has only one.
              current && current.regions.length > 1 && React.createElement('div', { className: 'ml-2' },
                React.createElement(SortMenu, {
                  value: regionValue,
                  options: current.regions,
                  label: 'Chart region',
                  prefix: 'Region:',
                  onChange: (v) => pickChart(chartsTab, { region: v }),
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
              songsChartsScrollContainerRef.current = el;
              if (el && chartsTab === 'songs') {
                setSongsChartsScrollContainerReady(true);
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

            // SONGS TAB: a failed load shows its error with Try again.
            chartsTab === 'songs' && songsView === 'error' &&
              React.createElement(ErrorState, {
                title: current ? `Couldn’t load the ${current.label} chart` : 'Couldn’t load the chart',
                body: errorText(songsChartsError, current ? `${current.label}’s chart didn’t load. Try again, or pick another source.` : 'The chart didn’t load. Try again in a moment.'),
                onRetry: () => loadSongsCharts({ forceReload: true })
              }),

            // SONGS TAB: the shared track row's placeholder, in its columns.
            chartsTab === 'songs' && songsView === 'skeleton' && React.createElement('div', { className: 'space-y-0' },
              Array.from({ length: 20 }).map((_, i) => React.createElement(TrackRowSkeleton, {
                key: `skeleton-row-${i}`, index: i, duration: true,
                cells: [{ key: 'listeners', width: '90px', align: 'right' }]
              }))
            ),

            // SONGS TAB - the chart's tracks
            chartsTab === 'songs' && songsChartsLoaded && !songsChartsLoading && (() => {
              const filtered = filterCharts(songsCharts);

              if (filtered.length === 0 && chartsSearch) {
                return React.createElement(EmptyState, { icon: Icons.Search, title: 'No tracks match your search', body: 'Try other words, or clear the filter.' });
              }

              if (filtered.length === 0) {
                return React.createElement(EmptyState, { title: 'No chart data yet', body: 'The chart didn’t load. Try again in a moment.' });
              }

              // Virtualized past 100 rows (#767); each row is a list item.
              return React.createElement(VirtualizedTrackList, {
                tracks: filtered,
                parentRef: songsChartsScrollContainerRef,
                renderRow: (track, index) => {
                  const isCurrentTrack = currentTrack?.title === track.title && currentTrack?.artist === track.artist;
                  const isNowPlaying = isCurrentTrack && isPlaying;

                  return React.createElement(TrackRow, {
                    key: track.id,
                    track,
                    number: String(track.rank).padStart(2, '0'),
                    isNowPlaying,
                    sources: { trackSources, playbackResolvers, resolverOrder },
                    allResolvers,
                    rowRef: observedRowRef(songsChartsRowRefs, songsChartsObserverRef, track.id),
                    // Sources (resolved or empty) go along so playback resolves
                    // what isn't yet; the source buttons share the row's context.
                    onPlay: (resolverId) => playTrackRow(
                      { id: track.id, title: track.title, artist: track.artist, album: '', sources: trackSources[track.id] || {} },
                      filtered.slice(index + 1).map(t => ({ id: t.id, title: t.title, artist: t.artist, album: '', sources: trackSources[t.id] || {} })),
                      { type: 'songs-charts', name: current ? `${current.label} Charts` : 'Charts' },
                      resolverId),
                    onOpenArtist: fetchArtistData,
                    onContextMenu: () => window.showItemMenu({
                      type: 'track',
                      track: { id: track.id, title: track.title, artist: track.artist, album: '' }
                    }),
                    duration: true,
                    cells: [{ key: 'listeners', content: playCount(track), width: '90px', align: 'right' }]
                  });
                }
              });
            })()
          )
        );
});

module.exports = { ChartsPage, CHARTS_PAGE_HANDLERS };
