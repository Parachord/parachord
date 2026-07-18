# Bandcamp Subsonic Resolver — Design

**Date:** 2026-07-18
**Status:** Design approved, pending implementation
**Related:** Bandcamp announcement — [Discover improvements and Subsonic implementation](https://blog.bandcamp.com/2026/07/16/discover-improvements-and-subsonic-implementation/)

## Summary

Bandcamp shipped an open-beta **Subsonic API** at `https://bandcamp.com/api/subsonic`
that lets a fan stream, download, and manage playlists for the music they've
**purchased**. It is a *collection-streaming* API, not a catalog-search API.

Today Parachord's `bandcamp.axe` resolver:

- **searches** by scraping `bandcamp.com/search` HTML + the fuzzysearch autocomplete
  endpoint (fragile — breaks on markup changes), and
- **plays** by calling `shell.openExternal(bandcampUrl)` — it kicks the user out to a
  browser and never streams in-app.

The Subsonic API doesn't replace catalog matching (it can't resolve tracks the user
doesn't own), but it fixes a real, separate weakness: **owned Bandcamp music can finally
play in-app**, and the user's purchased collection becomes a browsable library source.

This design is **additive**. The scrape resolver stays for catalog matching; we layer a
Subsonic-backed owned-collection index on top for in-app streaming + a library view.

## Goals (v1)

1. **Resolver enrichment (primary):** when any track Parachord handles (synced playlist
   entry, search match, etc.) is present in the user's owned Bandcamp collection, resolve
   it to a **streamable in-app source** instead of an external-open link.
2. **Bandcamp Collection library:** a browse surface (like the local-files library) over
   the owned collection — albums/tracks, cover art, click-to-stream.

## Non-goals (v1)

- Catalog-wide Subsonic browse/search (the API is collection-only by design).
- Playlist read/write / Bandcamp as a **sync target** (`getPlaylists`/`createPlaylist`
  exist but wiring Bandcamp into the multi-provider sync engine is a separate effort).
- Retiring the scrape resolver (it still handles non-owned catalog matches).
- ISRC-based matching (Subsonic doesn't expose ISRC; matching stays name-based).

## Architecture — `.axe` vs. host boundary

The entire **Subsonic client is pure, portable logic** and lives in `plugins/bandcamp.axe`,
loaded identically by desktop and mobile from the `parachord-plugins` repo. One
implementation, both platforms.

In the `.axe`:

- token+salt auth (`t = md5(password + salt)`) and request-param assembly
  (`u`/`t`/`s`/`v`/`c`/`f`)
- `ping`, `getAlbumList2`, `getAlbum`, `search3`, `getCoverArt`, `stream`
- response parsing → in-memory owned-collection index
- artist+title → owned-id matching (reusing `normalizeStr` + `validateResolvedTrack`)
- stream-URL construction

An `.axe` is stringified functions — it **cannot** own a persistent SQLite index or add
new main-process IPC. It gets state two ways only, both already part of the resolver
contract on both platforms:

1. **`config`** — the resolver's persisted settings, passed into
   `search`/`resolve`/`play`. The Bandcamp Subsonic **username + generated password ride
   here**, exactly like AI plugins carry `apiKey`/`endpoint`. No new main.js code.
2. **`window.electron?.proxyFetch`** (desktop CORS bypass) with a feature-detect →
   plain `fetch` fallback on mobile.

Consequently "pre-index locally" is realized as an **in-memory index built at `init()`**
(one paged `getAlbumList2` sweep), held for the session and optionally cached via the
host key-value store. Tradeoff vs. a SQLite DB: a paged sweep at launch/connect instead
of a persistent database — the only shape that keeps this a single cross-platform `.axe`.

## Data flow

### A. Connect (one-time)

Bandcamp resolver settings card gains a Subsonic section: **username** + **generated
password** fields and a **Connect** button (mirrors the ListenBrainz token paste). On
save, the `.axe` runs `ping` with token+salt to validate → "Connected" state. Creds
persist as resolver `config`.

### B. Index build (`init`, and on connect / refresh)

Paged `getAlbumList2` (`type=alphabeticalByArtist`, `size=500`, offset walk); each album
→ `getAlbum` for tracks. Build an in-memory `Map`:

```
key   = `${normalizeStr(artist)}|${normalizeStr(title)}`
value = { subsonicId, artist, title, album, coverArtId, duration }
```

Paged + `yieldToIdle`-friendly so a big beta collection doesn't jank the UI. Optionally
cached to the host KV store for a warm relaunch; refreshed on window focus when stale
(>6h) — same cadence pattern as in-app announcements.

### C. Enrichment (resolver `search` / `resolve`)

On a resolve request, consult the in-memory owned index **first**:

- **Hit** → return a source `{ subsonicId, owned: true, streamable: true, coverArt,
  confidence }`, gated through `validateResolvedTrack` + `MIN_CONFIDENCE_THRESHOLD`.
- **Miss** → fall through to the **existing scrape search** (unchanged).

Same resolver id (`bandcamp`), so `CANONICAL_RESOLVER_ORDER`, badges, and dedup are
untouched.

### D. Playback (`play`)

- Source has `owned/streamable` → build authenticated
  `stream?id=&maxBitRate=&format=` URL → hand to HTML5 `<audio>`. Real in-app playback;
  existing −3 dB Bandcamp volume offset applies.
- No `subsonicId` → current `shell.openExternal` fallback, unchanged.

### E. Collection library view

A "Bandcamp Collection" browse surface reads the same in-memory index — albums/tracks
grid, `getCoverArt` art, click-to-stream. No extra network beyond the sweep.

## Error handling & edge cases

- **Auth failure.** `ping` error `40` → "Reconnect" state, no retry loop. Mid-session
  401/40 on `stream`/`search3` → set a session `subsonicAuthFailed` kill-switch, suppress
  further Subsonic calls, fall back to scrape + external-open (mirrors Apple Music
  `_appleMusicWebAuthFailedAt` / Achordion `authFailed`). Clears on reconnect / restart.
- **Beta slowness / big collections.** Cap page size; `yieldToIdle` between pages; a hard
  time/attempt budget so a stalled sweep can't spin forever; progress indicator
  ("Indexing 1,240 tracks…"). Partial index is usable — degrade, never block.
- **Index vs. scrape disagreement.** Owned source wins when it passes the floor (it's
  authoritative and streamable). One source id → no double badge.
- **Matching false positives.** Owned hits go through the same two-axis (artist AND title)
  `validateResolvedTrack` gate. No ISRC (Subsonic doesn't expose it) — name-based, same as
  today, no regression.
- **`proxyFetch` absent (mobile / web).** Feature-detect → plain `fetch`. A CORS wall on a
  proxy-less platform fails soft and logs; enrichment/library degrade to empty, never throw.
- **Stream URL carries auth in query.** That's the Subsonic protocol (salted `t`/`s`
  token, not the raw password; the user's own Bandcamp app credential). Documented
  exception to the "no secrets in query" rule.
- **Offline / stale cache.** Cached index serves library + enrichment; `stream` needs
  network and fails soft via the standard "no source" auto-skip in radio/spinoff contexts.

## Testing

Extract the pure, portable logic into a testable module (beside
`sync-providers/confidence-scoring.js` / `tests/helpers/`), with the `.axe`'s stringified
functions as thin wrappers so they can't drift (same discipline as the confidence-scoring
re-export):

- **Auth:** `t = md5(password + salt)` matches known vectors; request-param assembly.
- **Response parsing:** `getAlbumList2` / `getAlbum` / `search3` fixtures → index entries;
  empty / single / paged.
- **Matching:** reuse `normalizeStr` + `validateResolvedTrack`; assert same-title/
  different-artist misses, live/remix edges, owned-wins-over-scrape.
- **Stream URL:** correct `stream?id=&format=&maxBitRate=` assembly; auth params present;
  no raw password.
- **Paging/budget:** sweep stops at the time/attempt budget, yields a usable partial index.

Fixtures live beside existing `tests/resolver/` and `tests/sync/` suites.

## Mobile parity

Because it's one shared `.axe`, parity is **not** a Kotlin re-port of the Subsonic client.
The mobile work is the **host affordances the `.axe` depends on**:

1. Credentials passed via resolver `config` (already the mobile plugin pattern).
2. `proxyFetch`-or-plain-`fetch` feature-detect works on the mobile JS bridge (note the
   CLAUDE.md caveat: a bare async IIFE reaching an `.axe` can serialize oddly on
   iOS/Android — the loader must invoke resolver methods directly, which mobile does).
3. HTML5-audio (or native) playback of the authenticated `stream` URL, honoring −3 dB.
4. The "Bandcamp Collection" browse UI on mobile.

File a `parachord-mobile` issue scoped to *host bridges + collection UI*, referencing the
desktop PR and the shared test module — not "reimplement Subsonic."

## Release checklist notes

- Bump `plugins/bandcamp.axe` `manifest.version` **and** the matching entry in
  `marketplace-manifest.json` (both required — the client checks
  `cachedVersion !== marketplaceVersion` to propagate the update without a new build).
- Marketplace sync CI fans the updated `.axe` out to every install on next launch.
