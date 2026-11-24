// src/renderer/components/track-lists.js — the track-list presentational kit,
// extracted from app.js's module scope (maintainability plan Track 2b,
// presentational slice 2).
//
// TrackRow is the single page-list track row (TrackSources / SourceIconButton
// its source column, also used by rows with their own layout); VirtualizedQueueList / VirtualizedTrackList
// are the windowed lists (ReactVirtual is the vendor global). Which source
// icons a row shows, their order and dimming come from lib/visible-sources.js
// (one rule for the queue and the page lists, see docs/architecture/playback.md
// "Playback limits" and "Match Confidence + Selection Floor").
//
// All props-driven, no app state; memoized exactly as before. React via the
// vendor global; ResolverIcon via the ui-atoms module; icons via the icons
// module's own destructure below.
const { Button } = require('./button');
const { ResolverIcon } = require('./ui-atoms');
const { CardButton } = require('./card-button');
const { SourceIconButton } = require('./source-icon-button');
const Icons = require('./icons');
const { X } = Icons;

// The shared source-icon rule (and the 0.95 dim threshold) lives in
// lib/visible-sources.js.
const { sourceRowState } = require('../lib/visible-sources');
const { trackDurationLabel } = require('../lib/track-duration');
const { hasArtistPage } = require('../lib/artist-page-name');

// The track row every page list uses (History, a friend's history,
// Recommendations, Charts, the playlist page, Collection, Search and an
// album's tracklist). Each page had its own copy of the same row, so they had
// drifted (JS hover on the source buttons in some, a missing title colour in
// others); this is that row once:
//
//   number · title · artist · [cells…] · source icons · [duration]
//
// The whole row plays the track (CardButton's stretched button); the artist
// is a link; each source icon plays the track from that service. Which icons
// show, their order and dimming come from lib/visible-sources.js, so a row
// that is still resolving shows a shimmer and an unplayable one is dimmed.
//
// Props:
//   track          { id, title, artist, … }
//   number         what the first column shows ("01", "#3"); ▶ while playing
//   lead           a node in place of the number (the playlist page's
//                  Move up / Move down in edit mode)
//   isNowPlaying   this row is the one playing: accent title and ▶
//   sources        { trackSources, playbackResolvers, resolverOrder }
//   allResolvers   the plugin list (each icon's name, colour and play)
//   onPlay         (resolverId?) => void: a row click, or one source's icon
//   onOpenArtist   (artist) => void: the artist name is a link
//   onContextMenu  (event) => void: the track menu (and the More button)
//   cells          [{ key, content, width | flex, align, onClick }]: columns
//                  between the artist and the duration (album, "2h ago",
//                  "12 plays"); onClick makes the cell a link (the album)
//   showArtist     false: no artist column (an album's own tracklist)
//                  (A local file's Local Files is one more source: it shows
//                  and sorts by the user's source order like any other.)
//   resolving      false: the row isn't being resolved now (Search before
//                  its lookup reaches it), so no shimmer and no dimming
//   dimResolving   false: a resolving row stays full colour (the album page:
//                  no flash of "unavailable" before the lookup finishes)
//   duration       true: a duration column (lib/track-duration.js)
//   sourcesWidth   the icon column's width (140px)
//   rowRef         the row element, for the page's visibility observer
//   className      extra classes (a drop target, a dragged row)
//   …rest          passed to CardButton (draggable, onDragStart, onDrop…)
// Props-driven; loads under plain Node.
const ROW_CELL = { pointerEvents: 'none', fontSize: '12px', color: 'var(--text-tertiary)' };

function cellStyle(cell) {
  return Object.assign({}, ROW_CELL,
    cell.width ? { width: cell.width, flexShrink: 0 } : { flex: cell.flex || '0.5 1 0', minWidth: 0 },
    cell.align === 'right' ? { textAlign: 'right' } : null,
    cell.style || null);
}

// The source icon column's width: room for one icon per service the user can
// play from (24px each: a 20px icon and the 4px gap), at least two, at most
// 140px. The app root sets it as --source-col (app.js), and every icon
// column and its skeleton reads SOURCE_COLUMN, so a list has no dead space
// right of its icons and its rows and placeholders still line up.
const SOURCE_ICON_STEP = 24;
function sourceColumnWidth(playbackResolvers) {
  const n = Array.isArray(playbackResolvers) ? playbackResolvers.length : 0;
  return Math.min(140, Math.max(2, n) * SOURCE_ICON_STEP - 4);
}
const SOURCE_COLUMN = 'var(--source-col, 140px)';

// A service's play button lives in components/source-icon-button.js.

// The source column: a shimmer while resolving, the icons when playable,
// nothing when unplayable (the row is dimmed). The icons sit at the
// column's right edge, right up against the duration (the row's last
// column), whatever their number; the column's spare room is on their left.
function TrackSources({ state, shown, allResolvers, onPlay, width = SOURCE_COLUMN }) {
  const e = React.createElement;
  const icon = ({ resolverId, source, dim }) => {
    const resolver = (allResolvers || []).find((r) => r.id === resolverId);
    if (!resolver || !resolver.play) return null;
    return e(SourceIconButton, { key: resolverId, resolver, confidence: source && source.confidence, dim, onClick: () => onPlay(resolverId) });
  };
  return e('div', {
    className: 'flex items-center gap-1 justify-end',
    style: { width: typeof width === 'number' ? `${width}px` : width, flexShrink: 0, minHeight: '24px', overflow: 'hidden' },
  },
  state === 'playable'
    ? shown.map(icon)
    : state === 'resolving'
      ? e('div', { className: 'flex items-center gap-1', role: 'status', 'aria-label': 'Finding sources…' },
          e('div', { className: 'w-5 h-5 rounded shimmer-light animate-shimmer' }),
          e('div', { className: 'w-5 h-5 rounded shimmer-light animate-shimmer', style: { animationDelay: '0.1s' } }))
      : null);
}

// A track row's placeholder: the same box and columns as TrackRow (number,
// title, artist, `cells`' widths, the duration, the source icons), so the
// list doesn't jump when the rows land. `cells` as TrackRow's (only width /
// flex are read).
function TrackRowSkeleton({ index = 0, cells = [], duration = false, showArtist = true, sourcesWidth = SOURCE_COLUMN }) {
  const e = React.createElement;
  const delay = (n) => `${Math.min(index * 30, 300) + n}ms`;
  const bar = (style) => e('div', { className: 'h-3.5 rounded shimmer-light animate-shimmer', style: Object.assign({ backgroundSize: '200% 100%' }, style) });
  return e('div', {
    'aria-hidden': 'true', className: 'flex items-center gap-4 py-3 px-4',
    style: { borderRadius: '8px', marginBottom: '2px' },
  },
    e('div', { className: 'flex-shrink-0 flex justify-end', style: { width: '32px' } }, bar({ width: '16px', animationDelay: delay(0) })),
    e('div', { style: { flex: '1 1 0', minWidth: 0 } }, bar({ width: '60%', animationDelay: delay(15) })),
    showArtist && e('div', { style: { flex: '0.7 1 0', minWidth: 0 } }, bar({ width: '50%', animationDelay: delay(30) })),
    cells.map((cell, i) => e('div', { key: cell.key || i, style: cell.width ? { width: cell.width, flexShrink: 0 } : { flex: cell.flex || '0.5 1 0', minWidth: 0 } },
      bar({ width: '60%', marginLeft: cell.align === 'right' ? 'auto' : 0, animationDelay: delay(40) }))),
    e('div', { className: 'flex items-center gap-1 justify-end', style: { width: typeof sourcesWidth === 'number' ? `${sourcesWidth}px` : sourcesWidth, flexShrink: 0, minHeight: '24px' } },
      e('div', { className: 'w-5 h-5 rounded shimmer-light animate-shimmer', style: { animationDelay: delay(60) } }),
      e('div', { className: 'w-5 h-5 rounded shimmer-light animate-shimmer', style: { animationDelay: delay(75) } })),
    duration && e('div', { className: 'flex-shrink-0 flex justify-end', style: { width: '50px' } }, bar({ width: '32px', animationDelay: delay(45) })));
}

function TrackRow({
  track, number, lead, isNowPlaying = false, sources, allResolvers, onPlay, onOpenArtist, onContextMenu,
  cells = [], duration = false, sourcesWidth = SOURCE_COLUMN, rowRef, className,
  showArtist = true, resolving, dimResolving = true, ...rest
}) {
  const e = React.createElement;
  const rule = sourceRowState(track, sources || {});
  const shown = rule.shown;
  // Not being resolved now: neither a shimmer nor "unavailable".
  const state = rule.state === 'resolving' && resolving === false ? 'idle' : rule.state;
  const playable = state === 'playable';
  const muted = (state === 'resolving' && dimResolving) || state === 'unplayable';
  return e(CardButton, Object.assign({
    label: `${track.title} by ${track.artist}`,
    more: onContextMenu ? `More actions for ${track.title}` : undefined,
    current: isNowPlaying,
    ref: rowRef,
    'data-track-id': track.id,
    className: ['flex items-center gap-4 py-3 px-4 group no-drag', rest.draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
      muted ? 'opacity-60' : '', isNowPlaying ? 'bg-accent-tint' : (state === 'resolving' ? '' : 'hover:bg-surface-hover'), className].filter(Boolean).join(' '),
    style: { borderRadius: '8px', marginBottom: '2px' },
    onActivate: () => onPlay && onPlay(),
    onContextMenu: onContextMenu ? (ev) => { ev.preventDefault(); onContextMenu(ev); } : undefined,
  }, rest),
    lead || e('span', {
      className: 'flex-shrink-0 text-right tabular-nums',
      style: { pointerEvents: 'none', width: '32px', fontSize: '12px', fontWeight: 500, color: isNowPlaying ? 'var(--accent-secondary)' : 'var(--text-tertiary)' },
    }, isNowPlaying ? '▶' : number),
    e('span', {
      className: 'truncate',
      style: { pointerEvents: 'none', flex: '1 1 0', minWidth: 0, fontSize: '13px', fontWeight: isNowPlaying ? 500 : 400, color: isNowPlaying ? 'var(--accent-primary)' : (playable || state === 'idle' || (state === 'resolving' && !dimResolving)) ? 'var(--text-primary)' : 'var(--text-tertiary)' },
    }, track.title),
    !showArtist ? null : onOpenArtist && hasArtistPage(track.artist)
      ? e('button', {
          type: 'button',
          className: 'text-left truncate hover:text-accent hover:underline cursor-pointer transition-colors',
          style: { flex: '0.7 1 0', minWidth: 0, fontSize: '12px', color: 'var(--text-secondary)', background: 'none', border: 'none', padding: 0 },
          onClick: (ev) => { ev.stopPropagation(); onOpenArtist(track.artist); },
        }, track.artist || 'Unknown artist')
      : e('span', { className: 'truncate', style: { pointerEvents: 'none', flex: '0.7 1 0', minWidth: 0, fontSize: '12px', color: 'var(--text-secondary)' } }, track.artist || 'Unknown artist'),
    cells.map((cell, i) => (cell.onClick && cell.content
      // A link cell (the album): above the row's stretched button.
      ? e('button', {
          key: cell.key || i, type: 'button',
          className: 'text-left truncate hover:text-accent hover:underline cursor-pointer transition-colors',
          style: Object.assign(cellStyle(cell), { pointerEvents: 'auto', color: 'var(--text-secondary)', background: 'none', border: 'none', padding: 0 }),
          onClick: (ev) => { ev.stopPropagation(); cell.onClick(); },
        }, cell.content)
      : e('span', { key: cell.key || i, className: `truncate${cell.align === 'right' ? ' tabular-nums' : ''}`, style: cellStyle(cell) }, cell.content))),
    e(TrackSources, { state, shown, allResolvers, onPlay: (id) => onPlay && onPlay(id), width: sourcesWidth }),
    // The duration is the last column, right-aligned, with the source icons
    // right up against it (right-aligned in theirs): durations line up down
    // the row's end and nothing is left empty after them.
    duration && e('span', {
      className: 'text-right tabular-nums flex-shrink-0',
      style: Object.assign({}, ROW_CELL, { width: '50px' }),
    }, trackDurationLabel(track, sources || {})));
}

// VirtualizedQueueList component - Renders queue tracks efficiently using windowing
// Only renders visible tracks + overscan buffer, dramatically reducing DOM nodes for large queues
const VirtualizedQueueList = React.memo(({
  queue,
  currentTrack,
  resolverOrder,
  allResolvers,
  // The resolvers that can play on this account (activeResolvers minus
  // plan-blocked ones, e.g. Amazon on Prime, Apple Music signed out) and the
  // live resolutions. A row's icons come from visibleSources, the same rule
  // as the page lists (docs/architecture/playback.md "Playback limits").
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
    // The icons the page lists would show for this track (lib/visible-sources):
    // real sources only, playable on this account, in resolver order. Shimmer
    // while nothing has come back yet; once it has and nothing is playable, no
    // icons and the row is dimmed, as in the page lists.
    const { shown: shownSources, state: sourceState } = sourceRowState(track, { trackSources, playbackResolvers, resolverOrder });
    const isUnplayable = !isLoading && !isError && sourceState === 'unplayable';

    const isDraggedOver = queueDropTarget === index;
    const isDragging = draggedQueueTrack === index;
    const isInserted = insertedTrackId === track.id;
    const isFallingDown = droppingFromIndex !== null && index <= droppingFromIndex;

    return React.createElement(CardButton, { label: `${track.title} by ${track.artist}`, more: `More actions for ${track.title}`, moreTone: 'dark',
    current: isCurrentTrack,
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
          window.showItemMenu({ type: 'track', track, inQueue: true, queueIndex: index, queueLength: queue.length });
        }
      },
      onActivate: () => {
        if (isLoading || isError) return;
        if (spinoffMode) exitSpinoff();
        setDroppingFromIndex(index);
        setTimeout(() => {
          // Clicked track plays, remove it and tracks before it, keep tracks after.
          // A jump within the queue: the outgoing track stays in the lap (#1329).
          setCurrentQueue(prev => prev.slice(index + 1));
          handlePlay(track, { fromQueue: true });
          setDroppingFromIndex(null);
        }, 300);
      },
      onMouseEnter: () => {
        if (onTrackHover) onTrackHover(track.id);
      },
      onMouseLeave: () => {
        if (onTrackHoverEnd) onTrackHoverEnd();
      },
      // On the always-dark drawer: the accent fill for the playing row, the
      // on-dark tints for hover and drag, the soft accent for a drop line.
      className: `group flex items-center gap-3 py-1.5 px-3 hover:bg-white/10 transition-colors ${
        isDragging ? 'opacity-50 bg-white/5' : ''} ${
        isError || isUnplayable ? 'opacity-50' : ''
      } ${isDraggedOver ? 'border-t-2' : ''} ${
        isLoading || isError ? 'cursor-default' : 'cursor-pointer'} ${
        isFallingDown ? 'queue-track-drop' : ''} ${
        isInserted ? 'queue-track-insert' : ''} ${
        (spinoffMode || playbackContext?.type === 'spinoff' || playbackContext?.type === 'friend') && !isCurrentTrack ? 'opacity-50' : ''} ${
        listenAlongFriend ? 'opacity-40 pointer-events-none' : ''}`,
      style: Object.assign(virtualRow ? {
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
      },
      isCurrentTrack ? { backgroundColor: 'color-mix(in srgb, var(--accent-fill) 35%, transparent)' } : null,
      isDraggedOver ? { borderTopColor: 'var(--accent-soft)' } : null)
    },
      // Track number
      React.createElement('span', {
        className: 'text-right',
        style: {
          width: '28px',
          flexShrink: 0,
          fontSize: '12px',
          fontWeight: '500',
          color: 'var(--on-dark-tertiary)'
        }
      },
        listenAlongFriend ? '–' :
        isLoading ? React.createElement(Icons.Spinner, { style: { width: '1em', height: '1em', verticalAlign: '-0.125em' } }) :
        isError ? React.createElement(Icons.AlertTriangle, { style: { width: '1em', height: '1em', verticalAlign: '-0.125em' } }) :
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
          color: isLoading ? 'var(--on-dark-tertiary)' :
                 isError ? 'var(--error)' :
                 isCurrentTrack ? 'var(--accent-soft)' : 'var(--on-dark-primary)'
        }
      },
        isLoading ? 'Loading…' :
        isError ? 'Could not load track' :
        track.title
      ),
      // Artist name (plain text when there is no page: "Various Artists")
      (() => {
        const label = isLoading ? `from ${track.sourceDomain || 'unknown'}`
          : isError ? (track.errorMessage || 'Unknown error') : track.artist;
        // On the always-dark drawer: the fixed on-dark colour (#1386 contrast).
        const style = { flex: '0.7 1 0', minWidth: 0, fontSize: '12px', color: 'var(--on-dark-secondary)' };
        if (isLoading || isError || !hasArtistPage(track.artist)) return React.createElement('span', { className: 'truncate', style }, label);
        return React.createElement('button', { type: 'button',
          className: 'text-left truncate hover:text-white hover:underline cursor-pointer transition-colors',
          style,
          onClick: (e) => { e.stopPropagation(); fetchArtistData(track.artist); }
        }, label);
      })(),
      // Resolver icons, right up against the duration after them (as in the
      // page lists)
      React.createElement('div', {
        className: 'flex items-center gap-1 justify-end',
        style: { width: SOURCE_COLUMN, flexShrink: 0, minHeight: '20px' }
      },
        isError ?
          React.createElement(Button, { variant: 'icon', size: 'sm', tone: 'dark', onClick: (e) => {
              e.stopPropagation();
              if (track.sourceUrl) {
                removeFromQueue(track.id);
                handleUrlDrop(track.sourceUrl, 'queue');
              }
            }, 'aria-label': 'Try again', 'data-tooltip': 'Try again' }, React.createElement(Icons.RefreshCw, { size: 14 }))
        : isLoading ?
          // The drawer is dark in both themes: its placeholders use the dark
          // shimmer, as the playbar's do (the page shimmer read almost white).
          React.createElement('div', { className: 'flex items-center gap-1' },
            React.createElement('div', {
              className: 'rounded shimmer-dark animate-shimmer',
              style: { width: '20px', height: '20px' }
            }),
            React.createElement('div', {
              className: 'rounded shimmer-dark animate-shimmer',
              style: { width: '20px', height: '20px', animationDelay: '0.1s' }
            })
          )
        : shownSources.length > 0 ?
          // The shared source button, quiet on the dark drawer.
          shownSources.map(({ resolverId, source, dim }) => {
              const resolver = allResolvers.find(r => r.id === resolverId);
              if (!resolver) return null;
              return React.createElement(SourceIconButton, {
                key: resolverId, resolver, confidence: source?.confidence || 0, dim, quiet: true,
                onClick: () => handlePlay({ ...track, preferredResolver: resolverId })
              });
            })
        : sourceState === 'unplayable' ? null
        :
          React.createElement('div', { className: 'flex items-center gap-1' },
            React.createElement('div', {
              className: 'rounded shimmer-dark animate-shimmer',
              style: { width: '20px', height: '20px' },
              title: 'Resolving track…'
            }),
            React.createElement('div', {
              className: 'rounded shimmer-dark animate-shimmer',
              style: { width: '20px', height: '20px', animationDelay: '0.1s' }
            })
          )
      ),
      // Duration: the last column before Remove
      React.createElement('span', {
        className: 'text-right tabular-nums',
        style: { width: '50px', flexShrink: 0, fontSize: '12px', color: 'var(--on-dark-tertiary)' }
      }, !isLoading && !isError ? trackDurationLabel(track, { trackSources, resolverOrder }) : ''),
      // Remove button
      React.createElement(Button, { variant: 'icon', size: 'sm', tone: 'dark', className: 'flex-shrink-0 opacity-0 group-hover:opacity-100 card-reveal', onClick: (e) => {
          e.stopPropagation();
          // This row only: the same song may be queued more than once.
          removeFromQueue(track.id, index);
        }, 'aria-label': isLoading ? 'Cancel' : 'Remove from queue', 'data-tooltip': isLoading ? 'Cancel' : 'Remove from queue' }, React.createElement(X, { size: 14 }))
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
  virtualizationThreshold = 100,
  // A list where one track can appear twice (two listens of a song in
  // History) keys its rows by more than the id (#767); keys must be unique
  // among siblings (CLAUDE.md).
  getKey = null
}) => {
  const keyOf = (track, index) => (getKey ? getKey(track, index) : (track.id || track.filePath || index));
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
      role: 'list',
      className: 'space-y-0',
      style: { minHeight: 'calc(100vh - 160px)' }
    },
      // Each row is a list item (#1386): the page's renderRow stays as it was.
      tracks.map((track, index) => React.createElement('div', { key: keyOf(track, index), role: 'listitem' },
        renderRow(track, index, null)))
    );
  }

  return React.createElement('div', {
    role: 'list',
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
        key: keyOf(track, virtualRow.index),
        'data-index': virtualRow.index,
        role: 'listitem',
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
  TrackRow,
  TrackRowSkeleton,
  sourceColumnWidth,
  SOURCE_COLUMN,
  TrackSources,
  SourceIconButton,
  VirtualizedQueueList,
  VirtualizedTrackList,
};
