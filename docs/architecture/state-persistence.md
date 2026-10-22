# State persistence

> Moved verbatim out of `CLAUDE.md` on 2026-10-22 so the always-loaded guide stays short; `CLAUDE.md` indexes this file. Line references such as `app.js L####` date from when each passage was written and have drifted: search for the named function instead. Cross-references to other sections point at sibling files in `docs/architecture/`.

## State Persistence

### Bulk Load Pattern (L18740)
- Single IPC roundtrip: `window.electron.store.getBatch(allKeys)` loads 40+ keys at once
- Includes caches (album art, artist data, track sources), settings, preferences, queues
- `cacheLoaded` flag (L7923) gates initialization effects until restore completes

### Key Persisted Values
- `saved_volume`, `preferred_spotify_device_id`, `active_resolvers`, `resolver_order`
- `saved_queue`, `saved_playback_context`, `auto_launch_spotify`, `skip_external_prompt`
- Caches with TTLs: album art (90 days), artist data (30 days, version-checked), release details / tracklists by MB release ID (`cache_release_details`, 30 days, pruned to the 400 most recent on save, entries are 10-30 KB; release-group IDs resolved on the album page are stored as `{ alias: releaseId }` so a revisit from search makes zero MB calls; every `/ws/2/release/{id}?inc=recordings` fetch goes through `fetchReleaseDetails(releaseId, fetchImpl?)` in app.js, which mimics the `ok`/`status`/`json()` subset of Response so the 404 → release-group fallbacks still work), MBID mapper (90 days), charts, new releases, concerts

### Big keys live in their own files (`main-process/split-store.js`)
electron-store re-reads, re-parses and rewrites its whole file on every `set()`, synchronously on the main thread. When `config.json` reached 40 MB (17 MB `local_playlists`, 9 MB `cache_track_sources`, …) one small setting cost ~0.5 s and the 5-minute cache save froze the window for seconds (the pinwheel, 2026-10). `main.js`'s `store` is now `createSplitStore`: `local_playlists`, `sync_playlist_state` and every `cache_*` key (by prefix, so a new cache is covered automatically) live in `userData/store/<key>.json`, everything else stays in `config.json` (~0.3 MB). Same get/set/delete/has/clear/`store` surface, same copy-on-get semantics, so callers don't change. Migration runs once at startup and is one-way; where a key is in both places the split file wins. An **older build** run afterwards sees no playlists or caches (the data is intact in `store/`), and anything it writes to those keys in `config.json` is discarded when a newer build starts. A big key still costs its own size per write (`local_playlists` ~0.2 s); per-playlist storage is #801. Tests: `tests/store/split-store.test.js` (real `conf` stores in a temp dir).

### Save Triggers
- On unmount (cleanup effect)
- Periodically (every 5 minutes)
- Immediately on preference change (volume, preferred device, etc.)

**In practice only the 5-minute timer persists the big caches between launches.** Quit goes through main's `before-quit` → `app.exit(0)`, which never unmounts the renderer, so the unmount save doesn't run. A cache populated in a session shorter than five minutes is lost. (Known gap, not fixed; flushing several multi-MB `store.set` calls from `beforeunload` isn't reliable.)

### Allowlist trap: every persisted key must be in `ALLOWED_STORE_KEYS` (main-process/ipc/store.js)
The `store-get` / `store-set` / `store-delete` / `store-get-batch` IPC handlers refuse keys that aren't in `ALLOWED_STORE_KEYS`. **The refusal is silent from the renderer's side**: `store.set` resolves `false` (nobody checks it) and main logs `⚠️ Blocked store-set for non-whitelisted key: <key>`. Until 2026-10-12 `cache_critics_picks`, `hosted_playlists`, `sync_engine_mode`, `sync_playlist_channels`, `discovery_seen_concerts` and `discovery_seen_newReleases` were all missing, so Critical Darlings never persisted, the sync-engine mode toggle never stuck across restarts, and the renderer always read `{}` for channel overrides. `tests/store/allowed-store-keys.test.js` parses the allowlist and every literal key the renderer passes to `store.*` (plus the `discovery_seen_${feature}` and `scrobbler-config-${id}` families) and fails on any key that isn't allowlisted. When adding a persisted key: add it to `ALLOWED_STORE_KEYS` first, then use it. If a value "mysteriously" doesn't persist, grep the main-process log for `Blocked store-`.
