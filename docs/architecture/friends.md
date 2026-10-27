# Friend sync (Last.fm + ListenBrainz)

> Moved verbatim out of `CLAUDE.md` on 2026-10-22 so the always-loaded guide stays short; `CLAUDE.md` indexes this file. Line references such as `app.js L####` date from when each passage was written and have drifted: search for the named function instead. Cross-references to other sections point at sibling files in `docs/architecture/`.

## Friend Sync (Last.fm + ListenBrainz)

### Overview

Desktop and Android both keep the local `friends` list aligned with each service's follow graph. Sync is **bidirectional** with asymmetric capability per service.

| Direction | Last.fm | ListenBrainz |
|---|---|---|
| **Inbound pull** | `user.getFriends` | `/user/{name}/following` |
| **Outbound push (follow)** | ❌ API deprecated 2018 | `POST /user/{name}/follow` |
| **Outbound push (unfollow)** | ❌ API deprecated 2018 | `DELETE /user/{name}/follow` |

### Data Model

Every friend carries (app.js friend shape):

```js
{
  id, username, service, displayName, avatarUrl,
  addedAt, lastFetched, cachedRecentTrack,
  savedToCollection  // false when sidebar-only, true when in collection
}
```

**`hidden_friend_keys: string[]`** in electron-store — allowlist of `"${service}:${username_lowercase}"` keys for friends the user has explicitly removed. **Load-bearing for Last.fm** (since its friend API is deprecated, the only way to make a removal stick is to skip the username on the next inbound pull). Belt-and-suspenders for ListenBrainz.

### Sync Triggers

1. **Startup:** single pull after `cacheLoaded` + 5s delay, only if Last.fm or ListenBrainz has a configured username. Guarded by `friendStartupSyncDoneRef` so it doesn't re-fire.
2. **Periodic:** every 15th tick of the existing 2-min friend-activity poll (`refreshPinnedFriends`, app.js L29044+). Gated by `friendSyncTickCounterRef` so the graph sync runs every ~30 min while the activity poll continues every 2 min. Friend graphs change orders of magnitude less often than recent tracks — no value polling at the same cadence.
3. **Inline on local action:** `addFriend` calls `followOnService` after local insert; `removeFriend` calls `unfollowOnService` before local delete. Fire-and-forget; local state is authoritative.

### Inbound Pull Algorithm

```
for each service with credentials:
  fetch friend list from service
  for each user in list:
    key = `${service}:${username_lowercase}`
    if key matches any existing friend: skip
    if key is in hidden_friend_keys: skip   // load-bearing for Last.fm
    append to batch

apply-time dedup vs friendsRef.current (covers races between two desktop
  instances syncing the same account concurrently)
setFriends(prev => [...prev, ...deduped])
```

New friends are added with `savedToCollection: false` — same default as manual add via the sidebar modal.

### Outbound Push Semantics

**`addFriend`:** after local insert succeeds
1. Remove `${service}:${username}` from `hiddenFriendKeys` (un-hide if the user is re-adding someone they previously removed).
2. `followOnService(friend)`:
   - ListenBrainz: `POST /follow` with `Authorization: Token ${userToken}`. Warn toast on failure; local add stands.
   - Last.fm: no-op (log only). API deprecated.

**`removeFriend`:** before local delete
1. Add `${service}:${username}` to `hiddenFriendKeys`. Persisted immediately via the useEffect save path.
2. `unfollowOnService(friend)`:
   - ListenBrainz: `DELETE /follow`. Swallow 404s (user deleted their account). Proceed with local removal regardless.
   - Last.fm: no-op. Allowlist is what enforces the removal.

### Sort Options

`collectionSort.friends` supports:
- `alpha-asc`, `alpha-desc` — by `displayName`
- `recent` — by `addedAt` descending ("Recently Added" in UI)
- `active` — friends with activity in the last 14 days, sorted by `cachedRecentTrack?.timestamp` descending ("Recently Active" in UI). Mirrors Android's `FriendSort.ACTIVE`.
- `on-air` — filters to friends whose last track < 10 min old, sorted by activity

Sort switch lives in the friends-tab branch of the collection view (app.js L43746+). Both `active` and `on-air` are filter-and-sort combined: an extra branch in the `displayFriends` derivation applies the inactivity cutoff alongside the on-air filter.

### Manual Sync UI

Small icon button (`M4 4v5h.582m15.356 2A8...` — circular arrows) beside the Add Friend button on the Friends tab header (app.js L43203+). Calls `syncFriendsFromServices({ silent: false })` which toasts "Synced N new friends" on success or "No new friends to sync" on a zero-result manual run. Disabled when neither service is configured.

### Invariants for Cross-Platform Consistency

- **Key shape is identical across Android and desktop:** `"${service}:${username_lowercase}"`. Either client can read the other's hidden-keys list without translation if we ever sync it.
- **`addFriend` on either platform must un-hide.** Both clients remove the key from the allowlist on add so the next sync on the other platform doesn't skip the re-added friend.
- **Last.fm is pull-only on both platforms.** Don't attempt `user.addFriend` or `user.removeFriend` — they'll 403 and introduce phantom follow/unfollow state that confuses the UI.
- **A hidden Last.fm profile is a state, not an error.** With "Hide recent listening information" on, `user.getRecentTracks` answers 403 with error 17 to everyone but the account's owner. Signing the request with the viewer's own session doesn't get past it (checked 2026-10-27), and the profile's top tracks, top artists, weekly charts and loved tracks still answer. Desktop records `hidesListening: true` on the friend record (cleared by the next successful fetch), shows "Listening hidden" on the friend card, and the Recent tab says so instead of toasting a failure (`src/renderer/lib/lastfm-hidden-listening.js`). The poll backoff for 403s still applies.
- **Outbound push failure must NOT roll back local state.** Local is authoritative; service write is best-effort.
- **Startup sync should have a small delay (~5s).** Avoids thrashing the network during bulk cache load.
