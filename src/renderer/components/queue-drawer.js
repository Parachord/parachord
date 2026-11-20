// src/renderer/components/queue-drawer.js: the queue drawer that slides
// up above the playbar: its header (drag to resize, Shuffle back, Save as
// playlist, Clear, Close), the "Playing from" bar, and the virtualized
// queue list with drag to reorder and the drop overlay (#1451, moved out
// of app.js).
//
// A React.memo'd panel fed stable props: state, setters, refs, callbacks
// and the playback queue hook's values by value, plain functions through
// useStableHandlers (QUEUE_DRAWER_HANDLERS, pinned by
// tests/renderer/page-memo.test.js). It's always mounted (it slides on
// transform when closed). The markup moved as it was; window is read only
// inside handlers.

const Icons = require('./icons');
const { VirtualizedQueueList } = require('./track-lists');
const { contextPlaylistTarget } = require('../lib/playlist-context');
const { QueueContextBar } = require('./queue-context-bar');
const { HeaderControl } = require('./header-control');
const { CardButton } = require('./card-button');
const { DropZoneOverlay } = require('./drop-zone-overlay');

// Room the queue drawer leaves above it: the title bar and a little air.
const QUEUE_DRAWER_TOP_GAP = 48;

const QUEUE_DRAWER_HANDLERS = [
  'handleCollectionAlbumClick',
  'handleDragEnter',
  'handleDragLeave',
  'handleDragOver',
  'handleDrop',
  'handlePlaylistDragEnd',
  'handleSaveQueueAsPlaylist',
  'loadPlaylist',
  'navigateTo',
  'openAiChat',
  'openMixFromContext',
];

const QueueDrawer = React.memo(function QueueDrawer(props) {
  const {
    activeView,
    addToPlaylistPanel,
    allResolvers,
    clearQueue,
    clearQueueHoverTrack,
    collectionTab,
    currentQueue,
    currentTrack,
    draggedQueueTrack,
    dropZoneTarget,
    droppingFromIndex,
    friends,
    handleCollectionAlbumClick,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handlePlaylistDragEnd,
    handleSaveQueueAsPlaylist,
    insertedTrackId,
    isDraggingUrl,
    listenAlongFriend,
    loadPlaylist,
    moveInQueue,
    navigateTo,
    openAiChat,
    openMixFromContext,
    openCollectionLovesRef,
    originalQueueRef,
    playbackContext,
    playbackResolvers,
    playlists,
    queueContentRef,
    queueDrawerHeight,
    queueDrawerOpen,
    queueDropTarget,
    removeFromQueue,
    resolverOrder,
    restoreOriginalOrder,
    selectedPlaylist,
    selectedPlaylistsForAdd,
    setAddToPlaylistPanel,
    setCollectionTab,
    setCurrentFriend,
    setCurrentQueue,
    setDraggedQueueTrack,
    setDraggingTrackForPlaylist,
    setDropTargetNewPlaylist,
    setDropTargetPlaylistId,
    setDroppingFromIndex,
    setQueueDrawerHeight,
    setQueueDrawerOpen,
    setQueueDropTarget,
    setQueueHoverTrack,
    shuffleMode,
    spinoffMode,
    stableExitSpinoff,
    stableFetchArtistData,
    stableHandlePlay,
    stableHandleUrlDrop,
    trackSources,
    updateQueueVisibility,
  } = props;
  return React.createElement('div', {
      // It slides on transform only (motion tokens, #1450): its height isn't
      // animated, so dragging the handle resizes it under the cursor (with
      // every property animated, the resize lagged behind the pointer).
      className: 'on-dark fixed left-0 right-0 backdrop-blur-md shadow-2xl transition-transform duration-slow ease-out z-40',
      // Closed, it's off-screen but was still in the Tab order (audit bug 24).
      inert: queueDrawerOpen ? undefined : '',
      'aria-hidden': queueDrawerOpen ? undefined : 'true',
      style: {
        bottom: '85px', // Above the playbar (85px tall)
        // Closed, it slides down past the window's bottom edge.
        transform: queueDrawerOpen ? 'translateY(0)' : 'translateY(calc(100% + 85px))',
        // Never taller than the window above the playbar, so a short window
        // can't push the drawer's header off the top (audit bug 24).
        height: Math.min(queueDrawerHeight, Math.max(200, (typeof window !== 'undefined' ? window.innerHeight : 900) - 85 - QUEUE_DRAWER_TOP_GAP)) + 'px',
        background: 'linear-gradient(to top, var(--surface-dark-gradient-from), var(--surface-dark-gradient-to))',
        borderTop: '1px solid var(--surface-dark-border)'
      }
    },
      // Drawer header with drag handle - dark translucent theme
      // Clicking anywhere on header (except drag handle and Clear) closes drawer
      React.createElement(CardButton, { label: 'Close the queue',
        className: 'flex items-center justify-between px-4 py-2 cursor-pointer transition-colors',
        style: { backgroundColor: 'var(--surface-dark-header)', borderBottom: '1px solid var(--surface-dark-border)' },
        onActivate: () => setQueueDrawerOpen(false)
      },
        React.createElement('div', {
          className: 'flex items-center gap-3'
        },
          // Drag handle for resizing - stops click propagation
          React.createElement('div', {
            // The queue's resize handle (dragged with the mouse).
            role: 'separator', 'aria-orientation': 'horizontal', 'aria-label': 'Resize the queue',
            className: 'card-above w-8 h-1 bg-on-dark-disabled rounded-full cursor-ns-resize',
            onClick: (e) => e.stopPropagation(),
            onMouseDown: (e) => {
              e.stopPropagation();
              const startY = e.clientY;
              const startHeight = queueDrawerHeight;

              const handleMouseMove = (moveEvent) => {
                const deltaY = startY - moveEvent.clientY;
                const maxHeight = Math.min(600, window.innerHeight - 85 - QUEUE_DRAWER_TOP_GAP);
                const newHeight = Math.max(200, Math.min(maxHeight, startHeight + deltaY));
                setQueueDrawerHeight(newHeight);
              };

              const handleMouseUp = () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
              };

              document.addEventListener('mousemove', handleMouseMove);
              document.addEventListener('mouseup', handleMouseUp);
            }
          }),
          React.createElement('span', {
            style: {
              fontSize: '11px',
              fontWeight: '600',
              color: 'var(--on-dark-primary)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em'
            }
          }, 'Queue'),
          React.createElement('span', {
            style: {
              fontSize: '11px',
              color: 'var(--on-dark-tertiary)',
              marginLeft: '8px'
            }
          }, `${currentQueue.length} track${currentQueue.length !== 1 ? 's' : ''}`),
          // Shuffle indicator
          shuffleMode && React.createElement('span', {
            style: {
              fontSize: '11px',
              color: 'var(--accent-soft)',
              marginLeft: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }
          },
            React.createElement(Icons.Shuffle, { size: 12 }),
            'shuffled'
          )
        ),
        React.createElement('div', {
          className: 'flex items-center gap-2'
        },
          // Save as Playlist button - shows when there's a current track or queue
          (currentTrack || currentQueue.length > 0) && React.createElement(HeaderControl, { tone: 'dark', onClick: (e) => { e.stopPropagation(); handleSaveQueueAsPlaylist(); } }, 'Save'),
          // Unshuffle button - shows when shuffle is active
          shuffleMode && originalQueueRef.current && React.createElement(HeaderControl, { tone: 'dark', onClick: (e) => { e.stopPropagation(); restoreOriginalOrder(); }, 'data-tooltip': 'Restore original queue order' }, 'Unshuffle'),
          // Clear button
          currentQueue.length > 0 && React.createElement(HeaderControl, { tone: 'dark', onClick: (e) => { e.stopPropagation(); clearQueue(); } }, 'Clear'),
          // Close button
          React.createElement(HeaderControl, { tone: 'dark', close: true, onClick: () => setQueueDrawerOpen(false) }, 'Close')
        )
      ),

      // Queue content - dark theme
      React.createElement('div', {
        ref: queueContentRef,
        className: 'overflow-y-auto relative scrollable-content-dark',
        style: { height: (queueDrawerHeight - 44 - (playbackContext ? 32 : 0)) + 'px' },
        onDragEnter: (e) => handleDragEnter(e, 'queue'),
        onDragOver: (e) => handleDragOver(e, 'queue'),
        onDragLeave: handleDragLeave,
        onDrop: (e) => handleDrop(e, 'queue')
      },
        // Drop zone overlay
        React.createElement(DropZoneOverlay, {
          zone: 'queue',
          isActive: isDraggingUrl && dropZoneTarget === 'queue'
        }),
        currentQueue.length === 0 ?
          React.createElement('div', {
            className: 'flex flex-col items-center justify-center h-full text-on-dark-tertiary'
          },
            React.createElement(Icons.Music, { className: 'w-10 h-10 text-on-dark-disabled mb-2' }),
            React.createElement('span', { className: 'text-on-dark-secondary' }, 'Queue is empty'),
            React.createElement('span', { className: 'text-sm text-on-dark-tertiary mt-1' }, 'Play a playlist to add tracks')
          )
        :
          // Virtualized queue list - renders only visible items for performance
          // Uses @tanstack/react-virtual to efficiently handle large queues
          React.createElement(VirtualizedQueueList, {
            queue: currentQueue,
            currentTrack,
            resolverOrder,
            allResolvers,
            playbackResolvers,
            trackSources,
            queueDropTarget,
            draggedQueueTrack,
            insertedTrackId,
            droppingFromIndex,
            spinoffMode,
            playbackContext,
            listenAlongFriend,
            addToPlaylistPanel,
            selectedPlaylistsForAdd,
            containerHeight: queueDrawerHeight - 44 - (playbackContext ? 32 : 0),
            parentRef: queueContentRef,
            // Callbacks
            setDraggedQueueTrack,
            setDraggingTrackForPlaylist,
            setQueueDropTarget,
            handlePlaylistDragEnd,
            setDropTargetPlaylistId,
            setDropTargetNewPlaylist,
            setAddToPlaylistPanel,
            moveInQueue,
            setDroppingFromIndex,
            setCurrentQueue,
            handlePlay: stableHandlePlay,
            exitSpinoff: stableExitSpinoff,
            fetchArtistData: stableFetchArtistData,
            removeFromQueue,
            handleUrlDrop: stableHandleUrlDrop,
            // Resolution scheduler integration
            onVisibilityChange: updateQueueVisibility,
            onTrackHover: setQueueHoverTrack,
            onTrackHoverEnd: clearQueueHoverTrack,
            currentTrackIndex: currentQueue.findIndex(t => t.id === currentTrack?.id)
          })
      ),

      // Playback context banner - shows where playback originated from (at bottom of queue)
      playbackContext && React.createElement(QueueContextBar, {
        interactive: playbackContext.type !== 'spinoff',
        onClick: () => {
          // AI Playlist - reopen the Shuffleupagus chat
          if (playbackContext.type === 'aiPlaylist') {
            openAiChat();
            setQueueDrawerOpen(false);
            return;
          }
          // Navigate to the context source (skip if already on target page).
          // A playlist context opens its playlist: a saved one by id, an
          // ephemeral one (Weekly Jams, ...) from the reference the context
          // carries (lib/playlist-context).
          const contextPlaylist = contextPlaylistTarget(playbackContext, playlists);
          if (contextPlaylist) {
            if (activeView === 'playlist-view' && selectedPlaylist?.id === contextPlaylist.id) {
              // Already viewing this playlist - just close the drawer
            } else {
              loadPlaylist(contextPlaylist);
            }
          } else if (playbackContext.type === 'playlist' && playbackContext.playlist) {
            // A recommended playlist that can't be reopened: where it lives.
            navigateTo('recommendations');
          } else if (playbackContext.type === 'album' && playbackContext.artist) {
            // handleCollectionAlbumClick has its own "already viewing" check
            handleCollectionAlbumClick({
              title: playbackContext.name,
              artist: playbackContext.artist
            });
          } else if (playbackContext.type === 'search') {
            navigateTo('search'); // navigateTo skips if already on page
          } else if (playbackContext.type === 'library') {
            // Skip if already on library with tracks tab
            if (activeView !== 'library' || collectionTab !== 'tracks') {
              setCollectionTab('tracks');
              navigateTo('library');
            }
          } else if (playbackContext.type === 'loves') {
            // Home's recent loves: Collection's songs, newest loved first.
            if (openCollectionLovesRef.current) openCollectionLovesRef.current();
          } else if (playbackContext.type === 'recommendations') {
            navigateTo('recommendations');
          } else if (playbackContext.type === 'history') {
            navigateTo('history');
          } else if (playbackContext.type === 'friend') {
            navigateTo('friendHistory');
          } else if (playbackContext.type === 'spinoff') {
            // Spinoff has no destination page - do nothing
          } else if (playbackContext.type === 'listenAlong') {
            // Navigate to the friend's history page
            const friend = friends.find(f => f.id === playbackContext.friendId);
            if (friend) {
              setCurrentFriend(friend);
              navigateTo('friendHistory');
            }
          } else if (playbackContext.type === 'url' && playbackContext.url) {
            // Open the source URL in the default browser
            window.electron.shell.openExternal(playbackContext.url);
          } else if (playbackContext.type === 'mix') {
            // A history mix opens itself, in the service-playlist view
            // (openMixFromContext in app.js, #1592).
            openMixFromContext(playbackContext);
          } else if (playbackContext.type === 'weekly-jam' || playbackContext.type === 'weekly-exploration') {
            // The weekly playlists live in Recommendations' Playlists section
            navigateTo('recommendations');
          }
          setQueueDrawerOpen(false);
        },
        tooltip: playbackContext.type === 'url' ? 'Open source page' : 'Go to source'
      },
        React.createElement('div', { className: 'flex items-center gap-2' },
          React.createElement('span', { className: 'text-xs text-[var(--playbar-accent-hover)]' },
            playbackContext.type === 'spinoff' ? 'Playing' :
            playbackContext.type === 'listenAlong' ? 'Listening along with' :
            playbackContext.type === 'aiPlaylist' ? 'From' : 'Playing from'
          ),
          React.createElement('span', { className: 'text-xs font-medium text-on-dark-primary' },
            playbackContext.type === 'playlist' ? `${playbackContext.name || 'Playlist'}` :
            playbackContext.type === 'album' ? `${playbackContext.name || 'Album'} by ${playbackContext.artist || 'Unknown'}` :
            playbackContext.type === 'search' ? `"${playbackContext.name || 'Search'}"` :
            playbackContext.type === 'library' ? 'Collection' :
            playbackContext.type === 'recommendations' ? 'Recommendations' :
            playbackContext.type === 'aiPlaylist' ? 'Shuffleupagus' :
            playbackContext.type === 'history' ? 'History' :
            playbackContext.type === 'friend' ? `${playbackContext.name || 'Friend'}'s ${playbackContext.tab === 'topTracks' ? 'top tracks' : 'recent listens'}` :
            playbackContext.type === 'spinoff' && !playbackContext.sourceTrack?.artist ? `${playbackContext.sourceTrack?.title || 'Radio'}` :
            playbackContext.type === 'spinoff' ? `spun off from "${playbackContext.sourceTrack?.title || 'Unknown'}" by ${playbackContext.sourceTrack?.artist || 'Unknown'}` :
            playbackContext.type === 'listenAlong' ? `${playbackContext.name || 'Friend'}` :
            playbackContext.type === 'url' ? playbackContext.name || 'External link' :
            playbackContext.type === 'weekly-jam' ? `${playbackContext.name || 'Weekly Jams'}` :
            playbackContext.type === 'weekly-exploration' ? `${playbackContext.name || 'Weekly Exploration'}` :
            playbackContext.name || 'Unknown'
          )
        ),
        // Hide arrow for spinoff (not clickable)
        playbackContext.type !== 'spinoff' && React.createElement(playbackContext.type === 'url' ? Icons.ExternalLink : Icons.ArrowRight, { className: 'w-4 h-4 text-[var(--playbar-accent)]' })
      )
    );
});

module.exports = { QueueDrawer, QUEUE_DRAWER_HANDLERS, QUEUE_DRAWER_TOP_GAP };
