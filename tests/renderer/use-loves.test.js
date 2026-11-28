/**
 * useLoves: the Loves state domain moved out of Parachord (parachord#1487
 * "Scrobbling and Loves"; #1559 step 1, before loves become a plug-in
 * capability). A move, not a change: these pin what the code did in app.js.
 *
 * Three layers, like use-local-files.test.js:
 *   1. A Node render probe: the module loads under plain Node and returns
 *      every name app.js destructures (derived from app.js, not a hand list).
 *   2. Call-site guards: every argument is declared above the call (the TDZ
 *      trap), each late-function bridge ref is synced every render, and the
 *      moved names are gone from app.js.
 *   3. Behaviour, through a small hook harness: the live push and its marks,
 *      the retry queue and its runner, the setting, the backfill, and the
 *      import's guards.
 */

const fs = require('fs');
const path = require('path');

const { useLoves } = require('../../src/renderer/hooks/use-loves.js');
const { setPluginLookup } = require('../../src/renderer/lib/plugin-names');
const { registerBuiltInLoveProviders, clearLoveProviders } = require('../../src/renderer/lib/love-providers');

const appSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');
const hookSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'hooks', 'use-loves.js'), 'utf8');
const CLOSE_MARKER = '  } = useLoves({';

// Position-based derivation (walk back from the close marker; see
// use-volume.test.js for why not a forward regex).
function destructureKeysFrom(src, closeMarker) {
  const closeIdx = src.indexOf(closeMarker);
  if (closeIdx === -1) throw new Error(closeMarker + ' not found: the hook call moved or changed shape');
  const openIdx = src.lastIndexOf('\n  const {\n', closeIdx);
  if (openIdx === -1) throw new Error(closeMarker + ' opening not found');
  return src
    .slice(openIdx + '\n  const {\n'.length, closeIdx)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\w+(\s+as\s+\w+)?$/.test(s))
    .map((s) => s.split(/\s+as\s+/).pop());
}
const EXPECTED_KEYS = destructureKeysFrom(appSrc, CLOSE_MARKER);

const BRIDGES = ['showToastRef', 'showConfirmDialogRef', 'saveCollectionRef'];
const ARGS = ['collectionDataRef', 'collectionLoadingRef', 'setCollectionData', 'metaServicesRef',
  'loadedResolversRef', 'getResolverConfigRef',
  'metaServiceConfigsRef', 'scrobblerConfigsRef', 'showSidebarBadge', ...BRIDGES];

// ---------------------------------------------------------------------------
// A minimal hook harness: one component instance whose state persists across
// renders. Setters store the value and re-render; effects are collected with
// their deps and run by hand; useCallback keeps the first function, as React
// does for empty deps (every callback here that matters for identity has
// stable deps).
const mounted = [];
function harness(inputs) {
  const slots = [];
  let i = 0;
  let pendingEffects = [];
  let out = null;
  const realReact = global.React;
  const fakeReact = {
    useState: (init) => {
      const k = i++;
      if (!slots[k]) {
        const slot = { value: typeof init === 'function' ? init() : init };
        slot.set = (next) => {
          slot.value = typeof next === 'function' ? next(slot.value) : next;
          render();
        };
        slots[k] = slot;
      }
      return [slots[k].value, slots[k].set];
    },
    useRef: (init) => {
      const k = i++;
      if (!slots[k]) slots[k] = { current: init };
      return slots[k];
    },
    useEffect: (fn, deps) => {
      const k = i++;
      const prev = slots[k];
      const changed = !prev || !deps || deps.some((d, j) => d !== prev.deps[j]);
      slots[k] = { deps };
      if (changed) pendingEffects.push(fn);
    },
    useCallback: (fn, deps) => {
      const k = i++;
      const prev = slots[k];
      const changed = !prev || !deps || deps.some((d, j) => d !== prev.deps[j]);
      if (changed) slots[k] = { fn, deps };
      return slots[k].fn;
    },
  };
  function render() {
    i = 0;
    global.React = fakeReact;
    try { out = useLoves(inputs); } finally { global.React = realReact; }
    return out;
  }
  render();
  const cleanups = [];
  mounted.push(() => cleanups.splice(0).forEach((c) => c()));
  return {
    get out() { return out; },
    render,
    runEffects() {
      const effects = pendingEffects;
      pendingEffects = [];
      for (const fn of effects) { const c = fn(); if (typeof c === 'function') cleanups.push(c); }
    },
    unmount() { cleanups.splice(0).forEach((c) => c()); },
  };
}

const track = (id, over = {}) => ({ id, artist: 'Artist ' + id, title: 'Title ' + id, album: 'Album', ...over });

function setup({ tracks = [track('a')], loading = false, lovedTracks = ['lastfm', 'listenbrainz'], configs = {} } = {}) {
  const collectionDataRef = { current: { tracks, albums: [], artists: [] } };
  const setCollectionData = jest.fn((updater) => {
    collectionDataRef.current = typeof updater === 'function' ? updater(collectionDataRef.current) : updater;
  });
  const inputs = {
    collectionDataRef,
    collectionLoadingRef: { current: loading },
    setCollectionData,
    metaServicesRef: { current: lovedTracks.map((id) => ({ id, capabilities: { lovedTracks: true } })) },
    metaServiceConfigsRef: { current: configs },
    scrobblerConfigsRef: { current: {} },
    showSidebarBadge: jest.fn(),
    showToastRef: { current: jest.fn() },
    showConfirmDialogRef: { current: jest.fn() },
    saveCollectionRef: { current: jest.fn(async () => true) },
  };
  return { inputs, h: harness(inputs) };
}

function stubWindow({ lfm = {}, lb = {}, mbid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' } = {}) {
  const store = { set: jest.fn(async () => {}) };
  const lastfmScrobbler = { id: 'lastfm', name: 'Last.fm', isSignedIn: jest.fn(async () => true), loveTrack: jest.fn(async () => {}), ...lfm };
  const listenbrainzScrobbler = { id: 'listenbrainz', name: 'ListenBrainz', isSignedIn: jest.fn(async () => true), loveTrack: jest.fn(async () => {}), ...lb };
  const tombstones = { clearBatch: jest.fn(async () => ({})), list: jest.fn(async () => ({})) };
  global.window = {
    electron: { store, tombstones },
    lastfmScrobbler,
    listenbrainzScrobbler,
    resolveMbidForLove: jest.fn(async () => mbid),
  };
  // The app registers these at startup (lib/love-providers.js, #1559).
  registerBuiltInLoveProviders(global.window);
  return { store, lastfmScrobbler, listenbrainzScrobbler, tombstones };
}

beforeAll(() => {
  setPluginLookup((id) => ({ lastfm: { name: 'Last.fm' }, listenbrainz: { name: 'ListenBrainz' } }[id] || null));
});
beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  // Unmount every harness: the retry runner's interval must not outlive its test.
  mounted.splice(0).forEach((unmount) => unmount());
  clearLoveProviders();
  delete global.window;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
describe('useLoves (Node render probe)', () => {
  test('module loads under plain Node and returns every name app.js destructures', () => {
    expect(EXPECTED_KEYS.length).toBeGreaterThan(10);
    global.React = require('react');
    const ReactDOMServer = require('react-dom/server');
    const Probe = () => {
      const out = useLoves({
        ...Object.fromEntries(ARGS.map((a) => [a, { current: null }])),
        setCollectionData: () => {},
        showSidebarBadge: () => {},
      });
      for (const key of EXPECTED_KEYS) {
        if (out[key] === undefined) throw new Error('useLoves did not return "' + key + '"');
      }
      if (out.loveRetryQueueRef.current.size !== 0) throw new Error('the retry queue must start empty');
      return null;
    };
    expect(() => ReactDOMServer.renderToStaticMarkup(global.React.createElement(Probe))).not.toThrow();
  });

  test('the module touches no window at import time, and uses only React.-qualified hooks', () => {
    const moduleScope = hookSrc.slice(0, hookSrc.indexOf('function useLoves('));
    expect(moduleScope.replace(/\/\/.*$/gm, '')).not.toMatch(/\bwindow\b/);
    expect(hookSrc).not.toMatch(/(^|[^.\w])use(State|Ref|Effect|Memo|Callback)\(/m);
  });
});

// ---------------------------------------------------------------------------
describe('the app.js call site', () => {
  const lineOf = (idx) => appSrc.slice(0, idx).split('\n').length;
  const callIdx = appSrc.indexOf(CLOSE_MARKER);
  const callLine = lineOf(callIdx);
  const args = appSrc.slice(callIdx + CLOSE_MARKER.length, appSrc.indexOf('});', callIdx))
    .split(',').map((s) => s.trim()).filter(Boolean);

  test('passes the Collection refs, the setter, the config refs, the badge and the three bridges', () => {
    expect(args).toEqual(ARGS);
  });

  test.each(ARGS)('%s is declared above the call (TDZ)', (name) => {
    const decl = new RegExp(`^  const (\\[\\w+, ${name}\\] = useState|\\[${name}, \\w+\\] = useState|${name} = (useRef|useCallback)\\()`, 'm').exec(appSrc);
    expect(decl).not.toBeNull();
    expect(lineOf(decl.index)).toBeLessThan(callLine);
  });

  test.each(BRIDGES)('%s is synced every render', (name) => {
    const fn = name.replace(/Ref$/, '');
    expect(appSrc).toContain(`useEffect(() => { ${name}.current = ${fn}; });`);
  });

  test('the moved names are no longer declared in app.js', () => {
    for (const name of ['pushLoveToScrobblers', 'markLovePushed', 'runLoveBackfill', 'runLoveImport', 'setLovePushEnabled', 'clearListenbrainzLoveTombstone', 'serviceHasLovedTracks']) {
      expect(appSrc).not.toMatch(new RegExp(`const ${name} = `));
    }
    for (const name of ['scrobblerLovePushEnabled', 'loveBackfillRunning', 'loveBackfillProgress', 'loveImportRunning', 'loveImportProgress']) {
      expect(appSrc).not.toMatch(new RegExp(`const \\[${name}, set\\w+\\] = useState`));
    }
    for (const name of ['lovePushedKeysRef', 'loveRetryQueueRef', 'loveImportCursorRef', 'scrobblerLovePushEnabledRef']) {
      expect(appSrc).not.toMatch(new RegExp(`const ${name} = useRef`));
    }
  });

  test('the bulk load still fills the setting, the marks and the cursor', () => {
    expect(appSrc).toContain('setScrobblerLovePushEnabled(lovePushEnabled);');
    expect(appSrc).toContain('lovePushedKeysRef.current = lovePushedKeys;');
    expect(appSrc).toContain("loveImportCursorRef.current = d['love_import_cursor'] || {};");
  });
});

// ---------------------------------------------------------------------------
describe('the live push', () => {
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  test('pushes only to services whose setting is on, and marks and stores each', async () => {
    const { store, lastfmScrobbler, listenbrainzScrobbler, tombstones } = stubWindow();
    const { h } = setup();
    h.runEffects();
    await h.out.setLovePushEnabled('lastfm', true);
    h.runEffects();
    await h.out.pushLoveToScrobblers(track('a'), { justAdded: true });
    expect(lastfmScrobbler.loveTrack).toHaveBeenCalledWith({ artist: 'Artist a', title: 'Title a', mbid: undefined });
    expect(listenbrainzScrobbler.loveTrack).not.toHaveBeenCalled();
    expect(typeof h.out.lovePushedKeysRef.current.a.lastfm).toBe('number');
    expect(store.set).toHaveBeenCalledWith('scrobbler_love_push_enabled', { lastfm: true });
    expect(store.set).toHaveBeenCalledWith('love_pushed_keys', h.out.lovePushedKeysRef.current);
    expect(h.out.loveRetryQueueRef.current.size).toBe(0);

    await h.out.setLovePushEnabled('listenbrainz', true);
    h.runEffects();
    await h.out.pushLoveToScrobblers(track('a'), { justAdded: true });
    expect(lastfmScrobbler.loveTrack).toHaveBeenCalledTimes(1); // already pushed: skipped
    expect(listenbrainzScrobbler.loveTrack).toHaveBeenCalledWith({ ...track('a'), mbid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' });
    expect(h.out.lovePushedKeysRef.current.a.listenbrainz).toMatchObject({ mbid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' });
    expect(tombstones.clearBatch).toHaveBeenCalledWith([{ providerId: 'listenbrainz', externalId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }]);
    await flush();
  });

  test('a failed push is queued for retry, and a re-push of a removed track drops it', async () => {
    const { lastfmScrobbler } = stubWindow({ lfm: { loveTrack: jest.fn(async () => { throw new Error('503'); }) } });
    const { h, inputs } = setup();
    await h.out.setLovePushEnabled('lastfm', true);
    h.runEffects();
    await h.out.pushLoveToScrobblers(track('a'), { justAdded: true });
    expect(lastfmScrobbler.loveTrack).toHaveBeenCalledTimes(1);
    expect(h.out.loveRetryQueueRef.current.get('a')).toMatchObject({ attempts: 1 });

    inputs.collectionDataRef.current = { tracks: [], albums: [], artists: [] };
    await h.out.pushLoveToScrobblers(track('a'));
    expect(lastfmScrobbler.loveTrack).toHaveBeenCalledTimes(1);
    expect(h.out.loveRetryQueueRef.current.has('a')).toBe(false);
  });

  test('gives up after five attempts', async () => {
    stubWindow({ lfm: { loveTrack: jest.fn(async () => { throw new Error('503'); }) } });
    const { h } = setup();
    await h.out.setLovePushEnabled('lastfm', true);
    h.runEffects();
    for (let n = 0; n < 6; n++) await h.out.pushLoveToScrobblers(track('a'));
    expect(h.out.loveRetryQueueRef.current.has('a')).toBe(false);
  });

  test('the retry runner re-pushes the queue every 5 minutes, and stops on unmount', async () => {
    jest.useFakeTimers();
    const loveTrack = jest.fn().mockRejectedValueOnce(new Error('503')).mockResolvedValue(undefined);
    stubWindow({ lfm: { loveTrack } });
    const { h } = setup();
    await h.out.setLovePushEnabled('lastfm', true);
    h.runEffects();
    await h.out.pushLoveToScrobblers(track('a'), { justAdded: true });
    expect(h.out.loveRetryQueueRef.current.size).toBe(1);
    await jest.advanceTimersByTimeAsync(5 * 60 * 1000 + 600);
    expect(loveTrack).toHaveBeenCalledTimes(2);
    expect(h.out.loveRetryQueueRef.current.size).toBe(0);
    h.unmount();
    expect(jest.getTimerCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('the backfill', () => {
  test('only for a plug-in that declares lovedTracks, and only the given ids', async () => {
    jest.useFakeTimers();
    const { lastfmScrobbler } = stubWindow();
    const { h, inputs } = setup({ tracks: [track('a'), track('b')], lovedTracks: ['lastfm'] });
    h.runEffects();
    await h.out.runLoveBackfill('listenbrainz');
    expect(global.window.listenbrainzScrobbler.loveTrack).not.toHaveBeenCalled();

    const run = h.out.runLoveBackfill('lastfm', { onlyIds: new Set(['b']) });
    await jest.advanceTimersByTimeAsync(2000);
    await run;
    expect(lastfmScrobbler.loveTrack).toHaveBeenCalledTimes(1);
    expect(lastfmScrobbler.loveTrack).toHaveBeenCalledWith({ artist: 'Artist b', title: 'Title b', mbid: undefined });
    expect(inputs.showToastRef.current).toHaveBeenCalledWith('Backfilled 1 love to Last.fm');
    expect(h.out.loveBackfillRunning).toEqual({ lastfm: false });
    expect(h.out.loveBackfillProgress).toEqual({ lastfm: null });
  });

  test('says so when there is nothing to send, and asks for a sign-in first', async () => {
    stubWindow({ lb: { isSignedIn: jest.fn(async () => false) } });
    const { h, inputs } = setup({ tracks: [] });
    await h.out.runLoveBackfill('lastfm');
    expect(inputs.showToastRef.current).toHaveBeenCalledWith('Already up to date: no loves to push to Last.fm');
    await h.out.runLoveBackfill('listenbrainz');
    expect(inputs.showToastRef.current).toHaveBeenCalledWith('Sign in to ListenBrainz to sync loved tracks');
  });
});

// ---------------------------------------------------------------------------
describe('the import\'s guards', () => {
  test('waits for the Collection to load', async () => {
    stubWindow();
    const { h, inputs } = setup({ loading: true });
    await h.out.runLoveImport('lastfm');
    expect(inputs.showToastRef.current).toHaveBeenCalledWith('Your Collection is still loading. Try the import again in a moment.', 'info');
    expect(h.out.loveImportRunning).toEqual({});
  });

  test('needs a username, and clears its running flag whatever happens', async () => {
    stubWindow();
    const { h, inputs } = setup();
    await h.out.runLoveImport('lastfm');
    expect(inputs.showToastRef.current).toHaveBeenCalledWith('Add your Last.fm username first', 'error');
    expect(h.out.loveImportRunning).toEqual({ lastfm: false });
    expect(h.out.loveImportProgress).toEqual({ lastfm: null });
  });

  test('a plug-in without lovedTracks never imports', async () => {
    stubWindow();
    const { h, inputs } = setup({ lovedTracks: [] });
    await h.out.runLoveImport('lastfm');
    expect(inputs.showToastRef.current).not.toHaveBeenCalled();
    expect(h.out.loveImportRunning).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Loves as a capability (#1559 step 2): any registered love provider whose
// plug-in declares `loves` takes part, with no code naming it.
describe('any love provider', () => {
  const { registerLoveProvider } = require('../../src/renderer/lib/love-providers');
  const server = (over = {}) => ({
    id: 'myserver',
    isSignedIn: jest.fn(async () => true),
    loveTrack: jest.fn(async () => ({ ok: true })),
    ...over,
  });
  const withServer = (opts = {}) => {
    const s = setup(opts);
    s.inputs.metaServicesRef.current = [
      ...s.inputs.metaServicesRef.current,
      { id: 'myserver', loves: { contract: 1, verb: 'Star', needs: 'serviceId', canImport: false } },
    ];
    return s;
  };

  test('a third provider is pushed to, marked, and retried like the others', async () => {
    stubWindow();
    const provider = server({ loveTrack: jest.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue({ ok: true }) });
    registerLoveProvider(provider);
    setPluginLookup((id) => ({ lastfm: { name: 'Last.fm' }, listenbrainz: { name: 'ListenBrainz' }, myserver: { name: 'My Server' } }[id] || null));
    const { h } = withServer();
    await h.out.setLovePushEnabled('myserver', true);
    h.runEffects();
    await h.out.pushLoveToScrobblers(track('a'), { justAdded: true });
    expect(provider.loveTrack).toHaveBeenCalledWith(track('a'), {});
    expect(h.out.loveRetryQueueRef.current.has('a')).toBe(true);
    await h.out.pushLoveToScrobblers(track('a'));
    expect(typeof h.out.lovePushedKeysRef.current.a.myserver).toBe('number');
    expect(h.out.loveRetryQueueRef.current.has('a')).toBe(false);
    expect(global.window.lastfmScrobbler.loveTrack).not.toHaveBeenCalled(); // its push is off
  });

  test('a no-match is skipped and counted, never marked', async () => {
    jest.useFakeTimers();
    stubWindow();
    registerLoveProvider(server({ loveTrack: jest.fn(async () => ({ ok: false, reason: 'no-match' })) }));
    setPluginLookup((id) => ({ myserver: { name: 'My Server' } }[id] || null));
    const { h, inputs } = withServer();
    const run = h.out.runLoveBackfill('myserver');
    await jest.advanceTimersByTimeAsync(2000);
    await run;
    expect(h.out.lovePushedKeysRef.current.a).toBeUndefined();
    expect(inputs.showToastRef.current).toHaveBeenCalledWith('Backfilled 0 loves to My Server (1 skipped: no match)');
  });

  test('a provider that can\'t list your loves is never imported from', async () => {
    stubWindow();
    registerLoveProvider(server());
    const { h, inputs } = withServer({ configs: { myserver: { username: 'u' } } });
    await h.out.runLoveImport('myserver');
    expect(inputs.showToastRef.current).not.toHaveBeenCalled();
    expect(h.out.loveImportRunning).toEqual({});
  });

  test('the import\'s question lists every other service with push on, and Cancel stops it', async () => {
    stubWindow();
    registerLoveProvider(server());
    setPluginLookup((id) => ({ lastfm: { name: 'Last.fm' }, listenbrainz: { name: 'ListenBrainz' }, myserver: { name: 'My Server' } }[id] || null));
    const { h, inputs } = withServer({ configs: { listenbrainz: { username: 'someone' } } });
    await h.out.setLovePushEnabled('lastfm', true);
    await h.out.setLovePushEnabled('myserver', true);
    h.runEffects();
    inputs.showConfirmDialogRef.current.mockImplementation((d) => d.onCancel());
    await h.out.runLoveImport('listenbrainz');
    expect(inputs.showConfirmDialogRef.current).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Tracks you import from ListenBrainz will also be loved on Last.fm and My Server, because pushing loves is on for each of them. This can\'t be undone from Parachord.',
    }));
    expect(global.window.listenbrainzScrobbler.getLovedTracksPage).toBeUndefined(); // stopped before reading
    expect(h.out.loveImportRunning).toEqual({ listenbrainz: false });
  });

  test('with one other service the question reads as before', async () => {
    stubWindow();
    const { h, inputs } = setup({ configs: { listenbrainz: { username: 'someone' } } });
    await h.out.setLovePushEnabled('lastfm', true);
    h.runEffects();
    inputs.showConfirmDialogRef.current.mockImplementation((d) => d.onCancel());
    await h.out.runLoveImport('listenbrainz');
    expect(inputs.showConfirmDialogRef.current).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Tracks you import from ListenBrainz will also be loved on Last.fm, because "Push loves to Last.fm" is on. This can\'t be undone from Parachord.',
    }));
  });
});

// A plug-in's own loves (#1559 step 3): found among the loaded plug-ins, run
// with its saved config, and its imported loves arrive with their source.
describe('a plug-in\'s own loves', () => {
  const server = () => ({
    id: 'myserver',
    loves: { contract: 1, verb: 'Love', needs: 'serviceId', canImport: true },
    isConfigured: (c) => !!(c && c.serverUrl),
    loveTrack: jest.fn(async (t) => ({ ok: true, ref: t.sources.myserver.songId })),
    getLovedPage: jest.fn(async () => ({
      items: [{ artist: 'Artist s', title: 'Starred', album: 'Al', lovedAt: 1700000000, source: { songId: 's9', title: 'Starred', artist: 'Artist s' } }],
      next: null,
    })),
    search: jest.fn(async () => []),
  });
  const withPlugin = (plugin, config = { serverUrl: 'http://s', username: 'u' }) => {
    const s = setup({ tracks: [track('a', { sources: { myserver: { songId: 'sa' } } })] });
    s.inputs.loadedResolversRef = { current: [plugin] };
    s.inputs.getResolverConfigRef = { current: jest.fn(async () => config) };
    return { ...s, h: harness(s.inputs) };
  };

  test('a heart reaches it with its saved config, by its source there', async () => {
    stubWindow();
    setPluginLookup((id) => ({ myserver: { name: 'My Server' } }[id] || null));
    const plugin = server();
    const { h, inputs } = withPlugin(plugin);
    await h.out.setLovePushEnabled('myserver', true);
    h.runEffects();
    await h.out.pushLoveToScrobblers(track('a', { sources: { myserver: { songId: 'sa' } } }), { justAdded: true });
    expect(inputs.getResolverConfigRef.current).toHaveBeenCalledWith('myserver');
    expect(plugin.loveTrack.mock.calls[0][1]).toEqual({ serverUrl: 'http://s', username: 'u' });
    expect(typeof h.out.lovePushedKeysRef.current.a.myserver).toBe('number');
  });

  test('Import adds its starred songs with their source on it, and marks them so they never go back', async () => {
    stubWindow();
    setPluginLookup((id) => ({ myserver: { name: 'My Server' } }[id] || null));
    const plugin = server();
    const { h, inputs } = withPlugin(plugin);
    await h.out.runLoveImport('myserver');
    expect(plugin.getLovedPage).toHaveBeenCalledWith({ cursor: null, account: 'u' }, { serverUrl: 'http://s', username: 'u' });
    const added = inputs.collectionDataRef.current.tracks.find((t) => t.title === 'Starred');
    expect(added).toMatchObject({ artist: 'Artist s', addedAt: 1700000000 * 1000, sources: { myserver: { songId: 's9', title: 'Starred', artist: 'Artist s' } } });
    expect(h.out.lovePushedKeysRef.current[added.id]).toHaveProperty('myserver');
    expect(inputs.showToastRef.current).toHaveBeenCalledWith(expect.stringMatching(/^Imported 1 from My Server\./), 'success', null, { duration: 8000 });
  });

  test('not set up: Import says so, and nothing is read', async () => {
    stubWindow();
    setPluginLookup((id) => ({ myserver: { name: 'My Server' } }[id] || null));
    const plugin = server();
    const { h, inputs } = withPlugin(plugin, {});
    await h.out.runLoveImport('myserver');
    expect(inputs.showToastRef.current).toHaveBeenCalledWith('Set up My Server first', 'error');
    expect(plugin.getLovedPage).not.toHaveBeenCalled();
  });
});
