// src/renderer/hooks/use-playback-queue.js — the playback queue state domain,
// extracted from app.js (Track 2b slice 2: state domains as hooks;
// parachord#1098). Slice 1 was the volume domain (src/renderer/hooks/use-volume.js).
//
// Owns: currentQueue/currentTrack/playbackContext/shuffleMode state + their
// refs + the original-queue-before-shuffle ref, the Fisher-Yates queue
// helpers (toggle/restore/scatter variants — deliberate copies, NOT deduped:
// each pre-extraction copy had its own subtly different "first track /
// original ref / console line" shape and byte-parity is the extraction
// invariant; consolidation is a later, reviewable change), the queue
// actions (add/remove/move/clear/context tag/play-collection), the play
// history ref, and the memento effect that persists the queue
// (saved_queue / saved_playback_context / saved_shuffle_state) for restart
// restore — keyed on currentTrack?.id, reading the latest track object via
// currentTrackRef, exactly the parachord#1100 shape.
//
// Rules for this file (the extracted-module rule for hooks):
//   - React.-qualified hooks only (React.useState etc.) — never bare
//     destructured hooks.
//   - No window access at module import time (the render-smoke test requires
//     this file under plain Node).
//   - Inputs arrive as refs/parameters, never component-state closures.
//
// Effect-order note (see use-volume.js for the full version): these effects
// run wherever Parachord calls this hook, ahead of every effect declared
// below the call. The saved-queue effect's dep-key (currentTrack?.id) is
// read during render the same way it was at its old position; moving it
// earlier changes NOTHING about what it keys on.

function usePlaybackQueue({
  cacheLoaded,
  rememberQueue,
  handlePlayRef,
  enrichTracksWithMbidsRef,
}) {
  const [currentTrack, setCurrentTrack] = React.useState(null);
  const [currentQueue, setCurrentQueue] = React.useState([]); // Current playing queue
  // Playback context - tracks where the current track originated from
  // Shape: { type: 'playlist' | 'album' | 'search' | 'library' | 'recommendations', id?, name?, artist? }
  const [playbackContext, setPlaybackContext] = React.useState(null);
  // Shuffle mode - randomize queue order
  const [shuffleMode, setShuffleMode] = React.useState(false);
  const shuffleModeRef = React.useRef(false); // Ref for shuffle mode to avoid stale closures in callbacks
  const originalQueueRef = React.useRef(null); // Store original queue order before shuffle for restore
  const currentQueueRef = React.useRef([]);
  const currentTrackRef = React.useRef(null);
  const playHistoryRef = React.useRef([]); // Stack of previously played tracks for "previous" navigation
  const [queueAnimating, setQueueAnimating] = React.useState(false);

  // Keep refs in sync with state
  React.useEffect(() => { currentQueueRef.current = currentQueue; }, [currentQueue]);
  React.useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
  React.useEffect(() => { shuffleModeRef.current = shuffleMode; }, [shuffleMode]);

  // Save queue when it changes (if remember queue is enabled)
  // Include currentTrack so it can be restored as the playing track
  React.useEffect(() => {
    // Skip until cache is fully loaded to avoid overwriting saved queue with empty data.
    // Previously used resolverSettingsLoaded ref, but that is set before queue restoration
    // completes (especially with no resolvers configured), causing a race condition where
    // the save effect fires with empty queue state and overwrites persisted data.
    if (!cacheLoaded) return;
    if (!rememberQueue) return;

    // Debounce the save to avoid saving too frequently
    const timeoutId = setTimeout(async () => {
      if (window.electron?.store) {
        // Save currentTrack + queue together so we restore the correct playing track.
        // Keyed on the track's id, not the object: the playing track is re-created
        // by in-place updates (Amazon's measured stream quality, duration repair,
        // art backfill), and each one re-saved the whole queue. The ref still
        // saves the latest version of it.
        const currentTrack = currentTrackRef.current;
        const fullQueue = currentTrack ? [currentTrack, ...currentQueue] : currentQueue;
        await window.electron.store.set('saved_queue', fullQueue);
        // Also save playback context
        await window.electron.store.set('saved_playback_context', playbackContext);
        // Save shuffle state and original queue for restore
        await window.electron.store.set('saved_shuffle_state', {
          shuffleMode: shuffleMode,
          originalQueue: originalQueueRef.current
        });
        console.log(`💾 Saved queue: ${currentTrack ? `"${currentTrack.title}" playing + ` : ''}${currentQueue.length} tracks in queue${playbackContext ? ` (from ${playbackContext.type})` : ''}${shuffleMode ? ' (shuffled)' : ''}`);
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [currentTrack?.id, currentQueue, rememberQueue, playbackContext, shuffleMode]);

  // Queue management functions
  const removeFromQueue = React.useCallback((trackId) => {
    setCurrentQueue(prev => prev.filter(t => t.id !== trackId));
    // Also remove from original queue if shuffle is active
    if (shuffleMode && originalQueueRef.current) {
      originalQueueRef.current = originalQueueRef.current.filter(t => t.id !== trackId);
    }
    console.log(`🗑️ Removed track ${trackId} from queue`);
  }, [shuffleMode]);

  const moveInQueue = React.useCallback((fromIndex, toIndex) => {
    if (fromIndex === toIndex) return;
    setCurrentQueue(prev => {
      const newQueue = [...prev];
      const [removed] = newQueue.splice(fromIndex, 1);
      newQueue.splice(toIndex, 0, removed);
      console.log(`🔀 Moved track from index ${fromIndex} to ${toIndex}`);
      return newQueue;
    });
  }, []);

  const clearQueue = () => {
    setCurrentQueue([]);
    // Reset shuffle state when queue is cleared
    setShuffleMode(false);
    originalQueueRef.current = null;
    // Preserve playback context if in spinoff or listen-along mode
    // Only clear context for regular queue scenarios
    if (playbackContext?.type !== 'spinoff' && playbackContext?.type !== 'listenAlong') {
      setPlaybackContext(null);
    }
    console.log('🗑️ Cleared queue');
  };

  // Toggle shuffle mode - shuffles queue in place, stores original for restore
  const toggleShuffle = () => {
    if (shuffleMode) {
      // Turn off shuffle - restore original order if available
      if (originalQueueRef.current) {
        // Filter to only include tracks that still exist in current queue
        const currentIds = new Set(currentQueue.map(t => t.id));
        const restoredQueue = originalQueueRef.current.filter(t => currentIds.has(t.id));
        setCurrentQueue(restoredQueue);
        console.log('🔀 Shuffle OFF - restored original order');
      }
      originalQueueRef.current = null;
      setShuffleMode(false);
    } else {
      // Turn on shuffle - store original and shuffle
      if (currentQueue.length > 1) {
        originalQueueRef.current = [...currentQueue];
        // Fisher-Yates shuffle
        const shuffled = [...currentQueue];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        setCurrentQueue(shuffled);
        console.log('🔀 Shuffle ON - queue randomized');
      }
      setShuffleMode(true);
    }
  };

  // Restore original queue order (used from queue header button)
  const restoreOriginalOrder = () => {
    if (originalQueueRef.current && shuffleMode) {
      const currentIds = new Set(currentQueue.map(t => t.id));
      const restoredQueue = originalQueueRef.current.filter(t => currentIds.has(t.id));
      setCurrentQueue(restoredQueue);
      setShuffleMode(false);
      originalQueueRef.current = null;
      console.log('🔀 Restored original queue order');
    }
  };

  // Helper to set queue with playback context tagged on each track
  // This allows the context to update when tracks from different sources come up
  // respectShuffle: if true and shuffle is ON, shuffle the new queue (for "Play All" actions)
  //                 if false (default) and shuffle is ON, turn off shuffle (for clicking specific tracks)
  const setQueueWithContext = (tracks, context, respectShuffle = false) => {
    const taggedTracks = tracks.map(track => ({
      ...track,
      _playbackContext: context
    }));
    console.log(`🏷️ Tagged ${taggedTracks.length} tracks with context:`, context.type);

    if (respectShuffle && shuffleMode && taggedTracks.length > 1) {
      // "Play All" action with shuffle ON - shuffle the new queue
      originalQueueRef.current = [...taggedTracks];
      // Fisher-Yates shuffle
      const shuffled = [...taggedTracks];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      setCurrentQueue(shuffled);
      console.log('🔀 Shuffle ON - new queue shuffled');
    } else {
      // Click specific track OR shuffle is off - set queue in order
      setCurrentQueue(taggedTracks);
      // Turn off shuffle when clicking a specific track (not respecting shuffle)
      if (!respectShuffle && shuffleMode) {
        setShuffleMode(false);
        originalQueueRef.current = null;
        console.log('🔀 Shuffle OFF - user selected specific track');
      }
    }
    setPlaybackContext(context);
  };

  // Helper to add tracks to existing queue with context
  const addToQueueWithContext = (tracks, context) => {
    const taggedTracks = tracks.map(track => ({
      ...track,
      _playbackContext: context
    }));
    setCurrentQueue(prev => [...prev, ...taggedTracks]);
  };

  // Helper to play a collection of tracks, respecting shuffle mode
  // If shuffle is on, picks a random first track and shuffles the rest
  const playTrackCollection = (tracks, context = null) => {
    if (!tracks || tracks.length === 0) return;

    let tracksToPlay = [...tracks];

    // Tag tracks with context if provided
    if (context) {
      tracksToPlay = tracksToPlay.map(track => ({
        ...track,
        _playbackContext: context
      }));
    }

    let firstTrack;
    let remainingTracks;

    if (shuffleModeRef.current && tracksToPlay.length > 1) {
      // Shuffle mode: pick random first track, shuffle the rest
      const randomIndex = Math.floor(Math.random() * tracksToPlay.length);
      firstTrack = tracksToPlay[randomIndex];

      // Get remaining tracks (excluding the randomly picked one)
      const remaining = [...tracksToPlay.slice(0, randomIndex), ...tracksToPlay.slice(randomIndex + 1)];

      // Fisher-Yates shuffle the remaining tracks
      for (let i = remaining.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
      }
      remainingTracks = remaining;

      // Store original order for unshuffle
      originalQueueRef.current = tracksToPlay.slice(1); // Original order minus first
      console.log('🔀 Shuffle ON - playing random track first, queue shuffled');
    } else {
      // Normal mode: play first track, queue rest in order
      firstTrack = tracksToPlay[0];
      remainingTracks = tracksToPlay.slice(1);
    }

    // Set queue and play
    setCurrentQueue(remainingTracks);
    if (context) {
      setPlaybackContext(context);
    }
    handlePlayRef.current(firstTrack);
  };

  const addToQueue = (tracks, context = null, options = {}) => {
    const { skipAutoPlay = false } = options;
    const tracksArray = Array.isArray(tracks) ? tracks : [tracks];

    // Tag tracks with context if provided
    const taggedTracks = context
      ? tracksArray.map(track => ({ ...track, _playbackContext: context }))
      : tracksArray;

    // Check if nothing is currently playing BEFORE updating queue
    const nothingPlaying = !currentTrackRef.current;

    // If shuffle mode is active, update the original queue ref (or initialize it)
    if (shuffleMode) {
      if (originalQueueRef.current) {
        originalQueueRef.current = [...originalQueueRef.current, ...taggedTracks];
      } else {
        // Initialize original queue if shuffle was enabled before any tracks were added
        originalQueueRef.current = [...currentQueue, ...taggedTracks];
      }
    }

    // Append to queue (shuffle mode inserts at random positions)
    if (shuffleMode) {
      if (currentQueue.length > 0) {
        // Insert new tracks at random positions in existing queue
        setCurrentQueue(prev => {
          const newQueue = [...prev];
          taggedTracks.forEach(track => {
            const randomIndex = Math.floor(Math.random() * (newQueue.length + 1));
            newQueue.splice(randomIndex, 0, track);
          });
          return newQueue;
        });
      } else if (taggedTracks.length > 1) {
        // Shuffle the new tracks before adding to empty queue
        const shuffled = [...taggedTracks];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        setCurrentQueue(prev => [...prev, ...shuffled]);
      } else {
        // Single track, just append
        setCurrentQueue(prev => [...prev, ...taggedTracks]);
      }
    } else {
      // Normal append to end
      setCurrentQueue(prev => [...prev, ...taggedTracks]);
    }
    // Trigger queue animation
    setQueueAnimating(true);
    setTimeout(() => setQueueAnimating(false), 600);
    console.log(`➕ Added ${tracksArray.length} track(s) to queue${shuffleMode ? ' (shuffled)' : ''}`);

    // Queue track resolution is now handled by ResolutionScheduler via queue context visibility

    // Background-enrich queued tracks with MBIDs (so they're ready by playback/scrobble time)
    // (ref bridge: enrichTracksWithMbids is declared below this hook's call
    // site in app.js, so a direct binding would TDZ-throw on every render)
    enrichTracksWithMbidsRef.current(taggedTracks);

    // If nothing is playing, auto-start the first track (unless skipAutoPlay is set)
    if (nothingPlaying && taggedTracks.length > 0 && !skipAutoPlay) {
      const firstTrack = taggedTracks[0];
      console.log(`▶️ Auto-starting playback: "${firstTrack.title}" by ${firstTrack.artist}`);
      // Remove from queue and play
      setCurrentQueue(prev => prev.slice(1));
      handlePlayRef.current(firstTrack);
    }
  };

  return {
    currentTrack,
    setCurrentTrack,
    currentQueue,
    setCurrentQueue,
    playbackContext,
    setPlaybackContext,
    shuffleMode,
    setShuffleMode,
    shuffleModeRef,
    originalQueueRef,
    currentQueueRef,
    currentTrackRef,
    playHistoryRef,
    queueAnimating,
    setQueueAnimating,
    removeFromQueue,
    moveInQueue,
    clearQueue,
    toggleShuffle,
    restoreOriginalOrder,
    setQueueWithContext,
    addToQueueWithContext,
    playTrackCollection,
    addToQueue,
  };
}

module.exports = { usePlaybackQueue };
