/**
 * usePlaybackEngine Node render probe — the destructure-contract guard for the
 * playback-engine hook (Track 2b slice 3, parachord#1098).
 *
 * Same discipline as the slice-1/2 probes: names are derived from the actual
 * `const { ... } = usePlaybackEngine({` destructure in src/renderer/app.js
 * (backward-walk position scan, not regex — see use-volume.test.js's note),
 * then each name is checked present on the hook return. Only ReferenceErrors
 * fail. renderToStaticMarkup runs no effects (the restrict below matters:
 * the engine's effect/EIPC registrations (embed bridge, pollers) never run,
 * so no electron stubbing is needed beyond the hook-body's one window read
 * (the ConfidenceScoring side-load).
 */

const fs = require('fs');
const path = require('path');

const { usePlaybackEngine } = require('../../src/renderer/hooks/use-playback-engine.js');

// Position-based derivation (walk BACK from the 2-space close marker; see
// use-volume.test.js). The engine call's close is the normal `} = useX({`
// shape (not an object-alias close like slices 1/2's volumeDomain).
function destructureKeysFrom(src, closeMarker) {
  const closeIdx = src.indexOf(closeMarker);
  if (closeIdx === -1) {
    throw new Error(closeMarker + ' not found — the hook call moved or changed shape');
  }
  const openIdx = src.lastIndexOf('\n  const {\n', closeIdx);
  if (openIdx === -1) {
    throw new Error(closeMarker + ' opening not found');
  }
  return src
    .slice(openIdx + '\n  const {\n'.length, closeIdx)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\w+(\s+as\s+\w+)?$/.test(s))
    .map((s) => s.split(/\s+as\s+/).pop());
}

const appSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');
const EXPECTED_KEYS = destructureKeysFrom(appSrc, '  } = usePlaybackEngine({');

// Guard direction note: the probe checks hook-returns-everything-destructure-
// expects. The reverse (destructure drops a name) stays the maintainer's live
// audit, matching the earlier slices' accepted trade-off.

describe('usePlaybackEngine (Node render probe)', () => {
  test('module loads and returns every name app.js destructures, with a stubbed input surface', () => {
    expect(EXPECTED_KEYS.length).toBeGreaterThan(25);

    global.React = require('react');
    global.ReactDOM = require('react-dom');
    const ReactDOMServer = require('react-dom/server');
    // The module hook-body destructures window.ConfidenceScoring (the
    // dual-load module index.html loads before app.js).
    global.window = global.window || {};
    global.window.ConfidenceScoring = {
      normalizeStr: (s) => s,
      validateResolvedTrack: () => true,
      MIN_CONFIDENCE_THRESHOLD: 0.6,
    };

    const ref = () => ({ current: null });
    const noop = () => {};
    const volume = {
      volumeRef: ref(),
      isMutedRef: ref(),
      resolverVolumeOffsets: {},
      getEffectiveVolume: (x) => x,
      setSpotifyVolume: noop,
    };
    const queue = {
      currentTrack: null,
      currentTrackRef: ref(),
      currentQueueRef: ref(),
      setCurrentTrack: noop,
      setCurrentQueue: noop,
      playbackContext: null,
      setPlaybackContext: noop,
      playHistoryRef: ref(),
    };
    const ctx = {
      resolvers: {
        loadedResolversRef: ref(),
        activeResolversRef: ref(),
        resolverOrderRef: ref(),
        resolverBlocklistRef: ref(),
        resolverConfigCache: ref(),
        getResolverConfigRef: ref(),
        resolveTrackRef: ref(),
        confidenceForSourceRef: ref(),
        isHtml5StreamResolver: noop,
        findLoadedResolver: noop,
        usesSharedAudio: noop,
        resolveTracksInBackground: noop,
        buildProtocolFetchHeaders: noop,
        lastfmFetch: noop,
        getLastfmApiKey: noop,
        getArtistTopTracksRef: ref(),
        keyForSpinoffDedupRef: ref(),
        refreshSpotifyTokenRef: ref(),
        startAutoAdvancePollingRef: ref(),
      },
      enrichment: {
        trackSources: {},
        queueTrackSources: noop,
        lookupMbidMapper: noop,
        enrichTrackWithMbid: noop,
        fetchArtworkViaMbid: noop,
        getAlbumArtRef: ref(),
        getCachedAlbumArtRef: ref(),
        forgetMissingLocalFile: noop,
        showExternalTrackPromptUIRef: ref(),
      },
      ui: { showToast: noop, showConfirmDialog: noop, setActiveView: noop, setSettingsTab: noop },
      scheduling: {
        updateSchedulerVisibility: noop,
        abortSchedulerContext: noop,
        registerPoolContext: noop,
        setSchedulerPlaybackIndex: noop,
      },
    };

    const Probe = () => {
      const out = usePlaybackEngine({
        volume,
        queue,
        ctx,
        audioRef: ref(),
        localFileSeekTargetRef: ref(),
        progressRef: ref(),
        seekingRef: ref(),
        isPlayingRef: ref(),
        streamingPlaybackActiveRef: ref(),
        spotifyToken: null,
        extensionConnected: null,
        audioContext: null,
        spinoffMode: false,
        setSpinoffMode: noop,
        spinoffSourceTrack: null,
        setSpinoffSourceTrack: noop,
        setSpinoffLoading: noop,
        spinoffModeRef: ref(),
        spinoffSourceTrackRef: ref(),
        handleNextRef: ref(),
        handlePreviousRef: ref(),
        handlePlayPauseRef: ref(),
        handlePlayRef: ref(),
        startSpinoffRef: ref(),
        playbackPollerRef: ref(),
        pollingRecoveryRef: ref(),
        externalTrackTimeoutRef: ref(),
        externalTrackIntervalRef: ref(),
        waitingForBrowserPlaybackRef: ref(),
        pendingCloseTabIdRef: ref(),
        trackNeedsExplicitStart: ref(),
        spotifyProgressBaselineRef: ref(),
        listenAlongFriend: null,
        setListenAlongFriend: noop,
        listenAlongFriendRef: ref(),
        listenAlongLastTrackRef: ref(),
        listenAlongPendingTrackRef: ref(),
        listenAlongUserPausedRef: ref(),
        listenAlongEndAfterSongRef: ref(),
      });
      for (const key of EXPECTED_KEYS) {
        if (out[key] === undefined) throw new Error('usePlaybackEngine did not return "' + key + '"');
      }
      return out.isPlaying;
    };

    expect(() => ReactDOMServer.renderToStaticMarkup(global.React.createElement(Probe))).not.toThrow();
  });
});
