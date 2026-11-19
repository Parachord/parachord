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

Since #1539 step 5 every row of this table is a plug-in method, not app code: `getFollowing`, `follow` and `unfollow` of the `friends` capability (docs/architecture/plugins.md "Friends"). Last.fm's plug-in has no `follow` / `unfollow`, which is what makes it pull-only. A service with a friends plug-in gets sync, Add Friend and the Friends row with no app change.

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
2. **Periodic:** every 30 minutes (`FRIEND_GRAPH_SYNC_MS`) while Last.fm or ListenBrainz has a configured username, on its own timer next to the startup sync. Friend graphs change orders of magnitude less often than recent tracks, so it doesn't share the 2-minute friend-activity poll (`refreshPinnedFriends`). It used to run on every 15th tick of that poll, which only runs once a friend is saved or pinned: with no friends yet, someone followed mid-session never arrived until a restart. The timer calls the latest `syncFriendsFromServices` through a ref, because the function reads `metaServiceConfigs` from its render and the timer outlives it.
3. **Opening the Friends tab:** opening Collection → Friends syncs too, like mobile's Friends screen (`FriendsViewModel.init`), since that's where someone looks for a friend they just followed. A sync that started in the last 5 minutes from any trigger counts (`FRIEND_TAB_SYNC_MIN_GAP_MS`): tab switches are cheap and the Last.fm friend list is paginated. The startup sync skips too if a launch restored onto the Friends tab already synced.
4. **Inline on local action:** `addFriend` calls `followOnService` after local insert; `removeFriend` calls `unfollowOnService` before local delete. Fire-and-forget; local state is authoritative. Both go to the friend's own plug-in (`setFollowing`), a no-op where it can't follow.

The startup and periodic syncs need a friend service you're signed in to (any plug-in with a `username`), and the startup one waits for the plug-ins to load.

### Inbound Pull Algorithm

```
for each friend service you're signed in to (friendAccountsFor):
  fetch who you follow there (its plug-in's getFollowing)
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
   - The friend's plug-in's `follow` (ListenBrainz: `POST /follow` with `Authorization: Token ${userToken}`). A warning on failure; local add stands.
   - Last.fm: no-op, the plug-in has no `follow` (API deprecated).

**`removeFriend`:** before local delete
1. Add `${service}:${username}` to `hiddenFriendKeys`. Persisted immediately via the useEffect save path.
2. `unfollowOnService(friend)`:
   - The friend's plug-in's `unfollow` (ListenBrainz: `DELETE /follow`; a 404, the account gone, counts as done). Proceed with local removal regardless.
   - Last.fm: no-op, the plug-in has no `unfollow`. Allowlist is what enforces the removal.

### Adding a friend

Add Friend takes a username or a profile link (`addFriend`). Each friend service's plug-in is asked in turn (`findUser`): the ones you're signed in to first, then the rest, in your order. A profile link is only its own service's (the other plug-ins answer `null` without a request); a plain name goes to the first service that has someone by it. Before #1539 step 5 a plain name always tried Last.fm first. `addFriendCore({ service, username })` adds on one named service and refuses one that isn't a friend service (a plug-in with `capabilities.friends`).

### Sort Options

`collectionSort.friends` supports:
- `alpha-asc`, `alpha-desc` — by `displayName`
- `recent` — by `addedAt` descending ("Recently Added" in UI)
- `active` — friends with activity in the last 14 days, sorted by `cachedRecentTrack?.timestamp` descending ("Recently Active" in UI). Mirrors Android's `FriendSort.ACTIVE`.
- `on-air` — filters to friends whose last track < 10 min old, sorted by activity

Sort switch lives in the friends-tab branch of the collection view (app.js L43746+). Both `active` and `on-air` are filter-and-sort combined: an extra branch in the `displayFriends` derivation applies the inactivity cutoff alongside the on-air filter.

### Manual Sync UI

Small icon button (`M4 4v5h.582m15.356 2A8...` — circular arrows) beside the Add Friend button on the Friends tab header (app.js L43203+). Calls `syncFriendsFromServices({ silent: false })` which toasts "Synced N new friends" on success or "No new friends to sync" on a zero-result manual run. Disabled when neither service is configured.

### Recommended people (Recommendations page)

The Recommendations page's Listeners section lists people from plugins with the `similarUsers` capability (see "Similar users" in [plugins.md](plugins.md) and "Listeners (Recommendations)" in [../features/RECOMMENDATIONS.md](../features/RECOMMENDATIONS.md)). Opening one shows their profile as a non-friend: the friend page renders from a person who is not in `friends`, with a **Follow** button in place of Pin. Follow runs `addFriendCore({ service, username })` with the explicit service the recommendation came from (no Last.fm-then-ListenBrainz probe, which could pick the wrong service for a username that exists on both), the same path Add Friend uses: it builds the friend, pins them to the sidebar, un-hides them if they were removed, and follows a ListenBrainz person on ListenBrainz (Last.fm stays pull-only). `addFriendCore` takes only the friend services (`FRIEND_SERVICES`: `lastfm`, `listenbrainz`) and throws on any other, and the row takes only providers whose id is one of them, so a future `similarUsers` plugin for another service can't make Follow look the same name up on ListenBrainz. The new friend is then selected, and the person leaves the Listeners section because it excludes anyone already followed. A saved last view for a recommended person restores to Recommendations, since they are not in `friends` to look up.

A friend page tab whose load fails (the service unreachable) shows "Couldn't reach <service>" with Try again, the service named from its plugin, instead of an empty list that reads as "they have none"; each loader records the failure in `friendHistoryData.errors[tab]` and a later success clears it.

### Where a friend's listening comes from

A friend's now playing (the 2-minute poll), weekly stats, profile tabs (Recent, Top Tracks, Top Albums, Top Artists) and "playing now" for their radio come from their own service's plug-in, through the `listeningHistory` capability (#1539 step 5; docs/architecture/plugins.md "Listening history"): `askFriend(friend, method, query)` in app.js calls `getRecentListens`, `getTopItems` or `getNowPlaying` on the plug-in whose id is `friend.service`, with `user` set to their username. The plug-in's error carries the HTTP status, which the poll's backoff records (`recordFriendPollStatus`; a success counts as 200), and Last.fm's hidden-profile 403 (error 17) as `hidesListening`. The friend graph and adding a friend go through the same plug-in's `friends` methods (see "Adding a friend" and the table above).

### Invariants for Cross-Platform Consistency

- **Key shape is identical across Android and desktop:** `"${service}:${username_lowercase}"`. Either client can read the other's hidden-keys list without translation if we ever sync it.
- **`addFriend` on either platform must un-hide.** Both clients remove the key from the allowlist on add so the next sync on the other platform doesn't skip the re-added friend.
- **Last.fm is pull-only on both platforms.** Don't attempt `user.addFriend` or `user.removeFriend` — they'll 403 and introduce phantom follow/unfollow state that confuses the UI.
- **A hidden Last.fm profile is a state, not an error.** With "Hide recent listening information" on, `user.getRecentTracks` answers 403 with error 17 to everyone but the account's owner. Signing the request with the viewer's own session doesn't get past it (checked 2026-10-27), and the profile's top tracks, top artists, weekly charts and loved tracks still answer. Desktop records `hidesListening: true` on the friend record (cleared by the next successful fetch), shows "Listening hidden" on the friend card, and the Recent tab says so instead of toasting a failure (the Last.fm plug-in's `getRecentListens` throws with `hidesListening`, #1539 step 5). The poll backoff for 403s still applies.
- **Outbound push failure must NOT roll back local state.** Local is authoritative; service write is best-effort.
- **Startup sync should have a small delay (~5s).** Avoids thrashing the network during bulk cache load.
