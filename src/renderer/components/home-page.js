// src/renderer/components/home-page.js — the Home page, moved out of the
// Parachord component (maintainability plan Track 2b, second state-domain
// slice; the first is collection-page.js). Home is the landing page, so it is
// on screen through the busiest stretch of state churn (startup cache
// restore, library load, resolution, art backfills, discovery fetches) and
// while music plays; it used to re-render on every one of those setStates.
//
// React.memo, fed only stable props: state values, useState setters, refs,
// useCallback results, and Parachord's plain functions as stable wrappers
// (useStableHandlers in app.js; the list is HOME_PAGE_HANDLERS).
// `_metaServices` is not read here: getChatServices() reads it during this
// render through its stable wrapper, so it is passed only to invalidate the
// memo when chat plugins change. tests/renderer/page-memo.test.js checks the
// call site.
//
// The body is the original render expression, unchanged: it reads its inputs
// from props under their old names.

const Icons = require('./icons');
const { FixedTooltip } = require('./ui-atoms');
const { generateArtistPattern, PlayTop10Icon, QueueTop10Icon } = require('./cards');

const { Play, Pause } = Icons;

// Plain functions from Parachord, passed as stable wrappers.
const HOME_PAGE_HANDLERS = [
  'activateListenAlong',
  'addToQueue',
  'copyParachordLink',
  'deactivateListenAlong',
  'fetchAlbumTracksFromMusicBrainz',
  'fetchArtistData',
  'getAlbumArt',
  'getArtistImage',
  'getArtistTopTracks',
  'getChatServices',
  'handleCollectionAlbumClick',
  'handlePlay',
  'handlePlayPause',
  'handleStartCollectionStation',
  'isOnAir',
  'isServiceEnabled',
  'loadAiRecommendations',
  'loadCharts',
  'loadCriticsPicks',
  'loadNewReleases',
  'loadPlaylist',
  'loadWeeklyJamTracks',
  'navigateTo',
  'navigateToFriend',
  'openAiChat',
  'openCriticsPicksAlbum',
  'openSyncSetupModal',
  'openTopAlbum',
  'playTrackCollection',
  'setQueueWithContext',
];

const HomePage = React.memo(function HomePage(props) {
  const {
    activateListenAlong,
    addToQueue,
    allPlaylistCovers,
    allResolvers,
    appVersion,
    cacheLoaded,
    charts,
    collectionData,
    collectionLoading,
    copyParachordLink,
    criticsPicks,
    currentQueue,
    currentTrack,
    deactivateListenAlong,
    discoveryUnread,
    extensionConnected,
    fetchAlbumTracksFromMusicBrainz,
    fetchArtistData,
    friends,
    getAlbumArt,
    getArtistImage,
    getArtistTopTracks,
    getChatServices,
    handleCollectionAlbumClick,
    handlePlay,
    handlePlayPause,
    handleStartCollectionStation,
    homeData,
    homeFriendsSortRef,
    homeHeaderCollapsed,
    isOnAir,
    isPlaying,
    isServiceEnabled,
    library,
    listenAlongFriend,
    loadAiRecommendations,
    loadCharts,
    loadCriticsPicks,
    loadNewReleases,
    loadPlaylist,
    loadWeeklyJamTracks,
    metaServiceConfigs,
    navigateTo,
    navigateToFriend,
    newReleases,
    openAiChat,
    openCriticsPicksAlbum,
    openSyncSetupModal,
    openTopAlbum,
    playTrackCollection,
    playlists,
    recommendations,
    resolverSyncSettings,
    setAddFriendModalOpen,
    setAddToPlaylistPanel,
    setCollectionTab,
    setCurrentQueue,
    setExtensionInfoOpen,
    setHomeData,
    setHomeHeaderCollapsed,
    setQueueWithContext,
    setRaycastInfoOpen,
    setSettingsTab,
    setTrackLoading,
    setWhatsNewOpen,
    showDiscoveryBadges,
    showToast,
    spotifyConnected,
    trackSourcesCache,
    weeklyJamCovers,
    whatsNewDismissedVersion,
  } = props;
  return React.createElement('div', {
          className: 'flex-1 flex flex-col h-full',
          style: { overflow: 'hidden', minHeight: 0 }
        },
          // Hero header with gradient
          React.createElement('div', {
            className: 'relative',
            style: {
              height: homeHeaderCollapsed ? '80px' : '280px',
              flexShrink: 0,
              transition: 'height 300ms cubic-bezier(0.4, 0, 0.2, 1)',
              overflow: 'hidden'
            }
          },
            // Gradient background - warm sunset vibes
            React.createElement('div', {
              className: 'absolute inset-0',
              style: {
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)'
              }
            }),
            // Animated background pattern
            React.createElement('div', {
              className: 'absolute inset-0',
              style: {
                opacity: 0.1,
                backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'100\' height=\'100\' viewBox=\'0 0 100 100\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'%23ffffff\'%3E%3Ccircle cx=\'50\' cy=\'50\' r=\'40\' fill=\'none\' stroke=\'%23fff\' stroke-width=\'2\'/%3E%3Ccircle cx=\'50\' cy=\'50\' r=\'25\' fill=\'none\' stroke=\'%23fff\' stroke-width=\'1.5\'/%3E%3Ccircle cx=\'50\' cy=\'50\' r=\'10\' fill=\'none\' stroke=\'%23fff\' stroke-width=\'1\'/%3E%3C/g%3E%3C/svg%3E")'
              }
            }),
            // EXPANDED STATE — title + subtitle only. The Parachord
            // wordmark img used to render above the title here but was
            // removed: it sat at a different Y position than the splash
            // SVG and the user saw a "wordmark jump" as the splash
            // faded into it. Keeping the home hero without a second
            // wordmark lets the splash stay viewport-centered and just
            // fade away cleanly with no competing element.
            !homeHeaderCollapsed && React.createElement('div', {
              className: 'absolute inset-0 flex flex-col items-center justify-center text-center px-6 z-10'
            },
              // Title (matching other page headers)
              React.createElement('h1', {
                className: 'text-5xl font-light text-white',
                style: {
                  textShadow: '0 2px 20px rgba(0,0,0,0.5)',
                  letterSpacing: '0.3em',
                  textTransform: 'uppercase'
                },
                onContextMenu: copyParachordLink
              }, 'HOME'),
              // Subtitle with stats
              React.createElement('p', {
                className: 'text-white/70 text-sm mt-6',
                style: { textShadow: '0 1px 10px rgba(0,0,0,0.3)' }
              }, `${collectionData.albums.length} albums · ${collectionData.artists.length} artists · ${playlists.length} playlists`)
            ),
            // COLLAPSED STATE — title only (right-side wordmark img
            // removed for consistency with the expanded variant).
            homeHeaderCollapsed && React.createElement('div', {
              className: 'absolute inset-0 flex items-center px-6 z-10'
            },
              React.createElement('h1', {
                className: 'text-2xl font-light text-white',
                style: {
                  textShadow: '0 2px 10px rgba(0,0,0,0.5)',
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase'
                },
                onContextMenu: copyParachordLink
              }, 'HOME')
            )
          ),

          // Sticky header bar with Collection Radio button
          React.createElement('div', {
            className: 'flex items-center justify-end px-6 py-3',
            style: { flexShrink: 0, minHeight: '52px', backgroundColor: 'var(--bg-primary)', borderBottom: '1px solid var(--border-default)' }
          },
            // Start Collection Radio button
            (collectionData.tracks.length > 0 || library.length > 0) && React.createElement('button', {
              onClick: handleStartCollectionStation,
              className: 'px-4 py-1.5 rounded-full text-sm font-medium text-white transition-all hover:scale-105 no-drag',
              style: {
                backgroundColor: '#E91E63'
              }
            }, 'Start Collection Radio')
          ),

          // Scrollable content area
          React.createElement('div', {
            className: 'flex-1 overflow-y-auto scrollable-content',
            style: { minHeight: 0 },
            onScroll: (e) => {
              const scrollTop = e.target.scrollTop;
              if (scrollTop > 50 && !homeHeaderCollapsed) {
                setHomeHeaderCollapsed(true);
              } else if (scrollTop <= 50 && homeHeaderCollapsed) {
                setHomeHeaderCollapsed(false);
              }
            }
          },
            React.createElement('div', { className: 'p-6 space-y-8' },

              // SECTION: Enhance Your Experience (Setup suggestions for new users)
              (() => {
                // Build list of suggestions
                const suggestions = [];

                // Check for uninstalled popular resolvers
                const popularResolverIds = ['youtube', 'soundcloud', 'bandcamp'];
                const installedIds = allResolvers.map(r => r.id);
                const uninstalledPopular = popularResolverIds.filter(id => !installedIds.includes(id));

                if (uninstalledPopular.length > 0) {
                  suggestions.push({
                    id: 'resolvers',
                    icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
                    title: 'Add More Music Sources',
                    description: `Install ${uninstalledPopular.length} more resolver${uninstalledPopular.length > 1 ? 's' : ''} to expand your library`,
                    action: () => { navigateTo('settings'); setSettingsTab('plugins'); },
                    actionLabel: 'Browse Plugins',
                    color: 'var(--accent-secondary)'
                  });
                }

                // Check Last.fm configuration
                if (!metaServiceConfigs.lastfm?.username) {
                  suggestions.push({
                    id: 'lastfm',
                    icon: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3',
                    title: 'Connect Last.fm',
                    description: 'Scrobble tracks and get personalized recommendations',
                    action: () => { navigateTo('settings'); setSettingsTab('general'); },
                    actionLabel: 'Set Up',
                    color: '#dc2626'
                  });
                }

                // Check ListenBrainz configuration
                if (!metaServiceConfigs.listenbrainz?.username) {
                  suggestions.push({
                    id: 'listenbrainz',
                    icon: 'M13 10V3L4 14h7v7l9-11h-7z',
                    title: 'Connect ListenBrainz',
                    description: 'Open-source scrobbling and weekly playlists',
                    action: () => { navigateTo('settings'); setSettingsTab('general'); },
                    actionLabel: 'Set Up',
                    color: '#ea580c'
                  });
                }

                // Check Spotify connection
                if (!spotifyConnected) {
                  suggestions.push({
                    id: 'spotify',
                    icon: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3',
                    title: 'Connect Spotify',
                    description: 'Stream music directly through Spotify Connect',
                    action: () => { navigateTo('settings'); setSettingsTab('general'); },
                    actionLabel: 'Connect',
                    color: '#1DB954'
                  });
                }

                // Check browser extension connection (only show if explicitly false, not null/unknown)
                if (extensionConnected === false) {
                  suggestions.push({
                    id: 'extension',
                    icon: 'M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4',
                    title: 'Install Browser Extension',
                    description: 'Control YouTube, Bandcamp, SoundCloud from Parachord',
                    action: () => {
                      setExtensionInfoOpen(true);
                    },
                    actionLabel: 'Get Extension',
                    color: '#4285f4'
                  });
                }

                // Raycast extension suggestion (Mac only)
                if (navigator.platform.includes('Mac')) {
                  suggestions.push({
                    id: 'raycast',
                    icon: 'M13 10V3L4 14h7v7l9-11h-7z',
                    title: 'Raycast Extension',
                    description: 'Control Parachord with keyboard shortcuts',
                    action: () => setRaycastInfoOpen(true),
                    actionLabel: 'Learn More',
                    color: '#FF6363'
                  });
                }

                // What's New card (show after app update when user hasn't dismissed for current version)
                if (appVersion && whatsNewDismissedVersion !== appVersion) {
                  suggestions.push({
                    id: 'whats-new',
                    icon: 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z',
                    title: "Learn What's New",
                    description: `See what's new in v${appVersion}`,
                    action: () => setWhatsNewOpen(true),
                    actionLabel: 'View',
                    color: '#f59e0b'
                  });
                }

                // Empty collection prompt
                if (collectionData.tracks.length === 0 && collectionData.albums.length === 0) {
                  suggestions.push({
                    id: 'collection',
                    icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10',
                    title: 'Build Your Collection',
                    description: 'Search for music and add favorites to your library',
                    action: () => navigateTo('search'),
                    actionLabel: 'Start Searching',
                    color: '#06b6d4'
                  });
                }

                // No suggestions? Don't render section
                if (suggestions.length === 0) return null;

                // Limit to 3 suggestions max
                const visibleSuggestions = suggestions.slice(0, 3);

                return React.createElement('div', { className: 'mb-2' },
                  React.createElement('div', { className: 'flex items-center justify-between mb-4' },
                    React.createElement('h2', { className: 'text-lg font-semibold text-gray-900' }, 'Enhance Your Experience'),
                    suggestions.length > 3 && React.createElement('button', {
                      onClick: () => { navigateTo('settings'); setSettingsTab('plugins'); },
                      className: 'text-sm text-purple-600 hover:text-purple-700 font-medium transition-colors'
                    }, 'See all')
                  ),
                  React.createElement('div', {
                    className: 'grid grid-cols-1 md:grid-cols-3 gap-3'
                  },
                    visibleSuggestions.map((suggestion, index) =>
                      React.createElement('button', {
                        key: suggestion.id,
                        className: 'release-card card-fade-up flex items-start gap-3 p-4 text-left',
                        style: {
                          backgroundColor: 'var(--card-bg)',
                          borderRadius: '10px',
                          border: 'none',
                          boxShadow: 'var(--card-shadow)',
                          animationDelay: `${index * 50}ms`
                        },
                        onClick: suggestion.action
                      },
                        // Icon
                        React.createElement('div', {
                          className: 'w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0',
                          style: { backgroundColor: `${suggestion.color}15` }
                        },
                          React.createElement('svg', {
                            className: 'w-5 h-5',
                            style: { color: suggestion.color },
                            fill: 'none',
                            viewBox: '0 0 24 24',
                            stroke: 'currentColor'
                          },
                            React.createElement('path', {
                              strokeLinecap: 'round',
                              strokeLinejoin: 'round',
                              strokeWidth: 2,
                              d: suggestion.icon
                            })
                          )
                        ),
                        // Content
                        React.createElement('div', { className: 'flex-1 min-w-0' },
                          React.createElement('p', {
                            className: 'text-gray-900 font-medium',
                            style: { fontSize: '13px' }
                          }, suggestion.title),
                          React.createElement('p', {
                            className: 'text-gray-500 mt-0.5',
                            style: { fontSize: '12px', lineHeight: '1.4' }
                          }, suggestion.description)
                        ),
                        // Arrow
                        React.createElement('svg', {
                          className: 'w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5',
                          fill: 'none',
                          viewBox: '0 0 24 24',
                          stroke: 'currentColor'
                        },
                          React.createElement('path', {
                            strokeLinecap: 'round',
                            strokeLinejoin: 'round',
                            strokeWidth: 2,
                            d: 'M9 5l7 7-7 7'
                          })
                        )
                      )
                    )
                  )
                );
              })(),

              // SECTION: Quick Play / Continue Listening
              currentTrack && React.createElement('div', { className: 'mb-2' },
                React.createElement('div', { className: 'flex items-center justify-between mb-4' },
                  React.createElement('h2', { className: 'text-lg font-semibold text-gray-900' }, 'Continue Listening')
                ),
                React.createElement('div', {
                  className: 'flex items-center gap-4 p-4 cursor-pointer rounded-xl transition-colors duration-200 hover:bg-purple-50/80',
                  style: {
                    background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.06) 0%, rgba(99, 102, 241, 0.06) 100%)'
                  },
                  onClick: () => { if (!isPlaying) handlePlayPause(); }
                },
                  React.createElement('div', {
                    className: 'w-16 h-16 rounded-lg overflow-hidden flex-shrink-0',
                    style: { boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }
                  },
                    currentTrack.albumArt ?
                      React.createElement('img', { src: currentTrack.albumArt, alt: currentTrack.album, className: 'w-full h-full object-cover' }) :
                      React.createElement('div', { className: 'w-full h-full bg-gradient-to-br from-purple-400 to-indigo-500 flex items-center justify-center' },
                        React.createElement('svg', { className: 'w-8 h-8 text-white/80', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3' })
                        )
                      )
                  ),
                  React.createElement('div', { className: 'flex-1 min-w-0' },
                    React.createElement('p', {
                      className: 'text-gray-900 truncate',
                      style: { fontSize: '14px', fontWeight: 500 }
                    }, currentTrack.title),
                    React.createElement('p', { className: 'text-sm text-gray-500 truncate' }, currentTrack.artist),
                    currentQueue.length > 0 && React.createElement('p', { className: 'text-xs text-purple-600 mt-1 font-medium' }, `${currentQueue.length} more in queue`)
                  ),
                  React.createElement('button', {
                    className: 'w-10 h-10 flex items-center justify-center transition-all hover:scale-110',
                    onClick: (e) => { e.stopPropagation(); handlePlayPause(); }
                  },
                    isPlaying
                      ? React.createElement(Pause, { size: 24, className: 'text-purple-500 fill-purple-500' })
                      : React.createElement(Play, { size: 24, className: 'text-purple-500 fill-purple-500' })
                  )
                )
              ),

              // SECTION: Recently Added Albums (with skeleton loading)
              (collectionLoading || collectionData.albums.length > 0) && React.createElement('div', null,
                React.createElement('div', { className: 'flex items-center justify-between mb-4' },
                  React.createElement('h2', { className: 'text-lg font-semibold text-gray-900' }, 'Recently Added'),
                  !collectionLoading && collectionData.albums.length > 0 && React.createElement('button', {
                    onClick: () => { navigateTo('library'); setCollectionTab('albums'); },
                    className: 'text-sm text-purple-600 hover:text-purple-700 font-medium transition-colors'
                  }, 'See all')
                ),
                React.createElement('div', {
                  className: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4'
                },
                  // Skeleton loaders while loading
                  collectionLoading && Array.from({ length: 5 }).map((_, i) =>
                    React.createElement('div', {
                      key: `album-skeleton-${i}`,
                      className: 'animate-pulse',
                      style: {
                        backgroundColor: 'var(--card-bg)',
                        borderRadius: '10px',
                        padding: '10px',
                        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)'
                      }
                    },
                      React.createElement('div', {
                        className: 'aspect-square rounded-md mb-2',
                        style: { backgroundColor: 'var(--placeholder-bg)' }
                      }),
                      React.createElement('div', {
                        className: 'h-4 rounded mb-2',
                        style: { backgroundColor: 'var(--placeholder-bg)', width: '80%' }
                      }),
                      React.createElement('div', {
                        className: 'h-3 rounded',
                        style: { backgroundColor: 'var(--placeholder-bg)', width: '60%' }
                      })
                    )
                  ),
                  // Actual albums
                  !collectionLoading && [...collectionData.albums]
                    .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
                    .slice(0, 5)
                    .map((album, index) =>
                      React.createElement('button', {
                        key: album.id || `${album.artist}-${album.title}`,
                        className: 'release-card card-fade-up text-left group/art',
                        style: {
                          backgroundColor: 'var(--card-bg)',
                          borderRadius: '10px',
                          padding: '10px',
                          border: 'none',
                          boxShadow: 'var(--card-shadow)',
                          animationDelay: `${index * 50}ms`
                        },
                        onClick: () => handleCollectionAlbumClick(album),
                        onContextMenu: (e) => {
                          e.preventDefault();
                          const albumTracks = collectionData.tracks
                            .filter(t => t.artist === album.artist && t.album === album.title)
                            .sort((a, b) => (a.trackNumber || 0) - (b.trackNumber || 0));
                          window.electron?.contextMenu?.showTrackMenu({
                            type: 'collection-album',
                            album: album,
                            tracks: albumTracks
                          });
                        }
                      },
                        React.createElement('div', {
                          className: 'album-art-container aspect-square rounded-md overflow-hidden mb-2',
                          style: { position: 'relative' }
                        },
                          album.art ?
                            React.createElement('img', {
                              src: album.art,
                              alt: album.title,
                              className: 'w-full h-full object-cover transition-transform duration-300 group-hover/art:scale-105'
                            }) :
                            React.createElement('div', {
                              className: 'w-full h-full flex items-center justify-center',
                              style: { background: 'linear-gradient(145deg, #1f1f1f 0%, #2d2d2d 50%, #1a1a1a 100%)' }
                            },
                              React.createElement('svg', { className: 'w-12 h-12', style: { color: 'rgba(255, 255, 255, 0.2)' }, fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                                React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3' })
                              )
                            ),
                          // Hover overlay with action buttons
                          React.createElement('div', {
                            className: 'absolute inset-0 bg-black/50 opacity-0 group-hover/art:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-2',
                            style: { pointerEvents: 'auto' }
                          },
                            // Add to Playlist button
                            React.createElement('button', {
                              onClick: async (e) => {
                                e.stopPropagation();
                                // This used to call setPlaylistSelectorTrack, which
                                // was never declared: every click threw a
                                // ReferenceError (found by the strict lint tier
                                // when the page moved out of app.js). Open the
                                // add-to-playlist panel the way the Collection
                                // page's album cards do, with the album's
                                // collection tracks, else the same top-tracks
                                // lookup this card's Play button uses.
                                let albumTracks = collectionData.tracks
                                  .filter(t => t.artist === album.artist && t.album === album.title)
                                  .sort((a, b) => (a.trackNumber || 0) - (b.trackNumber || 0));
                                if (albumTracks.length === 0) {
                                  const tracks = await getArtistTopTracks(album.artist);
                                  albumTracks = tracks.filter(t => t.album?.toLowerCase() === album.title.toLowerCase());
                                }
                                if (albumTracks.length === 0) {
                                  showToast(`Couldn't find the tracks on ${album.title}`, 'error');
                                  return;
                                }
                                setAddToPlaylistPanel({
                                  open: true,
                                  tracks: albumTracks,
                                  sourceName: `${album.title} by ${album.artist}`,
                                  sourceType: 'album'
                                });
                              },
                              className: 'w-9 h-9 rounded-full flex items-center justify-center transition-all hover:scale-110',
                              style: { backgroundColor: 'rgba(255, 255, 255, 0.15)', color: '#ffffff', border: 'none', cursor: 'pointer' },
                              title: 'Add to Playlist'
                            },
                              React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2 },
                                React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M12 4v16m8-8H4' })
                              )
                            ),
                            // Play button (center, larger)
                            React.createElement('button', {
                              onClick: async (e) => {
                                e.stopPropagation();
                                // Fetch and play album tracks
                                showToast(`Playing ${album.title}...`, 'info');
                                const tracks = await getArtistTopTracks(album.artist);
                                if (tracks.length > 0) {
                                  const albumTracks = tracks.filter(t =>
                                    t.album?.toLowerCase() === album.title.toLowerCase()
                                  );
                                  const tracksToPlay = albumTracks.length > 0 ? albumTracks : tracks.slice(0, 10);
                                  if (tracksToPlay.length > 0) {
                                    playTrackCollection(tracksToPlay, { type: 'album', name: album.title });
                                  }
                                }
                              },
                              className: 'w-11 h-11 bg-white rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-110',
                              style: { border: 'none', cursor: 'pointer' },
                              title: 'Play'
                            },
                              React.createElement('svg', { className: 'w-5 h-5 text-gray-800 ml-0.5', fill: 'currentColor', viewBox: '0 0 24 24' },
                                React.createElement('path', { d: 'M8 5v14l11-7z' })
                              )
                            ),
                            // Add to Queue button
                            React.createElement('button', {
                              onClick: async (e) => {
                                e.stopPropagation();
                                showToast(`Adding ${album.title} to queue...`, 'info');
                                const tracks = await getArtistTopTracks(album.artist);
                                if (tracks.length > 0) {
                                  const albumTracks = tracks.filter(t =>
                                    t.album?.toLowerCase() === album.title.toLowerCase()
                                  );
                                  const tracksToAdd = albumTracks.length > 0 ? albumTracks : tracks.slice(0, 10);
                                  if (tracksToAdd.length > 0) {
                                    setCurrentQueue(prev => [...prev, ...tracksToAdd]);
                                    showToast(`Added ${tracksToAdd.length} tracks to queue`, 'success');
                                  }
                                }
                              },
                              className: 'w-9 h-9 rounded-full flex items-center justify-center transition-all hover:scale-110',
                              style: { backgroundColor: 'rgba(255, 255, 255, 0.15)', color: '#ffffff', border: 'none', cursor: 'pointer' },
                              title: 'Add to Queue'
                            },
                              React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2 },
                                React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M4 6h16M4 12h16M4 18h7' })
                              )
                            )
                          )
                        ),
                        React.createElement('p', {
                          className: 'text-gray-900 truncate',
                          style: { fontSize: '13px', fontWeight: 500, letterSpacing: '0.005em' }
                        }, album.title),
                        React.createElement('p', { className: 'text-xs text-gray-500 truncate mt-0.5' }, album.artist)
                      )
                    )
                )
              ),

              // SECTION: Weekly Jams & Weekly Exploration (ListenBrainz, side by side)
              (homeData.weeklyJams?.length > 0 || homeData.weeklyExploration?.length > 0) && (() => {
                const hasJams = homeData.weeklyJams?.length > 0;
                const hasExploration = homeData.weeklyExploration?.length > 0;
                const hasBoth = hasJams && hasExploration;

                // Render a column of playlist cards for a given list
                const renderWeeklyColumn = (items, label, contextType, stateField) =>
                  React.createElement('div', { className: 'flex flex-col' },
                    React.createElement('div', { className: 'flex items-center gap-2 mb-4' },
                      React.createElement('h2', { className: 'text-lg font-semibold text-gray-900' }, label),
                      React.createElement('span', {
                        className: 'px-2 py-0.5 rounded-full text-xs font-medium',
                        style: { backgroundColor: '#FFF3E0', color: '#E65100' }
                      }, 'ListenBrainz')
                    ),
                    React.createElement('div', {
                      className: hasBoth ? 'grid grid-cols-2 gap-4' : 'grid grid-cols-4 gap-4'
                    },
                      items.map((jam, index) =>
                        React.createElement('button', {
                          key: jam.id,
                          className: 'release-card card-fade-up text-left rounded-xl overflow-hidden transition-all hover:shadow-lg',
                          style: {
                            backgroundColor: 'var(--card-bg)',
                            border: 'none',
                            boxShadow: 'var(--card-shadow)',
                            animationDelay: `${index * 50}ms`
                          },
                          onClick: () => {
                            const playlist = {
                              id: `listenbrainz-${jam.id}`,
                              listenbrainzId: jam.id,
                              title: jam.title,
                              weekLabel: jam.weekLabel,
                              description: jam.description,
                              tracks: jam.tracks || [],
                              tracksLoaded: jam.tracksLoaded,
                              isExternal: true,
                              isEphemeral: true,
                              source: 'listenbrainz',
                              creator: 'ListenBrainz'
                            };
                            loadPlaylist(playlist);
                          },
                          onContextMenu: (e) => {
                            e.preventDefault();
                            if (window.electron?.contextMenu?.showTrackMenu) {
                              window.electron.contextMenu.showTrackMenu({
                                type: 'playlist',
                                playlistId: `listenbrainz-${jam.id}`,
                                name: jam.title,
                                creator: 'ListenBrainz',
                                tracks: jam.tracks || []
                              });
                            }
                          }
                        },
                          React.createElement('div', {
                            className: 'relative aspect-square group/mosaic'
                          },
                            React.createElement('div', {
                              className: `w-full h-full grid grid-cols-2 grid-rows-2${!weeklyJamCovers[jam.id] ? ' animate-shimmer' : ''}`,
                              style: {
                                background: weeklyJamCovers[jam.id]
                                  ? 'linear-gradient(145deg, #1f1f1f 0%, #2d2d2d 50%, #1a1a1a 100%)'
                                  : 'linear-gradient(to right, var(--shimmer-from), var(--shimmer-via), var(--shimmer-to))',
                                backgroundSize: !weeklyJamCovers[jam.id] ? '200% 100%' : undefined
                              }
                            },
                              weeklyJamCovers[jam.id]?.slice(0, 4).map((url, i) =>
                                React.createElement('img', {
                                  key: i,
                                  src: url,
                                  alt: '',
                                  className: 'w-full h-full object-cover'
                                })
                              ) || Array.from({ length: 4 }).map((_, i) =>
                                React.createElement('div', {
                                  key: `placeholder-${i}`,
                                  className: 'w-full h-full',
                                  style: { backgroundColor: 'transparent' }
                                })
                              )
                            ),
                            React.createElement('div', {
                              className: 'absolute inset-0 bg-black/50 opacity-0 group-hover/mosaic:opacity-100 transition-opacity flex items-center justify-center'
                            },
                              React.createElement('div', {
                                className: 'w-14 h-14 rounded-full bg-white flex items-center justify-center hover:scale-110 transition-transform shadow-lg cursor-pointer',
                                onClick: async (e) => {
                                  e.stopPropagation();
                                  let tracks = jam.tracks;
                                  if (!jam.tracksLoaded || tracks.length === 0) {
                                    tracks = await loadWeeklyJamTracks(jam.id);
                                    setHomeData(prev => ({
                                      ...prev,
                                      [stateField]: prev[stateField].map(j =>
                                        j.id === jam.id ? { ...j, tracks, tracksLoaded: true } : j
                                      )
                                    }));
                                  }
                                  if (tracks.length > 0) {
                                    playTrackCollection(tracks, { type: contextType, name: `${jam.weekLabel}'s ${label}` });
                                    showToast(`Playing ${jam.weekLabel}'s ${label}`, 'success');
                                  }
                                }
                              },
                                React.createElement('svg', { className: 'w-6 h-6 text-gray-900 ml-1', fill: 'currentColor', viewBox: '0 0 24 24' },
                                  React.createElement('path', { d: 'M8 5v14l11-7z' })
                                )
                              )
                            )
                          ),
                          React.createElement('div', { className: 'p-3' },
                            React.createElement('p', {
                              className: 'text-gray-900 font-medium truncate',
                              style: { fontSize: '14px' }
                            }, jam.weekLabel),
                            React.createElement('p', {
                              className: 'text-xs text-gray-500 truncate mt-0.5'
                            }, jam.tracksLoaded ? `${jam.tracks.length} tracks` : label)
                          )
                        )
                      )
                    )
                  );

                return React.createElement('div', {
                  className: hasBoth ? 'grid grid-cols-2 gap-6' : null
                },
                  hasJams && renderWeeklyColumn(homeData.weeklyJams, 'Weekly Jams', 'weekly-jam', 'weeklyJams'),
                  hasExploration && renderWeeklyColumn(homeData.weeklyExploration, 'Weekly Exploration', 'weekly-exploration', 'weeklyExploration')
                );
              })(),

              // SECTION: Your Playlists & Friends Listening Now (side by side)
              (() => {
                const onlineFriends = friends.filter(f => isOnAir(f));
                // Friends with recent listening activity (have a cached track), sorted: online first, then by most recent
                // Use a stable sort cache so the list only reorders when a friend starts a new song
                const eligibleFriends = friends.filter(f => f.cachedRecentTrack && f.savedToCollection);
                // Build a fingerprint from track identity only — re-sort when a friend starts a new song,
                // NOT when their on-air status changes from time passing
                const fingerprint = eligibleFriends.map(f =>
                  `${f.id}:${f.cachedRecentTrack?.name}:${f.cachedRecentTrack?.artist}`
                ).join('|');
                let friendsWithActivity;
                if (fingerprint !== homeFriendsSortRef.current.fingerprint) {
                  // A friend started a new song - re-sort
                  friendsWithActivity = eligibleFriends
                    .sort((a, b) => {
                      const aOnAir = isOnAir(a);
                      const bOnAir = isOnAir(b);
                      if (aOnAir && !bOnAir) return -1;
                      if (!aOnAir && bOnAir) return 1;
                      return (b.cachedRecentTrack?.timestamp || 0) - (a.cachedRecentTrack?.timestamp || 0);
                    })
                    .slice(0, 5);
                  homeFriendsSortRef.current = { fingerprint, sorted: friendsWithActivity };
                } else {
                  // No change in track data - use cached order, but refresh objects for updated props
                  friendsWithActivity = homeFriendsSortRef.current.sorted.map(cached =>
                    eligibleFriends.find(f => f.id === cached.id) || cached
                  );
                }
                const showPlaylists = playlists.length > 0;
                const showFriends = friendsWithActivity.length > 0;

                // Only render if at least one section has content
                if (!showPlaylists && !showFriends) return null;

                // Helper: format relative time
                const formatTimeAgo = (timestamp) => {
                  if (!timestamp) return '';
                  const diff = Date.now() - timestamp;
                  const minutes = Math.floor(diff / 60000);
                  if (minutes < 1) return 'Just now';
                  if (minutes < 60) return `${minutes}m ago`;
                  const hours = Math.floor(minutes / 60);
                  if (hours < 24) return `${hours}h ago`;
                  const days = Math.floor(hours / 24);
                  return `${days}d ago`;
                };

                return React.createElement('div', {
                  className: 'grid grid-cols-1 md:grid-cols-2 gap-6',
                  style: { minHeight: '220px' } // Minimum height for 3 playlist cards
                },
                  // Left column: Your Playlists
                  showPlaylists && React.createElement('div', { className: 'flex flex-col' },
                    React.createElement('div', { className: 'flex items-center justify-between mb-4' },
                      React.createElement('h2', { className: 'text-lg font-semibold text-gray-900' }, 'Your Playlists'),
                      React.createElement('button', {
                        onClick: () => navigateTo('playlists'),
                        className: 'text-sm text-purple-600 hover:text-purple-700 font-medium transition-colors'
                      }, 'See all')
                    ),
                    React.createElement('div', { className: 'space-y-2 flex-1' },
                      [...playlists]
                        .sort((a, b) => (b.lastModified || b.addedAt || 0) - (a.lastModified || a.addedAt || 0))
                        .slice(0, 4)
                        .map((playlist, index) =>
                          React.createElement('button', {
                            key: playlist.id,
                            className: 'release-card card-fade-up flex items-center gap-3 p-3 text-left w-full',
                            style: {
                              backgroundColor: 'var(--card-bg)',
                              borderRadius: '10px',
                              border: 'none',
                              boxShadow: 'var(--card-shadow)',
                              animationDelay: `${index * 50}ms`
                            },
                            onClick: () => {
                              loadPlaylist(playlist);
                            },
                            onContextMenu: (e) => {
                              e.preventDefault();
                              if (window.electron?.contextMenu?.showTrackMenu) {
                                window.electron.contextMenu.showTrackMenu({
                                  type: 'playlist',
                                  playlistId: playlist.id,
                                  name: playlist.title,
                                  creator: playlist.creator || null,
                                  tracks: playlist.tracks || []
                                });
                              }
                            }
                          },
                            // 2x2 album art grid or placeholder with hover play button
                            React.createElement('div', {
                              className: 'relative w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 group/mosaic'
                            },
                              React.createElement('div', {
                                className: `w-full h-full grid grid-cols-2 grid-rows-2${!allPlaylistCovers[playlist.id] ? ' animate-shimmer' : ''}`,
                                style: {
                                  background: allPlaylistCovers[playlist.id]
                                    ? 'linear-gradient(145deg, #1f1f1f 0%, #2d2d2d 50%, #1a1a1a 100%)'
                                    : 'linear-gradient(to right, var(--shimmer-from), var(--shimmer-via), var(--shimmer-to))',
                                  backgroundSize: !allPlaylistCovers[playlist.id] ? '200% 100%' : undefined
                                }
                              },
                                allPlaylistCovers[playlist.id]?.slice(0, 4).map((url, i) =>
                                  React.createElement('img', {
                                    key: i,
                                    src: url,
                                    alt: '',
                                    className: 'w-full h-full object-cover'
                                  })
                                ) || Array.from({ length: 4 }).map((_, i) =>
                                  React.createElement('div', {
                                    key: `placeholder-${i}`,
                                    className: 'w-full h-full',
                                    style: { backgroundColor: 'transparent' }
                                  })
                                )
                              ),
                              // Hover play button overlay
                              React.createElement('div', {
                                className: 'absolute inset-0 bg-black/50 opacity-0 group-hover/mosaic:opacity-100 transition-opacity flex items-center justify-center'
                              },
                                React.createElement('button', {
                                  className: 'w-8 h-8 rounded-full bg-white flex items-center justify-center hover:scale-110 transition-transform shadow-lg',
                                  onClick: async (e) => {
                                    e.stopPropagation();
                                    // Play all tracks in the playlist
                                    if (playlist.tracks && playlist.tracks.length > 0) {
                                      playTrackCollection(playlist.tracks, { type: 'playlist', name: playlist.title });
                                      showToast(`Playing ${playlist.title}`, 'success');
                                    } else {
                                      showToast('Playlist is empty', 'info');
                                    }
                                  }
                                },
                                  React.createElement('svg', { className: 'w-4 h-4 text-gray-900 ml-0.5', fill: 'currentColor', viewBox: '0 0 24 24' },
                                    React.createElement('path', { d: 'M8 5v14l11-7z' })
                                  )
                                )
                              )
                            ),
                            React.createElement('div', { className: 'flex-1 min-w-0' },
                              React.createElement('p', {
                                className: 'text-gray-900 truncate',
                                style: { fontSize: '13px', fontWeight: 500, letterSpacing: '0.005em' }
                              }, playlist.title),
                              React.createElement('p', { className: 'text-xs text-gray-500 mt-0.5' }, `${playlist.tracks?.length || 0} tracks`)
                            )
                          )
                        )
                    )
                  ),

                  // Right column: Friends Listening
                  showFriends && React.createElement('div', { className: 'flex flex-col' },
                    React.createElement('div', { className: 'flex items-center justify-between mb-4' },
                      React.createElement('h2', { className: 'text-lg font-semibold text-gray-900' }, 'Friend Activity'),
                      onlineFriends.length > 0
                        ? React.createElement('span', { className: 'flex items-center gap-1.5 text-sm text-green-600 font-medium' },
                            React.createElement('span', { className: 'w-2 h-2 rounded-full bg-green-500 animate-pulse' }),
                            `${onlineFriends.length} listening now`
                          )
                        : React.createElement('button', {
                            onClick: () => navigateTo('friends'),
                            className: 'text-sm text-purple-600 hover:text-purple-700 font-medium transition-colors'
                          }, 'See all')
                    ),
                    React.createElement('div', { className: 'space-y-2 flex-1' },
                      friendsWithActivity.map((friend, index) => {
                        const onAir = isOnAir(friend);
                        const track = friend.cachedRecentTrack;
                        return React.createElement('div', {
                          key: friend.id,
                          className: 'release-card card-fade-up flex items-center gap-3 p-3 cursor-pointer',
                          style: {
                            backgroundColor: 'var(--card-bg)',
                            borderRadius: '10px',
                            boxShadow: 'var(--card-shadow)',
                            animationDelay: `${index * 50}ms`
                          },
                          onClick: () => navigateToFriend(friend)
                        },
                          // Friend avatar with hexagon shape (matching sidebar style)
                          React.createElement('div', {
                            className: 'relative w-10 h-10 flex-shrink-0'
                          },
                            React.createElement('div', {
                              className: 'w-full h-full overflow-hidden',
                              style: {
                                clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)'
                              }
                            },
                              friend.avatarUrl
                                ? React.createElement('img', { src: friend.avatarUrl, alt: friend.displayName, className: 'w-full h-full object-cover' })
                                : React.createElement('div', { className: 'w-full h-full flex items-center justify-center text-white text-sm font-medium bg-gradient-to-br from-purple-400 to-pink-400' },
                                    friend.displayName?.charAt(0).toUpperCase()
                                  )
                            ),
                            // On-air indicator dot (green for listening, gray for offline)
                            React.createElement('div', {
                              className: `absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${onAir ? 'bg-green-500' : 'bg-gray-300'}`
                            })
                          ),
                          // Friend info with track details
                          React.createElement('div', { className: 'flex-1 min-w-0' },
                            React.createElement('div', { className: 'flex items-center gap-1.5' },
                              React.createElement('p', {
                                className: 'text-gray-900 truncate',
                                style: { fontSize: '13px', fontWeight: 500 }
                              }, friend.displayName),
                              // Time indicator
                              React.createElement('span', {
                                className: 'text-xs flex-shrink-0',
                                style: { color: onAir ? '#16a34a' : 'var(--text-tertiary)' }
                              }, onAir ? 'now' : formatTimeAgo(track?.timestamp))
                            ),
                            // Track info - click to play, right-click for context menu
                            track && React.createElement('p', {
                              className: 'text-xs truncate mt-0.5 cursor-pointer hover:underline flex items-center gap-1',
                              style: { color: onAir ? 'var(--nav-inactive)' : 'var(--text-tertiary)' },
                              onClick: (e) => {
                                e.stopPropagation();
                                const cacheKey = `${track.artist.toLowerCase()}|${track.name.toLowerCase()}`;
                                const cachedSources = trackSourcesCache.current[cacheKey]?.sources || {};
                                const trackObj = {
                                  title: track.name,
                                  artist: track.artist,
                                  album: track.album,
                                  albumArt: track.albumArt,
                                  sources: cachedSources
                                };
                                setQueueWithContext([], { type: 'friend-track', name: `${friend.displayName}'s track` });
                                handlePlay(trackObj);
                              },
                              onContextMenu: (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (window.electron?.contextMenu?.showTrackMenu) {
                                  const cacheKey = `${track.artist.toLowerCase()}|${track.name.toLowerCase()}`;
                                  const cachedSources = trackSourcesCache.current[cacheKey]?.sources || {};
                                  window.electron.contextMenu.showTrackMenu({
                                    type: 'track',
                                    track: {
                                      title: track.name,
                                      artist: track.artist,
                                      album: track.album,
                                      albumArt: track.albumArt,
                                      sources: cachedSources
                                    }
                                  });
                                }
                              }
                            },
                              React.createElement('span', {
                                style: { color: onAir ? '#22c55e' : 'var(--text-tertiary)', flexShrink: 0 }
                              }, '\u266A'),
                              React.createElement('span', { className: 'truncate' }, `${track.name} \u00B7 ${track.artist}`)
                            )
                          ),
                          // Listen along button (only for online friends)
                          onAir && React.createElement('button', {
                            className: `px-3 py-1.5 text-xs font-medium rounded-full transition-all ${
                              listenAlongFriend?.id === friend.id
                                ? 'bg-purple-600 text-white'
                                : 'text-purple-600 bg-purple-50 hover:bg-purple-100'
                            }`,
                            onClick: (e) => {
                              e.stopPropagation();
                              if (listenAlongFriend?.id === friend.id) {
                                deactivateListenAlong();
                              } else {
                                activateListenAlong(friend);
                              }
                            }
                          },
                            React.createElement('svg', {
                              className: 'w-3 h-3 inline-block mr-1 -mt-px',
                              fill: 'none',
                              viewBox: '0 0 24 24',
                              stroke: 'currentColor',
                              strokeWidth: 2
                            },
                              React.createElement('path', {
                                strokeLinecap: 'round',
                                strokeLinejoin: 'round',
                                d: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1'
                              })
                            ),
                            listenAlongFriend?.id === friend.id ? 'Listening' : 'Listen Along'
                          )
                        );
                      })
                    )
                  ),

                  // If only playlists but no friends, show placeholder in right column
                  showPlaylists && !showFriends && React.createElement('div', { className: 'flex flex-col' },
                    React.createElement('div', { className: 'flex items-center justify-between mb-4' },
                      React.createElement('h2', { className: 'text-lg font-semibold text-gray-900' }, 'Friend Activity')
                    ),
                    React.createElement('div', {
                      className: 'flex-1 flex flex-col items-center justify-center rounded-xl p-6',
                      style: { backgroundColor: 'var(--bg-secondary)' }
                    },
                      React.createElement('svg', { className: 'w-12 h-12 text-gray-300 mb-3', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' })
                      ),
                      React.createElement(React.Fragment, null,
                        React.createElement('p', { className: 'text-gray-600 text-sm text-center font-medium mb-1' },
                          friends.length === 0 ? 'Add friends to see what they\'re listening to' : 'No friends currently listening'
                        ),
                        friends.length === 0 && React.createElement('p', { className: 'text-gray-400 text-xs text-center mb-3' }, 'Import users from Last.fm or ListenBrainz'),
                        React.createElement('button', {
                          onClick: () => setAddFriendModalOpen(true),
                          className: 'mt-3 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors'
                        }, 'Add Friend')
                      )
                    )
                  )
                );
              })(),

              // SECTION: Discover New Music
              React.createElement('div', null,
                React.createElement('div', { className: 'mb-4' },
                  React.createElement('h2', { className: 'text-lg font-semibold text-gray-900' }, 'Discover')
                ),
                React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4' },
                  // 1. For You / Recommendations card (indigo->purple->pink)
                  React.createElement('div', {
                    className: 'card-fade-up rounded-xl text-left text-white transition-all hover:shadow-lg overflow-hidden flex flex-col',
                    style: {
                      background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%)',
                      animationDelay: '0ms'
                    }
                  },
                    // Header section - clickable to recommendations page
                    React.createElement('button', {
                      className: 'w-full block p-5 pb-4 text-left hover:bg-white/10 transition-colors',
                      onClick: () => navigateTo('recommendations')
                    },
                      React.createElement('svg', { className: 'w-8 h-8 mb-3 opacity-90', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z' })
                      ),
                      React.createElement('h3', { className: 'font-semibold text-lg flex items-center gap-2' },
                        'For You',
                        showDiscoveryBadges && discoveryUnread.recommendations && React.createElement('span', {
                          className: 'w-2.5 h-2.5 rounded-full bg-white animate-pulse'
                        })
                      ),
                      React.createElement('p', { className: 'text-white/70 text-sm mt-1' }, 'Personalized recommendations')
                    ),
                    // Top artist preview - clickable to artist page
                    recommendations.artists.length > 0 && React.createElement('button', {
                      className: 'w-full flex-1 flex items-center gap-3 p-5 border-t border-white/20 text-left hover:bg-white/10 transition-colors',
                      onClick: (e) => {
                        e.stopPropagation();
                        fetchArtistData(recommendations.artists[0].name);
                      }
                    },
                      React.createElement('div', {
                        className: 'w-12 h-12 rounded-full overflow-hidden flex-shrink-0',
                        style: { background: 'linear-gradient(135deg, #4c1d95 0%, var(--accent-primary) 100%)' }
                      },
                        recommendations.artists[0].image
                          ? React.createElement('img', {
                              src: recommendations.artists[0].image,
                              alt: recommendations.artists[0].name,
                              className: 'w-full h-full object-cover'
                            })
                          : React.createElement('div', { className: 'w-full h-full flex items-center justify-center text-white/60 text-lg font-bold' },
                              recommendations.artists[0].name.charAt(0).toUpperCase()
                            )
                      ),
                      React.createElement('div', { className: 'flex-1 min-w-0' },
                        React.createElement('p', { className: 'text-white/60 text-xs' }, 'Top pick'),
                        React.createElement('p', { className: 'text-white font-medium truncate' }, recommendations.artists[0].name)
                      )
                    ),
                    // Padding when no preview
                    recommendations.artists.length === 0 && React.createElement('div', { className: 'flex-1' })
                  ),

                  // 2. Critical Darlings card (amber->orange->red)
                  React.createElement('div', {
                    className: 'card-fade-up rounded-xl text-left text-white transition-all hover:shadow-lg overflow-hidden flex flex-col',
                    style: {
                      background: 'linear-gradient(135deg, #f59e0b 0%, #f97316 50%, #ef4444 100%)',
                      animationDelay: '50ms'
                    }
                  },
                    // Header section - clickable to critics-picks page
                    React.createElement('button', {
                      className: 'w-full block p-5 pb-4 text-left hover:bg-white/10 transition-colors',
                      onClick: () => { navigateTo('critics-picks'); loadCriticsPicks(); }
                    },
                      React.createElement('svg', { className: 'w-8 h-8 mb-3 opacity-90', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M6 2h12v6a6 6 0 01-12 0V2zM9 21h6M12 14v7M6 4H3v2a3 3 0 003 3M18 4h3v2a3 3 0 01-3 3' })
                      ),
                      React.createElement('h3', { className: 'font-semibold text-lg flex items-center gap-2' },
                        'Critical Darlings',
                        showDiscoveryBadges && discoveryUnread.criticsPicks && React.createElement('span', {
                          className: 'w-2.5 h-2.5 rounded-full bg-white animate-pulse'
                        })
                      ),
                      React.createElement('p', { className: 'text-white/70 text-sm mt-1' }, 'Acclaimed by critics')
                    ),
                    // Most recent album preview - clickable to album page
                    criticsPicks.length > 0 && React.createElement('button', {
                      className: 'w-full flex-1 flex items-center gap-3 p-5 border-t border-white/20 text-left hover:bg-white/10 transition-colors',
                      onClick: (e) => {
                        e.stopPropagation();
                        openCriticsPicksAlbum(criticsPicks[0]);
                      }
                    },
                      React.createElement('div', {
                        className: 'w-12 h-12 rounded-lg overflow-hidden flex-shrink-0',
                        style: { background: 'linear-gradient(135deg, #1f1f1f 0%, #2d2d2d 100%)' }
                      },
                        criticsPicks[0].albumArt
                          ? React.createElement('img', {
                              src: criticsPicks[0].albumArt,
                              alt: criticsPicks[0].title,
                              className: 'w-full h-full object-cover'
                            })
                          : React.createElement('div', { className: 'w-full h-full flex items-center justify-center text-white/40' },
                              React.createElement('svg', { className: 'w-5 h-5', fill: 'currentColor', viewBox: '0 0 24 24' },
                                React.createElement('path', { d: 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z' })
                              )
                            )
                      ),
                      React.createElement('div', { className: 'flex-1 min-w-0' },
                        React.createElement('p', { className: 'text-white/60 text-xs' }, 'Latest review'),
                        React.createElement('p', { className: 'text-white font-medium truncate' }, criticsPicks[0].title),
                        React.createElement('p', { className: 'text-white/70 text-xs truncate' }, criticsPicks[0].artist)
                      )
                    ),
                    // Padding when no preview
                    criticsPicks.length === 0 && React.createElement('div', { className: 'flex-1' })
                  ),

                  // 3. Pop of the Tops / Charts card (orange->pink->purple)
                  React.createElement('div', {
                    className: 'card-fade-up rounded-xl text-left text-white transition-all hover:shadow-lg overflow-hidden flex flex-col',
                    style: {
                      background: 'linear-gradient(135deg, #f97316 0%, #ec4899 50%, #9333ea 100%)',
                      animationDelay: '100ms'
                    }
                  },
                    // Header section - clickable to discover page
                    React.createElement('button', {
                      className: 'w-full block p-5 pb-4 text-left hover:bg-white/10 transition-colors',
                      onClick: () => { navigateTo('discover'); if (cacheLoaded) loadCharts(); }
                    },
                      React.createElement('svg', { className: 'w-8 h-8 mb-3 opacity-90', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' })
                      ),
                      React.createElement('h3', { className: 'font-semibold text-lg flex items-center gap-2' },
                        'Pop of the Tops',
                        showDiscoveryBadges && discoveryUnread.charts && React.createElement('span', {
                          className: 'w-2.5 h-2.5 rounded-full bg-white animate-pulse'
                        })
                      ),
                      React.createElement('p', { className: 'text-white/70 text-sm mt-1' }, 'What everyone\'s playing')
                    ),
                    // #1 album preview - clickable to open the album
                    charts.length > 0 && React.createElement('button', {
                      className: 'w-full flex-1 flex items-center gap-3 p-5 border-t border-white/20 text-left hover:bg-white/10 transition-colors',
                      onClick: (e) => {
                        e.stopPropagation();
                        // Open the #1 chart album with correct field mapping
                        openTopAlbum({ ...charts[0], name: charts[0].title, image: charts[0].albumArt });
                      }
                    },
                      React.createElement('div', {
                        className: 'w-12 h-12 rounded-lg overflow-hidden flex-shrink-0',
                        style: { background: 'linear-gradient(135deg, #1f1f1f 0%, #2d2d2d 100%)' }
                      },
                        charts[0].albumArt
                          ? React.createElement('img', {
                              src: charts[0].albumArt,
                              alt: charts[0].title,
                              className: 'w-full h-full object-cover'
                            })
                          : React.createElement('div', { className: 'w-full h-full flex items-center justify-center text-white/40' },
                              React.createElement('svg', { className: 'w-5 h-5', fill: 'currentColor', viewBox: '0 0 24 24' },
                                React.createElement('path', { d: 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z' })
                              )
                            )
                      ),
                      React.createElement('div', { className: 'flex-1 min-w-0' },
                        React.createElement('p', { className: 'text-white/60 text-xs' }, '#1 Album'),
                        React.createElement('p', { className: 'text-white font-medium truncate' }, charts[0].title),
                        React.createElement('p', { className: 'text-white/70 text-xs truncate' }, charts[0].artist)
                      )
                    ),
                    // Padding when no preview
                    charts.length === 0 && React.createElement('div', { className: 'flex-1' })
                  ),

                  // 4. Fresh Drops / New Releases card (emerald->teal->cyan)
                  React.createElement('div', {
                    className: 'card-fade-up rounded-xl text-left text-white transition-all hover:shadow-lg overflow-hidden flex flex-col',
                    style: {
                      background: 'linear-gradient(135deg, #10b981 0%, #10c9b4 50%, #06b6d4 100%)',
                      animationDelay: '150ms'
                    }
                  },
                    // Header section - clickable to new-releases page
                    React.createElement('button', {
                      className: 'w-full block p-5 pb-4 text-left hover:bg-white/10 transition-colors',
                      onClick: () => { navigateTo('new-releases'); loadNewReleases(); }
                    },
                      React.createElement('svg', { className: 'w-8 h-8 mb-3 opacity-90', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M12 22a7 7 0 0 0 7-7c0-5-7-13-7-13S5 10 5 15a7 7 0 0 0 7 7z' })
                      ),
                      React.createElement('h3', { className: 'font-semibold text-lg flex items-center gap-2' },
                        'Fresh Drops',
                        showDiscoveryBadges && discoveryUnread.newReleases && React.createElement('span', {
                          className: 'w-2.5 h-2.5 rounded-full bg-white animate-pulse'
                        })
                      ),
                      React.createElement('p', { className: 'text-white/70 text-sm mt-1' }, 'New from artists you love')
                    ),
                    // Newest release preview
                    newReleases.length > 0 && React.createElement('button', {
                      className: 'w-full flex-1 flex items-center gap-3 p-5 border-t border-white/20 text-left hover:bg-white/10 transition-colors',
                      onClick: (e) => {
                        e.stopPropagation();
                        openTopAlbum({ ...newReleases[0], name: newReleases[0].title, image: newReleases[0].albumArt, releaseGroupId: newReleases[0].id });
                      }
                    },
                      React.createElement('div', {
                        className: 'w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 relative',
                        style: { background: 'linear-gradient(135deg, #1f1f1f 0%, #2d2d2d 100%)' }
                      },
                        // Always show placeholder underneath
                        React.createElement('div', { className: 'absolute inset-0 flex items-center justify-center text-white/40' },
                          React.createElement('svg', { className: 'w-5 h-5', fill: 'currentColor', viewBox: '0 0 24 24' },
                            React.createElement('path', { d: 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z' })
                          )
                        ),
                        // Overlay image when art URL exists
                        newReleases[0].albumArt && React.createElement('img', {
                          src: newReleases[0].albumArt,
                          alt: newReleases[0].title,
                          className: 'absolute inset-0 w-full h-full object-cover',
                          onError: (e) => { e.target.style.display = 'none'; }
                        })
                      ),
                      React.createElement('div', { className: 'flex-1 min-w-0' },
                        React.createElement('p', { className: 'text-white/60 text-xs' }, 'Latest'),
                        React.createElement('p', { className: 'text-white font-medium truncate' }, newReleases[0].title),
                        React.createElement('p', { className: 'text-white/70 text-xs truncate' }, newReleases[0].artist)
                      )
                    ),
                    // Padding when no preview
                    newReleases.length === 0 && React.createElement('div', { className: 'flex-1' })
                  )
                )
              ),

              // SECTION: AI Recommendations or Surprise Me fallback
              (() => {
                const chatServices = getChatServices();
                const hasEnabledChat = chatServices.some(isServiceEnabled);

                const aiRecs = homeData.aiRecommendations;
                const hasAiRecs = aiRecs && (aiRecs.albums?.length > 0 || aiRecs.artists?.length > 0);

                // Show AI recommendations if loaded
                if (hasAiRecs) {
                  return React.createElement('div', null,
                    // Row 1: Recommended Albums
                    (aiRecs.albums?.length > 0 || aiRecs.loading) && React.createElement('div', { className: 'mb-6' },
                      React.createElement('div', { className: 'flex items-center gap-2 mb-4' },
                        React.createElement('h2', { className: 'text-lg font-semibold text-gray-900' }, 'Album Suggestions'),
                        React.createElement('span', {
                          className: 'px-2 py-0.5 rounded-full text-xs font-medium',
                          style: { backgroundColor: 'var(--accent-surface)', color: 'var(--accent-primary)' }
                        }, 'Shuffleupagus'),
                        React.createElement('button', {
                          className: 'ml-auto p-1.5 text-purple-600 hover:text-purple-700 transition-colors',
                          disabled: aiRecs.loading,
                          title: 'Refresh',
                          onClick: async () => {
                            // Keep existing data visible, just mark as loading
                            setHomeData(prev => ({ ...prev, aiRecommendations: { ...prev.aiRecommendations, loading: true } }));
                            const freshAlbums = [];
                            const onUpdate = ({ artists, newAlbum }) => {
                              if (artists) {
                                setHomeData(prev => ({
                                  ...prev,
                                  aiRecommendations: { ...prev.aiRecommendations, artists }
                                }));
                                for (const artist of artists) {
                                  getArtistImage(artist.name).then(imgResult => {
                                    setHomeData(prev => {
                                      if (!prev.aiRecommendations) return prev;
                                      return { ...prev, aiRecommendations: { ...prev.aiRecommendations, artists: prev.aiRecommendations.artists.map(a => a.name === artist.name ? { ...a, image: imgResult?.url || null } : a) } };
                                    });
                                  }).catch(() => {});
                                }
                              }
                              if (newAlbum) {
                                freshAlbums.push(newAlbum);
                                getAlbumArt(newAlbum.artist, newAlbum.title).then(artUrl => {
                                  if (artUrl) {
                                    const idx = freshAlbums.findIndex(a => a.title === newAlbum.title && a.artist === newAlbum.artist);
                                    if (idx >= 0) freshAlbums[idx] = { ...freshAlbums[idx], art: artUrl };
                                    setHomeData(prev => {
                                      if (!prev.aiRecommendations) return prev;
                                      return { ...prev, aiRecommendations: { ...prev.aiRecommendations, albums: prev.aiRecommendations.albums.map(a => a.title === newAlbum.title && a.artist === newAlbum.artist ? { ...a, art: artUrl } : a) } };
                                    });
                                  }
                                }).catch(() => {});
                              }
                            };
                            const result = await loadAiRecommendations(onUpdate);
                            if (result) {
                              setHomeData(prev => ({
                                ...prev,
                                aiRecommendations: {
                                  ...prev.aiRecommendations,
                                  albums: freshAlbums.length > 0 ? freshAlbums : (prev.aiRecommendations?.albums || []),
                                  loading: false
                                }
                              }));
                            } else {
                              // Keep cached data visible on failure
                              setHomeData(prev => {
                                const existing = prev.aiRecommendations;
                                if (existing?.albums?.length > 0 || existing?.artists?.length > 0) {
                                  return { ...prev, aiRecommendations: { ...existing, loading: false } };
                                }
                                return { ...prev, aiRecommendations: null };
                              });
                            }
                          }
                        },
                          React.createElement('svg', { className: 'w-4 h-4' + (aiRecs.loading ? ' animate-spin' : ''), fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M20 4v5h-.582m-15.356 2A8.001 8.001 0 0119.418 9m0 0H15m-11 11v-5h.581m0 0a8.003 8.003 0 0015.357-2m-15.357 2H9' })
                          )
                        )
                      ),
                      React.createElement('div', {
                        className: 'grid grid-cols-5 gap-4'
                      },
                        ...aiRecs.albums.map((album, index) =>
                          React.createElement('button', {
                            key: `ai-album-${album.artist}-${album.title}`,
                            className: 'group text-left release-card card-fade-up',
                            style: {
                              padding: '10px',
                              borderRadius: '10px',
                              backgroundColor: 'var(--card-bg)',
                              border: 'none',
                              boxShadow: 'var(--card-shadow)',
                              animationDelay: `${index * 50}ms`
                            },
                            onClick: () => handleCollectionAlbumClick({ title: album.title, artist: album.artist }),
                            onContextMenu: (e) => {
                              e.preventDefault();
                              if (window.electron?.contextMenu?.showTrackMenu) {
                                const albumTracks = (collectionData?.tracks || [])
                                  .filter(t => t.artist === album.artist && t.album === album.title)
                                  .sort((a, b) => (a.trackNumber || 0) - (b.trackNumber || 0));
                                window.electron.contextMenu.showTrackMenu({
                                  type: 'release',
                                  name: album.title,
                                  album: {
                                    title: album.title,
                                    artist: album.artist,
                                    art: album.art || null
                                  },
                                  tracks: albumTracks
                                });
                              }
                            }
                          },
                            React.createElement('div', {
                              className: 'album-art-container group/art',
                              style: {
                                width: '100%',
                                aspectRatio: '1',
                                borderRadius: '6px',
                                marginBottom: '10px',
                                overflow: 'hidden',
                                position: 'relative',
                                background: album.art
                                  ? 'var(--placeholder-bg-light)'
                                  : 'linear-gradient(145deg, #1f1f1f 0%, #2d2d2d 50%, #1a1a1a 100%)'
                              }
                            },
                              // Show image when art exists
                              album.art && React.createElement('img', {
                                src: album.art,
                                alt: album.title,
                                className: 'group-hover/art:scale-105',
                                style: {
                                  width: '100%',
                                  height: '100%',
                                  objectFit: 'cover',
                                  transition: 'opacity 0.35s ease-out, transform 0.3s ease'
                                }
                              }),
                              // Placeholder icon when no art
                              !album.art && React.createElement('div', {
                                style: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }
                              },
                                React.createElement('svg', {
                                  style: { width: '36px', height: '36px', color: 'rgba(255, 255, 255, 0.2)' },
                                  fill: 'none',
                                  viewBox: '0 0 24 24',
                                  stroke: 'currentColor'
                                },
                                  React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3' })
                                )
                              ),
                              // Hover overlay with action buttons
                              React.createElement('div', {
                                className: 'absolute inset-0 bg-black/50 opacity-0 group-hover/art:opacity-100 pointer-events-none group-hover/art:pointer-events-auto transition-opacity duration-200 flex items-center justify-center gap-3',
                                style: { borderRadius: '6px', zIndex: 20 }
                              },
                                // Add to Playlist button
                                React.createElement('button', {
                                  onClick: async (e) => {
                                    e.stopPropagation();
                                    let albumTracks = (collectionData?.tracks || [])
                                      .filter(t => t.artist === album.artist && t.album === album.title)
                                      .sort((a, b) => (a.trackNumber || 0) - (b.trackNumber || 0));
                                    if (albumTracks.length === 0) {
                                      showToast(`Loading ${album.title} tracks...`, 'info');
                                      albumTracks = await fetchAlbumTracksFromMusicBrainz(album.artist, album.title, album.art);
                                    }
                                    if (albumTracks.length > 0) {
                                      setAddToPlaylistPanel({
                                        open: true,
                                        tracks: albumTracks,
                                        sourceName: `${album.title} by ${album.artist}`,
                                        sourceType: 'album'
                                      });
                                    } else {
                                      showToast('Could not load album tracks', 'error');
                                    }
                                  },
                                  className: 'w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-110',
                                  style: { backgroundColor: 'rgba(255, 255, 255, 0.15)', color: '#ffffff', border: 'none', cursor: 'pointer' },
                                  onMouseEnter: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.25)',
                                  onMouseLeave: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.15)',
                                  title: 'Add to Playlist'
                                },
                                  React.createElement('svg', { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2 },
                                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M12 4v16m8-8H4' })
                                  )
                                ),
                                // Play album button
                                React.createElement('button', {
                                  onClick: async (e) => {
                                    e.stopPropagation();
                                    let albumTracks = (collectionData?.tracks || [])
                                      .filter(t => t.artist === album.artist && t.album === album.title)
                                      .sort((a, b) => (a.trackNumber || 0) - (b.trackNumber || 0));
                                    if (albumTracks.length === 0) {
                                      showToast(`Loading ${album.title}...`, 'info');
                                      albumTracks = await fetchAlbumTracksFromMusicBrainz(album.artist, album.title, album.art);
                                    }
                                    if (albumTracks.length > 0) {
                                      playTrackCollection(albumTracks, { type: 'album', name: album.title, artist: album.artist });
                                    } else {
                                      showToast('Could not load album tracks', 'error');
                                    }
                                  },
                                  className: 'w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-110',
                                  style: { border: 'none', cursor: 'pointer' },
                                  title: 'Play album'
                                },
                                  React.createElement(Play, { size: 22, className: 'text-gray-800 ml-0.5' })
                                ),
                                // Add to queue button
                                React.createElement('button', {
                                  onClick: async (e) => {
                                    e.stopPropagation();
                                    let albumTracks = (collectionData?.tracks || [])
                                      .filter(t => t.artist === album.artist && t.album === album.title)
                                      .sort((a, b) => (a.trackNumber || 0) - (b.trackNumber || 0));
                                    if (albumTracks.length === 0) {
                                      showToast(`Loading ${album.title} tracks...`, 'info');
                                      albumTracks = await fetchAlbumTracksFromMusicBrainz(album.artist, album.title, album.art);
                                    }
                                    if (albumTracks.length > 0) {
                                      addToQueue(albumTracks, { type: 'album', name: album.title, artist: album.artist });
                                      showToast(`Added ${albumTracks.length} tracks from ${album.title}`, 'success');
                                    } else {
                                      showToast('Could not load album tracks', 'error');
                                    }
                                  },
                                  className: 'w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-110',
                                  style: { backgroundColor: 'rgba(255, 255, 255, 0.15)', color: '#ffffff', border: 'none', cursor: 'pointer' },
                                  onMouseEnter: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.25)',
                                  onMouseLeave: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.15)',
                                  title: 'Add album to queue'
                                },
                                  React.createElement('svg', { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2 },
                                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M4 6h16M4 12h16M4 18h7' })
                                  )
                                )
                              )
                            ),
                            // Album title + artist with reason tooltip
                            React.createElement(FixedTooltip, { content: album.reason },
                              React.createElement('div', null,
                                React.createElement('h3', {
                                  style: {
                                    fontWeight: '500',
                                    fontSize: '13px',
                                    color: 'var(--text-primary)',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    marginBottom: '2px'
                                  }
                                }, album.title),
                                React.createElement('p', {
                                  style: { fontSize: '12px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
                                }, album.artist)
                              )
                            )
                          )
                        ),
                        // Skeleton placeholders for remaining album slots while loading
                        ...(aiRecs.loading ? Array.from({ length: Math.max(0, 5 - (aiRecs.albums?.length || 0)) }).map((_, i) =>
                          React.createElement('div', {
                            key: `ai-album-skeleton-${i}`,
                            style: {
                              backgroundColor: 'var(--card-bg)',
                              borderRadius: '10px',
                              padding: '10px',
                              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)'
                            }
                          },
                            React.createElement('div', {
                              className: 'aspect-square rounded-md mb-2 animate-shimmer',
                              style: { background: 'linear-gradient(to right, var(--shimmer-from), var(--shimmer-via), var(--shimmer-to))' }
                            }),
                            React.createElement('div', { className: 'h-4 rounded mb-2 animate-shimmer', style: { background: 'linear-gradient(to right, var(--shimmer-from), var(--shimmer-via), var(--shimmer-to))', width: '80%' } }),
                            React.createElement('div', { className: 'h-3 rounded animate-shimmer', style: { background: 'linear-gradient(to right, var(--shimmer-from), var(--shimmer-via), var(--shimmer-to))', width: '60%' } })
                          )
                        ) : [])
                      )
                    ),
                    // Row 2: Recommended Artists
                    aiRecs.artists?.length > 0 && React.createElement('div', null,
                      React.createElement('div', { className: 'flex items-center gap-2 mb-4' },
                        React.createElement('h2', { className: 'text-lg font-semibold text-gray-900' }, 'Artist Suggestions'),
                        React.createElement('span', {
                          className: 'px-2 py-0.5 rounded-full text-xs font-medium',
                          style: { backgroundColor: 'var(--accent-surface)', color: 'var(--accent-primary)' }
                        }, 'Shuffleupagus')
                      ),
                      React.createElement('div', {
                        className: 'grid grid-cols-5 gap-4'
                      },
                        aiRecs.artists.map((artist, index) =>
                          React.createElement('div', {
                            key: `ai-artist-${artist.name}`,
                            className: 'rounded-lg overflow-hidden cursor-pointer group release-card card-fade-up',
                            style: {
                              backgroundColor: 'var(--card-bg)',
                              boxShadow: 'var(--card-shadow)',
                              animationDelay: `${index * 50}ms`
                            },
                            onClick: () => fetchArtistData(artist.name)
                          },
                            React.createElement('div', {
                              className: 'aspect-square relative group/art overflow-hidden',
                              style: { background: artist.image === null ? generateArtistPattern(artist.name).gradient : 'var(--placeholder-bg)' }
                            },
                              // Loading shimmer
                              artist.image === undefined && React.createElement('div', {
                                className: 'absolute inset-0 shimmer-strong animate-shimmer',
                                style: { backgroundSize: '200% 100%' }
                              }),
                              // Artist image
                              typeof artist.image === 'string' && React.createElement('img', {
                                src: artist.image,
                                alt: artist.name,
                                className: 'absolute inset-0 w-full h-full object-cover transition-all duration-300 group-hover/art:scale-105',
                                style: { opacity: 0 },
                                ref: (el) => { if (el && el.complete && el.naturalWidth > 0) el.style.opacity = '1'; },
                                onLoad: (e) => { e.target.style.opacity = '1'; },
                                onError: (e) => { e.target.style.display = 'none'; }
                              }),
                              // Initials fallback
                              artist.image === null && React.createElement('div', {
                                className: 'absolute inset-0 flex items-center justify-center',
                                style: { color: generateArtistPattern(artist.name).textColor, opacity: 0.4 }
                              },
                                React.createElement('span', {
                                  className: 'font-bold tracking-wider',
                                  style: { fontSize: '2.5rem', textShadow: '0 2px 8px rgba(0,0,0,0.3)' }
                                }, generateArtistPattern(artist.name).initials)
                              ),
                              // Hover overlay with action buttons (Play top 10, Queue top 10)
                              React.createElement('div', {
                                className: 'absolute inset-0 bg-black/50 opacity-0 group-hover/art:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-3',
                                style: { pointerEvents: 'auto' }
                              },
                                // Play top 10 button (center, larger)
                                React.createElement('button', {
                                  onClick: (e) => {
                                    e.stopPropagation();
                                    (async () => {
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
                                    })();
                                  },
                                  className: 'w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-110',
                                  style: { border: 'none', cursor: 'pointer' },
                                  title: 'Play top 10 tracks'
                                },
                                  React.createElement(PlayTop10Icon, { size: 26, className: 'text-gray-800' })
                                ),
                                // Add top 10 to Queue button
                                React.createElement('button', {
                                  onClick: (e) => {
                                    e.stopPropagation();
                                    (async () => {
                                      const tracks = await getArtistTopTracks(artist.name);
                                      if (tracks.length > 0) {
                                        addToQueue(tracks, { type: 'artist', name: artist.name });
                                        showToast(`Added ${tracks.length} tracks from ${artist.name}`, 'success');
                                      } else {
                                        showToast(`No top tracks found for ${artist.name}`, 'error');
                                      }
                                    })();
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
                            // Artist name section with reason tooltip
                            React.createElement(FixedTooltip, { content: artist.reason },
                              React.createElement('div', { className: 'p-3' },
                                React.createElement('p', {
                                  className: 'font-medium text-gray-900 truncate text-sm'
                                }, artist.name)
                              )
                            )
                          )
                        )
                      )
                    )
                  );
                }

                // Loading state - show skeleton
                if (aiRecs?.loading) {
                  return React.createElement('div', null,
                    React.createElement('div', { className: 'flex items-center gap-2 mb-4' },
                      React.createElement('h2', { className: 'text-lg font-semibold text-gray-900' }, 'Album Suggestions'),
                      React.createElement('span', {
                        className: 'px-2 py-0.5 rounded-full text-xs font-medium',
                        style: { backgroundColor: 'var(--accent-surface)', color: 'var(--accent-primary)' }
                      }, 'Shuffleupagus')
                    ),
                    React.createElement('div', { className: 'grid grid-cols-5 gap-4 mb-6' },
                      Array.from({ length: 5 }).map((_, i) =>
                        React.createElement('div', {
                          key: `ai-album-skeleton-${i}`,
                          style: {
                            backgroundColor: 'var(--card-bg)',
                            borderRadius: '10px',
                            padding: '10px',
                            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)'
                          }
                        },
                          React.createElement('div', {
                            className: 'aspect-square rounded-md mb-2 animate-shimmer',
                            style: { background: 'linear-gradient(to right, var(--shimmer-from), var(--shimmer-via), var(--shimmer-to))' }
                          }),
                          React.createElement('div', { className: 'h-4 rounded mb-2 animate-shimmer', style: { background: 'linear-gradient(to right, var(--shimmer-from), var(--shimmer-via), var(--shimmer-to))', width: '80%' } }),
                          React.createElement('div', { className: 'h-3 rounded animate-shimmer', style: { background: 'linear-gradient(to right, var(--shimmer-from), var(--shimmer-via), var(--shimmer-to))', width: '60%' } })
                        )
                      )
                    ),
                    React.createElement('div', { className: 'flex items-center gap-2 mb-4' },
                      React.createElement('h2', { className: 'text-lg font-semibold text-gray-900' }, 'Artist Suggestions'),
                      React.createElement('span', {
                        className: 'px-2 py-0.5 rounded-full text-xs font-medium',
                        style: { backgroundColor: 'var(--accent-surface)', color: 'var(--accent-primary)' }
                      }, 'Shuffleupagus')
                    ),
                    React.createElement('div', { className: 'grid grid-cols-5 gap-4' },
                      Array.from({ length: 5 }).map((_, i) =>
                        React.createElement('div', {
                          key: `ai-artist-skeleton-${i}`,
                          style: {
                            backgroundColor: 'var(--card-bg)',
                            borderRadius: '10px',
                            padding: '10px',
                            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)'
                          }
                        },
                          React.createElement('div', {
                            className: 'aspect-square rounded-lg mb-2 animate-shimmer',
                            style: { background: 'linear-gradient(to right, var(--shimmer-from), var(--shimmer-via), var(--shimmer-to))' }
                          }),
                          React.createElement('div', { className: 'h-4 rounded animate-shimmer', style: { background: 'linear-gradient(to right, var(--shimmer-from), var(--shimmer-via), var(--shimmer-to))', width: '70%' } })
                        )
                      )
                    )
                  );
                }

                // Fallback: original Surprise Me card
                return React.createElement('div', {
                  className: 'p-6 rounded-xl text-center',
                  style: {
                    background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4c1d95 100%)'
                  }
                },
                  React.createElement('div', { className: 'inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/10 mb-4' },
                    React.createElement('svg', { className: 'w-8 h-8 text-white', viewBox: '0 0 56 56', fill: 'currentColor' },
                      React.createElement('path', { d: 'M 26.6875 12.6602 C 26.9687 12.6602 27.1094 12.4961 27.1797 12.2383 C 27.9062 8.3242 27.8594 8.2305 31.9375 7.4570 C 32.2187 7.4102 32.3828 7.2461 32.3828 6.9648 C 32.3828 6.6836 32.2187 6.5195 31.9375 6.4726 C 27.8828 5.6524 28.0000 5.5586 27.1797 1.6914 C 27.1094 1.4336 26.9687 1.2695 26.6875 1.2695 C 26.4062 1.2695 26.2656 1.4336 26.1953 1.6914 C 25.3750 5.5586 25.5156 5.6524 21.4375 6.4726 C 21.1797 6.5195 20.9922 6.6836 20.9922 6.9648 C 20.9922 7.2461 21.1797 7.4102 21.4375 7.4570 C 25.5156 8.2774 25.4687 8.3242 26.1953 12.2383 C 26.2656 12.4961 26.4062 12.6602 26.6875 12.6602 Z M 15.3438 28.7852 C 15.7891 28.7852 16.0938 28.5039 16.1406 28.0821 C 16.9844 21.8242 17.1953 21.8242 23.6641 20.5821 C 24.0860 20.5117 24.3906 20.2305 24.3906 19.7852 C 24.3906 19.3633 24.0860 19.0586 23.6641 18.9883 C 17.1953 18.0977 16.9609 17.8867 16.1406 11.5117 C 16.0938 11.0899 15.7891 10.7852 15.3438 10.7852 C 14.9219 10.7852 14.6172 11.0899 14.5703 11.5352 C 13.7969 17.8164 13.4687 17.7930 7.0469 18.9883 C 6.6250 19.0821 6.3203 19.3633 6.3203 19.7852 C 6.3203 20.2539 6.6250 20.5117 7.1406 20.5821 C 13.5156 21.6133 13.7969 21.7774 14.5703 28.0352 C 14.6172 28.5039 14.9219 28.7852 15.3438 28.7852 Z M 31.2344 54.7305 C 31.8438 54.7305 32.2891 54.2852 32.4062 53.6524 C 34.0703 40.8086 35.8750 38.8633 48.5781 37.4570 C 49.2344 37.3867 49.6797 36.8945 49.6797 36.2852 C 49.6797 35.6758 49.2344 35.2070 48.5781 35.1133 C 35.8750 33.7070 34.0703 31.7617 32.4062 18.9180 C 32.2891 18.2852 31.8438 17.8633 31.2344 17.8633 C 30.6250 17.8633 30.1797 18.2852 30.0860 18.9180 C 28.4219 31.7617 26.5938 33.7070 13.9140 35.1133 C 13.2344 35.2070 12.7891 35.6758 12.7891 36.2852 C 12.7891 36.8945 13.2344 37.3867 13.9140 37.4570 C 26.5703 39.1211 28.3281 40.8321 30.0860 53.6524 C 30.1797 54.2852 30.6250 54.7305 31.2344 54.7305 Z' })
                    )
                  ),
                  React.createElement('h3', { className: 'text-xl font-bold text-white mb-2' }, 'Surprise Me'),
                  React.createElement('p', { className: 'text-white/70 text-sm mb-4 max-w-md mx-auto' },
                    hasEnabledChat
                      ? 'Shuffleupagus, your AI companion, can recommend music, provide insights, control your playback experience and integrates with other AI agents so they can control it too.'
                      : 'Shuffleupagus, your AI companion, can recommend music, provide insights, control your playback experience and integrates with other AI agents so they can control it too. Enable at least one AI plug-in (like ChatGPT, Gemini, or Claude) to get started.'
                  ),
                  hasEnabledChat
                    ? React.createElement('button', {
                        className: 'px-6 py-2.5 bg-white text-purple-700 font-semibold rounded-full hover:bg-purple-50 transition-colors',
                        onClick: () => {
                          openAiChat();
                        }
                      }, 'Chat with Shuffleupagus')
                    : React.createElement('button', {
                        className: 'px-6 py-2.5 bg-white/20 text-white font-semibold rounded-full hover:bg-white/30 transition-colors',
                        onClick: () => {
                          navigateTo('settings');
                          setSettingsTab('plugins');
                        }
                      }, 'Set Up AI Plug-in')
                );
              })(),

              // SECTION: Collection Stats & Sync
              (() => {
                const hasSyncEnabled = Object.values(resolverSyncSettings).some(s => s?.enabled);
                const statsGrid = React.createElement('div', { className: 'grid grid-cols-2 md:grid-cols-5 gap-4 mt-4' },
                  [
                    { label: 'Songs', value: library.length + collectionData.tracks.length, icon: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z', color: '#3b82f6', onClick: () => { navigateTo('library'); setCollectionTab('tracks'); } },
                    { label: 'Albums', value: collectionData.albums.length, icon: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3', color: 'var(--accent-secondary)', onClick: () => { navigateTo('library'); setCollectionTab('albums'); } },
                    { label: 'Artists', value: collectionData.artists.length, icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z', color: '#ec4899', onClick: () => { navigateTo('library'); setCollectionTab('artists'); } },
                    { label: 'Playlists', value: playlists.length, icon: 'M4 6h16M4 10h16M4 14h16M4 18h16', color: '#f59e0b', onClick: () => navigateTo('playlists') },
                    { label: 'Friends', value: friends.length, icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z', color: '#10b981', onClick: () => { navigateTo('library'); setCollectionTab('friends'); } }
                  ].map((stat, index) =>
                    React.createElement('button', {
                      key: stat.label,
                      className: 'release-card card-fade-up p-4 text-left',
                      style: {
                        backgroundColor: 'var(--card-bg)',
                        borderRadius: '10px',
                        border: 'none',
                        boxShadow: 'var(--card-shadow)',
                        animationDelay: `${index * 50}ms`
                      },
                      onClick: stat.onClick
                    },
                      React.createElement('div', {
                        className: 'w-10 h-10 rounded-lg flex items-center justify-center mb-3',
                        style: { backgroundColor: `${stat.color}15` }
                      },
                        React.createElement('svg', { className: 'w-5 h-5', style: { color: stat.color }, fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: stat.icon })
                        )
                      ),
                      React.createElement('p', { className: 'text-2xl font-bold text-gray-900' }, stat.value),
                      React.createElement('p', { className: 'text-sm text-gray-500' }, stat.label)
                    )
                  )
                );

                const sectionHeader = React.createElement('h2', { className: 'text-lg font-semibold text-gray-900' }, 'Collection');

                // When sync is already enabled, just show the stats grid
                if (hasSyncEnabled) return React.createElement('div', null, sectionHeader, statsGrid);

                // When sync is not enabled, wrap stats inside the sync container
                return React.createElement('div', null, sectionHeader, React.createElement('div', {
                  className: 'rounded-xl overflow-hidden mt-4',
                  style: {
                    background: 'var(--bg-inset)',
                    border: '1px solid var(--border-subtle)'
                  }
                },
                  React.createElement('div', { className: 'p-5' },
                    React.createElement('div', { className: 'flex items-center gap-2 mb-1' },
                      React.createElement('svg', { className: 'w-5 h-5 text-green-600', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M20 4v5h-.582m-15.356 2A8.001 8.001 0 0119.418 9m0 0H15m-11 11v-5h.581m0 0a8.003 8.003 0 0015.357-2m-15.357 2H9' })
                      ),
                      React.createElement('h3', { className: 'text-base font-semibold text-gray-900' }, 'Sync Your Collection')
                    ),
                    React.createElement('p', { className: 'text-sm text-gray-500 mb-4' },
                      'Import your saved music from Spotify or Apple Music to build your Parachord collection. Your library stays in sync automatically.'
                    ),
                    statsGrid,
                    React.createElement('div', { className: 'flex gap-3 mt-4' },
                      React.createElement('button', {
                        className: 'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90',
                        style: { backgroundColor: '#1DB954', border: 'none', cursor: 'pointer' },
                        onClick: () => openSyncSetupModal('spotify')
                      },
                        React.createElement('svg', { style: { width: '16px', height: '16px' }, viewBox: '0 0 24 24', fill: '#ffffff' },
                          React.createElement('path', { d: 'M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z' })
                        ),
                        'Sync Spotify'
                      ),
                      React.createElement('button', {
                        className: 'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90',
                        style: { backgroundColor: '#FA243C', border: 'none', cursor: 'pointer' },
                        onClick: () => openSyncSetupModal('applemusic')
                      },
                        React.createElement('svg', { style: { width: '16px', height: '16px' }, viewBox: '0 0 122.88 122.88', fill: '#ffffff' },
                          React.createElement('path', { d: 'M47.76,86.16v-38.4c0-1.44,0.8-2.32,2.4-2.64l33.12-6.72c1.76-0.32,2.72,0.48,2.88,2.4v29.28c0,2.4-3.6,4-10.8,4.8c-13.68,2.16-11.52,25.2,7.2,18.96c7.2-2.64,8.4-9.6,8.4-16.56V21.12c0,0,0-4.8-4.08-3.6l-40.8,8.4c0,0-3.12,0.48-3.12,4.32v48.72c0,2.4-3.6,4-10.8,4.8c-13.68,2.16-11.52,25.2,7.2,18.96C46.56,100.08,47.76,93.12,47.76,86.16z' })
                        ),
                        'Sync Apple Music'
                      )
                    )
                  )
                ));
              })()
            )
          )
        );
});

module.exports = { HomePage, HOME_PAGE_HANDLERS };
