# Local Files library

> Moved verbatim out of `CLAUDE.md` on 2026-10-22 so the always-loaded guide stays short; `CLAUDE.md` indexes this file. Line references such as `app.js L####` date from when each passage was written and have drifted: search for the named function instead. Cross-references to other sections point at sibling files in `docs/architecture/`.

## Local Files Library

`local-files/` is a SQLite-backed scanner/indexer for music files in user-configured watch folders. DB lives at `userData/local-files.db`. Tables: `tracks` (metadata + paths) and `watch_folders` (configured roots).

### Stream quality HUD (play-time, no DB)

Hovering the track title in the now-playing bar shows the exact stream parameters (`Ultra HD · FLAC · 48.0 kHz · 24-bit · 1478 kbps`) when — and only when — the playing resolver provides a `streamQuality` record on its source entry (contract: root `stream-quality.js`; see "Resolver Result Shape"). Other resolvers render the title exactly as before. **Providers today: localfiles (full record) and amazonmusic (measured bitrate + captured manifest/init params — see "Stream quality capture" under the Amazon Music resolver).**

**Deliberately NOT stored in the scan DB.** The info is parsed at play time: the renderer's backfill effect (app.js, next to the album-art backfill in the currentTrack effects cluster) sees `_activeResolver === 'localfiles'`, calls `window.electron.localFiles.getStreamInfo(filePath)` (`localFiles:stream-info` IPC → `LocalFilesService.getStreamInfo` → `MetadataReader.getStreamInfo`), and attaches the result to `currentTrack.sources.localfiles.streamQuality` — in-memory only, never written to the track-sources cache. (The playing-track clone does ride along in the saved queue; the backfill deliberately re-reads and deep-compares on every run instead of early-returning, so a restored session self-heals if the file changed while the app was closed.) Rationale: every file works on day one (DB columns would leave rows indexed before the feature with NULL bit depth until each file changed or got rescanned), no schema migration, and the file is the source of truth. `bitrate` is normalized to kbps once at capture (music-metadata reports bits/sec). The service caches per (path, mtime) so replays/scrubs are free. If a future non-playback surface needs this (e.g. a quality column in the library view), scan-time capture can be added then — don't add it speculatively.

### Cadences

- **Foreground:** chokidar real-time watcher per folder, `awaitWriteFinish` 2s, 2s debounce on event batches.
- **Background:** chokidar watchers torn down (Electron throttles them aggressively), replaced with a 5-min `pollForChanges` interval that calls `scanner.scanFolder` on every enabled root.

### Diff-and-delete invariant — DO NOT regress

`scanner.scanFolder` does a tree walk, builds the current set of files, and removes DB entries not in that set. Three guards exist to prevent an unreadable folder (unmounted external drive, offline network share, transient permission lapse, iCloud offload race) from being interpreted as "all files deleted" and wiping the DB:

1. **Pre-scan stat check.** `fs.statSync(folderPath)` before doing anything. If it throws or the path isn't a directory, return early with `skipped: 'unreadable'` / `'not-a-directory'`.
2. **Root-walk error propagation.** `collectAudioFiles` returns `{ok: true|false, files|error}`. The recursive `walk` only swallows errors for *subdirectories*; failure on the root path bubbles up so the caller can abort. (Subdir failures still skip silently — those are usually individual unreadable folders, not whole-volume issues.)
3. **Empty-but-DB-populated guard.** If the scan returns zero files but the DB has any entries for that folder, refuse to delete and log a warning. Mirrors the >70% completeness guard in `sync:start` for the same class of "looks like environmental, not a real change" pattern.

Without these, a user with their music library on an external drive would see the entire scanned library disappear every time the drive disconnected, and reappear on the next 5-min poll once it reconnected. That was the symptom that surfaced the bug in user reports.

### Stale local sources (parachord#1002)

A track that resolved to a local file keeps `sources.localfiles` in three places: the resolution cache (`cache_track_sources`, 30 days), the session's `trackSources`, and the `sources` on collection, playlist and queue tracks. The library DB is the source of truth for which files exist. After every **successful** library load (startup, and each `onLibraryChanged`), `libraryFilePathsRef` holds the library's file paths, and an effect strips `localfiles` sources whose `filePath` is not in it from all of those places (`src/renderer/lib/local-sources.js`, pure + tested; in memory for the collection and playlists, since it reruns every launch). `resolveTrack` also ignores a stale local source, persisted or cached. **Only a successful load may set the path set**: the error path also calls `setLibrary([])`, and an empty set strips every local source. Before handing a local file to the audio element, handlePlay asks `localFiles:file-status` ('present' | 'missing' | 'unknown', answered only for paths the DB knows): a missing file falls back to the track's other sources, or shows "File Not Found", instead of reaching the element as a 404 that Chromium reports as "source not supported" (which used to produce the "could not be decoded" dialog). It never deletes the DB row: a vanished volume looks the same as a deleted file from there, and the scanner's empty-folder guard exists to stop exactly that wipe.

### Removing missing files on request (parachord#1002)

The empty-folder guard above means a folder the user emptied on purpose keeps its rows. The explicit path is Settings → Local Files → **Remove Missing Files** (`localFiles:find-missing`, then `localFiles:remove-missing` after a `window.confirm` with the count), and, for one track, the context-menu item **Remove Missing File from Library**. The logic is `local-files/missing-files.js` (pure, filesystem injected, tested) and keeps the guard's promise: a watch folder whose root can't be read is skipped and named, never counted as missing; only a definite ENOENT/ENOTDIR is missing (a permission error or a stalled mount is "unknown" and kept); and removal re-checks every path, since a file can come back between the count and the confirm. The Collection songs tab lists local-library tracks alongside collection tracks; it used to tell the context menu `isInCollection: true` for every row, so library-only tracks got a "Remove from Collection" that failed with "not in your collection". It now sends the real membership plus `isLibraryTrack`, and main offers Show in Finder/Folder for those, or Remove Missing File when the file is gone.

### chokidar caveat

The watcher (foreground mode) listens for individual `unlink` events and deletes per-file from the DB. Chokidar may fire a flood of `unlink` events when a watched volume disappears mid-session — there's currently no batched safeguard there equivalent to the scanFolder guard. If users still report disappearance with a foreground app, look at `processFileChange('unlink', ...)` next.

### Library Load Performance

Big libraries (50k–150k tracks) used to freeze the app for tens of seconds during enrichment. Three changes keep load reasonable across the size range:

**Sync warm-cache fast-path for album art.** `formatTrackForRenderer` (local-files/index.js) returns `file://` URLs for `folder_art_path` and the embedded-art cache file (`cache/embedded-<md5(file_path)>.{jpg,png}`) if they exist on disk — no IPC, no extraction. Tracks with already-extracted art render with art immediately on library load. A whole-library load (`getAllTracks`) passes `buildArtIndex()`: one `readdir` of the art cache plus one memoized existence check per other path (a folder's `cover.jpg` once per folder), instead of 2–3 blocking `fs.existsSync` calls per track in the main process (#784; 150k tracks on SSD: 915 ms → 387 ms, far more on network drives). Single-track callers check directly. **The background poll reports `poll-complete` only when a scan added, updated or removed something** (with the counts): it used to fire every 5 minutes regardless, and the renderer answers it with a full library reload. Tests: `tests/local-files/library-load.test.js`.

**Lazy embedded-art warmup** (`enrichLocalTracksWithEmbeddedArt`, app.js ~L8912). For tracks that have embedded ID3 art or sibling `cover.jpg` but no extracted cache entry yet, an 8-way concurrency-limited background loop walks them, calls the new `localFiles:resolveArt` IPC (`resolveArtForTrack(track)` in local-files/index.js), and patches the renderer's library state in batches of 50. Runs unconditionally on every library load — costs nothing for small libraries, pays the extraction cost lazily for big ones.

**Library-scale artwork lookup, and incremental library updates (#784).** `enrichLocalTracksWithArtwork` looks up ONE track per album (`albumArtGroupKey`: album artist + album; album-less tracks are their own group), on the background lane, 4 in flight, with `skipIsrcFallback` (the MusicBrainz ISRC endpoint yields no release MBID, and at library scale it would fill the 1 req/s background lane for hours), fetches the release's Cover Art Archive front once, and publishes the URL onto the CURRENT library rows by file path in batches (never by mutation: a reload mid-pass replaces the row objects, and the memoized pages would not re-render). Each album is attempted once per session (`localArtAttemptedRef`). This replaced a 10k-track cutoff above which the pass was skipped. A watcher change no longer reloads the whole library: `classifyLibraryChanges` (`src/renderer/lib/library-changes.js`) turns per-file results (`added`/`updated`/`removed`, and the ID3 editor's `{ type: 'update' }`) into paths, the renderer fetches just those rows (`localFiles:getTracksByPaths`, capped at 5,000), patches by file path (`applyLibraryPatch`; a re-indexed file gets a new DB row id), updates `libraryFilePathsRef` in place and bumps the reconcile. Bulk events (folder scan, rescan, folder removed, missing-files removal, background poll with changes) and anything before the first full load still reload in full. Tests: `tests/renderer/library-changes.test.js`.

**Library scan progress toast.** Throttled at 250ms so navigating away from the scan screen mid-import still shows scan status. Prevents the "did it freeze?" reaction.

### IPC field translation for resolveArt

`localFiles:resolveArt` (main.js) accepts the renderer-shaped track payload (camelCase: `filePath`, `hasEmbeddedArt`, `folderArtPath`, `musicbrainzReleaseId`, `musicbrainzArtUrl`) and translates to the snake_case the resolver expects (`file_path`, `has_embedded_art`, `folder_art_path`, etc.) before calling `service.resolveArtForTrack(dbShaped)`. The renderer-side track may strip the `local-` prefix from `id`; the handler restores it for DB lookups. Forward-compatible: passing the raw snake_case shape also works since the handler reads from both keys.
