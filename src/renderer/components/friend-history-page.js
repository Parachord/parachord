// src/renderer/components/friend-history-page.js: a friend's history
// (activeView 'friendHistory'): their recent plays and top tracks, albums
// and artists, the same tabs as History, with pin, follow and listen-along
// in the hero (#1451, moved out of app.js).
//
// A React.memo'd page fed stable props, like the other pages: state,
// setters, refs, memos and callbacks by value, plain functions through
// useStableHandlers (FRIEND_HISTORY_PAGE_HANDLERS, pinned by
// tests/renderer/page-memo.test.js). The view was an IIFE; its body is the
// component's, moved as it was; window is read only inside handlers.

const Icons = require('./icons');
const { TrackRow, TrackRowSkeleton, VirtualizedTrackList } = require('./track-lists');
const { historySortOptions, historyPeriodOptions } = require('../lib/history-options');
const { PageHero } = require('./page-hero');
const { FriendAvatar } = require('./friend-avatar');
const { CardSkeleton } = require('./home-skeletons');
const { ArtistCard, ArtistCardSkeleton, RankBadge } = require('./artist-card');
const { AlbumCard, AlbumRankBadge } = require('./album-card');
const { Button } = require('./button');
const { SortMenu } = require('./sort-menu');
const { HeroTabs } = require('./hero-tabs');
const { EmptyState, ErrorState } = require('./states');
const { countOf } = require('../lib/plural');
const { artistMenu, releaseMenu } = require('../lib/item-menus');

const FRIEND_HISTORY_PAGE_HANDLERS = [
  'albumCardActions',
  'copyParachordLink',
  'fetchAlbumTracksByName',
  'fetchArtistData',
  'followRecommendedFriend',
  'formatTimeAgo',
  'isOnAir',
  'loadFriendRecentTracks',
  'loadFriendTopAlbums',
  'loadFriendTopArtists',
  'loadFriendTopTracks',
  'observedRowRef',
  'openTopAlbum',
  'pinFriend',
  'playArtistTopTracks',
  'playTrackRow',
  'prefetchTopAlbumTracks',
  'retryBrokenListArt',
  'trackRowDrag',
  'unpinFriend',
];

const FriendHistoryPage = React.memo(function FriendHistoryPage(props) {
  const {
    albumCardActions,
    allResolvers,
    copyParachordLink,
    currentFriend,
    fetchAlbumTracksByName,
    fetchArtistData,
    followRecommendedFriend,
    followingRecommended,
    formatTimeAgo,
    friendHistoryData,
    friendHistoryLoading,
    friendHistoryObserverRef,
    friendHistoryPeriod,
    friendHistoryScrollContainerReady,
    friendHistoryScrollContainerRef,
    friendHistorySort,
    friendHistoryTab,
    friendHistoryTrackRowRefs,
    friends,
    historyHeaderCollapsed,
    isOnAir,
    loadFriendRecentTracks,
    loadFriendTopAlbums,
    loadFriendTopArtists,
    loadFriendTopTracks,
    observedRowRef,
    openTopAlbum,
    pinFriend,
    pinnedFriendIds,
    playArtistTopTracks,
    playTrackRow,
    playbackResolvers,
    prefetchTopAlbumTracks,
    resolverLoaderRef,
    resolverOrder,
    retryBrokenListArt,
    setFriendHistoryData,
    setFriendHistoryPeriod,
    setFriendHistoryScrollContainerReady,
    setFriendHistorySort,
    setFriendHistoryTab,
    setHistoryHeaderCollapsed,
    sortFriendHistory,
    topAlbumTracksCache,
    trackRowDrag,
    trackSources,
    unpinFriend,
  } = props;
  // The top-tracks album column shows only when the list has albums;
  // worked out once, not per row.
  const friendHistoryTopHasAlbums = (friendHistoryData.topTracks || []).some(t => t.album);

          return React.createElement('div', {
            className: 'flex-1 flex flex-col h-full',
            style: { overflow: 'hidden', minHeight: 0 }
          },
            // Header section (outside scrollable area) - matching History pattern
            React.createElement(PageHero, {
collapsed: historyHeaderCollapsed,
page: 'history',
expanded: React.createElement(React.Fragment, null,
// Their photo, or their initial on the avatar gradient (components/friend-avatar.js).
React.createElement(FriendAvatar, { name: currentFriend.displayName, avatarUrl: currentFriend.avatarUrl, size: 'lg', className: 'mb-4' }),
React.createElement('div', { className: 'flex items-center gap-3 mb-2' },
                  React.createElement('h1', {
                    className: 'text-4xl font-light text-white',
                    style: {
                      textShadow: 'var(--hero-text-shadow)',
                      letterSpacing: '0.2em',
                      textTransform: 'uppercase'
                    },
                    onContextMenu: copyParachordLink
                  }, currentFriend.displayName),
                  // On-air badge
                  // The status colour (both themes), sentence case.
                  isOnAir(currentFriend) && React.createElement('span', {
                    className: 'px-2 py-1 text-xs font-medium rounded-full flex items-center gap-1',
                    style: { backgroundColor: 'var(--success)', color: 'var(--on-accent)' }
                  },
                    React.createElement('span', { className: 'w-2 h-2 bg-surface-card rounded-full animate-pulse' }),
                    'On air'
                  )
                ),
React.createElement('div', {
                  className: 'flex items-center gap-1 mt-4',
                  style: { textShadow: 'var(--hero-text-shadow-line)' }
                },
                  React.createElement(HeroTabs, { items: [
                    { key: 'recent', label: 'Recently Played' },
                    { key: 'topTracks', label: 'Top Tracks' },
                    { key: 'topAlbums', label: 'Top Albums' },
                    { key: 'topArtists', label: 'Top Artists' }
                  ], isSelected: (tab) => friendHistoryTab === tab.key, onSelect: (tab) => {
                        setFriendHistoryTab(tab.key);
                        if (tab.key === 'recent') loadFriendRecentTracks(currentFriend);
                        else if (tab.key === 'topTracks') loadFriendTopTracks(currentFriend);
                        else if (tab.key === 'topAlbums') loadFriendTopAlbums(currentFriend);
                        else if (tab.key === 'topArtists') loadFriendTopArtists(currentFriend);
                      }, renderLabel: (tab) => tab.label, label: 'Friend history' })
                ),
React.createElement('p', {
                  className: 'mt-4 text-white/80 text-sm'
                }, `Listening activity from ${currentFriend.service === 'lastfm' ? 'Last.fm' : 'ListenBrainz'}`)),
collapsedContent: React.createElement(React.Fragment, null,
React.createElement(FriendAvatar, { name: currentFriend.displayName, avatarUrl: currentFriend.avatarUrl, size: 'md', className: 'mr-4' }),
React.createElement('h1', {
                  className: 'text-2xl font-light text-white mr-6',
                  style: {
                    textShadow: 'var(--hero-text-shadow-bar)',
                    letterSpacing: '0.2em',
                    textTransform: 'uppercase'
                  },
                  onContextMenu: copyParachordLink
                }, currentFriend.displayName),
isOnAir(currentFriend) && React.createElement('span', {
                  className: 'w-2.5 h-2.5 rounded-full mr-4',
                  style: { backgroundColor: 'var(--success)' }
                }),
React.createElement('div', {
                  className: 'flex items-center gap-1',
                  style: { textShadow: 'var(--hero-text-shadow-line)' }
                },
                  React.createElement(HeroTabs, { items: [
                    { key: 'recent', label: 'Recent' },
                    { key: 'topTracks', label: 'Top Tracks' },
                    { key: 'topAlbums', label: 'Top Albums' },
                    { key: 'topArtists', label: 'Top Artists' }
                  ], isSelected: (tab) => friendHistoryTab === tab.key, onSelect: (tab) => {
                        setFriendHistoryTab(tab.key);
                        if (tab.key === 'recent') loadFriendRecentTracks(currentFriend);
                        else if (tab.key === 'topTracks') loadFriendTopTracks(currentFriend);
                        else if (tab.key === 'topAlbums') loadFriendTopAlbums(currentFriend);
                        else if (tab.key === 'topArtists') loadFriendTopArtists(currentFriend);
                      }, renderLabel: (tab) => tab.label, label: 'Friend history' })
                ))
}),
            // Filter bar (outside scrollable area - matching History exactly)
            React.createElement('div', {
              className: 'flex items-center px-6 py-3',
            style: { flexShrink: 0, backgroundColor: 'var(--bg-primary)', borderBottom: '1px solid var(--border-default)' }
            },
              // Sort dropdown for recent, period dropdown for top charts
              friendHistoryTab === 'recent' ?
                React.createElement(SortMenu, { value: friendHistorySort, options: historySortOptions, onChange: setFriendHistorySort, label: "Sort" })
              :
                React.createElement(SortMenu, { value: friendHistoryPeriod, options: historyPeriodOptions, onChange: (option) => { setFriendHistoryPeriod(option); if (friendHistoryTab === 'topTracks') loadFriendTopTracks(currentFriend, option);
                          else if (friendHistoryTab === 'topAlbums') loadFriendTopAlbums(currentFriend, option);
                          else if (friendHistoryTab === 'topArtists') loadFriendTopArtists(currentFriend, option); }, label: "Time period" }),
              React.createElement('div', { className: 'flex-1' }),
              // A person opened from Recommendations isn't a friend yet: Follow
              // adds them (and pins them); pinning a non-friend would pin nothing.
              !friends.some(f => f.id === currentFriend.id) && React.createElement(Button, { variant: 'primary', size: 'sm', type: 'button', disabled: followingRecommended, onClick: () => followRecommendedFriend(currentFriend) }, followingRecommended ? 'Following\u2026' : 'Follow'),
              // Pin/Unpin button on right side of filter bar
              // The shared Button (a hand-built pill in a hex purple before);
              // pinned shows a filled bookmark.
              friends.some(f => f.id === currentFriend.id) && React.createElement(Button, {
                variant: 'secondary', size: 'sm',
                onClick: () => pinnedFriendIds.includes(currentFriend.id) ? unpinFriend(currentFriend.id) : pinFriend(currentFriend.id),
                'aria-pressed': pinnedFriendIds.includes(currentFriend.id) ? 'true' : 'false',
                'data-tooltip': pinnedFriendIds.includes(currentFriend.id) ? 'Unpin from the sidebar' : undefined
              },
                React.createElement(Icons.Bookmark, { className: 'w-4 h-4', fill: pinnedFriendIds.includes(currentFriend.id) ? 'currentColor' : 'none', style: pinnedFriendIds.includes(currentFriend.id) ? { color: 'var(--accent-primary)' } : undefined }),
                pinnedFriendIds.includes(currentFriend.id) ? 'Pinned' : 'Pin to sidebar'
              )
            ),
            // Scrollable content area
            React.createElement('div', {
              ref: (el) => {
                friendHistoryScrollContainerRef.current = el;
                if (el && !friendHistoryScrollContainerReady) {
                  setFriendHistoryScrollContainerReady(true);
                }
              },
              className: 'flex-1 overflow-y-auto scrollable-content scroll-edge p-6',
              onScroll: (e) => {
                const scrollTop = e.target.scrollTop;
                if (scrollTop > 50 && !historyHeaderCollapsed) {
                  setHistoryHeaderCollapsed(true);
                } else if (scrollTop <= 50 && historyHeaderCollapsed) {
                  setHistoryHeaderCollapsed(false);
                }
              }
            },
                // Loading state
                // Loading: the tab's own placeholders in its real layout (a
                // lone spinner stood in before).
                friendHistoryLoading && (friendHistoryTab === 'topAlbums' || friendHistoryTab === 'topArtists'
                  ? React.createElement('div', { className: 'card-grid gap-4', role: 'status', 'aria-label': 'Loading…' },
                      Array.from({ length: 10 }).map((_, i) => friendHistoryTab === 'topAlbums'
                        ? React.createElement(CardSkeleton, { key: i, index: i, lines: 2 })
                        : React.createElement(ArtistCardSkeleton, { key: i, index: i, lines: 2 })))
                  : React.createElement('div', { className: 'space-y-0', role: 'status', 'aria-label': 'Loading…' },
                      Array.from({ length: 12 }).map((_, i) => React.createElement(TrackRowSkeleton, {
                        key: i, index: i, duration: true,
                        cells: [{ key: 'album' }, { key: friendHistoryTab === 'recent' ? 'when' : 'plays', width: '80px', align: 'right' }]
                      })))),
                // A tab whose load failed (the service unreachable): say so,
                // with Try again, rather than an empty list that reads as
                // "they have none". The service's name comes from its plugin.
                !friendHistoryLoading && friendHistoryData.errors?.[friendHistoryTab] && (() => {
                  const serviceName = ((resolverLoaderRef.current?.getAllResolvers?.() || []).find(r => r.id === currentFriend?.service) || {}).name
                    || currentFriend?.service || 'the service';
                  const retry = () => {
                    if (friendHistoryTab === 'recent') loadFriendRecentTracks(currentFriend);
                    else if (friendHistoryTab === 'topTracks') loadFriendTopTracks(currentFriend);
                    else if (friendHistoryTab === 'topAlbums') loadFriendTopAlbums(currentFriend);
                    else loadFriendTopArtists(currentFriend);
                  };
                  return React.createElement('div', { 'data-friend-tab-error': friendHistoryTab },
                    React.createElement(ErrorState, { title: `Couldn’t reach ${serviceName}`, body: 'Check your connection and try again.', onRetry: retry }));
                })(),
                // Recent tab content - matching History page layout
                !friendHistoryLoading && !friendHistoryData.errors?.recent && friendHistoryTab === 'recent' && (() => {
                  const sorted = sortFriendHistory(friendHistoryData.recent);
                  if (sorted.length === 0 && friendHistoryData.recentHidden) {
                    return React.createElement('p', { className: 'text-center text-ink-tertiary py-8' },
                      `${currentFriend.displayName} hides their recent listening on Last.fm. Their top tracks, albums and artists are in the other tabs.`);
                  }
                  if (sorted.length === 0) {
                    return React.createElement(EmptyState, { title: 'No recent listens', body: 'Nothing played lately.' });
                  }
                  // The album column only when the list has albums (ListenBrainz's top
                  // tracks carry none, which left a blank column).
                  const hasAlbums = sorted.some(t => t.album);
                  // Virtualized past 100 rows (#767). Two listens of one song
                  // share an id, so rows key by the listen.
                  return React.createElement(VirtualizedTrackList, {
                    tracks: sorted,
                    parentRef: friendHistoryScrollContainerRef,
                    getKey: (track, index) => `${track.id}|${track.playedAt ?? index}`,
                    renderRow: (track, index) => {
                      return React.createElement(TrackRow, Object.assign({
                        key: `${track.id}|${track.playedAt ?? index}`,
                        track,
                        number: String(index + 1).padStart(2, '0'),
                        isNowPlaying: !!track.nowPlaying,
                        sources: { trackSources, playbackResolvers, resolverOrder },
                        allResolvers,
                        rowRef: observedRowRef(friendHistoryTrackRowRefs, friendHistoryObserverRef, track.id),
                        onPlay: (resolverId) => playTrackRow(track, sorted.slice(index + 1), { type: 'friend', name: currentFriend?.name || 'Friend', tab: 'recent' }, resolverId),
                        onOpenArtist: fetchArtistData,
                        onContextMenu: () => window.showItemMenu({ type: 'track', track }),
                        duration: true,
                        cells: [
                          ...(hasAlbums ? [{ key: 'album', content: track.album || '' }] : []),
                          { key: 'when', content: (track.playedAt || track.timestamp) ? formatTimeAgo(track.playedAt || track.timestamp) : '', width: '80px', align: 'right' }
                        ]
                      }, trackRowDrag(track)));
                    }
                  });
                })(),
                // Top tracks tab content - matching History page layout
                !friendHistoryLoading && !friendHistoryData.errors?.topTracks && friendHistoryTab === 'topTracks' && React.createElement('div', { className: 'space-y-0' },
                  friendHistoryData.topTracks.length === 0
                    ? React.createElement(EmptyState, { title: 'No top tracks for this period', body: 'Pick a longer period.' })
                    // Virtualized past 100 rows (#767).
                    : React.createElement(VirtualizedTrackList, {
                      tracks: friendHistoryData.topTracks,
                      parentRef: friendHistoryScrollContainerRef,
                      renderRow: (track, index) => {
                        return React.createElement(TrackRow, Object.assign({
                          key: track.id || index,
                          track,
                          number: `#${track.rank || index + 1}`,
                          sources: { trackSources, playbackResolvers, resolverOrder },
                          allResolvers,
                          rowRef: observedRowRef(friendHistoryTrackRowRefs, friendHistoryObserverRef, track.id),
                          onPlay: (resolverId) => playTrackRow(track, friendHistoryData.topTracks.slice(index + 1), { type: 'friend', name: currentFriend?.name || 'Friend', tab: 'topTracks' }, resolverId),
                          onOpenArtist: fetchArtistData,
                          onContextMenu: () => window.showItemMenu({ type: 'track', track }),
                          duration: true,
                            cells: [
                            // The album column only when the list has albums (ListenBrainz's top
                            // tracks carry none, which left a blank column).
                            ...(friendHistoryTopHasAlbums ? [{ key: 'album', content: track.album || '' }] : []),
                            { key: 'plays', content: countOf(track.playCount, 'play'), width: '80px', align: 'right' }
                          ]
                        }, trackRowDrag(track)));
                      }
                    })
                ),
                // Top albums tab content
                !friendHistoryLoading && !friendHistoryData.errors?.topAlbums && friendHistoryTab === 'topAlbums' && React.createElement('div', {
                  className: 'card-grid gap-4'
                },
                  friendHistoryData.topAlbums.length === 0
                    ? React.createElement('div', { className: 'col-span-full' }, React.createElement(EmptyState, { title: 'No top albums for this period', body: 'Pick a longer period.' }))
                    // The shared album card (components/album-card.js): the rank
                    // on the cover, the play count under the artist.
                    : friendHistoryData.topAlbums.map((album, index) => React.createElement(AlbumCard, Object.assign({
                        key: album.id || index,
                        album: { id: album.id || null, title: album.name, artist: album.artist, imageUrl: album.image || null },
                        imageLoading: !album.imageLoaded,
                        cornerBadge: React.createElement(AlbumRankBadge, { rank: album.rank }),
                        subtitle: countOf(album.playCount, 'play'),
                        onOpen: () => openTopAlbum(album),
                        onOpenArtist: () => fetchArtistData(album.artist),
                        onHoverPrefetch: () => prefetchTopAlbumTracks(album.artist, album.name, album.image),
                        onContextMenu: () => {
                          const cacheKey = `${album.artist}-${album.name}`.toLowerCase();
                          const cached = topAlbumTracksCache.current[cacheKey];
                          window.showItemMenu(releaseMenu({ title: album.name, artist: album.artist, image: album.image }, { tracks: cached }));
                        },
                        // A dead cover: retry once and patch the friend's album.
                        onArtError: () => retryBrokenListArt(album.image, { artist: album.artist, album: album.name, id: album.id }, (id, fresh) => {
                          setFriendHistoryData(prev => ({
                            ...prev,
                            topAlbums: prev.topAlbums.map(a => (a.id === id ? { ...a, image: fresh } : a))
                          }));
                        })
                      }, albumCardActions({ title: album.name, artist: album.artist, getTracks: () => fetchAlbumTracksByName(album.artist, album.name, album.image) }))))
                ),
                // Top artists tab content
                !friendHistoryLoading && !friendHistoryData.errors?.topArtists && friendHistoryTab === 'topArtists' && React.createElement('div', {
                  className: 'card-grid gap-4'
                },
                  friendHistoryData.topArtists.length === 0
                    ? React.createElement('div', { className: 'col-span-full' }, React.createElement(EmptyState, { title: 'No top artists for this period', body: 'Pick a longer period.' }))
                    : friendHistoryData.topArtists.map((artist, index) => React.createElement(ArtistCard, {
                        key: artist.id || index,
                        artist,
                        image: artist.image,
                        imageLoaded: !!artist.imageLoaded,
                        badge: React.createElement(RankBadge, { rank: artist.rank }),
                        subtitle: countOf(artist.playCount, 'play'),
                        onOpen: () => fetchArtistData(artist.name),
                        onPlay: playArtistTopTracks,
                        onContextMenu: () => window.showItemMenu(artistMenu({ id: artist.id || null, name: artist.name, image: artist.image }))
                      }))
                )
            )
          );
});

module.exports = { FriendHistoryPage, FRIEND_HISTORY_PAGE_HANDLERS };
