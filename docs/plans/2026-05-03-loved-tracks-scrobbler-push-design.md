# Loved Tracks → ListenBrainz / Last.fm Sync Design

## Overview

When the user adds a track to their Parachord collection (Parachord's "love" action — `addTrackToCollection`, app.js L13339), optionally push that as a love to ListenBrainz and/or Last.fm. Plus a one-time **backfill** action that pushes every existing collection track at user request.

Goal: lossless cross-service love history without forcing every Parachord user to publish their loves to scrobbler services they may use independently.

## Policy decisions

1. **Opt-in, per-service.** Default off for both services. User explicitly enables via a setting in each scrobbler's connected-state card.
2. **Two separate controls per service.**
   - **Toggle**: "Push newly loved tracks to <service>" — gates live `addTrackToCollection` push.
   - **Button**: "Backfill loved tracks → <service>" — one-shot, walks the existing collection.
   The toggle and button are independent. User can:
   - Just enable the toggle (only future loves go to the service).
   - Just click backfill (one-time push of past loves, never again).
   - Both.
   - Neither (default).
3. **One-way only — no remote unlove on collection removal.** Removing a track from the Parachord collection does NOT send `track.unlove` (LFM) or `score=0` (LB). Rationale: users may have independent love history on those services that we shouldn't mutate; loving on Parachord is additive.
4. **Remote love-date is "now" — not the original `addedAt`.** Neither LB's `/1/feedback/recording-feedback` nor LFM's `track.love` accept a backdate. Backfilled loves appear on the remote as "loved at the time of the backfill click." The local `addedAt` field stays untouched. Documented in the toast on backfill completion.
5. **Libre.fm out of scope.** No equivalent love endpoint we'd hit; toggle and button hidden for Libre.fm specifically.

## API surface

**Last.fm** — `track.love` POST with `artist` + `track` + signed by API secret. Optional `mbid`. Already has the auth + signing infrastructure (existing `apiRequest` helper in `scrobblers/lastfm-scrobbler.js`).

**ListenBrainz** — `POST /1/feedback/recording-feedback` with body `{ recording_mbid, score: 1 }` and `Authorization: Token <userToken>`. Requires an MBID (no fallback to artist+title strings). Resolution path:

1. Use `track.mbid` if cached on the collection track (often is — gets populated during playback via the MBID Mapper).
2. If absent, hit the [MBID Mapper](https://mapper.listenbrainz.org/mapping/lookup) (~4ms typical, no rate limit, already integrated in Parachord per CLAUDE.md "MBID Mapper Integration").
3. If mapper returns `confidence < 0.7` or no result, **skip** the LB push for that track. Log once. The track stays loved locally and is still pushed to LFM (which doesn't need the MBID).

## Persistence

| Key | Shape | Purpose |
|---|---|---|
| `scrobbler_love_push_enabled` | `{ lastfm?: boolean, listenbrainz?: boolean }` | Toggle state per service. |
| `love_pushed_keys` | `{ [trackId]: { lastfm?: timestamp, listenbrainz?: timestamp } }` | Idempotency cache. Populated as each push completes. Read by both live push and backfill so re-clicking backfill doesn't re-push. |

No separate "have we run a backfill" flag — the `love_pushed_keys` cache provides natural idempotency.

## Triggers

| Event | Behavior |
|---|---|
| Toggle ON | Persist `true`. No automatic backfill. |
| Toggle OFF | Persist `false`. Live pushes stop. Already-pushed loves stay loved on the remote (no auto-unlove). |
| `addTrackToCollection(track)` | For each service where toggle is ON, fire-and-forget `loveTrack(track)`. On success, write `love_pushed_keys[trackId][service] = timestamp`. Failures log + retry on next love (no exponential backoff). |
| `removeTrackFromCollection(track)` | No-op for love-push. (Per option B above.) |
| Backfill button click | Walk `collectionData.tracks`, filter to entries NOT yet in `love_pushed_keys[trackId][service]`, push sequentially with 1 req/sec spacing. Show progress in button label. Toast on completion: `Backfilled N loves to <service>` or `Already up to date`. |

**Concurrency guard**: while a backfill is running for a service, the button is disabled. A second click during a run is a no-op.

**Resume on crash**: idempotency cache is written after each successful push (not at the end), so an interrupted backfill resumes naturally on the next click.

## Implementation map

All work in:

- `scrobblers/lastfm-scrobbler.js` — add `loveTrack(track)` method. ~15 lines.
- `scrobblers/listenbrainz-scrobbler.js` — add `loveTrack(track)` method with MBID mapper fallback. ~30 lines.
- `app.js`:
  - New state + refs: `scrobblerLovePushEnabled` (state), `lovePushedKeysRef` (ref).
  - Bulk-load both at startup alongside other electron-store keys.
  - Hook into `addTrackToCollection` (~L13420ish, after the existing Spotify/AM sync block) — fire-and-forget `loveTrack` for each enabled service.
  - Scrobbler card UI (~L2643): when connected and id is `lastfm`/`listenbrainz`, render the toggle and the backfill button above the Disconnect button.
  - `runBackfill(service)` async function — walks collection, calls scrobbler's `loveTrack`, persists checkpoints.
- `CLAUDE.md` — new subsection in the Scrobbling area documenting the design (especially the date-stamped-at-push remote caveat and the no-unlove decision).

## Failure modes

| Scenario | Behavior |
|---|---|
| Scrobbler not connected (no token/sk) | UI shows "Connect first" — toggle/button hidden. |
| LB rate-limit hit during backfill | Backfill pauses 5s and retries. Cap at 3 retries per track; after that, skip and continue. Toast on completion includes failure count. |
| LFM API key not configured | Same as not-connected — toggle/button hidden. |
| MBID mapper times out | Skip LB push for that track, continue. |
| `track.mbid` is malformed | Reject (must be 36-char UUID). Skip. |
| User toggles backfill OFF mid-run | Backfill completes the in-flight track, then stops. (No mid-track abort.) |

## Out of scope

- Periodic re-sync (loves added on LB website don't auto-pull into Parachord — that's LB→Parachord direction, opposite of what this is).
- Automatic backfill on launch (intentionally manual, per "two separate settings" decision).
- Libre.fm love endpoint (doesn't exist).
- Unsync on collection removal.
- Backdate love submissions (remote services don't support).
