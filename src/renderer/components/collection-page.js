// src/renderer/components/collection-page.js — the Collection page
// (Library view: Songs, Albums, Artists, Friends tabs), moved out of the
// Parachord component (maintainability plan Track 2b, first state-domain
// slice; performance item: every setState in Parachord re-rendered the whole
// tree, including this ~1,200-line page while it was on screen).
//
// React.memo: it re-renders only when one of its props changes. That only
// works because every prop is stable unless its data changed: state values,
// useState setters, refs, useCallback/useMemo results, and the plain
// functions Parachord recreates on every render, which come in as stable
// wrappers (useStableHandlers in app.js; the list is COLLECTION_PAGE_HANDLERS).
// A new prop must be one of those, or the memo silently stops helping
// (tests/renderer/collection-page.test.js checks the call site).
//
// The body is the original render expression, unchanged: it reads its inputs
// from props under their old names.

const { VirtualizedTrackList, getBestSourceConfidence } = require('./track-lists');
const { ResolverIcon } = require('./ui-atoms');
const { CollectionArtistCard, CollectionAlbumCard } = require('./cards');

// Plain functions from Parachord, passed as stable wrappers.
const COLLECTION_PAGE_HANDLERS = [
  'addToQueue',
  'copyParachordLink',
  'fetchArtistData',
  'getAlbumArt',
  'getArtistImage',
  'getArtistTopTracks',
  'getCollectionSortOptions',
  'handleCollectionAlbumClick',
  'handlePlay',
  'handlePlaylistDragEnd',
  'handleStartCollectionStation',
  'isOnAir',
  'navigateToFriend',
  'openChartsAlbum',
  'openSyncSetupModal',
  'setQueueWithContext',
  'syncFriendsFromServices',
];

const CollectionPage = React.memo(function CollectionPage(props) {
  const {
    activeResolvers,
    addToQueue,
    allResolvers,
    autoPinnedFriendIds,
    collectionData,
    collectionHeaderCollapsed,
    collectionLoading,
    collectionObserverRef,
    collectionScrollContainerRef,
    collectionSearch,
    collectionSearchOpen,
    collectionSongsSorted,
    collectionSort,
    collectionSortDropdownOpen,
    collectionTab,
    collectionTrackRowRefs,
    copyParachordLink,
    currentTrack,
    fetchArtistData,
    filterCollectionItems,
    formatTime,
    friendSyncInProgress,
    friends,
    getAlbumArt,
    getArtistImage,
    getArtistTopTracks,
    getCollectionSortOptions,
    handleCollectionAlbumClick,
    handleCollectionScrollContainerRef,
    handlePlay,
    handlePlaylistDragEnd,
    handleStartCollectionStation,
    isOnAir,
    isPlaying,
    library,
    libraryLoading,
    metaServiceConfigs,
    navigateToFriend,
    openChartsAlbum,
    openSyncSetupModal,
    pinnedFriendIds,
    playbackContext,
    resolverOrder,
    resolverSyncSettings,
    setAddFriendModalOpen,
    setAddToPlaylistPanel,
    setCollectionHeaderCollapsed,
    setCollectionSearch,
    setCollectionSearchOpen,
    setCollectionSort,
    setCollectionSortDropdownOpen,
    setCollectionTab,
    setDraggingTrackForPlaylist,
    setQueueWithContext,
    setSyncMenuOpen,
    setSyncStatusModal,
    setTrackLoading,
    showToast,
    sortCollectionItems,
    syncFriendsFromServices,
    syncMenuOpen,
    syncProviderConfig,
    syncStatus,
    trackSources,
  } = props;
  return React.createElement('div', {
          className: 'flex-1 flex flex-col h-full',
          style: { overflow: 'hidden', minHeight: 0 }
        },
          // Header section (outside scrollable area)
          React.createElement('div', {
            className: 'relative',
            style: {
              height: collectionHeaderCollapsed ? '80px' : '320px',
              flexShrink: 0,
              transition: 'height 300ms cubic-bezier(0.4, 0, 0.2, 1)',
              overflow: 'hidden',
              willChange: 'height',
              contain: 'layout style'
            }
          },
              // Gradient background
              React.createElement('div', {
                className: 'absolute inset-0 bg-gradient-to-br from-cyan-500 via-cyan-600 to-blue-700'
              }),
              // Vinyl pattern overlay
              React.createElement('div', {
                className: 'absolute inset-0',
                style: {
                  opacity: 0.08,
                  backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'%23ffffff\'%3E%3Ccircle cx=\'30\' cy=\'30\' r=\'20\' fill=\'none\' stroke=\'%23fff\' stroke-width=\'2\'/%3E%3Ccircle cx=\'30\' cy=\'30\' r=\'12\' fill=\'none\' stroke=\'%23fff\' stroke-width=\'1\'/%3E%3Ccircle cx=\'30\' cy=\'30\' r=\'4\'/%3E%3C/g%3E%3C/svg%3E")'
                }
              }),
              // EXPANDED STATE - Centered content
            !collectionHeaderCollapsed && React.createElement('div', {
              className: 'absolute inset-0 flex flex-col items-center justify-center text-center px-6 z-10',
              style: {
                opacity: collectionHeaderCollapsed ? 0 : 1,
                transition: 'opacity 300ms ease-out'
              }
            },
                // Title
                React.createElement('h1', {
                  className: 'text-5xl font-light text-white',
                  style: {
                    textShadow: '0 2px 20px rgba(0,0,0,0.5)',
                    letterSpacing: '0.3em',
                    textTransform: 'uppercase'
                  },
                  onContextMenu: copyParachordLink
                }, 'COLLECTION'),
                // Stats row as tabs (matching Artist page styling)
                React.createElement('div', {
                  className: 'flex items-center gap-1 mt-6',
                  style: { textShadow: '0 1px 10px rgba(0,0,0,0.5)' }
                },
                  [
                    { key: 'artists', label: collectionLoading ? null : `${collectionData.artists.length} Artists`, staticLabel: 'Artists' },
                    { key: 'albums', label: collectionLoading ? null : `${collectionData.albums.length} Albums`, staticLabel: 'Albums' },
                    { key: 'tracks', label: collectionLoading ? null : `${library.length + collectionData.tracks.length} Songs`, staticLabel: 'Songs' },
                    { key: 'friends', label: `${friends.length} Friends`, staticLabel: 'Friends' }
                  ].map((tab, index) => [
                    index > 0 && React.createElement('span', {
                      key: `sep-expanded-${tab.key}`,
                      className: 'text-white/50 mx-2'
                    }, '|'),
                    React.createElement('button', {
                      key: `expanded-${tab.key}`,
                      onClick: () => setCollectionTab(tab.key),
                      className: `px-2 py-1 text-sm font-medium uppercase tracking-wider transition-colors no-drag ${
                        collectionTab === tab.key
                          ? 'text-white'
                          : 'text-white/60 hover:text-white'
                      }`
                    }, tab.label !== null ? tab.label : React.createElement('span', { className: 'flex items-center gap-1' },
                      React.createElement('span', { className: 'inline-block w-6 h-4 bg-white/30 rounded animate-pulse' }),
                      tab.staticLabel
                    ))
                  ]).flat().filter(Boolean)
                ),
                // Buttons row
                React.createElement('div', {
                  className: 'mt-6 flex items-center gap-3'
                },
                  // Start Collection Station button (pink, matching Artist page)
                  React.createElement('button', {
                    onClick: handleStartCollectionStation,
                    className: 'px-6 py-2 rounded-full font-medium text-white no-drag transition-all hover:scale-105',
                    style: {
                      backgroundColor: '#E91E63',
                      boxShadow: '0 4px 15px rgba(233, 30, 99, 0.4)'
                    }
                  }, 'Start Collection Radio')
                )
              ),
            // COLLAPSED STATE - Inline layout matching Recommendations
            collectionHeaderCollapsed && React.createElement('div', {
              className: 'absolute inset-0 flex items-center px-6 z-10',
              style: {
                opacity: collectionHeaderCollapsed ? 1 : 0,
                transition: 'opacity 300ms ease-out'
              }
            },
                // Left: Title
                React.createElement('h1', {
                  className: 'text-2xl font-light text-white mr-6',
                  style: {
                    textShadow: '0 2px 10px rgba(0,0,0,0.5)',
                    letterSpacing: '0.2em',
                    textTransform: 'uppercase'
                  },
                  onContextMenu: copyParachordLink
                }, 'COLLECTION'),
                // Tabs (next to title, like artist page)
                React.createElement('div', {
                  className: 'flex items-center gap-1',
                  style: { textShadow: '0 1px 10px rgba(0,0,0,0.5)' }
                },
                  [
                    { key: 'artists', label: collectionLoading ? null : `${collectionData.artists.length} Artists`, staticLabel: 'Artists' },
                    { key: 'albums', label: collectionLoading ? null : `${collectionData.albums.length} Albums`, staticLabel: 'Albums' },
                    { key: 'tracks', label: collectionLoading ? null : `${library.length + collectionData.tracks.length} Songs`, staticLabel: 'Songs' },
                    { key: 'friends', label: `${friends.length} Friends`, staticLabel: 'Friends' }
                  ].map((tab, index) => [
                    index > 0 && React.createElement('span', {
                      key: `sep-collapsed-${tab.key}`,
                      className: 'text-white/50 mx-2'
                    }, '|'),
                    React.createElement('button', {
                      key: `collapsed-${tab.key}`,
                      onClick: () => setCollectionTab(tab.key),
                      className: `px-2 py-1 text-sm font-medium uppercase tracking-wider transition-colors no-drag ${
                        collectionTab === tab.key
                          ? 'text-white'
                          : 'text-white/60 hover:text-white'
                      }`
                    }, tab.label !== null ? tab.label : React.createElement('span', { className: 'flex items-center gap-1' },
                      React.createElement('span', { className: 'inline-block w-6 h-4 bg-white/30 rounded animate-pulse' }),
                      tab.staticLabel
                    ))
                  ]).flat().filter(Boolean)
                ),
                // Right: Start Collection Station button
                React.createElement('button', {
                  onClick: handleStartCollectionStation,
                  className: 'ml-auto px-4 py-1.5 rounded-full text-sm font-medium text-white transition-colors hover:opacity-90 no-drag',
                  style: {
                    backgroundColor: '#E91E63'
                  }
                }, 'Start Radio')
              )
          ),
          // Filter bar — promoted out of scroll container so the virtualized
          // collection-tracks list inside can be a direct child of the
          // scroll element at scrollTop=0, eliminating the scrollMargin
          // offset class of bug. See issue #781.
          React.createElement('div', {
            className: 'flex items-center px-6 py-3',
            style: { backgroundColor: 'var(--bg-primary)', borderBottom: '1px solid var(--border-default)' }
          },
            // Sort dropdown (moved to left)
            React.createElement('div', { className: 'relative' },
              React.createElement('button', {
                onClick: (e) => { e.stopPropagation(); setCollectionSortDropdownOpen(!collectionSortDropdownOpen); },
                className: 'flex items-center gap-1 px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors'
              },
                React.createElement('span', null, getCollectionSortOptions(collectionTab).find(o => o.value === collectionSort[collectionTab])?.label || 'Sort'),
                React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                  React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M19 9l-7 7-7-7' })
                )
              ),
              // Dropdown menu
              collectionSortDropdownOpen && React.createElement('div', {
                className: 'absolute left-0 top-full mt-1 bg-white rounded-lg shadow-lg py-1 min-w-[160px] z-30 border border-gray-200'
              },
                getCollectionSortOptions(collectionTab).map(option =>
                  React.createElement('button', {
                    key: option.value,
                    onClick: (e) => {
                      e.stopPropagation();
                      setCollectionSort(prev => ({ ...prev, [collectionTab]: option.value }));
                      setCollectionSortDropdownOpen(false);
                    },
                    className: `w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center justify-between ${
                      collectionSort[collectionTab] === option.value ? 'text-gray-900 font-medium' : 'text-gray-600'
                    }`
                  },
                    option.label,
                    collectionSort[collectionTab] === option.value && React.createElement('svg', {
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
            // Spacer
            React.createElement('div', { className: 'flex-1' }),
            // Search toggle/field
            React.createElement('div', { className: 'flex items-center' },
              collectionSearchOpen ?
                React.createElement('div', { className: 'flex items-center border border-gray-300 rounded-full px-3 py-[5px] filter-pill' },
                  React.createElement('input', {
                    type: 'text',
                    value: collectionSearch,
                    onChange: (e) => setCollectionSearch(e.target.value),
                    onBlur: () => {
                      if (!collectionSearch.trim()) {
                        setCollectionSearchOpen(false);
                      }
                    },
                    autoFocus: true,
                    placeholder: 'Filter...',
                    className: 'bg-transparent text-gray-700 text-sm placeholder-gray-400 outline-none',
                    style: { width: '150px' }
                  }),
                  collectionSearch && React.createElement('button', {
                    onClick: () => {
                      setCollectionSearch('');
                      setCollectionSearchOpen(false);
                    },
                    className: 'ml-2 text-gray-400 hover:text-gray-600'
                  },
                    React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M6 18L18 6M6 6l12 12' })
                    )
                  )
                )
              :
                React.createElement('button', {
                  onClick: () => setCollectionSearchOpen(true),
                  className: 'p-1.5 text-gray-400 hover:text-gray-600 transition-colors'
                },
                  React.createElement('svg', { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
                  )
                )
            ),
            // Sync Collection button with provider dropdown (hide on friends tab)
            collectionTab !== 'friends' && React.createElement('div', {
              style: { position: 'relative', marginLeft: '12px' }
            },
              React.createElement('button', {
                onClick: () => setSyncMenuOpen(!syncMenuOpen),
                className: 'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5',
                style: {
                  backgroundColor: Object.values(resolverSyncSettings).some(s => s?.enabled) ? '#06b6d4' : 'var(--nav-inactive)',
                  color: '#ffffff',
                  border: 'none',
                  cursor: 'pointer'
                },
                title: 'Sync your music library'
              },
                React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                  React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M20 4v5h-.582m-15.356 2A8.001 8.001 0 0119.418 9m0 0H15m-11 11v-5h.581m0 0a8.003 8.003 0 0015.357-2m-15.357 2H9' })
                ),
                Object.values(resolverSyncSettings).some(s => s?.enabled) ? 'Synced' : 'Sync',
                React.createElement('svg', { className: 'w-3 h-3', style: { marginLeft: '2px', opacity: 0.8 }, fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                  React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2.5, d: 'M19 9l-7 7-7-7' })
                )
              ),
              // Provider dropdown menu
              syncMenuOpen && React.createElement('div', {
                style: {
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: '4px',
                  width: '200px',
                  backgroundColor: 'var(--card-bg)',
                  borderRadius: '12px',
                  boxShadow: '0 10px 25px rgba(0, 0, 0, 0.15)',
                  border: '1px solid var(--border-subtle)',
                  zIndex: 50,
                  overflow: 'hidden'
                }
              },
                // Sync status + "Sync Now" (parachord#1009). The Library Sync
                // modal has existed since 2026-01 but nothing opened it, so the
                // only full sync a user could trigger was the wizard's Start Sync.
                Object.values(resolverSyncSettings).some(s => s?.enabled) && React.createElement('button', {
                  key: 'sync-status',
                  onClick: () => { setSyncMenuOpen(false); setSyncStatusModal({ open: true }); },
                  style: {
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px 14px',
                    fontSize: '13px',
                    fontWeight: '500',
                    color: 'var(--text-primary)',
                    backgroundColor: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid var(--border-subtle)',
                    cursor: 'pointer',
                    transition: 'background-color 100ms ease'
                  },
                  onMouseEnter: (e) => e.currentTarget.style.backgroundColor = 'var(--hover-bg-default)',
                  onMouseLeave: (e) => e.currentTarget.style.backgroundColor = 'transparent'
                },
                  React.createElement('div', {
                    style: {
                      width: '28px', height: '28px', borderRadius: '8px',
                      backgroundColor: '#06b6d4',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0
                    }
                  },
                    React.createElement('svg', { style: { width: '16px', height: '16px' }, fill: 'none', viewBox: '0 0 24 24', stroke: '#ffffff' },
                      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15' })
                    )
                  ),
                  Object.values(syncStatus).some(s => s?.inProgress) ? 'Syncing…' : 'Sync status & Sync Now'
                ),
                Object.entries(syncProviderConfig).map(([pid, config]) =>
                  React.createElement('button', {
                    key: pid,
                    onClick: () => { setSyncMenuOpen(false); openSyncSetupModal(pid); },
                    style: {
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '10px 14px',
                      fontSize: '13px',
                      fontWeight: '500',
                      color: 'var(--text-primary)',
                      backgroundColor: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      transition: 'background-color 100ms ease'
                    },
                    onMouseEnter: (e) => e.currentTarget.style.backgroundColor = 'var(--hover-bg-default)',
                    onMouseLeave: (e) => e.currentTarget.style.backgroundColor = 'transparent'
                  },
                    React.createElement('div', {
                      style: {
                        width: '28px', height: '28px', borderRadius: '8px',
                        backgroundColor: config.color,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0
                      }
                    },
                      React.createElement('svg', {
                        style: { width: '16px', height: '16px' },
                        viewBox: pid === 'spotify' ? '0 0 24 24' : pid === 'listenbrainz' ? '0 0 146 160' : '0 0 122.88 122.88',
                        fill: '#ffffff'
                      },
                        pid === 'spotify'
                          ? React.createElement('path', { d: 'M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z' })
                          : pid === 'listenbrainz'
                          ? [
                              React.createElement('path', { key: 'r', d: 'm75.354 7.823v144l61-35v-74z' }),
                              React.createElement('path', { key: 'l', d: 'm70.354 7.823-61 35v74l61 35z' })
                            ]
                          : React.createElement('path', { d: 'M47.76,86.16v-38.4c0-1.44,0.8-2.32,2.4-2.64l33.12-6.72c1.76-0.32,2.72,0.48,2.88,2.4v29.28c0,2.4-3.6,4-10.8,4.8c-13.68,2.16-11.52,25.2,7.2,18.96c7.2-2.64,8.4-9.6,8.4-16.56V21.12c0,0,0-4.8-4.08-3.6l-40.8,8.4c0,0-3.12,0.48-3.12,4.32v48.72c0,2.4-3.6,4-10.8,4.8c-13.68,2.16-11.52,25.2,7.2,18.96C46.56,100.08,47.76,93.12,47.76,86.16z' })
                      )
                    ),
                    config.name,
                    resolverSyncSettings[pid]?.enabled && React.createElement('span', {
                      style: {
                        marginLeft: 'auto',
                        width: '8px', height: '8px',
                        borderRadius: '50%',
                        backgroundColor: '#22c55e'
                      }
                    })
                  )
                )
              ),
              // Click-away to close dropdown
              syncMenuOpen && React.createElement('div', {
                style: { position: 'fixed', inset: 0, zIndex: 49 },
                onClick: () => setSyncMenuOpen(false)
              })
            ),
            // Sync friends button in header (only on friends tab).
            // Manually triggers inbound pull from Last.fm + ListenBrainz.
            // Disabled when no credentials exist; shows spinner during fetch.
            collectionTab === 'friends' && (() => {
              const lastfmConfig = metaServiceConfigs.lastfm;
              const listenbrainzConfig = metaServiceConfigs.listenbrainz;
              const hasCreds = !!(lastfmConfig?.username || listenbrainzConfig?.username);
              return React.createElement('button', {
                onClick: () => syncFriendsFromServices({ silent: false }),
                disabled: friendSyncInProgress || !hasCreds,
                title: hasCreds
                  ? 'Sync friends from Last.fm and ListenBrainz'
                  : 'Connect Last.fm or ListenBrainz in Settings to sync friends',
                className: 'ml-3 p-1.5 text-gray-500 hover:text-gray-700 transition-colors',
                style: { opacity: friendSyncInProgress || !hasCreds ? 0.4 : 1, cursor: hasCreds ? 'pointer' : 'not-allowed' }
              },
                friendSyncInProgress
                  ? React.createElement('svg', {
                      className: 'w-5 h-5 animate-spin',
                      fill: 'none', viewBox: '0 0 24 24'
                    },
                      React.createElement('circle', { className: 'opacity-25', cx: '12', cy: '12', r: '10', stroke: 'currentColor', strokeWidth: '4' }),
                      React.createElement('path', { className: 'opacity-75', fill: 'currentColor', d: 'M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z' })
                    )
                  : React.createElement('svg', {
                      className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor'
                    },
                      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15' })
                    )
              );
            })(),
            // Add Friend button in header (only on friends tab)
            collectionTab === 'friends' && React.createElement('button', {
              onClick: () => setAddFriendModalOpen(true),
              className: 'ml-3 px-3 py-1.5 bg-cyan-500 hover:bg-cyan-600 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5'
            },
              React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M12 4v16m8-8H4' })
              ),
              'Add Friend'
            )
          ),

          // Scrollable content area.
          //
          // `contain: strict` is layout-/paint-isolation for the other three
          // tabs (artists/albums/friends) — small perf win for those routes.
          // The tracks tab uses `@tanstack/react-virtual` (see
          // VirtualizedTrackList, parachord#783); `contain: size`
          // interacts poorly with the virtualizer's measurement of
          // `getScrollElement().clientHeight` when the scroll container is
          // `flex-1`-sized inside a flex column. Two prior virtualization
          // attempts (per #783) came up blank for this reason. Conditionally
          // relax to `layout` only when on tracks tab — keeps the isolation
          // benefit for the other tabs without breaking the virtualizer.
          React.createElement('div', {
            ref: handleCollectionScrollContainerRef,
            className: 'flex-1 overflow-y-auto scrollable-content',
            style: collectionTab === 'tracks'
              ? { minHeight: 0 }
              : { minHeight: 0, contain: 'strict' },
            onScroll: (e) => {
              const scrollTop = e.target.scrollTop;
              if (scrollTop > 50 && !collectionHeaderCollapsed) {
                setCollectionHeaderCollapsed(true);
              } else if (scrollTop <= 50 && collectionHeaderCollapsed) {
                setCollectionHeaderCollapsed(false);
              }
            }
          },
            // Tracks tab — direct child of the scroll container (no
            // padding wrapper above) so the eventual virtualized list
            // sees scrollTop=0 cleanly. Other tabs stay inside the p-6
            // wrapper below for their padding.
            collectionTab === 'tracks' && (() => {
              if (libraryLoading || collectionLoading) {
                // Skeleton loaders while loading - matches new rounded row style
                return React.createElement('div', { className: 'space-y-0' },
                  Array.from({ length: 8 }).map((_, index) =>
                    React.createElement('div', {
                      key: `skeleton-${index}`,
                      className: 'flex items-center gap-4 py-3 px-4',
                      style: { borderRadius: '8px', marginBottom: '2px' }
                    },
                      // Track number skeleton
                      React.createElement('div', {
                        className: 'h-3 shimmer-light rounded animate-shimmer',
                        style: { width: '24px', flexShrink: 0 }
                      }),
                      // Title skeleton - flexible
                      React.createElement('div', {
                        className: 'h-3.5 shimmer-light rounded animate-shimmer',
                        style: { flex: '1 1 0', minWidth: 0, animationDelay: '0.1s' }
                      }),
                      // Artist skeleton - flexible
                      React.createElement('div', {
                        className: 'h-3.5 shimmer-light rounded animate-shimmer',
                        style: { flex: '0.7 1 0', minWidth: 0, animationDelay: '0.2s' }
                      }),
                      // Album skeleton - flexible
                      React.createElement('div', {
                        className: 'h-3.5 shimmer-light rounded animate-shimmer',
                        style: { flex: '0.5 1 0', minWidth: 0, animationDelay: '0.3s' }
                      }),
                      // Duration skeleton
                      React.createElement('div', {
                        className: 'h-3 shimmer-light rounded animate-shimmer flex-shrink-0',
                        style: { width: '50px', marginRight: '16px', animationDelay: '0.4s' }
                      }),
                      // Resolver icons skeleton
                      React.createElement('div', {
                        className: 'flex items-center gap-1 justify-end',
                        style: { width: '140px', flexShrink: 0 }
                      },
                        React.createElement('div', {
                          className: 'w-5 h-5 shimmer-light rounded animate-shimmer',
                          style: { animationDelay: '0.5s' }
                        }),
                        React.createElement('div', {
                          className: 'w-5 h-5 shimmer-light rounded animate-shimmer',
                          style: { animationDelay: '0.6s' }
                        })
                      )
                    )
                  )
                );
              }

              // Merged, filtered and sorted once per input change (see
              // collectionSongsSorted), not on every render of the app.
              const sorted = collectionSongsSorted;

              if (sorted.length === 0 && collectionSearch) {
                return React.createElement('div', { className: 'text-center py-12 text-gray-400' },
                  React.createElement('svg', { className: 'w-12 h-12 mx-auto mb-4 text-gray-300', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
                  ),
                  React.createElement('div', { className: 'text-sm' }, 'No tracks match your search')
                );
              }

              if (sorted.length === 0) {
                return React.createElement('div', { className: 'flex-1 flex flex-col items-center justify-center text-gray-400 py-20' },
                  React.createElement('svg', { className: 'w-16 h-16 mb-4 text-gray-300', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3' })
                  ),
                  React.createElement('p', { className: 'text-lg font-medium text-gray-500 mb-2' }, 'No tracks yet'),
                  React.createElement('p', { className: 'text-sm text-gray-400' }, 'Drag tracks here or add local music folders in Settings')
                );
              }

              // Windowed render (parachord#783). Below the virtualization
              // threshold (~100 tracks) the helper falls back to a plain
              // map, so small libraries see no change in DOM shape.
              return React.createElement(VirtualizedTrackList, {
                tracks: sorted,
                parentRef: collectionScrollContainerRef,
                renderRow: (track, index) => {
                  // Merge track.sources (e.g., localfiles) with resolved sources from trackSources state
                  const effectiveSources = Object.fromEntries(
                    Object.entries({ ...(track.sources || {}), ...(trackSources[track.id] || {}) }).filter(([, v]) => v && !v.noMatch)
                  );
                  const isCurrentTrack = currentTrack?.id === track.id || (currentTrack?.filePath && track.filePath && currentTrack.filePath === track.filePath);
                  const isNowPlaying = isCurrentTrack && playbackContext?.type === 'library';
                  const isResolving = Object.keys(effectiveSources).length === 0;

                  return React.createElement('div', {
                    ref: (el) => {
                      if (el) {
                        collectionTrackRowRefs.current.set(track.id, el);
                        // Also observe if observer exists
                        if (collectionObserverRef.current) {
                          collectionObserverRef.current.observe(el);
                        }
                      } else {
                        collectionTrackRowRefs.current.delete(track.id);
                      }
                    },
                    'data-track-id': track.id,
                    key: track.id || track.filePath || index,
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
                    className: `flex items-center gap-4 py-3 px-4 cursor-grab active:cursor-grabbing transition-all no-drag group ${
                      isNowPlaying && isPlaying ? 'bg-cyan-50' : 'hover:bg-gray-50/80'
                    }`,
                    style: {
                      borderRadius: '8px',
                      marginBottom: '2px'
                    },
                    onClick: () => {
                      const tracksAfter = sorted.slice(index + 1);
                      const context = { type: 'library', name: 'Collection' };
                      setQueueWithContext(tracksAfter, context);
                      // Pass track with merged sources (original + resolved) so handlePlay can use all available resolvers
                      handlePlay({ ...track, sources: effectiveSources });
                    },
                    onContextMenu: (e) => {
                      e.preventDefault();
                      if (window.electron?.contextMenu?.showTrackMenu) {
                        // This tab lists local-library tracks too, and those are
                        // not in the collection: claiming they were offered
                        // "Remove from Collection", which could only fail with
                        // "not in your collection" (#1002).
                        const inCollection = collectionData.tracks.some(t => t.id === track.id);
                        window.electron.contextMenu.showTrackMenu({
                          type: 'track',
                          track: track,
                          isInCollection: inCollection,
                          isLibraryTrack: !inCollection && !!(track.filePath || track.sources?.localfiles?.filePath)
                        });
                      }
                    }
                  },
                    // Track number or playing indicator
                    React.createElement('span', {
                      className: 'w-6 flex-shrink-0 text-right',
                      style: {
                        pointerEvents: 'none',
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
                        color: isNowPlaying && isPlaying ? 'var(--accent-primary)' : 'var(--text-primary)'
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
                        fetchArtistData(track.artist);
                      }
                    }, track.artist || 'Unknown Artist'),

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

                    // Resolver icons - fixed width column (last column)
                    React.createElement('div', {
                      className: 'flex items-center gap-1 flex-shrink-0',
                      style: { pointerEvents: 'none', minHeight: '20px', width: '140px', justifyContent: 'flex-end' }
                    },
                      (() => {
                        const sources = effectiveSources;
                        const sourceIds = Object.keys(sources).filter(id => !sources[id]?.noMatch);
                        const hasExternalSources = sourceIds.some(id => id !== 'localfiles');

                        if (hasExternalSources) {
                          // Show resolver icons only for enabled resolvers
                          const bestConf = getBestSourceConfidence(sources);
                          return Object.entries(sources)
                            .filter(([resolverId, v]) => activeResolvers.includes(resolverId) && !v?.noMatch)
                            .sort(([aId], [bId]) => {
                              const aIndex = resolverOrder.indexOf(aId);
                              const bIndex = resolverOrder.indexOf(bId);
                              return aIndex - bIndex;
                            })
                            .map(([resolverId, source]) => {
                              const resolver = allResolvers.find(r => r.id === resolverId);
                              if (!resolver) return null;
                              return React.createElement('button', {
                                key: resolverId,
                                className: 'no-drag',
                                onClick: (e) => {
                                  e.stopPropagation();
                                  const tracksAfter = sorted.slice(index + 1);
                                  const context = { type: 'library', name: 'Collection' };
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
                                  opacity: (source.confidence || 1) < bestConf ? 0.6 : 1,
                                  transition: 'transform 0.1s'
                                },
                                onMouseEnter: (e) => e.currentTarget.style.transform = 'scale(1.1)',
                                onMouseLeave: (e) => e.currentTarget.style.transform = 'scale(1)',
                                title: `Play from ${resolver.name}${source.confidence ? ` (${Math.round(source.confidence * 100)}% match)` : ''}`
                              }, React.createElement(ResolverIcon, { resolverId, size: 12 }));
                            });
                        } else if (isResolving) {
                          // Show shimmer skeletons while resolving (for both local and collection tracks)
                          const localFilesResolver = allResolvers.find(r => r.id === 'localfiles');
                          return React.createElement('div', { className: 'flex items-center gap-1' },
                            // Local files icon for local files
                            track.filePath && localFilesResolver && React.createElement('button', {
                              key: 'localfiles',
                              className: 'no-drag',
                              onClick: (e) => {
                                e.stopPropagation();
                                const tracksAfter = sorted.slice(index + 1);
                                const context = { type: 'library', name: 'Collection' };
                                setQueueWithContext(tracksAfter, context);
                                handlePlay({ ...track, preferredResolver: 'localfiles' });
                              },
                              style: {
                                width: '20px',
                                height: '20px',
                                borderRadius: '4px',
                                backgroundColor: localFilesResolver.color,
                                border: 'none',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                pointerEvents: 'auto',
                                transition: 'transform 0.1s'
                              },
                              onMouseEnter: (e) => e.currentTarget.style.transform = 'scale(1.1)',
                              onMouseLeave: (e) => e.currentTarget.style.transform = 'scale(1)',
                              title: 'Play from Local Files'
                            }, React.createElement(ResolverIcon, { resolverId: 'localfiles', size: 12 })),
                            // Shimmer skeletons
                            React.createElement('div', {
                              className: 'w-5 h-5 rounded shimmer-light animate-shimmer',
                              title: 'Resolving...'
                            }),
                            React.createElement('div', {
                              className: 'w-5 h-5 rounded shimmer-light animate-shimmer',
                              style: { animationDelay: '0.1s' }
                            })
                          );
                        } else if (track.filePath) {
                          // Show just the local files icon for local tracks that finished resolving without finding external sources
                          const localFilesResolver = allResolvers.find(r => r.id === 'localfiles');
                          if (!localFilesResolver) return null;
                          return React.createElement('button', {
                            key: 'localfiles',
                            className: 'no-drag',
                            onClick: (e) => {
                              e.stopPropagation();
                              const tracksAfter = sorted.slice(index + 1);
                              const context = { type: 'library', name: 'Collection' };
                              setQueueWithContext(tracksAfter, context);
                              handlePlay({ ...track, preferredResolver: 'localfiles' });
                            },
                            style: {
                              width: '20px',
                              height: '20px',
                              borderRadius: '4px',
                              backgroundColor: localFilesResolver.color,
                              border: 'none',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              pointerEvents: 'auto',
                              transition: 'transform 0.1s'
                            },
                            onMouseEnter: (e) => e.currentTarget.style.transform = 'scale(1.1)',
                            onMouseLeave: (e) => e.currentTarget.style.transform = 'scale(1)',
                            title: 'Play from Local Files'
                          }, React.createElement(ResolverIcon, { resolverId: 'localfiles', size: 12 }));
                        }
                        return null;
                      })()
                    )
                  );
                }
              });
            })(),

            collectionTab !== 'tracks' && React.createElement('div', { className: 'p-6' },
              // Artists tab
            collectionTab === 'artists' && (() => {
              // Cards will appear with their own shimmer animations when data is ready
              if (collectionLoading) {
                return null;
              }

              const filtered = filterCollectionItems(collectionData.artists, 'artists');
              const sorted = sortCollectionItems(filtered, 'artists');

              if (sorted.length === 0 && collectionSearch) {
                return React.createElement('div', { className: 'flex-1 flex flex-col items-center justify-center text-gray-400 py-20' },
                  React.createElement('p', { className: 'text-lg font-medium text-gray-500' }, 'No artists match your search')
                );
              }

              if (sorted.length === 0) {
                return React.createElement('div', { className: 'flex-1 flex flex-col items-center justify-center text-gray-400 py-20' },
                  React.createElement('svg', { className: 'w-16 h-16 mb-4 text-gray-300', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' })
                  ),
                  React.createElement('p', { className: 'text-lg font-medium text-gray-500 mb-2' }, 'No artists yet'),
                  React.createElement('p', { className: 'text-sm text-gray-400' }, 'Drag artists here to add them to your collection')
                );
              }

              return React.createElement('div', {
                className: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-4 gap-y-5',
                style: { minHeight: 'calc(100vh - 160px)', alignContent: 'start' }  // Ensure enough scroll area to prevent header bounce
              },
                sorted.map((artist, index) =>
                  React.createElement(CollectionArtistCard, {
                    key: artist.name,
                    artist: { ...artist, trackCount: 0 },
                    getArtistImage: getArtistImage,
                    onNavigate: () => fetchArtistData(artist.name),
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
                    animationDelay: Math.min(index * 30, 300)
                  })
                )
              );
            })(),

            // Albums tab
            collectionTab === 'albums' && (() => {
              // Cards will appear with their own shimmer animations when data is ready
              if (collectionLoading) {
                return null;
              }

              const filtered = filterCollectionItems(collectionData.albums, 'albums');
              const sorted = sortCollectionItems(filtered, 'albums');

              if (sorted.length === 0 && collectionSearch) {
                return React.createElement('div', { className: 'flex-1 flex flex-col items-center justify-center text-gray-400 py-20' },
                  React.createElement('p', { className: 'text-lg font-medium text-gray-500' }, 'No albums match your search')
                );
              }

              if (sorted.length === 0) {
                return React.createElement('div', { className: 'flex-1 flex flex-col items-center justify-center text-gray-400 py-20' },
                  React.createElement('svg', { className: 'w-16 h-16 mb-4 text-gray-300', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3' })
                  ),
                  React.createElement('p', { className: 'text-lg font-medium text-gray-500 mb-2' }, 'No albums yet'),
                  React.createElement('p', { className: 'text-sm text-gray-400' }, 'Drag albums here to add them to your collection')
                );
              }

              return React.createElement('div', {
                className: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-4 gap-y-5',
                style: { minHeight: 'calc(100vh - 160px)', alignContent: 'start' }  // Ensure enough scroll area to prevent header bounce
              },
                sorted.map((album, index) =>
                  React.createElement(CollectionAlbumCard, {
                    key: `${album.title}-${album.artist}-${index}`,
                    album: { ...album, trackCount: album.trackCount ?? collectionData.tracks.filter(t => t.artist === album.artist && t.album === album.title).length },
                    getAlbumArt: getAlbumArt,
                    onNavigate: () => handleCollectionAlbumClick(album),
                    onAddToPlaylist: (albumData) => {
                      const albumTracks = collectionData.tracks
                        .filter(t => t.artist === albumData.artist && t.album === albumData.title)
                        .sort((a, b) => (a.trackNumber || 0) - (b.trackNumber || 0));
                      if (albumTracks.length > 0) {
                        setAddToPlaylistPanel({
                          open: true,
                          tracks: albumTracks,
                          sourceName: `${albumData.title} by ${albumData.artist}`,
                          sourceType: 'album'
                        });
                      }
                    },
                    onPlay: (albumData) => {
                      const albumTracks = collectionData.tracks
                        .filter(t => t.artist === albumData.artist && t.album === albumData.title)
                        .sort((a, b) => (a.trackNumber || 0) - (b.trackNumber || 0));
                      if (albumTracks.length > 0) {
                        setTrackLoading(true);
                        const context = { type: 'album', name: albumData.title, artist: albumData.artist };
                        const [firstTrack, ...remainingTracks] = albumTracks;
                        setQueueWithContext(remainingTracks, context, true);
                        handlePlay(firstTrack);
                      }
                    },
                    onAddToQueue: (albumData) => {
                      const albumTracks = collectionData.tracks
                        .filter(t => t.artist === albumData.artist && t.album === albumData.title)
                        .sort((a, b) => (a.trackNumber || 0) - (b.trackNumber || 0));
                      if (albumTracks.length > 0) {
                        addToQueue(albumTracks, { type: 'album', name: albumData.title, artist: albumData.artist });
                        showToast(`Added ${albumTracks.length} tracks from ${albumData.title}`, 'success');
                      }
                    },
                    onContextMenu: (e, albumData) => {
                      const albumTracks = collectionData.tracks
                        .filter(t => t.artist === albumData.artist && t.album === albumData.title)
                        .sort((a, b) => (a.trackNumber || 0) - (b.trackNumber || 0));
                      window.electron?.contextMenu?.showTrackMenu({
                        type: 'collection-album',
                        album: albumData,
                        tracks: albumTracks
                      });
                    },
                    animationDelay: Math.min(index * 30, 300)
                  })
                )
              );
            })(),
            // Friends tab
            collectionTab === 'friends' && (() => {
              // Only show friends saved to collection (savedToCollection !== false for backwards compatibility)
              const savedFriends = friends.filter(f => f.savedToCollection !== false);

              // Sort friends
              const sortedFriends = [...savedFriends].sort((a, b) => {
                const sort = collectionSort.friends;
                if (sort === 'alpha-asc') return a.displayName.localeCompare(b.displayName);
                if (sort === 'alpha-desc') return b.displayName.localeCompare(a.displayName);
                if (sort === 'recent') return b.addedAt - a.addedAt;
                if (sort === 'active') {
                  // Recently Active — sort by last-track timestamp desc.
                  // The 14-day inactivity filter is applied BELOW alongside
                  // the on-air filter so it affects `displayFriends`, not
                  // the intermediate `sortedFriends` used by `hasMatches`.
                  const aTime = a.cachedRecentTrack?.timestamp || 0;
                  const bTime = b.cachedRecentTrack?.timestamp || 0;
                  return bTime - aTime;
                }
                if (sort === 'on-air') {
                  const aOnAir = isOnAir(a);
                  const bOnAir = isOnAir(b);
                  if (aOnAir && !bOnAir) return -1;
                  if (!aOnAir && bOnAir) return 1;
                  // Secondary sort by most recent activity
                  const aTime = a.cachedRecentTrack?.timestamp || 0;
                  const bTime = b.cachedRecentTrack?.timestamp || 0;
                  return bTime - aTime;
                }
                return 0;
              });

              // Filter by search
              const filtered = collectionSearch
                ? sortedFriends.filter(f =>
                    f.displayName.toLowerCase().includes(collectionSearch.toLowerCase()) ||
                    f.username.toLowerCase().includes(collectionSearch.toLowerCase())
                  )
                : sortedFriends;

              // Sort-driven filters:
              //   on-air  → show only friends whose last track is < 10 min old
              //   active  → show only friends with activity in the last 14 days
              //             (mirrors Android's FriendSort.ACTIVE)
              const ACTIVE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
              const activeCutoff = Date.now() - ACTIVE_WINDOW_MS;
              const displayFriends =
                collectionSort.friends === 'on-air'
                  ? filtered.filter(f => isOnAir(f))
                  : collectionSort.friends === 'active'
                    ? filtered.filter(f => (f.cachedRecentTrack?.timestamp || 0) > activeCutoff)
                    : filtered;

              if (displayFriends.length === 0 && collectionSearch) {
                return React.createElement('div', { className: 'flex-1 flex flex-col items-center justify-center text-gray-400 py-20' },
                  React.createElement('p', { className: 'text-lg font-medium text-gray-500' }, 'No friends match your search')
                );
              }

              if (displayFriends.length === 0 && collectionSort.friends === 'on-air') {
                return React.createElement('div', { className: 'flex-1 flex flex-col items-center justify-center text-gray-400 py-20' },
                  React.createElement('svg', { className: 'w-16 h-16 mb-4 text-gray-300', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728m-9.9-2.829a5 5 0 010-7.07m7.072 0a5 5 0 010 7.07M13 12a1 1 0 11-2 0 1 1 0 012 0z' })
                  ),
                  React.createElement('p', { className: 'text-lg font-medium text-gray-500 mb-2' }, 'No friends on air right now'),
                  React.createElement('p', { className: 'text-sm text-gray-400' }, 'Check back later to see who\'s listening')
                );
              }

              if (displayFriends.length === 0 && collectionSort.friends === 'active') {
                return React.createElement('div', { className: 'flex-1 flex flex-col items-center justify-center text-gray-400 py-20' },
                  React.createElement('svg', { className: 'w-16 h-16 mb-4 text-gray-300', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' })
                  ),
                  React.createElement('p', { className: 'text-lg font-medium text-gray-500 mb-2' }, 'No friends active in the last 14 days'),
                  React.createElement('p', { className: 'text-sm text-gray-400' }, 'Try a different sort to see all your friends')
                );
              }

              if (savedFriends.length === 0) {
                return React.createElement('div', { className: 'flex-1 flex flex-col items-center justify-center text-gray-400 py-20' },
                  React.createElement('svg', { className: 'w-16 h-16 mb-4 text-gray-300', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' })
                  ),
                  React.createElement('p', { className: 'text-lg font-medium text-gray-500 mb-2' }, 'No friends in collection'),
                  React.createElement('p', { className: 'text-sm text-gray-400 mb-4' }, 'Add friends to your collection to see them here'),
                  React.createElement('button', {
                    onClick: () => setAddFriendModalOpen(true),
                    className: 'px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors'
                  }, 'Add Friend')
                );
              }

              return React.createElement('div', {
                style: { minHeight: 'calc(100vh - 160px)', alignContent: 'start' }  // Ensure enough scroll area to prevent header bounce
              },
                // Grid of friend cards - Cinematic Light design
                React.createElement('div', {
                  className: 'grid gap-x-4 gap-y-5',
                  style: { gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }
                },
                  displayFriends.map((friend, index) => {
                    const onAir = isOnAir(friend);
                    const isPinned = pinnedFriendIds.includes(friend.id);

                    return React.createElement('div', {
                      key: friend.id,
                      className: 'flex flex-col items-center cursor-pointer group release-card card-fade-up',
                      style: {
                        padding: '14px 12px',
                        borderRadius: '10px',
                        backgroundColor: 'var(--card-bg)',
                        boxShadow: 'var(--card-shadow)',
                        animationDelay: `${Math.min(index * 30, 300)}ms`
                      },
                      draggable: true,
                      onDragStart: (e) => {
                        e.dataTransfer.setData('friendId', friend.id);
                        e.dataTransfer.effectAllowed = 'copy';
                      },
                      onClick: () => navigateToFriend(friend),
                      onContextMenu: (e) => {
                        e.preventDefault();
                        if (window.electron?.contextMenu?.showTrackMenu) {
                          window.electron.contextMenu.showTrackMenu({
                            type: 'friend',
                            friend: friend,
                            isPinned: isPinned,
                            isSavedToCollection: friend.savedToCollection
                          });
                        }
                      }
                    },
                      // Hexagonal avatar with border ring and hover effects
                      React.createElement('div', {
                        className: 'relative',
                        style: { width: '100px', height: '100px' }
                      },
                        // Outer hexagon border/ring
                        React.createElement('div', {
                          style: {
                            position: 'absolute',
                            inset: 0,
                            clipPath: 'polygon(50% 0%, 93.3% 25%, 93.3% 75%, 50% 100%, 6.7% 75%, 6.7% 25%)',
                            background: onAir
                              ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)'
                              : 'linear-gradient(135deg, var(--hover-bg-subtle) 0%, var(--hover-bg-default) 100%)',
                            transition: 'background 0.3s ease'
                          },
                          className: 'group-hover:scale-105'
                        }),
                        // Inner hexagon with avatar
                        React.createElement('div', {
                          style: {
                            position: 'absolute',
                            inset: '3px',
                            clipPath: 'polygon(50% 0%, 93.3% 25%, 93.3% 75%, 50% 100%, 6.7% 75%, 6.7% 25%)',
                            overflow: 'hidden'
                          }
                        },
                          React.createElement('div', {
                            className: 'group-hover:scale-110 transition-transform duration-300',
                            style: {
                              width: '100%',
                              height: '100%',
                              ...(friend.avatarUrl ? {
                                backgroundImage: `url(${friend.avatarUrl})`,
                                backgroundSize: 'cover',
                                backgroundPosition: 'center'
                              } : {
                                background: 'linear-gradient(145deg, #18181b 0%, #27272a 50%, #18181b 100%)'
                              })
                            }
                          },
                            // Show initial if no avatar
                            !friend.avatarUrl && React.createElement('div', {
                              style: {
                                width: '100%',
                                height: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '28px',
                                fontWeight: '500',
                                color: 'rgba(255, 255, 255, 0.4)',
                                letterSpacing: '0.02em'
                              }
                            }, friend.displayName.charAt(0).toUpperCase())
                          )
                        ),
                        // On-air pulse indicator
                        onAir && React.createElement('div', {
                          className: 'on-air-indicator',
                          style: {
                            position: 'absolute',
                            bottom: '4px',
                            right: '8px',
                            width: '14px',
                            height: '14px',
                            backgroundColor: '#22c55e',
                            borderRadius: '9999px',
                            border: '2.5px solid #ffffff'
                          }
                        })
                      ),
                      // Name and pin icon
                      React.createElement('div', {
                        style: {
                          marginTop: '10px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '4px',
                          width: '100%'
                        }
                      },
                        React.createElement('span', {
                          style: {
                            fontSize: '13px',
                            fontWeight: '500',
                            color: 'var(--text-primary)',
                            textAlign: 'center',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            transition: 'color 0.2s ease'
                          },
                          className: ''
                        }, friend.displayName),
                        // Pin icon for manually pinned friends (not auto-pinned)
                        isPinned && !autoPinnedFriendIds.includes(friend.id) && React.createElement('svg', {
                          style: { width: '12px', height: '12px', color: 'var(--accent-soft)', flexShrink: 0 },
                          fill: 'currentColor',
                          viewBox: '0 0 24 24',
                          title: 'Pinned to sidebar'
                        },
                          React.createElement('path', { d: 'M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z' })
                        )
                      ),
                      // Service badge - refined
                      React.createElement('div', {
                        className: 'release-badge',
                        style: {
                          marginTop: '4px',
                          backgroundColor: friend.service === 'lastfm' ? 'rgba(239, 68, 68, 0.08)' : 'rgba(249, 115, 22, 0.08)',
                          color: friend.service === 'lastfm' ? '#dc2626' : '#ea580c'
                        }
                      }, friend.service === 'lastfm' ? 'Last.fm' : 'ListenBrainz'),
                      // Current track if on-air
                      onAir && friend.cachedRecentTrack && React.createElement('div', {
                        style: {
                          marginTop: '6px',
                          fontSize: '11px',
                          color: 'var(--text-secondary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          textAlign: 'center',
                          maxWidth: '100%'
                        }
                      },
                        React.createElement('span', { style: { color: '#22c55e' } }, '\u266A '),
                        `${friend.cachedRecentTrack.name}`
                      )
                    );
                  })
                )
              );
            })()
            )
          )
        );
});

module.exports = { CollectionPage, COLLECTION_PAGE_HANDLERS };
