// src/renderer/components/artist-page.js — the artist page (header, tabs:
// music / bio / related / concerts, the discography grid) and its release
// drilldown (ReleasePage), moved out of the Parachord component
// (maintainability plan Track 2b, fourth state-domain slice; the others are
// collection-page.js, home-page.js and playlist-view-page.js). It is open
// through album playback and discography browsing, so every Parachord
// setState used to re-render its ~1,900 lines.
//
// React.memo, fed only stable props: state values, useState setters, refs,
// useCallback/useMemo results (artistSortOptions and resolvers were literals
// rebuilt on every render and are useMemo now), primitives, and Parachord's
// plain functions as stable wrappers (useStableHandlers in app.js; the list
// is ARTIST_PAGE_HANDLERS). `_metaServiceConfigs` is not read here:
// getLastfmApiKey() reads it during this render through its stable wrapper,
// so it is passed only to invalidate the memo. The refs used here are only
// touched inside callback refs and handlers, never read to decide what
// renders. tests/renderer/page-memo.test.js checks the call site.
//
// The body is the original render expression, unchanged: it reads its inputs
// from props under their old names.

const { Tooltip } = require('./ui-atoms');
const { ReleasePage, ReleaseCard, generateArtistPattern, PlayTop10Icon, QueueTop10Icon } = require('./cards');
const { trackSlug } = require('../lib/track-slug');
const { generateArtistId } = require('../lib/collection-ids');
const { parseBioMarkup } = require('../lib/discogs-markup');

// Plain functions from Parachord, passed as stable wrappers.
const ARTIST_PAGE_HANDLERS = [
  'addToQueue',
  'copyParachordLink',
  'fetchArtistData',
  'fetchReleaseData',
  'getArtistBio',
  'getArtistTopTracks',
  'getLastfmApiKey',
  'getRelatedArtists',
  'handlePlay',
  'handlePlaylistDragEnd',
  'handleSearchInput',
  'loadArtistConcerts',
  'prefetchReleaseTracks',
  'reprioritizeAlbumArtQueue',
  'resolveRelatedArtistImages',
  'setQueueWithContext',
];

const ArtistPage = React.memo(function ArtistPage(props) {
  const {
    activeResolvers,
    addArtistToCollection,
    addToQueue,
    albumArtObserver,
    albumArtQueue,
    artistBio,
    artistConcerts,
    artistConcertsLoaded,
    artistConcertsLoading,
    artistConcertsTicketFlyout,
    artistExtendedInfo,
    artistImage,
    artistImagePosition,
    artistPageScrollRef,
    artistPageTab,
    artistReleases,
    artistSearch,
    artistSearchOpen,
    artistSort,
    artistSortDropdownOpen,
    artistSortOptions,
    collectionData,
    copyCollectionEmbedCode,
    copyParachordLink,
    currentArtist,
    currentRelease,
    currentTrack,
    effectiveTheme,
    fetchArtistData,
    fetchReleaseData,
    filterArtistReleases,
    getArtistBio,
    getArtistTopTracks,
    getLastfmApiKey,
    getRelatedArtists,
    handleArtistPageScroll,
    handlePlay,
    handlePlaylistDragEnd,
    handleSearchInput,
    isCompactHeader,
    isHeaderCollapsed,
    isPlaying,
    loadArtistConcerts,
    loadingArtist,
    loadingBio,
    loadingExtendedInfo,
    loadingRelated,
    loadingRelease,
    playbackContext,
    prefetchReleaseTracks,
    prefetchedReleasesRef,
    publishCollectionSmartLink,
    relatedArtists,
    relatedArtistsSourceFilter,
    releaseObserverRef,
    releaseTrackRowRefs,
    releaseTypeFilter,
    removeArtistFromCollection,
    reprioritizeAlbumArtQueue,
    resolveRelatedArtistImages,
    resolvers,
    setAddToPlaylistPanel,
    setArtistBio,
    setArtistConcertsTicketFlyout,
    setArtistPageTab,
    setArtistSearch,
    setArtistSearchOpen,
    setArtistSort,
    setArtistSortDropdownOpen,
    setCurrentRelease,
    setDraggingTrackForPlaylist,
    setIsHeaderCollapsed,
    setLoadingBio,
    setQueueWithContext,
    setRelatedArtists,
    setRelatedArtistsSourceFilter,
    setReleaseTypeFilter,
    setSelectedPlaylistsForAdd,
    setShareDropdownOpen,
    setTrackLoading,
    shareDropdownOpen,
    showToast,
    sortArtistReleases,
    trackSources,
    visibleAlbumIds,
  } = props;
  return React.createElement('div', { 
        className: 'flex-1 flex flex-col',
        style: { overflow: 'hidden' }
      },
        // Artist page hero header (not inside scrollable area) - only show when NOT viewing or loading a release
        // Clickable to toggle collapse state
        !currentRelease && !loadingRelease && React.createElement('div', {
          className: 'relative',
          style: {
            height: isHeaderCollapsed ? '80px' : '320px',
            flexShrink: 0,
            transition: 'height 300ms ease-out',
            overflow: 'hidden',
            cursor: isHeaderCollapsed ? 'pointer' : 'default'
          },
        },
          // Clickable overlay to expand collapsed header (sits behind content)
          isHeaderCollapsed && React.createElement('div', {
            className: 'absolute inset-0 z-0',
            style: { cursor: 'pointer' },
            onClick: () => setIsHeaderCollapsed(false),
            title: 'Click to expand'
          }),
          // Background image with gradient overlay
          artistImage && React.createElement('div', {
            className: 'absolute inset-0',
            style: {
              backgroundImage: `url(${artistImage})`,
              backgroundSize: 'cover',
              backgroundPosition: artistImagePosition,
              filter: 'blur(0px)',
              pointerEvents: 'none'
            }
          }),
          // Gradient overlay for readability
          React.createElement('div', {
            className: 'absolute inset-0',
            style: {
              background: artistImage
                ? isHeaderCollapsed
                  ? 'linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, rgba(17,17,17,0.95) 100%)'
                  : 'linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.6) 50%, rgba(17,17,17,1) 100%)'
                : 'linear-gradient(to bottom, rgba(60,60,80,0.4) 0%, rgba(17,17,17,1) 100%)',
              pointerEvents: 'none'
            }
          }),
          // EXPANDED STATE - Artist info overlay (centered)
          !loadingRelease && currentArtist && !isHeaderCollapsed && React.createElement('div', {
            className: 'absolute inset-0 flex flex-col items-center justify-center text-center px-6 z-10',
            style: {
              opacity: isHeaderCollapsed ? 0 : 1,
              transition: 'opacity 300ms ease-out'
            }
          },
            // Artist name with star button (star positioned absolutely to not affect centering)
            React.createElement('div', {
              className: 'relative inline-flex items-center'
            },
              React.createElement('h1', {
                className: 'text-5xl font-light text-white',
                style: {
                  textShadow: '0 2px 20px rgba(0,0,0,0.5)',
                  letterSpacing: '0.3em',
                  textTransform: 'uppercase'
                },
                onContextMenu: copyParachordLink
              }, currentArtist.name),
              // Star button to add/remove artist from collection (absolute positioned wrapper)
              (() => {
                const artistId = generateArtistId(currentArtist.name);
                const isInCollection = collectionData.artists.some(a => a.id === artistId);
                return React.createElement('div', {
                  className: 'absolute -right-10 top-1/2 -translate-y-1/2'
                },
                  React.createElement(Tooltip, {
                    content: isInCollection ? 'Remove from collection' : 'Add to collection',
                    position: 'top',
                    variant: 'dark'
                  },
                    React.createElement('button', {
                      onClick: (e) => {
                        e.stopPropagation();
                        if (!isInCollection) {
                          addArtistToCollection({ name: currentArtist.name, image: artistImage });
                        } else {
                          removeArtistFromCollection({ name: currentArtist.name });
                        }
                      },
                      className: `p-1.5 rounded-full transition-colors no-drag ${isInCollection ? 'text-yellow-400 hover:text-yellow-300' : 'text-white/70 hover:text-white'}`,
                      style: { filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))' }
                    },
                      React.createElement('svg', {
                        className: 'w-6 h-6',
                        viewBox: '0 0 24 24',
                        fill: isInCollection ? 'currentColor' : 'none',
                        stroke: 'currentColor',
                        strokeWidth: 1.5,
                        strokeLinecap: 'round',
                        strokeLinejoin: 'round'
                      },
                        React.createElement('polygon', {
                          points: '12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26'
                        })
                      )
                    )
                  )
                );
              })()
            ),
            // Navigation tabs (centered)
            React.createElement('div', {
              className: 'flex items-center gap-1 mt-6',
              style: { textShadow: '0 2px 12px rgba(0,0,0,0.8), 0 0 20px rgba(0,0,0,0.4)' }
            },
              (() => {
                const showOnTour = (artistConcertsLoaded && artistConcerts.length > 0) || artistPageTab === 'on-tour';
                return ['music', 'biography', 'related', 'on-tour'].map((tab, index) => {
                  const isOnTour = tab === 'on-tour';
                  const hidden = isOnTour && !showOnTour;
                  return [
                    index > 0 && React.createElement('span', {
                      key: `sep-${tab}`,
                      className: 'text-white/30 mx-2',
                      style: isOnTour ? {
                        opacity: showOnTour ? 1 : 0,
                        maxWidth: showOnTour ? '20px' : '0px',
                        overflow: 'hidden',
                        transition: 'opacity 0.4s ease, max-width 0.4s ease'
                      } : undefined
                    }, '|'),
                    React.createElement('button', {
                      key: tab,
                      onClick: async () => {
                        if (hidden) return;
                        setArtistPageTab(tab);
                        // Lazy load data when tab is first clicked
                        if (tab === 'biography' && artistBio === null && !loadingBio && currentArtist) {
                          setLoadingBio(true);
                          const bioData = await getArtistBio(currentArtist.name, currentArtist.mbid);
                          setArtistBio(bioData === null ? false : bioData);
                        }
                        if (tab === 'related' && relatedArtists.length === 0 && currentArtist) {
                          const related = await getRelatedArtists(currentArtist.name, currentArtist.mbid);
                          if (related.length > 0) { setRelatedArtists(related); resolveRelatedArtistImages(related); }
                        }
                      },
                      className: `py-1 text-sm font-medium uppercase tracking-wider transition-colors no-drag ${
                        artistPageTab === tab
                          ? 'text-white'
                          : 'text-white/60 hover:text-white'
                      }`,
                      style: isOnTour ? {
                        opacity: showOnTour ? 1 : 0,
                        maxWidth: showOnTour ? '200px' : '0px',
                        overflow: 'hidden',
                        padding: showOnTour ? '0.25rem 0.5rem' : '0.25rem 0',
                        transition: 'opacity 0.4s ease, max-width 0.4s ease, padding 0.4s ease',
                        whiteSpace: 'nowrap'
                      } : { padding: '0.25rem 0.5rem' }
                    }, tab === 'related' ? 'Related Artists' : tab === 'on-tour' ? 'On Tour' : tab.charAt(0).toUpperCase() + tab.slice(1))
                  ];
                }).flat().filter(Boolean);
              })()
            ),
            // Play Top Tracks button - responsive sizing
            React.createElement('button', {
              onClick: async () => {
                if (!currentArtist) return;
                setTrackLoading(true);
                const tracks = await getArtistTopTracks(currentArtist.name);
                if (tracks.length > 0) {
                  const context = { type: 'artist', name: currentArtist.name };
                  const [firstTrack, ...remainingTracks] = tracks;
                  const taggedFirstTrack = { ...firstTrack, _playbackContext: context };
                  setQueueWithContext(remainingTracks, context, true);
                  handlePlay(taggedFirstTrack);
                } else {
                  setTrackLoading(false);
                  showToast(`No top tracks found for ${currentArtist.name}`, 'error');
                }
              },
              className: `mt-6 rounded-full font-medium text-white no-drag transition-all hover:scale-105 ${isCompactHeader ? 'px-4 py-1.5 text-sm' : 'px-6 py-2'}`,
              style: {
                backgroundColor: '#E91E63',
                boxShadow: '0 4px 15px rgba(233, 30, 99, 0.4)'
              }
            }, isCompactHeader ? 'Play' : 'Play Top Tracks')
          ),
          // COLLAPSED STATE - Inline layout
          !loadingRelease && currentArtist && isHeaderCollapsed && React.createElement('div', {
            className: 'absolute inset-0 flex items-center px-16 z-10',
            style: {
              opacity: isHeaderCollapsed ? 1 : 0,
              transition: 'opacity 300ms ease-out'
            }
          },
            // Left side: Artist name with star button - clickable to expand header
            React.createElement('div', {
              className: 'flex items-center gap-2 mr-6 flex-shrink-0',
              style: { maxWidth: '40%' }
            },
              React.createElement('h1', {
                className: 'text-2xl font-light text-white cursor-pointer hover:text-purple-300 transition-colors no-drag',
                style: {
                  textShadow: '0 2px 10px rgba(0,0,0,0.5)',
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  lineHeight: '1.2'
                },
                onClick: () => setIsHeaderCollapsed(false),
                onContextMenu: copyParachordLink,
                title: 'Click to expand'
              }, currentArtist.name),
              // Star button to add/remove artist from collection
              (() => {
                const artistId = generateArtistId(currentArtist.name);
                const isInCollection = collectionData.artists.some(a => a.id === artistId);
                return React.createElement(Tooltip, {
                  content: isInCollection ? 'Remove from collection' : 'Add to collection',
                  position: 'top',
                  variant: 'dark'
                },
                  React.createElement('button', {
                    onClick: (e) => {
                      e.stopPropagation();
                      if (!isInCollection) {
                        addArtistToCollection({ name: currentArtist.name, image: artistImage });
                      } else {
                        removeArtistFromCollection({ name: currentArtist.name });
                      }
                    },
                    className: `p-1 rounded-full transition-colors no-drag ${isInCollection ? 'text-yellow-400 hover:text-yellow-300' : 'text-white/70 hover:text-white'}`,
                    style: { filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))' }
                  },
                    React.createElement('svg', {
                      className: 'w-5 h-5',
                      viewBox: '0 0 24 24',
                      fill: isInCollection ? 'currentColor' : 'none',
                      stroke: 'currentColor',
                      strokeWidth: 1.5,
                      strokeLinecap: 'round',
                      strokeLinejoin: 'round'
                    },
                      React.createElement('polygon', {
                        points: '12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26'
                      })
                    )
                  )
                );
              })()
            ),
            // Center: Navigation tabs
            React.createElement('div', {
              className: 'flex items-center gap-1',
              style: { textShadow: '0 2px 12px rgba(0,0,0,0.8), 0 0 20px rgba(0,0,0,0.4)' }
            },
              (() => {
                const showOnTour = (artistConcertsLoaded && artistConcerts.length > 0) || artistPageTab === 'on-tour';
                return ['music', 'biography', 'related', 'on-tour'].map((tab, index) => {
                  const isOnTour = tab === 'on-tour';
                  const hidden = isOnTour && !showOnTour;
                  return [
                    index > 0 && React.createElement('span', {
                      key: `sep-collapsed-${tab}`,
                      className: 'text-white/30 mx-2',
                      style: isOnTour ? {
                        opacity: showOnTour ? 1 : 0,
                        maxWidth: showOnTour ? '20px' : '0px',
                        overflow: 'hidden',
                        transition: 'opacity 0.4s ease, max-width 0.4s ease'
                      } : undefined
                    }, '|'),
                    React.createElement('button', {
                      key: `collapsed-${tab}`,
                      onClick: async () => {
                        if (hidden) return;
                        setArtistPageTab(tab);
                        if (tab === 'biography' && artistBio === null && !loadingBio && currentArtist) {
                          setLoadingBio(true);
                          const bioData = await getArtistBio(currentArtist.name, currentArtist.mbid);
                          setArtistBio(bioData === null ? false : bioData);
                        }
                        if (tab === 'related' && relatedArtists.length === 0 && currentArtist) {
                          const related = await getRelatedArtists(currentArtist.name, currentArtist.mbid);
                          if (related.length > 0) { setRelatedArtists(related); resolveRelatedArtistImages(related); }
                        }
                      },
                      className: `py-1 text-sm font-medium uppercase tracking-wider transition-colors no-drag ${
                        artistPageTab === tab
                          ? 'text-white'
                          : 'text-white/60 hover:text-white'
                      }`,
                      style: isOnTour ? {
                        opacity: showOnTour ? 1 : 0,
                        maxWidth: showOnTour ? '200px' : '0px',
                        overflow: 'hidden',
                        padding: showOnTour ? '0.25rem 0.5rem' : '0.25rem 0',
                        transition: 'opacity 0.4s ease, max-width 0.4s ease, padding 0.4s ease',
                        whiteSpace: 'nowrap'
                      } : { padding: '0.25rem 0.5rem' }
                    }, tab === 'related' ? 'Related Artists' : tab === 'on-tour' ? 'On Tour' : tab.charAt(0).toUpperCase() + tab.slice(1))
                  ];
                }).flat().filter(Boolean);
              })()
            ),
            // Right side: Play Top Tracks button - responsive sizing
            React.createElement('button', {
              onClick: async () => {
                if (!currentArtist) return;
                setTrackLoading(true);
                const tracks = await getArtistTopTracks(currentArtist.name);
                if (tracks.length > 0) {
                  const context = { type: 'artist', name: currentArtist.name };
                  const [firstTrack, ...remainingTracks] = tracks;
                  const taggedFirstTrack = { ...firstTrack, _playbackContext: context };
                  setQueueWithContext(remainingTracks, context, true);
                  handlePlay(taggedFirstTrack);
                } else {
                  setTrackLoading(false);
                  showToast(`No top tracks found for ${currentArtist.name}`, 'error');
                }
              },
              className: `ml-auto rounded-full font-medium text-white no-drag transition-all hover:scale-105 ${isCompactHeader ? 'px-3 py-1.5 text-xs' : 'px-5 py-2 text-sm'}`,
              style: {
                backgroundColor: '#E91E63',
                boxShadow: '0 4px 15px rgba(233, 30, 99, 0.4)'
              }
            }, isCompactHeader ? 'Play' : 'Play Top Tracks')
          )
        ),
        
        // Release page - artist header (shows artist image/name/tabs at top)
        currentRelease && React.createElement('div', {
          className: 'relative',
          style: {
            height: '80px',
            flexShrink: 0,
            overflow: 'hidden'
          }
        },
          // Background image with gradient overlay
          artistImage && React.createElement('div', {
            className: 'absolute inset-0',
            style: {
              backgroundImage: `url(${artistImage})`,
              backgroundSize: 'cover',
              backgroundPosition: artistImagePosition,
              filter: 'blur(0px)'
            }
          }),
          // Gradient overlay for readability
          React.createElement('div', {
            className: 'absolute inset-0',
            style: {
              background: artistImage
                ? 'linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, rgba(17,17,17,0.95) 100%)'
                : 'linear-gradient(to bottom, rgba(60,60,80,0.4) 0%, rgba(17,17,17,1) 100%)'
            }
          }),
          // Artist info overlay (inline layout for release page - matches collapsed artist header)
          React.createElement('div', {
            className: 'absolute inset-0 flex items-center px-16 z-10'
          },
            // Left side: Artist name
            React.createElement('h1', {
              className: 'text-2xl font-light mr-6 text-white cursor-pointer hover:text-purple-300 transition-colors no-drag flex-shrink-0',
              style: {
                textShadow: '0 2px 10px rgba(0,0,0,0.5)',
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                maxWidth: '40%',
                lineHeight: '1.2'
              },
              onClick: () => {
                const artistName = currentRelease?.artist?.name || currentArtist?.name;
                setCurrentRelease(null);
                // Ensure full artist data is loaded
                if (artistName && artistReleases.length === 0) {
                  fetchArtistData(artistName);
                }
              },
              title: 'Back to artist'
            }, currentRelease.artist?.name || currentArtist?.name),
            // Center: Navigation tabs
            React.createElement('div', {
              className: 'flex items-center gap-1',
              style: { textShadow: '0 1px 10px rgba(0,0,0,0.5)' }
            },
              ['music', 'biography', 'related', ...((artistConcertsLoaded && artistConcerts.length > 0) || artistPageTab === 'on-tour' ? ['on-tour'] : [])].map((tab, index) => [
                index > 0 && React.createElement('span', {
                  key: `sep-release-${tab}`,
                  className: 'text-gray-400 mx-2'
                }, '|'),
                React.createElement('button', {
                  key: `release-${tab}`,
                  onClick: async () => {
                    // Go back to artist page and switch to the selected tab
                    const artistName = currentRelease?.artist?.name || currentArtist?.name;
                    setCurrentRelease(null);
                    setArtistPageTab(tab);
                    // Ensure full artist data is loaded if navigating to music tab
                    if (tab === 'music' && artistName && artistReleases.length === 0) {
                      fetchArtistData(artistName);
                    }
                    if (tab === 'biography' && artistBio === null && !loadingBio && artistName) {
                      // Ensure artist data is loaded first
                      if (artistReleases.length === 0) {
                        fetchArtistData(artistName);
                      }
                      setLoadingBio(true); // Set loading immediately before async call
                      const bioData = await getArtistBio(artistName, currentArtist?.mbid);
                      setArtistBio(bioData === null ? false : bioData); // Use false to indicate "fetched but no bio"
                    }
                    if (tab === 'related' && relatedArtists.length === 0 && artistName) {
                      // Ensure artist data is loaded first
                      if (artistReleases.length === 0) {
                        fetchArtistData(artistName);
                      }
                      const related = await getRelatedArtists(artistName, currentArtist?.mbid);
                      if (related.length > 0) { setRelatedArtists(related); resolveRelatedArtistImages(related); }
                    }
                  },
                  className: `px-2 py-1 text-sm font-medium uppercase tracking-wider transition-colors no-drag ${
                    tab === 'music'
                      ? 'text-white'
                      : 'text-gray-400 hover:text-white'
                  }`
                }, tab === 'related' ? 'Related Artists' : tab === 'on-tour' ? 'On Tour' : tab.charAt(0).toUpperCase() + tab.slice(1))
              ]).flat().filter(Boolean)
            )
          )
        ),

        // Release page content - new layout with album details header
        // Show immediately with partial data (tracks may still be loading)
        currentRelease && React.createElement('div', {
          className: 'bg-white',
          style: {
            flex: 1,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            pointerEvents: 'auto'
          }
        },
          // ALBUM DETAILS section header with breadcrumb
          React.createElement('div', {
            className: 'flex items-center justify-between px-6 py-4 flex-shrink-0',
            style: { backgroundColor: 'var(--bg-primary)', borderBottom: '1px solid var(--border-default)' }
          },
            // Breadcrumb navigation: Artist Name > Album Name
            React.createElement('div', {
              className: 'flex items-center gap-2 text-xs font-medium tracking-widest uppercase'
            },
              React.createElement('button', {
                onClick: () => {
                  // Clear the release view to go back to artist
                  setCurrentRelease(null);
                  // If artist releases aren't loaded, fetch full artist data
                  const artistName = currentRelease?.artist?.name || currentArtist?.name;
                  if (artistName && artistReleases.length === 0) {
                    fetchArtistData(artistName);
                  }
                },
                style: { color: 'var(--text-tertiary)', transition: 'color 0.15s' },
                className: 'hover:text-gray-600 transition-colors uppercase',
                onMouseEnter: (e) => e.currentTarget.style.color = 'var(--text-secondary)',
                onMouseLeave: (e) => e.currentTarget.style.color = 'var(--text-tertiary)'
              }, currentArtist?.name || currentRelease?.artist?.name || 'Artist'),
              React.createElement('span', { style: { color: 'var(--border-default)' } }, '/'),
              React.createElement('span', { style: { color: 'var(--text-secondary)' }, className: 'uppercase' },
                currentRelease?.title || 'Album Details'
              )
            ),
            // Empty div to maintain layout (no close button needed with breadcrumb)
            React.createElement('div')
          ),
          // Two-column layout: album art + metadata on left, tracklist on right
          React.createElement(ReleasePage, {
            release: currentRelease,
            handleSearch: handleSearchInput,
            handlePlay: handlePlay,
            onTrackPlay: (track, tracksAfter) => {
              // Set queue with remaining tracks from the album, then play
              const context = { type: 'album', id: currentRelease?.id, name: currentRelease?.title, artist: currentRelease?.artist?.name };
              // Tag the current track with context too
              const taggedTrack = { ...track, _playbackContext: context };
              setQueueWithContext(tracksAfter, context);
              handlePlay(taggedTrack);
            },
            onTrackContextMenu: (track) => {
              if (window.electron?.contextMenu?.showTrackMenu) {
                window.electron.contextMenu.showTrackMenu({
                  type: 'track',
                  track: track
                });
              }
            },
            trackSources: trackSources,
            resolvers: resolvers,
            activeResolvers: activeResolvers,
            // Now playing props
            currentTrack: currentTrack,
            playbackContext: playbackContext,
            isPlaying: isPlaying,
            // Drag and drop handlers for adding tracks to playlists
            onDragStart: (track) => {
              setDraggingTrackForPlaylist(track);
            },
            onDragEnd: () => {
              handlePlaylistDragEnd();
            },
            // Visibility tracking for resolution scheduler
            releaseTrackRowRefs: releaseTrackRowRefs,
            releaseObserverRef: releaseObserverRef,
            // Album action props (hover buttons on album art)
            onAlbumPlay: (rel) => {
              if (rel.tracks?.length > 0) {
                const context = { type: 'album', id: rel.id, name: rel.title, artist: rel.artist?.name };
                const tracks = rel.tracks.map(t => {
                  const trackId = trackSlug(rel.artist?.name || 'unknown', t.title || 'untitled', rel.title || 'noalbum');
                  return {
                    ...t,
                    id: trackId,
                    artist: rel.artist?.name,
                    album: rel.title,
                    albumArt: rel.albumArt,
                    sources: trackSources[trackId] || {}
                  };
                });
                const [firstTrack, ...remainingTracks] = tracks;
                const taggedFirstTrack = { ...firstTrack, _playbackContext: context };
                setQueueWithContext(remainingTracks, context, true);
                handlePlay(taggedFirstTrack);
              }
            },
            onAlbumAddToQueue: (rel) => {
              if (rel.tracks?.length > 0) {
                const tracks = rel.tracks.map(t => {
                  const trackId = trackSlug(rel.artist?.name || 'unknown', t.title || 'untitled', rel.title || 'noalbum');
                  return {
                    ...t,
                    id: trackId,
                    artist: rel.artist?.name,
                    album: rel.title,
                    albumArt: rel.albumArt,
                    sources: trackSources[trackId] || {}
                  };
                });
                addToQueue(tracks, { type: 'album', name: rel.title, id: rel.id });
                showToast(`Added ${tracks.length} tracks to queue`, 'success');
              }
            },
            onAlbumAddToPlaylist: (rel) => {
              if (rel.tracks?.length > 0) {
                const tracks = rel.tracks.map(t => {
                  const trackId = trackSlug(rel.artist?.name || 'unknown', t.title || 'untitled', rel.title || 'noalbum');
                  return {
                    ...t,
                    id: trackId,
                    artist: rel.artist?.name,
                    album: rel.title,
                    albumArt: rel.albumArt,
                    sources: trackSources[trackId] || {}
                  };
                });
                setAddToPlaylistPanel({
                  open: true,
                  tracks: tracks,
                  sourceName: rel.title,
                  sourceType: 'album'
                });
                setSelectedPlaylistsForAdd([]);
              }
            },
            onAlbumContextMenu: (rel) => {
              if (window.electron?.contextMenu?.showTrackMenu) {
                window.electron.contextMenu.showTrackMenu({
                  type: 'release',
                  name: rel.title,
                  artist: rel.artist?.name,
                  albumArt: rel.albumArt,
                  album: {
                    title: rel.title,
                    artist: rel.artist?.name,
                    art: rel.albumArt
                  },
                  tracks: rel.tracks || []
                });
              }
            },
            shareDropdownOpen: shareDropdownOpen,
            setShareDropdownOpen: setShareDropdownOpen,
            publishCollectionSmartLink: publishCollectionSmartLink,
            copyCollectionEmbedCode: copyCollectionEmbedCode
          })
        ),
        
        // Skeleton loading state for artist - only show before currentArtist is set
        !currentRelease && !loadingRelease && loadingArtist && !currentArtist && React.createElement('div', {
          className: 'flex-1'
        },
          // Skeleton header area with shimmer
          React.createElement('div', {
            className: 'relative h-48 shimmer-light animate-shimmer',
            style: { backgroundSize: '200% 100%' }
          }),
          // Skeleton content
          React.createElement('div', { className: 'p-6' },
            // Skeleton filter buttons
            React.createElement('div', { className: 'flex gap-2 mb-4' },
              Array.from({ length: 4 }).map((_, i) =>
                React.createElement('div', {
                  key: `filter-skeleton-${i}`,
                  className: 'h-10 shimmer-light rounded-full animate-shimmer',
                  style: { width: `${80 + i * 15}px`, backgroundSize: '200% 100%', animationDelay: `${i * 100}ms` }
                })
              )
            ),
            // Skeleton release count
            React.createElement('div', {
              className: 'h-4 shimmer-light rounded w-24 mb-6 animate-shimmer',
              style: { backgroundSize: '200% 100%' }
            }),
            // Skeleton album grid
            React.createElement('div', {
              className: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4'
            },
              Array.from({ length: 10 }).map((_, i) =>
                React.createElement('div', { key: `album-skeleton-${i}` },
                  React.createElement('div', {
                    className: 'aspect-square shimmer-light rounded-lg mb-3 animate-shimmer',
                    style: { backgroundSize: '200% 100%', animationDelay: `${i * 50}ms` }
                  }),
                  React.createElement('div', {
                    className: 'h-4 shimmer-light rounded w-3/4 mb-2 animate-shimmer',
                    style: { backgroundSize: '200% 100%', animationDelay: `${i * 50 + 25}ms` }
                  }),
                  React.createElement('div', {
                    className: 'h-3 shimmer-light rounded w-1/2 animate-shimmer',
                    style: { backgroundSize: '200% 100%', animationDelay: `${i * 50 + 50}ms` }
                  })
                )
              )
            )
          )
        ),
        
        // Artist content (scrollable) - show when we have artist data (even while releases are loading)
        !currentRelease && !loadingRelease && currentArtist && React.createElement('div', {
          ref: artistPageScrollRef,
          className: 'scrollable-content',
          style: {
            flex: 1,
            overflowY: 'scroll',
            pointerEvents: 'auto'
          },
          onScroll: handleArtistPageScroll
        },
          // Sticky filter bar (Music tab only) - refined styling
          artistPageTab === 'music' && React.createElement('div', {
            className: 'sticky top-0 z-10 flex items-center px-6 py-3',
            style: { backgroundColor: 'var(--bg-primary)', borderBottom: '1px solid var(--border-default)' }
          },
            // Release type filter pills
            React.createElement('div', { className: 'flex gap-2 flex-wrap' },
              [
                { value: 'all', label: 'All', activeColor: '#7c3aed' },
                { value: 'album', label: 'Studio Albums', activeColor: 'rgb(99, 102, 241)' },
                { value: 'ep', label: 'EPs', activeColor: '#a855f7' },
                { value: 'single', label: 'Singles', activeColor: '#db2777' },
                { value: 'live', label: 'Live', activeColor: '#d97706' },
                { value: 'compilation', label: 'Compilations', activeColor: '#0eb3a0' }
              ].map(({ value, label, activeColor }) => {
                const searchFiltered = filterArtistReleases(artistReleases);
                const count = value === 'all'
                  ? searchFiltered.length
                  : searchFiltered.filter(r => r.releaseType === value).length;

                // While loading, show all filter types; otherwise hide those with 0 count (except 'all')
                if (!loadingArtist && count === 0 && value !== 'all') return null;

                const isActive = releaseTypeFilter === value;
                return React.createElement('button', {
                  key: value,
                  onClick: () => setReleaseTypeFilter(value),
                  className: `px-3 py-1.5 rounded-full text-sm transition-all no-drag ${
                    isActive ? 'text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`,
                  style: isActive ? { backgroundColor: activeColor } : undefined
                }, loadingArtist ? label : `${label} (${count})`);
              })
            ),
            // Spacer
            React.createElement('div', { className: 'flex-1' }),
            // Sort dropdown
            React.createElement('div', { className: 'relative mr-3' },
              React.createElement('button', {
                onClick: (e) => { e.stopPropagation(); setArtistSortDropdownOpen(!artistSortDropdownOpen); },
                className: 'flex items-center gap-1 px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors'
              },
                React.createElement('span', null, artistSortOptions.find(o => o.value === artistSort)?.label || 'Sort'),
                React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                  React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M19 9l-7 7-7-7' })
                )
              ),
              // Dropdown menu
              artistSortDropdownOpen && React.createElement('div', {
                className: 'absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg py-1 min-w-[160px] z-30 border border-gray-200'
              },
                artistSortOptions.map(option =>
                  React.createElement('button', {
                    key: option.value,
                    onClick: (e) => {
                      e.stopPropagation();
                      setArtistSort(option.value);
                      setArtistSortDropdownOpen(false);
                    },
                    className: `w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center justify-between ${
                      artistSort === option.value ? 'text-gray-900 font-medium' : 'text-gray-600'
                    }`
                  },
                    option.label,
                    artistSort === option.value && React.createElement('svg', {
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
            // Search toggle/field
            React.createElement('div', { className: 'flex items-center' },
              artistSearchOpen ?
                React.createElement('div', { className: 'flex items-center border border-gray-300 rounded-full px-3 py-[5px] filter-pill' },
                  React.createElement('input', {
                    type: 'text',
                    value: artistSearch,
                    onChange: (e) => setArtistSearch(e.target.value),
                    onBlur: () => {
                      if (!artistSearch.trim()) {
                        setArtistSearchOpen(false);
                      }
                    },
                    autoFocus: true,
                    placeholder: 'Filter...',
                    className: 'bg-transparent text-gray-700 text-sm placeholder-gray-400 outline-none',
                    style: { width: '150px' }
                  }),
                  artistSearch && React.createElement('button', {
                    onClick: () => {
                      setArtistSearch('');
                      setArtistSearchOpen(false);
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
                  onClick: () => setArtistSearchOpen(true),
                  className: 'p-1.5 text-gray-400 hover:text-gray-600 transition-colors'
                },
                  React.createElement('svg', { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
                  )
                )
            )
          ),
          // MUSIC TAB - Discography
          artistPageTab === 'music' && React.createElement('div', {
            className: 'space-y-6 p-6'
          },
            // Discography grid - cards handle their own album art loading shimmer
            React.createElement('div', {
              className: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-4 gap-y-5 pb-6',
              ref: (el) => {
                if (!el) {
                  // Cleanup observer when unmounting
                  if (albumArtObserver.current) {
                    albumArtObserver.current.disconnect();
                    albumArtObserver.current = null;
                  }
                  visibleAlbumIds.current.clear();
                  return;
                }

                // Set up IntersectionObserver if not already done
                if (!albumArtObserver.current) {
                  albumArtObserver.current = new window.IntersectionObserver(
                    (entries) => {
                      let changed = false;
                      for (const entry of entries) {
                        const releaseId = entry.target.getAttribute('data-release-id');
                        if (!releaseId) continue;

                        if (entry.isIntersecting) {
                          if (!visibleAlbumIds.current.has(releaseId)) {
                            visibleAlbumIds.current.add(releaseId);
                            changed = true;
                          }
                        } else {
                          if (visibleAlbumIds.current.has(releaseId)) {
                            visibleAlbumIds.current.delete(releaseId);
                            changed = true;
                          }
                        }
                      }

                      // Reprioritize queue when visibility changes
                      if (changed && albumArtQueue.current.length > 0) {
                        reprioritizeAlbumArtQueue();
                      }
                    },
                    { threshold: 0, rootMargin: '100px' } // Slightly expand viewport for smoother loading
                  );

                  // Observe all release cards
                  const cards = el.querySelectorAll('[data-release-id]');
                  cards.forEach(card => albumArtObserver.current.observe(card));
                }
              }
            },
              // Skeleton loading cards while fetching artist data
              loadingArtist && artistReleases.length === 0 && Array.from({ length: 15 }, (_, i) =>
                React.createElement('div', {
                  key: `skeleton-${i}`,
                  className: 'card-fade-up',
                  style: {
                    width: '100%',
                    backgroundColor: 'var(--card-bg)',
                    borderRadius: '10px',
                    padding: '10px',
                    boxShadow: 'var(--card-shadow)',
                    animationDelay: `${Math.min(i * 30, 300)}ms`
                  }
                },
                  // Skeleton album art
                  React.createElement('div', {
                    className: 'animate-shimmer',
                    style: {
                      width: '100%',
                      aspectRatio: '1',
                      borderRadius: '6px',
                      background: 'linear-gradient(to right, var(--shimmer-from), var(--shimmer-via), var(--shimmer-to))',
                      backgroundSize: '200% 100%',
                      marginBottom: '10px'
                    }
                  }),
                  // Skeleton title
                  React.createElement('div', {
                    className: 'animate-shimmer',
                    style: {
                      height: '14px',
                      width: `${60 + (i * 13 % 30)}%`,
                      borderRadius: '4px',
                      background: 'linear-gradient(to right, var(--shimmer-from), var(--shimmer-via), var(--shimmer-to))',
                      backgroundSize: '200% 100%',
                      marginBottom: '6px'
                    }
                  }),
                  // Skeleton year
                  React.createElement('div', {
                    className: 'animate-shimmer',
                    style: {
                      height: '12px',
                      width: '35%',
                      borderRadius: '4px',
                      background: 'linear-gradient(to right, var(--shimmer-from), var(--shimmer-via), var(--shimmer-to))',
                      backgroundSize: '200% 100%'
                    }
                  })
                )
              ),
              sortArtistReleases(filterArtistReleases(artistReleases)).map((release, index) =>
                React.createElement(ReleaseCard, {
                  key: release.id,
                  release: release,
                  onCardRef: (el) => {
                    // Observe new cards as they're added for viewport-prioritized loading
                    if (el && albumArtObserver.current) {
                      albumArtObserver.current.observe(el);
                    }
                  },
                  currentArtist: currentArtist,
                  fetchReleaseData: fetchReleaseData,
                  animationDelay: Math.min(index * 30, 300), // Staggered animation, cap at 300ms
                  onHoverFetch: (rel) => {
                    // Prefetch release tracks on hover for context menu
                    prefetchReleaseTracks(rel, currentArtist);
                  },
                  onContextMenu: async (rel) => {
                    // For releases, show context menu with tracks
                    if (window.electron?.contextMenu?.showTrackMenu) {
                      const albumData = {
                        title: rel.title,
                        artist: currentArtist?.name,
                        year: rel.date?.split('-')[0] ? parseInt(rel.date.split('-')[0]) : null,
                        art: rel.albumArt
                      };
                      // Check prefetched cache first (use ref to avoid stale closure)
                      const prefetched = prefetchedReleasesRef.current[rel.id];
                      if (prefetched?.tracks?.length > 0) {
                        window.electron.contextMenu.showTrackMenu({
                          type: 'release',
                          name: rel.title,
                          album: albumData,
                          tracks: prefetched.tracks
                        });
                      } else if (currentRelease?.id === rel.id && currentRelease?.tracks?.length > 0) {
                        // Use already loaded tracks from current release
                        const tracks = currentRelease.tracks.map(t => {
                          const trackId = trackSlug(currentArtist?.name || 'unknown', t.title || 'untitled', rel.title || 'noalbum');
                          return {
                            ...t,
                            id: trackId,
                            artist: currentArtist?.name,
                            album: rel.title,
                            albumArt: rel.albumArt,
                            sources: trackSources[trackId] || {}
                          };
                        });
                        window.electron.contextMenu.showTrackMenu({
                          type: 'release',
                          name: rel.title,
                          album: albumData,
                          tracks: tracks
                        });
                      } else {
                        // No tracks available yet - show with 0 tracks
                        window.electron.contextMenu.showTrackMenu({
                          type: 'release',
                          name: rel.title,
                          album: albumData,
                          releaseId: rel.id,
                          artist: currentArtist?.name,
                          albumArt: rel.albumArt,
                          tracks: []
                        });
                      }
                    }
                  },
                  prefetchedReleasesRef: prefetchedReleasesRef,
                  onPlay: async (rel) => {
                    setTrackLoading(true);
                    // Get tracks from prefetched cache or current release
                    const prefetched = prefetchedReleasesRef.current[rel.id];
                    let tracks = [];
                    if (prefetched?.tracks?.length > 0) {
                      tracks = prefetched.tracks;
                    } else if (currentRelease?.id === rel.id && currentRelease?.tracks?.length > 0) {
                      tracks = currentRelease.tracks.map(t => {
                        const trackId = trackSlug(currentArtist?.name || 'unknown', t.title || 'untitled', rel.title || 'noalbum');
                        return {
                          ...t,
                          id: trackId,
                          artist: currentArtist?.name,
                          album: rel.title,
                          albumArt: rel.albumArt,
                          sources: trackSources[trackId] || {}
                        };
                      });
                    }
                    if (tracks.length > 0) {
                      const context = { type: 'album', name: rel.title, id: rel.id };
                      const [firstTrack, ...remainingTracks] = tracks;
                      // Tag the first track with context so queue navigation works correctly
                      const taggedFirstTrack = { ...firstTrack, _playbackContext: context };
                      setQueueWithContext(remainingTracks, context, true);
                      handlePlay(taggedFirstTrack);
                    } else {
                      // Fetch and play if no tracks cached
                      await prefetchReleaseTracks(rel, currentArtist);
                      const newPrefetched = prefetchedReleasesRef.current[rel.id];
                      if (newPrefetched?.tracks?.length > 0) {
                        const context = { type: 'album', name: rel.title, id: rel.id };
                        const [firstTrack, ...remainingTracks] = newPrefetched.tracks;
                        // Tag the first track with context so queue navigation works correctly
                        const taggedFirstTrack = { ...firstTrack, _playbackContext: context };
                        setQueueWithContext(remainingTracks, context, true);
                        handlePlay(taggedFirstTrack);
                      }
                    }
                  },
                  onAddToQueue: async (rel) => {
                    const prefetched = prefetchedReleasesRef.current[rel.id];
                    let tracks = [];
                    if (prefetched?.tracks?.length > 0) {
                      tracks = prefetched.tracks;
                    } else if (currentRelease?.id === rel.id && currentRelease?.tracks?.length > 0) {
                      tracks = currentRelease.tracks.map(t => {
                        const trackId = trackSlug(currentArtist?.name || 'unknown', t.title || 'untitled', rel.title || 'noalbum');
                        return {
                          ...t,
                          id: trackId,
                          artist: currentArtist?.name,
                          album: rel.title,
                          albumArt: rel.albumArt,
                          sources: trackSources[trackId] || {}
                        };
                      });
                    }
                    if (tracks.length > 0) {
                      addToQueue(tracks, { type: 'album', name: rel.title, id: rel.id });
                    } else {
                      // Fetch and add if no tracks cached
                      await prefetchReleaseTracks(rel, currentArtist);
                      const newPrefetched = prefetchedReleasesRef.current[rel.id];
                      if (newPrefetched?.tracks?.length > 0) {
                        addToQueue(newPrefetched.tracks, { type: 'album', name: rel.title, id: rel.id });
                      }
                    }
                  },
                  onAddToPlaylist: async (rel) => {
                    const prefetched = prefetchedReleasesRef.current[rel.id];
                    let tracks = [];
                    if (prefetched?.tracks?.length > 0) {
                      tracks = prefetched.tracks;
                    } else if (currentRelease?.id === rel.id && currentRelease?.tracks?.length > 0) {
                      tracks = currentRelease.tracks.map(t => {
                        const trackId = trackSlug(currentArtist?.name || 'unknown', t.title || 'untitled', rel.title || 'noalbum');
                        return {
                          ...t,
                          id: trackId,
                          artist: currentArtist?.name,
                          album: rel.title,
                          albumArt: rel.albumArt,
                          sources: trackSources[trackId] || {}
                        };
                      });
                    }
                    if (tracks.length > 0) {
                      setAddToPlaylistPanel({
                        open: true,
                        tracks: tracks,
                        sourceName: rel.title,
                        sourceType: 'album'
                      });
                      setSelectedPlaylistsForAdd([]);
                    } else {
                      // Fetch and show panel if no tracks cached
                      await prefetchReleaseTracks(rel, currentArtist);
                      const newPrefetched = prefetchedReleasesRef.current[rel.id];
                      if (newPrefetched?.tracks?.length > 0) {
                        setAddToPlaylistPanel({
                          open: true,
                          tracks: newPrefetched.tracks,
                          sourceName: rel.title,
                          sourceType: 'album'
                        });
                        setSelectedPlaylistsForAdd([]);
                      }
                    }
                  },
                  isVisible: (releaseTypeFilter === 'all' || release.releaseType === releaseTypeFilter) &&
                    (!artistSearch.trim() || release.title.toLowerCase().includes(artistSearch.toLowerCase()))
                })
              )
            ),

            // Empty state (only show when not loading)
            !loadingArtist && (() => {
              const filtered = sortArtistReleases(filterArtistReleases(artistReleases));
              const typeFiltered = filtered.filter(r => releaseTypeFilter === 'all' || r.releaseType === releaseTypeFilter);
              if (typeFiltered.length === 0) {
                const typeLabels = {
                  all: '',
                  album: 'studio albums',
                  live: 'live albums',
                  compilation: 'compilations',
                  ep: 'EPs',
                  single: 'singles'
                };
                return React.createElement('div', { className: 'text-center py-12 text-gray-400' },
                  artistSearch.trim()
                    ? `No releases matching "${artistSearch}"`
                    : `No ${typeLabels[releaseTypeFilter] || releaseTypeFilter} found`
                );
              }
              return null;
            })()
          ),

          // BIOGRAPHY TAB - Two-column layout
          artistPageTab === 'biography' && React.createElement('div', {
            className: 'flex gap-0 p-6'
          },
            // LEFT COLUMN: Artist Info Card (~1/4 width)
            React.createElement('div', {
              className: 'pr-8',
              style: { flex: '0 0 25%' }
            },
              // Artist Info Card
              React.createElement('div', {
                style: {
                  width: '100%',
                  backgroundColor: 'var(--card-bg)',
                  borderRadius: '10px',
                  padding: '14px',
                  boxShadow: 'var(--card-shadow)'
                }
              },
                // Loading skeleton for extended info
                loadingExtendedInfo && React.createElement('div', { className: 'space-y-4' },
                  // Section skeleton
                  React.createElement('div', { className: 'space-y-2' },
                    React.createElement('div', { className: 'h-3 shimmer-light rounded animate-shimmer w-16', style: { backgroundSize: '200% 100%' } }),
                    React.createElement('div', { className: 'h-4 shimmer-light rounded animate-shimmer w-24', style: { backgroundSize: '200% 100%', animationDelay: '50ms' } })
                  ),
                  React.createElement('div', { className: 'space-y-2' },
                    React.createElement('div', { className: 'h-3 shimmer-light rounded animate-shimmer w-20', style: { backgroundSize: '200% 100%', animationDelay: '100ms' } }),
                    React.createElement('div', { className: 'h-4 shimmer-light rounded animate-shimmer w-28', style: { backgroundSize: '200% 100%', animationDelay: '150ms' } })
                  ),
                  React.createElement('div', { className: 'space-y-2' },
                    React.createElement('div', { className: 'h-3 shimmer-light rounded animate-shimmer w-14', style: { backgroundSize: '200% 100%', animationDelay: '200ms' } }),
                    React.createElement('div', { className: 'flex gap-2' },
                      React.createElement('div', { className: 'h-6 w-6 shimmer-light rounded animate-shimmer', style: { backgroundSize: '200% 100%', animationDelay: '250ms' } }),
                      React.createElement('div', { className: 'h-6 w-6 shimmer-light rounded animate-shimmer', style: { backgroundSize: '200% 100%', animationDelay: '300ms' } }),
                      React.createElement('div', { className: 'h-6 w-6 shimmer-light rounded animate-shimmer', style: { backgroundSize: '200% 100%', animationDelay: '350ms' } })
                    )
                  )
                ),

                // Artist Info content
                !loadingExtendedInfo && artistExtendedInfo && artistExtendedInfo !== false && React.createElement('div', { className: 'space-y-3' },
                  // Founded date
                  artistExtendedInfo.foundedDate && React.createElement('div', null,
                    React.createElement('div', {
                      style: {
                        fontSize: '10px',
                        fontWeight: '600',
                        color: 'var(--text-tertiary)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        marginBottom: '2px'
                      }
                    }, artistExtendedInfo.type === 'Person' ? 'Born' : 'Founded'),
                    React.createElement('div', {
                      style: {
                        fontSize: '13px',
                        fontWeight: '500',
                        color: 'var(--text-primary)',
                        lineHeight: '1.4'
                      }
                    },
                      (() => {
                        const date = artistExtendedInfo.foundedDate;
                        if (date.length === 4) return date; // Just year
                        if (date.length === 7) {
                          const [year, month] = date.split('-');
                          const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                          return `${monthNames[parseInt(month) - 1]} ${year}`;
                        }
                        // Full date
                        const d = new Date(date);
                        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                      })()
                    )
                  ),

                  // Founded In / Origin
                  artistExtendedInfo.foundedIn && React.createElement('div', null,
                    React.createElement('div', {
                      style: {
                        fontSize: '10px',
                        fontWeight: '600',
                        color: 'var(--text-tertiary)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        marginBottom: '2px'
                      }
                    }, artistExtendedInfo.type === 'Person' ? 'From' : 'Origin'),
                    React.createElement('div', {
                      style: {
                        fontSize: '13px',
                        fontWeight: '500',
                        color: 'var(--text-primary)',
                        lineHeight: '1.4'
                      }
                    }, artistExtendedInfo.foundedIn)
                  ),

                  // Status (active/disbanded)
                  artistExtendedInfo.type === 'Group' && React.createElement('div', null,
                    React.createElement('div', {
                      style: {
                        fontSize: '10px',
                        fontWeight: '600',
                        color: 'var(--text-tertiary)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        marginBottom: '2px'
                      }
                    }, 'Status'),
                    React.createElement('div', {
                      style: {
                        fontSize: '13px',
                        fontWeight: '500',
                        color: artistExtendedInfo.isActive ? '#16a34a' : 'var(--text-secondary)',
                        lineHeight: '1.4'
                      }
                    }, artistExtendedInfo.isActive ? 'Active' : `Disbanded${artistExtendedInfo.endedDate ? ` (${artistExtendedInfo.endedDate.split('-')[0]})` : ''}`)
                  ),

                  // Official Homepage
                  artistExtendedInfo.urls.officialHomepage && React.createElement('div', null,
                    React.createElement('div', {
                      style: {
                        fontSize: '10px',
                        fontWeight: '600',
                        color: 'var(--text-tertiary)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        marginBottom: '2px'
                      }
                    }, 'Website'),
                    React.createElement('a', {
                      href: artistExtendedInfo.urls.officialHomepage,
                      target: '_blank',
                      rel: 'noopener noreferrer',
                      style: {
                        fontSize: '12px',
                        fontWeight: '500',
                        color: '#9333ea',
                        display: 'block',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        textDecoration: 'none'
                      },
                      title: artistExtendedInfo.urls.officialHomepage,
                      onMouseEnter: (e) => e.currentTarget.style.color = '#7e22ce',
                      onMouseLeave: (e) => e.currentTarget.style.color = '#9333ea'
                    }, new URL(artistExtendedInfo.urls.officialHomepage).hostname.replace(/^www\./, ''))
                  ),

                  // Social Media Links
                  (artistExtendedInfo.urls.twitter || artistExtendedInfo.urls.instagram || artistExtendedInfo.urls.facebook || artistExtendedInfo.urls.youtube) && React.createElement('div', { style: { paddingTop: '4px' } },
                    React.createElement('div', {
                      style: {
                        fontSize: '10px',
                        fontWeight: '600',
                        color: 'var(--text-tertiary)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        marginBottom: '6px'
                      }
                    }, 'Social'),
                    React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
                      // Twitter/X
                      artistExtendedInfo.urls.twitter && React.createElement('a', {
                        href: artistExtendedInfo.urls.twitter,
                        target: '_blank',
                        rel: 'noopener noreferrer',
                        style: {
                          width: '28px',
                          height: '28px',
                          borderRadius: '6px',
                          backgroundColor: 'var(--placeholder-bg-light)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'background-color 150ms ease'
                        },
                        title: 'Twitter/X',
                        onMouseEnter: (e) => e.currentTarget.style.backgroundColor = 'var(--placeholder-bg)',
                        onMouseLeave: (e) => e.currentTarget.style.backgroundColor = 'var(--placeholder-bg-light)'
                      },
                        React.createElement('svg', { style: { width: '14px', height: '14px', color: 'var(--nav-inactive)' }, viewBox: '0 0 24 24', fill: 'currentColor' },
                          React.createElement('path', { d: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z' })
                        )
                      ),
                      // Instagram
                      artistExtendedInfo.urls.instagram && React.createElement('a', {
                        href: artistExtendedInfo.urls.instagram,
                        target: '_blank',
                        rel: 'noopener noreferrer',
                        style: {
                          width: '28px',
                          height: '28px',
                          borderRadius: '6px',
                          backgroundColor: 'var(--placeholder-bg-light)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'background-color 150ms ease'
                        },
                        title: 'Instagram',
                        onMouseEnter: (e) => e.currentTarget.style.backgroundColor = 'var(--placeholder-bg)',
                        onMouseLeave: (e) => e.currentTarget.style.backgroundColor = 'var(--placeholder-bg-light)'
                      },
                        React.createElement('svg', { style: { width: '14px', height: '14px', color: 'var(--nav-inactive)' }, viewBox: '0 0 24 24', fill: 'currentColor' },
                          React.createElement('path', { d: 'M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z' })
                        )
                      ),
                      // Facebook
                      artistExtendedInfo.urls.facebook && React.createElement('a', {
                        href: artistExtendedInfo.urls.facebook,
                        target: '_blank',
                        rel: 'noopener noreferrer',
                        style: {
                          width: '28px',
                          height: '28px',
                          borderRadius: '6px',
                          backgroundColor: 'var(--placeholder-bg-light)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'background-color 150ms ease'
                        },
                        title: 'Facebook',
                        onMouseEnter: (e) => e.currentTarget.style.backgroundColor = 'var(--placeholder-bg)',
                        onMouseLeave: (e) => e.currentTarget.style.backgroundColor = 'var(--placeholder-bg-light)'
                      },
                        React.createElement('svg', { style: { width: '14px', height: '14px', color: 'var(--nav-inactive)' }, viewBox: '0 0 24 24', fill: 'currentColor' },
                          React.createElement('path', { d: 'M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z' })
                        )
                      ),
                      // YouTube
                      artistExtendedInfo.urls.youtube && React.createElement('a', {
                        href: artistExtendedInfo.urls.youtube,
                        target: '_blank',
                        rel: 'noopener noreferrer',
                        style: {
                          width: '28px',
                          height: '28px',
                          borderRadius: '6px',
                          backgroundColor: 'var(--placeholder-bg-light)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'background-color 150ms ease'
                        },
                        title: 'YouTube',
                        onMouseEnter: (e) => e.currentTarget.style.backgroundColor = 'var(--placeholder-bg)',
                        onMouseLeave: (e) => e.currentTarget.style.backgroundColor = 'var(--placeholder-bg-light)'
                      },
                        React.createElement('svg', { style: { width: '14px', height: '14px', color: 'var(--nav-inactive)' }, viewBox: '0 0 24 24', fill: 'currentColor' },
                          React.createElement('path', { d: 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z' })
                        )
                      )
                    )
                  ),

                  // Members section (for Groups/Bands)
                  (artistExtendedInfo.members.current.length > 0 || artistExtendedInfo.members.former.length > 0) && React.createElement('div', {
                    style: {
                      paddingTop: '10px',
                      marginTop: '6px',
                      borderTop: '1px solid #f3f4f6'
                    }
                  },
                    // Current Members
                    artistExtendedInfo.members.current.length > 0 && React.createElement('div', { style: { marginBottom: '10px' } },
                      React.createElement('div', {
                        style: {
                          fontSize: '10px',
                          fontWeight: '600',
                          color: 'var(--text-tertiary)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          marginBottom: '6px'
                        }
                      }, 'Members'),
                      React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px' } },
                        artistExtendedInfo.members.current.map((member, idx) =>
                          React.createElement('div', {
                            key: member.mbid || idx,
                            style: {
                              fontSize: '12px',
                              fontWeight: '500',
                              color: 'var(--text-primary)',
                              lineHeight: '1.4'
                            }
                          },
                            member.name,
                            member.attributes.length > 0 && React.createElement('span', {
                              style: {
                                fontSize: '10px',
                                fontWeight: '400',
                                color: 'var(--text-tertiary)',
                                marginLeft: '4px'
                              }
                            }, `(${member.attributes.join(', ')})`)
                          )
                        )
                      )
                    ),
                    // Former Members
                    artistExtendedInfo.members.former.length > 0 && React.createElement('div', null,
                      React.createElement('div', {
                        style: {
                          fontSize: '10px',
                          fontWeight: '600',
                          color: 'var(--text-tertiary)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          marginBottom: '6px'
                        }
                      }, 'Former'),
                      React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px' } },
                        artistExtendedInfo.members.former.map((member, idx) =>
                          React.createElement('div', {
                            key: member.mbid || idx,
                            style: {
                              fontSize: '12px',
                              fontWeight: '400',
                              color: 'var(--text-secondary)',
                              lineHeight: '1.4'
                            }
                          },
                            member.name,
                            member.attributes.length > 0 && React.createElement('span', {
                              style: {
                                fontSize: '10px',
                                fontWeight: '400',
                                color: 'var(--text-tertiary)',
                                marginLeft: '4px'
                              }
                            }, `(${member.attributes.join(', ')})`)
                          )
                        )
                      )
                    )
                  )
                ),

                // No extended info found
                !loadingExtendedInfo && artistExtendedInfo === false && React.createElement('div', {
                  style: {
                    fontSize: '11px',
                    color: 'var(--text-tertiary)',
                    textAlign: 'center',
                    padding: '16px 0'
                  }
                }, 'No additional info available')
              )
            ),

            // RIGHT COLUMN: Biography
            React.createElement('div', { className: 'flex-1 min-w-0 max-w-2xl' },
              // Loading state - skeleton paragraphs
              loadingBio && React.createElement('div', { className: 'space-y-4' },
                // First paragraph skeleton (longer)
                React.createElement('div', { className: 'space-y-2' },
                  React.createElement('div', { className: 'h-4 shimmer-light rounded animate-shimmer w-full', style: { backgroundSize: '200% 100%' } }),
                  React.createElement('div', { className: 'h-4 shimmer-light rounded animate-shimmer w-full', style: { backgroundSize: '200% 100%', animationDelay: '50ms' } }),
                  React.createElement('div', { className: 'h-4 shimmer-light rounded animate-shimmer w-11/12', style: { backgroundSize: '200% 100%', animationDelay: '100ms' } }),
                  React.createElement('div', { className: 'h-4 shimmer-light rounded animate-shimmer w-4/5', style: { backgroundSize: '200% 100%', animationDelay: '150ms' } })
                ),
                // Second paragraph skeleton
                React.createElement('div', { className: 'space-y-2' },
                  React.createElement('div', { className: 'h-4 shimmer-light rounded animate-shimmer w-full', style: { backgroundSize: '200% 100%', animationDelay: '200ms' } }),
                  React.createElement('div', { className: 'h-4 shimmer-light rounded animate-shimmer w-full', style: { backgroundSize: '200% 100%', animationDelay: '250ms' } }),
                  React.createElement('div', { className: 'h-4 shimmer-light rounded animate-shimmer w-3/4', style: { backgroundSize: '200% 100%', animationDelay: '300ms' } })
                ),
                // Third paragraph skeleton (shorter)
                React.createElement('div', { className: 'space-y-2' },
                  React.createElement('div', { className: 'h-4 shimmer-light rounded animate-shimmer w-full', style: { backgroundSize: '200% 100%', animationDelay: '350ms' } }),
                  React.createElement('div', { className: 'h-4 shimmer-light rounded animate-shimmer w-2/3', style: { backgroundSize: '200% 100%', animationDelay: '400ms' } })
                )
              ),
              // Bio content (artistBio is an object when bio exists)
              !loadingBio && artistBio && artistBio !== false && React.createElement('div', { className: 'space-y-4' },
                React.createElement('div', {
                  className: 'text-sm text-gray-700 leading-relaxed whitespace-pre-wrap'
                }, artistBio.source === 'discogs'
                  // Discogs keeps its [b]/[i]/[u]/[url=] formatting tags.
                  ? parseBioMarkup(artistBio.bio).map((seg, i) => {
                      const style = {
                        fontWeight: seg.bold ? 600 : undefined,
                        fontStyle: seg.italic ? 'italic' : undefined,
                        textDecoration: seg.underline ? 'underline' : undefined,
                      };
                      return seg.href
                        ? React.createElement('a', { key: i, href: seg.href, target: '_blank', rel: 'noopener noreferrer', className: 'text-purple-600 hover:text-purple-700', style }, seg.text)
                        : React.createElement('span', { key: i, style }, seg.text);
                    })
                  : artistBio.bio),
                // Source attribution and link
                React.createElement('div', { className: 'flex items-center gap-2 mt-4' },
                  React.createElement('span', {
                    className: 'text-xs text-gray-400'
                  }, `From ${artistBio.source === 'wikipedia' ? 'Wikipedia' : artistBio.source === 'discogs' ? 'Discogs' : 'Last.fm'}`),
                  artistBio.url && React.createElement('a', {
                    href: artistBio.url,
                    target: '_blank',
                    rel: 'noopener noreferrer',
                    className: 'text-purple-600 hover:text-purple-700 text-sm'
                  }, 'Read more →')
                )
              ),
              // No bio found (artistBio === false means we fetched but found nothing)
              !loadingBio && artistBio === false && React.createElement('div', {
                className: 'text-center py-12 text-gray-400'
              }, 'No biography available for this artist.')
            )
          ),

          // RELATED ARTISTS TAB
          artistPageTab === 'related' && (() => {
            // Compute source counts for filter pills
            const listenbrainzCount = relatedArtists.filter(a => a.source === 'listenbrainz').length;
            const lastfmCount = relatedArtists.filter(a => a.source === 'lastfm').length;
            const bothCount = relatedArtists.filter(a => a.source === 'both').length;
            // Show filter bar when both services have data OR when configured (MBID available for ListenBrainz, API key for Last.fm)
            const hasBothServicesConfigured = !!currentArtist?.mbid && !!getLastfmApiKey();

            // Filter artists based on source filter
            const filteredArtists = relatedArtistsSourceFilter === 'all'
              ? relatedArtists
              : relatedArtists.filter(a =>
                  relatedArtistsSourceFilter === 'both'
                    ? a.source === 'both'
                    : a.source === relatedArtistsSourceFilter || a.source === 'both'
                );

            return React.createElement(React.Fragment, null,
              // Sticky filter bar - show when both services are configured
              hasBothServicesConfigured && React.createElement('div', {
                className: 'sticky top-0 z-10 flex items-center px-6 py-3',
              style: { backgroundColor: 'var(--bg-primary)', borderBottom: '1px solid var(--border-default)' }
              },
                React.createElement('div', { className: 'flex gap-2' },
                  [
                    { value: 'all', label: 'All', count: relatedArtists.length },
                    { value: 'listenbrainz', label: 'ListenBrainz', count: listenbrainzCount + bothCount },
                    { value: 'lastfm', label: 'Last.fm', count: lastfmCount + bothCount },
                    { value: 'both', label: 'Both', count: bothCount }
                  ].filter(({ value, count }) => value === 'all' || count > 0).map(({ value, label, count }) =>
                    React.createElement('button', {
                      key: value,
                      onClick: () => setRelatedArtistsSourceFilter(value),
                      className: `px-3 py-1.5 rounded-full text-sm transition-all no-drag ${
                        relatedArtistsSourceFilter === value
                          ? value === 'listenbrainz' ? 'bg-orange-500 text-white'
                            : value === 'lastfm' ? 'bg-red-600 text-white'
                            : value === 'both' ? 'bg-gradient-to-r from-orange-500 to-red-600 text-white'
                            : 'bg-purple-600 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`
                    }, loadingRelated ? label : `${label} (${count})`)
                  )
                )
              ),
              // Content with padding
              React.createElement('div', { className: 'p-6' },
                // Related artists grid (sorted by match, highest first) - Square card design
                // Cards handle their own image loading shimmer, no need for full skeleton grid
                filteredArtists.length > 0 && React.createElement('div', {
                  className: 'grid gap-4',
                  style: { gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }
                },
                  [...filteredArtists].sort((a, b) => b.match - a.match).map((artist, index) => {
                    const relatedPattern = generateArtistPattern(artist.name);
                    return React.createElement('div', {
                      key: artist.name,
                      className: 'rounded-lg overflow-hidden cursor-pointer group release-card card-fade-up',
                      style: { backgroundColor: 'var(--card-bg)', boxShadow: 'var(--card-shadow)', animationDelay: `${Math.min(index * 30, 300)}ms` },
                      draggable: true,
                      onDragStart: (e) => {
                        e.dataTransfer.effectAllowed = 'copy';
                        e.dataTransfer.setData('text/plain', JSON.stringify({
                          type: 'artist',
                          artist: {
                            id: artist.name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
                            name: artist.name,
                            image: artist.image
                          }
                        }));
                      },
                      onClick: () => fetchArtistData(artist.name),
                      onContextMenu: (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (window.electron?.contextMenu?.showTrackMenu) {
                          window.electron.contextMenu.showTrackMenu({
                            type: 'artist',
                            artist: {
                              id: artist.name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
                              name: artist.name,
                              image: artist.image
                            }
                          });
                        }
                      }
                    },
                      // Square image container - gray while loading, pattern only when imageLoaded && no image
                      React.createElement('div', {
                        className: 'aspect-square relative group/art overflow-hidden',
                        style: { background: artist.imageLoaded && !artist.image ? relatedPattern.gradient : 'var(--placeholder-bg)' }
                      },
                        // Shimmer while loading (imageLoaded not yet true)
                        !artist.imageLoaded && React.createElement('div', {
                          className: 'absolute inset-0 shimmer-strong animate-shimmer',
                          style: { backgroundSize: '200% 100%' }
                        }),
                        // Initials fallback (only show when imageLoaded && no image)
                        artist.imageLoaded && !artist.image && React.createElement('div', {
                          className: 'absolute inset-0 flex items-center justify-center',
                          style: { color: relatedPattern.textColor, opacity: 0.4 }
                        },
                          React.createElement('span', {
                            className: 'font-bold tracking-wider',
                            style: { fontSize: '2.5rem', textShadow: '0 2px 8px rgba(0,0,0,0.3)' }
                          }, relatedPattern.initials)
                        ),
                        // Image (fades in on load)
                        artist.image && React.createElement('img', {
                          src: artist.image,
                          alt: artist.name,
                          className: 'absolute inset-0 w-full h-full object-cover transition-all duration-300 group-hover/art:scale-105',
                          style: { opacity: 0 },
                          ref: (el) => { if (el && el.complete && el.naturalWidth > 0) el.style.opacity = '1'; },
                          onLoad: (e) => { e.target.style.opacity = '1'; },
                          onError: (e) => { e.target.style.display = 'none'; }
                        }),
                        // Hover overlay with action buttons (Play, Queue) - Top 10 icons
                        React.createElement('div', {
                          className: 'absolute inset-0 bg-black/50 opacity-0 group-hover/art:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-3',
                          style: { pointerEvents: 'auto' }
                        },
                          // Play top 10 button (center, larger)
                          React.createElement('button', {
                            onClick: async (e) => {
                              e.stopPropagation();
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
                ),
                // Cards will appear with their own shimmer animations when data is ready
                // No related artists found (or filtered to none)
                !loadingRelated && filteredArtists.length === 0 && React.createElement('div', {
                  className: 'text-center py-12 text-gray-400'
                }, relatedArtists.length === 0
                  ? 'No related artists found.'
                  : `No artists from ${relatedArtistsSourceFilter === 'listenbrainz' ? 'ListenBrainz' : relatedArtistsSourceFilter === 'lastfm' ? 'Last.fm' : 'both sources'}.`
                )
              )
            );
          })(),

          // On Tour tab — upcoming concerts for this artist
          artistPageTab === 'on-tour' && (() => {
            const isDark = effectiveTheme === 'dark';
            const events = artistConcerts;

            // Group events by month
            const grouped = {};
            for (const event of events) {
              const date = event.date ? new Date(event.date + 'T00:00:00') : null;
              const monthKey = date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}` : 'unknown';
              const monthLabel = date ? date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'Date TBA';
              if (!grouped[monthKey]) {
                grouped[monthKey] = { label: monthLabel, events: [] };
              }
              grouped[monthKey].events.push(event);
            }
            const sortedMonths = Object.keys(grouped).sort();

            return React.createElement('div', { className: 'p-6' },
              // Header row with count and refresh
              React.createElement('div', {
                className: `flex items-center justify-between mb-6`
              },
                React.createElement('div', { className: 'flex items-center gap-3' },
                  React.createElement('h2', {
                    className: `text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`
                  }, `${events.length} Upcoming Concert${events.length !== 1 ? 's' : ''}`),
                  artistConcertsLoading && React.createElement('svg', {
                    className: 'w-4 h-4 animate-spin text-teal-500',
                    fill: 'none', viewBox: '0 0 24 24'
                  },
                    React.createElement('circle', { className: 'opacity-25', cx: 12, cy: 12, r: 10, stroke: 'currentColor', strokeWidth: 4 }),
                    React.createElement('path', { className: 'opacity-75', fill: 'currentColor', d: 'M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z' })
                  )
                ),
                React.createElement('button', {
                  onClick: () => currentArtist && loadArtistConcerts(currentArtist.name, true),
                  disabled: artistConcertsLoading,
                  className: `p-1.5 transition-colors ${artistConcertsLoading ? 'text-teal-500' : (isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600')}`,
                  title: artistConcertsLoading ? 'Loading...' : 'Refresh'
                },
                  React.createElement('svg', {
                    className: `w-4 h-4 ${artistConcertsLoading ? 'animate-spin' : ''}`,
                    fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor'
                  },
                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M20 4v5h-.582m-15.356 2A8.001 8.001 0 0119.418 9m0 0H15m-11 11v-5h.581m0 0a8.003 8.003 0 0015.357-2m-15.357 2H9' })
                  )
                )
              ),

              // Empty state
              events.length === 0 && !artistConcertsLoading && React.createElement('div', {
                className: 'flex flex-col items-center justify-center py-12'
              },
                React.createElement('p', { className: `text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}` }, 'No upcoming concerts found.')
              ),

              // Loading state
              events.length === 0 && artistConcertsLoading && React.createElement('div', {
                className: 'flex flex-col items-center justify-center py-12'
              },
                React.createElement('svg', {
                  className: 'w-8 h-8 animate-spin text-teal-500 mb-3',
                  fill: 'none', viewBox: '0 0 24 24'
                },
                  React.createElement('circle', { className: 'opacity-25', cx: 12, cy: 12, r: 10, stroke: 'currentColor', strokeWidth: 4 }),
                  React.createElement('path', { className: 'opacity-75', fill: 'currentColor', d: 'M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z' })
                ),
                React.createElement('p', { className: `text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}` }, 'Loading concerts...')
              ),

              // Month-grouped event list
              sortedMonths.map(monthKey =>
                React.createElement('div', { key: monthKey, className: 'mb-8' },
                  React.createElement('h3', {
                    className: `text-sm font-semibold uppercase tracking-wider mb-3 px-1 ${isDark ? 'text-gray-400' : 'text-gray-400'}`
                  }, grouped[monthKey].label),

                  React.createElement('div', { className: 'space-y-3' },
                    grouped[monthKey].events.map((event, eventIdx) => {
                      const eventDate = event.date ? new Date(event.date + 'T00:00:00') : null;
                      const dayOfWeek = eventDate ? eventDate.toLocaleDateString('en-US', { weekday: 'short' }) : '';
                      const dayNum = eventDate ? eventDate.getDate() : '?';
                      const monthShort = eventDate ? eventDate.toLocaleDateString('en-US', { month: 'short' }) : '';
                      const location = [event.venue?.city, event.venue?.region, event.venue?.country].filter(Boolean).join(', ');

                      return React.createElement('div', {
                        key: event.id || `${monthKey}-${eventIdx}`,
                        className: 'flex items-center gap-4 p-4 rounded-xl border cursor-default group bg-white border-gray-100',
                        style: {
                          animation: 'fadeIn 300ms ease-out both',
                          animationDelay: `${eventIdx * 30}ms`
                        }
                      },
                        // Date column
                        React.createElement('div', {
                          className: 'flex flex-col items-center text-center',
                          style: { minWidth: '56px' }
                        },
                          React.createElement('span', {
                            className: 'text-xs font-medium text-teal-500 uppercase'
                          }, monthShort),
                          React.createElement('span', {
                            className: `text-2xl font-bold leading-tight ${isDark ? 'text-white' : 'text-gray-900'}`
                          }, dayNum),
                          React.createElement('span', {
                            className: 'text-xs text-gray-400 uppercase'
                          }, dayOfWeek)
                        ),

                        // Event details
                        React.createElement('div', { className: 'flex-1 min-w-0' },
                          React.createElement('div', { className: 'flex items-center gap-2 mb-0.5' },
                            React.createElement('span', {
                              className: `font-semibold truncate ${isDark ? 'text-white' : 'text-gray-900'}`
                            }, event.title || `${currentArtist?.name || event.artist} live`),
                            // Source badges
                            ...(() => {
                              const bgAlpha = isDark ? 0.2 : 0.1;
                              const srcColors = {
                                bandsintown: { bg: `rgba(0, 180, 179, ${bgAlpha})`, text: isDark ? '#2dd4bf' : '#00B4B3' },
                                songkick: { bg: `rgba(248, 0, 70, ${bgAlpha})`, text: isDark ? '#fb7185' : '#F80046' },
                                seatgeek: { bg: `rgba(252, 76, 2, ${bgAlpha})`, text: isDark ? '#fb923c' : '#FC4C02' },
                                ticketmaster: { bg: `rgba(2, 108, 223, ${bgAlpha})`, text: isDark ? '#60a5fa' : '#026CDF' }
                              };
                              const badgeLabel = (src) => src.source === 'bandsintown' ? 'BIT' : src.source === 'songkick' ? 'SK' : src.source === 'seatgeek' ? 'SG' : src.source === 'ticketmaster' ? 'TM' : (src.label || 'Unknown');
                              const badgeFullName = (src) => src.source === 'bandsintown' ? 'Bandsintown' : src.source === 'songkick' ? 'Songkick' : src.source === 'seatgeek' ? 'SeatGeek' : src.source === 'ticketmaster' ? 'Ticketmaster' : (src.label || 'Unknown');
                              const sources = event.ticketSources || [{ source: event.source, aiProviderName: event.aiProviderName }];
                              const hasAiSource = sources.some(s => s.source === 'ai');
                              const badges = sources.map((src, si) => {
                                const c = srcColors[src.source] || { bg: `rgba(16, 201, 180, ${bgAlpha})`, text: isDark ? '#66f0da' : '#10c9b4' };
                                return React.createElement('span', {
                                  key: `badge-${si}`,
                                  className: 'flex-shrink-0 px-1.5 py-0.5 text-xs rounded-full',
                                  style: { backgroundColor: c.bg, color: c.text },
                                  title: badgeFullName(src)
                                }, badgeLabel(src));
                              });
                              if (hasAiSource) {
                                badges.push(React.createElement('span', {
                                  key: 'ai-disclaimer',
                                  className: 'text-xs text-teal-400 italic flex-shrink-0',
                                  title: 'AI-generated results may not be accurate. Verify event details before purchasing tickets.'
                                }, 'AI generated results may be hallucinations'));
                              }
                              return badges;
                            })()
                          ),
                          React.createElement('div', {
                            className: `text-sm truncate ${isDark ? 'text-gray-300' : 'text-gray-600'}`
                          }, event.venue?.name || 'Venue TBA'),
                          location && React.createElement('div', {
                            className: `text-xs truncate mt-0.5 ${isDark ? 'text-gray-500' : 'text-gray-400'}`
                          }, location),
                          event.lineup && event.lineup.length > 1 && React.createElement('div', {
                            className: `text-xs mt-0.5 ${isDark ? 'text-gray-500' : 'text-gray-400'}`
                          }, 'with ' + event.lineup.filter(a => a.toLowerCase() !== (currentArtist?.name || '').toLowerCase()).join(', '))
                        ),

                        // Ticket button with provider flyout
                        (() => {
                          const sources = (event.ticketSources || []).filter(s => s.ticketUrl);
                          const eventId = event.id || `${monthKey}-${eventIdx}`;
                          if (sources.length === 0) return null;
                          if (sources.length === 1) {
                            return React.createElement('a', {
                              href: sources[0].ticketUrl,
                              target: '_blank',
                              rel: 'noopener noreferrer',
                              className: 'flex-shrink-0 px-4 py-2 text-sm font-medium rounded-lg transition-colors no-drag',
                                style: { backgroundColor: '#10c9b4', color: '#fff' },
                                onMouseEnter: (e) => { e.currentTarget.style.backgroundColor = '#0eb3a0'; },
                                onMouseLeave: (e) => { e.currentTarget.style.backgroundColor = '#10c9b4'; },
                              onClick: (e) => e.stopPropagation()
                            }, 'Tickets');
                          }
                          const isOpen = artistConcertsTicketFlyout === eventId;
                          return React.createElement('div', { className: 'relative flex-shrink-0' },
                            React.createElement('button', {
                              onClick: (e) => {
                                e.stopPropagation();
                                setArtistConcertsTicketFlyout(isOpen ? null : eventId);
                              },
                              className: 'px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5',
                                style: { backgroundColor: '#10c9b4', color: '#fff' },
                                onMouseEnter: (e) => { e.currentTarget.style.backgroundColor = '#0eb3a0'; },
                                onMouseLeave: (e) => { e.currentTarget.style.backgroundColor = '#10c9b4'; }
                            },
                              'Tickets',
                              React.createElement('svg', {
                                className: `w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`,
                                fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor'
                              },
                                React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2.5, d: 'M19 9l-7 7-7-7' })
                              )
                            ),
                            isOpen && React.createElement('div', {
                              className: `absolute right-0 top-full mt-1 rounded-lg shadow-lg border py-1 z-30 ${isDark ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'}`,
                              style: { minWidth: '180px' },
                              onClick: (e) => e.stopPropagation()
                            },
                              sources.map((src, si) => {
                                const srcColors = {
                                  bandsintown: isDark ? '#2dd4bf' : '#00B4B3',
                                  songkick: isDark ? '#fb7185' : '#F80046',
                                  seatgeek: isDark ? '#fb923c' : '#FC4C02',
                                  ticketmaster: isDark ? '#60a5fa' : '#026CDF'
                                };
                                const color = srcColors[src.source] || (isDark ? '#66f0da' : '#10c9b4');
                                return React.createElement('a', {
                                  key: si,
                                  href: src.ticketUrl,
                                  target: '_blank',
                                  rel: 'noopener noreferrer',
                                  className: `flex items-center gap-2 px-4 py-2 text-sm transition-colors ${isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-50'}`,
                                  onClick: () => setArtistConcertsTicketFlyout(null)
                                },
                                  React.createElement('span', {
                                    className: 'w-2 h-2 rounded-full flex-shrink-0',
                                    style: { backgroundColor: color }
                                  }),
                                  React.createElement('span', { className: isDark ? 'text-gray-200' : 'text-gray-700' }, src.label),
                                  React.createElement('svg', {
                                    className: 'w-3 h-3 text-gray-400 ml-auto',
                                    fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor'
                                  },
                                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14' })
                                  )
                                );
                              })
                            )
                          );
                        })()
                      );
                    })
                  )
                )
              )
            );
          })()
        )
      );
});

module.exports = { ArtistPage, ARTIST_PAGE_HANDLERS };
