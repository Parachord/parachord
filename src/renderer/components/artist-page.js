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
// is ARTIST_PAGE_HANDLERS). `_metaServiceConfigs` is not read here; it is
// passed only to invalidate the memo when a plug-in's settings change. The refs used here are only
// touched inside callback refs and handlers, never read to decide what
// renders. tests/renderer/page-memo.test.js checks the call site.
//
// The body is the original render expression, unchanged: it reads its inputs
// from props under their old names.

const { sellerColor } = require('../lib/ticket-sellers');
const { SellerBadges } = require('./seller-badges');
const { transition } = require('../lib/motion');
const { Tooltip, ShareButton } = require('./ui-atoms');
const { BrandMark } = require('./brand-logos');
const { CardButton } = require('./card-button');
const Icons = require('./icons');
const { CardSkeleton } = require('./home-skeletons');
const { RELEASE_TYPE_COLORS } = require('../lib/release-types');
const { FilterBox, StickyBar } = require('./filter-box');
const { pluginName } = require('../lib/plugin-names');
const { sourcesIn } = require('../lib/similar-music');
const { Button, buttonClassName } = require('./button');
const { PAGE_COLORS } = require('../lib/page-colors');
const { EmptyState, ErrorState } = require('./states');
const { SortMenu } = require('./sort-menu');
const { Menu } = require('./menu');
const { PageHero } = require('./page-hero');
const { TicketsButton } = require('./tickets-button');
const { ConcertListSkeleton } = require('./concert-skeletons');
const { HeroTabs, heroTabClass } = require('./hero-tabs');
const { SectionHeader } = require('./section-header');
const { FilterChips } = require('./filter-chips');
const { ReleasePage, ReleaseCard, generateArtistPattern, PlayTop10Icon } = require('./cards');
const { ArtistCard, ArtistCardSkeleton } = require('./artist-card');
const { trackSlug, slug } = require('../lib/track-slug');
const { releaseMenu, artistMenu } = require('../lib/item-menus');
const { formatCalendarDate } = require('../lib/calendar-date');
const { generateArtistId } = require('../lib/collection-ids');
const { parseBioMarkup } = require('../lib/bio-markup');
const { countOf } = require('../lib/plural');

// Plain functions from Parachord, passed as stable wrappers.
const ARTIST_PAGE_HANDLERS = [
  'addToQueue',
  'copyParachordLink',
  'fetchArtistData',
  'fetchReleaseData',
  'getArtistBio',
  'getArtistTopTracks',
  'playArtistTopTracks',
  'getRelatedArtists',
  'getServiceColor',
  'handlePlay',
  'handlePlaylistDragEnd',
  'handleSearchInput',
  'loadArtistConcerts',
  'openAlbumVersions',
  'pickArtistBioSource',
  'prefetchReleaseTracks',
  'reprioritizeAlbumArtQueue',
  'resolveRelatedArtistImages',
  'retryReleaseLoad',
  'selectAlbumVersion',
  'setQueueWithContext',
];

const ArtistPage = React.memo(function ArtistPage(props) {
  const {
    activeResolvers,
    addArtistToCollection,
    addToQueue,
    albumArtObserver,
    albumArtQueue,
    albumVersions,
    artistBio,
    artistConcerts,
    artistConcertsLoaded,
    artistConcertsLoading,
    artistExtendedInfo,
    artistImage,
    artistImagePosition,
    artistLoadError,
    artistPageScrollRef,
    artistPageTab,
    artistReleases,
    artistSearch,
    artistSearchOpen,
    artistSort,
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
    playArtistTopTracks,
    getRelatedArtists,
    getServiceColor,
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
    openAlbumVersions,
    pickArtistBioSource,
    playbackContext,
    prefetchReleaseTracks,
    prefetchedReleasesRef,
    publishArtistSmartLink,
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
    retryReleaseLoad,
    selectAlbumVersion,
    setAddToPlaylistPanel,
    setArtistBio,
    setArtistPageTab,
    setArtistSearch,
    setArtistSearchOpen,
    setArtistSort,
    setCurrentRelease,
    setDraggingTrackForPlaylist,
    setIsHeaderCollapsed,
    setLoadingBio,
    setQueueWithContext,
    setRelatedArtists,
    setRelatedArtistsSourceFilter,
    setReleaseTypeFilter,
    setSelectedPlaylistsForAdd,
    setTrackLoading,
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
        // The shared page hero (components/page-hero.js), with the artist's
        // photo for its background.
        !currentRelease && !loadingRelease && React.createElement(PageHero, {
          collapsed: isHeaderCollapsed,
          photo: { url: artistImage || null, position: artistImagePosition },
          // Right-click anywhere on the hero (not only the name): Copy link /
          // View on Achordion.
          onContextMenu: copyParachordLink,
          onExpand: () => setIsHeaderCollapsed(false),
          title: null,
          expanded: currentArtist && React.createElement(React.Fragment, null,
            // Artist name with star button (star positioned absolutely to not affect centering)
            React.createElement('div', {
              className: 'relative inline-flex items-center'
            },
              React.createElement('h1', {
                className: 'hero-title font-light text-white',
                style: {
                  textShadow: 'var(--hero-text-shadow)',
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
                    React.createElement(Button, { variant: 'icon', size: 'sm', tone: 'dark', className: isInCollection ? '!text-on-dark-star hover:!text-on-dark-star-hover' : '', style: { filter: 'var(--icon-shadow)' }, 'aria-label': isInCollection ? 'Remove from collection' : 'Add to collection', onClick: (e) => {
                        e.stopPropagation();
                        if (!isInCollection) {
                          addArtistToCollection({ name: currentArtist.name, image: artistImage });
                        } else {
                          removeArtistFromCollection({ name: currentArtist.name });
                        }
                      } }, React.createElement('svg', {
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
                      ))
                  )
                );
              })()
            ),
            // Navigation tabs (centered)
            React.createElement('div', {
              role: 'tablist',
              'aria-label': 'Artist',
              className: 'flex items-center gap-1 mt-6',
              style: { textShadow: 'var(--photo-text-shadow)' }
            },
              (() => {
                // On Tour only for an artist with upcoming concerts; while they load, an
                // open On Tour (a deep link, a restored page) keeps its tab.
                const showOnTour = artistConcerts.length > 0 || (artistPageTab === 'on-tour' && !artistConcertsLoaded);
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
                        transition: transition('opacity max-width', 'deliberate')
                      } : undefined
                    }, '|'),
                    React.createElement('button', {
                      key: tab,
                      role: 'tab',
                      'aria-selected': artistPageTab === tab ? 'true' : 'false',
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
                      // The hero tab look (heroTabClass): the selected tab is
                      // semibold and underlined.
                      className: `py-1 text-sm uppercase tracking-wider transition-colors no-drag ${heroTabClass(artistPageTab === tab)}`,
                      style: isOnTour ? {
                        opacity: showOnTour ? 1 : 0,
                        maxWidth: showOnTour ? '200px' : '0px',
            overflow: 'hidden',
                        padding: showOnTour ? '0.25rem 0.5rem' : '0.25rem 0',
                        transition: transition('opacity max-width padding', 'deliberate'),
                        whiteSpace: 'nowrap'
                      } : { padding: '0.25rem 0.5rem' }
                    }, tab === 'related' ? 'Related Artists' : tab === 'on-tour' ? 'On Tour' : tab.charAt(0).toUpperCase() + tab.slice(1))
                  ];
                }).flat().filter(Boolean);
              })()
            ),
            // Play top tracks: the shared primary Button (it was a one-off
            // pink pill with a glow).
            // Share beside it (components/menu.js), as on album and playlist
            // pages: the Achordion artist link, or the page itself.
            React.createElement('div', { className: 'mt-6 flex items-center', style: { gap: '12px' } },
              React.createElement(Button, {
                variant: 'primary',
                size: isCompactHeader ? 'sm' : 'md',
                onClick: () => currentArtist && playArtistTopTracks(currentArtist)
              }, React.createElement(Icons.Play, { size: 16 }), isCompactHeader ? 'Play' : 'Play top tracks'),
              currentArtist && React.createElement(Menu, {
                label: 'Share',
                renderTrigger: (t) => React.createElement(ShareButton, t),
                items: [
                  {
                    key: 'copy-link',
                    label: 'Copy link',
                    icon: React.createElement(Icons.Link, { size: 16 }),
                    onSelect: () => publishArtistSmartLink({ id: slug(currentArtist.name || 'unknown'), name: currentArtist.name, image: artistImage })
                  },
                  {
                    key: 'view-on-achordion',
                    label: 'View on Achordion',
                    icon: React.createElement(Icons.ExternalLink, { size: 16 }),
                    onSelect: () => publishArtistSmartLink({ id: slug(currentArtist.name || 'unknown'), name: currentArtist.name, image: artistImage }, { openInBrowser: true })
                  }
                ]
              })
            )
          ),
          collapsedContent: currentArtist && React.createElement(React.Fragment, null,
            // Left side: Artist name with star button - clickable to expand header
            React.createElement('div', {
              className: 'hero-bar-title flex items-center gap-2 mr-6',
              style: { maxWidth: '40%' }
            },
              // A button (keyboard-reachable), not a clickable heading: the
              // expanded hero holds the page's h1.
              React.createElement('button', { type: 'button',
                className: 'text-left text-2xl font-light text-white cursor-pointer hover:text-white/80 transition-colors no-drag',
                style: {
                  textShadow: 'var(--hero-text-shadow-bar)',
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  lineHeight: '1.2'
                },
                onClick: () => setIsHeaderCollapsed(false),
                onContextMenu: copyParachordLink,
                'data-tooltip': 'Show the full header'
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
                  React.createElement(Button, { variant: 'icon', size: 'sm', tone: 'dark', className: isInCollection ? '!text-on-dark-star hover:!text-on-dark-star-hover' : '', style: { filter: 'var(--icon-shadow)' }, 'aria-label': isInCollection ? 'Remove from collection' : 'Add to collection', onClick: (e) => {
                      e.stopPropagation();
                      if (!isInCollection) {
                        addArtistToCollection({ name: currentArtist.name, image: artistImage });
                      } else {
                        removeArtistFromCollection({ name: currentArtist.name });
                      }
                    } }, React.createElement('svg', {
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
                    ))
                );
              })()
            ),
            // Center: Navigation tabs
            React.createElement('div', {
              role: 'tablist',
              'aria-label': 'Artist',
              className: 'flex items-center gap-1',
              style: { textShadow: 'var(--photo-text-shadow)' }
            },
              (() => {
                // On Tour only for an artist with upcoming concerts; while they load, an
                // open On Tour (a deep link, a restored page) keeps its tab.
                const showOnTour = artistConcerts.length > 0 || (artistPageTab === 'on-tour' && !artistConcertsLoaded);
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
                        transition: transition('opacity max-width', 'deliberate')
                      } : undefined
                    }, '|'),
                    React.createElement('button', {
                      key: `collapsed-${tab}`,
                      role: 'tab',
                      'aria-selected': artistPageTab === tab ? 'true' : 'false',
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
                      // The hero tab look (heroTabClass): the selected tab is
                      // semibold and underlined.
                      className: `py-1 text-sm uppercase tracking-wider transition-colors no-drag ${heroTabClass(artistPageTab === tab)}`,
                      style: isOnTour ? {
                        opacity: showOnTour ? 1 : 0,
                        maxWidth: showOnTour ? '200px' : '0px',
            overflow: 'hidden',
                        padding: showOnTour ? '0.25rem 0.5rem' : '0.25rem 0',
                        transition: transition('opacity max-width padding', 'deliberate'),
                        whiteSpace: 'nowrap'
                      } : { padding: '0.25rem 0.5rem' }
                    }, tab === 'related' ? 'Related Artists' : tab === 'on-tour' ? 'On Tour' : tab.charAt(0).toUpperCase() + tab.slice(1))
                  ];
                }).flat().filter(Boolean);
              })()
            ),
            // Right side: Play top tracks (the shared primary Button).
            React.createElement(Button, {
              variant: 'primary',
              size: 'sm',
              onClick: () => currentArtist && playArtistTopTracks(currentArtist),
              className: 'ml-auto'
            }, React.createElement(Icons.Play, { size: 14 }), isCompactHeader ? 'Play' : 'Play top tracks')
          )
        }),
        
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
                ? 'var(--photo-shade-bar)'
                : 'var(--photo-shade-empty)'
            }
          }),
          // Artist info overlay (inline layout for release page - matches collapsed artist header)
          React.createElement('div', {
            className: 'hero-bar absolute inset-0 flex items-center px-6 z-10'
          },
            // Left side: Artist name
            // A button (keyboard-reachable), not a clickable heading: the
              // expanded hero holds the page's h1.
              React.createElement('button', { type: 'button',
              className: 'text-left text-2xl font-light mr-6 text-white cursor-pointer hover:text-white/80 transition-colors no-drag flex-shrink-0',
              style: {
                textShadow: 'var(--hero-text-shadow-bar)',
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
              'data-tooltip': 'Back to artist'
            }, currentRelease.artist?.name || currentArtist?.name),
            // Center: Navigation tabs
            React.createElement('div', {
              className: 'flex items-center gap-1',
              style: { textShadow: 'var(--hero-text-shadow-line)' }
            },
              React.createElement(HeroTabs, { items: ['music', 'biography', 'related', ...(artistConcerts.length > 0 || (artistPageTab === 'on-tour' && !artistConcertsLoaded) ? ['on-tour'] : [])], isSelected: (tab) => tab === 'music', onSelect: async (tab) => {
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
                  }, renderLabel: (tab) => tab === 'related' ? 'Related Artists' : tab === 'on-tour' ? 'On Tour' : tab.charAt(0).toUpperCase() + tab.slice(1), label: 'Artist' })
            )
          )
        ),

        // Release page content - new layout with album details header
        // Show immediately with partial data (tracks may still be loading)
        currentRelease && React.createElement('div', {
          className: 'page-bg',
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
                style: { color: 'var(--text-tertiary)', transition: transition('color', 'fast') },
                className: 'hover:text-ink-secondary transition-colors uppercase hover:!text-[var(--text-secondary)]',
              }, currentArtist?.name || currentRelease?.artist?.name || 'Artist'),
              React.createElement('span', { style: { color: 'var(--border-default)' } }, '/'),
              // The album's heading (#1386), drawn as the breadcrumb's last part.
              React.createElement('h2', { style: { color: 'var(--text-secondary)', margin: 0, font: 'inherit', display: 'inline' }, className: 'uppercase' },
                currentRelease?.title || 'Album details'
              )
            ),
            // Empty div to maintain layout (no close button needed with breadcrumb)
            React.createElement('div')
          ),
          // Two-column layout: album art + metadata on left, tracklist on right
          React.createElement(ReleasePage, {
            release: currentRelease,
            onRetryLoad: retryReleaseLoad,
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
                window.showItemMenu({
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
            // The album source dropdown (#1238): the editions of this album
            // (the MusicBrainz group's releases and the resolvers' editions),
            // loaded lazily when the dropdown opens.
            albumVersions: albumVersions,
            onOpenAlbumVersions: openAlbumVersions,
            onSelectAlbumVersion: selectAlbumVersion,
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
                window.showItemMenu(releaseMenu(rel, { tracks: rel.tracks }));
              }
            },
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
            // The shared card's placeholder, in the discography's grid.
            React.createElement('div', {
              className: 'card-grid gap-x-4 gap-y-5'
            },
              Array.from({ length: 10 }).map((_, i) =>
                React.createElement(CardSkeleton, { key: `album-skeleton-${i}`, index: i, lines: 1 })
              )
            )
          )
        ),
        
        // Artist content (scrollable) - show when we have artist data (even while releases are loading)
        !currentRelease && !loadingRelease && currentArtist && React.createElement('div', {
          ref: artistPageScrollRef,
          // scroll-edge: a shadow under the hero once content scrolls beneath it.
          className: 'scrollable-content scroll-edge',
          style: {
            flex: 1,
            overflowY: 'scroll',
            pointerEvents: 'auto'
          },
          onScroll: handleArtistPageScroll
        },
          // Sticky filter bar (Music tab only) - refined styling
          artistPageTab === 'music' && React.createElement(StickyBar, null,
            // Release type filters: the app's filter chips (FilterChips), All
            // neutral, each type in its colour.
            (() => {
              const searchFiltered = filterArtistReleases(artistReleases);
              const chips = [
                { value: 'all', label: 'All' },
                { value: 'album', label: 'Studio Albums', color: RELEASE_TYPE_COLORS.album },
                { value: 'ep', label: 'EPs', color: RELEASE_TYPE_COLORS.ep },
                { value: 'single', label: 'Singles', color: RELEASE_TYPE_COLORS.single },
                { value: 'live', label: 'Live', color: RELEASE_TYPE_COLORS.live },
                { value: 'compilation', label: 'Compilations', color: RELEASE_TYPE_COLORS.compilation }
              ].map(({ value, label, color }) => {
                const count = value === 'all'
                  ? searchFiltered.length
                  : searchFiltered.filter(r => r.releaseType === value).length;
                // While loading, show all filter types; otherwise hide those with 0 count (except 'all')
                if (!loadingArtist && count === 0 && value !== 'all') return null;
                return { id: value, label: loadingArtist ? label : `${label} (${count})`, color };
              }).filter(Boolean);
              return React.createElement(FilterChips, { chips, value: releaseTypeFilter, onChange: setReleaseTypeFilter, label: 'Filter releases by type' });
            })(),
            // Spacer
            React.createElement('div', { className: 'flex-1' }),
            // Sort (components/sort-menu.js)
            React.createElement('div', { className: 'mr-3' },
              React.createElement(SortMenu, { value: artistSort, options: artistSortOptions, onChange: setArtistSort, label: 'Sort releases', align: 'right' })
            ),
            // Search toggle/field
            React.createElement(FilterBox, { value: artistSearch, onChange: setArtistSearch, open: artistSearchOpen, onOpenChange: setArtistSearchOpen })
          ),
          // MUSIC TAB - Discography
          artistPageTab === 'music' && React.createElement('div', {
            className: 'space-y-6 p-6'
          },
            // Discography grid - cards handle their own album art loading shimmer
            React.createElement('div', {
              className: 'card-grid gap-x-4 gap-y-5 pb-6',
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
                      // The same album menu as everywhere (lib/item-menus.js).
                      const albumData = { ...rel, artist: currentArtist?.name };
                      // Check prefetched cache first (use ref to avoid stale closure)
                      const prefetched = prefetchedReleasesRef.current[rel.id];
                      if (prefetched?.tracks?.length > 0) {
                        window.showItemMenu(releaseMenu(albumData, { tracks: prefetched.tracks }));
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
                        window.showItemMenu(releaseMenu(albumData, { tracks: tracks }));
                      } else {
                        // No tracks available yet - show with 0 tracks
                        window.showItemMenu(releaseMenu(albumData, { tracks: [] }));
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
                      // Its own result: the ref is only synced after the next render.
                      const newPrefetched = { tracks: await prefetchReleaseTracks(rel, currentArtist) };
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
                      // Its own result: the ref is only synced after the next render.
                      const newPrefetched = { tracks: await prefetchReleaseTracks(rel, currentArtist) };
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
                      // Its own result: the ref is only synced after the next render.
                      const newPrefetched = { tracks: await prefetchReleaseTracks(rel, currentArtist) };
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

            // MusicBrainz couldn't load the discography and no service's
            // stood in (#874): say so, with Try again, rather than "No albums
            // found", which reads as an artist with no releases.
            !loadingArtist && artistReleases.length === 0 && artistLoadError &&
              currentArtist && artistLoadError.name === currentArtist.name ? React.createElement(ErrorState, { title: 'Couldn’t load this artist’s discography', body: artistLoadError.message, onRetry: () => fetchArtistData(currentArtist.name, { mbid: currentArtist.mbid }) }) :
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
                return React.createElement('div', { className: 'text-center py-12 text-ink-tertiary' },
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
                        fontSize: '11px',
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
                      // A calendar date, read in local time so a full date isn't shown a day early (#1288).
                      formatCalendarDate(artistExtendedInfo.foundedDate, 'short')
                    )
                  ),

                  // Founded In / Origin
                  artistExtendedInfo.foundedIn && React.createElement('div', null,
                    React.createElement('div', {
                      style: {
                        fontSize: '11px',
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
                        fontSize: '11px',
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
                        color: artistExtendedInfo.isActive ? 'var(--text-success)' : 'var(--text-secondary)',
                        lineHeight: '1.4'
                      }
                    }, artistExtendedInfo.isActive ? 'Active' : `Disbanded${artistExtendedInfo.endedDate ? ` (${artistExtendedInfo.endedDate.split('-')[0]})` : ''}`)
                  ),

                  // Official Homepage
                  artistExtendedInfo.urls.officialHomepage && React.createElement('div', null,
                    React.createElement('div', {
                      style: {
                        fontSize: '11px',
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
                        display: 'block',
            overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        textDecoration: 'none'
                      },
                      className: 'text-accent hover:underline',
                      'data-tooltip': artistExtendedInfo.urls.officialHomepage
                    }, new URL(artistExtendedInfo.urls.officialHomepage).hostname.replace(/^www\./, ''))
                  ),

                  // Social Media Links
                  (artistExtendedInfo.urls.twitter || artistExtendedInfo.urls.instagram || artistExtendedInfo.urls.facebook || artistExtendedInfo.urls.youtube) && React.createElement('div', { style: { paddingTop: '4px' } },
                    React.createElement('div', {
                      style: {
                        fontSize: '11px',
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
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        },
                        'aria-label': 'Twitter/X', 'data-tooltip': 'Twitter/X',
                        className: 'social-link'
                      },
                        React.createElement(BrandMark, { id: 'x', size: 14, style: { color: 'var(--nav-inactive)' } })
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
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        },
                        'aria-label': 'Instagram', 'data-tooltip': 'Instagram',
                        className: 'social-link'
                      },
                        React.createElement(BrandMark, { id: 'instagram', size: 14, style: { color: 'var(--nav-inactive)' } })
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
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        },
                        'aria-label': 'Facebook', 'data-tooltip': 'Facebook',
                        className: 'social-link'
                      },
                        React.createElement(BrandMark, { id: 'facebook', size: 14, style: { color: 'var(--nav-inactive)' } })
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
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        },
                        'aria-label': 'YouTube', 'data-tooltip': 'YouTube',
                        className: 'social-link'
                      },
                        React.createElement(BrandMark, { id: 'youtube', size: 14, style: { color: 'var(--nav-inactive)' } })
                      )
                    )
                  ),

                  // Members section (for Groups/Bands)
                  (artistExtendedInfo.members.current.length > 0 || artistExtendedInfo.members.former.length > 0) && React.createElement('div', {
                    style: {
                      paddingTop: '10px',
                      marginTop: '6px',
                      borderTop: '1px solid var(--border-subtle)'
                    }
                  },
                    // Current Members
                    artistExtendedInfo.members.current.length > 0 && React.createElement('div', { style: { marginBottom: '10px' } },
                      React.createElement('div', {
                        style: {
                          fontSize: '11px',
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
                                fontSize: '11px',
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
                          fontSize: '11px',
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
                                fontSize: '11px',
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
                !loadingExtendedInfo && artistExtendedInfo === false && React.createElement(EmptyState, {
                  compact: true, icon: null,
                  title: 'No more details',
                  body: 'MusicBrainz has no members or links for this artist yet.'
                })
              )
            ),

            // RIGHT COLUMN: Biography. Every plug-in with a bio for this artist
            // (capabilities.biography, #1539 step 6) is in artistBio.sources,
            // in the user's order; the first is shown, and the Source menu
            // (SortMenu, as on Pop of the Tops) switches to another. The
            // source line stands at the top at one height whether it is the
            // menu or, with a single source, its name, and the skeleton
            // keeps a bar for it.
            React.createElement('div', { className: 'flex-1 min-w-0 max-w-2xl' },
              // Loading state: the source line, then skeleton paragraphs
              loadingBio && React.createElement('div', { className: 'space-y-4' },
                // The Source picker (a small secondary button)
                React.createElement('div', { className: 'h-8 w-40 shimmer-light rounded-lg animate-shimmer', style: { backgroundSize: '200% 100%' } }),
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
              !loadingBio && artistBio && artistBio !== false && (() => {
                const bioSources = Array.isArray(artistBio.sources) && artistBio.sources.length > 0
                  ? artistBio.sources
                  : [artistBio];
                const sourceName = pluginName(artistBio.source);
                return React.createElement('div', { className: 'space-y-4' },
                  // Source: the menu when more than one plug-in has a bio
                  bioSources.length > 1
                    ? React.createElement('div', { className: 'h-8 flex items-center' },
                        React.createElement(SortMenu, {
                          variant: 'button',
                          value: artistBio.source,
                          options: bioSources.map(src => ({ value: src.source, label: pluginName(src.source) })),
                          label: 'Biography source',
                          prefix: 'Source:',
                          // Shows it and remembers it for every artist (app.js).
                          onChange: pickArtistBioSource,
                        })
                      )
                    : React.createElement('div', { className: 'h-8 flex items-center text-sm text-ink-tertiary' },
                        React.createElement('span', { className: 'mr-1' }, 'Source:'),
                        React.createElement('span', null, sourceName)
                      ),
                  React.createElement('div', {
                    className: 'text-sm text-ink-secondary leading-relaxed whitespace-pre-wrap'
                  }, artistBio.markup === 'bbcode'
                    // A bio with [b]/[i]/[u]/[url=] tags (lib/bio-markup.js).
                    ? parseBioMarkup(artistBio.text).map((seg, i) => {
                        const style = {
                          fontWeight: seg.bold ? 600 : undefined,
                          fontStyle: seg.italic ? 'italic' : undefined,
                          textDecoration: seg.underline ? 'underline' : undefined,
                        };
                        return seg.href
                          ? React.createElement('a', { key: i, href: seg.href, target: '_blank', rel: 'noopener noreferrer', className: 'text-accent hover:text-accent', style }, seg.text)
                          : React.createElement('span', { key: i, style }, seg.text);
                      })
                    : artistBio.text),
                  // The source's own page
                  artistBio.url && React.createElement('div', { className: 'mt-4' },
                    React.createElement('a', {
                      href: artistBio.url,
                      target: '_blank',
                      rel: 'noopener noreferrer',
                      className: 'text-accent hover:text-accent text-sm'
                    }, `Read more on ${sourceName} →`)
                  )
                );
              })(),
              // No bio found (artistBio === false means we fetched but found nothing)
              !loadingBio && artistBio === false && React.createElement(EmptyState, {
                title: 'No biography for this artist',
                body: 'None of your plug-ins has one yet.'
              })
            )
          ),

          // RELATED ARTISTS TAB
          artistPageTab === 'related' && (() => {
            // One chip per plug-in that listed artists (each entry's
            // `sources`, lib/similar-music.js, #1539), named and coloured from
            // the plug-in registry, never a per-service copy. The bar shows
            // once two or more plug-ins answered.
            const relatedSources = sourcesIn(relatedArtists);
            const showSourceChips = relatedSources.length > 1;
            const serviceColor = (id) => getServiceColor(id) || 'var(--accent-primary)';
            const sourceChips = [
              { value: 'all', label: 'All', count: relatedArtists.length },
              // No "Both" chip: an artist several plug-ins found shows under each.
              ...relatedSources.map(id => ({
                value: id,
                label: pluginName(id),
                count: relatedArtists.filter(a => (a.sources || []).includes(id)).length,
                color: serviceColor(id)
              }))
            ].filter(({ value, count }) => value === 'all' || count > 0).map(({ value, label, count, color }) => (
              { id: value, label: loadingRelated ? label : `${label} (${count})`, color }
            ));
            // A picked chip that isn't shown (the bar hidden, or its count 0)
            // filters as All, so the page never shows an empty source with no
            // chip to switch back.
            const sourceFilter = showSourceChips && sourceChips.some(c => c.id === relatedArtistsSourceFilter)
              ? relatedArtistsSourceFilter
              : 'all';

            // Filter artists based on source filter
            const filteredArtists = sourceFilter === 'all'
              ? relatedArtists
              : relatedArtists.filter(a => (a.sources || []).includes(sourceFilter));

            return React.createElement(React.Fragment, null,
              // Sticky filter bar: once two or more plug-ins listed artists.
              showSourceChips && React.createElement(StickyBar, null,
                // The app's filter chips (FilterChips): All neutral, each
                // plug-in in its own colour.
                React.createElement(FilterChips, {
                  chips: sourceChips,
                  value: sourceFilter,
                  onChange: setRelatedArtistsSourceFilter,
                  label: 'Filter related artists by source'
                })
              ),
              // Content with padding
              React.createElement('div', { className: 'p-6' },
                // Related artists grid (sorted by match, highest first) - Square card design
                // Cards handle their own image loading shimmer, no need for full skeleton grid
                filteredArtists.length > 0 && React.createElement('div', { role: 'list',
                  className: 'grid gap-4',
                  style: { gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }
                },
                  [...filteredArtists].sort((a, b) => b.match - a.match).map((artist, index) => React.createElement(ArtistCard, {
                    key: artist.name,
                    role: 'listitem',
                    artist: { id: slug(artist.name || 'unknown'), name: artist.name },
                    image: artist.image,
                    imageLoaded: !!artist.imageLoaded,
                    animationDelay: Math.min(index * 30, 300),
                    onOpen: () => fetchArtistData(artist.name),
                    onPlay: playArtistTopTracks,
                    onContextMenu: () => window.showItemMenu(artistMenu({ id: slug(artist.name || 'unknown'), name: artist.name, image: artist.image }))
                  }))
                ),
                // Still looking: the cards' placeholders, in the real grid.
                loadingRelated && filteredArtists.length === 0 && React.createElement('div', {
                  className: 'grid gap-4', 'aria-hidden': 'true',
                  style: { gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }
                }, Array.from({ length: 12 }).map((_, i) => React.createElement(ArtistCardSkeleton, { key: i, index: i }))),
                // None found (or filtered to none): the shared empty state.
                !loadingRelated && filteredArtists.length === 0 && React.createElement(EmptyState, relatedArtists.length === 0
                  ? { title: 'No related artists yet', body: 'None of your plug-ins list any for this artist.' }
                  : { title: `No related artists from ${pluginName(sourceFilter)}`, body: 'Pick All to see the rest.' })
              )
            );
          })(),

          // On Tour tab — upcoming concerts for this artist
          artistPageTab === 'on-tour' && (() => {
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

            const concertsColor = PAGE_COLORS.concerts.color;
            return React.createElement(React.Fragment, null,
              // A sticky bar (like Related artists' filter bar): the count, a
              // spinner beside it while loading, and refresh on the right; the
              // months scroll beneath it.
              React.createElement(StickyBar, null,
                React.createElement(SectionHeader, {
                  title: React.createElement(React.Fragment, null,
                    // No count until there's one to give (it read "0 upcoming concerts" while loading).
                    events.length === 0 ? 'Upcoming concerts' : countOf(events.length, 'upcoming concert'),
                    artistConcertsLoading && React.createElement(Icons.Spinner, { className: 'w-4 h-4', style: { display: 'inline-block', verticalAlign: 'middle', marginLeft: '12px', color: concertsColor } })),
                  style: { marginBottom: 0, alignItems: 'center', width: '100%' },
                  extra: React.createElement(Button, {
                    variant: 'icon', size: 'sm',
                    onClick: () => currentArtist && loadArtistConcerts(currentArtist.name, true),
                    disabled: artistConcertsLoading,
                    'aria-label': artistConcertsLoading ? 'Loading…' : 'Refresh', 'data-tooltip': artistConcertsLoading ? 'Loading…' : 'Refresh'
                  },
                    React.createElement(Icons.RefreshCw, { className: `w-4 h-4 ${artistConcertsLoading ? 'animate-spin' : ''}` })
                  )
                })
              ),
              React.createElement('div', { className: 'p-6' },

              // No empty state: On Tour never shows with no concerts (the page
              // goes back to Music). Until they arrive, the On tour row's
              // skeleton (components/concert-skeletons.js).
              events.length === 0 && (artistConcertsLoading || !artistConcertsLoaded) && React.createElement(ConcertListSkeleton, { count: 4 }),

              // Month-grouped event list
              sortedMonths.map(monthKey =>
                React.createElement('div', { key: monthKey, className: 'mb-8' },
                  React.createElement('h3', {
                    className: `text-sm font-semibold uppercase tracking-wider mb-3 px-1 text-ink-tertiary`
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
                        className: 'flex items-center gap-4 p-4 rounded-xl border cursor-default group bg-surface-card border-line-light',
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
                            className: 'text-xs font-medium uppercase',
                            style: { color: concertsColor }
                          }, monthShort),
                          React.createElement('span', {
                            className: `text-2xl font-bold leading-tight text-ink-primary`
                          }, dayNum),
                          React.createElement('span', {
                            className: 'text-xs text-ink-tertiary uppercase'
                          }, dayOfWeek)
                        ),

                        // Event details
                        React.createElement('div', { className: 'flex-1 min-w-0' },
                          React.createElement('div', { className: 'flex items-center gap-2 mb-0.5' },
                            React.createElement('span', {
                              className: `font-semibold truncate text-ink-primary`
                            }, event.title || `${currentArtist?.name || event.artist} live`),
                            // Where the tickets come from (components/seller-badges.js).
                            ...SellerBadges({ sources: event.ticketSources || [{ source: event.source, aiProviderName: event.aiProviderName }] })
                          ),
                          React.createElement('div', {
                            className: `text-sm truncate text-ink-secondary`
                          }, event.venue?.name || 'Venue TBA'),
                          location && React.createElement('div', {
                            className: `text-xs truncate mt-0.5 text-ink-tertiary`
                          }, location),
                          event.lineup && event.lineup.length > 1 && React.createElement('div', {
                            className: `text-xs mt-0.5 text-ink-tertiary`
                          }, 'with ' + event.lineup.filter(a => a.toLowerCase() !== (currentArtist?.name || '').toLowerCase()).join(', '))
                        ),

                        // The shared teal Tickets button (components/tickets-button.js).
                        React.createElement(TicketsButton, { sources: event.ticketSources, artist: currentArtist?.name })
                      );
                    })
                  )
                )
              )
            ));
          })()
        )
      );
});

module.exports = { ArtistPage, ARTIST_PAGE_HANDLERS };
