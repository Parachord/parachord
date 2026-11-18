/**
 * useLocalFiles: the Local Files state domain moved out of Parachord
 * (parachord#1487, the first state-domain slice after the playback hooks).
 *
 * Three layers, like the playback hook tests:
 *   1. A Node render probe: the module loads under plain Node and returns
 *      every name app.js destructures (derived from app.js, not a hand list).
 *   2. Call-site guards: every argument is declared above the call (the TDZ
 *      trap), the call sits above the first render-time read of what it
 *      returns, and each late-function bridge ref is synced every render.
 *   3. Behaviour, through a small hook harness (real setters, effects run by
 *      hand): the library load and the #1002 path-index invariant, the
 *      incremental change applier, forgetting a missing file, the folder
 *      actions, Remove Missing Files' confirm, the scan toast throttle, and
 *      the watch-folder load on cacheLoaded.
 */

const fs = require('fs');
const path = require('path');

const { useLocalFiles } = require('../../src/renderer/hooks/use-local-files.js');

const appSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');
const CLOSE_MARKER = '  } = useLocalFiles({';

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

const BRIDGES = ['showToastRef', 'showConfirmDialogRef', 'confirmAsyncRef', 'enrichTrackWithMbidRef', 'fetchArtworkViaMbidRef'];

// ---------------------------------------------------------------------------
// A minimal hook harness: one component instance whose state persists across
// renders. Setters store the value and re-render; effects are collected with
// their deps and run by hand (run once per render where deps changed, like
// React's commit).
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
  };
  function render(nextInputs) {
    if (nextInputs) inputs = nextInputs;
    i = 0;
    global.React = fakeReact;
    try { out = useLocalFiles(inputs); } finally { global.React = realReact; }
    return out;
  }
  render();
  return {
    get out() { return out; },
    render,
    runEffects() {
      const effects = pendingEffects;
      pendingEffects = [];
      for (const fn of effects) fn();
    },
  };
}

function bridges(over = {}) {
  return {
    showToastRef: { current: jest.fn() },
    showConfirmDialogRef: { current: jest.fn() },
    confirmAsyncRef: { current: jest.fn(async () => true) },
    enrichTrackWithMbidRef: { current: jest.fn(async () => {}) },
    fetchArtworkViaMbidRef: { current: jest.fn(async () => null) },
    ...over,
  };
}

function inputs(over = {}) {
  return { cacheLoaded: false, ...bridges(), ...over };
}

function stubLocalFiles(over = {}) {
  const localFiles = {
    getAllTracks: jest.fn(async () => []),
    getTracksByPaths: jest.fn(async () => []),
    getStats: jest.fn(async () => ({ totalTracks: 1, totalFolders: 1, lastScan: 1 })),
    getWatchFolders: jest.fn(async () => [{ path: '/m' }]),
    addWatchFolder: jest.fn(async () => ({ success: true })),
    removeWatchFolder: jest.fn(async () => {}),
    rescanFolder: jest.fn(async () => ({ success: true })),
    rescanAll: jest.fn(async () => {}),
    findMissing: jest.fn(async () => ({ success: true, missing: [] })),
    removeMissing: jest.fn(async () => ({ success: true, removed: 0 })),
    resolveArt: jest.fn(async () => null),
    onScanProgress: jest.fn(),
    onLibraryChanged: jest.fn(),
    ...over,
  };
  global.window = { electron: { localFiles } };
  return localFiles;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

afterEach(() => {
  delete global.window;
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
describe('useLocalFiles (Node render probe)', () => {
  test('module loads under plain Node and returns every name app.js destructures', () => {
    expect(EXPECTED_KEYS.length).toBeGreaterThan(15);
    global.React = require('react');
    const ReactDOMServer = require('react-dom/server');
    const ref = () => ({ current: null });
    const Probe = () => {
      const out = useLocalFiles({ cacheLoaded: false, ...Object.fromEntries(BRIDGES.map((b) => [b, ref()])) });
      for (const key of EXPECTED_KEYS) {
        if (out[key] === undefined) throw new Error('useLocalFiles did not return "' + key + '"');
      }
      if (out.library.length !== 0) throw new Error('library did not initialize to []');
      if (out.libraryLoading !== true) throw new Error('libraryLoading did not initialize to true');
      if (out.libraryFilePathsRef.current !== null) throw new Error('the path index must start null (no load yet)');
      return null;
    };
    expect(() => ReactDOMServer.renderToStaticMarkup(global.React.createElement(Probe))).not.toThrow();
  });

  test('the module touches no window at import time', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'hooks', 'use-local-files.js'), 'utf8');
    const moduleScope = src.slice(0, src.indexOf('function useLocalFiles('));
    expect(moduleScope.replace(/\/\/.*$/gm, '')).not.toMatch(/\bwindow\b/);
    expect(src).not.toMatch(/(^|[^.\w])use(State|Ref|Effect|Memo|Callback)\(/m);
  });
});

// ---------------------------------------------------------------------------
describe('the app.js call site', () => {
  const lineOf = (idx) => appSrc.slice(0, idx).split('\n').length;
  const callIdx = appSrc.indexOf(CLOSE_MARKER);
  const callLine = lineOf(callIdx);
  const args = appSrc.slice(callIdx + CLOSE_MARKER.length, appSrc.indexOf('});', callIdx))
    .split(',').map((s) => s.trim()).filter(Boolean);

  test('passes cacheLoaded and the five bridge refs', () => {
    expect(args).toEqual(['cacheLoaded', ...BRIDGES]);
  });

  test.each(['cacheLoaded', ...BRIDGES])('%s is declared above the call (TDZ)', (name) => {
    const decl = new RegExp(`^  const (\\[${name}, \\w+\\] = useState|${name} = useRef\\(null\\))`, 'm').exec(appSrc);
    expect(decl).not.toBeNull();
    expect(lineOf(decl.index)).toBeLessThan(callLine);
  });

  test.each(BRIDGES)('%s is synced every render', (name) => {
    const fn = name.replace(/Ref$/, '');
    expect(appSrc).toContain(`useEffect(() => { ${name}.current = ${fn}; });`);
  });

  test('sits above the first render-time read of what it returns (collectionSongsSorted)', () => {
    expect(callLine).toBeLessThan(lineOf(appSrc.indexOf('const collectionSongsSorted = useMemo(')));
  });

  test('the moved names are no longer declared in app.js', () => {
    for (const name of ['library', 'watchFolders', 'isScanning', 'scanProgress', 'localFilesStats', 'libraryLoading', 'localLibraryVersion', 'libraryPathsVersion']) {
      expect(appSrc).not.toMatch(new RegExp(`const \\[${name}, set\\w+\\] = useState`));
    }
    for (const name of ['libraryFilePathsRef', 'localArtAttemptedRef', 'forgetMissingLocalFile', 'enrichLocalTracksWithEmbeddedArt', 'enrichLocalTracksWithArtwork', 'loadLocalFilesLibrary', 'applyLibraryChanges', 'handleAddWatchFolder', 'handleRemoveWatchFolder', 'handleRescanFolder', 'handleRemoveMissingFiles', 'handleRescanAll']) {
      expect(appSrc).not.toMatch(new RegExp(`const ${name} = `));
    }
  });

  test('the startup effect still loads the library before playlists, and registers the change applier', () => {
    const start = appSrc.indexOf('    loadLocalFilesLibrary();');
    expect(start).toBeGreaterThan(-1);
    expect(start).toBeLessThan(appSrc.indexOf('    loadPlaylistsFromStore();', start));
    expect(appSrc).toMatch(/onLibraryChanged\(\(changes\) => \{\n\s+applyLibraryChanges\(changes\)\.catch/);
  });
});

// ---------------------------------------------------------------------------
describe('loading the library', () => {
  test('a successful load fills the library and the path index, and bumps its version', async () => {
    const lf = stubLocalFiles({ getAllTracks: jest.fn(async () => [{ id: 'a', filePath: '/m/a.flac', albumArt: 'x' }, { id: 'b', filePath: '/m/b.flac', albumArt: 'y' }]) });
    const h = harness(inputs());
    await h.out.loadLocalFilesLibrary();
    expect(lf.getAllTracks).toHaveBeenCalledTimes(1);
    expect(h.out.library.map((t) => t.id)).toEqual(['a', 'b']);
    expect([...h.out.libraryFilePathsRef.current]).toEqual(['/m/a.flac', '/m/b.flac']);
    expect(h.out.libraryPathsVersion).toBe(1);
    expect(h.out.libraryLoading).toBe(false);
  });

  test('an empty library is still a successful load: the index is an empty set', async () => {
    stubLocalFiles({ getAllTracks: jest.fn(async () => []) });
    const h = harness(inputs());
    await h.out.loadLocalFilesLibrary();
    expect(h.out.libraryFilePathsRef.current).toEqual(new Set());
    expect(h.out.libraryPathsVersion).toBe(1);
  });

  test.each([
    ['a rejected read', jest.fn(async () => { throw new Error('SQLITE_BUSY'); })],
    ['a null answer', jest.fn(async () => null)],
  ])('%s empties the library but never sets the path index (#1002)', async (_label, getAllTracks) => {
    stubLocalFiles({ getAllTracks });
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    const h = harness(inputs());
    await h.out.loadLocalFilesLibrary();
    err.mockRestore();
    expect(h.out.library).toEqual([]);
    expect(h.out.libraryFilePathsRef.current).toBeNull();
    expect(h.out.libraryPathsVersion).toBe(0);
    expect(h.out.libraryLoading).toBe(false);
  });

  test('a failed reload after a good one keeps the last good path index', async () => {
    const getAllTracks = jest.fn(async () => [{ id: 'a', filePath: '/m/a.flac', albumArt: 'x' }]);
    stubLocalFiles({ getAllTracks });
    const h = harness(inputs());
    await h.out.loadLocalFilesLibrary();
    getAllTracks.mockImplementationOnce(async () => { throw new Error('gone'); });
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    await h.out.loadLocalFilesLibrary();
    err.mockRestore();
    expect([...h.out.libraryFilePathsRef.current]).toEqual(['/m/a.flac']);
  });

  test('tracks with embedded art and no art yet go through the art warmup', async () => {
    const lf = stubLocalFiles({
      getAllTracks: jest.fn(async () => [{ id: 'a', filePath: '/m/a.flac', hasEmbeddedArt: true }]),
      resolveArt: jest.fn(async () => 'file:///cache/a.jpg'),
    });
    const h = harness(inputs());
    await h.out.loadLocalFilesLibrary();
    await flush();
    expect(lf.resolveArt).toHaveBeenCalledTimes(1);
    expect(h.out.library[0].albumArt).toBe('file:///cache/a.jpg');
  });

  test('the artwork pass looks up one track per album through the bridges, once per session', async () => {
    const tracks = [
      { id: 'a', filePath: '/m/a.flac', artist: 'X', album: 'Y', title: 'One' },
      { id: 'b', filePath: '/m/b.flac', artist: 'X', album: 'Y', title: 'Two' },
    ];
    stubLocalFiles({ getAllTracks: jest.fn(async () => tracks) });
    const enrich = jest.fn(async (t) => { t.releaseMbid = 'rel-1'; });
    const fetchArt = jest.fn(async () => 'https://coverartarchive.org/x.jpg');
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const h = harness(inputs({ enrichTrackWithMbidRef: { current: enrich }, fetchArtworkViaMbidRef: { current: fetchArt } }));
    await h.out.loadLocalFilesLibrary();
    await flush();
    expect(enrich).toHaveBeenCalledTimes(1);
    expect(enrich.mock.calls[0][1]).toEqual({ background: true, skipIsrcFallback: true });
    expect(h.out.library.map((t) => t.albumArt)).toEqual(['https://coverartarchive.org/x.jpg', 'https://coverartarchive.org/x.jpg']);
    // A reload does not walk the same album again.
    await h.out.enrichLocalTracksWithArtwork(tracks.map((t) => ({ ...t, albumArt: undefined })));
    log.mockRestore();
    expect(enrich).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
describe('forgetMissingLocalFile', () => {
  test('does nothing before the first load, or for a path the library does not hold', async () => {
    stubLocalFiles({ getAllTracks: jest.fn(async () => [{ id: 'a', filePath: '/m/a.flac', albumArt: 'x' }]) });
    const h = harness(inputs());
    h.out.forgetMissingLocalFile('/m/a.flac');
    expect(h.out.libraryPathsVersion).toBe(0);
    await h.out.loadLocalFilesLibrary();
    h.out.forgetMissingLocalFile('/m/other.flac');
    expect(h.out.libraryPathsVersion).toBe(1);
  });

  test('drops a known path and bumps the version so the reconcile runs', async () => {
    stubLocalFiles({ getAllTracks: jest.fn(async () => [{ id: 'a', filePath: '/m/a.flac', albumArt: 'x' }]) });
    const h = harness(inputs());
    await h.out.loadLocalFilesLibrary();
    h.out.forgetMissingLocalFile('/m/a.flac');
    expect(h.out.libraryFilePathsRef.current.has('/m/a.flac')).toBe(false);
    expect(h.out.libraryPathsVersion).toBe(2);
  });
});

// ---------------------------------------------------------------------------
describe('applyLibraryChanges', () => {
  const log = () => jest.spyOn(console, 'log').mockImplementation(() => {});

  test('per-file changes fetch only those rows and patch the library and the path index', async () => {
    const lf = stubLocalFiles({
      getAllTracks: jest.fn(async () => [{ id: 'a', filePath: '/m/a.flac', albumArt: 'x' }, { id: 'b', filePath: '/m/b.flac', albumArt: 'y' }]),
      getTracksByPaths: jest.fn(async () => [{ id: 'c', filePath: '/m/c.flac', albumArt: 'z' }]),
    });
    const spy = log();
    const h = harness(inputs());
    await h.out.loadLocalFilesLibrary();
    await h.out.applyLibraryChanges([
      { action: 'added', track: { filePath: '/m/c.flac' } },
      { action: 'removed', filePath: '/m/a.flac' },
    ]);
    spy.mockRestore();
    expect(lf.getAllTracks).toHaveBeenCalledTimes(1);
    expect(lf.getTracksByPaths).toHaveBeenCalledWith(['/m/c.flac']);
    expect(h.out.library.map((t) => t.id).sort()).toEqual(['b', 'c']);
    expect([...h.out.libraryFilePathsRef.current].sort()).toEqual(['/m/b.flac', '/m/c.flac']);
    expect(h.out.localLibraryVersion).toBe(1);
  });

  test('anything before the first full load reloads in full', async () => {
    const lf = stubLocalFiles();
    const spy = log();
    const h = harness(inputs());
    await h.out.applyLibraryChanges([{ action: 'added', track: { filePath: '/m/c.flac' } }]);
    spy.mockRestore();
    expect(lf.getTracksByPaths).not.toHaveBeenCalled();
    expect(lf.getAllTracks).toHaveBeenCalledTimes(1);
    expect(h.out.localLibraryVersion).toBe(1);
  });

  test('a bulk event (a folder scan) reloads in full', async () => {
    const lf = stubLocalFiles();
    const spy = log();
    const h = harness(inputs());
    await h.out.loadLocalFilesLibrary();
    await h.out.applyLibraryChanges({ type: 'folder-scanned' });
    spy.mockRestore();
    expect(lf.getAllTracks).toHaveBeenCalledTimes(2);
    expect(lf.getTracksByPaths).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe('the folder actions', () => {
  test('adding a folder scans, then refreshes the folders and stats', async () => {
    const lf = stubLocalFiles();
    const b = bridges();
    const h = harness(inputs(b));
    const pending = h.out.handleAddWatchFolder();
    expect(h.out.isScanning).toBe(true);
    await pending;
    expect(h.out.isScanning).toBe(false);
    expect(lf.getWatchFolders).toHaveBeenCalled();
    expect(h.out.watchFolders).toEqual([{ path: '/m' }]);
    expect(h.out.localFilesStats.totalTracks).toBe(1);
    expect(b.showToastRef.current).not.toHaveBeenCalled();
  });

  test('a cancelled picker says nothing; a failed add says so', async () => {
    const lf = stubLocalFiles({ addWatchFolder: jest.fn(async () => null) });
    const b = bridges();
    const h = harness(inputs(b));
    await h.out.handleAddWatchFolder();
    expect(b.showToastRef.current).not.toHaveBeenCalled();
    lf.addWatchFolder.mockImplementationOnce(async () => ({ success: false, error: 'EACCES' }));
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    await h.out.handleAddWatchFolder();
    err.mockRestore();
    expect(b.showToastRef.current).toHaveBeenCalledWith(expect.stringMatching(/^Couldn’t add that folder\./), 'error');
    expect(h.out.isScanning).toBe(false);
  });

  test('removing a folder refreshes the folders and stats', async () => {
    const lf = stubLocalFiles();
    const h = harness(inputs());
    await h.out.handleRemoveWatchFolder('/m');
    expect(lf.removeWatchFolder).toHaveBeenCalledWith('/m');
    expect(h.out.watchFolders).toEqual([{ path: '/m' }]);
  });

  test('a failed rescan says so and still clears the scanning flag', async () => {
    stubLocalFiles({ rescanFolder: jest.fn(async () => ({ success: false, error: 'gone' })) });
    const b = bridges();
    const h = harness(inputs(b));
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    await h.out.handleRescanFolder('/m');
    err.mockRestore();
    expect(b.showToastRef.current).toHaveBeenCalledWith(expect.stringMatching(/^Couldn’t rescan that folder\./), 'error');
    expect(h.out.isScanning).toBe(false);
  });

  test('Remove Missing Files asks first, and a No removes nothing', async () => {
    const lf = stubLocalFiles({ findMissing: jest.fn(async () => ({ success: true, missing: ['/m/gone.flac'] })) });
    const b = bridges({ confirmAsyncRef: { current: jest.fn(async () => false) } });
    const h = harness(inputs(b));
    await h.out.handleRemoveMissingFiles();
    expect(b.confirmAsyncRef.current).toHaveBeenCalledTimes(1);
    expect(lf.removeMissing).not.toHaveBeenCalled();
    expect(h.out.isScanning).toBe(false);
  });

  test('Remove Missing Files removes what the user confirmed', async () => {
    const lf = stubLocalFiles({
      findMissing: jest.fn(async () => ({ success: true, missing: ['/m/gone.flac'] })),
      removeMissing: jest.fn(async () => ({ success: true, removed: 1 })),
    });
    const b = bridges();
    const h = harness(inputs(b));
    await h.out.handleRemoveMissingFiles();
    expect(lf.removeMissing).toHaveBeenCalledWith(['/m/gone.flac']);
    expect(b.showToastRef.current).toHaveBeenCalledWith(expect.stringMatching(/^Removed 1 missing file from your library/), 'success');
  });

  test('Remove Missing Files with nothing missing, but a folder it could not read, explains in a dialog', async () => {
    stubLocalFiles({ findMissing: jest.fn(async () => ({ success: true, missing: [], unreachableFolders: ['/Volumes/Ext'] })) });
    const b = bridges();
    const h = harness(inputs(b));
    await h.out.handleRemoveMissingFiles();
    expect(b.showConfirmDialogRef.current).toHaveBeenCalledWith(expect.objectContaining({ title: 'No missing files' }));
    expect(b.confirmAsyncRef.current).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe('effects', () => {
  test('the watch folders load once the cache has loaded, not before', async () => {
    const lf = stubLocalFiles();
    const h = harness(inputs({ cacheLoaded: false }));
    h.runEffects();
    lf.getWatchFolders.mockClear();
    h.render(inputs({ cacheLoaded: true }));
    h.runEffects();
    expect(lf.getWatchFolders).toHaveBeenCalledTimes(1);
    await flush();
    expect(h.out.watchFolders).toEqual([{ path: '/m' }]);
  });

  test('scan progress updates the state, throttles the toast to 250ms, and settles to a complete toast', () => {
    jest.useFakeTimers();
    jest.setSystemTime(1000);
    const lf = stubLocalFiles();
    const b = bridges();
    const h = harness(inputs(b));
    h.runEffects();
    expect(lf.onScanProgress).toHaveBeenCalledTimes(1);
    const onProgress = lf.onScanProgress.mock.calls[0][0];
    const toast = b.showToastRef.current;

    onProgress({ current: 1, total: 3, file: 'a' });
    expect(h.out.scanProgress).toEqual({ current: 1, total: 3, file: 'a' });
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenLastCalledWith('Scanning library… 1 / 3', 'info', null, { persistent: true });

    jest.setSystemTime(1100);
    onProgress({ current: 2, total: 3, file: 'b' });
    expect(toast).toHaveBeenCalledTimes(1); // inside 250ms: no new toast

    jest.setSystemTime(1300);
    onProgress({ current: 3, total: 3, file: 'c' });
    expect(toast).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(2000);
    expect(toast).toHaveBeenLastCalledWith('Library scan complete · 3 files', 'success');
  });

  test('a library change refreshes the stats and folders', async () => {
    const lf = stubLocalFiles();
    const h = harness(inputs());
    h.runEffects();
    expect(lf.onLibraryChanged).toHaveBeenCalledTimes(1);
    lf.onLibraryChanged.mock.calls[0][0]([{ action: 'added', track: { filePath: '/m/a.flac' } }]);
    await flush();
    expect(lf.getStats).toHaveBeenCalledTimes(1);
    expect(h.out.localFilesStats.totalTracks).toBe(1);
  });

  test('the listeners register once, not on every render', () => {
    const lf = stubLocalFiles();
    const h = harness(inputs());
    h.runEffects();
    h.render();
    h.runEffects();
    expect(lf.onScanProgress).toHaveBeenCalledTimes(1);
    expect(lf.onLibraryChanged).toHaveBeenCalledTimes(1);
  });
});
