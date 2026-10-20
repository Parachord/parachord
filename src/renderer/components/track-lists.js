// src/renderer/components/track-lists.js — the track-list presentational kit,
// extracted from app.js's module scope (maintainability plan Track 2b,
// presentational slice 2).
//
// TrackRow is the single track row (resolver badges via the ui-atoms kit,
// confidence-badge dimming via getBestSourceConfidence — the absolute
// >= 0.95 = full-opacity model, see CLAUDE.md "Match Confidence + Selection
// Floor"); VirtualizedQueueList / VirtualizedTrackList are the windowed lists
// (ReactVirtual is the vendor global). getBestSourceConfidence moves WITH its
// primary pre-component consumer and is exported back to app.js, where the
// 10 in-component list-view badge sites keep calling it via the destructured
// binding — one definition, same behavior.
//
// All props-driven, no app state; memoized exactly as before. React via the
// vendor global; ResolverIcon via the ui-atoms module; icons via the icons
// module's own destructure below.
const { ResolverIcon } = require('./ui-atoms');
const Icons = require('./icons');
const { Music, Pause, Play, X } = Icons;

// Render-time helper: returns the absolute confidence threshold below which
// a resolver source's badge renders dimmed. The historical implementation
// returned per-track best (relative-dim model: a 0.95 fuzzy-validated match
// rendered dimmed when a sibling resolver had a 1.0 direct-ID match), which
// misled users into reading "dimmed" as "wrong" — the dimmed match was
// nearly always correct, just lower-confidence than a sibling. Flipped to
// the absolute model on 2026-05-08: dim only when strictly below 0.95.
// Since the upstream MIN_CONFIDENCE_THRESHOLD = 0.6 floor drops sub-floor
// results before they reach `track.sources`, in normal operation the only
// values present are 0.95 (fuzzy validated) and 1.0 (direct-ID), so under
// the new rule nothing dims unless a resolver explicitly returned a
// non-standard sub-0.95 confidence. The function signature is preserved
// (takes `sources`, returns a number) so the 11 badge call sites compare
// against `bestConf` unchanged. The argument is now ignored.
const getBestSourceConfidence = (_sources) => 0.95;

// TrackRow component - defined outside to prevent recreation on every render
// Badge for a resolver the static resolverMeta map does not know (a plugin
// the host never named, e.g. Plex): label and tint from its manifest.
const pluginBadgeMeta = (resolverId, allResolvers) => {
  const r = Array.isArray(allResolvers) ? allResolvers.find(x => x.id === resolverId) : null;
  if (!r) return null;
  const color = /^#[0-9a-f]{6}$/i.test(r.color || '') ? r.color : '#A855F7';
  return { label: r.name || resolverId, style: { backgroundColor: color + '33', color } };
};

const TrackRow = React.memo(({ track, isPlaying, handlePlay, onArtistClick, onContextMenu, allResolvers, resolverOrder, activeResolvers }) => {
  // Get available sources (track.sources is an object with resolver IDs as keys)
  // Sort by priority order (left to right = highest to lowest priority)
  const availableSources = track.sources && typeof track.sources === 'object' && !Array.isArray(track.sources)
    ? Object.keys(track.sources).filter(id => !track.sources[id]?.noMatch).sort((a, b) => {
        const aIndex = resolverOrder?.indexOf(a) ?? 999;
        const bIndex = resolverOrder?.indexOf(b) ?? 999;
        return aIndex - bIndex;
      })
    : [];

  // Resolver metadata for badge display
  const resolverMeta = {
    spotify: { label: 'Spotify', bgColor: 'bg-green-600/20', textColor: 'text-green-400' },
    youtube: { label: 'YouTube', bgColor: 'bg-red-600/20', textColor: 'text-red-400' },
    bandcamp: { label: 'Bandcamp', bgColor: 'bg-cyan-600/20', textColor: 'text-cyan-400' },
    qobuz: { label: 'Qobuz', bgColor: 'bg-blue-600/20', textColor: 'text-blue-400' },
    soundcloud: { label: 'SoundCloud', bgColor: 'bg-orange-600/20', textColor: 'text-orange-400' },
    subsonic: { label: 'Subsonic', bgColor: 'bg-teal-600/20', textColor: 'text-teal-400' }
  };

  // Determine which resolver will be used (based on priority)
  const getPrimaryResolver = () => {
    if (!availableSources.length || !resolverOrder || !activeResolvers || !allResolvers) return null;

    const sortedSources = availableSources
      .map(resId => ({
        resolverId: resId,
        priority: resolverOrder.indexOf(resId)
      }))
      .filter(s => activeResolvers.includes(s.resolverId))
      .sort((a, b) => a.priority - b.priority);

    if (sortedSources.length === 0) return null;

    const primaryResolverId = sortedSources[0].resolverId;
    return allResolvers.find(r => r.id === primaryResolverId);
  };

  const primaryResolver = getPrimaryResolver();

  return React.createElement('div', {
    className: 'group flex items-center gap-4 p-3 rounded-lg hover:bg-gray-100 transition-colors no-drag',
    onContextMenu: (e) => {
      e.preventDefault();
      if (onContextMenu) {
        onContextMenu(track);
      }
    }
  },
    // Album art or play button
    React.createElement('div', { className: 'relative w-12 h-12 flex-shrink-0' },
      React.createElement('div', {
        className: 'w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded flex items-center justify-center overflow-hidden'
      },
        track.albumArt && React.createElement('img', {
          src: track.albumArt,
          alt: track.album,
          className: 'absolute inset-0 w-full h-full object-cover transition-opacity duration-300',
          style: { opacity: 0 },
          ref: (el) => { if (el && el.complete && el.naturalWidth > 0) el.style.opacity = '1'; },
          onLoad: (e) => { e.target.style.opacity = '1'; },
          onError: (e) => { e.target.style.display = 'none'; }
        }),
        React.createElement(Music)
      ),
      React.createElement('button', {
        onClick: () => handlePlay(track),
        className: 'absolute inset-0 flex items-center justify-center rounded bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity'
      },
        React.createElement('div', { className: 'w-8 h-8 flex items-center justify-center rounded-full bg-purple-600 text-sm' },
          isPlaying ? React.createElement(Pause) : React.createElement(Play)
        )
      )
    ),
    React.createElement('div', { className: 'flex-1 min-w-0' },
      React.createElement('div', { className: `text-xs font-medium truncate ${isPlaying ? 'text-purple-600' : 'text-gray-900'}` }, track.title),
      React.createElement('div', { className: 'flex items-center gap-2' },
        React.createElement('button', {
          onClick: (e) => {
            e.stopPropagation();
            if (onArtistClick) {
              onArtistClick(track.artist);
            }
          },
          className: 'text-xs text-gray-500 truncate hover:text-purple-600 hover:underline cursor-pointer transition-colors',
          title: `View ${track.artist}'s discography`
        }, track.artist),
        // Resolver badges - clickable for manual override
        ...availableSources.map(resolverId => {
          const meta = resolverMeta[resolverId] || pluginBadgeMeta(resolverId, allResolvers);
          if (!meta) return null;

          return React.createElement('button', {
            key: resolverId,
            onClick: (e) => {
              e.stopPropagation();
              // Play from this specific resolver
              handlePlay(track.sources[resolverId]);
            },
            className: `text-xs px-2 py-0.5 ${meta.bgColor || ''} ${meta.textColor || ''} rounded-full hover:opacity-80 transition-opacity cursor-pointer`,
            style: meta.style,
            title: `Play from ${meta.label} (manual override)`
          }, meta.label);
        }),
      ),
      primaryResolver && React.createElement('div', { className: 'text-xs text-gray-400 mt-0.5' }, `via ${primaryResolver.name}`)
    ),
    React.createElement('div', { className: 'text-xs text-gray-500 truncate max-w-[200px]' }, track.album),
    React.createElement('div', { className: 'text-xs text-gray-500 w-12 text-right' },
      `${Math.floor(track.duration / 60)}:${(track.duration % 60).toString().padStart(2, '0')}`
    )
  );
});

// VirtualizedQueueList component - Renders queue tracks efficiently using windowing
// Only renders visible tracks + overscan buffer, dramatically reducing DOM nodes for large queues
const VirtualizedQueueList = React.memo(({
  queue,
  currentTrack,
  resolverOrder,
  allResolvers,
  queueDropTarget,
  draggedQueueTrack,
  insertedTrackId,
  droppingFromIndex,
  spinoffMode,
  playbackContext,
  listenAlongFriend,
  addToPlaylistPanel,
  selectedPlaylistsForAdd,
  containerHeight,
  parentRef,
  // Callbacks
  setDraggedQueueTrack,
  setDraggingTrackForPlaylist,
  setQueueDropTarget,
  setDropTargetPlaylistId,
  setDropTargetNewPlaylist,
  setAddToPlaylistPanel,
  moveInQueue,
  setDroppingFromIndex,
  setCurrentQueue,
  handlePlay,
  exitSpinoff,
  fetchArtistData,
  removeFromQueue,
  handleUrlDrop,
  formatTime,
  // New props for resolution scheduler
  onVisibilityChange,
  onTrackHover,
  onTrackHoverEnd,
  currentTrackIndex,
  // Parachord-internal drag-end cleanup (clears the playlist-panel drop
  // highlight). Passed as a prop — the pre-extraction code called the bare
  // name, which was unreachable from module scope and threw a ReferenceError
  // on every queue-row drag-end (pre-existing, surfaced by the strict tier).
  handlePlaylistDragEnd
}) => {
  const TRACK_HEIGHT = 36; // Approximate height of each track row in pixels

  // Use @tanstack/react-virtual for efficient rendering
  // ReactVirtual is loaded from CDN as a global
  const virtualizer = typeof ReactVirtual !== 'undefined' ? ReactVirtual.useVirtualizer({
    count: queue.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => TRACK_HEIGHT,
    overscan: 10 // Render 10 extra items above/below viewport for smooth scrolling
  }) : null;

  // Track visible items for resolution scheduler
  React.useEffect(() => {
    if (!virtualizer || !onVisibilityChange || !queue || queue.length === 0) return;

    const visibleRange = virtualizer.getVirtualItems();
    if (visibleRange.length === 0) return;

    // IMPORTANT: The queue is displayed in REVERSE order (next track at bottom, last track at top)
    // virtualizer indices are visual (top-to-bottom), so we need to reverse-map to queue indices:
    // - visibleRange[0].index (top of viewport) = queue[queue.length - 1 - index] (end of queue)
    // - visibleRange[last].index (bottom of viewport) = queue[queue.length - 1 - index] (start of queue)
    const visualStartIndex = visibleRange[0].index;
    const visualEndIndex = visibleRange[visibleRange.length - 1].index;

    // Convert visual indices to queue array indices (reversed)
    const queueEndIndex = queue.length - 1 - visualStartIndex;   // Top of viewport = higher queue indices
    const queueStartIndex = queue.length - 1 - visualEndIndex;   // Bottom of viewport = lower queue indices

    // Clamp to valid range
    const startIndex = Math.max(0, queueStartIndex);
    const endIndex = Math.min(queue.length - 1, queueEndIndex);

    // Plus playback lookahead (5 from current track)
    const lookaheadStart = currentTrackIndex ?? 0;
    const lookaheadEnd = lookaheadStart + 5;

    // Build visible tracks list
    const visibleTracks = [];
    const seen = new Set();

    // Add viewport + overscan (reversed mapping applied above)
    for (let i = startIndex; i <= endIndex; i++) {
      const track = queue[i];
      if (track && !seen.has(track.id)) {
        seen.add(track.id);
        visibleTracks.push({
          key: track.id,
          data: { track, artistName: track.artist, isQueueResolution: true }
        });
      }
    }

    // Add playback lookahead
    for (let i = lookaheadStart; i < Math.min(queue.length, lookaheadEnd); i++) {
      const track = queue[i];
      if (track && !seen.has(track.id)) {
        seen.add(track.id);
        visibleTracks.push({
          key: track.id,
          data: { track, artistName: track.artist, isQueueResolution: true }
        });
      }
    }

    onVisibilityChange(visibleTracks);
  }, [virtualizer?.range?.startIndex, virtualizer?.range?.endIndex, queue.length, currentTrackIndex, onVisibilityChange]);

  // Helper to render a single queue track row
  const renderQueueTrackRow = (track, index, virtualRow) => {
    const isCurrentTrack = currentTrack?.id === track.id;
    const isLoading = track.status === 'loading';
    const isError = track.status === 'error';
    const availableSources = Object.keys(track.sources || {}).sort((a, b) => {
      const aIndex = resolverOrder.indexOf(a);
      const bIndex = resolverOrder.indexOf(b);
      return aIndex - bIndex;
    });

    const isDraggedOver = queueDropTarget === index;
    const isDragging = draggedQueueTrack === index;
    const isInserted = insertedTrackId === track.id;
    const isFallingDown = droppingFromIndex !== null && index <= droppingFromIndex;

    return React.createElement('div', {
      key: track.id,
      'data-index': index,
      ref: virtualRow ? virtualizer.measureElement : undefined,
      draggable: !isLoading && !isError,
      onDragStart: (e) => {
        if (!isLoading && !isError) {
          setDraggedQueueTrack(index);
          setDraggingTrackForPlaylist(track);
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'track', track }));
        }
      },
      onDragEnd: () => {
        setDraggedQueueTrack(null);
        setQueueDropTarget(null);
        handlePlaylistDragEnd();
      },
      onDragOver: (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (draggedQueueTrack !== null && draggedQueueTrack !== index) {
          setQueueDropTarget(index);
        }
      },
      onDragLeave: () => {
        setQueueDropTarget(null);
      },
      onDrop: (e) => {
        e.preventDefault();
        if (draggedQueueTrack !== null && draggedQueueTrack !== index) {
          moveInQueue(draggedQueueTrack, index);
        }
        setDraggedQueueTrack(null);
        setQueueDropTarget(null);
      },
      onContextMenu: (e) => {
        e.preventDefault();
        if (!isLoading && !isError && window.electron?.contextMenu?.showTrackMenu) {
          window.electron.contextMenu.showTrackMenu({ type: 'track', track });
        }
      },
      onClick: () => {
        if (isLoading || isError) return;
        if (spinoffMode) exitSpinoff();
        setDroppingFromIndex(index);
        setTimeout(() => {
          // Clicked track plays, remove it and tracks before it, keep tracks after
          setCurrentQueue(prev => prev.slice(index + 1));
          handlePlay(track);
          setDroppingFromIndex(null);
        }, 300);
      },
      onMouseEnter: () => {
        if (onTrackHover) onTrackHover(track.id);
      },
      onMouseLeave: () => {
        if (onTrackHoverEnd) onTrackHoverEnd();
      },
      className: `group flex items-center gap-3 py-1.5 px-3 hover:bg-white/10 transition-all duration-300 ${
        isCurrentTrack ? 'bg-purple-900/40' : ''
      } ${isDragging ? 'opacity-50 bg-gray-700/50' : ''} ${
        isError ? 'opacity-50' : ''
      } ${isDraggedOver ? 'border-t-2 border-t-purple-400' : ''} ${
        isLoading || isError ? 'cursor-default' : 'cursor-pointer'} ${
        isFallingDown ? 'queue-track-drop' : ''} ${
        isInserted ? 'queue-track-insert' : ''} ${
        (spinoffMode || playbackContext?.type === 'spinoff' || playbackContext?.type === 'friend') && !isCurrentTrack ? 'opacity-50' : ''} ${
        listenAlongFriend ? 'opacity-40 pointer-events-none' : ''}`,
      style: virtualRow ? {
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: `${virtualRow.size}px`,
        transform: `translateY(${virtualRow.start}px)`,
        borderRadius: '6px'
      } : {
        borderRadius: '6px',
        marginBottom: '1px'
      }
    },
      // Track number
      React.createElement('span', {
        className: 'text-right',
        style: {
          width: '28px',
          flexShrink: 0,
          fontSize: '12px',
          fontWeight: '500',
          color: (spinoffMode || playbackContext?.type === 'spinoff' || playbackContext?.type === 'friend')
            ? 'rgba(156, 163, 175, 0.5)' : 'rgba(156, 163, 175, 0.7)'
        }
      },
        listenAlongFriend ? '–' :
        isLoading ? React.createElement('span', { className: 'animate-spin inline-block' }, '◌') :
        isError ? '⚠' :
        isCurrentTrack ? '▶' :
        (spinoffMode || playbackContext?.type === 'spinoff' || playbackContext?.type === 'friend')
          ? '··' : String(index + 1).padStart(2, '0')
      ),
      // Track title
      React.createElement('span', {
        className: 'truncate group-hover:text-white transition-colors',
        style: {
          flex: '1 1 0',
          minWidth: 0,
          fontSize: '13px',
          fontWeight: index === 0 ? '500' : '400',
          color: isLoading ? 'rgba(156, 163, 175, 0.6)' :
                 isError ? '#f87171' :
                 isCurrentTrack ? 'var(--accent-soft)' : 'rgba(229, 231, 235, 0.9)'
        }
      },
        isLoading ? 'Loading...' :
        isError ? 'Could not load track' :
        track.title
      ),
      // Artist name
      React.createElement('span', {
        className: 'truncate hover:text-purple-400 hover:underline cursor-pointer transition-colors',
        style: { flex: '0.7 1 0', minWidth: 0, fontSize: '12px', color: 'rgba(156, 163, 175, 0.7)' },
        onClick: (e) => {
          e.stopPropagation();
          if (!isLoading && !isError && track.artist) fetchArtistData(track.artist);
        }
      },
        isLoading ? `from ${track.sourceDomain || 'unknown'}` :
        isError ? (track.errorMessage || 'Unknown error') :
        track.artist
      ),
      // Duration
      React.createElement('span', {
        className: 'text-right tabular-nums',
        style: { width: '50px', flexShrink: 0, fontSize: '12px', color: 'rgba(156, 163, 175, 0.5)' }
      }, !isLoading && !isError ? formatTime(track.duration || 0) : ''),
      // Resolver icons
      React.createElement('div', {
        className: 'flex items-center gap-1 justify-end',
        style: { width: '140px', flexShrink: 0, minHeight: '20px' }
      },
        isError ?
          React.createElement('button', {
            onClick: (e) => {
              e.stopPropagation();
              if (track.sourceUrl) {
                removeFromQueue(track.id);
                handleUrlDrop(track.sourceUrl, 'queue');
              }
            },
            className: 'px-2 py-0.5 text-xs text-gray-400 hover:text-white hover:bg-white/10 rounded transition-colors',
            title: 'Retry'
          }, '↻')
        : isLoading ?
          React.createElement('div', { className: 'flex items-center gap-1' },
            React.createElement('div', {
              className: 'rounded shimmer-light animate-shimmer',
              style: { width: '20px', height: '20px' }
            }),
            React.createElement('div', {
              className: 'rounded shimmer-light animate-shimmer',
              style: { width: '20px', height: '20px', animationDelay: '0.1s' }
            })
          )
        : availableSources.length > 0 ?
          (() => {
            const bestConf = getBestSourceConfidence(track.sources);
            return availableSources.map(resolverId => {
              const resolver = allResolvers.find(r => r.id === resolverId);
              if (!resolver) return null;
              const source = track.sources?.[resolverId];
              const confidence = source?.confidence || 0;
              const isDim = confidence < bestConf;
              const restingOpacity = isDim ? 0.5 : 0.7;
              return React.createElement('button', {
                key: resolverId,
                onClick: (e) => {
                  e.stopPropagation();
                  handlePlay({ ...track, preferredResolver: resolverId });
                },
                className: 'no-drag',
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
                  opacity: restingOpacity,
                  filter: 'saturate(0.7)',
                  transition: 'opacity 0.15s, filter 0.15s, transform 0.1s'
                },
                onMouseEnter: (e) => { e.currentTarget.style.transform = 'scale(1.1)'; e.currentTarget.style.opacity = '1'; e.currentTarget.style.filter = 'saturate(1)'; },
                onMouseLeave: (e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.opacity = String(restingOpacity); e.currentTarget.style.filter = 'saturate(0.7)'; },
                title: `Play via ${resolver.name}${confidence ? ` (${Math.round(confidence * 100)}% match)` : ''}`
              }, React.createElement(ResolverIcon, { resolverId, size: 12 }));
            });
          })()
        :
          React.createElement('div', { className: 'flex items-center gap-1' },
            React.createElement('div', {
              className: 'rounded shimmer-light animate-shimmer',
              style: { width: '20px', height: '20px' },
              title: 'Resolving track...'
            }),
            React.createElement('div', {
              className: 'rounded shimmer-light animate-shimmer',
              style: { width: '20px', height: '20px', animationDelay: '0.1s' }
            })
          )
      ),
      // Remove button
      React.createElement('button', {
        onClick: (e) => {
          e.stopPropagation();
          removeFromQueue(track.id);
        },
        className: 'flex-shrink-0 p-1 text-gray-500 hover:text-red-400 hover:bg-white/10 rounded transition-colors opacity-0 group-hover:opacity-100',
        title: isLoading ? 'Cancel' : 'Remove from queue'
      }, React.createElement(X, { size: 14 }))
    );
  };

  // Fallback if ReactVirtual not loaded OR small queue - render all (original behavior)
  // Virtualization only helps for large queues (100+ items)
  if (!virtualizer || queue.length < 100) {
    return React.createElement('div', { className: 'flex flex-col-reverse justify-start min-h-full' },
      queue.map((track, index) => renderQueueTrackRow(track, index, null))
    );
  }

  const virtualItems = virtualizer.getVirtualItems();

  // Virtualized rendering with reversed order display
  // The virtualizer gives us indices 0, 1, 2... from top of scroll area
  // We want index 0 (next track) at the BOTTOM, so we reverse the mapping:
  // - virtualRow.index 0 (top of scroll) -> queue[queue.length - 1] (last track)
  // - virtualRow.index N (bottom of scroll) -> queue[0] (next track)
  return React.createElement('div', {
    style: {
      height: `${virtualizer.getTotalSize()}px`,
      width: '100%',
      position: 'relative'
    }
  },
    virtualItems.map(virtualRow => {
      // Map virtual index to reversed queue index
      const reversedQueueIndex = queue.length - 1 - virtualRow.index;
      const track = queue[reversedQueueIndex];
      // Use original virtualRow positioning (top-to-bottom), but with reversed queue data
      return renderQueueTrackRow(track, reversedQueueIndex, virtualRow);
    })
  );
});

// VirtualizedTrackList — generic windowed rendering for any track list
// (parachord#783, extended in #767 to playlist/search/charts/history/
// friend-history views). Mirrors `VirtualizedQueueList`'s pattern but
// with a container-wrapping approach that keeps the row-rendering
// callback virtualization-agnostic: the parent component owns the row
// markup, this component owns the positioning + virtualizer machinery.
//
// Why this exists: collection / playlist / charts track lists can be
// hundreds-to-thousands of items. Without virtualization, every state
// change walks the whole React tree. Windowing keeps mounted nodes to
// ~30 (viewport + overscan).
//
// Notes for future maintainers:
//   - The scroll container ref-callback MUST be stable across renders
//     (e.g. via `useCallback` with `[]` deps, OR pass a `useRef` object
//     directly to `ref={}`). An inline arrow on the scroll container's
//     ref creates a per-render detach/attach cycle in React's commit
//     phase; the detach phase nulls the ref BEFORE child useLayoutEffect
//     hooks run, and the virtualizer's `_willUpdate` reads null → the
//     internal `scrollElement` never gets set → `vItems` perpetually
//     `[]`. This was the root cause of two prior failed virtualization
//     attempts on the Library tab (#783 commit message has the
//     full diagnostic trail).
//   - Avoid `contain: strict` (= `size + layout + style + paint`) on
//     the scroll container — `size` containment can confuse the
//     virtualizer's clientHeight measurement when combined with
//     `flex-1` sizing. Either drop containment entirely on the tab
//     using the virtualizer, or use a definite pixel height on the
//     scroll container.
//   - Falls back to plain non-virtualized render when ReactVirtual
//     isn't loaded, when `tracks.length < virtualizationThreshold`
//     (default 100), or transiently when virtualItems is empty (before
//     the virtualizer's observers settle).
//   - `renderRow(track, index, virtualRow)` is called by the parent.
//     The wrapper handles positioning so the parent's row markup stays
//     identical to the non-virtualized version.
const VirtualizedTrackList = React.memo(({
  tracks,
  parentRef,
  renderRow,
  estimatedRowHeight = 56,
  overscan = 8,
  virtualizationThreshold = 100
}) => {
  // CRITICAL: `useVirtualizer` MUST be called unconditionally on every
  // render (Rules of Hooks). The earlier guard `typeof ReactVirtual !==
  // 'undefined' && parentRef?.current` made the hook conditional on a
  // value that changes between renders (ref starts null, becomes the
  // DOM node after the ref-callback fires) — React then complains about
  // hook-order mismatch and the list comes up blank. Mirror the queue
  // list's pattern: only the module-level `typeof ReactVirtual` check
  // gates the call; the ref-readiness is handled inside `getScrollElement`
  // (which the virtualizer is OK to receive `null` from until layout
  // settles).
  const virtualizer = typeof ReactVirtual !== 'undefined'
    ? ReactVirtual.useVirtualizer({
        count: tracks.length,
        getScrollElement: () => parentRef?.current || null,
        estimateSize: () => estimatedRowHeight,
        overscan
      })
    : null;

  const virtualItems = virtualizer ? virtualizer.getVirtualItems() : [];

  // Fallback to plain non-virtualized render in ANY of these cases:
  //   - ReactVirtual not loaded (CDN failure)
  //   - tracks.length < virtualizationThreshold (no benefit, just overhead)
  //   - virtualItems is empty (virtualizer hasn't computed a visible range
  //     yet — happens on the renders before its internal ResizeObserver
  //     fires, AND in pathological cases where it never settles)
  //
  // This makes the worst case identical to the pre-#783 behavior (user
  // sees the full plain list, just without windowing perf). When the
  // virtualizer DOES eventually produce items, we transition to the
  // windowed path on the next render. Never blank.
  if (!virtualizer || tracks.length < virtualizationThreshold || virtualItems.length === 0) {
    return React.createElement('div', {
      className: 'space-y-0',
      style: { minHeight: 'calc(100vh - 160px)' }
    },
      tracks.map((track, index) => renderRow(track, index, null))
    );
  }

  return React.createElement('div', {
    style: {
      height: `${virtualizer.getTotalSize()}px`,
      width: '100%',
      position: 'relative'
    }
  },
    virtualItems.map(virtualRow => {
      const track = tracks[virtualRow.index];
      if (!track) return null;
      // Wrap each row in an absolute-positioned, measureElement-ref'd div
      // so the parent's `renderRow` markup stays virtualization-agnostic.
      // The wrapper's height tracks the rendered row's actual height via
      // measureElement; virtualizer corrects its size estimates over time.
      return React.createElement('div', {
        key: track.id || track.filePath || virtualRow.index,
        'data-index': virtualRow.index,
        ref: virtualizer.measureElement,
        style: {
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          transform: `translateY(${virtualRow.start}px)`
        }
      }, renderRow(track, virtualRow.index, virtualRow));
    })
  );
});

module.exports = {
  getBestSourceConfidence,
  TrackRow,
  VirtualizedQueueList,
  VirtualizedTrackList,
};
