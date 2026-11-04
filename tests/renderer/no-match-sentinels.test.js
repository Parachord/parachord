/**
 * A resolver's "tried, found nothing" answer must not outlive the rules that
 * produced it. Two ways it did, both after a scoring change like #1253 (correct
 * multi-artist matches used to score 0.50):
 *
 * - The row said no match and a click said "No Enabled Source": the UI's
 *   `__noMatchAll` marker counted as a source in handlePlay, which skipped the
 *   on-demand resolve that would have found the track under the current rules.
 * - The 24h background check never cleared it: it compared resolver ids with
 *   sentinels included, so `{ a: noMatch }` against a fresh `{ a: real }` read
 *   as "unchanged", kept the sentinel and refreshed its timestamp.
 */

const fs = require('fs');
const path = require('path');

const { playableSourceIds, sourcesChangedOnRecheck } = require('../../src/renderer/lib/playback-helpers');
const scoring = require('../../sync-providers/confidence-scoring');

const ROOT = path.join(__dirname, '..', '..');
const SENTINEL = { noMatch: true, resolvedAt: 1 };
const REAL = { title: 'Song', artist: 'A', confidence: 0.95 };

describe('playableSourceIds', () => {
  test('keeps real sources and drops sentinels, the UI marker and empty entries', () => {
    expect(playableSourceIds({ a: REAL, b: SENTINEL, __noMatchAll: true, c: null })).toEqual(['a']);
  });

  test('nothing to play in an all-sentinel, marker-only or missing object', () => {
    expect(playableSourceIds({ a: SENTINEL })).toEqual([]);
    expect(playableSourceIds({ __noMatchAll: true })).toEqual([]);
    expect(playableSourceIds(undefined)).toEqual([]);
  });
});

describe('sourcesChangedOnRecheck', () => {
  test('a resolver that now matches is a change, even when its sentinel held the same id', () => {
    expect(sourcesChangedOnRecheck({ a: SENTINEL }, { a: REAL })).toBe(true);
    expect(sourcesChangedOnRecheck({ a: REAL, b: SENTINEL }, { a: REAL, b: REAL })).toBe(true);
  });

  test('a resolver that still finds nothing is not a change', () => {
    expect(sourcesChangedOnRecheck({ a: SENTINEL }, {})).toBe(false);
    expect(sourcesChangedOnRecheck({ a: REAL, b: SENTINEL }, { a: REAL })).toBe(false);
  });

  test('gaining or losing a real source is a change, whatever the order', () => {
    expect(sourcesChangedOnRecheck({}, { a: REAL })).toBe(true);
    expect(sourcesChangedOnRecheck({ a: REAL }, {})).toBe(true);
    expect(sourcesChangedOnRecheck({ b: REAL, a: REAL }, { a: REAL, b: REAL })).toBe(false);
  });

  test('validateCachedSources decides with it', () => {
    const app = fs.readFileSync(path.join(ROOT, 'src/renderer/app.js'), 'utf8');
    expect(app).toContain('const sourcesChanged = sourcesChangedOnRecheck(cachedSources, freshSources);');
  });
});

describe('handlePlay on a row marked no match', () => {
  const realConfidenceScoring = scoring;

  // Runs the real hook under renderToStaticMarkup (see use-playback-engine.test.js)
  // and hands back handlePlay with the resolver and dialog surface stubbed.
  function engineWith(resolver) {
    global.React = require('react');
    global.ReactDOM = require('react-dom');
    const ReactDOMServer = require('react-dom/server');
    global.window = global.window || {};
    global.window.ConfidenceScoring = realConfidenceScoring;

    const { usePlaybackEngine } = require('../../src/renderer/hooks/use-playback-engine.js');
    const ref = (current = null) => ({ current });
    const noop = () => {};
    const showConfirmDialog = jest.fn();
    const queueTrackSources = jest.fn();

    const volume = { volumeRef: ref(1), isMutedRef: ref(false), resolverVolumeOffsets: {}, getEffectiveVolume: (x) => x, setSpotifyVolume: noop };
    const queue = { currentTrack: null, currentTrackRef: ref(), currentQueueRef: ref([]), setCurrentTrack: noop, setCurrentQueue: noop, playbackContext: null, setPlaybackContext: noop, playHistoryRef: ref([]) };
    const ctx = {
      resolvers: {
        loadedResolversRef: ref([resolver]),
        activeResolversRef: ref([resolver.id]),
        resolverOrderRef: ref([resolver.id]),
        resolverBlocklistRef: ref([]),
        resolverConfigCache: ref({}),
        getResolverConfigRef: ref(async () => ({})),
        resolveTrackRef: ref(async () => ({})),
        confidenceForSourceRef: ref((target, source) => scoring.calculateConfidence(target, source)),
        isHtml5StreamResolver: () => false,
        findLoadedResolver: (id) => (id === resolver.id ? resolver : undefined),
        usesSharedAudio: () => false,
        resolveTracksInBackground: noop,
        buildProtocolFetchHeaders: noop,
        lastfmFetch: noop,
        getLastfmApiKey: noop,
        getArtistTopTracksRef: ref(),
        keyForSpinoffDedupRef: ref(),
        refreshSpotifyTokenRef: ref(),
        startAutoAdvancePollingRef: ref(noop),
      },
      enrichment: {
        trackSources: {},
        queueTrackSources,
        lookupMbidMapper: async () => null,
        enrichTrackWithMbid: noop,
        fetchArtworkViaMbid: noop,
        getAlbumArtRef: ref(noop),
        getCachedAlbumArtRef: ref(noop),
        forgetMissingLocalFile: noop,
        showExternalTrackPromptUIRef: ref(noop),
      },
      ui: { showToast: noop, showConfirmDialog, setActiveView: noop, setSettingsTab: noop },
      scheduling: { updateSchedulerVisibility: noop, abortSchedulerContext: noop, registerPoolContext: noop, setSchedulerPlaybackIndex: noop },
    };

    let handlePlay;
    const Probe = () => {
      const out = usePlaybackEngine({
        volume, queue, ctx,
        audioRef: ref(), localFileSeekTargetRef: ref(), progressRef: ref(), seekingRef: ref(),
        isPlayingRef: ref(false), streamingPlaybackActiveRef: ref(false),
        spotifyToken: null, extensionConnected: null, audioContext: null,
        spinoffMode: false, setSpinoffMode: noop, spinoffSourceTrack: null, setSpinoffSourceTrack: noop, setSpinoffLoading: noop,
        spinoffModeRef: ref(false), spinoffSourceTrackRef: ref(),
        handleNextRef: ref(noop), handlePreviousRef: ref(noop), handlePlayPauseRef: ref(noop), handlePlayRef: ref(noop),
        startSpinoffRef: ref(), playbackPollerRef: ref(), pollingRecoveryRef: ref(), externalTrackTimeoutRef: ref(),
        externalTrackIntervalRef: ref(), waitingForBrowserPlaybackRef: ref(), pendingCloseTabIdRef: ref(),
        trackNeedsExplicitStart: ref(), spotifyProgressBaselineRef: ref(),
        listenAlongFriend: null, setListenAlongFriend: noop, listenAlongFriendRef: ref(), listenAlongLastTrackRef: ref(),
        listenAlongPendingTrackRef: ref(), listenAlongUserPausedRef: ref(), listenAlongEndAfterSongRef: ref(),
      });
      handlePlay = out.handlePlay;
      return null;
    };
    ReactDOMServer.renderToStaticMarkup(global.React.createElement(Probe));
    return { handlePlay, showConfirmDialog, queueTrackSources };
  }

  const titles = (dialog) => dialog.mock.calls.map(([d]) => d.title);
  const track = (sources) => ({ id: 't1', artist: 'Erykah Badu and The Alchemist', title: 'Song', sources });
  const resolverFinding = (hits) => ({
    id: 'testres',
    name: 'Test',
    capabilities: { resolve: true },
    search: jest.fn(async () => hits),
    resolve: jest.fn(async () => hits[0] || null),
    play: jest.fn(async () => true),
  });
  const HIT = { id: 'x', title: 'Song', artist: 'Erykah Badu & The Alchemist' };

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  test('resolves on demand and finds the track the old rules rejected', async () => {
    const resolver = resolverFinding([HIT]);
    const { handlePlay, showConfirmDialog, queueTrackSources } = engineWith(resolver);

    await handlePlay(track({ __noMatchAll: true })).catch(() => {});

    expect(resolver.search).toHaveBeenCalled();
    expect(queueTrackSources).toHaveBeenCalledWith('t1', expect.objectContaining({ testres: expect.anything() }), expect.anything());
    expect(titles(showConfirmDialog)).not.toContain('No Enabled Source');
  });

  test('says no source was found, not that the settings are wrong, when nothing matches', async () => {
    const resolver = resolverFinding([]);
    const { handlePlay, showConfirmDialog } = engineWith(resolver);

    await handlePlay(track({ __noMatchAll: true })).catch(() => {});

    expect(titles(showConfirmDialog)).toEqual(['No Source Found']);
  });
});
