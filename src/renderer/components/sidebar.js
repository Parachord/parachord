// src/renderer/components/sidebar.js: the app's navigation landmark down
// the left: search, the page links (Your Music, Discover) with their unread
// dots and counts, the friends list (pinned and on-air friends, their mini
// playbars, Add friend) and Settings (#1451, moved out of app.js).
//
// A React.memo'd panel fed stable props: state, setters, refs, a callback
// and the playback hooks' values by value, plain functions through
// useStableHandlers (SIDEBAR_HANDLERS, pinned by
// tests/renderer/page-memo.test.js). Which item a playlist page lights is
// worked out here from activeView and selectedPlaylist. The markup moved as
// it was; window is read only inside handlers.

const Icons = require('./icons');
const { Tooltip } = require('./ui-atoms');
const { FriendMiniPlaybar } = require('./friend-mini-playbar');
const { NavItem, NavSearch } = require('./nav-item');
const { PAGE_ICONS } = require('../lib/page-icons');
const { Button } = require('./button');
const { CardButton } = require('./card-button');
const { FriendAvatar } = require('./friend-avatar');

// macOS draws the traffic lights over the sidebar's top (read at load,
// safely under plain Node).
const isMac = !!(globalThis.window && globalThis.window.electron && globalThis.window.electron.platform === 'darwin');

const SIDEBAR_HANDLERS = [
  'activateListenAlong',
  'deactivateListenAlong',
  'getAlbumArt',
  'handlePlaylistDrop',
  'isOnAir',
  'loadCharts',
  'loadCriticsPicks',
  'loadNewReleases',
  'loadTopTracks',
  'navigateBack',
  'navigateForward',
  'navigateTo',
  'navigateToFriend',
  'pinFriend',
  'reorderPinnedFriends',
];

const Sidebar = React.memo(function Sidebar(props) {
  const {
    activateListenAlong,
    activeView,
    addToPlaylistPanel,
    cacheLoaded,
    collectionDropHighlight,
    currentFriend,
    deactivateListenAlong,
    discoveryUnread,
    draggingTrackForPlaylist,
    forwardHistory,
    friendDragOverSidebar,
    friendEntryRefs,
    friends,
    friendsObserverRef,
    getAlbumArt,
    handleCollectionDrop,
    handlePlay,
    handlePlaylistDrop,
    isOnAir,
    listenAlongFriend,
    loadCharts,
    loadCriticsPicks,
    loadNewReleases,
    loadTopTracks,
    movedFriendIds,
    navigateBack,
    navigateForward,
    navigateTo,
    navigateToFriend,
    newlyPinnedFriendIds,
    pinFriend,
    pinnedFriendIds,
    playlistDropHighlight,
    reorderPinnedFriends,
    selectedPlaylist,
    setAddFriendModalOpen,
    setAddToPlaylistPanel,
    setCollectionDropHighlight,
    setFriendDragOverSidebar,
    setPlaylistDropHighlight,
    setQueueWithContext,
    setSelectedPlaylistsForAdd,
    showDiscoveryBadges,
    sidebarBadges,
    sidebarFriendsSortRef,
    trackSourcesCache,
    viewHistory,
  } = props;
  // The sidebar item a playlist page belongs to. An ephemeral playlist (a
  // recommended or weekly one, not saved) opens from Recommendations, so it
  // keeps Recommendations lit, as its breadcrumb says; your own playlists keep
  // Playlists lit.
  const viewingRecommendedPlaylist = activeView === 'playlist-view' && !!selectedPlaylist?.isEphemeral;
  const playlistsNavActive = activeView === 'playlists' || (activeView === 'playlist-view' && !viewingRecommendedPlaylist);
  const recommendationsNavActive = activeView === 'recommendations' || viewingRecommendedPlaylist;
  return React.createElement('nav', {
        'aria-label': 'Main',
        className: 'w-64 bg-surface-subtle border-r border-line flex flex-col no-drag',
        onDragOver: (e) => {
          // Show Add to Playlist panel when dragging a track over sidebar
          if (draggingTrackForPlaylist && !addToPlaylistPanel.open) {
            e.preventDefault();
            setAddToPlaylistPanel({
              open: true,
              tracks: [draggingTrackForPlaylist],
              sourceName: draggingTrackForPlaylist.title,
              sourceType: 'track'
            });
            setSelectedPlaylistsForAdd([]);
          }
        }
      },
        // Title bar spacer (macOS only — provides space for traffic lights and draggable area)
        isMac && React.createElement('div', {
          className: 'h-8 flex-shrink-0 drag'
        }),
        // Navigation arrows
        React.createElement('div', {
          className: 'flex items-center gap-2 px-4 pb-2'
        },
          React.createElement(Tooltip, { content: 'Back', position: 'bottom' },
            React.createElement(Button, { variant: 'icon', size: 'sm', 'aria-label': 'Back', onClick: navigateBack, disabled: viewHistory.length <= 1 }, React.createElement(Icons.ChevronLeft, { className: 'w-4 h-4' }))
          ),
          React.createElement(Tooltip, { content: 'Forward', position: 'bottom' },
            React.createElement(Button, { variant: 'icon', size: 'sm', 'aria-label': 'Forward', onClick: navigateForward, disabled: forwardHistory.length === 0 }, React.createElement(Icons.ChevronRight, { className: 'w-4 h-4' }))
          )
        ),

        // Search - navigates to search page (styled as search box)
        React.createElement('div', {
          style: {
            padding: '4px 8px 12px',
            borderBottom: '1px solid var(--border-subtle)'
          }
        },
          React.createElement(NavSearch, { active: activeView === 'search', onClick: () => navigateTo('search') })
        ),

        // Scrollable navigation area
        React.createElement('div', { className: 'flex-1 overflow-y-auto scrollable-content px-2 py-2' },
          // The sidebar's page links (components/nav-item.js).
          React.createElement(NavItem, { page: 'home', label: 'Home', icon: Icons[PAGE_ICONS['home']], prominent: true, active: activeView === 'home', onClick: () => navigateTo('home') }),

          // YOUR MUSIC section
          React.createElement('div', { className: 'mb-4' },
            React.createElement('div', {
              style: {
                padding: '8px 12px',
                fontSize: '11px',
                fontWeight: '600',
                color: 'var(--text-tertiary)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em'
              }
            }, 'Your Music'),
            React.createElement(NavItem, {
              page: 'playlists', label: 'Playlists', icon: Icons[PAGE_ICONS['playlists']], active: playlistsNavActive,
              onClick: () => navigateTo('playlists'), count: sidebarBadges.playlists || 0, dropHighlight: playlistDropHighlight,
              dropProps: {
                onDragOver: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; },
                onDragEnter: (e) => { e.preventDefault(); setPlaylistDropHighlight(true); },
                onDragLeave: (e) => { e.preventDefault(); setPlaylistDropHighlight(false); },
                onDrop: handlePlaylistDrop
              }
            }),
            React.createElement(NavItem, {
              page: 'library', label: 'Collection', icon: Icons[PAGE_ICONS['library']], active: activeView === 'library',
              onClick: () => navigateTo('library'), count: sidebarBadges.collection || 0, dropHighlight: collectionDropHighlight,
              dropProps: {
                onDragOver: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; },
                onDragEnter: (e) => { e.preventDefault(); setCollectionDropHighlight(true); },
                onDragLeave: (e) => { e.preventDefault(); setCollectionDropHighlight(false); },
                onDrop: handleCollectionDrop
              }
            }),
            React.createElement(NavItem, { page: 'history', label: 'History', icon: Icons[PAGE_ICONS['history']], active: activeView === 'history', onClick: () => { navigateTo('history'); loadTopTracks(); } })
          ),

          // DISCOVER section
          React.createElement('div', { className: 'mb-4' },
            React.createElement('div', {
              style: {
                padding: '8px 12px',
                fontSize: '11px',
                fontWeight: '600',
                color: 'var(--text-tertiary)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em'
              }
            }, 'Discover'),
            React.createElement(NavItem, { page: 'new-releases', label: 'Fresh Drops', icon: Icons[PAGE_ICONS['new-releases']], active: activeView === 'new-releases', unread: !!(showDiscoveryBadges && discoveryUnread.newReleases), onClick: () => { navigateTo('new-releases'); loadNewReleases(); } }),
            React.createElement(NavItem, { page: 'recommendations', label: 'Recommendations', icon: Icons[PAGE_ICONS['recommendations']], active: recommendationsNavActive, unread: !!(showDiscoveryBadges && discoveryUnread.recommendations), onClick: () => navigateTo('recommendations') }),
            React.createElement(NavItem, { page: 'discover', label: 'Pop of the Tops', icon: Icons[PAGE_ICONS['discover']], active: activeView === 'discover', unread: !!(showDiscoveryBadges && discoveryUnread.charts),
              // Only call loadCharts if cache is ready; useEffect will handle it otherwise
              onClick: () => { navigateTo('discover'); if (cacheLoaded) loadCharts(); } }),
            React.createElement(NavItem, { page: 'critics-picks', label: 'Critical Darlings', icon: Icons[PAGE_ICONS['critics-picks']], active: activeView === 'critics-picks', unread: !!(showDiscoveryBadges && discoveryUnread.criticsPicks), onClick: () => { navigateTo('critics-picks'); loadCriticsPicks(); } }),
            React.createElement(NavItem, { page: 'concerts', label: 'Concerts', icon: Icons[PAGE_ICONS['concerts']], active: activeView === 'concerts', unread: !!(showDiscoveryBadges && discoveryUnread.concerts), onClick: () => navigateTo('concerts') })
          ),

          // FRIENDS section (always visible so new users can discover and add friends)
          React.createElement('div', {
            className: 'rounded-lg transition-colors',
            style: friendDragOverSidebar ? {
              backgroundColor: 'var(--accent-primary-alpha-06)',
              boxShadow: 'inset 0 0 0 2px var(--accent-primary-alpha-50)'
            } : {},
            onDragOver: (e) => {
              if (e.dataTransfer.types.includes('friendid')) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                setFriendDragOverSidebar(true);
              }
            },
            onDragLeave: (e) => {
              // Only reset if leaving the section entirely
              if (!e.currentTarget.contains(e.relatedTarget)) {
                setFriendDragOverSidebar(false);
              }
            },
            onDrop: (e) => {
              e.preventDefault();
              setFriendDragOverSidebar(false);
              const friendId = e.dataTransfer.getData('friendId');
              if (friendId && !pinnedFriendIds.includes(friendId)) {
                pinFriend(friendId);
              }
            }
          },
          React.createElement('div', { className: 'flex items-center justify-between', style: { padding: '8px 12px' } },
            React.createElement('span', {
              style: {
                fontSize: '11px',
                fontWeight: '600',
                color: 'var(--text-tertiary)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em'
              }
            }, 'Friends'),
            React.createElement('button', {
              onClick: (e) => { e.stopPropagation(); setAddFriendModalOpen(true); },
              className: 'w-4 h-4 flex items-center justify-center text-ink-tertiary hover:text-ink-secondary transition-colors rounded hover:bg-surface-hover',
              'aria-label': 'Add friend', 'data-tooltip': 'Add friend'
            },
              React.createElement(Icons.Plus, { className: 'w-3 h-3' })
            )
          ),
          // Show drop hint when dragging but no friends pinned yet
          friendDragOverSidebar && pinnedFriendIds.length === 0 && React.createElement('div', {
            className: 'px-3 py-4 text-sm text-accent text-center'
          }, 'Drop to pin'),
          // Sort pinned friends: active (on-air) friends first, then by original order
          // Use stable sort cache so sidebar only reorders when a friend starts a new song
          (() => {
            const sidebarFingerprint = pinnedFriendIds.map(id => {
              const f = friends.find(fr => fr.id === id);
              const track = f?.cachedRecentTrack;
              return `${id}:${track?.name || ''}:${track?.artist || ''}`;
            }).join('|');
            let sortedIds;
            if (sidebarFingerprint !== sidebarFriendsSortRef.current.fingerprint) {
              sortedIds = [...pinnedFriendIds].sort((a, b) => {
                const friendA = friends.find(f => f.id === a);
                const friendB = friends.find(f => f.id === b);
                const aOnAir = friendA && isOnAir(friendA);
                const bOnAir = friendB && isOnAir(friendB);
                if (aOnAir && !bOnAir) return -1;
                if (!aOnAir && bOnAir) return 1;
                return 0;
              });
              sidebarFriendsSortRef.current = { fingerprint: sidebarFingerprint, sorted: sortedIds };
            } else {
              sortedIds = sidebarFriendsSortRef.current.sorted;
            }
            return sortedIds;
          })().map((friendId, index) => {
            const friend = friends.find(f => f.id === friendId);
            if (!friend) return null;
            const onAir = isOnAir(friend);
            const isSelected = activeView === 'friendHistory' && currentFriend?.id === friend.id;

            const isNewlyPinned = newlyPinnedFriendIds.has(friend.id);
            const wasMoved = movedFriendIds.has(friend.id);

            return React.createElement(CardButton, { label: friend.displayName,
              key: friend.id,
              ref: (el) => {
                if (el) {
                  friendEntryRefs.current.set(friend.id, el);
                  if (friendsObserverRef.current) {
                    friendsObserverRef.current.observe(el);
                  }
                } else {
                  friendEntryRefs.current.delete(friend.id);
                }
              },
              'data-friend-id': friend.id,
              className: `px-3 py-1 rounded cursor-pointer group transition-colors flex items-center ${isNewlyPinned ? 'friend-entry' : ''} ${wasMoved ? 'friend-moved' : ''}`,
              style: {
                height: '56px',
                backgroundColor: isSelected ? 'var(--hover-bg-default)' : 'transparent',
                color: isSelected ? 'var(--text-primary)' : 'inherit'
              },
              draggable: true,
              onActivate: () => navigateToFriend(friend),
              onDragStart: (e) => {
                e.dataTransfer.setData('draggedFriendId', friend.id);
                e.dataTransfer.effectAllowed = 'move';
              },
              onDragOver: (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
              },
              onDrop: (e) => {
                e.preventDefault();
                const draggedFriendId = e.dataTransfer.getData('draggedFriendId');
                if (draggedFriendId && draggedFriendId !== friend.id) {
                  reorderPinnedFriends(draggedFriendId, friend.id);
                }
              },
              onContextMenu: (e) => {
                e.preventDefault();
                if (window.electron?.contextMenu?.showTrackMenu) {
                  window.showItemMenu({
                    type: 'friend',
                    friend: friend,
                    isPinned: true,
                    isSavedToCollection: friend.savedToCollection,
                    isOnAir: onAir,
                    isListeningAlong: listenAlongFriend?.id === friend.id
                  });
                }
              }
            },
              React.createElement('div', { className: 'flex items-center gap-2' },
                // Hexagonal avatar with on-air indicator
                React.createElement('button', { type: 'button', 'aria-label': `Open ${friend.displayName}`,
                  className: 'relative flex-shrink-0',
                  onClick: (e) => {
                    e.stopPropagation();
                    navigateToFriend(friend);
                  }
                },
                  // Their photo, or their initial on the avatar gradient
                  // (components/friend-avatar.js), as on their profile page.
                  React.createElement(FriendAvatar, { name: friend.displayName, avatarUrl: friend.avatarUrl, size: 'sm' }),
                  // On-air indicator dot
                  onAir && React.createElement('div', {
                    // ListenerCard's on-air colour.
                    className: 'absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2',
                    style: { borderColor: 'var(--bg-secondary)', backgroundColor: 'var(--success)' }
                  })
                ),
                // Name and track info
                React.createElement('div', { className: 'flex-1 min-w-0' },
                  // Friend name with listen-along toggle
                  React.createElement('div', { className: 'flex items-center gap-1' },
                    React.createElement('span', {
                      className: 'text-sm text-ink-secondary truncate'
                    }, friend.displayName),
                    // Listen along toggle - only show when friend is on-air
                    // Hidden by default, show on hover OR when actively listening along
                    onAir && React.createElement(Tooltip, {
                      content: listenAlongFriend?.id === friend.id ? 'Stop listening along' : 'Listen along',
                      position: 'top',
                      variant: 'light'
                    },
                      React.createElement(Button, { variant: 'icon', size: 'sm',
                        // 32px tall beside a 20px name: the negative margin keeps
                        // it from pushing the now-playing pill 12px down.
                        style: { margin: '-6px 0' }, className: `flex-shrink-0 ${listenAlongFriend?.id === friend.id ? '!text-accent hover:!bg-accent-tint' : 'opacity-0 group-hover:opacity-100 card-reveal'}`, 'aria-label': listenAlongFriend?.id === friend.id ? 'Stop listening along' : 'Listen along', onClick: (e) => {
                          e.stopPropagation();
                          if (listenAlongFriend?.id === friend.id) {
                            deactivateListenAlong();
                          } else {
                            activateListenAlong(friend);
                          }
                        } }, React.createElement(Icons.Headphones, { className: 'w-4 h-4', strokeWidth: 2 }))
                    ) // Close Tooltip
                  ),
                  // Mini playbar showing friend's current track
                  onAir && friend.cachedRecentTrack && React.createElement(FriendMiniPlaybar, {
                    track: friend.cachedRecentTrack,
                    getAlbumArt: getAlbumArt,
                    onPlay: (e) => {
                      e.stopPropagation();
                      // Get cached sources for instant playback
                      const cacheKey = `${friend.cachedRecentTrack.artist.toLowerCase()}|${friend.cachedRecentTrack.name.toLowerCase()}`;
                      const cachedSources = trackSourcesCache.current[cacheKey]?.sources || {};
                      const track = {
                        title: friend.cachedRecentTrack.name,
                        artist: friend.cachedRecentTrack.artist,
                        album: friend.cachedRecentTrack.album,
                        albumArt: friend.cachedRecentTrack.albumArt,
                        sources: cachedSources
                      };
                      // Clear queue and play (like clicking any other track)
                      setQueueWithContext([], { type: 'friend-track', name: `${friend.displayName}'s track` });
                      handlePlay(track);
                    },
                    onContextMenu: (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (window.electron?.contextMenu?.showTrackMenu) {
                        // Get cached sources for context menu actions too
                        const cacheKey = `${friend.cachedRecentTrack.artist.toLowerCase()}|${friend.cachedRecentTrack.name.toLowerCase()}`;
                        const cachedSources = trackSourcesCache.current[cacheKey]?.sources || {};
                        window.showItemMenu({
                          type: 'friend-track',
                          track: {
                            title: friend.cachedRecentTrack.name,
                            artist: friend.cachedRecentTrack.artist,
                            album: friend.cachedRecentTrack.album,
                            albumArt: friend.cachedRecentTrack.albumArt,
                            sources: cachedSources
                          }
                        });
                      }
                    }
                  })
                )
              )
            );
          })
          ),

          // Empty state hint for Friends when no friends pinned but friends exist
          friends.length > 0 && pinnedFriendIds.length === 0 && !friendDragOverSidebar && React.createElement('div', {
            className: 'rounded-lg transition-colors',
            onDragOver: (e) => {
              if (e.dataTransfer.types.includes('friendid')) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                setFriendDragOverSidebar(true);
              }
            },
            onDragLeave: () => setFriendDragOverSidebar(false),
            onDrop: (e) => {
              e.preventDefault();
              setFriendDragOverSidebar(false);
              const friendId = e.dataTransfer.getData('friendId');
              if (friendId && !pinnedFriendIds.includes(friendId)) {
                pinFriend(friendId);
              }
            }
          },
            React.createElement('div', { className: 'px-3 py-2 text-xs font-semibold text-ink-tertiary uppercase tracking-wider' }, 'Friends'),
            React.createElement('div', { className: 'px-3 py-2 text-xs text-ink-tertiary italic' }, 'Drag friends here to pin')
          )
        ),

        // Settings button at bottom of sidebar - styled to match Search
        React.createElement('div', {
          style: {
            padding: '12px 16px 16px',
            borderTop: '1px solid var(--border-subtle)'
          }
        },
          React.createElement('button', {
            className: 'w-full flex items-center gap-2 cursor-pointer transition-colors',
            style: {
              color: activeView === 'settings' ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: activeView === 'settings' ? '500' : '400'
            },
            onClick: () => navigateTo('settings')
          },
            React.createElement(Icons[PAGE_ICONS.settings], { className: 'w-4 h-4' }),
            React.createElement('span', {
              style: {
                fontSize: '11px',
                fontWeight: '600',
                textTransform: 'uppercase',
                letterSpacing: '0.08em'
              }
            }, 'Settings')
          )
        )
      );
});

module.exports = { Sidebar, SIDEBAR_HANDLERS };
