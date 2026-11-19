// The engine's plugin-mediated DRM branch (#1356 M4): a capabilities.widevine
// resolver that implements getPlaybackManifest + relayLicense supplies the
// manifest renderer-side, and the host stops pre-extracting amazonAsin on
// that path — the plugin digs its own identifier out of the WHOLE track the
// engine hands it. Marker practice for the engine (the same seam
// resume-starts-at-position.test.js and failed-play-hold.test.js use): the
// branch runs inside handlePlay's full app wiring, so the structural facts
// are pinned here and the runtime behaviour (the play/load/relay loop) in
// widevine-player.test.js's playPlugin describes.

const fs = require('fs');
const path = require('path');

const engine = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'renderer', 'hooks', 'use-playback-engine.js'), 'utf8');
const player = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'renderer', 'lib', 'widevine-player.js'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '..', '..', 'preload.js'), 'utf8');
const bridge = fs.readFileSync(path.join(__dirname, '..', '..', 'main-process', 'widevine-bridge.js'), 'utf8');

describe('the plugin path gate (checked by presence, like every capability gate)', () => {
  test('the branch takes the plugin path only when the resolver implements BOTH methods', () => {
    expect(engine).toContain(
      "const pluginWidevine = typeof resolver.getPlaybackManifest === 'function'\n        && typeof resolver.relayLicense === 'function';"
    );
  });

  test('the host stops pre-extracting the identifier on the plugin path: the asin dig is provider-path-only', () => {
    // The dig lives inside the `if (!pluginWidevine)` guard, nowhere else.
    const dig = engine.indexOf('trackOrSource.sources?.[resolverId]?.amazonAsin');
    expect(dig).toBeGreaterThan(-1);
    const guard = engine.indexOf('if (!pluginWidevine) {');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(dig);
    // And the whole plugin arm extracts nothing: the call passes the whole
    // track, and no amazonAsin/asin dig appears in it (trackContext's
    // albumAsin is telemetry, not the play identifier).
    const armStart = engine.indexOf('if (pluginWidevine) {');
    const arm = engine.slice(armStart, engine.indexOf('} else {', armStart));
    expect(arm).toContain('resolver.getPlaybackManifest({ ...trackOrSource }, pluginConfig)');
    expect(arm).not.toContain('amazonAsin');
    expect(arm).not.toContain('trackOrSource.asin');
  });

  test('the plugin arm passes the WHOLE track (with its sources map) plus the resolver config, under a time budget', () => {
    expect(engine).toContain('const pluginConfig = await getResolverConfig(resolverId);');
    // The budget (#1356 M4 review): a plugin hung in its manifest fetch must
    // not leave trackLoading up forever — the fetch runs inside a race that
    // rejects with a clear playback-failed error past the budget.
    expect(engine).toContain('const PLUGIN_MANIFEST_BUDGET_MS = 10000;');
    const arm = engine.indexOf('if (pluginWidevine) {');
    const race = engine.indexOf('await Promise.race([', arm);
    const call = engine.indexOf('resolver.getPlaybackManifest({ ...trackOrSource }, pluginConfig)', arm);
    const budget = engine.indexOf('PLUGIN_MANIFEST_BUDGET_MS', race);
    expect(race).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(race);
    expect(budget).toBeGreaterThan(call);
  });

  test('the plugin arm claims the play token BEFORE the manifest fetch (a bare stop() during it is supersession)', () => {
    const claim = engine.indexOf('window.__parachordWidevine.claimPlayToken();');
    const fetch = engine.indexOf('resolver.getPlaybackManifest({ ...trackOrSource }, pluginConfig)');
    expect(claim).toBeGreaterThan(-1);
    expect(fetch).toBeGreaterThan(claim);
    // The claimed token rides into playPlugin, which refuses it when stale.
    expect(engine).toContain('token: claimedToken,');
  });

  test('the plugin arm hands the reply to playPlugin with the resolver\'s relayLicense, BOUND to the resolver', () => {
    // Bound because the licence router calls it detached, and plugin methods
    // use `this.` freely (the subsonic plugin does).
    expect(engine).toContain('window.__parachordWidevine.playPlugin(audioRef.current, {\n            resolverId,\n            manifestResult,\n            // Bound: the router calls it detached later, and plugin methods\n            // use `this.` freely (the subsonic plugin does).\n            relayLicense: resolver.relayLicense.bind(resolver),\n            // The token claimed above the manifest fetch: a play that a\n            // stop() superseded during the fetch is refused here.\n            token: claimedToken,\n            startTime: startAt,');
  });

  test('the plugin arm hands its player-event handler (telemetry) to playPlugin, bound the same way', () => {
    // #1356 M9: on the plugin path no main-side provider exists to receive
    // the bridge's player-event channel, so the engine hands the plugin's
    // handlePlayerEvent to the shared engine (fanout beside the bridge IPC,
    // whose session-close bookkeeping stays main-owned).
    expect(engine).toContain("playerEvents: typeof resolver.handlePlayerEvent === 'function'\n              ? resolver.handlePlayerEvent.bind(resolver)\n              : null,");
  });

  test('the provider fallback is intact: the provider play call and its entity are unchanged', () => {
    expect(engine).toMatch(/__parachordWidevine\.play\(audioRef\.current, \{\s*resolverId,\s*startTime: startAt,\s*entity: \{ asin \},/);
  });

  test('the plugin rejections route through the shared handlers: plan refusal and the sign-in prompt-retry both key on .reason', () => {
    // The catch below startWidevine is shared by both arms (one try around
    // startWidevine); pin that the plan-refusal and not-signed-in handlers
    // still read the thrown error, whose fields survive the plugin boundary
    // because getPlaybackManifest is a direct renderer call.
    const tryIdx = engine.indexOf('await startWidevine();');
    const catchIdx = engine.indexOf('} catch (error) {', tryIdx);
    const catchBody = engine.slice(catchIdx, catchIdx + 2600);
    expect(catchBody).toContain("error.reason === 'superseded'");
    expect(catchBody).toContain('handlePlanRefusal(error, resolverId, streamLabel)');
    expect(catchBody).toContain("error.reason === 'not-signed-in'");
  });
});

describe('the seams the engine relies on below it', () => {
  test('the player exposes playPlugin + claimPlayToken and registers the licence router through the preload surface', () => {
    expect(player).toContain('async function playPlugin(audio, { resolverId, manifestResult, relayLicense, playerEvents, trackContext, startTime, token } = {}) {');
    expect(player).toContain('bridge.onPluginLicenseRequest(async (request) => {');
    // The router answers from the record taken at open-session time (before
    // the load — Shaka asks for the first licence mid-load) and hands the
    // plugin its own context, held renderer-side.
    expect(player).toContain('record.relayLicense(request.challenge, record.context)');
    expect(player).toContain('function claimPlayToken() {');
  });

  test('the player routes lifecycle events to the plugin alongside the bridge IPC (the reply\'s asin rides the entity seam)', () => {
    // #1356 M9: telemetry is plugin-owned on the plugin path — the bridge
    // player-event call stays (main's matched session close), and the plugin's
    // handler fans out beside it. The reply's asin fills the entity the
    // play-started event reads, so the plugin's telemetry attributes the
    // served pressing without plugin-side track memory.
    expect(player).toContain('trackSession.pluginEvents(event)');
    expect(player).toContain('entity: typeof reply.asin === \'string\' && reply.asin ? { asin: reply.asin } : {},');
  });

  test('the preload exposes openSession (by manifest LENGTH) + onPluginLicenseRequest on window.electron.widevine', () => {
    expect(preload).toContain('openSession: (resolverId, manifestLength, type, drm) =>');
    expect(preload).toContain('onPluginLicenseRequest: (callback) => {');
    expect(preload).toContain("ipcRenderer.on('widevine:plugin-license', handler);");
  });

  test('the bridge opens plugin sessions under the provider gates (rate window shared, minted before any await)', () => {
    expect(bridge).toContain("ipcMain.handle('widevine:open-session'");
    expect(bridge).toContain('markManifestForRateLimit(resolverId)');
    // The forward carries the challenge and its ids only — no context rides
    // the broadcast any renderer code can subscribe to.
    expect(bridge).toContain("sender.send('widevine:plugin-license', { requestId, resolverId, sessionId, challenge })");
  });
});

// ── behavioural: the real hook's widevine dispatch, driven end to end ───────
//
// The no-match-sentinels.test.js harness — the real hook rendered under
// ReactDOMServer.renderToStaticMarkup (no effects), handlePlay handed back
// with the resolver and UI surfaces stubbed — plus the widevine additions:
// isWidevineResolver keyed on the capability (app.js's own definition), a
// STUBBED window.__parachordWidevine (the hook's module require installs the
// real player on window; the stub replaces it after — the seams pinned here
// are playPlugin/play/stop, not Shaka), and a pre-seeded shared element so
// ensureSharedAudioElement never needs a DOM.
const scoring = require('../../sync-providers/confidence-scoring');

function widevineEngineWith(resolver) {
  global.React = require('react');
  global.ReactDOM = require('react-dom');
  const ReactDOMServer = require('react-dom/server');
  global.window = global.window || {};
  global.window.ConfidenceScoring = scoring;

  const { usePlaybackEngine } = require('../../src/renderer/hooks/use-playback-engine.js');
  // The stub models the real player's token contract (widevine-player.js):
  // claimPlayToken mints the play's token, stop() invalidates every
  // in-flight one, and playPlugin refuses a token a stop has since
  // invalidated (the engine passes the claimed one through).
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
    untilAudible: () => new Promise(() => {}), // the race resolves via the element's play()
    stop: jest.fn(async () => { liveToken += 1; return { stopped: true }; }),
    currentVariantFacts: () => null,
    getState: () => ({ activeResolverId: null })
  };
  global.window.__parachordWidevine = widevine;

  const ref = (current = null) => ({ current });
  const noop = () => {};
  const showConfirmDialog = jest.fn();
  const showToast = jest.fn();
  const setCurrentTrack = jest.fn();
  const audioEl = {
    volume: 1, currentTime: 0, duration: 0,
    play: jest.fn(() => Promise.resolve()), pause: jest.fn(), load: jest.fn(),
    addEventListener: jest.fn(), removeEventListener: jest.fn()
  };

  const volume = { volumeRef: ref(80), isMutedRef: ref(false), resolverVolumeOffsets: {}, getEffectiveVolume: (x) => x, setSpotifyVolume: noop };
  const queue = {
    currentTrack: null, currentTrackRef: ref(), currentQueueRef: ref([]), setCurrentTrack, setCurrentQueue: noop,
    playbackContext: null, setPlaybackContext: noop, playHistoryRef: ref([]), playRequestedRef: ref(false),
    shuffleModeRef: ref(false), originalQueueRef: ref([]), repeatModeRef: ref('off'), playedSinceWrapRef: ref(false)
  };
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
      // app.js's own definition: the capability keys the branch.
      isWidevineResolver: (id) => resolver.id === id && resolver.capabilities?.widevine === true,
      findLoadedResolver: (id) => (id === resolver.id ? resolver : undefined),
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
      audioRef: ref(audioEl), localFileSeekTargetRef: ref(), progressRef: ref(), seekingRef: ref(),
      isPlayingRef: ref(false), streamingPlaybackActiveRef: ref(false),
      spotifyToken: null, extensionConnected: null, audioContext: null,
      spinoffMode: false, setSpinoffMode: noop, spinoffSourceTrack: null, setSpinoffSourceTrack: noop, setSpinoffLoading: noop,
      spinoffModeRef: ref(false), spinoffSourceTrackRef: ref(),
      handleNextRef: ref(noop), handlePreviousRef: ref(noop), handlePlayPauseRef: ref(noop), handlePlayRef: ref(noop),
      startSpinoffRef: ref(), playbackPollerRef: ref(), pollingRecoveryRef: ref(), externalTrackTimeoutRef: ref(),
      externalTrackIntervalRef: ref(), waitingForBrowserPlaybackRef: ref(), pendingCloseTabIdRef: ref(),
      trackNeedsExplicitStart: ref(false), spotifyProgressBaselineRef: ref(),
      listenAlongFriend: null, setListenAlongFriend: noop, listenAlongFriendRef: ref(), listenAlongLastTrackRef: ref(),
      listenAlongPendingTrackRef: ref(), listenAlongUserPausedRef: ref(), listenAlongEndAfterSongRef: ref(),
    });
    handlePlay = out.handlePlay;
    return null;
  };
  ReactDOMServer.renderToStaticMarkup(global.React.createElement(Probe));
  return { handlePlay, widevine, setCurrentTrack, showConfirmDialog, showToast, audioEl };
}

const PLUGIN_RESOLVER_ID = 'plugres';
const pluginManifest = (n) => ({ manifest: `<MPD ${n}/>`, type: 'dash', drm: 'widevine', context: { n } });
const track = (id, extra = {}) => ({
  id, artist: 'Kara Jackson', title: 'no fun', album: 'Why Does the Earth Give',
  sources: { [PLUGIN_RESOLVER_ID]: { id: `${id}-s`, title: 'no fun', artist: 'Kara Jackson', confidence: 1, ...extra } }
});
const committedTrack = (setCurrentTrack) => setCurrentTrack.mock.calls.map(([t]) => t).filter((t) => t && typeof t === 'object').pop();
const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('handlePlay on the real hook: the plugin branch, behaviourally', () => {
  test('a plugin play whose manifest resolves LATE, after a newer play started, never reaches playPlugin — the newer play wins', async () => {
    // The blocker shape: playPlugin claims the play token only when it runs,
    // so an older play arriving there after a newer play started takes the
    // NEWEST token, aborts the newer play as superseded and rotates its
    // session. The engine must abort the older play at its manifest await.
    let calls = 0;
    let releaseFirst;
    const resolver = {
      id: PLUGIN_RESOLVER_ID,
      name: 'Plug',
      capabilities: { resolve: true, widevine: true },
      getPlaybackManifest: jest.fn(() => {
        calls += 1;
        // The first fetch never settles until the test says so; the second
        // (the newer play's) answers at once.
        if (calls === 1) return new Promise((resolve) => { releaseFirst = resolve; });
        return Promise.resolve(pluginManifest('second'));
      }),
      relayLicense(challenge, context) { return `RELAYED:${this.id}:${challenge}:${context.n}`; }
    };
    const { handlePlay, widevine, setCurrentTrack } = widevineEngineWith(resolver);

    const first = handlePlay(track('t1'));
    await flush(); // the first play is parked inside getPlaybackManifest
    expect(resolver.getPlaybackManifest).toHaveBeenCalledTimes(1);

    const second = handlePlay(track('t2'));
    await second; // the newer play completes on its immediate manifest
    expect(widevine.playPlugin).toHaveBeenCalledTimes(1);

    // The first play's manifest resolves AFTER the second play started.
    releaseFirst(pluginManifest('first'));
    await first;

    // The superseded play never reached playPlugin (never claimed the token,
    // never rotated the session) and never tore the newer play down.
    expect(widevine.playPlugin).toHaveBeenCalledTimes(1);
    expect(widevine.playPlugin.mock.calls[0][1].manifestResult.manifest).toBe('<MPD second/>');
    expect(widevine.stop).not.toHaveBeenCalled();
    // And the newer play owns the playbar.
    expect(committedTrack(setCurrentTrack)).toMatchObject({ id: 't2' });

    // The relay handoff survives the engine detached: the function handed to
    // playPlugin still sees the resolver as its `this` when invoked bare.
    const handed = widevine.playPlugin.mock.calls[0][1].relayLicense;
    expect(handed.call({}, 'Q0FRPQ==', { n: 2 })).toBe(`RELAYED:${PLUGIN_RESOLVER_ID}:Q0FRPQ==:2`);
  });

  test('a bare stop() during the plugin\'s manifest fetch supersedes the play — the provider path\'s rule, matched', async () => {
    // The review's note: the provider path claims the play token before its
    // manifest mint, so a stop() during the mint is supersession; the plugin
    // path used to claim only inside playPlugin, after the fetch, so a bare
    // stop() (the sign-out path — no newer handlePlay, no generation bump)
    // was lost. The engine claims before the fetch now, and playPlugin
    // refuses the invalidated token.
    let releaseManifest;
    const resolver = {
      id: PLUGIN_RESOLVER_ID,
      name: 'Plug',
      capabilities: { resolve: true, widevine: true },
      getPlaybackManifest: () => new Promise((resolve) => { releaseManifest = resolve; }),
      relayLicense: async () => 'TElDRU5TRQ=='
    };
    const { handlePlay, widevine, setCurrentTrack, showConfirmDialog } = widevineEngineWith(resolver);

    const playing = handlePlay(track('t4'));
    await flush(); // the play parks inside getPlaybackManifest
    expect(widevine.claimPlayToken).toHaveBeenCalledTimes(1); // claimed BEFORE the fetch

    await widevine.stop(); // the bare stop: no newer handlePlay, no generation bump
    releaseManifest(pluginManifest('stopped'));
    await playing;

    // The stopped play reached playPlugin with its now-invalid token and was
    // refused — superseded, not a failure.
    expect(widevine.playPlugin).toHaveBeenCalledTimes(1);
    expect(widevine.playPlugin.mock.calls[0][1].token).toBe(1);
    const committed = committedTrack(setCurrentTrack);
    expect(committed ? committed.id : null).not.toBe('t4');
    expect(showConfirmDialog).not.toHaveBeenCalled();
  });

  test('a plugin hung in its manifest fetch fails the play once the budget passes — trackLoading never sticks', async () => {
    jest.useFakeTimers();
    try {
      const resolver = {
        id: PLUGIN_RESOLVER_ID,
        name: 'Plug',
        capabilities: { resolve: true, widevine: true },
        getPlaybackManifest: () => new Promise(() => {}), // hung forever
        relayLicense: async () => 'TElDRU5TRQ=='
      };
      const { handlePlay, widevine, showConfirmDialog } = widevineEngineWith(resolver);

      const playing = handlePlay(track('t5'));
      await jest.advanceTimersByTimeAsync(10000); // the budget passes
      await playing;

      // The hung fetch never reached a session; the play failed as an
      // ordinary playback error (the widevine arm's couldn't-start dialog,
      // the timeout itself logged), not a hang.
      expect(widevine.playPlugin).not.toHaveBeenCalled();
      expect(showConfirmDialog).toHaveBeenCalledWith(expect.objectContaining({
        type: 'error',
        message: 'This Plug track didn’t start. Try another source, or try again.'
      }));
      const logged = console.error.mock.calls.map((args) => args.join(' ')).join('\n');
      expect(logged).toContain('getPlaybackManifest timed out');
    } finally {
      jest.useRealTimers();
    }
  });

  test('a widevine resolver WITHOUT the pair drives the provider path (__parachordWidevine.play), never playPlugin', async () => {
    const resolver = {
      id: PLUGIN_RESOLVER_ID,
      name: 'Plug',
      capabilities: { resolve: true, widevine: true }
      // no getPlaybackManifest / relayLicense: the provider fallback
    };
    const { handlePlay, widevine, setCurrentTrack, audioEl } = widevineEngineWith(resolver);

    await handlePlay(track('t3', { amazonAsin: 'B0PROVIDER' }));

    expect(widevine.play).toHaveBeenCalledTimes(1);
    const [el, opts] = widevine.play.mock.calls[0];
    expect(el).toBe(audioEl);
    expect(opts).toMatchObject({ resolverId: PLUGIN_RESOLVER_ID, entity: { asin: 'B0PROVIDER' } });
    expect(widevine.playPlugin).not.toHaveBeenCalled();
    expect(committedTrack(setCurrentTrack)).toMatchObject({ id: 't3' });
  });
});
