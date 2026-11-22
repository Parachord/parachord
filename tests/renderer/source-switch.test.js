/**
 * #1607: a source picked in the playbar's Play from menu that can't start
 * leaves the playback as it was. The rule (lib/source-switch.js), then the
 * real engine's handlePlay with two plug-in sources: the one playing and the
 * one picked.
 */
const fs = require('fs');
const path = require('path');
const {
  sourceSwitchMarker,
  switchFailedMessage,
  replayTrackForSwitch,
  heldTrackForSwitch,
} = require('../../src/renderer/lib/source-switch');

const playing = {
  id: 'kara-no-fun', artist: 'Kara Jackson', title: 'no fun', album: 'Why Does the Earth Give',
  sources: {
    oldplug: { id: 'o1', artist: 'Kara Jackson', title: 'no fun', confidence: 1 },
    pickplug: { id: 'p1', artist: 'Kara Jackson', title: 'no fun', confidence: 1 },
  },
  _activeResolver: 'oldplug',
};

describe('sourceSwitchMarker', () => {
  test('a pick of another source of the track playing opens a switch with what to go back to', () => {
    const marker = sourceSwitchMarker({ track: { ...playing, preferredResolver: 'pickplug' }, current: playing, position: 42.5, wasPlaying: true });
    expect(marker).toMatchObject({ to: 'pickplug', from: 'oldplug', track: playing, position: 42.5, wasPlaying: true });
    expect(typeof marker.id).toBe('number');
  });

  test('each switch is its own (a stale marker never matches a newer one)', () => {
    const a = sourceSwitchMarker({ track: { ...playing, preferredResolver: 'pickplug' }, current: playing, position: 1, wasPlaying: true });
    const b = sourceSwitchMarker({ track: { ...playing, preferredResolver: 'pickplug' }, current: playing, position: 1, wasPlaying: true });
    expect(a.id).not.toBe(b.id);
  });

  test('no switch: nothing playing on a source, the same source picked, another track, or no pick', () => {
    const pick = { ...playing, preferredResolver: 'pickplug' };
    expect(sourceSwitchMarker({ track: pick, current: { ...playing, _activeResolver: undefined }, position: 1, wasPlaying: true })).toBeNull();
    expect(sourceSwitchMarker({ track: { ...playing, preferredResolver: 'oldplug' }, current: playing, position: 1, wasPlaying: true })).toBeNull();
    expect(sourceSwitchMarker({ track: { ...pick, id: 'other', title: 'Other' }, current: playing, position: 1, wasPlaying: true })).toBeNull();
    expect(sourceSwitchMarker({ track: { ...playing }, current: playing, position: 1, wasPlaying: true })).toBeNull();
    expect(sourceSwitchMarker({ track: pick, current: null, position: 1, wasPlaying: true })).toBeNull();
  });

  test('a position that is not a number reads as the start', () => {
    expect(sourceSwitchMarker({ track: { ...playing, preferredResolver: 'pickplug' }, current: playing, position: undefined, wasPlaying: false }).position).toBe(0);
  });
});

describe('what the failed switch says and plays', () => {
  test('the message names the pick and the source kept', () => {
    expect(switchFailedMessage({ pickedName: 'Amazon Music', currentName: 'Apple Music', wasPlaying: true }))
      .toBe('Couldn’t play from Amazon Music. Still playing from Apple Music.');
    expect(switchFailedMessage({ pickedName: 'Amazon Music', currentName: 'Apple Music', wasPlaying: false }))
      .toBe('Couldn’t play from Amazon Music. Staying on Apple Music.');
  });

  test('a track that was playing is played again from its own source', () => {
    const replay = replayTrackForSwitch({ from: 'oldplug', track: { ...playing, status: 'playing' } });
    expect(replay).toMatchObject({ id: playing.id, sources: playing.sources, preferredResolver: 'oldplug' });
    expect(replay).not.toHaveProperty('_activeResolver');
    expect(replay).not.toHaveProperty('status');
  });

  test('a paused track goes back on screen on its source, for Play to start there', () => {
    expect(heldTrackForSwitch({ from: 'oldplug', track: playing })).toEqual({ ...playing, preferredResolver: 'oldplug' });
  });
});

// ── the real engine ─────────────────────────────────────────────────────────

const scoring = require('../../sync-providers/confidence-scoring');

function engineWith({ resolvers, current, position = 42, wasPlaying = true }) {
  global.React = require('react');
  global.ReactDOM = require('react-dom');
  const ReactDOMServer = require('react-dom/server');
  global.window = global.window || {};
  global.window.ConfidenceScoring = scoring;
  global.window.resolverLabelById = (id) => ({ oldplug: 'Apple Music', pickplug: 'Amazon Music' }[id] || id);
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
      resolverOrderRef: ref(['oldplug', 'pickplug']),
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

const manifest = (n) => ({ manifest: `<MPD ${n}/>`, type: 'dash', drm: 'widevine', context: { n } });
const pluginResolver = (id, getPlaybackManifest) => ({
  id, name: id, capabilities: { resolve: true, widevine: true }, getPlaybackManifest: jest.fn(getPlaybackManifest),
  relayLicense() { return 'x'; }
});
const refusal = (reason, message = 'refused') => Object.assign(new Error(message), { reason });
const settle = async (rounds = 8) => { for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r)); };
const committed = (setCurrentTrack) => setCurrentTrack.mock.calls.map(([t]) => t).filter((t) => t && typeof t === 'object');
const pick = () => ({ ...playing, preferredResolver: 'pickplug' });

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('handlePlay: a Play from pick that can\'t start keeps the playback (#1607)', () => {
  test('a pick that fails plays the old source again at its position, says so, and shows no error', async () => {
    const old = pluginResolver('oldplug', async () => manifest('old'));
    const picked = pluginResolver('pickplug', async () => { throw refusal('playback-failed', 'manifest budget'); });
    const e = engineWith({ resolvers: [old, picked], current: playing, position: 42 });
    await e.handlePlay(pick(), { sourceSwitch: true });
    await settle();
    expect(e.showConfirmDialog).not.toHaveBeenCalled();
    expect(e.showToast).toHaveBeenCalledWith('Couldn’t play from Amazon Music. Still playing from Apple Music.');
    // The old source plays again, from where it was.
    expect(old.getPlaybackManifest).toHaveBeenCalledTimes(1);
    expect(e.widevine.playPlugin).toHaveBeenCalledTimes(1);
    expect(e.widevine.playPlugin.mock.calls[0][1]).toMatchObject({ resolverId: 'oldplug', startTime: 42 });
    expect(committed(e.setCurrentTrack).pop()).toMatchObject({ id: playing.id, _activeResolver: 'oldplug' });
  });

  test('a plan refusal of the pick keeps the old source too, instead of "playing via" another', async () => {
    const old = pluginResolver('oldplug', async () => manifest('old'));
    const picked = pluginResolver('pickplug', async () => { throw refusal('plan-ineligible'); });
    const e = engineWith({ resolvers: [old, picked], current: playing, position: 42 });
    await e.handlePlay(pick(), { sourceSwitch: true });
    await settle();
    // The plan is still noted: it is a fact about the account.
    expect(window.__parachordNotePlanRefusal).toHaveBeenCalledWith('pickplug', undefined);
    expect(e.showToast.mock.calls.map((c) => c[0])).toEqual(['Couldn’t play from Amazon Music. Still playing from Apple Music.']);
    expect(e.widevine.playPlugin.mock.calls[0][1]).toMatchObject({ resolverId: 'oldplug', startTime: 42 });
  });

  test('a paused track stays paused on its source, at its position, for Play', async () => {
    const old = pluginResolver('oldplug', async () => manifest('old'));
    const picked = pluginResolver('pickplug', async () => { throw refusal('playback-failed'); });
    const e = engineWith({ resolvers: [old, picked], current: playing, position: 42, wasPlaying: false });
    await e.handlePlay(pick(), { sourceSwitch: true });
    await settle();
    expect(e.showToast).toHaveBeenCalledWith('Couldn’t play from Amazon Music. Staying on Apple Music.');
    expect(old.getPlaybackManifest).not.toHaveBeenCalled();
    expect(committed(e.setCurrentTrack).pop()).toEqual({ ...playing, preferredResolver: 'oldplug' });
    expect(e.trackNeedsExplicitStart.current).toBe(true);
    expect(e.pendingStartPositionRef.current).toMatchObject({ position: 42 });
  });

  test('a pick a newer play replaced fails silently and puts nothing back', async () => {
    let failPick;
    const old = pluginResolver('oldplug', async () => manifest('old'));
    const picked = pluginResolver('pickplug', () => new Promise((_, reject) => { failPick = reject; }));
    const e = engineWith({ resolvers: [old, picked], current: playing, position: 42 });
    const switching = e.handlePlay(pick(), { sourceSwitch: true });
    await settle();
    const other = { id: 'other', artist: 'Kara Jackson', title: 'curtains', sources: { oldplug: { id: 'o2', artist: 'Kara Jackson', title: 'curtains', confidence: 1 } } };
    await e.handlePlay(other);
    failPick(refusal('playback-failed'));
    await switching;
    await settle();
    expect(e.showToast).not.toHaveBeenCalled();
    expect(e.showConfirmDialog).not.toHaveBeenCalled();
    expect(old.getPlaybackManifest).toHaveBeenCalledTimes(1); // the newer play's, not a restore
    expect(committed(e.setCurrentTrack).pop()).toMatchObject({ id: 'other' });
  });

  test('a pick that starts plays from the pick, with no message', async () => {
    const old = pluginResolver('oldplug', async () => manifest('old'));
    const picked = pluginResolver('pickplug', async () => manifest('pick'));
    const e = engineWith({ resolvers: [old, picked], current: playing, position: 42 });
    await e.handlePlay(pick(), { sourceSwitch: true });
    await settle();
    expect(e.showToast).not.toHaveBeenCalled();
    expect(e.widevine.playPlugin.mock.calls[0][1]).toMatchObject({ resolverId: 'pickplug' });
    expect(committed(e.setCurrentTrack).pop()).toMatchObject({ _activeResolver: 'pickplug' });
    expect(committed(e.setCurrentTrack).pop()).not.toHaveProperty('_sourceSwitch');
  });

  test('the same refusal on an ordinary play still falls back to another source, as before', async () => {
    const old = pluginResolver('oldplug', async () => manifest('old'));
    const picked = pluginResolver('pickplug', async () => { throw refusal('plan-ineligible'); });
    const e = engineWith({ resolvers: [old, picked], current: null, position: 0, wasPlaying: false });
    await e.handlePlay(pick());
    await settle();
    expect(e.showToast.mock.calls[0][0]).toContain('Playing via Apple Music.');
    expect(e.widevine.playPlugin.mock.calls[0][1]).toMatchObject({ resolverId: 'oldplug' });
  });
});

describe('the wiring', () => {
  const engine = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'hooks', 'use-playback-engine.js'), 'utf8');
  const playbar = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'playbar.js'), 'utf8');
  const start = engine.indexOf('  const handlePlay = async (');
  const body = engine.slice(start, engine.indexOf('\n  };\n', start));

  test('Play from asks for a switch; nothing else does', () => {
    expect(playbar).toContain('handlePlay({ ...currentTrack, preferredResolver: resId }, { sourceSwitch: true });');
    expect(engine.match(/sourceSwitch: true/g) || []).toHaveLength(0);
  });

  test('every fallback to another source inside handlePlay hands a failed switch back first', () => {
    // A fallback re-enters handlePlay with the failed source dropped:
    // handlePlay({ ...trackOrSource, sources: ... }) or handlePlay(fallbackTrack).
    const fallbacks = [...body.matchAll(/handlePlay\((fallbackTrack|\{\n\s*\.\.\.trackOrSource,\n\s*sources: (?!\{ \.\.\.trackOrSource\.sources, spotify: retrySource \}))/g)];
    expect(fallbacks.length).toBeGreaterThanOrEqual(6);
    for (const m of fallbacks) {
      const before = body.slice(Math.max(0, m.index - 2600), m.index);
      expect(before).toMatch(/recoverFailedSwitch\(/);
    }
  });

  test('the shared failure exits hand a failed switch back before skipping, stopping or re-resolving', () => {
    const autoSkip = body.slice(body.indexOf('const autoSkipIfAdvancing = '), body.indexOf('const reportUnplayable = '));
    expect(autoSkip.indexOf('recoverFailedSwitch(')).toBeGreaterThan(-1);
    expect(autoSkip.indexOf('recoverFailedSwitch(')).toBeLessThan(autoSkip.indexOf('stopIfOffline('));
    const offline = body.slice(body.indexOf('const stopIfOffline = '), body.indexOf('const autoSkipIfAdvancing = '));
    expect(offline).toContain('recoverFailedSwitch(');
    const plan = body.slice(body.indexOf('const handlePlanRefusal = '), body.indexOf("console.log('🎵 Playing track:'"));
    expect(plan.indexOf('__parachordNotePlanRefusal')).toBeLessThan(plan.indexOf('recoverFailedSwitch('));
    for (const reresolve of [...body.matchAll(/await resolveTrack\(trackData, artistName, \{ forceRefresh: true \}\);/g)]) {
      expect(body.slice(Math.max(0, reresolve.index - 3200), reresolve.index)).toMatch(/recoverFailedSwitch\(/);
    }
  });

  test('a selection that is not the pick hands the switch back', () => {
    expect(body).toContain("if (switchOpen && resolverId !== switchOpen.to && recoverFailedSwitch('the pick was not selectable')) return;");
  });
});
