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
        // Push updates; on 404 mark pendingAction = "remote-deleted".
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

**Sync wizard / playlist-picker pre-check state**, if Android has one: seed the "checked" set from the union of saved `selectedPlaylistIds`, externalIds where any local has `syncedFrom.resolver == providerId`, and externalIds where any local has `syncedTo[providerId].externalId`. Don't seed only from the last-saved list — push-only mirrors that were never selected in the wizard will appear unchecked even though they're actively syncing.

**Playlist data-model fields to preserve on every save:**

```
id, title, description, tracks,
syncedFrom, syncedTo, syncSources,
hasUpdates, locallyModified, lastModified,
localOnly, sourceUrl, source, creator,
createdAt, addedAt
```

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
- `play/radio`: walk through the pool, await resolution of each candidate, skip if unresolvable. Cap at 20 attempts so a fully-unresolvable pool can't loop. After finding a playable first track, **also await resolution of the next 2 lookahead tracks** before calling handlePlay; fire-and-forget resolution for the remainder. Without the lookahead, on heavy-CPU systems track 2's resolution may not finish before track 1 ends — handlePlay then falls into the on-demand resolution path which races against the previous track's teardown and produces a "skip after a couple of seconds" symptom. The bounded ~1s of extra latency before the first track plays is the right tradeoff for deterministic auto-advance.

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
- `parachord://listen-along` (tear down spinoff + clearQueue, but DON'T tear down listen-along — switching from friend A to friend B should swap, not terminate)

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
