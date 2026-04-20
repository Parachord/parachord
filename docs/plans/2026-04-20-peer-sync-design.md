# Peer Sync via Cloud Storage — Design

**Date:** 2026-04-20
**Status:** Design draft, not yet scheduled for implementation
**Related:** forthcoming ownCloud/WebDAV resolver plugin; existing sync system (CLAUDE.md "Syncing System")

## Problem

Parachord today syncs playlists to *music services* (Spotify, Apple Music) via per-provider APIs that own playback and own their own track IDs. This is great for "share my Parachord playlist with my Spotify friends" but is the wrong shape for "keep my Parachord state consistent across my laptop, desktop, and phone."

Users want the second thing. The asks we've heard:

- Playlists created on one device appear on the other within minutes.
- Collection additions (albums, artists, tracks) replicate across devices.
- Friends list, hidden-friend keys, preferences replicate.
- Works without Parachord running a central server, and without trusting a Parachord-operated cloud.

A forthcoming **ownCloud/WebDAV resolver plugin** (primarily for playing music files stored on a user's own ownCloud/Nextcloud server) gives us an opportunity: the same plugin already holds WebDAV credentials for a cloud store the user trusts. If that plugin can *also* optionally use its WebDAV endpoint as a peer-sync backend, we get cross-device sync with no extra auth flow, no Parachord-operated infrastructure, and no tie-in to any specific music service.

## Scope

In scope for v1:

1. A new **device-sync subsystem** in main.js, orthogonal to the existing music-service sync. Backends declared by plugins via a new capability type (`collectionSync`).
2. **WebDAV backend** as the first (and only v1) backend, shipped with the ownCloud plugin.
3. **Peer semantics** (not authoritative): each device is an equal peer; merges are deterministic; no single device is the source of truth.
4. **Synced state:** playlists, collection (albums/artists/tracks), `sync_playlist_links`, `hidden_friend_keys`, friends list.
5. **Conflict handling:** automatic merge where possible (add-wins sets, LWW scalars); user-visible toast when track order conflicts force a loser.

Out of scope for v1:

- Full Operational Transform / RGA-style CRDT for track order — LWW on the ordered array is acceptable.
- Syncing caches (album art, MBID mapper, charts, artist bios). All regenerable.
- Syncing playback state (current track, queue, scrobble history). Different problem shape.
- Multi-backend sync (writing to both ownCloud *and* Dropbox simultaneously). One backend per install.
- Encryption at rest. WebDAV share security is whatever the user's server provides; users who want E2EE can layer it below (e.g. Cryptomator mount).
- Large-file handling. Playlist/collection JSON is small; we don't need chunked uploads.
- Mobile clients. Design must be compatible (Android already has OkHttp/WebDAV libs), but desktop is v1.

## Why peer, not authoritative

An authoritative design would be much simpler: the cloud copy is the source of truth, local state is a cache, on conflict cloud wins. This is what hosted XSPF playlists do today (app.js L32167+).

The problem: users edit offline. On a plane, on a subway, with a flaky hotel wifi. If the cloud is authoritative:

- Offline edits on device A are overwritten by a subsequent sync from device B that hadn't seen them.
- "Last device to connect wins" is not the same as "last edit wins" — it's worse, because the winning state can be *older* than the losing state.
- Recovery requires manual backup/restore muscle memory users don't have.

Peer semantics make the merge deterministic: both edits are preserved if they touched disjoint state, and when they truly conflict (both devices renamed the same playlist), a Lamport clock picks a winner and the user sees a toast — not silent data loss.

## Data Model

### Remote file layout

Under a single root directory on the WebDAV share (configurable per install, defaulting to `/Music/.parachord/`):

```
.parachord/
  manifest.json                  # top-level version map
  playlists/
    {localPlaylistId}.json       # per-playlist state + tombstones
  collection.json                # or sharded if large (see §Collection sharding)
  friends.json                   # friends list + hidden_friend_keys
  sync_links.json                # mirror of electron-store sync_playlist_links
  devices/
    {deviceUuid}.json            # last-known vector clock, diagnostic only
```

Per-object files mean one playlist edit rewrites one small file, not the whole state blob. WebDAV ETags on each file give us per-object optimistic concurrency.

### Manifest schema

```json
{
  "schemaVersion": 1,
  "updatedAt": 1745174400000,
  "updatedBy": "device-uuid-...",
  "playlists": {
    "playlist-1745000000000": { "version": 7, "etag": "\"abc123\"", "deleted": false },
    "playlist-1744000000000": { "version": 3, "etag": "\"def456\"", "deleted": true, "deletedAt": 1745100000000 }
  },
  "collection": { "version": 42, "etag": "\"xyz789\"" },
  "friends": { "version": 5, "etag": "\"ghi012\"" },
  "syncLinks": { "version": 9, "etag": "\"jkl345\"" }
}
```

`version` is a Lamport counter per object. On every local write that touches an object, we increment its version past the highest version we've ever seen for it (local or remote).

Deletion tombstones in the manifest are retained for **30 days** past `deletedAt`, then garbage-collected by whichever device next writes the manifest. 30 days is empirically more than the longest offline stretch we expect from real users while being short enough that the manifest doesn't grow unbounded.

### Per-playlist file schema

```json
{
  "id": "playlist-1745000000000",
  "version": 7,
  "deviceUuid": "device-uuid-of-last-writer",
  "updatedAt": 1745174400000,
  "scalars": {
    "name":        { "value": "Running mix", "version": 5, "deviceUuid": "...", "updatedAt": ... },
    "description": { "value": "...",         "version": 2, "deviceUuid": "...", "updatedAt": ... },
    "localOnly":   { "value": false,         "version": 1, "deviceUuid": "...", "updatedAt": ... }
  },
  "tracks": {
    "ordering": {
      "value": ["trackKey1", "trackKey2", "trackKey3"],
      "version": 6,
      "deviceUuid": "...",
      "updatedAt": ...
    },
    "members": {
      "trackKey1": { "track": { /* full track object */ }, "addedAt": ..., "addedBy": "device-..." },
      "trackKey2": { "track": { ... },                     "addedAt": ..., "addedBy": "..." },
      "trackKey3": { "track": { ... },                     "addedAt": ..., "addedBy": "..." }
    },
    "tombstones": {
      "trackKey4": { "removedAt": 1745170000000, "removedBy": "device-..." }
    }
  },
  "syncedTo":   { /* copied verbatim, LWW-merged as scalar */ },
  "syncedFrom": { /* copied verbatim, LWW-merged as scalar */ },
  "source":     { /* copied verbatim */ },
  "sourceUrl":  "..."
}
```

**Track key.** Not the local track ID (which may differ between devices for the same logical track). The key is `hash(title + '|' + artist + '|' + album)` — stable across devices for the same logical track, and if a user truly has two different tracks with identical metadata they collide but that's acceptable (they'd be deduplicated in the UI anyway).

### Merge rules per field type

| Field class | Rule | Tie-break |
|---|---|---|
| Scalar (`name`, `description`, `localOnly`, `syncedTo`, `syncedFrom`) | Last-write-wins by Lamport version. | Higher `deviceUuid` lexicographically. |
| Track membership | Add-wins with tombstones. A track is present iff `addedAt > tombstone.removedAt` (or no tombstone exists). | N/A |
| Track order | LWW on the whole ordered array. | Higher `deviceUuid` lex. Loser's reorder is discarded; toast the user. |
| Manifest entry | LWW by version. Deletion is a scalar field like any other. | Higher `deviceUuid` lex. |

**Tombstone retention in per-playlist files:** 90 days. Longer than manifest tombstones because a playlist-level tombstone only needs to live until every device has seen it, whereas track-level tombstones need to outlive any offline device that might otherwise "resurrect" the track by re-syncing its stale member list.

### Collection sharding

`collection.json` can grow large. Shard by `hash(trackId) % 16` into `collection/shards/{0..15}.json`. Each shard has its own manifest version. v1 can ship without sharding and add it when a user report shows a > 5 MB collection file; the schema supports it from day one (manifest key becomes `collection.shards[{i}]`).

## Sync Loop

On each tick (default cadence: every 5 min while active, immediately on app start, immediately on any write that touches synced state):

1. **Fetch manifest.** `GET /.parachord/manifest.json` with cached `If-None-Match`. 304 → skip everything, done.
2. **Diff versions.** For each object (playlist, collection, friends, sync_links), compare local version with remote version.
3. **Pull first.** For objects where remote version > local version, `GET` the object file, merge into local state per the rules above, write local state, bump local version to `max(local, remote)`.
4. **Push.** For objects where local version > remote version (after step 3's merge), `PUT` with `If-Match: {remote etag}`. On 412, restart loop from step 1 (someone else raced us).
5. **Update manifest.** Build new manifest reflecting all writes in this tick. `PUT /.parachord/manifest.json` with `If-Match`. On 412, restart from step 1.
6. **Garbage collection.** If manifest has tombstones older than 30 days and no other device has written in 30 days, drop them.

**Back-off.** On repeated 412s (> 3 in a single tick), linear back-off up to 30s. On 5xx or network errors, exponential back-off up to 5 min.

**Coordination with existing music-service sync.** Device sync runs independently of `syncPlaylistsToProviders`. A playlist created on device A, synced via ownCloud to device B, appears on B with its full `syncedTo` block intact — which means B will *not* create a new Spotify playlist for it, because the durable link (`sync_playlist_links` is also peer-synced) is preserved. This is the critical invariant that keeps peer sync from multiplying Spotify-side duplicates.

## Device Identity

`peer_device_uuid` in electron-store. Generated on first run via `crypto.randomUUID()`. Human-readable display name (`peer_device_name`) defaults to `os.hostname()` but user-editable in settings.

Each device UUID gets a file at `devices/{uuid}.json` with its last-seen vector clock and last-sync timestamp. Purely diagnostic — used to populate a "Connected devices" panel in settings and to detect stale devices for cleanup prompts. Not consulted by the merge algorithm.

## Plugin Capability Surface

Plugins today declare capabilities for playback (`play`, `search`, etc.). Add a new top-level capability group:

```json
{
  "manifest": {
    "id": "owncloud",
    "version": "1.0.0",
    "capabilities": {
      "resolver": { "play": true, "search": true },
      "collectionSync": {
        "backend": "webdav",
        "rootPath": "/Music/.parachord"
      }
    }
  },
  "implementation": {
    "play": "...",
    "search": "...",
    "sync": {
      "list":   "function(path, config) { ... }",
      "get":    "function(path, config) { ... }",
      "put":    "function(path, body, ifMatch, config) { ... }",
      "delete": "function(path, ifMatch, config) { ... }"
    }
  }
}
```

The `sync` implementation object is a minimal 4-method interface: list, get, put, delete — all respecting ETags. A future Dropbox/Drive/S3 plugin just implements the same 4 methods against its native API; the merge engine lives in main.js and doesn't care about the backend.

Only one collectionSync-capable plugin can be *active* at a time. Enforced in settings UI (radio button, not checkbox). Switching backends is a manual "migrate" operation (dump current state from one, initialize the other) rather than simultaneous multi-backend sync.

## IPC Surface

New IPC handlers in main.js:

| Handler | Purpose |
|---|---|
| `peer-sync:status` | `{ enabled, backend, lastSyncAt, lastError, devicesSeen }` for UI |
| `peer-sync:enable` | Called when user turns it on. Initializes remote state if empty, otherwise pulls. |
| `peer-sync:disable` | Stops the sync loop. Does not delete remote state. |
| `peer-sync:force-now` | Manual sync trigger (for the refresh button in settings). |
| `peer-sync:reset-remote` | Nuclear: wipe remote `.parachord/` and re-upload local state. Confirmation required. |
| `peer-sync:list-devices` | Returns `devices/*.json` contents for settings UI. |
| `peer-sync:forget-device` | Removes a stale device entry by UUID. |

Renderer-side, the sync loop is invisible — changes land via the existing store-write paths. The only UI surface is a settings panel under the ownCloud plugin with: enable/disable toggle, status line, last-sync timestamp, device list, force-sync button, "wipe remote" escape hatch.

## Conflict UX

- **Silent merges** for scalar changes, add/remove conflicts on tracks, and any case where both sides can be preserved. No toast; users don't want to be notified every sync.
- **Toast when a user's reorder is discarded** because another device reordered the same playlist more recently. Message: "Track order in *{name}* was updated on another device; your reorder was superseded." Includes an Undo button that reapplies the local reorder with a fresh version bump.
- **Modal when remote schema version > local** (user on old client, another device on newer client wrote incompatible data). Blocks sync with "Please update Parachord to continue syncing." Read-only mode still works.

## Migration & First-Time Setup

When a user enables peer sync on the *first* device (remote `.parachord/` is empty or absent):

1. Create `.parachord/` via MKCOL.
2. Generate an initial manifest reflecting current local state at version 1 for every object.
3. Upload each object's current state.
4. Mark `peer_sync_enabled: true` in electron-store.

When enabling on a *subsequent* device (remote `.parachord/` exists):

1. Pull the manifest.
2. For each object: pull remote, merge *into* existing local state using the same rules (local version starts at 0, so remote wins on scalars; tracks merge as set-union; orderings use remote).
3. After initial pull, bump local manifest versions to match remote.
4. Push any objects where local now has data remote lacked (e.g. playlists that only existed on device 2 before it connected).

The asymmetry — device 2's local playlists win on scalars against remote v0 but lose against a remote that already has them — is a deliberate consequence of the version starting at 0. A user enabling on a second device will see their local state *merged* with remote, not overwritten.

## Invariants (future maintainers: do not break these)

- **Peer sync never calls `sync:create-playlist`.** That handler is exclusively for music-service sync. A playlist arriving via peer sync is just a local write like any other.
- **Peer sync must preserve all `syncedTo` / `syncedFrom` / `sync_playlist_links` fields.** Same requirement as any other save path (see CLAUDE.md "Invariants & Traps"). Treat these as opaque scalars and LWW them.
- **Peer sync uses `crypto.randomUUID()` track keys, not local track IDs.** Local IDs are device-scoped; track keys are content-derived and stable across devices.
- **Every `PUT` uses `If-Match`.** No blind overwrites. The only unconditional write is the initial setup on an empty remote.
- **Tombstones are data, not errors.** A track tombstone older than its matching `addedAt` means the track is present; don't filter tombstones prematurely.
- **Manifest writes are the last thing in a tick.** If the loop crashes mid-tick after uploading a playlist but before updating the manifest, the next tick sees a file that doesn't match the manifest — it'll either pull the newer file (if its version is higher than manifest) or overwrite it (if not). Either is recoverable; a half-updated manifest is not.
- **The merge engine is pure.** Given `(localState, remoteState) → mergedState` with no side effects. Makes it unit-testable without a live WebDAV server and makes it portable to Android later.

## Open Questions

1. **Rate limits.** Nextcloud and ownCloud servers vary wildly in what they'll tolerate. 5-min cadence should be safe for all but the most conservative shared hosts. Need to add a "slow mode" (30-min) option for users whose host complains.
2. **Binary metadata (cover images).** Collection entries reference album art URLs that may be Spotify/Apple CDN links that expire. Peer sync replicates the URL, not the bytes. Device 2 resolving the URL may hit a 404. Mitigation: the existing album art cache regenerates on miss. Not blocking.
3. **Mobile sync cadence.** Background sync on iOS is heavily throttled; we'd need to accept longer intervals (15–30 min) or hook into foreground events only. Worth keeping in mind for the schema now so we don't need a breaking change later.
4. **XSPF hosted playlists.** A hosted XSPF is polled every 5 min and overwrites local tracks from the URL. If peer sync is also running, the two will fight — not catastrophically (both converge) but with wasted writes. Resolution: peer sync should skip per-track merge for playlists with `sourceUrl` set, and only sync the `sourceUrl` itself as a scalar. Each device's poller then re-materializes tracks locally.
5. **Encryption at rest.** Punted to v2. Users who need it can layer Cryptomator or rclone-crypt under the mount. Designing our own encrypted-blob format now would delay v1 by months for a minority use case.

## Implementation Plan (when prioritized)

1. Merge engine as a standalone pure-function module in `sync-engine/`. Unit tests cover every merge rule with hand-crafted fixtures. No IPC, no WebDAV, no Electron — just JSON in, JSON out.
2. WebDAV backend adapter: 4 methods (list/get/put/delete) against the ownCloud plugin's existing auth.
3. main.js sync loop using the engine and the adapter. Tick timer, back-off, error handling.
4. IPC surface + settings UI under the ownCloud plugin's settings panel.
5. Wire up every local write path to bump the corresponding object's local version.
6. Soak test: two devices, a week of realistic edits (add playlists, reorder, rename, remove, go offline on one, edit both, reconnect). Diagnose any divergence.
7. Enable for alpha users behind a feature flag.

Each stage is independently shippable and testable. Stage 1 alone has value as a reference for the mobile team.
