// src/renderer/components/history-page.js: the History page (activeView
// 'history'): Recently played, Top tracks, Top albums and Top artists, in
// hero tabs, with search, sort and a period menu (#1451, moved out of
// app.js).
//
// A React.memo'd page fed stable props, like the other pages: state,
// setters, refs, memos and callbacks by value, plain functions through
// useStableHandlers (HISTORY_PAGE_HANDLERS, pinned by
// tests/renderer/page-memo.test.js). The markup moved as it was; window is
// read only inside handlers.

const Icons = require('./icons');
const { TrackRow, TrackRowSkeleton, VirtualizedTrackList } = require('./track-lists');
const { FilterBox } = require('./filter-box');
const { PageHero } = require('./page-hero');
const { CardSkeleton } = require('./home-skeletons');
const { ArtistCard, ArtistCardSkeleton, RankBadge } = require('./artist-card');
const { AlbumCard, AlbumRankBadge } = require('./album-card');
const { SortMenu } = require('./sort-menu');
const { HeroTabs } = require('./hero-tabs');
const { EmptyState } = require('./states');
const { countOf } = require('../lib/plural');
const { artistMenu, releaseMenu } = require('../lib/item-menus');
const { historySortOptions, historyPeriodOptions } = require('../lib/history-options');

const HISTORY_PAGE_HANDLERS = [
  'albumCardActions',
  'copyParachordLink',
  'fetchAlbumTracksByName',
  'fetchArtistData',
  'formatTimeAgo',
  'historyErrorState',
  'loadListeningHistory',
  'loadTopAlbums',
  'loadTopArtists',
  'loadTopTracks',
  'observedRowRef',
  'openTopAlbum',
  'pickHistorySource',
  'playArtistTopTracks',
  'playTrackRow',
  'prefetchTopAlbumTracks',
  'trackRowDrag',
];

const HistoryPage = React.memo(function HistoryPage(props) {
  const {
    albumCardActions,
    allResolvers,
    copyParachordLink,
    fetchAlbumTracksByName,
    fetchArtistData,
    filterHistory,
    formatTimeAgo,
    handleHistoryScroll,
    historyErrorState,
    historyHeaderCollapsed,
    historyObserverRef,
    historyPeriod,
    historyScrollContainerReady,
    historyScrollContainerRef,
    historySearch,
    historySource,
    historySources,
    historySearchOpen,
    historySort,
    historyTab,
    historyTrackRowRefs,
    listeningHistory,
    loadListeningHistory,
    loadTopAlbums,
    loadTopArtists,
    loadTopTracks,
    observedRowRef,
    openTopAlbum,
    pickHistorySource,
    playArtistTopTracks,
    playTrackRow,
    playbackResolvers,
    prefetchTopAlbumTracks,
    resolverOrder,
    setHistoryPeriod,
    setHistoryScrollContainerReady,
    setHistorySearch,
    setHistorySearchOpen,
    setHistorySort,
    setHistoryTab,
    setTopTracksScrollContainerReady,
    sortHistory,
    topAlbumTracksCache,
    topAlbums,
    topArtists,
    topTracks,
    topTracksObserverRef,
    topTracksRowRefs,
    topTracksScrollContainerReady,
    topTracksScrollContainerRef,
    trackRowDrag,
    trackSources,
  } = props;
  // The plug-ins that keep your listening history and that you're signed in
  // to (#1539 step 4); the top lists show one, picked in the Source menu.
  const signedIn = (historySources && historySources.signedIn) || [];
  const services = (historySources && historySources.services) || [];
  const topSource = signedIn.find(c => c.id === historySource) || signedIn[0] || null;
  return React.createElement('div', {
          className: 'flex-1 flex flex-col h-full',
          style: { overflow: 'hidden', minHeight: 0 }
        },
          // Header section (outside scrollable area)
          React.createElement(PageHero, {
collapsed: historyHeaderCollapsed,
page: 'history',
title: 'History',
onTitleContextMenu: copyParachordLink,
expanded: React.createElement(React.Fragment, null,
React.createElement('div', {
                className: 'flex items-center gap-1 mt-6',
                style: { textShadow: 'var(--hero-text-shadow-line)' }
              },
                React.createElement(HeroTabs, { items: [
                  { key: 'topTracks', label: 'Top Tracks' },
                  { key: 'topAlbums', label: 'Top Albums' },
                  { key: 'topArtists', label: 'Top Artists' },
                  { key: 'recent', label: 'Recently Played' }
                ], isSelected: (tab) => historyTab === tab.key, onSelect: (tab) => {
                      setHistoryTab(tab.key);
                      if (tab.key === 'recent') loadListeningHistory();
                      else if (tab.key === 'topTracks') loadTopTracks();
                      else if (tab.key === 'topArtists') loadTopArtists();
                      else if (tab.key === 'topAlbums') loadTopAlbums();
                    }, renderLabel: (tab) => tab.label, label: 'History' })
              ),
React.createElement('p', {
                className: 'mt-4 text-white/80 text-sm'
              }, signedIn.length > 0
                ? `Your listening activity from ${signedIn.map(c => c.label).join(' & ')}`
                : 'Your listening activity')),
collapsedContent: React.createElement(React.Fragment, null,
React.createElement('div', {
                className: 'flex items-center gap-1',
                style: { textShadow: 'var(--hero-text-shadow-line)' }
              },
                React.createElement(HeroTabs, { items: [
                  { key: 'topTracks', label: 'Top Tracks' },
                  { key: 'topAlbums', label: 'Top Albums' },
                  { key: 'topArtists', label: 'Top Artists' },
                  { key: 'recent', label: 'Recent' }
                ], isSelected: (tab) => historyTab === tab.key, onSelect: (tab) => {
                      setHistoryTab(tab.key);
                      if (tab.key === 'recent') loadListeningHistory();
                      else if (tab.key === 'topTracks') loadTopTracks();
                      else if (tab.key === 'topArtists') loadTopArtists();
                      else if (tab.key === 'topAlbums') loadTopAlbums();
                    }, renderLabel: (tab) => tab.label, label: 'History' })
              ))
}),
          // Filter bar (outside scrollable area)
          React.createElement('div', {
            className: 'flex items-center px-6 py-3',
            style: { flexShrink: 0, backgroundColor: 'var(--bg-primary)', borderBottom: '1px solid var(--border-default)' }
          },
            // Period dropdown for top charts OR sort dropdown for recent
            historyTab === 'recent' ?
              React.createElement(SortMenu, { value: historySort, options: historySortOptions, onChange: setHistorySort, label: "Sort" })
            :
              React.createElement(React.Fragment, null,
                // Source (when you're signed in to more than one), then period
                signedIn.length > 1 && React.createElement('div', { className: 'mr-2' },
                  React.createElement(SortMenu, {
                    value: topSource ? topSource.id : '',
                    options: signedIn.map(c => ({ value: c.id, label: c.label })),
                    label: 'History source',
                    prefix: 'Source:',
                    onChange: (v) => pickHistorySource(v),
                  })
                ),
                React.createElement(SortMenu, { value: historyPeriod, options: historyPeriodOptions, onChange: (option) => { setHistoryPeriod(option); if (historyTab === 'topTracks') loadTopTracks(option);
                        else if (historyTab === 'topArtists') loadTopArtists(option);
                        else if (historyTab === 'topAlbums') loadTopAlbums(option); }, label: "Time period" })),
            React.createElement('div', { className: 'flex-1' }),
            // Search (only for recent and top tracks)
            (historyTab === 'recent' || historyTab === 'topTracks') && React.createElement(FilterBox, { value: historySearch, onChange: setHistorySearch, open: historySearchOpen, onOpenChange: setHistorySearchOpen })
          ),
          // Scrollable content area (shared by recent and topTracks tabs)
          React.createElement('div', {
            ref: (el) => {
              historyScrollContainerRef.current = el;
              topTracksScrollContainerRef.current = el; // Same container for top tracks tab
              if (el) {
                if (!historyScrollContainerReady) setHistoryScrollContainerReady(true);
                if (!topTracksScrollContainerReady) setTopTracksScrollContainerReady(true);
              }
            },
            className: 'flex-1 overflow-y-auto scrollable-content scroll-edge p-6',
            onScroll: handleHistoryScroll
          },
            // RECENTLY PLAYED TAB
            historyTab === 'recent' && (
              listeningHistory.loading ?
                React.createElement('div', { className: 'space-y-0' },
                  ...Array(15).fill(null).map((_, i) =>
                    React.createElement(TrackRowSkeleton, { key: `history-skeleton-${i}`, index: i, duration: true, cells: [{ key: 'album' }, { key: 'when', width: '80px', align: 'right' }] })
                  )
                )
              : listeningHistory.error ?
                historyErrorState(listeningHistory.error, loadListeningHistory, services)
              : (() => {
                  const filtered = filterHistory(listeningHistory.tracks);
                  const sorted = sortHistory(filtered);

                  if (sorted.length === 0) {
                    return historySearch
                      ? React.createElement(EmptyState, { icon: Icons.Search, title: 'No tracks match your search', body: 'Try other words, or clear the filter.' })
                      : React.createElement(EmptyState, { title: 'No recent listens yet', body: 'What you play shows up here.' });
                  }

                  // The album column only when the list has albums (ListenBrainz's top
                  // tracks carry none, which left a blank column).
                  const hasAlbums = sorted.some(t => t.album);
                  // Virtualized past 100 rows (#767). Two listens of one song
                  // share an id (ListenBrainz's recording_msid), so rows key
                  // by the listen.
                  return React.createElement(VirtualizedTrackList, {
                    tracks: sorted,
                    parentRef: historyScrollContainerRef,
                    getKey: (track, index) => `${track.id}|${track.playedAt ?? index}`,
                    renderRow: (track, index) => {
                      return React.createElement(TrackRow, Object.assign({
                        key: `${track.id}|${track.playedAt ?? index}`,
                        track,
                        number: String(index + 1).padStart(2, '0'),
                        isNowPlaying: !!track.nowPlaying,
                        sources: { trackSources, playbackResolvers, resolverOrder },
                        allResolvers,
                        rowRef: observedRowRef(historyTrackRowRefs, historyObserverRef, track.id),
                        onPlay: (resolverId) => playTrackRow(track, sorted.slice(index + 1), { type: 'history', name: 'History' }, resolverId),
                        onOpenArtist: fetchArtistData,
                        onContextMenu: () => window.showItemMenu({ type: 'track', track }),
                        duration: true,
                        cells: [
                          ...(hasAlbums ? [{ key: 'album', content: track.album || '' }] : []),
                          { key: 'when', content: (track.playedAt || track.timestamp) ? formatTimeAgo(track.playedAt || track.timestamp) : '', width: '80px', align: 'right' }
                        ]
                      }, trackRowDrag(track, { id: track.id, title: track.title, artist: track.artist, album: track.album, duration: track.duration, sources: track.sources || {} })));
                    }
                  });
                })()
            ),

            // TOP TRACKS TAB
            historyTab === 'topTracks' && (
              topTracks.loading ?
                React.createElement('div', { className: 'space-y-0' },
                  ...Array(15).fill(null).map((_, i) =>
                    React.createElement(TrackRowSkeleton, { key: `top-track-skeleton-${i}`, index: i, duration: true, cells: [{ key: 'album' }, { key: 'plays', width: '80px', align: 'right' }] })
                  )
                )
              : topTracks.error ?
                historyErrorState(topTracks.error, () => loadTopTracks(), services)
              : (() => {
                  const filtered = historySearch ? topTracks.tracks.filter(t =>
                    t.title.toLowerCase().includes(historySearch.toLowerCase()) ||
                    t.artist.toLowerCase().includes(historySearch.toLowerCase())
                  ) : topTracks.tracks;

                  if (filtered.length === 0) {
                    return historySearch
                      ? React.createElement(EmptyState, { icon: Icons.Search, title: 'No tracks match your search', body: 'Try other words, or clear the filter.' })
                      : React.createElement(EmptyState, { title: 'No top tracks for this period', body: 'Pick a longer period.' });
                  }

                  const hasAlbums = filtered.some(t => t.album);
                  // Virtualized past 100 rows (#767); Top tracks shares the
                  // History tab's scroll container.
                  return React.createElement(VirtualizedTrackList, {
                    tracks: filtered,
                    parentRef: topTracksScrollContainerRef,
                    renderRow: (track, index) => {
                      return React.createElement(TrackRow, Object.assign({
                        key: track.id,
                        track,
                        number: `#${track.rank}`,
                        sources: { trackSources, playbackResolvers, resolverOrder },
                        allResolvers,
                        rowRef: observedRowRef(topTracksRowRefs, topTracksObserverRef, track.id),
                        onPlay: (resolverId) => playTrackRow(track, filtered.slice(index + 1), { type: 'history', name: 'Top Tracks' }, resolverId),
                        onOpenArtist: fetchArtistData,
                        onContextMenu: () => window.showItemMenu({ type: 'track', track }),
                        duration: true,
                        cells: [
                          ...(hasAlbums ? [{ key: 'album', content: track.album || '' }] : []),
                          { key: 'plays', content: countOf(track.playCount, 'play'), width: '80px', align: 'right' }
                        ]
                      }, trackRowDrag(track)));
                    }
                  });
                })()
            ),

            // TOP ARTISTS TAB
            historyTab === 'topArtists' && (
              topArtists.loading ?
                // Skeleton loading grid
                React.createElement('div', {
                  className: 'grid gap-4',
                  style: { gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }
                },
                  Array.from({ length: 12 }).map((_, i) =>
                    React.createElement(ArtistCardSkeleton, { key: `artist-skeleton-${i}`, index: i, lines: 2 })
                  )
                )
              : topArtists.error ?
                historyErrorState(topArtists.error, () => loadTopArtists(), services)
              : topArtists.artists.length === 0 ?
                React.createElement(EmptyState, { title: 'No top artists for this period', body: 'Pick a longer period.' })
              :
                // Top Artists grid - Square card design
                React.createElement('div', { role: 'list',
                  className: 'grid gap-4',
                  style: { gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }
                },
                  ...topArtists.artists.map((artist, index) => React.createElement(ArtistCard, {
                    key: artist.id,
                    role: 'listitem',
                    artist,
                    image: artist.image,
                    imageLoaded: !!artist.imageLoaded,
                    badge: React.createElement(RankBadge, { rank: artist.rank }),
                    subtitle: countOf(artist.playCount, 'play'),
                    animationDelay: Math.min(index * 30, 300),
                    onOpen: () => fetchArtistData(artist.name),
                    onPlay: playArtistTopTracks,
                    onContextMenu: () => window.showItemMenu(artistMenu({ id: artist.id, name: artist.name, image: artist.image }))
                  }))
                )
            ),

            // TOP ALBUMS TAB
            historyTab === 'topAlbums' && (
              topAlbums.loading ?
                // Skeleton loading grid
                React.createElement('div', {
                  className: 'card-grid gap-x-4 gap-y-5 pb-6'
                },
                  Array.from({ length: 10 }).map((_, i) =>
                    React.createElement(CardSkeleton, { key: `album-skeleton-${i}`, index: i, lines: 2 })
                  )
                )
              : topAlbums.error ?
                historyErrorState(topAlbums.error, () => loadTopAlbums(), services)
              : topAlbums.albums.length === 0 ?
                React.createElement(EmptyState, { title: 'No top albums for this period', body: 'Pick a longer period.' })
              :
                // Top Albums grid - Cinematic Light design
                React.createElement('div', { role: 'list',
                  className: 'card-grid gap-x-4 gap-y-5 pb-6'
                },
                  // The shared album card (components/album-card.js), with the
                  // rank on the cover and the play count under the artist.
                  ...topAlbums.albums.map((album, index) => React.createElement(AlbumCard, Object.assign({
                    key: album.id,
                    role: 'listitem',
                    album: { id: album.id, title: album.name, artist: album.artist, imageUrl: typeof album.image === 'string' && album.image ? album.image : null },
                    imageLoading: album.image === undefined,
                    cornerBadge: React.createElement(AlbumRankBadge, { rank: album.rank }),
                    subtitle: countOf(album.playCount, 'play'),
                    animationDelay: Math.min(index * 30, 300),
                    onOpen: () => openTopAlbum(album),
                    onOpenArtist: () => fetchArtistData(album.artist),
                    onHoverPrefetch: () => prefetchTopAlbumTracks(album.artist, album.name, album.image),
                    onContextMenu: () => {
                      const cacheKey = `${album.artist}-${album.name}`.toLowerCase();
                      const cached = topAlbumTracksCache.current[cacheKey];
                      window.showItemMenu(releaseMenu({ title: album.name, artist: album.artist, image: album.image }, { tracks: cached }));
                    },
                    onArtError: () => globalThis.reportBrokenAlbumArt && globalThis.reportBrokenAlbumArt(album.image, { artist: album.artist, album: album.name })
                  }, albumCardActions({ title: album.name, artist: album.artist, getTracks: () => fetchAlbumTracksByName(album.artist, album.name, album.image) }))))
                )
            )
          )
        );
});

module.exports = { HistoryPage, HISTORY_PAGE_HANDLERS };
