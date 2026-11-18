/**
 * capabilities.local (#1520): a local-library plug-in is handled by what it
 * declares, never by its id. Local Files declares it; a plug-in with another
 * id that declares it gets the same play path, and Local Files without it
 * doesn't.
 *
 * Three layers:
 *  - the capability lookup (lib/resolver-capabilities.js), including the
 *    answer before the plug-in registry has loaded, when the old id check
 *    still worked;
 *  - the fallback helper the local play path uses when a file is gone or
 *    won't read (lib/playback-helpers.js fallbackAfter);
 *  - the engine's handlePlay itself, driven under Node with a fake <audio>.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const { capabilitiesOf, isLocalResolver } = require('../../src/renderer/lib/resolver-capabilities');
const { fallbackAfter } = require('../../src/renderer/lib/playback-helpers');
const { visibleCapabilities } = require('../../src/renderer/lib/capability-labels');

const localFilesManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins-src', 'localfiles', 'manifest.json'), 'utf8'));
const bundled = [
  { manifest: { id: 'localfiles' }, capabilities: localFilesManifest.capabilities },
  { manifest: { id: 'spotify' }, capabilities: { resolve: true, stream: true } },
];

describe('Local Files declares capabilities.local', () => {
  test('in its manifest, and the chip list hides it', () => {
    expect(localFilesManifest.capabilities.local).toBe(true);
    expect(visibleCapabilities(localFilesManifest.capabilities)).not.toContain('local');
  });
});

describe('isLocalResolver', () => {
  test('follows the capability, not the id', () => {
    const loaded = [
      { id: 'nas', capabilities: { resolve: true, local: true } },
      { id: 'localfiles', capabilities: { resolve: true } },
      { id: 'spotify', capabilities: { resolve: true } },
    ];
    expect(isLocalResolver('nas', loaded, bundled)).toBe(true);
    expect(isLocalResolver('localfiles', loaded, bundled)).toBe(false);
    expect(isLocalResolver('spotify', loaded, bundled)).toBe(false);
  });

  test('before the registry loads, the bundled copy answers (a restored track, a first resolution)', () => {
    expect(isLocalResolver('localfiles', [], bundled)).toBe(true);
    expect(isLocalResolver('localfiles', null, bundled)).toBe(true);
    expect(isLocalResolver('spotify', [], bundled)).toBe(false);
    expect(isLocalResolver('nas', [], bundled)).toBe(false);
  });

  test('once the registry has loaded it alone answers', () => {
    // Loaded without Local Files (removed or hidden): nothing to declare,
    // even though the bundled copy declares it.
    expect(isLocalResolver('localfiles', [{ id: 'spotify', capabilities: {} }], bundled)).toBe(false);
  });

  test('no id, or an unknown one, declares nothing', () => {
    expect(isLocalResolver(undefined, [], bundled)).toBe(false);
    expect(isLocalResolver(null, [{ id: 'nas', capabilities: { local: true } }], bundled)).toBe(false);
    expect(capabilitiesOf('nope', [], bundled)).toEqual({});
  });
});

describe('fallbackAfter', () => {
  test('drops the source that failed, whatever its id, and lists the real ones left', () => {
    const sources = { nas: { filePath: '/a.flac' }, spotify: { id: 's' }, bandcamp: { noMatch: true } };
    const out = fallbackAfter(sources, 'nas');
    expect(out.ids).toEqual(['spotify']);
    expect(out.sources).toEqual({ spotify: { id: 's' }, bandcamp: { noMatch: true } });
    expect(fallbackAfter(sources, 'localfiles').ids).toEqual(['nas', 'spotify']);
  });

  test('nothing left is an empty list', () => {
    expect(fallbackAfter({ nas: { filePath: '/a.flac' } }, 'nas').ids).toEqual([]);
    expect(fallbackAfter(undefined, 'nas')).toEqual({ ids: [], sources: {} });
  });
});

// ---------------------------------------------------------------------------
// handlePlay under Node. renderToStaticMarkup runs the hook body once and no
// effects; the returned handlePlay is then called directly. State setters are
// no-ops after a server render, so the test reads what the play did to the
// shared <audio> element and to the plug-ins.
// ---------------------------------------------------------------------------

class FakeAudio {
  constructor() {
    this.src = '';
    this.volume = 1;
    this.paused = true;
    this.listeners = {};
    FakeAudio.created.push(this);
  }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  removeEventListener() {}
  load() {}
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
}
FakeAudio.created = [];

function makeEngine({ resolvers, active, fileStatus }) {
  global.React = require('react');
  global.window = {
    ConfidenceScoring: { normalizeStr: (s) => s, validateResolvedTrack: () => true, MIN_CONFIDENCE_THRESHOLD: 0.6 },
    electron: fileStatus ? { localFiles: { fileStatus } } : {},
    localAudioUrlFromPath: (p) => `local-audio://${encodeURIComponent(p)}`,
  };
  global.Audio = FakeAudio;
  global.MediaError = { MEDIA_ERR_NETWORK: 2, MEDIA_ERR_DECODE: 3, MEDIA_ERR_SRC_NOT_SUPPORTED: 4 };
  if (typeof global.navigator === 'undefined' || global.navigator.onLine === false) {
    Object.defineProperty(global, 'navigator', { value: { onLine: true }, configurable: true });
  }
  const { usePlaybackEngine } = require('../../src/renderer/hooks/use-playback-engine.js');
  const ReactDOMServer = require('react-dom/server');

  // Any name ending in Ref is a ref; set*/show*/on* and other callables are
  // no-ops. Refs the play path reads are filled in below.
  const refs = {};
  const ref = (name, current = null) => (refs[name] = refs[name] || { current });
  const noop = () => {};
  const loose = (explicit) => new Proxy(explicit, {
    get(target, name) {
      if (name in target) return target[name];
      if (typeof name !== 'string') return undefined;
      if (name.endsWith('Ref') || name === 'trackNeedsExplicitStart') return ref(name);
      return noop;
    },
  });

  const isLocal = (id) => isLocalResolver(id, resolvers, []);
  const findLoadedResolver = (id) => resolvers.find((r) => r.id === id);
  const playCalls = [];
  const handlePlayCalls = [];
  const audioRef = { current: null };
  const ctx = {
    resolvers: loose({
      loadedResolversRef: ref('loadedResolversRef', resolvers),
      activeResolversRef: ref('activeResolversRef', active),
      resolverOrderRef: ref('resolverOrderRef', active),
      resolverBlocklistRef: ref('resolverBlocklistRef', []),
      resolverConfigCache: ref('resolverConfigCache', {}),
      getResolverConfigRef: ref('getResolverConfigRef', async () => ({})),
      confidenceForSourceRef: ref('confidenceForSourceRef', () => 1),
      isHtml5StreamResolver: (id) => !!findLoadedResolver(id)?.capabilities?.html5Stream,
      isWidevineResolver: () => false,
      isLocalResolver: isLocal,
      findLoadedResolver,
      usesSharedAudio: isLocal,
      embedPlayerKind: () => null,
      startAutoAdvancePollingRef: ref('startAutoAdvancePollingRef', noop),
    }),
    enrichment: loose({
      trackSources: {},
      getCachedAlbumArtRef: ref('getCachedAlbumArtRef', () => null),
      getAlbumArtRef: ref('getAlbumArtRef', async () => null),
      forgetMissingLocalFile: noop,
    }),
    ui: loose({ showToastRef: ref('showToastRef', noop), skipUnplayablePromptRef: ref('skipUnplayablePromptRef', false) }),
    scheduling: loose({}),
  };
  const params = loose({
    volume: loose({ volumeRef: ref('volumeRef', 50), isMutedRef: ref('isMutedRef', false), resolverVolumeOffsets: {}, getEffectiveVolume: (v) => v }),
    queue: loose({
      currentTrack: null,
      playHistoryRef: ref('playHistoryRef', []),
      currentQueueRef: ref('currentQueueRef', []),
    }),
    ctx,
    audioRef,
    spotifyToken: null,
    extensionConnected: false,
    audioContext: null,
    spinoffMode: false,
    spinoffSourceTrack: null,
    listenAlongFriend: null,
    pendingStartPositionRef: ref('pendingStartPositionRef', null),
    handlePlayRef: { current: (t) => handlePlayCalls.push(t) },
  });

  let engine;
  const Probe = () => { engine = usePlaybackEngine(params); return null; };
  ReactDOMServer.renderToStaticMarkup(global.React.createElement(Probe));
  for (const r of resolvers) {
    r.play = async (track) => { playCalls.push({ id: r.id, track }); return true; };
  }
  return { engine, audioRef, playCalls, handlePlayCalls };
}

const track = (sources) => ({ id: 't1', title: 'Song', artist: 'Band', album: 'LP', sources });
const fileSource = { title: 'Song', artist: 'Band', filePath: '/music/Song.flac', confidence: 1 };

describe('handlePlay routes by capabilities.local', () => {
  let logSpy;
  let warnSpy;
  let errorSpy;
  beforeEach(() => {
    FakeAudio.created = [];
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test('a plug-in with another id that declares it plays its file through the shared element', async () => {
    const resolvers = [{ id: 'nas', name: 'NAS', capabilities: { resolve: true, stream: true, local: true } }];
    const { engine, audioRef, playCalls } = makeEngine({ resolvers, active: ['nas'] });
    await engine.handlePlay(track({ nas: fileSource }));
    expect(playCalls).toEqual([]);
    expect(audioRef.current).toBeInstanceOf(FakeAudio);
    expect(audioRef.current.src).toBe(`local-audio://${encodeURIComponent('/music/Song.flac')}`);
    expect(audioRef.current.paused).toBe(false);
  });

  test('Local Files without it goes to its own play(), like any other plug-in', async () => {
    const resolvers = [{ id: 'localfiles', name: 'Local Files', capabilities: { resolve: true, stream: true } }];
    const { engine, audioRef, playCalls } = makeEngine({ resolvers, active: ['localfiles'] });
    await engine.handlePlay(track({ localfiles: fileSource }));
    expect(playCalls.map((c) => c.id)).toEqual(['localfiles']);
    expect(audioRef.current).toBe(null);
  });

  test('a missing file falls back to the other sources without the failed one, for any local plug-in', async () => {
    const resolvers = [
      { id: 'nas', name: 'NAS', capabilities: { resolve: true, stream: true, local: true } },
      { id: 'other', name: 'Other', capabilities: { resolve: true, stream: true } },
    ];
    const statusCalls = [];
    const fileStatus = async (p) => { statusCalls.push(p); return 'missing'; };
    const { engine, audioRef, playCalls } = makeEngine({ resolvers, active: ['nas', 'other'], fileStatus });
    await engine.handlePlay(track({ nas: fileSource, other: { title: 'Song', artist: 'Band', confidence: 1 } }));
    // handlePlay recursed (not awaited) with the NAS source dropped, so the
    // other plug-in played.
    for (let i = 0; i < 50 && playCalls.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(statusCalls).toEqual(['/music/Song.flac']);
    expect(playCalls.map((c) => c.id)).toEqual(['other']);
    expect(audioRef.current).toBe(null);
  });
});

describe('the renderer asks the capability, not the id', () => {
  const engineSrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'hooks', 'use-playback-engine.js'), 'utf8');
  const appSrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'app.js'), 'utf8');

  test('no playback or resolution branch compares an id to localfiles', () => {
    for (const src of [engineSrc, appSrc]) {
      expect(src).not.toMatch(/(?:resolverId|\.id|owner|activeResolver|playingResolverId|\bid)\s*[!=]==\s*'localfiles'/);
    }
    expect(appSrc).not.toContain("activeResolvers.includes('localfiles')");
  });

  test('the shared element, offline stop and stale-path check read capabilities.local', () => {
    expect(appSrc).toContain('const isLocalResolver = (id) => isLocalResolverIn(id, loadedResolversRef.current, FALLBACK_RESOLVERS);');
    expect(appSrc).toContain('const usesSharedAudio = (id) => isLocalResolver(id) || isHtml5StreamResolver(id) || isWidevineResolver(id);');
    expect(engineSrc).toContain('if (resolver.capabilities?.local) {');
    expect(engineSrc).toContain('ensureSharedAudioElement({ ...trackOrSource, _streamOwner: resolverId });');
    expect((engineSrc.match(/stopIfOffline\(\{ needsNetwork: !resolver\.capabilities\?\.local \}\)/g) || []).length).toBe(2);
    expect(appSrc).toContain('isLocalResolver(resolverId) && isStaleLocalSource(sourceData, libraryFilePathsRef.current)');
  });
});
