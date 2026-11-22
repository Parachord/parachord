/**
 * #1612: a plug-in that hands the host a plain stream as well as its DRM
 * pair (getStreamUrl beside getPlaybackManifest/relayLicense: Amazon's
 * bought tracks from the library locker) plays that stream when the DRM
 * stream doesn't start. Never after a plan refusal (the track isn't the
 * account's), a sign-in prompt, or a newer play. The real engine's
 * handlePlay, with the player stubbed.
 */
const fs = require('fs');
const path = require('path');

const scoring = require('../../sync-providers/confidence-scoring');

function engineWith({ resolvers, current, position = 42, wasPlaying = true }) {
  global.React = require('react');
  global.ReactDOM = require('react-dom');
  const ReactDOMServer = require('react-dom/server');
  global.window = global.window || {};
  global.window.ConfidenceScoring = scoring;
  global.window.resolverLabelById = (id) => ({ drmplug: 'Amazon Music' }[id] || id);
  global.window.__parachordNotePlanRefusal = jest.fn(() => 'Amazon Music needs Music Unlimited.');

  const { usePlaybackEngine } = require('../../src/renderer/hooks/use-playback-engine.js');
  let liveToken = 0;
  const widevine = {
    play: jest.fn(async () => ({ token: 101 })),
    claimPlayToken: jest.fn(() => (liveToken += 1)),
    playPlugin: jest.fn(async (_el, opts) => {
      if (opts && typeof opts.token === 'number' && opts.token !== liveToken) {
        const err = new Error('widevine: play superseded');
        err.reason = 'superseded';
        throw err;
      }
      return { token: 202 };
    }),
    untilAudible: () => new Promise(() => {}),
    stop: jest.fn(async () => { liveToken += 1; return { stopped: true }; }),
    currentVariantFacts: () => null,
    getState: () => ({ activeResolverId: null })
  };
  global.window.__parachordWidevine = widevine;

  const ref = (value = null) => ({ current: value });
  const noop = () => {};
  const showConfirmDialog = jest.fn();
  const showToast = jest.fn();
  const setCurrentTrack = jest.fn();
  const pendingStartPositionRef = ref(null);
  const trackNeedsExplicitStart = ref(false);
  const audioEl = {
    volume: 1, currentTime: 0, duration: 0,
    play: jest.fn(() => Promise.resolve()), pause: jest.fn(), load: jest.fn(),
    addEventListener: jest.fn(), removeEventListener: jest.fn()
  };
  const ids = resolvers.map((r) => r.id);
  const volume = { volumeRef: ref(80), isMutedRef: ref(false), resolverVolumeOffsets: {}, getEffectiveVolume: (x) => x, setSpotifyVolume: noop };
  const queue = {
    currentTrack: current, currentTrackRef: ref(current), currentQueueRef: ref([]), setCurrentTrack, setCurrentQueue: noop,
    playbackContext: null, setPlaybackContext: noop, playHistoryRef: ref([]), playRequestedRef: ref(false),
    shuffleModeRef: ref(false), originalQueueRef: ref([]), repeatModeRef: ref('off'), playedSinceWrapRef: ref(false)
  };
  const ctx = {
    resolvers: {
      loadedResolversRef: ref(resolvers),
      activeResolversRef: ref(ids),
      resolverOrderRef: ref(ids),
      resolverBlocklistRef: ref([]),
      resolverConfigCache: ref({}),
      getResolverConfigRef: ref(async () => ({})),
      resolveTrackRef: ref(async () => ({})),
      confidenceForSourceRef: ref((target, source) => scoring.calculateConfidence(target, source)),
      isHtml5StreamResolver: () => false,
      isWidevineResolver: (id) => ids.includes(id),
      findLoadedResolver: (id) => resolvers.find((r) => r.id === id),
      usesSharedAudio: () => false,
      embedPlayerKind: () => null,
      resolveTracksInBackground: noop,
      buildProtocolFetchHeaders: noop,
      findSimilarTracksRef: { current: null },
      findSimilarArtistsRef: { current: null },
      getArtistTopTracksRef: ref(),
      keyForSpinoffDedupRef: ref(),
      refreshSpotifyTokenRef: ref(),
      startAutoAdvancePollingRef: ref(noop),
    },
    enrichment: {
      trackSources: {},
      queueTrackSources: jest.fn(),
      lookupMbidMapper: async () => null,
      enrichTrackWithMbid: noop,
      fetchArtworkViaMbid: noop,
      getAlbumArtRef: ref(noop),
      getCachedAlbumArtRef: ref(noop),
      forgetMissingLocalFile: noop,
      showExternalTrackPromptUIRef: ref(noop),
    },
    ui: { showToastRef: ref(showToast), showConfirmDialog, setActiveView: noop, setSettingsTab: noop, setProgress: jest.fn() },
    scheduling: { updateSchedulerVisibility: noop, abortSchedulerContext: noop, registerPoolContext: noop, setSchedulerPlaybackIndex: noop },
  };

  let handlePlay;
  const Probe = () => {
    const out = usePlaybackEngine({
      volume, queue, ctx,
      audioRef: ref(audioEl), localFileSeekTargetRef: ref(), progressRef: ref(position), seekingRef: ref(),
      isPlayingRef: ref(wasPlaying), streamingPlaybackActiveRef: ref(false),
      pendingStartPositionRef,
      spotifyToken: null, extensionConnected: null, audioContext: null,
      spinoffMode: false, setSpinoffMode: noop, spinoffSourceTrack: null, setSpinoffSourceTrack: noop, setSpinoffLoading: noop,
      spinoffModeRef: ref(false), spinoffSourceTrackRef: ref(),
      handleNextRef: ref(noop), handlePreviousRef: ref(noop), handlePlayPauseRef: ref(noop), handlePlayRef: ref(noop),
      startSpinoffRef: ref(), playbackPollerRef: ref(), pollingRecoveryRef: ref(), externalTrackTimeoutRef: ref(),
      externalTrackIntervalRef: ref(), waitingForBrowserPlaybackRef: ref(), pendingCloseTabIdRef: ref(),
      trackNeedsExplicitStart, spotifyProgressBaselineRef: ref(),
      listenAlongFriend: null, setListenAlongFriend: noop, listenAlongFriendRef: ref(), listenAlongLastTrackRef: ref(),
      listenAlongPendingTrackRef: ref(), listenAlongUserPausedRef: ref(), listenAlongEndAfterSongRef: ref(),
    });
    handlePlay = out.handlePlay;
    return null;
  };
  ReactDOMServer.renderToStaticMarkup(global.React.createElement(Probe));
  return { handlePlay, widevine, setCurrentTrack, showConfirmDialog, showToast, pendingStartPositionRef, trackNeedsExplicitStart };
}


const track = {
  id: 'bought', artist: 'Kara Jackson', title: 'no fun',
  sources: { drmplug: { id: 'd1', artist: 'Kara Jackson', title: 'no fun', confidence: 1, amazonAsin: 'B0OWNED001' } },
};
const STREAM = 'https://cdn.example/obj.mp3?Signature=s';
const drmPlugin = ({ manifest, streamUrl }) => ({
  id: 'drmplug', name: 'drmplug', capabilities: { resolve: true, widevine: true },
  getPlaybackManifest: jest.fn(manifest),
  relayLicense() { return 'x'; },
  ...(streamUrl ? { getStreamUrl: jest.fn(streamUrl) } : {}),
});
const refusal = (reason, message = 'refused') => Object.assign(new Error(message), { reason });
const settle = async (rounds = 8) => { for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r)); };
const committed = (setCurrentTrack) => setCurrentTrack.mock.calls.map(([t]) => t).filter((t) => t && typeof t === 'object');

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('handlePlay: the DRM stream didn\'t start, the plug-in\'s plain stream plays (#1612)', () => {
  test('a failed DRM play falls back to getStreamUrl on the same source, with no error', async () => {
    const plugin = drmPlugin({ manifest: async () => { throw refusal('playback-failed', 'licence refused'); }, streamUrl: async () => STREAM });
    const e = engineWith({ resolvers: [plugin], current: null, position: 0, wasPlaying: false });
    await e.handlePlay(track);
    await settle();
    expect(plugin.getStreamUrl).toHaveBeenCalledTimes(1);
    expect(plugin.getStreamUrl.mock.calls[0][0]).toMatchObject({ amazonAsin: 'B0OWNED001' });
    expect(e.showConfirmDialog).not.toHaveBeenCalled();
    expect(committed(e.setCurrentTrack).pop()).toMatchObject({ id: 'bought', _activeResolver: 'drmplug' });
  });

  test('no plain stream for the track (not a purchase): the DRM failure\'s own message', async () => {
    const plugin = drmPlugin({ manifest: async () => { throw refusal('playback-failed'); }, streamUrl: async () => null });
    const e = engineWith({ resolvers: [plugin], current: null, position: 0, wasPlaying: false });
    await e.handlePlay(track);
    await settle();
    expect(e.showConfirmDialog).toHaveBeenCalledWith(expect.objectContaining({ title: 'Couldn’t play the track' }));
    expect(e.showConfirmDialog.mock.calls[0][0].title).not.toMatch(/Not Configured/);
  });

  test('a plan refusal never tries the plain stream (the track isn\'t the account\'s)', async () => {
    const plugin = drmPlugin({ manifest: async () => { throw refusal('plan-ineligible'); }, streamUrl: async () => STREAM });
    const e = engineWith({ resolvers: [plugin], current: null, position: 0, wasPlaying: false });
    await e.handlePlay(track);
    await settle();
    expect(plugin.getStreamUrl).not.toHaveBeenCalled();
  });

  test('a DRM play that starts never asks for the plain stream', async () => {
    const plugin = drmPlugin({ manifest: async () => ({ manifest: '<MPD/>', type: 'dash', drm: 'widevine', context: {} }), streamUrl: async () => STREAM });
    const e = engineWith({ resolvers: [plugin], current: null, position: 0, wasPlaying: false });
    await e.handlePlay(track);
    await settle();
    expect(plugin.getStreamUrl).not.toHaveBeenCalled();
    expect(e.widevine.playPlugin).toHaveBeenCalledTimes(1);
  });

  test('a plug-in without getStreamUrl fails as before', async () => {
    const plugin = drmPlugin({ manifest: async () => { throw refusal('playback-failed'); } });
    const e = engineWith({ resolvers: [plugin], current: null, position: 0, wasPlaying: false });
    await e.handlePlay(track);
    await settle();
    expect(e.showConfirmDialog).toHaveBeenCalledWith(expect.objectContaining({ title: 'Couldn’t play the track' }));
  });
});

describe('the wiring', () => {
  const engine = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'hooks', 'use-playback-engine.js'), 'utf8');
  test('the fallback is chosen by the method, never by an id, and only past the plan, sign-in and supersession exits', () => {
    const branch = engine.slice(engine.indexOf('widevinePath: if (isWidevineResolver(resolverId)) {'));
    expect(branch.length).toBeGreaterThan(100);
    const fallback = branch.indexOf("if (typeof resolver.getStreamUrl === 'function') {");
    expect(fallback).toBeGreaterThan(branch.indexOf('if (handlePlanRefusal(error, resolverId, streamLabel)) return;'));
    expect(fallback).toBeGreaterThan(branch.indexOf("error.reason === 'not-signed-in'"));
    expect(engine).toContain('if (drmFallback || isHtml5StreamResolver(resolverId)) {');
  });
});
