# Apple Music Track Removal on Playlist Push — Design

**Date:** 2026-04-20
**Status:** Design validated, ready for implementation

## Problem

Today, pushing updates to an Apple Music playlist is additive only. Tracks removed locally persist on the Apple Music copy. The Spotify mirror (on a dual-enabled sync) behaves as full replace — the user sees deletions land there but not on Apple Music, and the two mirrors of the same local playlist drift apart over time.

This asymmetry exists because the previous implementation used only Apple Music's documented public endpoint (`POST /v1/me/library/playlists/{id}/tracks`), which is append-only. Apple's documented API has no per-track DELETE.

## Premise

Apple's *undocumented* endpoint `DELETE /v1/me/library/playlists/{playlistId}/tracks/{libraryTrackId}` has been used reliably by third-party Apple Music clients for years (Cider, Soor, community API wrappers). It's not part of Apple's public contract, but empirically it's stable. Parachord can use it with graceful fallback if Apple ever changes behavior.

## Scope

Rewrite `sync-providers/applemusic.js` → `updatePlaylistTracks` to implement full replace semantics:

1. Fetch current remote tracks.
2. Compute a diff between requested (local) and remote catalog IDs.
3. DELETE any remote rows not in the requested set, plus duplicate rows for catalog IDs that are in the requested set.
4. POST additions for catalog IDs in the requested set not currently on the remote.

Match Spotify's replace semantics so dual-enabled users get consistent behavior across mirrors.

Out of scope:
- No user-facing setting. Match Spotify's behavior transparently.
- No experimental labeling. If Apple breaks the endpoint, fail gracefully and move on.
- No respect for local duplicate counts (if a track is in local 3 times, the mirror gets it once). Apple Music supports duplicates but this is vanishingly rare in practice.

## Algorithm

```js
async updatePlaylistTracks(playlistId, tracks, token) {
  // Inputs: catalog IDs on the local side (appleMusicCatalogId or appleMusicId).
  const requestedCatalog = new Set(
    tracks.filter(t => t.appleMusicCatalogId || t.appleMusicId)
          .map(t => String(t.appleMusicCatalogId || t.appleMusicId))
  );

  // Current remote state: library rows with catalog IDs + library IDs.
  const remoteTracks = await this.fetchPlaylistTracks(playlistId, token);

  // Identify rows to remove:
  //   - rows whose catalog isn't in the requested set, OR
  //   - rows whose catalog IS in the requested set but we've already
  //     kept one such row (collapse duplicates to one).
  const toRemove = [];
  const seen = new Set();
  for (const r of remoteTracks) {
    const catalog = String(r.appleMusicId || '');
    if (!requestedCatalog.has(catalog)) {
      toRemove.push(r);
    } else if (seen.has(catalog)) {
      toRemove.push(r);
    } else {
      seen.add(catalog);
    }
  }

  // Identify catalog IDs to add: requested but not already present.
  const toAdd = [...requestedCatalog].filter(id => !seen.has(id));

  // DELETE loop (skipped if the session flag says Apple's endpoint is broken).
  let removed = 0;
  if (!amRemovalUnsupportedRef.current && toRemove.length > 0) {
    removed = await this.#deleteTracksFromPlaylist(playlistId, toRemove, token);
  }

  // POST additions.
  let added = 0;
  if (toAdd.length > 0) {
    added = await this.#postTracksToPlaylist(playlistId, toAdd, token);
  }

  const snapshotId = await this.getPlaylistSnapshot(playlistId, token);
  return { success: true, snapshotId, added, removed };
}
```

## DELETE Endpoint

```
DELETE https://api.music.apple.com/v1/me/library/playlists/{playlistId}/tracks/{libraryTrackId}
Authorization: Bearer {developerToken}
Music-User-Token: {userToken}
```

The library-track ID (e.g. `i.GE5rp8DTYkZdO5`) is what this endpoint accepts — NOT the catalog ID. Our `transformTrack` already stores this on each fetched remote track row as `externalId`, so no new plumbing is needed.

## Error Handling

Per-track DELETE response handling:

| Response | Behavior |
|---|---|
| 200 / 204 | Success. Count toward `removed`. |
| 404 | Track already gone on Apple's side. Idempotent success. Count toward `removed`. |
| 429 | Rate limit. Read `Retry-After`, wait, retry once. Still 429 → abort DELETE loop for this playlist only; continue to POST. |
| **405** | Apple pulled or restricted the endpoint. Set `amRemovalUnsupportedRef.current = true` (module-scope, lives for the process). Abort DELETE loop. Continue to POST. Future `updatePlaylistTracks` calls in the same process skip the DELETE loop entirely. Resets on app restart. |
| 401 / 403 | Auth failure. Goes through the existing `refreshTokenCb` pattern used by other AM calls. |
| Other 4xx / 5xx | Log, skip this track, continue to the next. Don't abort the loop. |

Between calls: `await new Promise(r => setTimeout(r, this.getRateLimitDelay()))` — current helper returns 150ms.

## Session Kill-Switch

```js
// Module-scope in sync-providers/applemusic.js
const amRemovalUnsupportedRef = { current: false };
```

Plain object with a `current` field (mirrors React ref shape, but no React here). Mutated by the DELETE loop on 405. Read before each DELETE-loop entry. No persistence — if Apple restores the endpoint, we recover on next app restart at the cost of one wasted 405.

## Return Shape

```js
{ success: true, snapshotId, added: number, removed: number }
```

Today's callers (`sync:create-playlist`, `sync:push-playlist`) ignore these counts. Future UI may use them (e.g. "Synced: +3 / −2 to Apple Music"). Not in scope for this change.

## What Changes for Users

- Tracks removed from a Parachord playlist will now propagate to the Apple Music copy on the next push. Matches Spotify behavior.
- Tracks they may have added directly in the Apple Music app (not via Parachord) will now be removed by the next push. This is a behavior change. Acceptable because the mental model — "my Parachord playlist mirrors to AM" — was already implicit.
- No new Settings UI. No toast notifications. No "experimental" labeling.
- If Apple's DELETE endpoint stops working (returns 405), the session silently falls back to append-only for the remainder of the process. Restart to re-probe.

## What Stays the Same

- Signature of `updatePlaylistTracks` is unchanged.
- Fetch-before-push pattern unchanged.
- Rate-limiting via `getRateLimitDelay()` unchanged.
- `deletePlaylist` fallback path (rename on 405) unchanged — the rename step still works whether or not the `updatePlaylistTracks` clear inside it succeeded.

## Implementation Notes

1. Extract `deleteTracksFromPlaylist(playlistId, libraryRows, token)` and `postTracksToPlaylist(playlistId, catalogIds, token)` as private helpers inside the provider for readability.
2. Batch for POST stays at one request per call (Apple accepts multi-track bodies just fine).
3. DELETE is one-track-per-call (per Apple's endpoint design).
4. Log counts at the end: `[AppleMusic] Playlist {id}: +{added} / −{removed} (skipped-unsupported={removed-skipped})`.
5. `transformTrack` already exposes `externalId = song.id` (library ID) — no provider-shape changes needed.

## Testing

1. Add a track locally, sync → verify track appears on AM.
2. Remove a track locally, sync → verify track disappears from AM.
3. Replace 5 tracks locally (remove 3, add 2), sync → verify AM matches.
4. Manually add a track on AM directly (via the Music app), then sync → verify it's removed.
5. Playlist with no changes (idempotent sync) → verify no DELETE or POST calls.
6. Stub DELETE to return 405 → verify session kill-switch fires and POST still runs for the same call.

## CLAUDE.md Update

"Provider-Specific Push Semantics" table flips Apple Music from "Diff-based append-only" to "Full diff (add + remove) via GET + DELETE + POST." Consequences list updates to reflect:
- `updatePlaylistTracks` with empty array now correctly clears.
- DELETE endpoint is undocumented; we fall back to append-only within a session if it breaks.
- Per-track cost — large deletions (hundreds of tracks) take tens of seconds.
