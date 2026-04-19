# Friend Sync — Design

**Date:** 2026-04-19
**Status:** Design validated, ready for implementation plan
**Related:** parachord-android `FriendsRepository.kt`, `Friend.sq`

## Problem

Desktop today only lets users add friends one at a time via an input modal (URL or username). If a user has already followed 40 people on Last.fm or ListenBrainz — as is typical for long-time users of those services — they have to add each one manually. Android already does this correctly via `syncFriendsFromServices()`. Port the same model to desktop.

A second problem compounds the first: Last.fm's friend API (`user.addFriend`, `user.removeFriend`) was deprecated in 2018 and no longer accepts writes. This means desktop can't tell Last.fm "I don't follow this person anymore." Without a local mechanism to remember that the user explicitly removed someone, the next inbound pull would re-add them forever.

A third problem: the existing "Recent" sort sorts by date-added, not by listening activity. Users want to see who's actively listening — on-air-or-recently-active first — without filtering to only on-air people (which is what the existing `on-air` sort does).

## Scope

Three additions:

1. **Bidirectional friend sync** with Last.fm and ListenBrainz. Inbound pull on a slow cadence; outbound push inline with user actions (on `addFriend` / `removeFriend`).
2. **Hidden-keys allowlist** — a persisted list of `{service}:{username_lowercase}` keys the user has explicitly removed. Skipped on every inbound pull. Load-bearing for Last.fm; belt-and-suspenders for ListenBrainz.
3. **"Most Recent Activity" sort** — sort all friends (not just on-air ones) by last-track timestamp, descending.

Out of scope for v1:
- Dedicated UI to list/un-hide hidden friends (path is: re-add via modal, which un-hides).
- Handling Last.fm username renames (stuck ghosts; user removes manually).
- Paginated fetch of very large friend graphs (> 50 friends per service).

## Why "sync" not "import"

| Direction | Last.fm | ListenBrainz |
|---|---|---|
| **Inbound pull** (service → local) | ✅ `user.getFriends` | ✅ `/user/{name}/following` |
| **Outbound push add** (on `addFriend`) | ❌ API deprecated | ✅ `POST /user/{name}/follow` |
| **Outbound push remove** (on `removeFriend`) | ❌ API deprecated | ✅ `DELETE /user/{name}/follow` |
| **Consequence** | Allowlist is the only removal mechanism | Unfollow + allowlist as safety net |

"Import" implies one-shot with no reconciliation. What we're building continuously keeps local state aligned with the service's follow graph, with asymmetric capability per service.

## Data Model

### New persisted state

**`hidden_friend_keys: string[]`** in electron-store.

- Entry shape: `"lastfm:<username_lowercase>"` or `"listenbrainz:<username_lowercase>"`.
- Loaded in the bulk-load pattern (app.js ~L18740) alongside other persisted state.
- Companion ref `hiddenFriendKeysRef` for use in async callbacks.
- Flat string array, not a `Set` — electron-store serializes natively and the list is small.

### No change to the friend object shape

Existing `friends[]` state is unchanged. Removed friends are deleted from the array entirely; the allowlist is a separate memory, not a `hidden: true` flag on the object.

### Naming

Key name `hidden_friend_keys` in storage. Desktop UI copy: "Hide friend" (since we can't actually remove on Last.fm). Cross-platform compatibility with Android (which calls the same concept `deletedFriendKeys`) would be useful if we ever sync the allowlist itself across devices — names differ but the key shape `{service}:{username}` is identical.

## Sync Flow

### When it runs

1. **On startup:** single call after `cacheLoaded` flips true and `friends` + `hiddenFriendKeys` are restored. Fire-and-forget.
2. **Periodic:** every 30 min, piggybacked on the existing 2-min friend-activity poll (`refreshPinnedFriends`, L28772 + `setInterval` at L29037). Gated by a counter so sync fires every 15th tick, not every tick — decouples friend-graph polling from activity polling because friend graphs change orders of magnitude less often.
3. **Inline on local action:** `addFriend` and `removeFriend` push to the service directly. Not batched through the sync job.

### Inbound pull algorithm (per service)

```
for each service with credentials:
  if not authenticated: skip silently (expected state, don't toast)
  try:
    remoteList = fetch friends/following from service
  except 429/5xx:
    log + skip this service (other service still runs)

  existingKeys = set of `${f.service}:${f.username.lower()}` for f in friends
  hiddenKeys   = set(hiddenFriendKeysRef.current)

  for user in remoteList:
    key = `${service}:${user.username.lower()}`
    if key in existingKeys: skip
    if key in hiddenKeys:   skip       # load-bearing for Last.fm
    fetchUserInfo(user.username)       # avatar, displayName
    newFriend = {
      id, username, service, displayName, avatarUrl,
      addedAt: Date.now(),
      savedToCollection: false,        # matches manual-add default
      cachedRecentTrack: null,         # activity poll fills on next tick
    }
    batch.push(newFriend)

if batch.length > 0:
  setFriends(prev => [...prev, ...batch])
  console.log(`[Friends] Synced N new from ${service}`)
```

### API endpoints

**Last.fm (pull only):**
```
GET https://ws.audioscrobbler.com/2.0/?method=user.getFriends
    &user={lastfmConfig.username}
    &api_key={lastfmApiKey}
    &format=json
    &limit=50
```
Response: `friends.user[]` — each with `name`, `realname`, `image[]`.

**ListenBrainz (pull):**
```
GET https://api.listenbrainz.org/1/user/{username}/following
```
No auth required for the pull. Response: `{ following: [{ musicbrainz_id }, ...] }`.

**ListenBrainz (outbound push, on local `addFriend`):**
```
POST https://api.listenbrainz.org/1/user/{friend.username}/follow
Authorization: Token {lb_user_token}
```

**ListenBrainz (outbound push, on local `removeFriend`):**
```
DELETE https://api.listenbrainz.org/1/user/{friend.username}/follow
Authorization: Token {lb_user_token}
```

### `addFriend` outbound push

After local insert succeeds:
1. Remove `${service}:${username.lower()}` from `hiddenFriendKeys` if present (so sync doesn't re-hide a user the user just added back).
2. Call `followOnService(friend)`:
   - ListenBrainz → `POST /follow`. If it fails, toast warning; keep the local add.
   - Last.fm → no-op. Log `[Friends] Last.fm follow is API-deprecated`.

### `removeFriend` outbound push

Before local delete:
1. Add `${service}:${username.lower()}` to `hiddenFriendKeys` and persist to electron-store immediately (synchronous from user perspective).
2. Call `unfollowOnService(friend)`:
   - ListenBrainz → `DELETE /follow`. If it fails, still proceed with local removal. The allowlist keeps them away on the next sync regardless.
   - Last.fm → no-op. The allowlist entry IS the removal mechanism.

### Error handling

| Situation | Behavior |
|---|---|
| Missing credentials | Skip service silently; log at info level. |
| 429 rate limit | Catch, log, skip this cycle. Next tick retries. |
| 5xx server error | Same as 429. |
| 404 on ListenBrainz `/follow` unfollow (user deleted) | Swallow, complete local removal. |
| 4xx other than 429 | Log loudly, don't toast. Sync is background — shouldn't nag. |

### Manual sync trigger

Small icon button (circular arrows) next to the sort dropdown on the Friends tab of the collection view. Tooltip: `"Sync friends from Last.fm and ListenBrainz"`.

- Click → calls `syncFriendsFromServices()`.
- Shows spinner while in progress.
- On completion: toast `"Synced N new friends"` (singular/plural) if N > 0, else silent.
- Toast error only on manual trigger, never on background runs.
- Disabled when neither service has credentials configured.

## New Sort Option: "Most Recent Activity"

Added to the existing sort switch at app.js L43698–43714:

```js
if (sort === 'activity') {
  const aTs = a.cachedRecentTrack?.timestamp || 0;
  const bTs = b.cachedRecentTrack?.timestamp || 0;
  return bTs - aTs;  // descending, newest first
}
```

Distinction from existing `on-air` sort:
- `on-air` **filters** the list to friends whose last track < 10 min old.
- `activity` **sorts everyone** by last-track timestamp, newest first. Friends with no cached track (timestamp 0) sink to the bottom.

### Dropdown label changes

- New option: `"Most Recent Activity"` (internal key: `activity`).
- Existing `"Recent"` (internal key: `recent`) renamed to `"Recently Added"` so the two aren't confused.

Internal keys stay the same; only user-facing labels change.

## Edge Cases

1. **Username case change on service.** User renamed on Last.fm. New name comes back via pull; old name lingers as ghost. Not solving in v1 — Android has the same issue. User removes ghost manually.
2. **Deleted account on ListenBrainz.** 404 on pull → fewer users returned, no crash. 404 on unfollow during `removeFriend` → swallowed.
3. **Two desktop instances running against same account.** Startup sync on both, same pull, both batch `setFriends`. Mitigation: dedup against `friendsRef.current` at apply time (same pattern collection uses). Cheap belt-and-suspenders.
4. **Large friend graphs (>50).** Both services paginate, but v1 just asks for the first page. 99% of users have < 50. If we hit real pagination-needing users, add it then.

## UI Summary

| Location | Change |
|---|---|
| Friends tab sort dropdown | Add `"Most Recent Activity"`; rename `"Recent"` to `"Recently Added"`. |
| Friends tab header | Add small circular-arrows icon button beside sort controls. |
| Settings (optional follow-up) | Not in v1. Un-hide via re-add. |

## Deliverables

1. This design doc (committed).
2. Implementation plan (separate file, to be written after design is committed).
3. Code changes in `app.js`:
   - New state: `hiddenFriendKeys`, `hiddenFriendKeysRef`.
   - New functions: `syncFriendsFromServices`, `followOnService`, `unfollowOnService`.
   - Modified: `addFriend` (un-hide + follow), `removeFriend` (add to allowlist + unfollow), sort switch (new `activity` case).
   - Startup hook in bulk-load completion.
   - Periodic-sync counter in `refreshPinnedFriends` interval.
   - UI: sync button, sort dropdown changes.
4. CLAUDE.md update to document the friend-sync mechanism for cross-platform consistency (mirror the "Playlist Sync" section added 2026-04-19).

## Cross-Platform Notes

Android has already built this system. Desktop should match the behavior so Parachord instances on different platforms present a consistent view of a user's friends:

- Same key shape `{service}:{username_lowercase}`.
- Same follow/unfollow semantics (ListenBrainz active, Last.fm no-op).
- Same allowlist enforcement on pull.

If we ever add cross-device sync of the allowlist itself (e.g. via a lightweight sync backend), the key shape already lines up and no further migration is needed.
