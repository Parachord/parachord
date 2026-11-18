// src/renderer/hooks/use-local-files.js: the Local Files state domain,
// extracted from app.js (parachord#1487, the first "state domains as hooks"
// slice after the playback hooks of #1098; docs/architecture/local-files.md).
//
// Owns: the local library (`library`) and its file-path index
// (`libraryFilePathsRef`, bumped through `libraryPathsVersion`), the library
// loading flag and change counter (`localLibraryVersion`), the watch folders
// and their stats, the scan flag and scan progress; the albums the local-art
// pass already tried (`localArtAttemptedRef`); the library load and the
// incremental change applier; the embedded/folder art warmup and the
// library-scale artwork pass; the actions that add, remove and rescan watch
// folders and remove missing files; and two effects: the scan-progress /
// library-changed IPC listeners (with the throttled scan toast) and the
// watch-folder load once the cache has loaded.
//
// Moved VERBATIM: every function and effect body below is the code that sat
// in Parachord, in the same order. Two bodies that lived inside the startup
// effect (loadLocalFilesLibrary and applyLibraryChanges) are dedented to the
// hook body and otherwise unchanged; the startup effect in app.js still calls
// them in the same places (it also loads playlists and search history, so it
// stays in app.js). Only the bridge wrappers just below are new.
//
// What stays in app.js, reading this hook's return: the stale-local-source
// reconcile (it writes the track-sources cache, the collection, playlists and
// the queue), the re-resolve on localLibraryVersion (it reads the open album
// and playlist), the plug-in dialog's stats load (a 'localfiles' id check
// that #1520 is replacing), resolveTrack's stale-path checks, and the ID3
// editor's library patch.
//
// Rules for this file (the extracted-module rule for hooks):
//   - React.-qualified hooks only (React.useState etc.), never bare
//     destructured hooks.
//   - No window access at module import time (tests require this file under
//     plain Node).
//   - Inputs arrive as refs/parameters, never component-state closures.
//
// Effect-order note (see use-volume.js for the full version): this hook's
// two effects run where Parachord calls useLocalFiles, ahead of every effect
// declared below the call. Both moved up from further down (the listeners
// from beside the plug-in dialog's effects, the watch-folder load from the
// plug-in loading cluster). Neither reads state another effect writes in the
// same commit, and both only start IPC work whose answers arrive after the
// commit: the listeners register callbacks (nothing runs until main sends a
// scan event), and the watch-folder load issues one getWatchFolders call
// when cacheLoaded turns true. Their order relative to each other is kept
// (listeners first). The library-changed listener here still registers
// before the startup effect's own onLibraryChanged listener (the change
// applier), as it did, so the two run in the same order on each event.

const { libraryFilePaths } = require('../lib/local-sources');
const { classifyLibraryChanges, applyLibraryPatch, albumArtGroupKey } = require('../lib/library-changes');

function useLocalFiles({
  cacheLoaded,
  // Late-function bridges: these functions are declared below the hook call
  // in Parachord, so they arrive as refs synced on every render (the same
  // idiom as the playback engine's bridges). Each is called only after a
  // commit (from an IPC callback, a user action, or after an awaited IPC), by
  // which time the sync effects have filled them.
  showToastRef,
  showConfirmDialogRef,
  confirmAsyncRef,
  enrichTrackWithMbidRef,
  fetchArtworkViaMbidRef,
}) {
  const showToast = (...args) => showToastRef.current.apply(null, args);
  const showConfirmDialog = (...args) => showConfirmDialogRef.current.apply(null, args);
  const confirmAsync = (...args) => confirmAsyncRef.current.apply(null, args);
  const enrichTrackWithMbid = (...args) => enrichTrackWithMbidRef.current.apply(null, args);
  const fetchArtworkViaMbid = (...args) => fetchArtworkViaMbidRef.current.apply(null, args);

  const [library, setLibrary] = React.useState([]);
  // File paths of the last SUCCESSFUL local-library load, or null until one
  // has happened. Every stale-local-source check keys off this (#1002); a
  // failed load leaves it untouched, so a DB read error can never be taken
  // for "every file is gone".
  const libraryFilePathsRef = React.useRef(null);
  // Albums the local-art pass already tried this session (#784): a reload
  // or library change must not re-walk the whole library.
  const localArtAttemptedRef = React.useRef(new Set());
  const [libraryPathsVersion, setLibraryPathsVersion] = React.useState(0);
  // A file play found missing on disk before the library noticed (the
  // watcher or the 5-minute background poll will drop its row): treat it as
  // gone now, so the reconcile (in app.js) strips its local source everywhere.
  const forgetMissingLocalFile = (filePath) => {
    const paths = libraryFilePathsRef.current;
    if (!paths || !paths.has(filePath)) return;
    paths.delete(filePath);
    setLibraryPathsVersion(v => v + 1);
  };
  const [libraryLoading, setLibraryLoading] = React.useState(true);
  const [localLibraryVersion, setLocalLibraryVersion] = React.useState(0); // Incremented when local files library changes (triggers album re-resolution)

  const [localFilesStats, setLocalFilesStats] = React.useState({ totalTracks: 0, totalFolders: 0, lastScan: null });
  const [watchFolders, setWatchFolders] = React.useState([]);

  const [isScanning, setIsScanning] = React.useState(false);
  const [scanProgress, setScanProgress] = React.useState({ current: 0, total: 0, file: '' });

  // Listen for local files scan progress and library changes.
  //
  // Toast UX: the progress callback fires per-file in main.js, so a 150k-file
  // scan would emit 150k IPC events and (unguarded) 150k toast updates.
  // Throttle toast updates to ~250ms cadence — frequent enough to feel live,
  // sparse enough that React doesn't spend a whole frame re-rendering the
  // toast on every event. Settles to a "complete" toast 2s after the last
  // progress event, which doubles as the only signal we have that the scan
  // wrapped up (the scan service doesn't emit a distinct done event today).
  React.useEffect(() => {
    if (window.electron?.localFiles?.onScanProgress) {
      let lastToastAt = 0;
      let lastTotal = 0;
      let firstEventForRun = true;
      let completionTimer = null;
      window.electron.localFiles.onScanProgress((data) => {
        // Always refresh the in-Settings progress-bar state — that render
        // already exists and React batches state updates anyway.
        setScanProgress(data);
        lastTotal = data.total || lastTotal;

        const now = Date.now();
        const isFirst = firstEventForRun;
        firstEventForRun = false;
        if (isFirst || (now - lastToastAt) >= 250) {
          lastToastAt = now;
          if (data.total > 0) {
            showToast(
              `Scanning library… ${data.current.toLocaleString()} / ${data.total.toLocaleString()}`,
              'info',
              null,
              { persistent: true }
            );
          } else {
            showToast('Scanning library…', 'neutral', null, { persistent: true });
          }
        }

        // Reset/extend the completion timer on every event. When events stop
        // arriving for 2s we treat the scan as done and show a success toast.
        if (completionTimer) clearTimeout(completionTimer);
        completionTimer = setTimeout(() => {
          firstEventForRun = true;
          completionTimer = null;
          if (lastTotal > 0) {
            showToast(`Library scan complete · ${lastTotal.toLocaleString()} files`, 'success');
          } else {
            showToast('Library scan complete', 'success');
          }
        }, 2000);
      });
    }
    if (window.electron?.localFiles?.onLibraryChanged) {
      // (_changes: unused; the underscore keeps the strict lint tier clean.)
      window.electron.localFiles.onLibraryChanged((_changes) => {
        // Refresh stats when library changes
        if (window.electron?.localFiles) {
          window.electron.localFiles.getStats().then(setLocalFilesStats);
          window.electron.localFiles.getWatchFolders().then(setWatchFolders);
        }
      });
    }
  }, []);

  // Enrich local file tracks with MBIDs, then fetch artwork for those missing it.
  // Two-phase: first MBID enrichment (fast, ~4ms each), then artwork fetch for artless tracks.
  // Lazy embedded/folder art warmup. For tracks with `hasEmbeddedArt` (set
  // by the local-files scan) but no resolved albumArt URL yet (cache cold),
  // route them through main's `localFiles:resolveArt` IPC, which extracts
  // the picture frame and writes a cache file. The result URL becomes the
  // track's albumArt going forward — both via the immediate state update
  // here and via the sync warm-cache fast-path on subsequent loads (since
  // the cache file now exists; see formatTrackForRenderer in
  // local-files/index.js). Concurrency-limited at 8 to avoid the bulk-
  // Promise-allocation freeze that motivated issue #784.
  //
  // No network. Bounded by disk-write speed for the cache file (~1-5 ms
  // per track on SSD). At 8 concurrent workers, 150k cold-cache tracks
  // complete in ~3-15 minutes in the background; 10k tracks in ~10-60s.
  // Successful resolutions are batched into setLibrary updates every 50
  // resolved tracks so React isn't reconciling 150k single-prop edits.
  const enrichLocalTracksWithEmbeddedArt = async (tracks) => {
    if (!tracks || tracks.length === 0) return;
    if (!window.electron?.localFiles?.resolveArt) return;
    // Skip tracks that already have art (sync warm-cache fast-path landed it)
    // or that don't have any local art source at all.
    const candidates = tracks.filter(t =>
      !t.albumArt && (t.hasEmbeddedArt || t.folderArtPath)
    );
    if (candidates.length === 0) return;

    console.log(`🎨 [Local Art] Warming embedded/folder art for ${candidates.length} of ${tracks.length} tracks (background, throttled)…`);

    const CONCURRENCY = 8;
    const FLUSH_BATCH = 50;
    let nextIdx = 0;
    let pendingUpdates = [];
    let totalResolved = 0;

    const flush = () => {
      if (pendingUpdates.length === 0) return;
      const batch = pendingUpdates;
      pendingUpdates = [];
      const updateMap = new Map(batch.map(u => [u.id, u.albumArt]));
      setLibrary(prev => prev.map(t => updateMap.has(t.id)
        ? { ...t, albumArt: updateMap.get(t.id) }
        : t
      ));
    };

    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (true) {
        const idx = nextIdx++;
        if (idx >= candidates.length) return;
        const track = candidates[idx];
        try {
          const url = await window.electron.localFiles.resolveArt(track);
          if (url) {
            pendingUpdates.push({ id: track.id, albumArt: url });
            totalResolved++;
            if (pendingUpdates.length >= FLUSH_BATCH) flush();
          }
        } catch (_err) {
          // Silent — individual misses shouldn't poison the loop.
        }
      }
    });
    await Promise.all(workers);
    flush();
    console.log(`🎨 [Local Art] Warmup complete · resolved ${totalResolved} of ${candidates.length} candidates`);
  };

  // Library-scale artwork for local tracks with no embedded or folder art
  // (#784). One representative track per album is looked up (MBID mapper,
  // 4 in flight on the background lane, no ISRC fallback), its release's
  // Cover Art Archive front is fetched once, and the URL is applied to every
  // track of that album: ~15k lookups for a 150k-track library instead of
  // 150k. Each album is attempted once per session (keyed by artist +
  // album, or by file for album-less tracks), so a library change or reload
  // does not re-walk the library. Art found is published onto the CURRENT
  // library rows by file path, in batches and without mutating: a reload
  // mid-pass replaces the row objects, and a mutation would neither reach
  // the new rows nor re-render the memoized pages. This replaced a
  // 10k-track cutoff above which the pass was skipped entirely.
  const enrichLocalTracksWithArtwork = async (tracks) => {
    if (!tracks || tracks.length === 0) return;
    const attempted = localArtAttemptedRef.current;
    const groups = new Map();
    for (const track of tracks) {
      if (!track || track.albumArt || !track.artist || !track.title) continue;
      const key = albumArtGroupKey(track);
      if (attempted.has(key)) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(track);
    }
    if (groups.size === 0) return;
    for (const key of groups.keys()) attempted.add(key);

    const queue = [...groups.values()];
    const ENRICH_CONCURRENCY = 4;
    const PUBLISH_EVERY = 200; // albums with new art between library publishes
    let found = 0;
    let unpublished = 0;
    const pending = new Map(); // filePath -> { url, releaseMbid }
    const publish = () => {
      if (pending.size === 0) return;
      const batch = new Map(pending);
      pending.clear();
      unpublished = 0;
      setLibrary(prev => {
        let changed = false;
        const next = prev.map(t => {
          const hit = batch.get(t.filePath);
          if (!hit || t.albumArt) return t;
          changed = true;
          return { ...t, albumArt: hit.url, releaseMbid: t.releaseMbid || hit.releaseMbid };
        });
        return changed ? next : prev;
      });
    };
    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length) {
        const albumTracks = queue[cursor++];
        if (albumTracks.some(t => t.albumArt)) continue; // the warmup got there first
        const rep = albumTracks[0];
        await enrichTrackWithMbid(rep, { background: true, skipIsrcFallback: true }).catch(() => {});
        if (!rep.releaseMbid) continue;
        const url = await fetchArtworkViaMbid(rep).catch(() => null);
        if (!url) continue;
        for (const t of albumTracks) {
          if (t.filePath) pending.set(t.filePath, { url, releaseMbid: rep.releaseMbid });
        }
        found++;
        if (++unpublished >= PUBLISH_EVERY) publish();
      }
    };
    console.log(`🎨 Looking up artwork for ${queue.length} local album(s) without art...`);
    await Promise.all(Array.from({ length: Math.min(ENRICH_CONCURRENCY, queue.length) }, worker));
    publish();
    if (found > 0) console.log(`🎨 Found artwork for ${found}/${queue.length} local album(s)`);
  };

  // Load watch folders on initial app load (for needsConfiguration check)
  React.useEffect(() => {
    if (cacheLoaded && window.electron?.localFiles?.getWatchFolders) {
      window.electron.localFiles.getWatchFolders().then(setWatchFolders);
    }
  }, [cacheLoaded]);

  // Load local files into library instead of placeholder tracks
  const loadLocalFilesLibrary = async () => {
    setLibraryLoading(true);
    try {
      if (window.electron?.localFiles?.getAllTracks) {
        const tLocal = performance.now();
        const localTracks = await window.electron.localFiles.getAllTracks();
        const localMs = Math.round(performance.now() - tLocal);
        if (Array.isArray(localTracks)) {
          libraryFilePathsRef.current = libraryFilePaths(localTracks);
          setLibraryPathsVersion(v => v + 1);
        }
        if (localTracks && localTracks.length > 0) {
          console.log(`📚 Loaded ${localTracks.length} local tracks into library (${localMs}ms IPC)`);
          setLibrary(localTracks);
          // Always run the throttled embedded/folder art warmup — fast
          // (no network, just main-process ID3 picture extraction +
          // file-cache writes), bounded by concurrency cap, big payoff
          // for users with well-tagged libraries (issue #786).
          enrichLocalTracksWithEmbeddedArt(localTracks).catch(() => {});
          // Library-scale artwork lookup: one per album, once per session,
          // 4 in flight on the background lane (#784; replaced a 10k-track
          // cutoff above which this was skipped).
          enrichLocalTracksWithArtwork(localTracks).catch(() => {});
        } else {
          console.log(`📚 No local files found - library is empty (${localMs}ms IPC)`);
          setLibrary([]);
        }
      } else {
        console.log('📚 Local Files API not available');
        setLibrary([]);
      }
    } catch (error) {
      console.error('Failed to load local files library:', error);
      setLibrary([]);
    } finally {
      setLibraryLoading(false);
    }
  };

  // The library-changed listener: the startup effect in app.js registers it
  // (see the file header).
  // Apply what changed instead of reloading the whole library (#784):
  // the watcher's per-file results name the paths, so only those rows
  // are fetched. Folder scans, rescans, folder removal, "remove missing
  // files" and background polls can touch any number of rows and still
  // reload in full, as does anything before the first full load.
  const applyLibraryChanges = async (changes) => {
    const plan = classifyLibraryChanges(changes);
    const paths = libraryFilePathsRef.current;
    if (!plan.incremental || !paths || !window.electron?.localFiles?.getTracksByPaths) {
      console.log('📚 Library changed, reloading...', changes);
      await loadLocalFilesLibrary();
      setLocalLibraryVersion(v => v + 1);
      return;
    }
    if (plan.upsertPaths.length === 0 && plan.removedPaths.length === 0) return;
    const fetched = plan.upsertPaths.length > 0
      ? await window.electron.localFiles.getTracksByPaths(plan.upsertPaths)
      : [];
    if (!Array.isArray(fetched)) {
      await loadLocalFilesLibrary();
      setLocalLibraryVersion(v => v + 1);
      return;
    }
    console.log(`📚 Library changed: ${fetched.length} added/updated, ${plan.removedPaths.length} removed`);
    setLibrary(prev => applyLibraryPatch(prev, plan, fetched));
    for (const p of plan.removedPaths) paths.delete(p);
    for (const p of plan.upsertPaths) paths.delete(p);
    for (const t of fetched) if (t.filePath) paths.add(t.filePath);
    setLibraryPathsVersion(v => v + 1);
    if (fetched.length > 0) {
      enrichLocalTracksWithEmbeddedArt(fetched).catch(() => {});
      enrichLocalTracksWithArtwork(fetched).catch(() => {});
    }
    setLocalLibraryVersion(v => v + 1);
  };

  // Local Files handlers
  const handleAddWatchFolder = async () => {
    if (!window.electron?.localFiles) return;

    setIsScanning(true);
    try {
      const result = await window.electron.localFiles.addWatchFolder();
      // null: the folder picker was cancelled.
      if (result?.success) {
        setWatchFolders(await window.electron.localFiles.getWatchFolders());
        setLocalFilesStats(await window.electron.localFiles.getStats());
      } else if (result) {
        console.error('Adding a music folder failed:', result.error);
        showToast('Couldn’t add that folder. Check that Parachord can read it, then try again.', 'error');
      }
    } catch (error) {
      console.error('Adding a music folder failed:', error);
      showToast('Couldn’t add that folder. Check that Parachord can read it, then try again.', 'error');
    } finally {
      setIsScanning(false);
    }
  };

  const handleRemoveWatchFolder = async (folderPath) => {
    if (!window.electron?.localFiles) return;

    await window.electron.localFiles.removeWatchFolder(folderPath);
    setWatchFolders(await window.electron.localFiles.getWatchFolders());
    setLocalFilesStats(await window.electron.localFiles.getStats());
  };

  const handleRescanFolder = async (folderPath) => {
    if (!window.electron?.localFiles) return;

    setIsScanning(true);
    try {
      const rescan = await window.electron.localFiles.rescanFolder(folderPath);
      if (rescan && rescan.success === false) {
        console.error('Rescan failed:', rescan.error);
        showToast('Couldn’t rescan that folder. Check that it’s still there, then try again.', 'error');
      }
      setWatchFolders(await window.electron.localFiles.getWatchFolders());
      setLocalFilesStats(await window.electron.localFiles.getStats());
    } finally {
      setIsScanning(false);
    }
  };

  // "Remove Missing Files" (#1002). Automatic scans never delete rows when a
  // folder comes back empty (an unmounted drive looks the same), so a folder
  // the user emptied on purpose kept its tracks forever. This is the explicit
  // path: count what is missing, ask, then delete. Folders whose root cannot
  // be read are skipped and named, never counted as missing.
  const handleRemoveMissingFiles = async () => {
    const bridge = window.electron?.localFiles;
    if (!bridge?.findMissing || !bridge?.removeMissing) return;
    setIsScanning(true);
    try {
      const found = await bridge.findMissing();
      if (!found?.success) {
        showToast(`Could not check for missing files: ${found?.error || 'unknown error'}`, 'error');
        return;
      }
      const skipped = found.unreachableFolders?.length
        ? `\n\nSkipped because the folder can't be read right now (is a drive disconnected?):\n${found.unreachableFolders.join('\n')}`
        : '';
      if (found.missing.length === 0) {
        if (skipped) {
          showConfirmDialog({ type: 'info', title: 'No missing files', message: `Every file in the folders that could be checked is still there.${skipped}` });
        } else {
          showToast('No missing files: every library file is still on disk', 'success');
        }
        return;
      }
      const n = found.missing.length;
      const ok = await confirmAsync({ title: `Remove missing ${n === 1 ? 'file' : 'files'}?`, message: `${n} file${n === 1 ? '' : 's'} in your library ${n === 1 ? 'is' : 'are'} no longer on disk. Remove ${n === 1 ? 'it' : 'them'} from the library?\n\nThis only removes library entries; nothing on disk is touched.${skipped}`, confirmLabel: 'Remove', destructive: true });
      if (!ok) return;
      const result = await bridge.removeMissing(found.missing);
      if (!result?.success) {
        showToast(`Could not remove missing files: ${result?.error || 'unknown error'}`, 'error');
        return;
      }
      showToast(`Removed ${result.removed} missing file${result.removed === 1 ? '' : 's'} from your library${result.kept ? ` (${result.kept} came back and were kept)` : ''}`, 'success');
      setWatchFolders(await bridge.getWatchFolders());
      setLocalFilesStats(await bridge.getStats());
    } finally {
      setIsScanning(false);
    }
  };

  const handleRescanAll = async () => {
    if (!window.electron?.localFiles) return;

    setIsScanning(true);
    try {
      await window.electron.localFiles.rescanAll();
      setWatchFolders(await window.electron.localFiles.getWatchFolders());
      setLocalFilesStats(await window.electron.localFiles.getStats());
    } finally {
      setIsScanning(false);
    }
  };

  return {
    library, setLibrary,
    libraryFilePathsRef, localArtAttemptedRef,
    libraryPathsVersion, setLibraryPathsVersion,
    forgetMissingLocalFile,
    libraryLoading, setLibraryLoading,
    localLibraryVersion, setLocalLibraryVersion,
    localFilesStats, setLocalFilesStats,
    watchFolders, setWatchFolders,
    isScanning, setIsScanning,
    scanProgress, setScanProgress,
    enrichLocalTracksWithEmbeddedArt,
    enrichLocalTracksWithArtwork,
    loadLocalFilesLibrary,
    applyLibraryChanges,
    handleAddWatchFolder,
    handleRemoveWatchFolder,
    handleRescanFolder,
    handleRemoveMissingFiles,
    handleRescanAll,
  };
}

module.exports = { useLocalFiles };
