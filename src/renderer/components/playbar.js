// src/renderer/components/playbar.js: the player bar along the bottom of
// the window: transport and the queue button on the left; the now-playing
// track (cover, title, artist, its source and the Play from menu) in the
// middle; seek, love, shuffle, repeat and volume on the right (#1451, moved
// out of app.js).
//
// A React.memo'd panel fed stable props: state, setters, refs, callbacks
// and the playback, queue and volume hooks' values by value, plain
// functions through useStableHandlers (PLAYBAR_HANDLERS, pinned by
// tests/renderer/page-memo.test.js). Seek progress comes through
// PlaybackProgress's subscription, not a prop, so a tick never re-renders
// the bar. The markup moved as it was; window is read only inside handlers.

const Icons = require('./icons');
const { findSavedTrack } = require('../lib/collection-ids');
const { trackSlug } = require('../lib/track-slug');
const { playbarShowsTrack } = require('../lib/playbar-art');
const { playStartPending } = require('../lib/play-state');
const { purchaseSource: pickPurchaseSource } = require('../lib/purchase-source');
const { isPlayableSource } = require('../lib/playable-source');
const { sourceBlockId } = require('../lib/bad-match-report');
const { ResolverIcon, Tooltip, PlaybackProgress } = require('./ui-atoms');
const { PAGE_COLORS } = require('../lib/page-colors');
const { NO_PLUGIN_COLOR, ParachordAppIcon } = require('./brand-logos');
const { LISTENER_HEXAGON } = require('./listener-card');
const { Button } = require('./button');
const { PlaybarLineSkeleton } = require('./playbar-skeleton');
const { Menu } = require('./menu');
const { Slider } = require('./fields');
const { transition } = require('../lib/motion');
const { DropZoneOverlay } = require('./drop-zone-overlay');

const { List, Music, Pause, Play, SkipBack, SkipForward } = Icons;

const PLAYBAR_HANDLERS = [
  'closeAiChat',
  'fetchArtistData',
  'getChatServices',
  'handleDragEnter',
  'handleDragLeave',
  'handleDragOver',
  'handleDrop',
  'handlePlaylistDragEnd',
  'haversineDistance',
  'isServiceEnabled',
  'mediaElementFor',
  'openAiChat',
  'openAlbumForTrack',
  'playsInApp',
  'requestRepeat',
  'requestShuffle',
];

const Playbar = React.memo(function Playbar(props) {
  const {
    addTrackToCollection,
    aiChatOpen,
    allResolvers,
    applyLocalFileVolume,
    browserPlaybackActive,
    closeAiChat,
    collectionData,
    concerts,
    concertsLoaded,
    concertsLocation,
    concertsLocationCoords,
    concertsLocationRadius,
    currentQueue,
    currentTrack,
    currentTrackRef,
    determineResolverIdFromTrack,
    dropZoneTarget,
    exitSpinoff,
    fetchArtistData,
    formatTime,
    getChatServices,
    getEffectiveVolume,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleNext,
    handlePlay,
    handlePlayPause,
    handlePlaylistDragEnd,
    handlePrevious,
    handleSeek,
    haversineDistance,
    isDraggingUrl,
    isExternalPlayback,
    isMuted,
    isPlaying,
    isServiceEnabled,
    listenAlongFriend,
    loadingTrack,
    mediaElementFor,
    openAiChat,
    openAlbumForTrack,
    pendingProtocolTabRef,
    playHistoryRef,
    playbackResolvers,
    playbarAlbumArt,
    playbarArtistBio,
    playsInApp,
    preMuteVolumeRef,
    progressRef,
    queueAnimating,
    queueDrawerOpen,
    removeTrackFromCollection,
    repeatMode,
    requestRepeat,
    requestShuffle,
    resolverBlocklist,
    resolverVolumeOffsets,
    resumePending,
    setDraggingTrackForPlaylist,
    setIsMuted,
    setPlaybarAlbumArt,
    setQueueDrawerOpen,
    setSpotifyVolume,
    setSpotifyVolumeDebounced,
    setVolume,
    shuffleMode,
    spinoffAvailable,
    spinoffLoading,
    spinoffMode,
    spotifyDevice,
    startSpinoff,
    subscribeProgress,
    trackLoading,
    trackSources,
    trackSourcesCache,
    volume,
  } = props;
  return React.createElement('div', {
      role: 'region', 'aria-label': 'Player',
      className: 'on-dark backdrop-blur-xl py-3 no-drag flex-shrink-0 relative z-50',
      style: { minHeight: '85px', paddingLeft: '26px', paddingRight: '26px', backgroundColor: 'var(--surface-dark)', borderTop: '1px solid var(--surface-dark-border)' },
      onDragEnter: (e) => handleDragEnter(e, 'now-playing'),
      onDragOver: (e) => handleDragOver(e, 'now-playing'),
      onDragLeave: handleDragLeave,
      onDrop: (e) => handleDrop(e, 'now-playing')
    },
      React.createElement('div', { className: 'flex items-center justify-between gap-4' },
        // LEFT: Transport controls + Queue button
        React.createElement('div', { className: 'flex items-center gap-2' },
          React.createElement(Tooltip, { content: 'Previous', position: 'top', variant: 'dark' },
            // Enabled with no current track too while there is history: the
            // end of the queue clears the track, and Previous brings it back
            // (#1319). The ref read is current here: handleNext pushes to the
            // history before the setCurrentTrack(null) that re-renders this.
            React.createElement(Button, { variant: 'icon', tone: 'dark', style: { color: 'var(--on-dark-primary)' }, 'aria-label': 'Previous', onClick: handlePrevious, disabled: !currentTrack && playHistoryRef.current.length === 0 }, React.createElement(SkipBack, { size: 18 }))
          ),
          React.createElement(Tooltip, { content: isPlaying ? 'Pause' : (playStartPending({ currentTrack, isPlaying, trackLoading, loadingTrack, resumePending }) ? 'Starting…' : 'Play'), position: 'top', variant: 'dark' },
            React.createElement(Button, { variant: 'icon', tone: 'dark', style: { color: 'var(--on-dark-primary)' }, 'aria-label': isPlaying ? 'Pause' : 'Play', onClick: handlePlayPause, disabled: !currentTrack }, isPlaying ? React.createElement(Pause, { size: 22 }) : React.createElement(Play, { size: 22 }))
          ),
          React.createElement(Tooltip, { content: 'Next', position: 'top', variant: 'dark' },
            React.createElement(Button, { variant: 'icon', tone: 'dark', style: { color: 'var(--on-dark-primary)' }, 'aria-label': 'Next', onClick: () => handleNext(true), disabled: !currentTrack }, React.createElement(SkipForward, { size: 18 }))
          ),
          // Queue button (hamburger style)
          React.createElement(Tooltip, { content: listenAlongFriend ? `Queue (listening along with ${listenAlongFriend.displayName || listenAlongFriend.username})` : 'Queue', position: 'top', variant: 'dark' },
            // The shared dark icon button; open reads as pressed.
            React.createElement(Button, {
              variant: 'icon', size: 'sm', tone: 'dark',
              'aria-label': 'Queue', 'aria-pressed': queueDrawerOpen ? 'true' : 'false',
              // Who decides what's next while listening along.
              'aria-description': listenAlongFriend ? `Listening along with ${listenAlongFriend.displayName || listenAlongFriend.username}` : undefined,
              onClick: () => setQueueDrawerOpen(!queueDrawerOpen),
              className: `relative ml-1 ${queueDrawerOpen ? '!bg-white/20 !text-white' : ''} ${queueAnimating ? 'queue-pulse' : ''}`
            },
              // Listening along, your queue is on hold: only the icon dims,
              // never the friend's avatar beside it.
              React.createElement(List, { size: 15, style: listenAlongFriend ? { opacity: 0.4 } : undefined }),
              // Listening along: the friend's avatar (or initial) in the
              // badge's place, since their queue, not yours, decides what's
              // next. Otherwise the count (gray in spinoff mode).
              listenAlongFriend
                // A hexagon, like every user avatar: an accent hexagon as the
                // ring, the avatar (or initial) in a smaller one inside it.
                ? React.createElement('span', {
                    'data-listen-along-badge': '',
                    'aria-hidden': 'true',
                    className: 'absolute -top-1.5 -right-1.5 flex items-center justify-center',
                    style: { width: '20px', height: '20px', clipPath: LISTENER_HEXAGON, backgroundColor: 'var(--accent-fill)', opacity: 1 }
                  },
                    React.createElement('span', {
                      className: 'flex items-center justify-center',
                      style: Object.assign({
                        width: '16px', height: '16px', clipPath: LISTENER_HEXAGON,
                        fontSize: '11px', fontWeight: 600, color: 'var(--on-accent)'
                      }, listenAlongFriend.avatarUrl
                        ? { backgroundImage: `url(${JSON.stringify(listenAlongFriend.avatarUrl)})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                        : { backgroundColor: 'var(--accent-fill)' })
                    }, !listenAlongFriend.avatarUrl && (listenAlongFriend.displayName || listenAlongFriend.username || '?').charAt(0).toUpperCase()))
                : currentQueue.length > 0 && React.createElement('span', {
                className: `absolute -top-1 -right-1 text-white rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-1 font-medium ${queueAnimating ? 'badge-flash' : ''}`,
                style: { fontSize: '11px', backgroundColor: spinoffMode ? 'var(--on-dark-fill-muted)' : 'var(--accent-fill)' }
              }, currentQueue.length > 99 ? '99+' : currentQueue.length)
            )
          ),
          // Shuffleupagus button (sparkle icon): opens the chat when a chat
          // plug-in is on, else it's disabled and points to Settings.
          (() => {
            const hasEnabledChat = getChatServices().some(isServiceEnabled);
            const isActive = aiChatOpen;
            const label = hasEnabledChat ? 'Shuffleupagus' : 'Enable AI in Settings';

            const handleClick = () => {
              if (!hasEnabledChat) return;
              if (aiChatOpen) {
                closeAiChat();
              } else {
                openAiChat();
              }
            };

            return React.createElement(Tooltip, {
              content: label,
              position: 'top',
              variant: 'dark'
            },
              React.createElement(Button, { variant: 'icon', size: 'sm', tone: 'dark', className: 'ml-1', style: { color: isActive ? 'var(--playbar-accent-hover)' : hasEnabledChat ? 'var(--on-dark-secondary)' : 'var(--on-dark-disabled)', backgroundColor: isActive ? 'var(--accent-primary-alpha-30)' : undefined }, 'aria-label': label, onClick: handleClick, disabled: !hasEnabledChat }, React.createElement(Icons.Sparkles, { className: 'w-4 h-4' }))
            );
          })()
        ),

        // CENTER: Track info (album art + metadata)
        React.createElement('div', {
          className: 'flex items-center gap-3 relative',
          // 340px when there's room, down to 200px in a narrow window: fixed
          // at 340 it pushed the volume control off-screen below ~1120px
          // (design audit bug 21). The title and artist truncate.
          style: { flex: '0 1 340px', minWidth: '200px' },
          onDragEnter: (e) => handleDragEnter(e, 'now-playing'),
          onDragOver: (e) => handleDragOver(e, 'now-playing'),
          onDragLeave: handleDragLeave,
          onDrop: (e) => handleDrop(e, 'now-playing')
        },
          React.createElement(DropZoneOverlay, {
            zone: 'now-playing',
            isActive: isDraggingUrl && dropZoneTarget === 'now-playing'
          }),
          playbarShowsTrack(currentTrack, trackLoading, loadingTrack) ? [
            React.createElement(Tooltip, {
              key: 'album-art-tooltip',
              content: window.pickAlbumNameForTrack(currentTrack, null) ? `View "${window.pickAlbumNameForTrack(currentTrack, null)}" · Drag to add to playlist` : 'Drag to add to playlist',
              position: 'top',
              variant: 'dark'
            },
              React.createElement('button', { type: 'button', 'aria-label': 'Open album',
                draggable: true,
                onDragStart: (e) => {
                  // Set track data for playlists
                  const trackData = {
                    type: 'track',
                    track: {
                      title: currentTrack.title,
                      artist: currentTrack.artist,
                      album: currentTrack.album,
                      duration: currentTrack.duration,
                      id: trackSlug(currentTrack.artist, currentTrack.title)
                    }
                  };
                  e.dataTransfer.effectAllowed = 'copy';
                  e.dataTransfer.setData('text/plain', JSON.stringify(trackData));
                  // Also set state for immediate access
                  setDraggingTrackForPlaylist(trackData.track);
                },
                onDragEnd: () => {
                  handlePlaylistDragEnd();
                },
                onContextMenu: (e) => {
                  e.preventDefault();
                  if (window.electron?.contextMenu?.showTrackMenu) {
                    window.showItemMenu({
                      type: 'track',
                      track: currentTrack,
                      isNowPlaying: true
                    });
                  }
                },
                onClick: (e) => {
                  // Prevent click if we just finished a drag operation
                  if (e.defaultPrevented) return;
                  // Always opens the album page, whatever context the track was
                  // played from (derives the album when the track has none).
                  openAlbumForTrack(currentTrack);
                },
                className: 'flex-shrink-0 hover:opacity-80 transition-opacity cursor-pointer no-drag',
                style: { position: 'relative' }
              },
                React.createElement('div', {
                  className: 'bg-surface-dark-placeholder rounded flex items-center justify-center overflow-hidden relative',
                  style: { width: '61px', height: '61px' }
                },
                  // Previous album art (fading out) - use stable key to prevent DOM remounting flash
                  playbarAlbumArt.previous && React.createElement('img', {
                    key: 'playbar-prev-art',
                    src: playbarAlbumArt.previous,
                    alt: '',
                    draggable: false,
                    className: 'absolute inset-0 w-full h-full object-cover',
                    style: {
                      opacity: playbarAlbumArt.isLoaded ? 0 : 1,
                      transition: transition('opacity', 'slow', 'out')
                    }
                  }),
                  // Current album art (fading in) - use stable key to prevent DOM remounting flash
                  playbarAlbumArt.current && React.createElement('img', {
                    key: 'playbar-curr-art',
                    src: playbarAlbumArt.current,
                    alt: currentTrack.album,
                    draggable: false,
                    className: 'absolute inset-0 w-full h-full object-cover',
                    style: {
                      opacity: playbarAlbumArt.isLoaded ? 1 : 0,
                      transition: transition('opacity', 'slow', 'in')
                    },
                    onLoad: () => setPlaybarAlbumArt(prev => ({ ...prev, isLoaded: true })),
                    onError: (e) => { e.target.style.display = 'none'; }
                  }),
                  React.createElement(Music, { size: 20, className: 'text-on-dark-tertiary' })
                )
              )
            ),
            React.createElement('div', {
              key: 'track-info',
              className: 'min-w-0',
              onContextMenu: (e) => {
                e.preventDefault();
                if (window.electron?.contextMenu?.showTrackMenu) {
                  const isInCollection = !!findSavedTrack(collectionData.tracks, currentTrack);
                  window.showItemMenu({
                    type: 'track',
                    track: currentTrack,
                    isNowPlaying: true,
                    isInCollection: isInCollection
                  });
                }
              }
            },
              // Line 1: Track title. Resolvers that provide stream info
              // (stream-quality.js contract — localfiles today) surface it as a
              // hover tooltip on the title; resolvers that don't render exactly
              // as before.
              (() => {
                // A start of this track is on its way (playStartPending): the
                // title and artist shimmer until it plays.
                const startPending = playStartPending({ currentTrack, isPlaying, trackLoading, loadingTrack, resumePending });
                const titleDiv = React.createElement('div', {
                  className: `text-sm font-medium text-white truncate${startPending ? ' now-playing-pending' : ''}`,
                  'aria-busy': startPending || undefined
                }, currentTrack.title);
                const playingResolverId = determineResolverIdFromTrack(currentTrack);
                const streamQuality = (playingResolverId && window.pickStreamQuality)
                  ? window.pickStreamQuality(currentTrack, playingResolverId)
                  : null;
                const streamQualityLabel = streamQuality ? window.formatStreamQuality(streamQuality) : '';
                if (!streamQualityLabel) return titleDiv;
                // tooltip-fill caps the inline-flex wrapper at the column width
                // so the title still truncates (without it long titles overflow).
                return React.createElement(Tooltip, {
                  content: streamQualityLabel,
                  position: 'top',
                  variant: 'dark',
                  className: 'tooltip-fill'
                }, titleDiv);
              })(),
              // Line 2: Artist name with bio tooltip + on tour badge
              React.createElement('div', { className: 'flex items-center text-xs text-on-dark-secondary min-w-0' },
                (() => {
                  const bioPreview = playbarArtistBio && playbarArtistBio.bio
                    ? playbarArtistBio.bio.split('\n').slice(0, 2).join(' ').substring(0, 200).trim() + (playbarArtistBio.bio.length > 200 ? '…' : '')
                    : null;

                  const artistButton = React.createElement('button', {
                    onClick: () => fetchArtistData(currentTrack.artist),
                    className: `truncate hover:text-white hover:underline transition-colors cursor-pointer no-drag${playStartPending({ currentTrack, isPlaying, trackLoading, loadingTrack, resumePending }) ? ' now-playing-pending' : ''}`,
                    style: { maxWidth: 'none' }
                  }, currentTrack.artist);

                  return bioPreview
                    ? React.createElement(Tooltip, {
                        content: bioPreview,
                        position: 'top',
                        variant: 'dark',
                        className: 'tooltip-bio'
                      }, artistButton)
                    : artistButton;
                })(),
                // "On Tour" pill — shown when artist has concerts near the user's location
                (() => {
                  if (!concertsLoaded || !currentTrack?.artist) return null;
                  const artistNorm = currentTrack.artist.trim().toLowerCase();
                  const hasNearbyShows = concerts.some(event => {
                    const isPrimary = event.artist?.trim().toLowerCase() === artistNorm;
                    const isInLineup = event.lineup && event.lineup.some(a => a.trim().toLowerCase() === artistNorm);
                    if (!isPrimary && !isInLineup) return false;
                    if (!concertsLocationCoords) return true; // no location filter — any show counts
                    const vLat = event.venue?.latitude;
                    const vLng = event.venue?.longitude;
                    if (vLat != null && vLng != null) {
                      return haversineDistance(concertsLocationCoords.lat, concertsLocationCoords.lng, vLat, vLng) <= concertsLocationRadius;
                    }
                    // No venue coords — match on city portion of location text
                    const _onTourLocCity = concertsLocation.toLowerCase().trim().split(',')[0].trim();
                    if (_onTourLocCity) {
                      const city = (event.venue?.city || '').toLowerCase().trim();
                      const region = (event.venue?.region || '').toLowerCase().trim();
                      return (city && _onTourLocCity.includes(city)) || (region && _onTourLocCity.includes(region));
                    }
                    return true;
                  });
                  if (!hasNearbyShows) return null;
                  return React.createElement(Tooltip, {
                    content: 'On tour near you',
                    position: 'top',
                    variant: 'dark'
                  },
                    React.createElement('button', {
                      'aria-label': 'On tour near you',
                      onClick: (e) => {
                        e.stopPropagation();
                        pendingProtocolTabRef.current = 'on-tour';
                        fetchArtistData(currentTrack.artist);
                      },
                      className: 'flex-shrink-0 ml-3 rounded-full transition-opacity hover:opacity-80 cursor-pointer no-drag',
                      style: { width: '7px', height: '7px', backgroundColor: PAGE_COLORS.concerts.color }
                    })
                  );
                })()
              ),
              // Line 3: Resolver dropdown + browser indicator
              (() => {
                const currentResolverId = determineResolverIdFromTrack(currentTrack);
                const resolver = allResolvers.find(r => r.id === currentResolverId);

                // Get available sources for this track
                const playbarTrackArtistNorm = (currentTrack.artist || '').toLowerCase().trim();
                const playbarTrackTitleNorm = (currentTrack.title || '').toLowerCase().trim();
                const availableSources = currentTrack.sources && typeof currentTrack.sources === 'object' && !Array.isArray(currentTrack.sources)
                  ? Object.keys(currentTrack.sources).filter(resId => {
                      if (!playbackResolvers.includes(resId)) return false;
                      // Play from lists only sources that play (a purchase-only
                      // one is Buy's, lib/playable-source.js).
                      if (!isPlayableSource(currentTrack.sources[resId])) return false;
                      const src = currentTrack.sources[resId];
                      const srcId = src ? (src.youtubeId || src.spotifyUri || src.spotifyId || src.bandcampUrl || src.soundcloudId || src.appleMusicId || src.filePath || src.id || null) : null;
                      return !resolverBlocklist.some(entry =>
                        entry.resolverId === resId &&
                        entry.artist === playbarTrackArtistNorm &&
                        entry.title === playbarTrackTitleNorm &&
                        entry.sourceId === srcId
                      );
                    })
                  : [];

                const hasMultipleSources = availableSources.length > 1;

                // Buy button - shows when track has a purchasable source (Bandcamp),
                // a purchase-only one included (a buy-only track: buying is the
                // only way), so it also stands alone on line 3 when nothing plays.
                const buyButton = (() => {
                  // Merge sources from state, cache, and currentTrack (same pattern as Save to Collection)
                  const stateSources = currentTrack.id ? trackSources[currentTrack.id] : undefined;
                  const cacheKey = `${(currentTrack.artist || '').toLowerCase()}|${(currentTrack.title || '').toLowerCase()}`;
                  // Read at render; the call site passes _cacheLoaded so this
                  // re-renders once the persisted cache is in.
                  const cachedSources = trackSourcesCache.current[cacheKey]?.sources;
                  const effectiveSources = Object.fromEntries(
                    Object.entries({ ...(stateSources || {}), ...(cachedSources || {}), ...(currentTrack.sources || {}) }).filter(([, v]) => v && !v.noMatch)
                  );

                  // The plug-in that sells it: one declaring
                  // capabilities.purchase whose source is a sure match
                  // (lib/purchase-source.js).
                  const purchaseSource = pickPurchaseSource({ resolvers: allResolvers, sources: effectiveSources, track: currentTrack });
                  if (!purchaseSource) return null;

                  return React.createElement(Tooltip, {
                    content: `Buy on ${purchaseSource.resolverName}`,
                    position: 'top',
                    variant: 'dark'
                  },
                    React.createElement('button', {
                      onClick: async (e) => {
                        e.stopPropagation();
                        try {
                          if (window.electron?.shell?.openExternal) {
                            await window.electron.shell.openExternal(purchaseSource.purchaseUrl);
                          } else {
                            window.open(purchaseSource.purchaseUrl, '_blank');
                          }
                        } catch (error) {
                          console.error('Failed to open purchase link:', error);
                        }
                      },
                      className: 'flex items-center justify-center rounded transition-colors text-on-dark-secondary hover:text-on-dark-success no-drag',
                      style: { width: '16px', height: '16px' },
                      // The Tooltip above names it; a native title too
                      // showed two tooltips at once.
                      'aria-label': `Buy on ${purchaseSource.resolverName}`
                    },
                      // The cart, at the old glyph's 14px. Its basket sits in the
                      // top of the box and only the wheels below, so it reads
                      // high: 1px down centres it on the source name.
                      React.createElement(Icons.ShoppingCart, { size: 14, style: { transform: 'translateY(1px)' } })
                    )
                  );
                })();

                if (resolver) {
                  // The plugin's own colour (manifest.color), like every other
                  // service mark; the playbar used to keep its own copies.
                  const currentIconColor = (resolver.color && resolver.color !== NO_PLUGIN_COLOR) ? resolver.color : 'var(--playbar-accent)';

                  // A fixed 20px line: the picker turning from a label into a
                  // menu (a second source resolving), the external pill or the
                  // buy button never change the playbar's height.
                  return React.createElement('div', { className: 'flex items-center gap-1.5', style: { height: '20px' } },
                    // The source picker: "Play from" (components/menu.js), a
                    // choice among the sources this track resolved on. One
                    // source: just its name, no menu. Right-click on the
                    // button or an item opens that source's native menu.
                    (() => {
                      const sourceMenuFor = (resId) => (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (window.electron?.playbarSourceMenu?.show) {
                          window.electron.playbarSourceMenu.show({
                            resolverId: resId,
                            track: {
                              id: currentTrack.id,
                              artist: currentTrack.artist,
                              title: currentTrack.title,
                              sourceId: sourceBlockId((currentTrack.sources || {})[resId] || (trackSources[currentTrack.id] || {})[resId])
                            }
                          });
                        }
                      };
                      const triggerBody = (open) => [
                        React.createElement(ResolverIcon, { key: 'icon', resolverId: currentResolverId, size: 14, fill: currentIconColor }),
                        React.createElement('span', { key: 'name', className: 'text-xs font-medium', style: { color: currentIconColor } }, resolver.name),
                        hasMultipleSources && React.createElement(Icons.ChevronDown, { key: 'chev', className: `w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`, style: { color: 'var(--on-dark-tertiary)' } })
                      ];
                      if (!hasMultipleSources) {
                        return React.createElement('span', {
                          className: 'no-drag flex items-center gap-1.5 pl-0 pr-2 py-0.5',
                          onContextMenu: sourceMenuFor(currentResolverId)
                        }, triggerBody(false));
                      }
                      // flex: the trigger sits on no text line (a block wrapper
                      // added the line's baseline gap, a few pixels).
                      return React.createElement('div', { className: 'no-drag flex items-center' },
                        React.createElement(Menu, {
                          label: 'Play from',
                          heading: 'Play from',
                          items: availableSources.map(resId => {
                            const r = allResolvers.find(res => res.id === resId);
                            const iconColor = (r && r.color && r.color !== NO_PLUGIN_COLOR) ? r.color : 'var(--playbar-accent)';
                            return {
                              key: resId,
                              label: r ? r.name : resId,
                              icon: React.createElement(ResolverIcon, { resolverId: resId, size: 16, fill: iconColor }),
                              checked: resId === currentResolverId,
                              onSelect: () => {
                                if (resId !== currentResolverId && currentTrack.sources[resId]) {
                                  handlePlay({ ...currentTrack, preferredResolver: resId });
                                }
                              },
                              onContextMenu: sourceMenuFor(resId)
                            };
                          }),
                          renderTrigger: (t) => React.createElement(Button, Object.assign({}, t, {
                            variant: 'text', tone: 'dark', size: 'sm',
                            onContextMenu: sourceMenuFor(currentResolverId),
                            className: `!gap-1.5 !pl-0 !pr-2 !py-0.5 !rounded !font-normal${t.open ? ' !bg-white/10' : ''}`,
                            'aria-label': `Playing from ${resolver.name}. Switch source`,
                            'data-tooltip': 'Switch playback source',
                            'data-tooltip-variant': 'dark'
                          }), triggerBody(t.open))
                        })
                      );
                    })(),
                    // Browser indicator pill for external playback
                    isExternalPlayback && React.createElement('span', {
                      className: 'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium tracking-wide uppercase',
                      style: {
                        background: 'color-mix(in srgb, var(--playbar-accent) 15%, transparent)',
                        color: 'var(--on-dark-info)',
                        border: '1px solid color-mix(in srgb, var(--playbar-accent) 30%, transparent)',
                        boxShadow: '0 0 8px color-mix(in srgb, var(--playbar-accent) 15%, transparent), inset 0 1px 0 var(--on-dark-faint)'
                      },
                      title: 'Playing in browser'
                    },
                      // External link / window icon
                      React.createElement(Icons.ExternalLink, { className: 'w-2.5 h-2.5', style: { opacity: 0.9 } }),
                      'external'
                    ),
                    buyButton
                  );
                }
                // Nothing plays it but it can be bought (only a purchase-only
                // source): line 3 is the Buy button alone, at the same 20px.
                if (buyButton) return React.createElement('div', { className: 'flex items-center gap-1.5', style: { height: '20px' } }, buyButton);
                // No source yet: line 3 still holds its 20px (a shimmer while
                // the track loads), so the title and artist don't jump up
                // when the source picker arrives.
                return React.createElement(PlaybarLineSkeleton, { line: 'source', shimmer: true, blank: !(trackLoading || loadingTrack) });
              })()
            )
          ] : React.createElement(React.Fragment, null,
            // The art spot: a shimmer while a track loads; with nothing to
            // show (a first run, an empty queue), Parachord's own icon.
            trackLoading
              ? React.createElement('div', {
                  className: 'flex-shrink-0 rounded shimmer-dark animate-shimmer',
                  style: { width: '61px', height: '61px', backgroundSize: '200% 100%' }
                })
              // The art box keeps its placeholder square; the icon sits inside
              // it with 10px of room on each side.
              : React.createElement('div', { className: 'flex-shrink-0 rounded bg-surface-dark-placeholder flex items-center justify-center', style: { width: '61px', height: '61px' } },
                  React.createElement(ParachordAppIcon, { size: 41 })),
            // Skeleton track info: the three lines at their real heights
            // (components/playbar-skeleton.js), so the track replaces it in place.
            React.createElement('div', { className: 'min-w-0' },
              React.createElement(PlaybarLineSkeleton, { line: 'title', shimmer: !!trackLoading }),
              React.createElement(PlaybarLineSkeleton, { line: 'artist', shimmer: !!trackLoading }),
              React.createElement(PlaybarLineSkeleton, { line: 'source', shimmer: !!trackLoading })
            )
          )
        ),

        // RIGHT: Spinoff + Heart + Progress bar + Shuffle + Repeat + Volume
        React.createElement('div', { className: 'flex items-center gap-3' },
          // Spinoff button - radio-like playback of similar tracks (with tooltip)
          React.createElement(Tooltip, {
            content: spinoffMode ? 'Exit spinoff mode' :
              spinoffAvailable === false ? 'No related tracks' :
              spinoffAvailable === null ? 'Checking for related tracks…' : 'Spinoff',
            position: 'top',
            variant: 'dark'
          },
            React.createElement(Button, { variant: 'icon', size: 'sm', tone: 'dark', style: { color: spinoffMode ? 'var(--playbar-accent)' : 'var(--on-dark-secondary)' }, 'aria-label': spinoffMode ? 'Exit spinoff mode' : 'Spinoff', onClick: () => {
                if (spinoffMode) {
                  exitSpinoff();
                } else if (currentTrack && spinoffAvailable) {
                  startSpinoff(currentTrack);
                }
              }, disabled: !currentTrack || spinoffLoading || spinoffAvailable === false || spinoffAvailable === null }, spinoffLoading
                ? React.createElement(Icons.Spinner, { className: 'w-5 h-5' })
                : React.createElement(Icons.Spinoff, { className: 'w-5 h-5' }))
          ),
          // Heart/favorite button
          (() => {
            // No track: the button stays in place, disabled, so the playbar
            // doesn't shift when the first track loads (it took 44px with it).
            if (!currentTrack) {
              return React.createElement(Button, { variant: 'icon', size: 'sm', tone: 'dark', 'aria-label': 'Save to collection', disabled: true },
                React.createElement(Icons.Heart, { className: 'w-5 h-5', strokeWidth: 2, fill: 'none' }));
            }
            const isInCollection = !!findSavedTrack(collectionData.tracks, currentTrack);
            return React.createElement(Tooltip, {
              content: isInCollection ? 'Remove from collection' : 'Save to collection',
              position: 'top',
              variant: 'dark'
            },
              React.createElement(Button, { variant: 'icon', size: 'sm', tone: 'dark', className: isInCollection ? '!text-on-dark-love hover:!text-on-dark-love-hover' : '', 'aria-label': isInCollection ? 'Remove from collection' : 'Save to collection', onClick: () => {
                  if (!isInCollection) {
                    // Get sources from trackSources state as fallback (keyed by track.id)
                    const stateSources = currentTrack.id ? trackSources[currentTrack.id] : undefined;
                    // Also check cache
                    const cacheKey = `${(currentTrack.artist || '').toLowerCase()}|${(currentTrack.title || '').toLowerCase()}`;
                    const cachedSources = trackSourcesCache.current[cacheKey]?.sources;
                    // Merge sources: currentTrack.sources > cached > state
                    const effectiveSources = Object.fromEntries(
                      Object.entries({ ...(stateSources || {}), ...(cachedSources || {}), ...(currentTrack.sources || {}) }).filter(([, v]) => v && !v.noMatch)
                    );
                    addTrackToCollection({ ...currentTrack, sources: effectiveSources });
                  } else {
                    // Remove from collection (unheart)
                    removeTrackFromCollection(currentTrack);
                  }
                } }, React.createElement(Icons.Heart, { className: 'w-5 h-5', strokeWidth: isInCollection ? 0 : 2, fill: isInCollection ? 'currentColor' : 'none' }))
            );
          })(),
          // Progress section — isolated leaf so playback progress ticks re-render
          // only <PlaybackProgress>, not the whole Parachord tree (parachord#768).
          // The resolver-derived props below change at most on track/playback-method
          // change, never on a tick.
          (() => {
            const isSeekDisabled = !currentTrack || browserPlaybackActive;
            const seekTooltip = undefined;
            return React.createElement(PlaybackProgress, {
              subscribe: subscribeProgress,
              initialProgress: progressRef.current,
              hasTrack: !!currentTrack,
              browserPlaybackActive,
              duration: currentTrack?.duration || (currentTrack?.length ? Math.round(currentTrack.length / 1000) : 0),
              seekDisabled: isSeekDisabled,
              seekTooltip,
              onSeek: handleSeek,
              formatTime
            });
          })(),
          // Shuffle button (disabled in spinoff/listen-along modes)
          (() => {
            const shuffleDisabled = spinoffMode || listenAlongFriend;
            const tooltipContent = shuffleDisabled
              ? (spinoffMode ? 'Shuffle unavailable in Spinoff mode' : 'Shuffle unavailable while listening along')
              : (shuffleMode ? 'Shuffle on (click to restore order)' : 'Shuffle queue');
            return React.createElement(Tooltip, {
              content: tooltipContent,
              position: 'top',
              variant: 'dark'
            },
              React.createElement(Button, { variant: 'icon', size: 'sm', tone: 'dark', style: { color: shuffleMode ? 'var(--playbar-accent)' : 'var(--on-dark-secondary)' }, 'aria-label': tooltipContent, onClick: shuffleDisabled ? undefined : () => requestShuffle('toggle'), disabled: shuffleDisabled }, React.createElement(Icons.Shuffle, { className: 'w-4 h-4' }))
            );
          })(),
          // Repeat button (#1319): off, all, one. Disabled during a spinoff or
          // Listen Along, like shuffle (requestRepeat refuses it there too).
          (() => {
            const repeatDisabled = spinoffMode || listenAlongFriend;
            const tooltipContent = repeatDisabled
              ? (spinoffMode ? 'Repeat unavailable in Spinoff mode' : 'Repeat unavailable while listening along')
              : repeatMode === 'all' ? 'Repeating the queue (click to repeat this track)'
              : repeatMode === 'one' ? 'Repeating this track (click to turn off)'
              : 'Repeat the queue';
            return React.createElement(Tooltip, {
              content: tooltipContent,
              position: 'top',
              variant: 'dark'
            },
              React.createElement(Button, { variant: 'icon', size: 'sm', tone: 'dark', style: { color: repeatMode !== 'off' ? 'var(--playbar-accent)' : 'var(--on-dark-secondary)' }, onClick: repeatDisabled ? undefined : () => requestRepeat('cycle'), disabled: repeatDisabled, 'aria-label': repeatMode === 'off' ? 'Repeat off' : repeatMode === 'all' ? 'Repeat all' : 'Repeat one' }, React.createElement(repeatMode === 'one' ? Icons.Repeat1 : Icons.Repeat, { className: 'w-4 h-4' }))
            );
          })(),
          // Volume - only enabled for local files and Spotify on Computer devices
          (() => {
            const currentResolverId = determineResolverIdFromTrack(currentTrack);
            const isSpotify = currentResolverId === 'spotify';
            const isAppleMusic = currentResolverId === 'applemusic';
            // For Spotify, only enable volume on Computer devices (desktop app)
            // TVs, speakers, and other devices don't respond to remote volume commands reliably
            const spotifyVolumeSupported = !isSpotify || spotifyDevice?.type === 'Computer';
            const volumeSupported = !currentTrack || playsInApp(currentResolverId) || (isSpotify && spotifyVolumeSupported);
            const isDisabled = !volumeSupported || browserPlaybackActive || isExternalPlayback;
            const resolverOffset = currentResolverId ? (resolverVolumeOffsets[currentResolverId] || 0) : 0;
            const hasOffset = resolverOffset !== 0;
            const effectiveVolume = isMuted ? 0 : volume;

            // Toggle mute handler
            const handleMuteToggle = () => {
              if (isDisabled) return;
              const activeResolverId = determineResolverIdFromTrack(currentTrackRef.current);
              if (isMuted) {
                // Unmute: restore previous volume
                const restoredVolume = preMuteVolumeRef.current || 30;
                setIsMuted(false);
                setVolume(restoredVolume);
                if (mediaElementFor(activeResolverId)) {
                  applyLocalFileVolume(restoredVolume, currentTrackRef.current?.id, activeResolverId);
                }
                if (activeResolverId === 'spotify') {
                  setSpotifyVolume(restoredVolume, true);
                }
                if (activeResolverId === 'applemusic' && window._appleMusicPreviewAudio) {
                  const effectiveVol = getEffectiveVolume(restoredVolume, 'applemusic', currentTrackRef.current?.id);
                  window._appleMusicPreviewAudio.volume = effectiveVol / 100;
                }
              } else {
                // Mute: save current volume and set to 0
                preMuteVolumeRef.current = volume;
                setIsMuted(true);
                const muteEl = mediaElementFor(activeResolverId);
                if (muteEl) {
                  muteEl.volume = 0;
                }
                if (activeResolverId === 'spotify') {
                  setSpotifyVolume(0, false);
                }
                if (activeResolverId === 'applemusic' && window._appleMusicPreviewAudio) {
                  window._appleMusicPreviewAudio.volume = 0;
                }
              }
            };

            // Determine appropriate tooltip
            const getTooltip = () => {
              if (isDisabled) {
                if (browserPlaybackActive || isExternalPlayback) {
                  return 'Volume control not available for browser playback';
                }
                if (isSpotify && spotifyDevice && spotifyDevice.type !== 'Computer') {
                  return `Volume control not available on ${spotifyDevice.name || spotifyDevice.type}`;
                }
                if (isAppleMusic) {
                  return 'Use system volume to control Apple Music';
                }
                return 'Volume control not available';
              }
              if (isMuted) return 'Click to unmute';
              if (hasOffset) return `Volume (${resolverOffset > 0 ? '+' : ''}${resolverOffset}dB normalization applied) - Click to mute`;
              return 'Click to mute';
            };

            return React.createElement('div', {
              className: 'flex items-center gap-1'
            },
              React.createElement(Tooltip, {
                content: getTooltip(),
                position: 'top-end',
                variant: 'dark'
              },
                React.createElement('button', {
                  'aria-label': isMuted || effectiveVolume === 0 ? 'Unmute' : 'Mute',
                  className: 'transition-colors',
                  style: { color: isDisabled ? 'var(--on-dark-disabled)' : 'var(--on-dark-secondary)', cursor: isDisabled ? 'not-allowed' : 'pointer' },
                  onClick: handleMuteToggle,
                  disabled: isDisabled
                },
                  React.createElement(isMuted || effectiveVolume === 0 ? Icons.VolumeX : Icons.Volume2, { size: 16 })
                )
              ),
              React.createElement(Tooltip, {
                content: getTooltip(),
                position: 'top-end',
                variant: 'dark'
              },
                React.createElement(Slider, {
                  tone: 'dark',
                  'aria-label': 'Volume',
                  'aria-valuetext': isMuted ? 'Muted' : `${Math.round(effectiveVolume)}%`,
                  min: 0,
                  max: 100,
                  value: effectiveVolume,
                  disabled: isDisabled,
                  onChange: (newVolume) => {
                    // If user moves slider while muted, unmute
                    if (isMuted && newVolume > 0) {
                      setIsMuted(false);
                    }
                    setVolume(newVolume);
                    // Re-determine resolver from current track ref to avoid stale closure
                    const activeResolverId = determineResolverIdFromTrack(currentTrackRef.current);
                    // Local files and SoundCloud: apply normalized volume immediately
                    if (mediaElementFor(activeResolverId)) {
                      applyLocalFileVolume(newVolume, currentTrackRef.current?.id, activeResolverId);
                    }
                    // Spotify: debounced API call to prevent rate limiting
                    if (activeResolverId === 'spotify') {
                      setSpotifyVolumeDebounced(newVolume, true);
                    }
                    // Apple Music: apply volume to preview audio only (native uses system volume)
                    if (activeResolverId === 'applemusic' && window._appleMusicPreviewAudio) {
                      const effectiveVol = getEffectiveVolume(newVolume, 'applemusic', currentTrackRef.current?.id);
                      window._appleMusicPreviewAudio.volume = effectiveVol / 100;
                    }
                  },
                className: `w-20 ${isDisabled ? 'opacity-50' : ''}`
                })
              )
            );
          })()
        )
      )
    );
});

module.exports = { Playbar, PLAYBAR_HANDLERS };
