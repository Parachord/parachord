// src/renderer/hooks/use-playback-engine.js — the playback engine state
// domain, extracted from app.js (Track 2b slice 3: the big one, parachord#1098).
// Slices 1-2 extracted volume (useVolume) and the queue (usePlaybackQueue);
// this is the engine: handlePlay and friends, the shared HTML5 audio wiring,
// and the spinoff/listen-along session machinery, behind a small inputs
// signature the #1098 design settled (volume hook object + queue hook object +
// a render-scoped services object ctx — Option A from the census comment).
//
// STRAIGHT MOVE, per the maintainer's slice-3 constraint: every function below
// is a byte-for-byte move out of Parachord; only their inputs now come from
// destructuring the three input objects at the hook's top (the destructure
// header is the whole "wiring" — bodies below it are verbatim, and a normalized
// review can strip-hook-prefixes + diff). The handler-ref dance
// (handlePlayRef/handleNextRef/handlePlayPauseRef/handlePreviousRef/startSpinoffRef
// and their no-dep sync effects) is NOT collapsed here — it moved in as-is;
// collapsing it inside the hook is the follow-up PR.
//
// Rules for this file (the extracted-module rule for hooks):
//   - React.-qualified hooks only (React.useState etc.), never bare destructured hooks.
//   - No window access at module import time (the render-smoke test requires
//     this file under plain Node).
//   - Inputs arrive as refs/objects/parameters, never component-state closures.
//
// Effect-order note (see use-volume.js for the full version): the hook's
// effects run wherever Parachord calls usePlaybackEngine, ahead of every
// effect declared below the call — the four handler-ref syncs below used to
// sit in the handler-sync cluster; they now run at the engine-hook call point
// in the same every-render cadence, and the shared-audio listeners they wire
// all read through refs at call time (the reason the dance tolerated any
// declaration position in the first place).

const { isOtherVersion } = require('../lib/track-variants');
const { sourceBlockId } = require('../lib/bad-match-report');
const { unsupportedAudioMessage, dropSubsonicSecrets, playbackDurationSeconds } = require('../lib/playback-helpers');

function usePlaybackEngine({// --- Hook objects (slice 1 & 2 composables) ---
  volume,        // useVolume's return object
  queue,         // usePlaybackQueue's return object
  // --- Services object (render-scoped, Option A of the census comment) ---
  ctx,           // ctx.resolvers | ctx.enrichment | ctx.ui | ctx.scheduling
  // --- App-owned shared values/refs the engine consumes ---
  audioRef,
  localFileSeekTargetRef,
  progressRef,
  seekingRef,
  isPlayingRef,
  streamingPlaybackActiveRef,
  spotifyToken,
  extensionConnected,
  audioContext,
  spinoffMode,
  setSpinoffMode,
  spinoffSourceTrack,
  setSpinoffSourceTrack,
  setSpinoffLoading,
  spinoffModeRef,
  spinoffSourceTrackRef,
  handleNextRef,
  handlePreviousRef,
  handlePlayPauseRef,
  handlePlayRef,
  startSpinoffRef,
  playbackPollerRef,
  pollingRecoveryRef,
  externalTrackTimeoutRef,
  externalTrackIntervalRef,
  waitingForBrowserPlaybackRef,
  pendingCloseTabIdRef,
  trackNeedsExplicitStart,
  spotifyProgressBaselineRef,
  amazonMusicProgressBaselineRef,
  // --- Listen-along session (the friends domain; engine reads/writes it, the
  //     friends surface owns it — passed through, like the shared refs) ---
  listenAlongFriend,
  setListenAlongFriend,
  listenAlongFriendRef,
  listenAlongLastTrackRef,
  listenAlongPendingTrackRef,
  listenAlongUserPausedRef,
  listenAlongEndAfterSongRef,
}) {
  // ---------------------------------------------------------------
  // Input-destructure — the only "wiring". Names below are the exact
  // component-scope identifiers the moved bodies use verbatim.
  // ---------------------------------------------------------------
  const {
    volumeRef,
    isMutedRef,
    resolverVolumeOffsets,
    getEffectiveVolume,
    setSpotifyVolume,
  } = volume;

  const {
    currentTrack,
    currentTrackRef,
    currentQueueRef,
    setCurrentTrack,
    setCurrentQueue,
    playbackContext,
    setPlaybackContext,
    playHistoryRef,
  } = queue;

  // Confidence module side-load (dual-load in index.html / require in sync
  // providers); reading inside the hook body keeps it call-time safe.
  const { normalizeStr, validateResolvedTrack, MIN_CONFIDENCE_THRESHOLD } = window.ConfidenceScoring;

  const {
    loadedResolversRef,
    activeResolversRef,
    resolverOrderRef,
    resolverBlocklistRef,
    resolverConfigCache,
    getResolverConfigRef,
    resolveTrackRef,
    confidenceForSourceRef,
    isHtml5StreamResolver,
    findLoadedResolver,
    usesSharedAudio,
    resolveTracksInBackground,
    buildProtocolFetchHeaders,
    lastfmFetch,
    getLastfmApiKey,
    getArtistTopTracksRef,
    keyForSpinoffDedupRef,
    refreshSpotifyTokenRef,
    startAutoAdvancePollingRef,
  } = ctx.resolvers;

  const {
    trackSources,
    queueTrackSources,
    lookupMbidMapper,
    enrichTrackWithMbid,
    fetchArtworkViaMbid,
    getAlbumArtRef,
    getCachedAlbumArtRef,
    forgetMissingLocalFile,
    showExternalTrackPromptUIRef,
  } = ctx.enrichment;

  // Late-function bridges: the hooks the moved bodies call directly are
  // declared FAR below this hook's call site in app.js, so a direct binding
  // is a TDZ throw on every render. The refs below are synced no-dep after
  // their declarations in app.js; the wrappers preserve late-reference
  // semantics identical to the pre-extraction current-render closure.
  const getResolverConfig = (...args) => getResolverConfigRef.current.apply(null, args);
  const resolveTrack = (...args) => resolveTrackRef.current.apply(null, args);
  const confidenceForSource = (...args) => confidenceForSourceRef.current.apply(null, args);
  const getAlbumArt = (...args) => getAlbumArtRef.current.apply(null, args);
  const getCachedAlbumArt = (...args) => getCachedAlbumArtRef.current.apply(null, args);
  const showExternalTrackPromptUI = (...args) => showExternalTrackPromptUIRef.current.apply(null, args);
  const getArtistTopTracks = (...args) => getArtistTopTracksRef.current.apply(null, args);
  const keyForSpinoffDedup = (...args) => keyForSpinoffDedupRef.current.apply(null, args);
  const refreshSpotifyToken = (...args) => refreshSpotifyTokenRef.current.apply(null, args);
  const startAutoAdvancePolling = (...args) => startAutoAdvancePollingRef.current.apply(null, args);

  const {
    showToastRef,
    showConfirmDialog,
    setActiveView,
    setSettingsTab,
    setProgress,
  } = ctx.ui;

  const {
    updateSchedulerVisibilityRef,
    abortSchedulerContextRef,
    registerPoolContextRef,
    setSchedulerPlaybackIndexRef,
  } = ctx.scheduling;

  // showToast/scheduling are declared below the ctx literal too — same
  // late-function bridge idiom as the art-cluster refs.
  // NOTE: the bridge refs below are Parachord-owned and start `null` —
  // they're synced by the app-side effect block (~L15685), which runs on
  // first commit AFTER the engine's own effects. Nothing engine-internal
  // calls through them on mount today, but an app-side effect added between
  // the engine call and that block that synchronously invokes one of these
  // would hit `null.apply`. Keep engine effect-time calls going through the
  // wrappers only where the call happens post-commit.
  const showToast = (...args) => showToastRef.current.apply(null, args);
  const updateSchedulerVisibility = (...args) => updateSchedulerVisibilityRef.current.apply(null, args);
  const abortSchedulerContext = (...args) => abortSchedulerContextRef.current.apply(null, args);
  const registerPoolContext = (...args) => registerPoolContextRef.current.apply(null, args);
  const setSchedulerPlaybackIndex = (...args) => setSchedulerPlaybackIndexRef.current.apply(null, args);

  // ---------------------------------------------------------------
  // Engine-owned state — returned under the same names Parachord destructures
  // (the reason no call site changes: identical binds, new home).
  // ---------------------------------------------------------------
  const [isPlaying, setIsPlaying] = React.useState(false);
  // isPlayingRef is a Parachord-owned input (volume-hook consumes it first —
  // the engine syncs it here every render from the engine-owned isPlaying)
  const [trackLoading, setTrackLoading] = React.useState(false);
  const [browserPlaybackActive, setBrowserPlaybackActive] = React.useState(false); // Track confirmed playing in the user's browser
  const [activeExtensionTabId, setActiveExtensionTabId] = React.useState(null); // Which extension tab is playing
  // (spinoff session state is Parachord-owned input — its mode evaluates in
  // a deps array above every legal position for this hook's call (slice 3
  // layout note in the module header). ONLY the spinoff *pool* refs are
  // engine-owned below.)
  const [currentSource, setCurrentSource] = React.useState(null);
  const startTimeState = React.useState(0); // (startTime returned, only its setter is used inside the engine)
  const setStartTime = startTimeState[1];
  const [isExternalPlayback, setIsExternalPlayback] = React.useState(false);
  const showExternalPromptState = React.useState(false); // (showExternalPrompt returned, only its setter is used inside the engine)
  const setShowExternalPrompt = showExternalPromptState[1];
  const pendingExternalTrackState = React.useState(null); // (pendingExternalTrack returned, only its setter is used inside the engine)
  const setPendingExternalTrack = pendingExternalTrackState[1];
  const pendingExternalResolverIdState = React.useState(null); // (pendingExternalResolverId returned, only its setter is used inside the engine)
  const setPendingExternalResolverId = pendingExternalResolverIdState[1];
  const insertedTrackIdState = React.useState(null); // (insertedTrackId returned, only its setter is used inside the engine)
  const setInsertedTrackId = insertedTrackIdState[1];

  // ---------------------------------------------------------------
  // Engine-internal refs — audit-driven: no outside-the-engine consumers.
  // ---------------------------------------------------------------
  const playbackGenerationRef = React.useRef(0);
  const isAdvancingTrackRef = React.useRef(false);
  const html5AudioTrackRef = React.useRef(null); // Track that element is actually playing
  const audioBlobUrlRef = React.useRef(null); // Current blob URL for audio (for cleanup)
  const localFilePlaybackTrackRef = React.useRef(null); // Track being played for fallback handling
  const localFileFallbackInProgressRef = React.useRef(false); // Prevent duplicate error dialogs during fallback
  const localFileNetworkRetryRef = React.useRef(0); // MEDIA_ERR_NETWORK retries for a stalled network mount
  const localFileRetryCommitRef = React.useRef(null); // Post-play state commit, deferred until a MEDIA_ERR_NETWORK retry succeeds
  const spotifyPlaySentRef = React.useRef(false); // A play() call actually went out this session
  const spinoffTracksRef = React.useRef([]); // Pool of similar tracks to play
  const spinoffPreviousContextRef = React.useRef(null); // Store previous playback context to restore on exit
  const spinoffRefillUrlRef = React.useRef(null); // Optional refill endpoint for pool-based spinoff (parachord://play-radio)
  const spinoffRefillEmptyCountRef = React.useRef(0); // Consecutive empty/failed refill attempts; stop after 3
  const spinoffRefillLastFetchAtRef = React.useRef(0); // Timestamp of last refill attempt for 5s rate-limit

  // ---------------------------------------------------------------
  // Handler refs — INPUTS this slice: Parachord-owned shared refs (queue and
  // volume hooks consume them first; this hook writes them every render via
  // the syncs below). The collapse of the ref-dance class is the follow-up.)
  // ---------------------------------------------------------------

  // Keep state-bound refs in sync (each was a one-line entry in the old
  // Parachord ref-sync cluster; they move with the state they mirror).
  React.useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  React.useEffect(() => { spinoffModeRef.current = spinoffMode; }, [spinoffMode]);
  React.useEffect(() => { spinoffSourceTrackRef.current = spinoffSourceTrack; }, [spinoffSourceTrack]);

  // Handler-ref syncs: no-dep every-render, identical to the four (five)
  // entries pulled out of the handler-sync cluster. See the effect-order
  // note above for why position changed nothing.
  React.useEffect(() => { handleNextRef.current = handleNext; });
  React.useEffect(() => { handlePreviousRef.current = handlePrevious; });
  React.useEffect(() => { handlePlayPauseRef.current = handlePlayPause; });
  React.useEffect(() => { handlePlayRef.current = handlePlay; });
  React.useEffect(() => { startSpinoffRef.current = startSpinoff; });

  const playDemoAudio = (track) => {
    if (!audioContext) return;
    if (currentSource) {
      try { currentSource.stop(); } catch (_e) {}
    }
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(440 + (track.id * 100), audioContext.currentTime);
    gainNode.gain.setValueAtTime(volume / 100, audioContext.currentTime);
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.start();
    setCurrentSource(oscillator);
    setStartTime(audioContext.currentTime);
  };

  const ensureSharedAudioElement = (track) => {
    if (track) html5AudioTrackRef.current = track;
    if (audioRef.current) return audioRef.current;

    const ownerOf = (el) => {
      const src = el?.src || '';
      if (src.startsWith('local-audio:')) return 'localfiles';
      if (src.startsWith('blob:')) return 'soundcloud';
      // Every html5Stream resolver loads an http(s) URL; the play path tags the
      // track it hands this element with the owning resolver id.
      if (/^https?:/i.test(src)) return html5AudioTrackRef.current?._streamOwner || html5AudioTrackRef.current?._activeResolver || null;
      return null;
    };

    // Same shape as handlePlay's autoSkipIfAdvancing, but the track is the
    // one this element is playing (html5AudioTrackRef), not the closure of
    // whichever play created the element.
    const skipIfAdvancing = (reason) => {
      if (!(isAdvancingTrackRef.current || spinoffModeRef.current)) return false;
      const playing = html5AudioTrackRef.current;
      console.log(`⏭️ Auto-skip "${playing?.title || 'track'}" — ${reason}`);
      setTrackLoading(false);
      if (playing?.id) {
        setCurrentQueue(prev => prev.map(t => t.id === playing.id ? { ...t, status: 'error' } : t));
      }
      setTimeout(() => { if (handleNextRef.current) handleNextRef.current(); }, 600);
      return true;
    };

    console.log('🎵 Creating shared HTML5 audio element');
    const audio = new Audio();
    audioRef.current = audio;

    audio.addEventListener('timeupdate', () => {
      if (!ownerOf(audioRef.current)) return;
      if (audioRef.current && !seekingRef.current) {
        const currentTime = audioRef.current.currentTime;
        setProgress(currentTime);
        if (window.scrobbleManager) {
          window.scrobbleManager.onProgressUpdate(currentTime);
        }
      }
    });
    audio.addEventListener('loadedmetadata', () => {
      if (!ownerOf(audioRef.current)) return;
      const audioDuration = audioRef.current?.duration;
      if (audioDuration && !isNaN(audioDuration) && isFinite(audioDuration)) {
        setCurrentTrack(prev => prev ? { ...prev, duration: audioDuration } : prev);
      }
    });
    audio.addEventListener('durationchange', () => {
      if (!ownerOf(audioRef.current)) return;
      const audioDuration = audioRef.current?.duration;
      if (audioDuration && !isNaN(audioDuration) && isFinite(audioDuration)) {
        setCurrentTrack(prev => prev ? { ...prev, duration: audioDuration } : prev);
      }
    });
    audio.addEventListener('ended', () => {
      const owner = ownerOf(audioRef.current);
      if (!owner) return;
      const label = owner === 'localfiles' ? 'Local file' : owner === 'soundcloud' ? 'SoundCloud' : 'Subsonic';
      console.log(`🎵 ${label} playback ended`);
      handleNextRef.current?.();
    });
    audio.addEventListener('playing', () => {
      // Reset the network-retry budget only after local-file playback has
      // held. Clearing it on this event itself loops: a seek retry sets
      // currentTime from loadedmetadata, 'playing' fires, the budget drops
      // to 0, and the seek error immediately retries again.
      if (ownerOf(audioRef.current) !== 'localfiles') return;
      const generation = playbackGenerationRef.current;
      setTimeout(() => {
        const el = audioRef.current;
        if (!el || playbackGenerationRef.current !== generation) return;
        if (!el.error && !el.paused && el.src.startsWith('local-audio:')) {
          localFileNetworkRetryRef.current = 0;
          localFileSeekTargetRef.current = null;
        }
      }, 1500);
    });
    audio.addEventListener('error', (e) => {
      const owner = ownerOf(e.target);
      const mediaError = e.target.error;
      if (owner === 'localfiles') {
        console.error('🎵 Audio error:', mediaError);
        if (localFileFallbackInProgressRef.current) {
          console.log('🔄 Audio error during fallback attempt, skipping dialog');
          return;
        }
        let errorMessage = 'Could not play this file. It may have been moved or deleted.';
        if (mediaError?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
          const failed = localFilePlaybackTrackRef.current;
          const filePath = failed?.filePath || failed?.sources?.localfiles?.filePath || '';
          const ext = filePath.split('.').pop()?.toLowerCase();
          errorMessage = unsupportedAudioMessage(ext);
        } else if (mediaError?.code === MediaError.MEDIA_ERR_NETWORK) {
          const el = audioRef.current;
          const src = el?.src || '';
          // A seek (or a stalled read) on a network mount surfaces as
          // MEDIA_ERR_NETWORK even when the file is still there. Retry once
          // from the position the user asked for before telling them the
          // file was deleted.
          if (src.startsWith('local-audio:')) {
            if (localFileNetworkRetryRef.current < 1) {
              localFileNetworkRetryRef.current += 1;
              const fromElement = el.currentTime;
              const resumeAt = (fromElement > 0.25 ? fromElement : null)
                ?? localFileSeekTargetRef.current
                ?? progressRef.current
                ?? 0;
              const generation = playbackGenerationRef.current;
              const wasPlaying = !!localFileRetryCommitRef.current || isPlayingRef.current || !el.paused;
              console.warn(`🎵 Local file network error — retrying at ${Number(resumeAt).toFixed(2)}s${wasPlaying ? '' : ' (paused)'}`);
              setTimeout(() => {
                const retryEl = audioRef.current;
                if (!retryEl || playbackGenerationRef.current !== generation) return;
                if (!retryEl.src.startsWith('local-audio:')) return;
                const base = src.split('?')[0];
                const onReady = () => {
                  retryEl.removeEventListener('loadedmetadata', onReady);
                  if (playbackGenerationRef.current !== generation) return;
                  try {
                    if (resumeAt > 0) retryEl.currentTime = resumeAt;
                  } catch (err) {
                    console.warn('🎵 Local file retry seek failed:', err);
                  }
                  if (!wasPlaying) return;
                  retryEl.play().then(() => {
                    const commit = localFileRetryCommitRef.current;
                    localFileRetryCommitRef.current = null;
                    if (commit && playbackGenerationRef.current === generation) commit();
                  }).catch(err => console.warn('🎵 Local file retry play failed:', err));
                };
                retryEl.addEventListener('loadedmetadata', onReady);
                retryEl.src = base + '?r=' + Date.now();
                retryEl.load();
              }, 400);
              return;
            }
            localFileRetryCommitRef.current = null;
            const failedTrack = localFilePlaybackTrackRef.current;
            const otherSources = failedTrack?.sources
              ? Object.keys(failedTrack.sources).filter(id => id !== 'localfiles' && !failedTrack.sources[id]?.noMatch)
              : [];
            if (otherSources.length > 0 && !localFileFallbackInProgressRef.current && handlePlayRef.current) {
              console.log('🔄 Local file still failing after retry — falling back to next available source...');
              localFileFallbackInProgressRef.current = true;
              handlePlayRef.current({
                ...failedTrack,
                sources: Object.fromEntries(Object.entries(failedTrack.sources).filter(([id]) => id !== 'localfiles'))
              });
              return;
            }
            errorMessage = 'Network error while reading the file. If it is on a network drive, the connection may have stalled — try again. Otherwise the file may have been moved or deleted.';
          } else {
            errorMessage = 'Network error while loading the file. The file may have been moved or deleted.';
          }
        } else if (mediaError?.code === MediaError.MEDIA_ERR_DECODE) {
          errorMessage = 'Error decoding the audio file. The file may be corrupted or use an unsupported format.';
        }
        if (skipIfAdvancing(`local file playback: ${errorMessage}`)) return;
        showConfirmDialog({
          type: 'error',
          title: 'Playback Error',
          message: errorMessage
        });
        return;
      }
      if (owner === 'soundcloud') {
        console.error('🎵 SoundCloud audio error:', mediaError);
        let errorMessage = 'Could not play this SoundCloud track.';
        if (mediaError?.code === MediaError.MEDIA_ERR_NETWORK) {
          errorMessage = 'Network error while streaming. Please try again.';
        } else if (mediaError?.code === MediaError.MEDIA_ERR_DECODE) {
          errorMessage = 'Error decoding the audio stream.';
        }
        if (skipIfAdvancing(`SoundCloud playback: ${errorMessage}`)) return;
        showConfirmDialog({
          type: 'error',
          title: 'SoundCloud Playback Error',
          message: errorMessage
        });
        return;
      }
      if (owner && isHtml5StreamResolver(owner)) {
        const label = findLoadedResolver(owner)?.name || owner;
        console.error(`📡 ${label} audio error:`, mediaError);
        let errorMessage = `Could not play this track from your ${label} server. Check that the server is reachable and that you are still signed in.`;
        if (mediaError?.code === MediaError.MEDIA_ERR_NETWORK) {
          errorMessage = `Network error while streaming from your ${label} server. It may be unreachable.`;
        } else if (mediaError?.code === MediaError.MEDIA_ERR_DECODE) {
          errorMessage = `Error decoding the audio stream from your ${label} server.`;
        } else if (mediaError?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
          errorMessage = `The ${label} server returned an audio format this app cannot decode.`;
        }
        if (skipIfAdvancing(`${label} playback: ${errorMessage}`)) return;
        setTrackLoading(false);
        showConfirmDialog({
          type: 'error',
          title: `${label} Playback Error`,
          message: errorMessage
        });
      }
    });
    return audio;
  };

  const handlePlay = async (trackOrSource) => {
    // If user manually plays something while listening along, end the listen-along session
    // Listen-along tracks are tagged with _playbackContext.type === 'listenAlong'
    const listenAlongFriendNow = listenAlongFriendRef.current;
    if (listenAlongFriendNow && trackOrSource?._playbackContext?.type !== 'listenAlong') {
      console.log(`🎧 User played a different track - ending listen-along with ${listenAlongFriendNow.displayName}`);
      showToast(`Stopped listening along with ${listenAlongFriendNow.displayName}`);
      abortSchedulerContext('listen-along');
      setListenAlongFriend(null);
      listenAlongLastTrackRef.current = null;
      listenAlongPendingTrackRef.current = null;
      listenAlongUserPausedRef.current = false;
      listenAlongEndAfterSongRef.current = null;
      setPlaybackContext(null);
    }

    // Increment playback generation to mark this as the current play request
    // Any previously-started play request will detect this and abort
    playbackGenerationRef.current++;
    const thisGeneration = playbackGenerationRef.current;

    // In auto-advance contexts (handleNext-driven progression OR spinoff/radio
    // mode) any playback failure should silently skip to the next track
    // instead of disrupting the user with a dialog. spinoffModeRef captures
    // protocol-radio and right-click-spinoff sessions; isAdvancingTrackRef
    // captures handleNext flight for queue/album/playlist auto-advance. Call
    // sites use this helper at every failure path: returns true when the
    // failure was handled silently (caller should `return` immediately),
    // false when the caller should fall through to its dialog.
    const autoSkipIfAdvancing = (reason) => {
      if (!(isAdvancingTrackRef.current || spinoffModeRef.current)) return false;
      console.log(`⏭️ Auto-skip "${trackOrSource?.title || 'track'}" — ${reason}`);
      setTrackLoading(false);
      if (trackOrSource?.id) {
        setCurrentQueue(prev => prev.map(t => t.id === trackOrSource.id ? { ...t, status: 'error' } : t));
      }
      setTimeout(() => { if (handleNextRef.current) handleNextRef.current(); }, 600);
      return true;
    };

    console.log('🎵 Playing track:', trackOrSource.title, 'by', trackOrSource.artist);
    setTrackLoading(true); // Show loading state in playbar

    // Stop all local audio sources (HTML5 Audio) - do this first to prevent overlap
    // Always stop regardless of paused state to handle edge cases
    stopAllLocalAudio();

    // Stop any active browser playback before starting new track
    if (browserPlaybackActive && activeExtensionTabId) {
      console.log('⏹️ Stopping browser playback before playing new track');
      window.electron.extension.sendCommand({
        type: 'command',
        action: 'pause'
      });
      pendingCloseTabIdRef.current = activeExtensionTabId;
      setBrowserPlaybackActive(false);
      setActiveExtensionTabId(null);
    }

    // Close playback window if active (Bandcamp embedded player)
    if (window.electron?.playbackWindow?.close) {
      console.log('⏹️ Closing playback window before playing new track');
      window.electron.playbackWindow.close();
    }

    // ALWAYS stop all streaming playback sources unconditionally to prevent overlap
    // This handles race conditions where streamingPlaybackActiveRef may already be reset
    // by handleNext but playback is still in progress or loading
    //
    // We await these pause operations to ensure they complete before starting new playback.
    // This prevents race conditions when rapidly switching resolvers.
    const pausePromises = [];

    // Always pause Spotify if we have a token
    // Only when Parachord's current playback is on Spotify. "Always pause"
    // paused the user's own Spotify session while Parachord was playing
    // something else, and answered 403 (already paused) in the console on
    // every skip.
    if (spotifyToken && (currentTrackRef.current?._activeResolver === 'spotify' || spotifyPlaySentRef.current)) {
      spotifyPlaySentRef.current = false;
      console.log('⏹️ Pausing Spotify before playing new track');
      pausePromises.push(
        fetch('https://api.spotify.com/v1/me/player/pause', {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${spotifyToken}` }
        }).catch(() => {}) // Silently ignore - may not be playing
      );
    }

    // Always pause Apple Music native playback (macOS MusicKit)
    if (window.electron?.musicKit) {
      console.log('⏹️ Pausing Apple Music (native) before playing new track');
      pausePromises.push(
        window.electron.musicKit.pause().catch(() => {}) // Silently ignore - may not be playing
      );
    }

    // Always pause Apple Music web playback (MusicKit JS)
    const musicKitWeb = window.getMusicKitWeb ? window.getMusicKitWeb() : null;
    if (musicKitWeb) {
      try {
        console.log('⏹️ Pausing Apple Music (web) before playing new track');
        musicKitWeb.pause();
      } catch (_e) {} // Silently ignore - may not be configured or playing
    }

    // Always stop Apple Music preview audio if it exists
    if (window._appleMusicPreviewAudio) {
      console.log('⏹️ Stopping Apple Music preview audio');
      window._appleMusicPreviewAudio.pause();
      window._appleMusicPreviewAudio.currentTime = 0;
    }

    pausePromises.push(stopAmazonIfActive('⏹️ Stopping the Amazon Music player before playing new track'));

    // Always stop main process polling for both Spotify and Apple Music
    stopMainProcessPolling();

    // Reset streaming flag
    streamingPlaybackActiveRef.current = false;

    // Wait for all pause operations to settle (with timeout to prevent indefinite blocking)
    if (pausePromises.length > 0) {
      await Promise.race([
        Promise.allSettled(pausePromises),
        new Promise(resolve => setTimeout(resolve, 500)) // Max 500ms wait
      ]);
    }

    // Check if another play request has superseded this one while we were stopping playback
    if (playbackGenerationRef.current !== thisGeneration) {
      console.log('⏹️ Playback request superseded by newer request, aborting');
      // Don't clear loading state - the newer request will manage it
      return;
    }

    // Exit spinoff mode if playing a track that isn't from the spinoff pool
    // (unless this is being called FROM spinoff mode's handleNext)
    // Use ref instead of state to avoid race condition when handleNext calls exitSpinoff then handlePlay
    if (spinoffModeRef.current && !trackOrSource._playbackContext?.type?.includes('spinoff')) {
      exitSpinoff();
    }

    // Use ref to avoid stale closure issues when called from extension message handler
    const currentResolvers = loadedResolversRef.current;

    // Determine if we were passed a track with multiple sources or a specific source
    let resolverId;
    let sourceToPlay = trackOrSource;

    // Handle tracks without sources property (e.g., AI-added queue tracks that haven't been resolved yet)
    // Initialize empty sources object so they go through on-demand resolution
    if (!trackOrSource.sources && trackOrSource.artist && trackOrSource.title) {
      console.log('🔄 Track has no sources, initializing for on-demand resolution:', trackOrSource.title);
      trackOrSource = { ...trackOrSource, sources: {} };
    }

    if (trackOrSource.sources && typeof trackOrSource.sources === 'object' && !Array.isArray(trackOrSource.sources)) {
      // Merge in resolved sources from trackSources state if available
      // This ensures we have all available sources including those resolved in background
      // Guard: only merge when track has a defined id, otherwise trackSources["undefined"]
      // could contain stale sources from unrelated tracks (e.g. listen-along queue tracks)
      const resolvedSources = trackOrSource.id ? (trackSources[trackOrSource.id] || {}) : {};
      if (Object.keys(resolvedSources).length > 0) {
        // Don't merge back sources that were explicitly removed by fallback logic
        // (otherwise the fallback's filtered sources get overwritten and we loop)
        const filteredResolved = { ...resolvedSources };
        if (trackOrSource._appleMusicFallback) delete filteredResolved.applemusic;
        if (trackOrSource._spotifyFallback) delete filteredResolved.spotify;
        trackOrSource = { ...trackOrSource, sources: { ...trackOrSource.sources, ...filteredResolved } };
        sourceToPlay = trackOrSource;
      }

      // We have a track with multiple sources - select the best one
      let availableResolvers = Object.keys(trackOrSource.sources).filter(id => !trackOrSource.sources[id]?.noMatch);

      if (availableResolvers.length === 0) {
        // No sources available - show track immediately, then resolve
        console.log('🔄 No sources found, showing track and resolving...');

        // Immediately set as current track so user sees feedback
        const placeholderTrack = {
          ...trackOrSource,
          status: 'resolving'
        };
        setCurrentTrack(placeholderTrack);

        // Resolve across all enabled resolvers in parallel (like ChatCard does)
        const currentResolvers = loadedResolversRef.current;
        const currentActiveResolvers = activeResolversRef.current;
        const currentResolverOrder = resolverOrderRef.current;
        const orderedIds = currentResolverOrder.filter(id => currentActiveResolvers.includes(id));
        const unorderedIds = currentActiveResolvers.filter(id => !orderedIds.includes(id));
        const enabledResolvers = [...orderedIds, ...unorderedIds]
          .map(id => currentResolvers.find(r => r.id === id))
          .filter(r => r && r.capabilities?.resolve);

        // Helper to validate resolved track matches requested metadata
        // Module-scope aliases (window.ConfidenceScoring) serve the pipeline;
        // the old local duplicate had drifted from the canonical guard.

        // Helper to find best matching result from search results
        const findBestMatch = (results, targetArtist, targetTitle, targetMbid, targetIsrc) => {
          if (!results || results.length === 0) return null;
          // Tier 1: exact MusicBrainz recording MBID — a definitive identity
          // match that's immune to artist/title formatting differences.
          if (targetMbid) {
            const m = results.find(r => (r.mbid || r.recordingMbid) && (r.mbid === targetMbid || r.recordingMbid === targetMbid));
            if (m) return m;
          }
          // Tier 2: exact ISRC — also a definitive recording-identity match.
          if (targetIsrc) {
            const ti = String(targetIsrc).trim().toUpperCase();
            const m = results.find(r => r.isrc && String(r.isrc).trim().toUpperCase() === ti);
            if (m) return m;
          }
          const normTargetArtist = normalizeStr(targetArtist);
          const normTargetTitle = normalizeStr(targetTitle);
          // Tier 3: exact normalized name (artist + title)
          for (const r of results) {
            if (normalizeStr(r.artist) === normTargetArtist && normalizeStr(r.title) === normTargetTitle) {
              return r;
            }
          }
          // Tier 4: a contains match that is not another version (a cover,
          // remix or live cut the target title doesn't name). Tier 5: any
          // contains match, so "Song - Remastered"-style catalog titles and
          // variant-only results still resolve.
          for (const r of results) {
            if (!isOtherVersion(r, targetArtist, targetTitle) && validateResolvedTrack(r, targetArtist, targetTitle)) {
              return r;
            }
          }
          for (const r of results) {
            if (validateResolvedTrack(r, targetArtist, targetTitle)) {
              return r;
            }
          }
          return null;
        };

        // Fire MBID Mapper lookup in parallel with resolver searches
        // This gives us a canonical recording identity to improve cross-resolver matching
        const mbidLookupPromise = lookupMbidMapper(
          trackOrSource.artist, trackOrSource.title, trackOrSource.album
        ).catch(() => null);

        const freshSources = {};
        const resolvePromises = enabledResolvers.map(async (resolver) => {
          try {
            const config = getResolverConfigRef.current
              ? await getResolverConfigRef.current(resolver.id)
              : {};

            let bestMatch = null;

            // Prefer search() to get all results and find best match
            if (resolver.search && typeof resolver.search === 'function') {
              const query = `${trackOrSource.artist} ${trackOrSource.title}`;
              const results = await resolver.search(query, config);
              if (results && results.length > 0) {
                bestMatch = findBestMatch(results, trackOrSource.artist, trackOrSource.title, trackOrSource.mbid || trackOrSource.recordingMbid, (window.pickTrackIsrc && window.pickTrackIsrc(trackOrSource)) || trackOrSource.isrc);
                if (!bestMatch) {
                  console.warn(`  ⚠️ ${resolver.id} returned ${results.length} results but none matched "${trackOrSource.title}" by "${trackOrSource.artist}"`);
                }
              }
            } else {
              // Fallback to resolve() for resolvers without search
              const result = await resolver.resolve(trackOrSource.artist, trackOrSource.title, trackOrSource.album, config);
              if (result && validateResolvedTrack(result, trackOrSource.artist, trackOrSource.title)) {
                bestMatch = result;
              } else if (result) {
                console.warn(`  ⚠️ Rejecting ${resolver.id} result - "${result.title}" by "${result.artist}" doesn't match "${trackOrSource.title}" by "${trackOrSource.artist}"`);
              }
            }

            if (bestMatch) {
              freshSources[resolver.id] = {
                ...bestMatch,
                // Canonical "both-axis fuzzy validated" tier; matches
                // calculateConfidence and tests/helpers/confidence-scoring.js.
                // Resolver-supplied higher values (e.g. 1.0 direct-ID) are preserved.
                confidence: bestMatch.confidence || 0.95,
                resolvedAt: Date.now()
              };
            }
          } catch (error) {
            console.error(`  ❌ ${resolver.name || resolver.id} resolve error:`, error);
          }
        });

        // Wait for both resolver searches and MBID lookup to complete
        const [, mbidResult] = await Promise.all([
          Promise.all(resolvePromises),
          mbidLookupPromise
        ]);

        // Check if another play request superseded this one during resolution
        if (playbackGenerationRef.current !== thisGeneration) {
          console.log('⏹️ Playback request superseded during resolution, aborting');
          return;
        }

        // Enrich track with MBID metadata if mapper returned a result
        if (mbidResult && mbidResult.recording_mbid) {
          trackOrSource.mbid = mbidResult.recording_mbid;
          trackOrSource.artistMbids = mbidResult.artist_credit_mbids;
          if (mbidResult.release_mbid) trackOrSource.releaseMbid = mbidResult.release_mbid;
          if (mbidResult.confidence >= 0.9) {
            console.log(`🎯 MBID Mapper: "${trackOrSource.title}" → ${mbidResult.recording_mbid} (confidence: ${mbidResult.confidence})`);
          }
        }

        if (Object.keys(freshSources).length > 0) {
          trackOrSource.sources = freshSources;
          // Update trackSources state so resolver dropdown shows all options
          if (trackOrSource.id) {
            queueTrackSources(trackOrSource.id, freshSources, { immediate: true });
          }
        }

        // Update availableResolvers after resolution
        availableResolvers = Object.keys(trackOrSource.sources).filter(id => !trackOrSource.sources[id]?.noMatch);

        // If no sources found but MBID mapper returned canonical names, retry with those
        // This helps when the original metadata has typos, alternate spellings, or non-standard formatting
        if (availableResolvers.length === 0 && mbidResult && mbidResult.confidence >= 0.7) {
          const canonicalArtist = mbidResult.artist_credit_name;
          const canonicalTitle = mbidResult.recording_name;
          const origArtistNorm = (trackOrSource.artist || '').toLowerCase().trim();
          const origTitleNorm = (trackOrSource.title || '').toLowerCase().trim();
          // Only retry if canonical names actually differ from what we searched
          if ((canonicalArtist || '').toLowerCase().trim() !== origArtistNorm ||
              (canonicalTitle || '').toLowerCase().trim() !== origTitleNorm) {
            console.log(`🔄 MBID Mapper: retrying with canonical names "${canonicalArtist} - ${canonicalTitle}"`);
            const retryPromises = enabledResolvers.map(async (resolver) => {
              try {
                const config = getResolverConfigRef.current
                  ? await getResolverConfigRef.current(resolver.id)
                  : {};
                let bestMatch = null;
                if (resolver.search && typeof resolver.search === 'function') {
                  const query = `${canonicalArtist} ${canonicalTitle}`;
                  const results = await resolver.search(query, config);
                  if (results && results.length > 0) {
                    bestMatch = findBestMatch(results, canonicalArtist, canonicalTitle, mbidResult.recording_mbid || trackOrSource.mbid, (window.pickTrackIsrc && window.pickTrackIsrc(trackOrSource)) || trackOrSource.isrc);
                  }
                } else if (resolver.resolve) {
                  const result = await resolver.resolve(canonicalArtist, canonicalTitle, mbidResult.release_name, config);
                  if (result && validateResolvedTrack(result, canonicalArtist, canonicalTitle)) {
                    bestMatch = result;
                  }
                }
                if (bestMatch) {
                  freshSources[resolver.id] = {
                    ...bestMatch,
                    confidence: (bestMatch.confidence || 0.9) * mbidResult.confidence,
                    resolvedAt: Date.now(),
                    mbidResolved: true
                  };
                }
              } catch (_error) {
                // Silently fail canonical retry
              }
            });
            await Promise.all(retryPromises);
            if (Object.keys(freshSources).length > 0) {
              trackOrSource.sources = freshSources;
              if (trackOrSource.id) {
                queueTrackSources(trackOrSource.id, freshSources, { immediate: true });
              }
            }
            availableResolvers = Object.keys(trackOrSource.sources).filter(id => !trackOrSource.sources[id]?.noMatch);
          }
        }

        if (availableResolvers.length === 0) {
          console.error('❌ No resolver found for track after on-demand resolution');
          setTrackLoading(false); // Clear loading state
          setCurrentTrack(prev => prev?.id === placeholderTrack.id ? { ...prev, status: 'error' } : prev);
          if (autoSkipIfAdvancing('no playable source')) return;
          showConfirmDialog({
            type: 'error',
            title: 'No Source Found',
            message: 'Could not find a playable source for this track. Try enabling more resolvers in settings.',
            actionButton: {
              label: 'Open Resolver Settings',
              onClick: () => { setActiveView('settings'); setSettingsTab('plugins'); },
            },
          });
          return;
        }

        // Update current track with resolved sources
        setCurrentTrack(prev => {
          if (prev?.id === placeholderTrack.id || prev?.title === placeholderTrack.title) {
            return { ...trackOrSource, status: 'resolved' };
          }
          return prev;
        });
      }

      // Sort sources by: 1) preferred resolver (if specified), 2) resolver priority, 3) confidence
      // Use refs to avoid stale closure issues when called from callbacks
      const currentActiveResolvers = activeResolversRef.current;
      const currentResolverOrder = resolverOrderRef.current;
      const currentBlocklist = resolverBlocklistRef.current;
      const preferredResolver = trackOrSource.preferredResolver;
      const trackArtistNorm = (trackOrSource.artist || '').toLowerCase().trim();
      const trackTitleNorm = (trackOrSource.title || '').toLowerCase().trim();
      const sortedSources = availableResolvers.map(resId => {
        const src = trackOrSource.sources[resId];
        // Defense in depth: cached sources from older code paths (notably
        // pre-fix resolveFriendTrack) may lack a `confidence` field. Without
        // this fallback they'd evaluate to 0 and get dropped by the floor
        // filter below — even when they'd validate cleanly. Re-score on the
        // fly using the canonical (track artist, track title) target so
        // legacy cache entries survive until they age out (7-day TTL).
        const confidence = confidenceForSource(
          { artist: trackOrSource.artist, title: trackOrSource.title },
          src
        );
        return {
          resolverId: resId,
          source: src,
          priority: currentResolverOrder.indexOf(resId),
          confidence
        };
      })
      .filter(s => currentActiveResolvers.includes(s.resolverId)) // Only enabled resolvers
      // Drop wrong-song matches (single-axis title-only or artist-only matches
      // score 0.50). Without this floor, a higher-priority resolver's wrong
      // match outranks a lower-priority resolver's correct match because
      // confidence is otherwise only a within-priority tiebreaker.
      // Mirrors Android's ResolverScoring.MIN_CONFIDENCE_THRESHOLD.
      .filter(s => s.confidence >= MIN_CONFIDENCE_THRESHOLD)
      .filter(s => {  // Filter blocklisted specific source results
        const srcId = sourceBlockId(s.source);
        return !currentBlocklist.some(entry =>
          entry.resolverId === s.resolverId &&
          entry.artist === trackArtistNorm &&
          entry.title === trackTitleNorm &&
          entry.sourceId === srcId
        );
      })
      .sort((a, b) => {
        // If a preferred resolver is specified, prioritize it
        if (preferredResolver) {
          if (a.resolverId === preferredResolver) return -1;
          if (b.resolverId === preferredResolver) return 1;
        }
        // Then sort by priority (lower index = higher priority)
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }
        // If same priority, sort by confidence (higher = better)
        return b.confidence - a.confidence;
      });

      if (sortedSources.length === 0) {
        console.error('❌ No enabled resolvers found for track. Available sources:', Object.keys(trackOrSource.sources), 'Active resolvers:', currentActiveResolvers);
        // Per-candidate scorecard for the empty selection — the dialog above
        // is blind to the reason. NOTE: availableResolvers is every resolver
        // that has a source on the track, so entries here cover confidence-
        // floor drops (failed artist/title containment), INACTIVE resolvers
        // and BLOCKLISTED sources alike — a scorecard, not a floor-drop log.
        console.warn('⬇️ Source selection scorecard (target vs candidates):', availableResolvers.map(id => {
          const src = trackOrSource.sources[id];
          return {
            id,
            storedConfidence: src && typeof src.confidence !== 'undefined' ? src.confidence : null,
            rescored: src ? confidenceForSource({ artist: trackOrSource.artist, title: trackOrSource.title }, src) : null,
            source: src ? `${src.artist || '?'} — ${src.title || '?'}` : null,
            target: `${trackOrSource.artist || '?'} — ${trackOrSource.title || '?'}`
          };
        }));
        if (autoSkipIfAdvancing('no enabled source matches')) return;
        setTrackLoading(false); // Clear loading state
        showConfirmDialog({
          type: 'error',
          title: 'No Enabled Source',
          message: 'This track has sources but none match your enabled resolvers. Check your resolver settings.',
          actionButton: {
            label: 'Open Resolver Settings',
            onClick: () => { setActiveView('settings'); setSettingsTab('plugins'); },
          },
        });
        return;
      }

      const best = sortedSources[0];
      resolverId = best.resolverId;
      sourceToPlay = best.source;

      console.log(`🎵 Selected ${resolverId} (priority #${best.priority + 1}, confidence: ${(best.confidence * 100).toFixed(0)}%)`);
    } else {
      // We were passed a specific source object - detect resolver from it
      // Check which resolver this source came from by examining resolver-specific fields
      if (trackOrSource.spotifyId) resolverId = 'spotify';
      else if (trackOrSource.appleMusicId) resolverId = 'applemusic';
      else if (trackOrSource.youtubeId) resolverId = 'youtube';
      else if (trackOrSource.bandcampUrl) resolverId = 'bandcamp';
      else if (trackOrSource.soundcloudId) resolverId = 'soundcloud';
      else if (trackOrSource.filePath || trackOrSource.fileUrl) resolverId = 'localfiles';
      // Fallback: use the 'source' property if set (added by search tagging)
      else if (trackOrSource.source && typeof trackOrSource.source === 'string') {
        resolverId = trackOrSource.source;
        console.log(`🎵 Using 'source' property as resolver: ${resolverId}`);
      }
      else {
        console.error('❌ Could not determine resolver for source');
        setTrackLoading(false); // Clear loading state
        return;
      }
    }

    const resolver = currentResolvers.find(r => r.id === resolverId);
    if (!resolver) {
      console.error(`❌ Resolver ${resolverId} not found`);
      console.error(`   Available resolvers:`, currentResolvers.map(r => r.id));
      setTrackLoading(false); // Clear loading state
      return;
    }

    // YouTube embedding is blocked in Electron, use resolver's play method instead
    // (which opens in external browser)

    // Handle local file playback directly with HTML5 Audio
    if (resolverId === 'localfiles') {
      console.log('🎵 Playing local file:', sourceToPlay.filePath || sourceToPlay.fileUrl);
      console.log('🎵 Source details:', JSON.stringify(sourceToPlay, null, 2));

      // A deleted file reaches the audio element as a 404, which Chromium
      // reports as "source not supported", so the user was told the file
      // could not be decoded (#1002). Check first: a missing file falls back
      // to the track's other sources, or says plainly that it is gone.
      const localPath = sourceToPlay.filePath;
      if (localPath && window.electron?.localFiles?.fileStatus) {
        const fileStatus = await window.electron.localFiles.fileStatus(localPath).catch(() => 'unknown');
        if (playbackGenerationRef.current !== thisGeneration) return;
        if (fileStatus === 'missing') {
          console.warn('🎵 Local file is no longer on disk:', localPath);
          forgetMissingLocalFile(localPath);
          const others = trackOrSource.sources
            ? Object.keys(trackOrSource.sources).filter(id => id !== 'localfiles' && !trackOrSource.sources[id]?.noMatch)
            : [];
          if (others.length > 0) {
            handlePlay({
              ...trackOrSource,
              sources: Object.fromEntries(Object.entries(trackOrSource.sources).filter(([id]) => id !== 'localfiles'))
            });
            return;
          }
          setTrackLoading(false);
          if (autoSkipIfAdvancing(`local file missing: ${localPath}`)) return;
          showConfirmDialog({
            type: 'error',
            title: 'File Not Found',
            message: `This file is no longer on disk, so it can't be played:\n${localPath}`
          });
          return;
        }
      }

      // Stop Spotify polling when switching to local file playback
      if (playbackPollerRef.current) {
        console.log('⏹️ Stopping Spotify polling for local file playback');
        clearInterval(playbackPollerRef.current);
        playbackPollerRef.current = null;
      }
      if (pollingRecoveryRef.current) {
        clearInterval(pollingRecoveryRef.current);
        pollingRecoveryRef.current = null;
      }
      // Also stop main process polling
      if (window.electron?.spotify?.polling) {
        window.electron.spotify.polling.stop();
      }

      // Stop Apple Music preview audio if playing
      if (window._appleMusicPreviewAudio) {
        window._appleMusicPreviewAudio.pause();
        window._appleMusicPreviewAudio.currentTime = 0;
      }

      // Stop native MusicKit if playing
      if (window.electron?.musicKit?.pause) {
        window.electron.musicKit.pause().catch(() => {});
      }

      // Pause Spotify if it's playing
      if (spotifyToken && streamingPlaybackActiveRef.current) {
        console.log('⏹️ Pausing Spotify for local file playback');
        fetch('https://api.spotify.com/v1/me/player/pause', {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${spotifyToken}` }
        }).catch(e => console.error('Failed to pause Spotify:', e));
        streamingPlaybackActiveRef.current = false;
      }

      ensureSharedAudioElement(trackOrSource);
      // Store the track for potential fallback handling
      localFilePlaybackTrackRef.current = trackOrSource;
      localFileFallbackInProgressRef.current = false;

      // Use custom local-audio:// protocol for secure local file playback.
      // Encode the path (localAudioUrlFromPath) so '#', '?', and '%' in
      // filenames aren't eaten by the media element's URL parser — a standard
      // scheme, which seeks require, treats those as delimiters.
      const filePath = sourceToPlay.filePath || sourceToPlay.fileUrl?.replace('file://', '');
      const audioUrl = window.localAudioUrlFromPath
        ? window.localAudioUrlFromPath(filePath)
        : `local-audio://${filePath}`;
      localFileNetworkRetryRef.current = 0;
      localFileSeekTargetRef.current = null;
      localFileRetryCommitRef.current = null;
      console.log('🎵 Audio URL:', audioUrl);
      audioRef.current.src = audioUrl;
      // Apply normalized volume for local files (respect mute state)
      const volumeToApply = isMutedRef.current ? 0 : volumeRef.current;
      const effectiveVolume = getEffectiveVolume(volumeToApply, 'localfiles', sourceToPlay.id || trackOrSource.id);
      audioRef.current.volume = effectiveVolume / 100;
      console.log(`🔊 Applied volume: ${volumeToApply}% -> ${effectiveVolume.toFixed(1)}% (offset: ${resolverVolumeOffsets.localfiles || 0}dB)${isMutedRef.current ? ' [MUTED]' : ''}`);

      // Explicitly load to trigger metadata events
      audioRef.current.load();

      // Post-play state commit. Also run by the audio error listener when a
      // MEDIA_ERR_NETWORK retry succeeds (localFileRetryCommitRef), so a track
      // that only starts on the second attempt still gets currentTrack /
      // isPlaying / scrobbling.
      const commitLocalPlayback = () => {

        // Set current track state
        // Duration from local files is already in seconds
        const duration = playbackDurationSeconds(sourceToPlay, trackOrSource);
        console.log('🎵 Track duration from source:', duration, 'sourceToPlay.duration:', sourceToPlay.duration, 'trackOrSource.duration:', trackOrSource.duration);
        const trackToSet = trackOrSource.sources ? {
          ...sourceToPlay,
          id: trackOrSource.id,
          artist: trackOrSource.artist,
          title: trackOrSource.title,
          album: trackOrSource.album,
          duration: duration,
          albumArt: getCachedAlbumArt(trackOrSource.artist, trackOrSource.album) || sourceToPlay.albumArt || trackOrSource.albumArt,
          sources: trackOrSource.sources,
          _playbackContext: trackOrSource._playbackContext, // Preserve playback context
          _activeResolver: resolverId // Track which resolver is actually playing
        } : { ...sourceToPlay, _playbackContext: trackOrSource._playbackContext, _activeResolver: resolverId };

        setCurrentTrack(trackToSet);
        setIsPlaying(true);
        setProgress(0);
        setTrackLoading(false); // Clear loading state
        streamingPlaybackActiveRef.current = false;
        setBrowserPlaybackActive(false);
        setIsExternalPlayback(false);
        // Clear explicit start flag since we're playing a new track
        trackNeedsExplicitStart.current = false;

        console.log('✅ Local file playing');

        // Notify scrobble manager of track start
        if (window.scrobbleManager) {
          window.scrobbleManager.onTrackStart(trackToSet);
        }

        // If audio element has duration now, update the track
        const audioDuration = audioRef.current?.duration;
        if (audioDuration && !isNaN(audioDuration) && isFinite(audioDuration) && audioDuration > 0) {
          console.log('🎵 Setting duration from audio element:', audioDuration);
          setCurrentTrack(prev => prev ? { ...prev, duration: audioDuration } : prev);
        }

        // Revalidate artwork for local files missing album art at playback time
        // Fast path: use releaseMbid from MBID enrichment to fetch from Cover Art Archive
        // Fallback: full getAlbumArt() flow (MusicBrainz search -> CAA -> resolvers)
        if (!trackToSet.albumArt && trackToSet.artist && trackToSet.album) {
          const myGen = thisGeneration;
          (async () => {
            try {
              // First try MBID fast path - enrich if needed, then fetch art via releaseMbid
              let artUrl = null;
              if (!trackToSet.releaseMbid && !trackToSet.mbid) {
                await enrichTrackWithMbid(trackToSet);
              }
              if (trackToSet.releaseMbid) {
                artUrl = await fetchArtworkViaMbid(trackToSet);
              }
              // Fallback to full getAlbumArt flow if MBID path didn't yield art
              if (!artUrl) {
                artUrl = await getAlbumArt(trackToSet.artist, trackToSet.album);
              }
              if (artUrl && playbackGenerationRef.current === myGen) {
                setCurrentTrack(prev => {
                  if (prev && prev.artist === trackToSet.artist && prev.title === trackToSet.title && !prev.albumArt) {
                    return { ...prev, albumArt: artUrl };
                  }
                  return prev;
                });
              }
            } catch (_e) {
              // Artwork revalidation is non-critical
            }
          })();
        }
      };

      try {
        await audioRef.current.play();
        commitLocalPlayback();
      } catch (error) {
        console.error('❌ Local file playback failed:', error);

        // Network errors are owned by the audio element's error listener,
        // which retries a stalled mount before showing a dialog. Falling
        // through here would also pop a dialog (or abandon the local file
        // for another resolver) for a blip the retry can absorb.
        if (audioRef.current?.error?.code === MediaError.MEDIA_ERR_NETWORK) {
          // The listener commits the track state if its retry succeeds; if
          // the retry is spent too, it falls back to another source or
          // shows the dialog.
          localFileRetryCommitRef.current = commitLocalPlayback;
          setTrackLoading(false);
          return;
        }

        // Try fallback to next available source if we have the original track with sources
        if (trackOrSource.sources && Object.keys(trackOrSource.sources).filter(id => !trackOrSource.sources[id]?.noMatch).length > 1) {
          const otherSources = Object.keys(trackOrSource.sources).filter(id => id !== 'localfiles' && !trackOrSource.sources[id]?.noMatch);
          if (otherSources.length > 0) {
            console.log('🔄 Falling back to next available source...');
            // Set flag to prevent error event listener from showing duplicate dialog
            localFileFallbackInProgressRef.current = true;
            // Create a modified track without localfiles source to trigger fallback
            const fallbackTrack = {
              ...trackOrSource,
              sources: Object.fromEntries(
                Object.entries(trackOrSource.sources).filter(([id]) => id !== 'localfiles')
              )
            };
            handlePlay(fallbackTrack);
            return;
          }
        }

        localFileFallbackInProgressRef.current = false;
        setTrackLoading(false); // Clear loading state on error

        // Provide helpful error message based on error type
        let errorMessage = 'Could not play this file: ' + error.message;
        if (error.name === 'NotSupportedError' || error.message?.includes('no supported source')) {
          const filePath = sourceToPlay.filePath || sourceToPlay.fileUrl || '';
          const ext = filePath.split('.').pop()?.toLowerCase();
          errorMessage = unsupportedAudioMessage(ext);
        }

        if (autoSkipIfAdvancing(`local file playback: ${errorMessage}`)) return;
        showConfirmDialog({
          type: 'error',
          title: 'Playback Error',
          message: errorMessage
        });
      }
      return;
    }

    // Handle SoundCloud playback with HTML5 Audio (stream from API)
    if (resolverId === 'soundcloud') {
      console.log('🎵 Playing SoundCloud track:', sourceToPlay.title);
      console.log('🎵 SoundCloud source details:', { soundcloudId: sourceToPlay.soundcloudId, streamable: sourceToPlay.streamable });

      // Stop Spotify polling when switching to SoundCloud playback
      if (playbackPollerRef.current) {
        console.log('⏹️ Stopping Spotify polling for SoundCloud playback');
        clearInterval(playbackPollerRef.current);
        playbackPollerRef.current = null;
      }
      if (pollingRecoveryRef.current) {
        clearInterval(pollingRecoveryRef.current);
        pollingRecoveryRef.current = null;
      }
      // Also stop main process polling
      if (window.electron?.spotify?.polling) {
        window.electron.spotify.polling.stop();
      }

      // Stop Apple Music preview audio if playing
      if (window._appleMusicPreviewAudio) {
        window._appleMusicPreviewAudio.pause();
        window._appleMusicPreviewAudio.currentTime = 0;
      }

      // Stop native MusicKit if playing
      if (window.electron?.musicKit?.pause) {
        window.electron.musicKit.pause().catch(() => {});
      }

      // Pause Spotify if it's playing
      if (spotifyToken && streamingPlaybackActiveRef.current) {
        console.log('⏹️ Pausing Spotify for SoundCloud playback');
        try {
          await fetch('https://api.spotify.com/v1/me/player/pause', {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${spotifyToken}` }
          });
        } catch (e) {
          console.log('Could not pause Spotify:', e.message);
        }
      }

      // Get the OAuth token
      const config = await getResolverConfig('soundcloud');
      if (!config.token) {
        console.error('❌ SoundCloud not authenticated');
        if (autoSkipIfAdvancing('SoundCloud not authenticated')) return;
        setTrackLoading(false);
        showConfirmDialog({
          type: 'error',
          title: 'SoundCloud Not Connected',
          message: 'Please connect your SoundCloud account in Settings > Resolvers to play this track.'
        });
        return;
      }

      // Get stream URL from SoundCloud API
      try {
        // Try the direct /stream endpoint first (older API, more compatible)
        // This endpoint returns a redirect to the actual MP3 stream
        const directStreamUrl = `https://api.soundcloud.com/tracks/${sourceToPlay.soundcloudId}/stream?oauth_token=${config.token}`;
        console.log('🎵 Trying direct stream URL');

        // Test if the direct stream works by making a HEAD request
        let streamUrl = directStreamUrl;
        try {
          const testResponse = await fetch(directStreamUrl, { method: 'HEAD' });
          if (!testResponse.ok) {
            const directStatus = testResponse.status;
            if (directStatus === 429 || directStatus === 401 || directStatus === 403) {
              console.error('🎵 SoundCloud API rejected direct stream:', directStatus);
            }
            console.log('🎵 Direct stream not available, trying /streams endpoint');
            // Fall back to /streams endpoint
            const streamsResponse = await fetch(`https://api.soundcloud.com/tracks/${sourceToPlay.soundcloudId}/streams`, {
              headers: { 'Authorization': `OAuth ${config.token}` }
            });

            if (streamsResponse.ok) {
              const streams = await streamsResponse.json();
              console.log('🎵 Streams response keys:', Object.keys(streams));
              // Log available stream URLs for debugging
              if (streams.http_mp3_128_url) console.log('🎵 http_mp3_128_url available');
              if (streams.hls_mp3_128_url) console.log('🎵 hls_mp3_128_url available (HLS - not compatible)');
              if (streams.preview_mp3_128_url) console.log('🎵 preview_mp3_128_url available');

              // Prefer HTTP MP3 (direct stream) over HLS or preview
              // These URLs are pre-signed and should NOT have additional auth appended
              streamUrl = streams.http_mp3_128_url || streams.preview_mp3_128_url;
              if (streamUrl) {
                console.log('🎵 Using stream URL (pre-signed, no token needed)');
              }
            } else if (directStatus === 429 || directStatus === 401 || directStatus === 403) {
              // Only show credential error toast if the fallback also failed
              showToast('SoundCloud API credentials may be invalid or rate limited. Try adding your own in Settings.', 'error');
            }
          }
        } catch (testError) {
          console.log('🎵 Stream test failed, using direct URL anyway:', testError.message);
        }

        if (!streamUrl) {
          console.error('❌ No stream URL available for this track');
          // Fall back to opening in browser
          if (sourceToPlay.soundcloudUrl) {
            console.log('📱 Falling back to browser playback');
            if (window.electron?.shell?.openExternal) {
              await window.electron.shell.openExternal(sourceToPlay.soundcloudUrl);
            }
          }
          setTrackLoading(false);
          return;
        }

        console.log('🎵 Using SoundCloud stream URL');

        // Clean up any previous blob URL to prevent memory leaks
        if (audioBlobUrlRef.current) {
          URL.revokeObjectURL(audioBlobUrlRef.current);
          audioBlobUrlRef.current = null;
        }

        // Fetch the audio through Electron's proxy to handle CORS and auth headers
        // HTML5 Audio can't send Authorization headers, so we need to fetch the data
        // and create a blob URL that the Audio element can play
        let blobUrl;
        try {
          console.log('🎵 Fetching audio through proxy...');

          // Use proxyFetch to get the audio with proper headers
          // For the /stream endpoint, pass oauth_token in query
          // For pre-signed URLs from /streams, no additional auth needed
          const fetchOptions = {
            responseType: 'arraybuffer' // Get binary data for audio
          };

          // If using the direct stream endpoint, we need the token
          // Pre-signed URLs already have auth built in
          if (streamUrl.includes('oauth_token=')) {
            // Direct stream URL with token in query - should work
            console.log('🎵 Stream URL has token in query');
          } else if (streamUrl.includes('api.soundcloud.com')) {
            // API URL needs Authorization header
            fetchOptions.headers = { 'Authorization': `OAuth ${config.token}` };
            console.log('🎵 Adding OAuth header for API URL');
          } else {
            // Pre-signed CDN URL - may need OAuth header anyway
            fetchOptions.headers = { 'Authorization': `OAuth ${config.token}` };
            console.log('🎵 Adding OAuth header for CDN URL');
          }

          const audioResponse = await window.electron.proxyFetch(streamUrl, fetchOptions);

          // Check if another play request superseded this one during fetch
          if (playbackGenerationRef.current !== thisGeneration) {
            console.log('⏹️ Playback request superseded during SoundCloud fetch, aborting');
            return;
          }

          if (audioResponse.error) {
            throw new Error(`Proxy fetch failed: ${audioResponse.error}`);
          }

          // audioResponse.data is base64-encoded when responseType is arraybuffer
          // Convert base64 to ArrayBuffer
          let audioData;
          if (audioResponse.data) {
            // Decode base64 to binary
            const binaryString = atob(audioResponse.data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            audioData = bytes.buffer;
          } else {
            throw new Error('No audio data received');
          }

          // Create blob URL from the audio data
          const blob = new Blob([audioData], { type: 'audio/mpeg' });
          blobUrl = URL.createObjectURL(blob);
          audioBlobUrlRef.current = blobUrl; // Store for cleanup
          console.log('🎵 Created blob URL for audio playback');
        } catch (proxyError) {
          console.error('🎵 Proxy fetch failed:', proxyError);
          // Fall back to opening in browser
          if (sourceToPlay.soundcloudUrl) {
            console.log('📱 Falling back to browser playback');
            if (window.electron?.shell?.openExternal) {
              await window.electron.shell.openExternal(sourceToPlay.soundcloudUrl);
            }
          }
          setTrackLoading(false);
          return;
        }

        ensureSharedAudioElement(trackOrSource);
        // Use HTML5 Audio to play the blob URL (pre-fetched with auth headers)
        audioRef.current.src = blobUrl;
        const volumeToApply = isMutedRef.current ? 0 : volumeRef.current;
        const effectiveVolume = getEffectiveVolume(volumeToApply, 'soundcloud', sourceToPlay.id || trackOrSource.id);
        audioRef.current.volume = effectiveVolume / 100;
        console.log(`🔊 Applied SoundCloud volume: ${volumeToApply}% -> ${effectiveVolume.toFixed(1)}%${isMutedRef.current ? ' [MUTED]' : ''}`);

        audioRef.current.load();

        await audioRef.current.play();

        // Set current track state
        const duration = playbackDurationSeconds(sourceToPlay, trackOrSource);
        const trackToSet = trackOrSource.sources ? {
          ...sourceToPlay,
          id: trackOrSource.id,
          artist: trackOrSource.artist,
          title: trackOrSource.title,
          album: trackOrSource.album,
          duration: duration,
          albumArt: getCachedAlbumArt(trackOrSource.artist, trackOrSource.album) || sourceToPlay.albumArt || trackOrSource.albumArt,
          sources: trackOrSource.sources,
          _playbackContext: trackOrSource._playbackContext,
          _activeResolver: resolverId
        } : { ...sourceToPlay, _playbackContext: trackOrSource._playbackContext, _activeResolver: resolverId };

        setCurrentTrack(trackToSet);
        setIsPlaying(true);
        setProgress(0);
        setTrackLoading(false);
        streamingPlaybackActiveRef.current = false;
        setBrowserPlaybackActive(false);
        setIsExternalPlayback(false);
        trackNeedsExplicitStart.current = false;

        console.log('✅ SoundCloud playing via HTML5 Audio');

        // Notify scrobble manager of track start
        if (window.scrobbleManager) {
          window.scrobbleManager.onTrackStart(trackToSet);
        }
      } catch (error) {
        console.error('❌ SoundCloud playback error:', error);
        if (autoSkipIfAdvancing(`SoundCloud playback: ${error.message}`)) return;
        setTrackLoading(false);
        showConfirmDialog({
          type: 'error',
          title: 'Playback Error',
          message: 'Failed to play SoundCloud track: ' + error.message
        });
      }
      return;
    }

    // Subsonic: stream directly from the user's self-hosted server through the
    // shared HTML5 audio element (the same engine local files and SoundCloud
    // use, so progress / seek / auto-advance / scrobbling all come from the
    // element's listeners). Auth rides in the query string (u/t/s token auth,
    // built by the resolver's getStreamUrl), so no proxy or blob hop is
    // needed — the media element fetches cross-origin without CORS and the
    // server supports Range requests, so seeking works natively.
    // HTML5 stream resolvers (capabilities.html5Stream: Subsonic, or any
    // self-hosted server): the .axe's getStreamUrl builds a direct stream URL
    // from the saved config (never from the track) and the shared element
    // fetches it cross-origin with Range support. The host does not name them.
    if (isHtml5StreamResolver(resolverId)) {
      const streamLabel = resolver.name || resolverId;
      console.log(`📡 Playing ${streamLabel} track:`, sourceToPlay.title);

      // Stop Spotify polling when switching to Subsonic playback
      if (playbackPollerRef.current) {
        clearInterval(playbackPollerRef.current);
        playbackPollerRef.current = null;
      }
      if (pollingRecoveryRef.current) {
        clearInterval(pollingRecoveryRef.current);
        pollingRecoveryRef.current = null;
      }
      if (window.electron?.spotify?.polling) {
        window.electron.spotify.polling.stop();
      }

      // Stop Apple Music preview audio if playing
      if (window._appleMusicPreviewAudio) {
        window._appleMusicPreviewAudio.pause();
        window._appleMusicPreviewAudio.currentTime = 0;
      }

      // Stop native MusicKit if playing
      if (window.electron?.musicKit?.pause) {
        window.electron.musicKit.pause().catch(() => {});
      }

      // Pause Spotify if it's playing
      if (spotifyToken && streamingPlaybackActiveRef.current) {
        console.log('⏹️ Pausing Spotify for Subsonic playback');
        try {
          await fetch('https://api.spotify.com/v1/me/player/pause', {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${spotifyToken}` }
          });
        } catch (e) {
          console.log('Could not pause Spotify:', e.message);
        }
      }

      const config = await getResolverConfig(resolverId);
      let streamUrl = null;
      try {
        streamUrl = resolver.getStreamUrl
          ? await resolver.getStreamUrl(sourceToPlay, config)
          : null;
      } catch (e) {
        console.warn(`📡 ${streamLabel} getStreamUrl failed:`, e?.message || e);
      }
      // A baked stream URL is a replayable token. Never use one, and drop any
      // an older Subsonic resolve stored on this track before it is saved
      // again (a no-op for every other resolver's records).
      dropSubsonicSecrets(sourceToPlay);
      dropSubsonicSecrets(trackOrSource);
      if (trackOrSource.sources) dropSubsonicSecrets(trackOrSource.sources.subsonic);

      // Check if another play request superseded this one while building the URL
      if (playbackGenerationRef.current !== thisGeneration) {
        console.log('⏹️ Playback request superseded during Subsonic URL build, aborting');
        return;
      }

      if (!streamUrl) {
        console.error(`❌ No ${streamLabel} stream URL available`);
        if (autoSkipIfAdvancing(`${streamLabel}: no stream URL (check its settings in Settings > Resolvers)`)) return;
        setTrackLoading(false);
        showConfirmDialog({
          type: 'error',
          title: `${streamLabel} Not Configured`,
          message: `Could not get a stream URL from ${streamLabel}. Check its settings in Settings > Resolvers (server reachable, signed in, library selected) and try again.`
        });
        return;
      }

      try {
        // Tag which stream resolver owns the element: both play http(s) URLs,
        // so the element's src alone cannot tell them apart for error dialogs.
        ensureSharedAudioElement({ ...trackOrSource, _streamOwner: resolverId });
        audioRef.current.src = streamUrl;
        const volumeToApply = isMutedRef.current ? 0 : volumeRef.current;
        const effectiveVolume = getEffectiveVolume(volumeToApply, resolverId, sourceToPlay.id || trackOrSource.id);
        audioRef.current.volume = effectiveVolume / 100;
        console.log(`🔊 Applied ${streamLabel} volume: ${volumeToApply}% -> ${effectiveVolume.toFixed(1)}%${isMutedRef.current ? ' [MUTED]' : ''}`);

        audioRef.current.load();

        await audioRef.current.play();

        // Check if another play request superseded this one while the stream was starting
        if (playbackGenerationRef.current !== thisGeneration) {
          console.log('⏹️ Playback request superseded during Subsonic start, aborting');
          return;
        }

        const duration = sourceToPlay.duration || trackOrSource.duration || 0;
        const trackToSet = trackOrSource.sources ? {
          ...sourceToPlay,
          id: trackOrSource.id,
          artist: trackOrSource.artist,
          title: trackOrSource.title,
          album: trackOrSource.album,
          duration: duration,
          albumArt: getCachedAlbumArt(trackOrSource.artist, trackOrSource.album) || sourceToPlay.albumArt || trackOrSource.albumArt,
          sources: trackOrSource.sources,
          _playbackContext: trackOrSource._playbackContext,
          _activeResolver: resolverId
        } : { ...sourceToPlay, duration: duration, _playbackContext: trackOrSource._playbackContext, _activeResolver: resolverId };

        setCurrentTrack(trackToSet);
        setIsPlaying(true);
        setProgress(0);
        setTrackLoading(false);
        streamingPlaybackActiveRef.current = false;
        setBrowserPlaybackActive(false);
        setIsExternalPlayback(false);
        trackNeedsExplicitStart.current = false;

        console.log(`✅ ${streamLabel} playing via HTML5 Audio`);

        // Notify scrobble manager of track start
        if (window.scrobbleManager) {
          window.scrobbleManager.onTrackStart(trackToSet);
        }
      } catch (error) {
        console.error(`❌ ${streamLabel} playback error:`, error);
        // A failed load rejects play() AND fires the element's 'error' event.
        // The error listener owns that UX (auto-skip in advance contexts,
        // dialog otherwise) — don't double-handle it here or auto-advance
        // fires twice.
        if (audioRef.current?.error) {
          setTrackLoading(false);
          return;
        }
        if (autoSkipIfAdvancing(`${streamLabel} playback: ${error.message}`)) return;
        setTrackLoading(false);
        showConfirmDialog({
          type: 'error',
          title: 'Playback Error',
          message: `Failed to play this ${streamLabel} track: ` + error.message
        });
      }
      return;
    }

    // Check if resolver can stream
    if (!resolver.capabilities.stream) {
      // For non-streaming resolvers (Bandcamp, YouTube), show prompt first
      console.log('🌐 External browser track detected, showing prompt...');
      streamingPlaybackActiveRef.current = false; // Allow browser events for external playback

      // Stop all local audio sources before switching to browser playback
      stopAllLocalAudio();

      // Stop MusicKit when switching to external browser playback
      if (window.electron?.musicKit?.pause) {
        window.electron.musicKit.pause().catch(() => {});
      }
      if (window.getMusicKitWeb) {
        try {
          const musicKitWeb = window.getMusicKitWeb();
          if (musicKitWeb?.stop) {
            musicKitWeb.stop().catch(() => {});
          }
        } catch (_e) {
          // Ignore errors
        }
      }

      // Stop Spotify polling when switching to external browser playback
      if (playbackPollerRef.current) {
        console.log('⏹️ Stopping Spotify polling for external browser playback');
        clearInterval(playbackPollerRef.current);
        playbackPollerRef.current = null;
      }
      if (pollingRecoveryRef.current) {
        clearInterval(pollingRecoveryRef.current);
        pollingRecoveryRef.current = null;
      }
      // Also stop main process polling
      if (window.electron?.spotify?.polling) {
        window.electron.spotify.polling.stop();
      }
      // CRITICAL: Update currentTrack BEFORE showing prompt so handleNext() can find it in queue
      // Merge source with original track, explicitly preserving queue-essential properties
      const trackToSet = trackOrSource.sources ?
        {
          ...sourceToPlay,
          id: trackOrSource.id,  // MUST preserve queue ID
          artist: trackOrSource.artist,
          title: trackOrSource.title,
          album: trackOrSource.album,
          duration: playbackDurationSeconds(sourceToPlay, trackOrSource),
          albumArt: getCachedAlbumArt(trackOrSource.artist, trackOrSource.album) || sourceToPlay.albumArt || trackOrSource.albumArt,
          sources: trackOrSource.sources,
          _playbackContext: trackOrSource._playbackContext, // Preserve playback context
          _activeResolver: resolverId // Track which resolver is actually playing
        } :
        { ...sourceToPlay, duration: playbackDurationSeconds(sourceToPlay, trackOrSource), _playbackContext: trackOrSource._playbackContext, _activeResolver: resolverId };
      console.log(`🔍 trackToSet.id="${trackToSet.id}", trackOrSource.id="${trackOrSource.id}", sourceToPlay.id="${sourceToPlay.id}"`);
      setCurrentTrack(trackToSet);
      setTrackLoading(false); // Clear loading state when showing prompt
      // Clear explicit start flag since we're playing a new track
      trackNeedsExplicitStart.current = false;
      showExternalTrackPromptUI(trackToSet, resolverId);
      return; // Don't play yet, wait for user confirmation
    }

    // Use resolver's play method
    try {
      // Stop all local audio sources before switching to streaming resolver
      // This is a second safety check in case audio wasn't stopped earlier
      stopAllLocalAudio();

      // Stop MusicKit when switching to a non-Apple-Music streaming resolver
      // We do this explicitly here (not in stopAllLocalAudio) to avoid race conditions
      // when playing Apple Music tracks
      if (resolverId !== 'applemusic') {
        if (window.electron?.musicKit?.pause) {
          window.electron.musicKit.pause().catch(() => {});
        }
        if (window.getMusicKitWeb) {
          try {
            const musicKitWeb = window.getMusicKitWeb();
            if (musicKitWeb?.stop) {
              musicKitWeb.stop().catch(() => {});
            }
          } catch (_e) {
            // Ignore errors
          }
        }
      }

      const config = await getResolverConfig(resolverId);
      console.log(`▶️ Using ${resolver.name} to play track...`);

      if (resolverId === 'spotify') spotifyPlaySentRef.current = true;
      const success = await resolver.play(sourceToPlay, config);

      // Check if another play request superseded this one during play
      if (playbackGenerationRef.current !== thisGeneration) {
        console.log('⏹️ Playback request superseded during resolver.play(), aborting');
        // If we just started playback on a resolver, we need to stop it
        if (success && resolver.capabilities.stream) {
          if (resolverId === 'spotify' && spotifyToken) {
            fetch('https://api.spotify.com/v1/me/player/pause', {
              method: 'PUT',
              headers: { 'Authorization': `Bearer ${spotifyToken}` }
            }).catch(() => {});
          } else if (resolverId === 'applemusic' && window.electron?.musicKit) {
            window.electron.musicKit.pause().catch(() => {});
          } else if (resolverId === 'amazonmusic') {
            stopAmazonIfActive('⏹️ Stopping Amazon Music after superseded play');
          }
        }
        return;
      }

      if (success) {
        console.log(`✅ Playing on ${resolver.name}`);

        // Apply normalized volume for Spotify (respect mute state)
        if (resolverId === 'spotify') {
          const trackId = sourceToPlay.id || trackOrSource.id;
          const volumeToApply = isMutedRef.current ? 0 : volumeRef.current;
          const effectiveVolume = getEffectiveVolume(volumeToApply, 'spotify', trackId);
          console.log(`🔊 Applied Spotify volume: ${volumeToApply}% -> ${effectiveVolume.toFixed(1)}% (offset: ${resolverVolumeOffsets.spotify || 0}dB)${isMutedRef.current ? ' [MUTED]' : ''}`);
          setSpotifyVolume(volumeToApply, !isMutedRef.current); // Apply with normalization only if not muted
        }

        // Apply volume for Apple Music preview audio (native MusicKit uses system volume)
        if (resolverId === 'applemusic') {
          const volumeToApply = isMutedRef.current ? 0 : volumeRef.current;
          const trackId = sourceToPlay.id || trackOrSource.id;
          const effectiveVolume = getEffectiveVolume(volumeToApply, 'applemusic', trackId);
          if (window._appleMusicPreviewAudio) {
            window._appleMusicPreviewAudio.volume = effectiveVolume / 100;
          }
        }

        // Apply volume for Amazon Music (the app owns its own volume pipeline;
        // drive it to Parachord's effective volume like the Spotify volume API)
        if (resolverId === 'amazonmusic' && window.electron?.amazonMusic) {
          const volumeToApply = isMutedRef.current ? 0 : volumeRef.current;
          const trackId = sourceToPlay.id || trackOrSource.id;
          const effectiveVolume = getEffectiveVolume(volumeToApply, 'amazonmusic', trackId);
          console.log(`🔊 Applied Amazon Music volume: ${volumeToApply}% -> ${effectiveVolume.toFixed(1)}%${isMutedRef.current ? ' [MUTED]' : ''}`);
          window.electron.amazonMusic.setVolume(effectiveVolume / 100).catch(() => {});
        }

        // Reset browser playback state when playing via streaming resolver (Spotify, etc.)
        // This ensures we don't show "Playing in browser" for Spotify Connect playback
        if (resolver.capabilities.stream) {
          streamingPlaybackActiveRef.current = true; // Mark streaming active to ignore browser events
          setBrowserPlaybackActive(false);
          setIsExternalPlayback(false);
        }

        // Merge source with original track, explicitly preserving queue-essential properties
        const trackToSet = trackOrSource.sources ?
          {
            ...sourceToPlay,
            id: trackOrSource.id,  // MUST preserve queue ID
            artist: trackOrSource.artist,
            title: trackOrSource.title,
            album: trackOrSource.album,
            duration: playbackDurationSeconds(sourceToPlay, trackOrSource),
            albumArt: getCachedAlbumArt(trackOrSource.artist, trackOrSource.album) || sourceToPlay.albumArt || trackOrSource.albumArt,
            sources: trackOrSource.sources,
            _playbackContext: trackOrSource._playbackContext, // Preserve playback context
            _activeResolver: resolverId // Track which resolver is actually playing
          } :
          { ...sourceToPlay, duration: playbackDurationSeconds(sourceToPlay, trackOrSource), _playbackContext: trackOrSource._playbackContext, _activeResolver: resolverId };
        setCurrentTrack(trackToSet);
        setIsPlaying(true);
        setProgress(0);
        setTrackLoading(false); // Clear loading state on success
        // Clear explicit start flag since we're playing a new track
        trackNeedsExplicitStart.current = false;
        // Reset baseline for smooth progress interpolation
        spotifyProgressBaselineRef.current = { progress: 0, timestamp: Date.now(), isPlaying: true };
        // Reset Amazon Music interpolation baseline as well (resolverId !== 'spotify'
        // never reaches this line — spotify branch only; kept for symmetry below)

        // Notify scrobble manager of track start
        if (window.scrobbleManager) {
          window.scrobbleManager.onTrackStart(trackToSet);
        }

        if (audioContext) {
          setStartTime(audioContext.currentTime);
        }

        // Reset the Amazon Music progress baseline when we started that track
        if (resolverId === 'amazonmusic') {
          amazonMusicProgressBaselineRef.current = { progress: 0, timestamp: Date.now(), isPlaying: true };
        }
      }

      // Start auto-advance polling for streaming tracks
      if (resolver.capabilities.stream && success) {
        startAutoAdvancePolling(resolverId, { ...sourceToPlay, duration: playbackDurationSeconds(sourceToPlay, trackOrSource) }, config);
      }

      if (!success) {
        setTrackLoading(false); // Clear loading state on failure
        console.error(`❌ ${resolver.name} playback failed`);

        // For Spotify, retry once after a short delay (device may need to wake up)
        if (resolverId === 'spotify' && !sourceToPlay._spotifyRetried) {
          console.log('🔄 Spotify playback failed, retrying in 2 seconds...');
          await new Promise(resolve => setTimeout(resolve, 2000));

          // Check if superseded during retry delay
          if (playbackGenerationRef.current !== thisGeneration) {
            console.log('⏹️ Playback request superseded during Spotify retry delay, aborting');
            return;
          }

          // Mark as retried to prevent infinite loop
          const retrySource = { ...sourceToPlay, _spotifyRetried: true };
          const _retryTrack = trackOrSource.sources ? {
            ...trackOrSource,
            sources: { ...trackOrSource.sources, spotify: retrySource }
          } : retrySource;

          console.log('🔄 Retrying Spotify playback with fresh token...');
          // Clear config cache and get a fresh token for the retry
          delete resolverConfigCache.current['spotify'];
          const freshConfig = await getResolverConfig(resolverId);
          const retrySuccess = await resolver.play(retrySource, freshConfig);

          // Check if superseded during retry play
          if (playbackGenerationRef.current !== thisGeneration) {
            console.log('⏹️ Playback request superseded during Spotify retry, aborting');
            if (retrySuccess && spotifyToken) {
              fetch('https://api.spotify.com/v1/me/player/pause', {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${spotifyToken}` }
              }).catch(() => {});
            }
            return;
          }

          if (retrySuccess) {
            console.log('✅ Spotify retry successful');
            streamingPlaybackActiveRef.current = true;
            setBrowserPlaybackActive(false);
            setIsExternalPlayback(false);

            const trackToSet = trackOrSource.sources ? {
              ...sourceToPlay,
              id: trackOrSource.id,
              artist: trackOrSource.artist,
              title: trackOrSource.title,
              album: trackOrSource.album,
              duration: playbackDurationSeconds(sourceToPlay, trackOrSource),
              sources: trackOrSource.sources,
              _playbackContext: trackOrSource._playbackContext, // Preserve playback context
              _activeResolver: resolverId // Track which resolver is actually playing
            } : { ...sourceToPlay, duration: playbackDurationSeconds(sourceToPlay, trackOrSource), _playbackContext: trackOrSource._playbackContext, _activeResolver: resolverId };
            setCurrentTrack(trackToSet);
            setIsPlaying(true);
            setProgress(0);
            // Reset baseline for smooth progress interpolation
            spotifyProgressBaselineRef.current = { progress: 0, timestamp: Date.now(), isPlaying: true };

            // Notify scrobble manager of track start
            if (window.scrobbleManager) {
              window.scrobbleManager.onTrackStart(trackToSet);
            }

            if (audioContext) {
              setStartTime(audioContext.currentTime);
            }
            startAutoAdvancePolling(resolverId, { ...sourceToPlay, duration: playbackDurationSeconds(sourceToPlay, trackOrSource) }, config);
            return; // Success on retry, don't fall through to re-resolve
          }
          console.error('❌ Spotify retry also failed');

          // Spotify failed after retry - try to fall back to next best source
          if (trackOrSource.sources && Object.keys(trackOrSource.sources).filter(id => !trackOrSource.sources[id]?.noMatch).length > 1) {
            // Use refs for current resolver settings
            const fallbackActiveResolvers = activeResolversRef.current;
            const fallbackResolverOrder = resolverOrderRef.current;
            const otherSources = Object.keys(trackOrSource.sources).filter(id => id !== 'spotify' && !trackOrSource.sources[id]?.noMatch && fallbackActiveResolvers.includes(id));

            if (otherSources.length > 0) {
              // Sort by resolver priority
              const sortedFallbacks = otherSources
                .map(resId => ({
                  resolverId: resId,
                  source: trackOrSource.sources[resId],
                  priority: fallbackResolverOrder.indexOf(resId)
                }))
                .sort((a, b) => a.priority - b.priority);

              const fallback = sortedFallbacks[0];
              const fallbackResolver = currentResolvers.find(r => r.id === fallback.resolverId);

              console.log(`🔄 Spotify unavailable, falling back to ${fallbackResolver?.name || fallback.resolverId}`);

              // Show toast with option to retry Spotify (e.g., after opening app)
              showToast(
                `Spotify device unavailable. Playing via ${fallbackResolver?.name || fallback.resolverId}.`,
                'info',
                {
                  label: 'Open Spotify',
                  onClick: wakeSpotifyApp
                }
              );

              // Create fallback track without spotify source to prevent loop
              const fallbackTrack = {
                ...trackOrSource,
                sources: Object.fromEntries(
                  Object.entries(trackOrSource.sources).filter(([id]) => id !== 'spotify')
                ),
                _spotifyFallback: true // Mark that we fell back from Spotify
              };

              // Play via the fallback source
              handlePlay(fallbackTrack);
              return;
            }
          }
        }

        // For Apple Music, fall back to next best source (track may not be available in region)
        if (resolverId === 'applemusic' && !trackOrSource._appleMusicFallback) {
          if (trackOrSource.sources && Object.keys(trackOrSource.sources).filter(id => !trackOrSource.sources[id]?.noMatch).length > 1) {
            // Use refs for current resolver settings
            const fallbackActiveResolvers = activeResolversRef.current;
            const fallbackResolverOrder = resolverOrderRef.current;
            const otherSources = Object.keys(trackOrSource.sources).filter(id => id !== 'applemusic' && !trackOrSource.sources[id]?.noMatch && fallbackActiveResolvers.includes(id));

            if (otherSources.length > 0) {
              // Sort by resolver priority
              const sortedFallbacks = otherSources
                .map(resId => ({
                  resolverId: resId,
                  source: trackOrSource.sources[resId],
                  priority: fallbackResolverOrder.indexOf(resId)
                }))
                .sort((a, b) => a.priority - b.priority);

              const fallback = sortedFallbacks[0];
              const fallbackResolver = currentResolvers.find(r => r.id === fallback.resolverId);

              console.log(`🔄 Apple Music unavailable for this track, falling back to ${fallbackResolver?.name || fallback.resolverId}`);

              showToast(
                `Track not available on Apple Music. Playing via ${fallbackResolver?.name || fallback.resolverId}.`,
                'info'
              );

              // Create fallback track without applemusic source to prevent loop
              const fallbackTrack = {
                ...trackOrSource,
                sources: Object.fromEntries(
                  Object.entries(trackOrSource.sources).filter(([id]) => id !== 'applemusic')
                ),
                _appleMusicFallback: true // Mark that we fell back from Apple Music
              };

              // Play via the fallback source
              handlePlay(fallbackTrack);
              return;
            }
          }
        }

        // No fallback available or non-Spotify/Apple Music failure - show re-resolve dialog
        if (!trackOrSource._spotifyFallback && !trackOrSource._appleMusicFallback && sourceToPlay.artist && sourceToPlay.title) {
          console.log('🔄 Attempting to re-resolve track with fresh sources...');
          const artistName = sourceToPlay.artist;
          const trackData = { position: sourceToPlay.position || 1, title: sourceToPlay.title, length: sourceToPlay.duration };

          // Force refresh to bypass cache
          await resolveTrack(trackData, artistName, { forceRefresh: true });

          if (autoSkipIfAdvancing('playback failed; re-resolved in background')) return;
          // Name the resolver: a bare "Playback failed" gave no clue which
          // source refused the track (a resolver author read it as a Parachord
          // bug while his own play() was returning false).
          showConfirmDialog({
            type: 'info',
            title: 'Track Re-resolved',
            message: `Playback via ${resolver.name} failed, so the track has been re-resolved with fresh sources. Try playing it again.\n\nIf it keeps failing, the developer console (View > Toggle Developer Tools) shows what ${resolver.name} reported.`
          });
        }
      }
    } catch (error) {
      console.error(`❌ Error playing with ${resolver.name}:`, error);
      setTrackLoading(false); // Clear loading state on error

      // On error, also try to re-resolve. This path used to be silent: the
      // spinner cleared and nothing happened. Say what failed, same as the
      // play()-returned-false path above, and respect auto-advance.
      if (sourceToPlay.artist && sourceToPlay.title) {
        console.log('🔄 Playback error - attempting to re-resolve...');
        const artistName = sourceToPlay.artist;
        const trackData = { position: sourceToPlay.position || 1, title: sourceToPlay.title, length: sourceToPlay.duration };
        await resolveTrack(trackData, artistName, { forceRefresh: true });
        if (autoSkipIfAdvancing('playback error; re-resolved in background')) return;
        showConfirmDialog({
          type: 'error',
          title: 'Track Re-resolved',
          message: `Playback via ${resolver.name} hit an error (${error?.message || error}), so the track has been re-resolved with fresh sources. Try playing it again.`
        });
      }
    }
  };

  const handleNext = async (userInitiated = false) => {
    // BROWSER PLAYBACK GUARD: Block handleNext while waiting for browser to connect
    // This prevents race conditions when opening external tracks (YouTube, Bandcamp, etc.)
    if (waitingForBrowserPlaybackRef.current) {
      console.log('⏳ handleNext() blocked - waiting for browser playback to connect');
      return;
    }

    // RE-ENTRANCY GUARD: Prevent multiple simultaneous handleNext() calls
    // This can happen when events fire in rapid succession (e.g., tab close + ended event)
    if (isAdvancingTrackRef.current) {
      console.log('⚠️ handleNext() already in progress, skipping duplicate call');
      return;
    }

    // If user manually clicked next while listening along, end the session
    let listenAlongEnded = false;
    const listenAlongFriendNow = listenAlongFriendRef.current;
    if (userInitiated && listenAlongFriendNow) {
      console.log(`🎧 User skipped track - ending listen-along with ${listenAlongFriendNow.displayName}`);
      showToast(`Stopped listening along with ${listenAlongFriendNow.displayName}`);
      // Abort and cleanup pool context
      abortSchedulerContext('listen-along');
      setListenAlongFriend(null);
      listenAlongLastTrackRef.current = null;
      listenAlongPendingTrackRef.current = null;
      listenAlongUserPausedRef.current = false;
      setPlaybackContext(null);
      listenAlongEnded = true;
      // Fall through to play from queue
    }
    isAdvancingTrackRef.current = true;

    try {
      // FIRST: Clean up any active polling to prevent race conditions
      // This must happen BEFORE any async operations to prevent duplicate handleNext calls
      if (playbackPollerRef.current) {
        clearInterval(playbackPollerRef.current);
        playbackPollerRef.current = null;
      }
      if (pollingRecoveryRef.current) {
        clearInterval(pollingRecoveryRef.current);
        pollingRecoveryRef.current = null;
      }
      // Also stop main process polling (both Spotify and Apple Music)
      if (window.electron?.spotify?.polling) {
        window.electron.spotify.polling.stop();
      }
      if (window.electron?.musicKit?.polling) {
        window.electron.musicKit.polling.stop().catch(() => {});
      }
      stopAmazonIfActive('⏹️ Stopping Amazon Music before next track');

      // Stop all local audio sources (HTML5 Audio for local files/SoundCloud)
      // Always stop regardless of paused state to handle edge cases and prevent overlap
      stopAllLocalAudio();

      // Notify scrobble manager that current track is ending
      if (window.scrobbleManager) {
        window.scrobbleManager.onTrackEnd();
      }

      // ALWAYS stop all streaming playback sources unconditionally to prevent overlap
      // This handles race conditions during async track loading

      // Pause Spotify only if Parachord's current playback is on it (see handlePlay)
      if (spotifyToken && (currentTrackRef.current?._activeResolver === 'spotify' || spotifyPlaySentRef.current)) {
        spotifyPlaySentRef.current = false;
        console.log('⏹️ Pausing Spotify before next track');
        fetch('https://api.spotify.com/v1/me/player/pause', {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${spotifyToken}` }
        }).catch(() => {}); // Silently ignore
      }

      // Always pause Apple Music native playback
      if (window.electron?.musicKit) {
        console.log('⏹️ Pausing Apple Music (native) before next track');
        window.electron.musicKit.pause().catch(() => {}); // Silently ignore
      }

      // Always pause Apple Music web playback (MusicKit JS)
      const musicKitWebNext = window.getMusicKitWeb ? window.getMusicKitWeb() : null;
      if (musicKitWebNext) {
        try {
          console.log('⏹️ Pausing Apple Music (web) before next track');
          musicKitWebNext.pause();
        } catch (_e) {} // Silently ignore
      }

      // Always stop Apple Music preview audio if it exists
      if (window._appleMusicPreviewAudio) {
        console.log('⏹️ Stopping Apple Music preview audio');
        window._appleMusicPreviewAudio.pause();
        window._appleMusicPreviewAudio.currentTime = 0;
      }

      // CRITICAL: Reset streaming playback flag when advancing tracks
      // This ensures browser extension events are not ignored when switching
      // from a streaming track (Spotify) to a browser track (YouTube/Bandcamp)
      streamingPlaybackActiveRef.current = false;

      // Stop browser extension playback if active (YouTube external browser)
      if (browserPlaybackActive && activeExtensionTabId) {
        console.log('⏹️ Stopping browser playback before next track');
        window.electron.extension.sendCommand({
          type: 'command',
          action: 'pause'
        });
        // Store the tab ID to close when next track connects
        pendingCloseTabIdRef.current = activeExtensionTabId;
        setBrowserPlaybackActive(false);
        setActiveExtensionTabId(null);
      }

      // Close playback window if active (Bandcamp embedded player)
      if (window.electron?.playbackWindow?.close) {
        console.log('⏹️ Closing playback window before next track');
        await window.electron.playbackWindow.close();
      }

      // Clean up external track timeouts
      if (externalTrackTimeoutRef.current) {
        clearTimeout(externalTrackTimeoutRef.current);
        externalTrackTimeoutRef.current = null;
      }
      if (externalTrackIntervalRef.current) {
        clearInterval(externalTrackIntervalRef.current);
        externalTrackIntervalRef.current = null;
      }
      setIsExternalPlayback(false);
      setShowExternalPrompt(false);
      setPendingExternalTrack(null);
      setPendingExternalResolverId(null);

      // LISTEN-ALONG DEFERRED END: Friend went offline while we were playing - now the song has finished
      const listenAlongEndingFriend = listenAlongEndAfterSongRef.current;
      if (listenAlongEndingFriend) {
        console.log(`🎧 Listen-along: Song finished, ending deferred listen-along session`);
        listenAlongEndAfterSongRef.current = null;
        setPlaybackContext(null);
        showToast(`${listenAlongEndingFriend} stopped listening`);
        // Fall through to play from queue below
      }

      // LISTEN-ALONG MODE: Handle track progression when listening along with a friend
      // Skip this block if we already ended listen-along above (user clicked next)
      if (listenAlongFriendNow && !listenAlongEnded) {
        // Check if there's a pending track queued (friend moved ahead while we were still playing)
        const pendingTrack = listenAlongPendingTrackRef.current;
        if (pendingTrack) {
          console.log(`🎧 Listen-along: Playing pending track "${pendingTrack.title}"`);
          listenAlongPendingTrackRef.current = null;
          listenAlongLastTrackRef.current = {
            name: pendingTrack.title,
            artist: pendingTrack.artist
          };
          handlePlay(pendingTrack);
          return;
        }

        // Check if friend's current track is the same as what we just finished
        // If so, they haven't moved on yet - end listen-along and go to queue
        const friendTrack = listenAlongFriendNow.cachedRecentTrack;
        const lastTrack = listenAlongLastTrackRef.current;
        const friendStillOnSameTrack = friendTrack && lastTrack &&
          friendTrack.name === lastTrack.name &&
          friendTrack.artist === lastTrack.artist;

        if (friendStillOnSameTrack) {
          console.log(`🎧 Listen-along: Song ended but ${listenAlongFriendNow.displayName} hasn't moved on - ending listen-along`);
          showToast(`${listenAlongFriendNow.displayName} hasn't moved on - resuming your queue`);
          // Abort and cleanup pool context
          abortSchedulerContext('listen-along');
          setListenAlongFriend(null);
          listenAlongLastTrackRef.current = null;
          listenAlongPendingTrackRef.current = null;
          setPlaybackContext(null);
          // Fall through to play from queue below
        } else {
          // Friend has a different track, but we don't have it queued yet
          // Wait for polling to detect the change
          console.log(`🎧 Listen-along active with ${listenAlongFriendNow.displayName} - waiting for their next track`);
          setIsPlaying(false);
          return;
        }
      }

      // Always use our local queue for navigation
      // (Spotify doesn't know about our queue - tracks may resolve to different services)
      // Use refs to get current values (avoids stale closure when called from event handlers)
      const queue = currentQueueRef.current;
      const track = currentTrackRef.current;

      // Check if we're in spinoff mode - play from spinoff pool instead of queue
      // Use refs to avoid stale closure issues
      if (spinoffModeRef.current && spinoffTracksRef.current.length > 0) {
        const nextSimilar = spinoffTracksRef.current.shift();
        console.log(`🔀 Spinoff: playing next similar track "${nextSimilar.title}"`);

        // Trigger refill in background when pool is low and refillUrl is set (fire-and-forget).
        if (spinoffTracksRef.current.length < 3 && spinoffRefillUrlRef.current) {
          refillSpinoffPool().catch(err => console.warn('refill error:', err));
        }

        // Update pool visibility for resolution - next 5 tracks
        // Use track ID as key to avoid re-resolution when tracks shift
        const poolTracks = spinoffTracksRef.current.slice(0, 5).map((t) => ({
          key: t.id || `${t.artist}-${t.title}`,
          data: { track: t, artistName: t.artist || 'Unknown Artist' }
        }));
        updateSchedulerVisibility('spinoff', poolTracks);
        setSchedulerPlaybackIndex('spinoff', 0);

        // Preserve the track's existing _playbackContext when present. Pool
        // tracks from the protocol radio path (parachord://play/radio Mode C)
        // arrive with a full radioContext including refillUrl; the seed-mode
        // spinoff (Mode B / in-app right-click) tags tracks without
        // _playbackContext, so we synthesize one as a fallback. Don't blindly
        // rebuild — that drops refillUrl and any other context the radio
        // setup put there.
        const inheritedContext = nextSimilar._playbackContext || {
          type: 'spinoff',
          sourceTrack: spinoffSourceTrackRef.current,
        };
        handlePlay({
          ...nextSimilar,
          sources: nextSimilar.sources || {}, // Ensure sources object exists for on-demand resolution
          _playbackContext: inheritedContext,
        });
        return;
      }

      // If spinoff mode but no tracks left, exit spinoff and continue with queue
      if (spinoffModeRef.current && spinoffTracksRef.current.length === 0) {
        console.log('🔀 Spinoff pool exhausted, returning to queue');
        exitSpinoff();
      }

      if (queue.length === 0) {
        console.log('No queue set, cannot go to next track');
        // Reset play button when queue is exhausted
        setIsPlaying(false);
        isPlayingRef.current = false;
        return;
      }

      console.log(`🔍 Queue navigation: currentTrack.id="${track?.id}", queueLength=${queue.length}`);

      // Queue represents upcoming tracks - current track is NOT in the queue
      // Find the first playable track in the queue
      const nextTrackIndex = queue.findIndex(t => t.status !== 'error');

      if (nextTrackIndex === -1) {
        console.log('⚠️ No playable tracks in queue');
        // Reset play button when no playable tracks remain
        setIsPlaying(false);
        isPlayingRef.current = false;
        return;
      }

      const nextTrack = queue[nextTrackIndex];

      // Push current track to history before moving to next (for "previous" navigation)
      if (track) {
        playHistoryRef.current = [...playHistoryRef.current, track];
        console.log(`📚 Added "${track.title}" to play history (${playHistoryRef.current.length} tracks)`);
      }

      // Remove the track we're about to play from the queue
      const newQueue = queue.filter((_, index) => index !== nextTrackIndex);
      setCurrentQueue(newQueue);

      // Update playback context if the next track has a different context
      console.log(`🎯 Next track context:`, nextTrack._playbackContext);
      if (nextTrack._playbackContext) {
        setPlaybackContext(nextTrack._playbackContext);
        console.log(`🎯 Updated playback context to:`, nextTrack._playbackContext.type);
      }

      console.log(`➡️ Playing next track: "${nextTrack.title}", remaining queue: ${newQueue.length}`);
      handlePlay(nextTrack);
    } finally {
      // Reset re-entrancy guard after a delay to allow state updates and async operations to complete
      // This prevents re-entry from race conditions (e.g., in-flight Spotify polls, browser events)
      setTimeout(() => {
        isAdvancingTrackRef.current = false;
      }, 500);
    }
  };

  const handlePrevious = async () => {
    // Use refs to get current values (avoids stale closure when called from event handlers)
    const track = currentTrackRef.current;

    if (!track) return;

    // If user clicked previous while listening along, end the session
    const listenAlongFriendNow = listenAlongFriendRef.current;
    if (listenAlongFriendNow) {
      console.log(`🎧 User went back - ending listen-along with ${listenAlongFriendNow.displayName}`);
      showToast(`Stopped listening along with ${listenAlongFriendNow.displayName}`);
      // Abort and cleanup pool context
      abortSchedulerContext('listen-along');
      setListenAlongFriend(null);
      listenAlongLastTrackRef.current = null;
      listenAlongPendingTrackRef.current = null;
      setPlaybackContext(null);
    }

    // Clear deferred listen-along ending if user navigated manually
    if (listenAlongEndAfterSongRef.current) {
      listenAlongEndAfterSongRef.current = null;
      setPlaybackContext(null);
    }

    // Notify scrobble manager that current track is ending
    if (window.scrobbleManager) {
      window.scrobbleManager.onTrackEnd();
    }

    // ALWAYS stop all streaming playback sources unconditionally to prevent overlap
    // This prevents race conditions where the streamingPlaybackActiveRef flag may be stale

    // Pause Spotify only if Parachord's current playback is on it (see handlePlay)
    if (spotifyToken && (currentTrackRef.current?._activeResolver === 'spotify' || spotifyPlaySentRef.current)) {
      spotifyPlaySentRef.current = false;
      console.log('⏹️ Pausing Spotify before previous track');
      fetch('https://api.spotify.com/v1/me/player/pause', {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${spotifyToken}` }
      }).catch(() => {}); // Silently ignore - may not be playing
    }

    // Always pause Apple Music native playback (macOS MusicKit)
    if (window.electron?.musicKit) {
      console.log('⏹️ Pausing Apple Music (native) before previous track');
      window.electron.musicKit.pause().catch(() => {}); // Silently ignore
    }

    // Always pause Apple Music web playback (MusicKit JS)
    const musicKitWebPrev = window.getMusicKitWeb ? window.getMusicKitWeb() : null;
    if (musicKitWebPrev) {
      try {
        console.log('⏹️ Pausing Apple Music (web) before previous track');
        musicKitWebPrev.pause();
      } catch (_e) {} // Silently ignore
    }

    // Always stop Apple Music preview audio if it exists
    if (window._appleMusicPreviewAudio) {
      console.log('⏹️ Stopping Apple Music preview audio');
      window._appleMusicPreviewAudio.pause();
      window._appleMusicPreviewAudio.currentTime = 0;
    }

    stopAmazonIfActive('⏹️ Stopping Amazon Music before previous track');

    // CRITICAL: Reset streaming playback flag when changing tracks
    streamingPlaybackActiveRef.current = false;

    // Stop browser playback if active
    if (browserPlaybackActive && activeExtensionTabId) {
      console.log('⏹️ Stopping browser playback before restarting track');
      window.electron.extension.sendCommand({
        type: 'command',
        action: 'pause'
      });
      pendingCloseTabIdRef.current = activeExtensionTabId;
      setBrowserPlaybackActive(false);
      setActiveExtensionTabId(null);
    }

    // Close playback window if active (for Bandcamp, etc.)
    if (window.electron?.playbackWindow?.close) {
      console.log('⏹️ Closing playback window before restarting track');
      await window.electron.playbackWindow.close();
    }

    // Clean up any active polling or timeouts
    if (playbackPollerRef.current) {
      clearInterval(playbackPollerRef.current);
      playbackPollerRef.current = null;
    }
    if (pollingRecoveryRef.current) {
      clearInterval(pollingRecoveryRef.current);
      pollingRecoveryRef.current = null;
    }
    // Also stop main process polling (both Spotify and Apple Music)
    if (window.electron?.spotify?.polling) {
      window.electron.spotify.polling.stop();
    }
    if (window.electron?.musicKit?.polling) {
      window.electron.musicKit.polling.stop().catch(() => {});
    }
    if (externalTrackTimeoutRef.current) {
      clearTimeout(externalTrackTimeoutRef.current);
      externalTrackTimeoutRef.current = null;
    }
    if (externalTrackIntervalRef.current) {
      clearInterval(externalTrackIntervalRef.current);
      externalTrackIntervalRef.current = null;
    }

    // Stop HTML5 Audio if playing (local files, SoundCloud)
    if (audioRef.current && !audioRef.current.paused) {
      console.log('⏹️ Stopping HTML5 audio before previous track');
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsExternalPlayback(false);
    setShowExternalPrompt(false);
    setPendingExternalTrack(null);
    setPendingExternalResolverId(null);

    // Check if we have history to go back to
    const history = playHistoryRef.current;
    if (history.length > 0) {
      // Pop the previous track from history
      const previousTrack = history[history.length - 1];
      playHistoryRef.current = history.slice(0, -1);

      // Put current track at the front of the queue so it plays next after the previous track
      // This maintains proper playback order: previous -> current -> rest of queue
      if (track) {
        // Check if track is already in queue before inserting
        const queue = currentQueueRef.current;
        const isDuplicate = queue.some(t =>
          t.title === track.title && t.artist === track.artist
        );

        if (isDuplicate) {
          console.log(`⏭️ Track "${track.title}" already in queue, skipping duplicate`);
        } else {
          setCurrentQueue(prev => [track, ...prev]);
          console.log(`📥 Returned "${track.title}" to front of queue`);
          // Trigger insert animation
          setInsertedTrackId(track.id);
          setTimeout(() => setInsertedTrackId(null), 1000); // Clear after animation
        }
      }

      console.log(`⬅️ Going back to previous track: "${previousTrack.title}" (${playHistoryRef.current.length} tracks remaining in history)`);
      handlePlay(previousTrack);
    } else {
      // No history - restart current track
      console.log(`⬅️ No history, restarting current track: "${track.title}"`);
      handlePlay(track);
    }
  };

  const handlePlayPause = async () => {
    if (!currentTrack) return;

    // Track explicit user pause/resume during listen-along
    if (listenAlongFriendRef.current) {
      if (isPlaying) {
        // User is pausing
        listenAlongUserPausedRef.current = true;
        console.log('🎧 Listen-along: User paused playback');
      } else {
        // User is resuming — if friend moved to a different track while we were paused, play that instead
        listenAlongUserPausedRef.current = false;
        const pendingTrack = listenAlongPendingTrackRef.current;
        if (pendingTrack) {
          console.log(`🎧 Listen-along: Resuming with friend's current track "${pendingTrack.title}"`);
          listenAlongPendingTrackRef.current = null;
          listenAlongLastTrackRef.current = {
            name: pendingTrack.title,
            artist: pendingTrack.artist
          };
          handlePlay(pendingTrack);
          return;
        }
      }
    }

    // Check if this is a restored track that needs explicit start (not just resume)
    // This handles tracks restored from saved queue on app reopen
    if (!isPlaying && trackNeedsExplicitStart.current) {
      console.log('🔄 Starting restored track via handlePlay:', currentTrack.title);
      trackNeedsExplicitStart.current = false;
      handlePlay(currentTrack);
      return;
    }

    // Check if browser extension is controlling playback
    if (browserPlaybackActive && extensionConnected) {
      console.log('🌐 Sending play/pause to browser extension');
      window.electron.extension.sendCommand({
        type: 'command',
        action: isPlaying ? 'pause' : 'play'
      });
      // State will be updated when extension sends back playing/paused event
      return;
    }

    // Handle external playback window (Bandcamp embed)
    if (isExternalPlayback && window.electron?.playbackWindow?.toggle) {
      console.log('🎸 Toggling playback window play/pause');
      const result = await window.electron.playbackWindow.toggle();
      if (result.success) {
        if (result.state === 'playing') {
          setIsPlaying(true);
        } else if (result.state === 'paused') {
          setIsPlaying(false);
        } else {
          // For 'clicked' fallback, just toggle the state
          setIsPlaying(!isPlaying);
        }
      }
      return;
    }

    // Handle local file or SoundCloud playback (both use HTML5 Audio)
    // IMPORTANT: Check _activeResolver (not sources) to determine what's actually playing.
    // A track may have sources.soundcloud from resolution but be playing via Apple Music.
    // Previously this checked sources.localfiles/soundcloud which caused it to hijack
    // pause for Apple Music tracks when audioRef.current lingered from a prior play.
    if (audioRef.current && usesSharedAudio(currentTrack?._activeResolver)) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        audioRef.current.play();
        setIsPlaying(true);
      }
      return;
    }

    // Check _activeResolver first to determine what's actually playing
    // Handle Apple Music playback (must check before Spotify since tracks can have both sources)
    // Also detect Apple Music if preview audio is actively playing (defensive fallback
    // for cases where _activeResolver was lost, e.g. after source switching)
    const isAppleMusicActive = currentTrack._activeResolver === 'applemusic' ||
      (window._appleMusicPreviewAudio && !window._appleMusicPreviewAudio.paused && currentTrack.sources?.applemusic);
    if (isAppleMusicActive && window.electron?.musicKit) {
      try {
        if (isPlaying) {
          // Pause both native MusicKit AND preview audio — when native MusicKit fails,
          // playback falls back to preview via window._appleMusicPreviewAudio but this
          // handler was only pausing native MusicKit, leaving the preview stream running
          await window.electron.musicKit.pause();
          if (window._appleMusicPreviewAudio && !window._appleMusicPreviewAudio.paused) {
            window._appleMusicPreviewAudio.pause();
            console.log('🍎 Paused Apple Music preview audio');
          }
          setIsPlaying(false);
          // Stop polling so stale state checks don't trigger auto-advance
          if (window.electron.musicKit.polling) {
            window.electron.musicKit.polling.stop();
          }
          console.log('🍎 Paused Apple Music playback');
        } else {
          await window.electron.musicKit.resume();
          // Resume preview audio if it was the active playback method
          if (window._appleMusicPreviewAudio && window._appleMusicPreviewAudio.src && window._appleMusicPreviewAudio.paused) {
            try {
              await window._appleMusicPreviewAudio.play();
              console.log('🍎 Resumed Apple Music preview audio');
            } catch (previewErr) {
              console.warn('🍎 Could not resume preview audio:', previewErr.message);
            }
          }
          setIsPlaying(true);
          // Restart polling for progress updates and auto-advance
          if (window.electron.musicKit.polling) {
            window.electron.musicKit.polling.start({
              songId: currentTrack.appleMusicId,
              trackTitle: currentTrack.title,
              trackArtist: currentTrack.artist,
              duration: currentTrack.duration || 0
            }).catch(err => console.warn('🍎 Could not restart polling:', err.message));
          }
          console.log('🍎 Resumed Apple Music playback');
        }
      } catch (error) {
        console.error('Apple Music play/pause error:', error);
        // Update UI state even on error to avoid stuck state
        setIsPlaying(!isPlaying);
      }
      return;
    }

    const isSpotifyTrack = currentTrack._activeResolver === 'spotify' ||
      (!currentTrack._activeResolver && !isAppleMusicActive && (currentTrack.sources?.spotify || currentTrack.spotifyUri));

    // Amazon Music in-app web player (Widevine WebContentsView)
    const isAmazonMusicActive = currentTrack._activeResolver === 'amazonmusic' ||
      (!currentTrack._activeResolver && !isAppleMusicActive && !isSpotifyTrack && (currentTrack.sources?.amazonmusic || currentTrack.amazonAsin));

    if (isAmazonMusicActive && window.electron?.amazonMusic) {
      try {
        if (isPlaying) {
          const r = await window.electron.amazonMusic.pause();
          if (r && r.success) {
            console.log('Paused Amazon Music playback');
          }
          setIsPlaying(false);
          // Stop polling so stale state checks don't trigger auto-advance
          window.electron.amazonMusic.polling.stop();
        } else {
          let r = await window.electron.amazonMusic.resume();
          if (r && r.success === false) {
            // No media element: the view was blanked (haltPlayback after an
            // advance with nothing to advance to). Nothing to resume — replay
            // the current track from its ASIN instead of showing a playing UI
            // over silence with a poller reading EMPTY forever.
            const asin = currentTrack.amazonAsin || currentTrack.sources?.amazonmusic?.amazonAsin;
            if (asin) {
              console.log('Amazon Music view is blank — replaying current track');
              r = await window.electron.amazonMusic.playTrack({ asin, title: currentTrack.title, artist: currentTrack.artist });
              if (r && r.success) {
                // A fresh page starts its element at full volume; drive it to
                // Parachord's effective volume like handlePlay does.
                const volumeToApply = isMutedRef.current ? 0 : volumeRef.current;
                const effectiveVolume = getEffectiveVolume(volumeToApply, 'amazonmusic', currentTrack.id);
                window.electron.amazonMusic.setVolume(effectiveVolume / 100).catch(() => {});
                amazonMusicProgressBaselineRef.current = { progress: 0, timestamp: Date.now(), isPlaying: true };
              }
            }
          }
          if (r && r.success) {
            console.log('Resumed Amazon Music playback');
            setIsPlaying(true);
            // Restart polling for progress updates and auto-advance
            const asin = currentTrack.amazonAsin || currentTrack.sources?.amazonmusic?.amazonAsin;
            if (asin) {
              window.electron.amazonMusic.polling.start({
                asin,
                trackTitle: currentTrack.title,
                trackArtist: currentTrack.artist,
                duration: currentTrack.duration || 0
              }).catch(err => console.warn('Could not restart Amazon Music polling:', err.message));
            }
          } else {
            // Nothing to resume and nothing to replay — leave the play button
            // alone rather than faking a playing state.
            console.warn('Amazon Music resume failed:', (r && r.error) || 'no media element');
          }
        }
      } catch (error) {
        console.error('Amazon Music play/pause error:', error);
        // Update UI state even on error to avoid stuck state
        setIsPlaying(!isPlaying);
      }
      return;
    }

    if (isSpotifyTrack && spotifyToken) {
      // Control Spotify playback
      const attemptSpotifyControl = async (token, isRetry = false) => {
        try {
          if (isPlaying) {
            // Pausing - simple pause request
            const response = await fetch('https://api.spotify.com/v1/me/player/pause', {
              method: 'PUT',
              headers: {
                'Authorization': `Bearer ${token}`
              }
            });

            if (response.ok || response.status === 204) {
              setIsPlaying(false);
              console.log('Paused Spotify playback');
              // Stop polling so stale state checks don't trigger auto-advance
              if (window.electron?.spotify?.polling) {
                window.electron.spotify.polling.stop();
              }
              return true;
            } else if (response.status === 401 && !isRetry) {
              // Token expired - try to refresh
              console.log('🔄 Spotify token expired on pause, attempting refresh...');
              const newToken = await refreshSpotifyToken();
              if (newToken) {
                return attemptSpotifyControl(newToken, true);
              }
            }
            // If we can't control Spotify, at least update UI to reflect user intent
            // This prevents the "can't pause" issue
            if (!isRetry) {
              console.log('⚠️ Could not pause Spotify, updating UI state anyway');
              setIsPlaying(false);
              // Stop polling since we're trying to pause
              if (playbackPollerRef.current) {
                clearInterval(playbackPollerRef.current);
                playbackPollerRef.current = null;
              }
              // Also stop main process polling
              if (window.electron?.spotify?.polling) {
                window.electron.spotify.polling.stop();
              }
            }
          } else {
            // Resume Spotify playback
            const response = await fetch('https://api.spotify.com/v1/me/player/play', {
              method: 'PUT',
              headers: {
                'Authorization': `Bearer ${token}`
              }
            });

            if (response.ok || response.status === 204) {
              setIsPlaying(true);
              console.log('Resumed Spotify playback');
              return true;
            } else if (response.status === 401 && !isRetry) {
              // Token expired - try to refresh
              console.log('🔄 Spotify token expired on play, attempting refresh...');
              const newToken = await refreshSpotifyToken();
              if (newToken) {
                return attemptSpotifyControl(newToken, true);
              }
            }
          }
          return false;
        } catch (error) {
          console.error('Spotify play/pause error:', error);
          return false;
        }
      };

      await attemptSpotifyControl(spotifyToken);
      return;
    }

    // Toggle local playback (demo audio fallback)
    if (!audioContext) return;
    if (isPlaying) {
      setIsPlaying(false);
      if (currentSource) {
        try { currentSource.stop(); setCurrentSource(null); } catch (_e) {}
      }
    } else {
      if (audioContext.state === 'suspended') await audioContext.resume();
      setIsPlaying(true);
      playDemoAudio(currentTrack);
    }
  };

  const wakeSpotifyApp = React.useCallback(() => {
    console.log('🎵 Attempting to wake Spotify app...');
    if (window.electron?.shell?.openExternal) {
      window.electron.shell.openExternal('spotify:');
    } else {
      // Fallback for web - open Spotify web player
      window.open('https://open.spotify.com', '_blank');
    }
  }, []);

  const stopAllLocalAudio = () => {
    // Stop HTML5 Audio element (used by local files and SoundCloud)
    // Always call pause() regardless of paused state to handle edge cases
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        console.log('⏹️ Stopped HTML5 audio element');
      } catch (e) {
        console.error('Error stopping HTML5 audio:', e);
      }
    }

    // Stop Apple Music preview audio if it exists (used for 30-second previews)
    if (window._appleMusicPreviewAudio) {
      try {
        window._appleMusicPreviewAudio.pause();
        window._appleMusicPreviewAudio.currentTime = 0;
        console.log('⏹️ Stopped Apple Music preview audio');
      } catch (e) {
        console.error('Error stopping Apple Music preview audio:', e);
      }
    }

    // NOTE: We intentionally do NOT stop native MusicKit or MusicKit Web here.
    // MusicKit playback state is managed by the resolver system, and pausing it
    // here causes a race condition where the async pause() completes AFTER
    // a new track starts playing, effectively stopping the newly started track.
  };

  const stopMainProcessPolling = () => {
    // Stop Spotify polling
    if (window.electron?.spotify?.polling) {
      window.electron.spotify.polling.stop().catch((err) => {
        console.error('Error stopping Spotify main process polling:', err);
      });
    }
    // Stop Apple Music polling
    if (window.electron?.musicKit?.polling) {
      window.electron.musicKit.polling.stop().catch((err) => {
        console.error('Error stopping Apple Music main process polling:', err);
      });
    }
    // Stop Amazon Music polling
    if (window.electron?.amazonMusic?.polling) {
      try { window.electron.amazonMusic.polling.stop(); } catch (err) {
        console.error('Error stopping Amazon Music main process polling:', err);
      }
    }
  };

  const stopAmazonIfActive = (reason) => {
    if (!window.electron?.amazonMusic) return Promise.resolve();
    try { window.electron.amazonMusic.polling.stop(); } catch (_e) {}
    if (!(activeResolversRef.current || []).includes('amazonmusic')) return Promise.resolve();
    if (reason) console.log(reason);
    return window.electron.amazonMusic.stop().catch(() => {});
  };

  const fetchSimilarTracks = async (artistName, trackName) => {
    if (!artistName || !trackName) return [];

    const apiKey = getLastfmApiKey();
    if (!apiKey) {
      console.log('🔀 Last.fm similar tracks skipped: no API key');
      return [];
    }

    try {
      const url = `https://ws.audioscrobbler.com/2.0/?method=track.getsimilar&artist=${encodeURIComponent(artistName)}&track=${encodeURIComponent(trackName)}&api_key=${apiKey}&format=json&limit=20`;

      console.log(`🔀 Fetching similar tracks for "${trackName}" by ${artistName}`);
      const response = await lastfmFetch(url);
      if (!response.ok) {
        console.error('Last.fm similar tracks request failed:', response.status);
        return [];
      }

      const data = await response.json();
      if (data.similartracks?.track) {
        const tracks = data.similartracks.track.map(t => ({
          title: t.name,
          artist: t.artist?.name || 'Unknown Artist',
          match: Math.round(parseFloat(t.match) * 100),
          source: 'lastfm-similar'
        }));
        // Shuffle the tracks for variety (Fisher-Yates shuffle)
        for (let i = tracks.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
        }
        console.log(`🔀 Found ${tracks.length} similar tracks (shuffled)`);
        return tracks;
      }

      return [];
    } catch (error) {
      console.error('Failed to fetch similar tracks from Last.fm:', error);
      return [];
    }
  };

  const resolveSpinoffSeed = async (seed) => {
    if (!seed || !seed.artist) {
      console.log('🔀 Cannot start spinoff: missing track info');
      return null;
    }
    if (seed.title) return { artist: seed.artist, title: seed.title };
    const top = await getArtistTopTracks(seed.artist, 1);
    if (!top.length) {
      showToast(`Couldn't find a track by ${seed.artist} to seed the radio`, 'error');
      return null;
    }
    console.log(`🔀 Seeding spinoff for ${seed.artist} from top track "${top[0].title}"`);
    return { artist: seed.artist, title: top[0].title };
  };

  const activateSpinoffFromPool = async (initialPool, { displayName, refillUrl }) => {
    if (!initialPool.length && !refillUrl) {
      showToast(`No tracks for radio: ${displayName || 'Untitled'}`);
      return;
    }

    // Save previous context to restore on exit (mirrors seed path)
    if (playbackContext?.type !== 'listenAlong') {
      spinoffPreviousContextRef.current = playbackContext;
    } else {
      spinoffPreviousContextRef.current = null;
    }

    setSpinoffMode(true);
    setSpinoffSourceTrack({ title: displayName || 'Radio', artist: '' });
    // Build the playback context first so we can tag every track with it.
    // handlePlay reads track._playbackContext to decide whether to call
    // exitSpinoff() — without the tag, the very first handlePlay call
    // tears down spinoff mode (because !undefined?.type?.includes('spinoff')
    // evaluates true) and restores playbackContext to null.
    //
    // Also: stable id + empty sources object are required for
    // resolveTracksInBackground (mutates track.sources[resolverId] and
    // calls Object.keys(track.sources) — throws if undefined). Tracks
    // from parseProtocolTracklist arrive without any of these fields.
    const radioContext = {
      type: 'spinoff',
      sourceTrack: { title: displayName || 'Radio', artist: '' },
      refillUrl: refillUrl || null,
    };
    const baseId = `protocol-radio-${Date.now()}`;
    spinoffTracksRef.current = initialPool.map((t, i) => ({
      ...t,
      id: t.id || `${baseId}-${i}`,
      sources: t.sources || {},
      _playbackContext: radioContext,
    }));
    spinoffRefillUrlRef.current = refillUrl || null;
    spinoffRefillEmptyCountRef.current = 0;
    spinoffRefillLastFetchAtRef.current = 0;

    registerPoolContext('spinoff', 5);
    const poolTracks = spinoffTracksRef.current.slice(0, 5).map((t) => ({
      key: t.id || `${t.artist}-${t.title}`,
      data: { track: t, artistName: t.artist || 'Unknown Artist' }
    }));
    updateSchedulerVisibility('spinoff', poolTracks);

    setPlaybackContext(radioContext);

    showToast(`Playing radio: ${displayName || 'Untitled'}`);

    // If pool was empty but refillUrl is set, fetch immediately for first batch.
    if (initialPool.length === 0 && refillUrl) {
      await refillSpinoffPool();
      if (spinoffTracksRef.current.length === 0) {
        console.log('🔁 Initial refill returned no tracks, exiting radio');
        exitSpinoff();
        showToast(`Radio source returned no tracks: ${displayName || 'Untitled'}`);
        return;
      }
    }

    // Find a playable first track: pre-resolve via the resolver pipeline,
    // skip tracks that no enabled resolver can match (common for obscure
    // LB-radio results, live recordings, remixes that aren't on Spotify
    // or Apple Music). Caps attempts so a fully-unresolvable pool doesn't
    // loop forever.
    let first = null;
    let skipped = 0;
    const MAX_SKIP = 20;
    while (spinoffTracksRef.current.length > 0 && skipped < MAX_SKIP) {
      const candidate = spinoffTracksRef.current.shift();
      try {
        await resolveTracksInBackground([candidate]);
      } catch (err) {
        console.warn(`🔁 Resolution threw for "${candidate.title}" by ${candidate.artist}:`, err?.message || err);
      }
      const sourceKeys = candidate.sources ? Object.keys(candidate.sources).filter(id => !candidate.sources[id]?.noMatch) : [];
      if (sourceKeys.length > 0) {
        console.log(`🔁 Found playable: "${candidate.title}" by ${candidate.artist} (sources: ${sourceKeys.join(', ')})`);
        first = candidate;
        break;
      }
      console.log(`🔁 Skipping "${candidate.title}" by ${candidate.artist} — no playable source`);
      skipped++;
    }

    if (!first) {
      console.log(`🔁 Radio: no playable tracks found after ${skipped} attempts (${spinoffTracksRef.current.length} remaining in pool), exiting`);
      exitSpinoff();
      showToast(`No playable tracks for radio: ${displayName || 'Untitled'}`);
      return;
    }

    // Pre-resolve the next 2 lookahead tracks BEFORE handing the first track
    // to handlePlay. Without this, on heavy-CPU systems track 2's resolution
    // may not finish before track 1 ends — handlePlay then falls into the
    // on-demand resolution path, which races against the previous track's
    // teardown and produces the "skip after a couple of seconds" symptom.
    // Awaiting two lookahead tracks adds bounded latency (~1s parallel) but
    // makes the auto-advance path deterministic. The remainder is fire-and-
    // forget — tracks 4+ resolve while track 1 plays, well before they're
    // needed.
    const LOOKAHEAD = 2;
    const lookaheadTracks = spinoffTracksRef.current.slice(0, LOOKAHEAD);
    if (lookaheadTracks.length > 0) {
      try {
        await resolveTracksInBackground(lookaheadTracks);
      } catch (err) {
        console.warn('🔁 Lookahead resolution error:', err?.message || err);
      }
    }
    const remainingPool = spinoffTracksRef.current.slice(LOOKAHEAD);
    if (remainingPool.length > 0) {
      resolveTracksInBackground(remainingPool)
        .catch(err => console.warn('🔁 Background pool resolution error:', err?.message));
    }

    // handlePlay only takes one arg; the radio context is already on the
    // track via _playbackContext (tagged in the pool setup above) and in
    // React state via setPlaybackContext(radioContext) earlier in this
    // function. Don't pass extra args — they'd be silently dropped.
    handlePlay(first);
  };

  const refillSpinoffPool = async () => {
    const url = spinoffRefillUrlRef.current;
    if (!url) return;
    const now = Date.now();
    if (now - spinoffRefillLastFetchAtRef.current < 5000) return; // 5s soft rate-limit
    spinoffRefillLastFetchAtRef.current = now;

    try {
      if (!window.isPublicHttpUrl || !window.isPublicHttpUrl(url)) {
        console.warn('🔁 Refill URL failed SSRF check, stopping');
        spinoffRefillUrlRef.current = null;
        return;
      }
      const resp = await fetch(url, {
        redirect: 'error',
        headers: buildProtocolFetchHeaders(url),
      });
      if (!resp.ok) {
        spinoffRefillEmptyCountRef.current++;
        if (spinoffRefillEmptyCountRef.current >= 3) spinoffRefillUrlRef.current = null;
        return;
      }
      const ct = resp.headers.get('content-type') || '';
      const body = await resp.text();
      if (body.length > 100 * 1024) {
        console.warn('🔁 Refill response > 100KB, treating as empty');
        spinoffRefillEmptyCountRef.current++;
        if (spinoffRefillEmptyCountRef.current >= 3) spinoffRefillUrlRef.current = null;
        return;
      }
      const parsed = (window.parseProtocolTracklist && window.parseProtocolTracklist(body, ct)) || { tracks: [] };
      const tracks = parsed.tracks || [];

      // Dedupe against existing pool by mbid → isrc → (artist|title) lowercase
      const existing = new Set(spinoffTracksRef.current.map(keyForSpinoffDedup));
      const fresh = tracks.filter(t => !existing.has(keyForSpinoffDedup(t)));

      if (fresh.length === 0) {
        spinoffRefillEmptyCountRef.current++;
        if (spinoffRefillEmptyCountRef.current >= 3) {
          console.log('🔁 Refill returned empty 3× in a row, stopping');
          spinoffRefillUrlRef.current = null;
        }
        return;
      }

      spinoffRefillEmptyCountRef.current = 0;
      // Tag refilled tracks with the same shape as the initial pool: stable
      // id, empty sources (for resolveTracksInBackground), and the same
      // _playbackContext as the existing pool tracks (so handlePlay's
      // spinoff guard doesn't tear down spinoff mode when these are played).
      const existingFirst = spinoffTracksRef.current[0];
      const inheritedContext = existingFirst?._playbackContext || { type: 'spinoff' };
      const refillBaseId = `protocol-radio-refill-${Date.now()}`;
      const tagged = fresh.map((t, i) => ({
        ...t,
        id: t.id || `${refillBaseId}-${i}`,
        sources: t.sources || {},
        _playbackContext: inheritedContext,
      }));
      spinoffTracksRef.current = [...spinoffTracksRef.current, ...tagged];
      console.log(`🔁 Refilled spinoff pool with ${tagged.length} tracks`);
    } catch (err) {
      console.warn('🔁 Refill failed:', err && err.message);
      spinoffRefillEmptyCountRef.current++;
      if (spinoffRefillEmptyCountRef.current >= 3) spinoffRefillUrlRef.current = null;
    }
  };

  const startSpinoff = async (track) => {
    // New path: pre-resolved pool (used by parachord://play-radio)
    if (track && Array.isArray(track.pool)) {
      return activateSpinoffFromPool(track.pool, {
        displayName: track.displayName,
        refillUrl: track.refillUrl || null,
      });
    }

    if (track && track.artist && !track.title) {
      // Artist-only seed (protocol Mode B or any caller with just a name).
      track = await resolveSpinoffSeed(track);
    }
    if (!track || !track.artist || !track.title) {
      console.log('🔀 Cannot start spinoff: missing track info');
      return;
    }

    setSpinoffLoading(true);
    console.log(`🔀 Starting spinoff from "${track.title}" by ${track.artist}`);

    // If we're in listen-along mode, exit it first (we're leaving to explore similar music)
    if (listenAlongFriend) {
      console.log(`🔀 Exiting listen-along with ${listenAlongFriend.displayName} to start spinoff`);
      abortSchedulerContext('listen-along');
      setListenAlongFriend(null);
      listenAlongLastTrackRef.current = null;
      // Don't show the "stopped listening along" toast since we'll show the spinoff toast
    }

    // Clear deferred listen-along ending
    listenAlongEndAfterSongRef.current = null;

    try {
      const similarTracks = await fetchSimilarTracks(track.artist, track.title);

      if (similarTracks.length === 0) {
        showToast(`No similar tracks found for "${track.title}"`);
        return;
      }

      // Save current playback context to restore when spinoff ends
      // (but not if it was a listenAlong context - that session is over)
      if (playbackContext?.type !== 'listenAlong') {
        spinoffPreviousContextRef.current = playbackContext;
      } else {
        spinoffPreviousContextRef.current = null;
      }

      // Enter spinoff mode
      setSpinoffMode(true);
      setSpinoffSourceTrack({ title: track.title, artist: track.artist });
      spinoffTracksRef.current = similarTracks;

      // Register pool context for spinoff resolution
      registerPoolContext('spinoff', 5);

      // Update pool visibility for resolution - next 5 tracks
      // Use track ID as key to avoid re-resolution when tracks shift
      const poolTracks = spinoffTracksRef.current.slice(0, 5).map((t) => ({
        key: t.id || `${t.artist}-${t.title}`,
        data: { track: t, artistName: t.artist || 'Unknown Artist' }
      }));
      updateSchedulerVisibility('spinoff', poolTracks);

      // Set playback context
      setPlaybackContext({
        type: 'spinoff',
        sourceTrack: { title: track.title, artist: track.artist }
      });

      showToast(`Spinning off of ${track.title} - ${track.artist}`);
      console.log(`🔀 Spinoff mode activated with ${similarTracks.length} tracks`);
    } catch (error) {
      console.error('Failed to start spinoff:', error);
      showToast('Failed to fetch similar tracks');
    } finally {
      setSpinoffLoading(false);
    }
  };

  const exitSpinoff = () => {
    // Set ref immediately to prevent race conditions with handlePlay
    // (state update is async but handlePlay may check spinoffMode before it updates)
    spinoffModeRef.current = false;

    // Abort and cleanup pool context
    abortSchedulerContext('spinoff');

    console.log('🔀 Exiting spinoff mode, restoring previous context...');
    setSpinoffMode(false);
    setSpinoffSourceTrack(null);
    spinoffTracksRef.current = [];
    // Restore the previous playback context (if any)
    const previousContext = spinoffPreviousContextRef.current;
    setPlaybackContext(previousContext);
    spinoffPreviousContextRef.current = null;
    spinoffRefillUrlRef.current = null;
    spinoffRefillEmptyCountRef.current = 0;
    spinoffRefillLastFetchAtRef.current = 0;
    console.log('🔀 Spinoff state cleared, restored context:', previousContext?.type || 'none');
  };



  return {
    // the handlers (call sites keep these names)
    handlePlay,
    handleNext,
    handlePrevious,
    handlePlayPause,
    startSpinoff,
    exitSpinoff,
    // handler refs (protocol handler + embed + tool contexts)
    // engine state back under the old names
    isPlaying,
    setIsPlaying,
    trackLoading,
    setTrackLoading,
    browserPlaybackActive,
    setBrowserPlaybackActive,
    activeExtensionTabId,
    setActiveExtensionTabId,
    currentSource,
    setCurrentSource,
    startTime: startTimeState[0],
    setStartTime,
    isExternalPlayback,
    setIsExternalPlayback,
    showExternalPrompt: showExternalPromptState[0],
    setShowExternalPrompt,
    pendingExternalTrack: pendingExternalTrackState[0],
    setPendingExternalTrack,
    pendingExternalResolverId: pendingExternalResolverIdState[0],
    setPendingExternalResolverId,
    insertedTrackId: insertedTrackIdState[0],
    setInsertedTrackId,
    resolveSpinoffSeed,
      };
}

module.exports = { usePlaybackEngine };
