# Android parity requirements

> Moved verbatim out of `CLAUDE.md` on 2026-10-22 so the always-loaded guide stays short; `CLAUDE.md` indexes this file. Line references such as `app.js L####` date from when each passage was written and have drifted: search for the named function instead. Cross-references to other sections point at sibling files in `docs/architecture/`.

### Android Parity Requirements

This section is for the Android client — Parachord's sync logic must stay byte-compatible with the desktop so playlists round-trip correctly. Every rule here was learned from a real bug that broke propagation until it was fixed. Skipping any one silently breaks multi-provider sync for users on both platforms.

**Apple Music provider must degrade gracefully on library-endpoint rejections.** Apple's public API (`api.music.apple.com`) rejects all of the following on user library resources with 401/403/405 — this is documented policy (Apple Developer Forum 107807), not a bug or a token issue:

| Endpoint | Apple's response | Required Android behavior |
|---|---|---|
| `DELETE /me/library/playlists/{id}` | 401 | Do NOT throw. Return `{success: false, reason: 'endpoint-unsupported', status}`. Surface to user as "remove manually in the Music app." |
| `DELETE /me/library/playlists/{id}/tracks/{libraryTrackId}` | Varies / unreliable | Do NOT implement. No third-party client actually uses this endpoint; Cider achieves removal by PUT on the parent resource. |
| `PATCH /me/library/playlists/{id}` (rename/description) | 401 | Do NOT throw. Flip a session kill-switch, log once, return success-with-skipped. **Load-bearing** — the rename step runs before the track push in `sync:push-playlist`; a throw here aborts the track push too. |
| `PUT /me/library/playlists/{id}/tracks` (replace) | 401 on many tokens | Do NOT throw. Flip a separate session kill-switch, log once, fall back to `POST` append for the additions only. Removals will persist on the remote — accept this, document it. |
| `POST /me/library/playlists/{id}/tracks` (append) | 204 | Works. This is the only reliable write path. |

Specifically on Android: if you find yourself writing `if (!response.isSuccessful()) throw new IOException(...)` around any of the PATCH/PUT/DELETE calls above, stop. That's the bug that killed desktop pushes for months. The function's contract must be "best-effort; never throw on documented-unsupported 401/403/405." Use two separate booleans (`amPutUnsupportedForSession`, `amPatchUnsupportedForSession`), not one shared flag — they're independent endpoints with independent kill-switches.

**Do NOT retry-on-401 for any of the documented-unsupported endpoints.** A "defensive" refresh-and-retry on 401 looks harmless but introduces a worse failure mode: when the MusicKit bridge returns no fresh token during the retry attempt, the desktop's `buildAppleMusicRefreshCb` emits `applemusic:reauth-required` and force-walks the user through the System Settings revoke flow for an authorization that was never actually broken. Since the 401 is structural (Apple won't unblock the endpoint by handing you a fresh token), the retry can never succeed — it can only escalate a benign endpoint rejection into a phantom auth crisis. Go straight to the endpoint-unsupported return on the first 401. Same rule for Android: don't refresh-and-retry on 401 against these endpoints.

**Push order in the "update existing remote playlist" path:**

```
1. PATCH (rename/description)   — wrap in try/catch; never abort on throw
2. PUT or POST (tracks)         — this is the actual payload; must always run
3. Fetch new snapshotId         — return to caller
```

The wrapping try/catch is defense-in-depth. Even if the PATCH function itself never throws under normal rejection, a network error or unexpected 5xx should also not kill the track push.

**Push loop invariants (both background timer and post-wizard "Sync Now"):**

```kotlin
for (playlist in localPlaylists) {
    if (playlist.localOnly) continue
    // Provider-scoped guard — NOT `if (playlist.syncedFrom != null) continue`.
    // A Spotify-imported playlist has syncedFrom.resolver == "spotify"
    // and must still be pushable to Apple Music.
    if (playlist.syncedFrom?.resolver == providerId) continue
    if (playlist.id?.startsWith("$providerId-") == true) continue
    if (playlist.syncedTo?.get(providerId)?.pendingAction != null) continue

    val syncInfo = playlist.syncedTo?.get(providerId)
    if (syncInfo == null) {
        // Create new remote; link on success.
        createRemote(playlist)
    } else if (playlist.locallyModified) {
        // Push updates. On a 404, desktop marks pendingAction = "remote-deleted"
        // and shows a banner; mobile detaches the mirror instead (see below).
        pushToRemote(playlist, syncInfo.externalId)
    }
}

// After the loop, clear locallyModified when every outbound mirror is
// up to date. Exclude the source provider — we don't push to it.
for (playlist in localPlaylists) {
    if (!playlist.locallyModified || playlist.syncedTo == null) continue
    val sourceProvider = playlist.syncedFrom?.resolver
    val relevantMirrors = enabledProviders.filter { pid ->
        playlist.syncedTo[pid]?.externalId != null && pid != sourceProvider
    }
    if (relevantMirrors.isEmpty()) {
        playlist.locallyModified = false
    } else if (relevantMirrors.all { pid ->
        (playlist.syncedTo[pid]?.syncedAt ?: 0) >= (playlist.lastModified ?: 0)
    }) {
        playlist.locallyModified = false
    }
}
```

**A playlist deleted on the provider is handled differently on purpose.** Desktop keeps the mirror, flagged `pendingAction: 'remote-deleted'`, and the playlist page's banner offers Delete locally too, Stop syncing and Re-create. Mobile detaches the mirror instead: it drops the link and N-way token and excludes that provider in the playlist's channel override ([parachord-mobile#528](https://github.com/Parachord/parachord-mobile/pull/528), `DeadMirrorReconcile.kt`). Desktop also looks for them on every sync, with mobile's rules: a mirror missing from the provider's full list is only a suspect, only a definite 404 confirms it, and more than 30 missing at once checks nothing. On desktop that check covers ListenBrainz mirrors in the legacy sync path only (parachord#1271); elsewhere a deleted mirror is found when a push gets a 404. Links are per device and neither client recreates the playlist, so the difference damages no data. Decided in parachord#1269; don't port the flag to mobile.

Both the background timer and any "sync now" action must run the full create-OR-push-update flow, not just create-if-missing. If you split them into two code paths, make sure both do the same work — don't let only the background timer push updates, or users won't see uploads until the next cadence tick.

**`sync:start` equivalent — import path must preserve cross-provider `syncedFrom`.** When matching an imported remote to an existing local (via `syncedFrom.externalId` OR `syncedTo[providerId].externalId` OR id-pattern), the match can fire because the local is a *push target* for this provider with its pull source elsewhere:

```kotlin
// local.syncedFrom?.resolver == "spotify"
// remote is from Apple Music, matched via local.syncedTo["applemusic"].externalId
val isOwnPullSource = local.syncedFrom?.resolver == null
    || local.syncedFrom.resolver == providerId

if (isOwnPullSource) {
    // Update syncedFrom, refill tracks if empty, etc. (standard path)
} else {
    // CROSS-PROVIDER PUSH MIRROR. Preserve local.syncedFrom as-is.
    // Do NOT refetch tracks — the other provider is authoritative.
    // Do NOT compute hasUpdates from snapshotId diff (snapshotIds from
    // different providers aren't comparable).
    // DO update syncSources[providerId].syncedAt.
}
```

Clobbering the cross-provider `syncedFrom` orphans the local from its real pull source; the original provider will then see it as a new playlist on its next sync and create a duplicate remote.

**Multi-provider mirror propagation — four cooperating pieces:**

1. **Pull paths must set `locallyModified = true` when other mirrors exist.** Both the explicit "pull" action and the implicit refill-on-empty path. The predicate is `hasOtherMirrors = playlist.syncedTo.any { (pid, v) -> pid != currentProvider && v.externalId != null }`. Without this, an Android edit pulled through Spotify onto the desktop never reaches Apple Music — and vice versa for edits made on desktop that should reach Apple Music via Android's Spotify pull.

2. **Every local-content mutator must persist `locallyModified = true` in the same save that writes the tracks.** If Android has `addTracksToPlaylist` / `removeTrackFromPlaylist` / `moveTrackInPlaylist` equivalents, inline the flag write — don't issue a separate state update that might not reach storage. Guard with `playlist.syncedFrom != null || playlist.syncedTo != null` so local-only playlists aren't flagged pointlessly.

3. **Push-loop `syncedFrom` guard must be provider-scoped** (see above — `syncedFrom?.resolver == providerId`, not blanket).

4. **Post-push clear logic filters to `relevantMirrors` excluding the source provider** (see the Kotlin snippet above).

**Auto-pull (2026-11).** Desktop now pulls a changed import on its own, as Android always has (see "Auto-pull" in [sync.md](sync.md)). Desktop records `syncedFrom.tracksFingerprint` to tell local edits apart (the playlist record never travels between clients) and keeps a conflict for the person to settle where Android uses last write wins. Android's empty-answer guard in `pullPlaylist` is mirrored in `applyPulledTracks`. Android can still forget an edit and pull over it; see "Android Parity Requirements (playlist sync links)" below.

**Sync wizard / playlist-picker pre-check state**, if Android has one: seed the "checked" set from the union of saved `selectedPlaylistIds`, externalIds where any local has `syncedFrom.resolver == providerId`, and externalIds where any local has `syncedTo[providerId].externalId`. Don't seed only from the last-saved list — push-only mirrors that were never selected in the wizard will appear unchecked even though they're actively syncing.

**Playlist data-model fields to preserve on every save:**

```
id, title, description, tracks,
syncedFrom, syncedTo, syncSources,
hasUpdates, locallyModified, lastModified,
localOnly, sourceUrl, source, creator,
createdAt, addedAt, tracksChangedAt, lastChangeAdded
```

`tracksChangedAt` and `lastChangeAdded` are local only (Home's freshness order and "Δ N" badge; see "Freshness stamps" in [sync.md](sync.md)), never pushed, but a save path that drops them sends the playlist to the back of Home until its tracks next change.

Missing any one of these on any save path causes a specific class of bug — e.g., dropping `syncedTo` causes duplicate remote creation; dropping `locallyModified` causes the propagation chain to silently break.

**Durable link map (`sync_playlist_links`):** Android MUST write this map in a separate transaction/key from the playlist object itself. Its entire purpose is to survive playlist-save bugs. A combined write defeats it.

**Implement the imported-playlist `syncedFrom` heal.** Desktop runs `healImportedSyncedFromMismatch` on every launch (main.js, alongside `migrateSyncLinksFromPlaylists`). Android should run the equivalent — idempotent, runs at app startup, no network. The contract:

```kotlin
for (playlist in localPlaylists) {
    val id = playlist.id ?: continue
    val impliedProvider = when {
        id.startsWith("spotify-") -> "spotify"
        id.startsWith("applemusic-") -> "applemusic"
        else -> null
    } ?: continue

    if (playlist.syncedFrom?.resolver == impliedProvider) continue

    val externalId = id.substringAfter("$impliedProvider-")
    val oldSyncedFrom = playlist.syncedFrom
    val newSyncedTo = (playlist.syncedTo ?: emptyMap()).toMutableMap()

    // Demote the wrong syncedFrom into syncedTo if not already present.
    if (oldSyncedFrom?.resolver != null
        && oldSyncedFrom.resolver != impliedProvider
        && oldSyncedFrom.externalId != null
        && newSyncedTo[oldSyncedFrom.resolver]?.externalId == null
    ) {
        newSyncedTo[oldSyncedFrom.resolver] = SyncedToEntry(
            externalId = oldSyncedFrom.externalId,
            snapshotId = oldSyncedFrom.snapshotId,
            syncedAt = playlist.syncSources?.get(oldSyncedFrom.resolver)?.syncedAt
                ?: System.currentTimeMillis(),
            unresolvedTracks = emptyList(),
            pendingAction = null
        )
    }

    // Restore the correct syncedFrom and clear sync flags.
    playlist.syncedFrom = SyncedFrom(
        resolver = impliedProvider,
        externalId = externalId,
        snapshotId = null,           // next sync from impliedProvider repopulates
        ownerId = if (oldSyncedFrom?.resolver == impliedProvider) oldSyncedFrom.ownerId else null
    )
    playlist.syncedTo = newSyncedTo.takeIf { it.isNotEmpty() }
    playlist.hasUpdates = false
    playlist.locallyModified = false
}
```

Why both platforms need it: when one client has the bug and the other doesn't, the buggy one's writes propagate corruption to the healthy one via the shared remotes. With the heal on both sides, whichever client launches next undoes the damage. No-op on healthy data.

**Apple Music catalog API IS rate-limited — throttle parallel calls.** `api.music.apple.com/v1/catalog/{storefront}/...` (search, songs/{id}, albums/{id}) has an aggressive edge throttle. The throttle is per-token/IP and leaks across endpoints: once a flood of `/search` calls trips it, subsequent `play()` calls (which read `/songs/{id}` internally) also fail with `MusicDataRequest.Error 1`. Symptoms: 429s on search, mysterious "data request failed" on play, JS-fallback path skipped because of a sticky kill-switch.

Desktop fix: `nativeMusicKitLimiter` in app.js (concurrency 3, ≥150ms gap, 8s cooldown after 3 consecutive throttle errors). All catalog calls go through it.

Android equivalent: any place that fans out per-track catalog calls (background source enrichment, library import resolution, etc.) MUST throttle. The trigger threshold isn't documented by Apple, but real-world data: 200+ parallel calls trips it instantly; 50 sustained does too over a few seconds. Sane defaults: concurrency 3-5, ≥100-200ms gap between starts, exponential backoff with circuit breaker on `429`/`MusicKit.MusicDataRequest.Error 1`/`MusicDataRequest`/timeout strings.

The corollary: **don't make the JS-fallback or auth-failed kill-switch session-permanent.** Time-bound it (5-minute cooldown is what desktop uses now via `_appleMusicWebAuthFailedAt`). One transient catalog throttle should not permanently disable Apple Music for the rest of the session.

**ListenBrainz Android parity**

- Same JSPF + recording-MBID semantics. Recording MBID is mandatory for every pushed track; mapper fallback with 0.7 confidence floor.
- Same default-private (`public: false` on create only, never override on update).
- Token from scrobbler-side store, NOT a meta-service store.
- Same clear-then-add update path (no full-replace PUT exists).
- Snapshot anchor is `extension.last_modified_at || playlist.date` (NOT the other way around — `playlist.date` is creation-only).
- Cross-service collaboration: collaborators-extension list enables write-back; Android should also refine its push-loop guards (syncedFrom + id-prefix) to allow push-back-to-source when the user has genuine local edits (`locallyModified && lastModified > syncSources[source].syncedAt`).
- Achordion playlist-links push from Android: same endpoint, same bearer, same payload shape. Submits the LB MBID as the cross-platform anchor.
- Shared-playlist badge: when fetched playlist has `isCollaborator: true`, surface a "SHARED" affordance in the UI.


### Android Parity Requirements (artist credit matching)

`scoreConfidence` and `selectBestMatch` must apply the same artist and title rules as desktop's `validateResolvedTrack`, described under "Match Confidence + Selection Floor" in [playback.md](playback.md). Every row of `ARTIST_CREDIT_VECTORS` in `tests/helpers/artist-credit-vectors.js` must return the same score, in both directions. If mobile drifts, one client plays a source the other refuses for the same track, and the sync hydration paths mint an id on one client that the other won't.

### Android Parity Requirements (recommendations provider capability)

Desktop's Recommendations page is provider-driven (parachord#1309-era rework): every plugin with `capabilities.recommendations` answers `getRecommendations(config)` with sections of typed items, and may implement `expandRecommendationSection(sectionId, afterCursor, config)` for pagination. The contract is documented under "Recommendations" in [plugins.md](plugins.md); the pure merge model (five type sections; each section one blended row of every provider's picks of its type (untitled and titled sections alike, titles not shown), interleaved round-robin across providers, with Shuffleupagus last in each round and feeding Albums and Artists only; Listeners (type `friend`) is one row of similar users, each service sorted by its own similarity, highest first, then the services alternating (their scores are on different scales), from providers whose id is a friend service (`friendServices`: the plug-ins with `capabilities.friends`, today `lastfm` and `listenbrainz`, #1539 step 5); a duplicate kept by the first provider with every source recorded in `sourceIds`, keyed per type, a weekly playlist by its own id; a page-wide single-source filter over `sourceIds`; blocklist applied at merge) is desktop's `src/renderer/lib/recommendation-model.js`. If the Android client builds a recommendations surface over the same plugins, the shapes must agree:

- `getRecommendations(config)` → `{ sections: [{ id?: string, title?: string, description?: string, nextCursor?: string (a section whose first page was pre-fetched — the page's load-more starts from that cursor), items: [{ type: 'artist'|'album'|'song'|'playlist', id?: string, name: string, artist?: string, duration?: number (seconds), imageUrl?: string, url?: string, reason?: string, mbid?: string, isrc?: string (copied onto a song item's track), releaseDate?: string (albums; the "Coming" badge uses it before any MusicBrainz lookup) }] }] }`. A miss is `{ sections: [] }`, never a throw; a readiness failure (signed out, offline) THROWS so a miss is never cached as one.
- `expandRecommendationSection(sectionId, afterCursor, config)` → `{ items: [...], nextCursor: string | null }`; absent means the provider does not paginate.
- Every section's items, titled or not, feed the per-type blended rows; a provider's section titles are not shown. A playlist item may carry `weekly`, and the ListenBrainz sections `weekly-exploration` / `weekly-jams` lead the Playlists section.
- `getSimilarUsers(config)` → `[{ username, similarity, avatarUrl?, topArtists? }]` (capability `similarUsers`; `topArtists` is up to 3 recent artist names for the card: ListenBrainz `stats/user/{name}/artists` this month else last month, for the 20 most similar, people with neither dropped as inactive and the rest dropped unchecked; Last.fm `user.gettopartists` 1month, nobody there dropped as inactive; a failed check keeps the person), the Listeners section's source: ListenBrainz uses its similar-users API, Last.fm computes it from friends of friends: the top 40 by mutual-friend count, scored by a binary cosine over the 6-month top-50 artist-name sets, kept at 0.06 and over (see "Similar users" in [plugins.md](plugins.md)); cached for 7 days under `similarUsers` in the recommendations cache, a successful empty answer included (failures throw and cache nothing). `Last.fm` and `ListenBrainz` implement the capability (their fetches moved out of desktop's app.js into the plugins — a mobile client that still hardcodes those fetches duplicates provider logic the plugin now owns).

What breaks if a client drifts: a mobile-built recommendations surface that invents its own item fields silently drops plugin items (an unknown `type` or a nameless item is discarded by desktop's normalizer), and a provider that answers a different miss policy gets its misses cached as permanent emptiness.

### Android Parity Requirements (protocol play handlers)

This section is for the Android client. Every rule was learned from a real bug; skipping any one breaks the corresponding command. The desktop equivalent is in `app.js`'s protocol switch and the `activateSpinoffFromPool` / `parseProtocolTracklist` / `resolveProtocolPlayInput` helpers — cross-reference if anything below is unclear.

**Path-style URI convention is load-bearing.** Use `parachord://play/album`, `parachord://play/playlist`, `parachord://play/radio` — slash, not hyphen. `listen-along` stays hyphenated because it's a single feature noun, not a verb/object split. The existing protocol surface (`control/pause`, `queue/add`, `artist/<name>`, `album/<name>`, `settings/<tab>`, etc.) is path-style; matching that means publishers can predict the shape from the rest of the surface.

**Input shape priority** (when multiple are present): `mbid` → `spotify` → `applemusic` → `url` → `tracks` → `artist`+`title`. Per-command gates: `play/album` allows all six; `play/playlist` allows only `url`/`tracks`; `play/radio` Mode B is `artist`[+`title`], Mode C is `url`/`tracks`[+`refill`].

**Per-track tagging is mandatory before a track reaches `handlePlay` equivalent.** Every track in a play queue/pool MUST carry these three fields, or playback breaks in subtle ways:

| Field | Why |
|---|---|
| `id` (stable string) | The background resolver's flushToQueue/scheduler equivalents look up tracks by id; refilled tracks need stable ids too. Convention: `protocol-radio-${timestamp}-${index}`. |
| `sources: {}` (empty object, not `undefined`/`null`) | Resolver mutates `track.sources[resolverId]` and the queue UI calls `Object.keys(track.sources)` — throws on undefined. Tracks parsed from JSPF/JSON arrive without this field. |
| `_playbackContext: { type: 'spinoff'/'play/album'/etc, name, ... }` | `handlePlay`'s "should I exit spinoff?" guard reads `track._playbackContext.type` — without the tag, the very first play torpedoes spinoff/listen-along mode and restores `playbackContext` to whatever was before (often null after a `clearQueue`). Net effect: empty queue, no banner, dead next button. |

Refilled tracks (when LB radio returns a fresh batch mid-session) need the same three fields. Inherit `_playbackContext` from the existing pool's first track so it stays consistent.

**Pre-resolve the first track via the standard resolver pipeline before handing to `handlePlay`.** Don't rely on `handlePlay`'s on-demand fallback resolution — for unresolvable tracks (obscure live cuts, remixes not on user's enabled providers) that path surfaces a "No Source Found" dialog before any background resolution can complete.

- `play/album` / `play/playlist`: await resolution of the FIRST track only, then fire-and-forget the rest. If the first track has no sources after pre-resolve, show "Nothing to play."
- `play/radio`: walk through the pool, await resolution of each candidate, skip if unresolvable. Cap at 20 attempts so a fully-unresolvable pool can't loop. Do this BEFORE clearing the queue: a pool with nothing playable leaves the queue and current playback alone (desktop #1319, matching mobile's rule). After finding a playable first track, **also await resolution of the next 2 lookahead tracks** before calling handlePlay; fire-and-forget resolution for the remainder. Without the lookahead, on heavy-CPU systems track 2's resolution may not finish before track 1 ends — handlePlay then falls into the on-demand resolution path which races against the previous track's teardown and produces a "skip after a couple of seconds" symptom. The bounded ~1s of extra latency before the first track plays is the right tradeoff for deterministic auto-advance.

**State-machine teardown order matters.** When firing a play protocol command:

1. Explicitly tear down active spinoff/listen-along (call `exitSpinoff` / `deactivateListenAlong` directly).
2. Call `clearQueue` (resets shuffle state, makes prior background resolution writes harmless because they look up by track-id against an empty queue).
3. Set the new queue + playback context.
4. Pre-resolve the first track.
5. Call `handlePlay`.

If you skip step 1, `handlePlay`'s internal exitSpinoff/listen-along cleanup runs AFTER your `setPlaybackContext`, restoring the prior context and overriding your new one. If you skip step 2, the prior queue's in-flight background resolution keeps competing with your new resolve calls for Apple Music throttle / MusicBrainz rate-limit budget.

**Apply the teardown to ALL commands that start playback**, not just the album/playlist/radio sub-actions. Concrete list of protocol commands that must do steps 1-2 before kicking off:

- `parachord://play?artist=&title=` (single-track default)
- `parachord://play/album`
- `parachord://play/playlist`
- `parachord://play/radio` (both Mode B and Mode C)
- `parachord://listen-along` is the exception: it ends a spinoff but keeps the queue, like an in-app start (#1343; mobile since parachord-mobile#652). The friend's tracks play out of the repeat-all lap and the queue plays on when the session ends (#1319). It doesn't tear down a current listen-along either: switching from friend A to friend B swaps, not terminates. It puts no loading placeholder in the playbar, since it checks first that the friend is listening.

Commands that do NOT clear the queue (intentionally): `queue/add` (additive), `control/*` (just transport), `shuffle/*`, `volume/*`, navigation cases (`artist/`, `album/`, `library`, etc. — these only navigate, they don't auto-play), `import` (writes to library, doesn't change current playback), `chat` (sends to AI). `collection-radio` delegates to the in-app starter, which is responsible for its own state hygiene — match the in-app behavior, don't add a separate clearQueue at the protocol layer.

**JSPF + LB lb-radio wrapper.** ListenBrainz wraps the JSPF response in `{ payload: { feedback, jspf: { playlist: { track: [...] } } } }`. Unwrap to the bare JSPF shape (`parsed.payload?.jspf || parsed`) before checking `playlist.track`. Failure mode if you don't: HTTP 200 + 0 tracks parsed → "no playable tracks for radio" toast.

JSPF track fields:
- `creator` (or `artist`) — required. Treat as artist. Accept array forms (some producers emit arrays); join with `", "`.
- `title` — required.
- `album` — optional.
- `identifier` — optional, single string or array. Match `musicbrainz.org/(recording|track)/<36-char-uuid>` URL form OR a bare 36-char UUID. Reject malformed (e.g. `abc-123` is NOT a valid MBID even though pre-fix code accepted it).

LB also embeds artist MBIDs in `track.extension['https://musicbrainz.org/doc/jspf#track'].artist_identifiers`. The desktop parser doesn't read those today (track recording MBID is what we need for resolution); Android can match the desktop's behavior or extend if useful.

Generic JSON shape: `{ title?, tracks: [{artist, title, album?, mbid?, isrc?}] }`. Same MBID UUID validation; trim whitespace; reject empty fields.

**Inline tracks: 100KB encoded cap, 500 tracks max** — same caps as `import` (existing constraint).

**Inline base64 tracks must be decoded as UTF-8.** The naive pattern `JSON.parse(atob(payload))` (and its Kotlin equivalent `JSON.parse(Base64.decode(payload).toString())` or `String(Base64.decode(payload))` without specifying a charset) treats the decoded bytes as Latin-1 / platform default — which silently mangles any UTF-8 multi-byte character: U+2019 right single quote (`'`) becomes `â€™`, em dashes become `â€"`, non-Latin scripts (Cyrillic, CJK, Arabic, etc.) become unreadable. Visible to the user as garbled track titles.

**Correct decode (round-trip bytes through UTF-8):**

```js
// Web/Electron — desktop's window.decodeBase64Utf8Json
const binary = atob(b64);
const bytes = new Uint8Array(binary.length);
for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
const text = new TextDecoder('utf-8').decode(bytes);
const decoded = JSON.parse(text);
```

```kotlin
// Android equivalent
val bytes = android.util.Base64.decode(payload, android.util.Base64.DEFAULT)
val text = String(bytes, Charsets.UTF_8)
val decoded = JSONObject(text)  // or your JSON parser of choice
```

The same fix must be applied at every base64-decode call site that processes user-supplied JSON — both `parachord://import` and `parachord://play/album|playlist|radio` (the latter via the shared input resolver). Don't deduplicate naively across sites by reusing one helper without auditing its charset behavior.

**SSRF guard at every URL fetch site.** Reject:

- Non-HTTP(S) schemes
- Hosts: `localhost` / `localhost.` / any `*.local` / `*.local.` (case-insensitive)
- IPv4: `0.0.0.0/8`, `127.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10` (CGNAT / Tailscale), `169.254.0.0/16` (link-local + cloud metadata IP `169.254.169.254`), `172.16.0.0/12`, `192.168.0.0/16`. Boundary cases `172.15.x.x` and `172.32.x.x` ARE public.
- IPv6: bracketed `[::1]`, `[::]`, `[fe80::*]/10`, `[fc00::*]/7` (ULA), `[::ffff:*]/96` (IPv4-mapped). The URL parser canonicalizes decimal-int (`http://2130706433`) and octal (`http://0177.0.0.1`) forms to dotted-quad before the regex sees them — rely on that, don't try to canonicalize manually.

Apply on every fetch — initial AND refills (a publisher could supply a public initial URL that 302s elsewhere). Use the platform's "redirect: error" / `redirect: manual` equivalent so 3xx-to-private redirects also fail. **Does NOT defend against DNS rebinding** (a public hostname resolving to a private IP is accepted) — document this as a known limitation, don't try to fix in the guard.

**ListenBrainz auth token auto-attach.** As of mid-2026 the lb-radio endpoint requires `Authorization: Token <user_token>`. When the URL host is `api.listenbrainz.org`, auto-attach the user's already-configured LB token. **The token lives in the scrobbler plugin's config**, NOT in the basic "meta service" config:

- Desktop reads it from `window.listenbrainzScrobbler.getConfig().userToken`.
- Android equivalent: whatever store the LB scrobbler plugin writes its token into. The same store the user pasted their token into when they connected for scrobbling — there's typically a separate "meta service config" with just the username, but no token. Use the scrobbler-side store.

If the user has no LB token configured, fall through with no auth header. The fetch will 401 and surface as "Radio failed: Fetch failed: 401" via the standard error path.

**play/radio refill semantics.**

- Trigger: pool < 3 tracks remaining.
- Soft rate-limit: minimum 5 seconds between refill fetches.
- Stop condition: 3 consecutive empty refills (counter resets when fresh tracks arrive). On HTTP error, increment empty counter too.
- Dedup against existing pool by `mbid` → `isrc` → `(artist|title)` lowercase. If all refilled tracks dedupe to existing entries, count as empty.
- Reset all refill state in `exitSpinoff` equivalent: refillUrl ref, empty counter, last-fetch timestamp.

**`play/radio` Mode B vs Mode C dispatch.**

- Mode B: `?artist=` (with no `tracks` and no `url`). Seeds Parachord's existing in-app similar-tracks endpoint — same path as right-click → Spinoff in the UI. Ignore `?refill=` for Mode B.
- Mode C: `?url=` and/or `?tracks=` present. Externally-curated pool. `?refill=` overrides `?url=` for refill source; if neither, refill is disabled (static pool, ends when exhausted).

**`?name=` for play/radio Mode C** is the publisher's canonical station name. Display priority: `params.name || params.title || parser's r.displayName || "Radio"`. Used in the toast and the "Playing" banner.

**Pool-based spinoff banner rendering.** A pool-based spinoff has no source track (no specific song to "spin off from"), so its `sourceTrack.artist` is empty. The banner UI should branch on this: if `playbackContext.type === 'spinoff'` AND `!playbackContext.sourceTrack?.artist`, render just the station name (`sourceTrack.title`). Otherwise render the seed-mode "spun off from \"X\" by Y" template.

**listen-along transient friend.** If the target user isn't in the local friends list, construct a transient friend record by fetching their now-playing:

- ListenBrainz: `GET /1/user/{name}/playing-now` (auth required as of mid-2026 with `Authorization: Token <user_token>`). Read `payload.listens[0].track_metadata`.
- Last.fm: `user.getrecenttracks?limit=1` (no auth, just API key). Track is "now playing" only when `@attr.nowplaying === "true"` on the response track object.

If neither service returns a current track, surface "<user> is not currently listening on <service>." Don't error — a user simply not playing is the most common case and the UX should be calm.

**The friend record needed by activateListenAlong:**

```
{
  id: "transient:listenbrainz:foo",
  service: "listenbrainz" | "lastfm",
  username: "...",
  displayName: "...",
  cachedRecentTrack: { name, artist, album, timestamp },
  transient: true,  // distinguishes from saved friends
}
```

`cachedRecentTrack` is required (the activate function asserts it). Synthesize from the now-playing fetch: `{ name: track_name, artist: artist_name, album: release_name, timestamp: Date.now() }`.

### Android Parity Requirements (plugin minimum app version)

Android and iOS download plugins from the same marketplace as desktop, so they honor the same floor. A plugin manifest (and its `manifest.json` catalog entry in parachord-plugins) may carry `"minAppVersion": { "desktop": "x.y.z", "android": "x.y.z", "ios": "x.y.z" }`. Each client reads only its own platform key. The rules, from `main-process/plugin-compat.js` (see "Minimum app version" in [plugins.md](plugins.md)):

- No field, or no entry for the platform, means no floor. A value that isn't plain `x.y.z` is no floor.
- Compare numerically per part (`0.10.0` > `0.9.12`); the app's own pre-release or build suffix is dropped before comparing. An app that can't report its version is not refused.
- An app below the floor doesn't download the update (check the catalog entry first, then the downloaded `.axe` before saving it), skips a cached copy below the floor at load, and refuses a manual install with a "needs Parachord X or later" message. The copy bundled with the app is never checked.

What breaks if a client drifts: a plugin built for a newer host (desktop's native Amazon player in parachord#1158 is the first) downloads onto an app that lacks the host feature, and that plugin stops working there until the user updates the app.

### Android Parity Requirements (playlist link import)

**Mobile imports a playlist from every link desktop does.** Desktop's list is not written anywhere in its import code: `handleImportPlaylistFromUrl` asks the plugin registry (`findResolverForUrl`, then `getUrlType(url) === 'playlist'`, then `lookupPlaylist`), and only a URL no plugin claims is fetched as a hosted XSPF. A claimed URL that fails throws, naming the service; it is never parsed as XSPF. Today that is Spotify, Apple Music, Amazon Music, SoundCloud sets, YouTube and YouTube Music playlists, ListenBrainz playlists, and hosted XSPF.

Rules:
- Every way in imports the same links: on desktop, dropping a link, the import dialog and `parachord://import?url=`; on Android, the import dialog, `parachord://import` and the share sheet.
- Mobile routes import the same way, through its registry (`PluginManager.lookupPlaylist`, as `ProviderPlaylistResolver` already does for `play/playlist`), with native fast paths allowed in front. Then a new `.axe` adds the link type on both clients with no code, and only a new native path needs a mobile change.
- A desktop change that adds or removes an import link type outside the registry (a native path, a new document format, a change to the hosted XSPF fallback) needs a mobile ticket.
- A plugin whose `lookupPlaylist` needs a desktop-only host (Amazon's drives the ONE host web-session instance through the `window.electron.webSession` bridge — the main-process `window.electron.amazonMusic` bridge died with the #1356 M11 teardown) needs an Android host or native client for that call; until then mobile reports the service as unavailable rather than fetching its page.
- The imported record keeps desktop's shape: `sourceUrl` = the link, `source` = `${resolverId}-import` or `hosted-xspf`, the plugin's playlist image as the cover, and `autoUpdate` once mobile asks the keep-updated question.

The rule covers iOS as well as Android (both are in parachord-mobile). Mobile tickets: Parachord/parachord-mobile#690 (every link type, Android), Parachord/parachord-mobile#689 (kept updated or a snapshot, Android), Parachord/parachord-mobile#691 (iOS: both, plus confirming `parachord://import`, which iOS ran without asking as of 2026-11-15). Both give service imports a `sourceUrl`, so mobile's hosted poller (`getHosted` is `WHERE sourceUrl IS NOT NULL`) has to skip `-import` sources in the same change.

### Android Parity Requirements (playlist sync links)

From a parity check of how each client keeps a playlist's links to its services (2026-11-15, against #1418, #1419, #1420 and #1424; ticket Parachord/parachord-mobile#693). Android keeps links in their own tables (`sync_playlist_source` for `syncedFrom`, `sync_playlist_link` for `syncedTo`). **iOS is the same:** it builds the same `commonMain` `SyncEngine` with the same providers and tables, and its own playlist edits set `locallyModified` like Android's, so everything below holds for both and one mobile fix covers both.

At parity:
- The same three services sync playlists: Spotify, Apple Music, ListenBrainz.
- A save never erases a live link (#1418): structural on Android, since no playlist save touches the link tables.
- An import missing from the service's list keeps its link: Android acts only on a confirmed 404 (`confirmedGoneMirrors`), and a deleted Spotify playlist is only unfollowed, so it doesn't 404.
- Duplicate collection rows (#1419) can't happen on Android (`tracks.id` is the primary key, written with `INSERT OR REPLACE`).
- A changed import is pulled with no prompt on both.
- A push back to the source records the source's new snapshot where the next sync compares (the playlist row's `snapshotId` for Spotify, `sync_playlist_link.snapshotId` otherwise), so mobile never had #1424's false conflict.

Not at parity (Parachord/parachord-mobile#693):
- **A confirmed-gone source deletes the local playlist on Android** when it was the playlist's last source (`playlistDao.delete` in both removal passes of `SyncEngine.kt`). Desktop never deletes a local playlist because its remote went away: an import keeps the playlist and its link (`missing-sources.js`), and a deleted mirror is flagged for the person to decide (#1269).
- **Android can forget an edit and pull over it.** An edit to a playlist whose source refuses the push (a followed Spotify playlist) keeps `locallyModified` only until `clearLocallyModifiedFlags` runs at the end of the cycle, which clears it for a playlist with no other mirrors. The next remote change then pulls over the edit. Desktop's fix for the same failure is the tracks fingerprint (`sync-engine/auto-pull.js`).
- Conflicts: Android uses last write wins, desktop asks. A product decision; the ticket lays out both.
- Covers: Android keeps its generated mosaic over the service's cover and takes Spotify's generated mosaic as a cover; desktop does the reverse (Parachord/parachord-mobile#676).


### Android Parity Requirements (plugin host bridges)

Desktop implemented #1355's per-platform loading rule: a plugin manifest may declare `"requires": { "hostBridges": ["webSession"] }` (a top-level `.axe` field), each host advertises what it supplies — desktop's `preload.js` sets `window.__parachordHostBridges` (today `['webSession']`) — and the plugin loader **hides** a plugin whose required bridges are not all supplied. From #1355's text: "This fits the existing plugin-compat check (`main-process/plugin-compat.js`, ported to mobile as `PluginCompat.kt`). Mobile would implement the same rule in `shared/.../plugin/PluginCompat.kt` and the same bootstrap globals in both apps' JS runtimes."

Mobile must mirror three things:

- The rule in `PluginCompat.kt`, beside `minAppVersion`: `pluginRequiredHostBridges(axe)` (absent or malformed is no requirement — an array of non-empty strings under `requires.hostBridges` only) and `hostBridgesCompatibility(axe, supplied)` → `{ ok, missing }` — hide the plugin when any required bridge is missing. Never load it to fail later: mobile's resolver retry (#566) would keep re-asking a plugin that throws not-ready on every resolve.
- The same bootstrap global, `window.__parachordHostBridges`, set by the mobile JS runtime before the plugin loader runs, carrying only the bridges that host actually supplies (mobile's list will differ from desktop's — that is the point).
- The `.axe` shape is shared marketplace data: `requires` is a top-level key (sibling of `capabilities`/`settings`), not inside `manifest`.

What breaks if a client drifts: a plugin that needs a bridge the host doesn't supply loads and throws not-ready on every resolve (and mobile's retry re-asks it forever), or — the other direction — a host that advertises a bridge it doesn't really supply has plugins that load and fail at the call site.

### Android Parity Requirements (Collection: local and saved merged)

Desktop #1534 (parachord#1532). Mobile ticket: [Parachord/parachord-mobile#713](https://github.com/Parachord/parachord-mobile/issues/713). Reference module: `src/renderer/lib/local-albums.js`; how desktop shows it: "In the Collection" in [local-files.md](local-files.md).

**The rule.** The Collection's Songs, Albums and Artists list the local library merged with what the user saved, deduplicated: one entry per song, album and artist, every track with every source (the file and every service it resolves on). Showing is not saving: an item that is there only because of local files is never written to the saved collection, never shows as loved, hearted, starred or followed, and is never pushed by library sync or the love push and backfill. Only the user's own heart, save or follow makes it saved; undoing that leaves it listed, unsaved.

**Identity rules.**
- Same song: the same artist and title through `normalizeStr` (case, accents, spaces and punctuation dropped), and compatible albums (the same album without a store's " - Single" / " - EP" suffix, or a placeholder album on either side). The merged row keeps the saved record's id, love state and sync sources, and adds the file's source and path.
- Same album: the same album artist (else track artist) and title, folded the same way, store suffix dropped; "X" and "X - EP" are one album, and saved copies of one album are one card too (display only). Saving an album already saved under another copy is a duplicate that writes nothing. Albums with no title or a placeholder one ("Unknown Album", "Single", a service's name) are left off; their tracks stay on Songs. Desktop ids: `generateAlbumId` (`sync-engine/collection-id.js`).
- Same artist: the album artist, else the track artist ("Various Artists" and "Unknown Artist" skipped), folded; desktop id `generateArtistId`.

**Hidden local albums.** Removing a local-only album hides it and touches nothing else (no saved-collection write, no tombstone, no service call; the files and the library stay). Store key `collection_hidden_local_albums`, a JSON array of album keys `"<artist>:<title>"`, each side folded through `normalizeStr` with the store suffix dropped (for example `"radiohead:inrainbows"`). Adding the album to the Collection clears its key.

**What breaks if a client drifts.** A client that saves local items to the collection, or counts them as loves or follows, pushes them to the user's shared services: every scanned file becomes a love on ListenBrainz or Last.fm, every local artist a follow on Spotify, and the other clients import them back as saved. That is the #705 failure on mobile. A client that doesn't deduplicate shows a song or album twice, and removing one copy leaves the other.
