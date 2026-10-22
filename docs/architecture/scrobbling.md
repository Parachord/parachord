# Scrobbling and the Achordion plugin

> Moved verbatim out of `CLAUDE.md` on 2026-10-22 so the always-loaded guide stays short; `CLAUDE.md` indexes this file. Line references such as `app.js L####` date from when each passage was written and have drifted: search for the named function instead. Cross-references to other sections point at sibling files in `docs/architecture/`.

## Scrobbling: inline core, plugin contract for the rest

The three OAuth-based scrobblers (Last.fm, ListenBrainz, Libre.fm) live **inline** in [scrobbler-loader.js](../../scrobbler-loader.js) — `ScrobbleManager` plus `BaseScrobbler` and one subclass per service, all in one ~600-line file. They are NOT loaded as `.axe` plugins despite the existence of [plugins/lastfm.axe](../../plugins/lastfm.axe), [plugins/listenbrainz.axe](../../plugins/listenbrainz.axe), and [plugins/librefm.axe](../../plugins/librefm.axe) — those `.axe` files declare `type: "meta-service"` with `capabilities: { recommendations: true, metadata: true }` and cover only the *read* half (recommendations, library metadata). The *write* half (now-playing pings + scrobble submissions) stays inline.

### Why inline for the write path

1. **Code shape doesn't fit `.axe`.** A `.axe` is a JSON file whose `implementation.init` is a stringified function. That works for additive, mostly-stateless logic (Achordion's submit flow, AI providers). It's awkward for stateful 600-line classes with retry queues, OAuth state machines, persisted tokens, and protocol-callback wiring.

2. **Privileged-path coupling.** Each scrobbler needs:
   - `window.electron.proxyFetch` for token-exchange CORS bypass
   - `electron.store` for persisted user tokens (key per provider)
   - Protocol-handler registration for `parachord://lastfm-callback` (and friends)
   - Polling for OAuth-completion detection (commit `a380040`)
   - main.js IPC handlers that have to know each provider specifically (endpoint allowlist, token rotation)
   
   These can't be added by an `.axe` alone — main.js has to ship support, which means a desktop release ships with the scrobbler anyway. Bundling closes the loop.

3. **Marketplace hot-push is wrong for load-bearing code.** A bad Achordion `.axe` push = "submit pipeline idle this session." A bad scrobbler push = "user's plays don't scrobble until next desktop release." For users who scrobble, that's the central feature — risk profile too asymmetric for the marketplace path.

4. **Earlier modular attempt didn't pan out.** A `scrobblers/` directory + `scrobble-manager.js` (a separate older copy) sat dead in the tree until 2026-10 (parachord#757). Commit [`26b7ebd`](https://github.com/Parachord/parachord/commit/26b7ebd) was the explicit consolidation: *"The app uses ScrobbleManager from scrobbler-loader.js (not the separate scrobble-manager.js file)"* — keeping two implementations in sync was a recurring source of bugs. `scrobbler-loader.js` is the only implementation now.

### What CAN come from an `.axe`

The plugin contract is `window.scrobbleManager.registerPlugin({ id, isEnabled, scrobble, updateNowPlaying })` — public, stable. Achordion uses it via `capabilities.playbackTelemetry: true` (see Achordion Pre-resolution Plugin below). Anything that's:

- Additive (a new write target — Maloja, Spotify-history-as-a-source, custom analytics)
- Mostly stateless (no OAuth, no persistent retry queue)
- Doesn't need new main.js IPC

…can ship as a `.axe`. The capability filter + `initResolver()` invocation lives in app.js's cold-load (`initResolvers`, ~L9216) and marketplace hot-reload (`handlePluginsUpdated`, ~L9325) paths — keep those two in lockstep when adding any new playback-telemetry-shaped plugin (same rule as `withGenerate` / `withChat` / `withConcerts`).

### Where to look

| Concern | File |
|---|---|
| Track-state machine, retry queue, plugin dispatch | [scrobbler-loader.js](../../scrobbler-loader.js) — `ScrobbleManager` |
| Last.fm scrobbler | [scrobbler-loader.js](../../scrobbler-loader.js) — `LastFmScrobbler` |
| ListenBrainz scrobbler | [scrobbler-loader.js](../../scrobbler-loader.js) — `ListenBrainzScrobbler` |
| Libre.fm scrobbler | [scrobbler-loader.js](../../scrobbler-loader.js) — `LibreFmScrobbler` |
| Recommendations / library metadata for those services | `plugins/lastfm.axe`, `listenbrainz.axe`, `librefm.axe` (meta-service) |
| Playback-telemetry plugin (Achordion) | [plugins/achordion.axe](../../plugins/achordion.axe) |
| Loved-tracks push toggles + backfill | inline in app.js, persisted at `scrobbler_love_push_enabled` / `love_pushed_keys` |
| Removed | `scrobblers/` directory and `scrobble-manager.js` were a dead older copy, deleted 2026-10 (parachord#757; consolidation was commit [`26b7ebd`](https://github.com/Parachord/parachord/commit/26b7ebd)) |

## Achordion Pre-resolution Plugin

`plugins/achordion.axe` — bundled, default-on. Submits confirmed-on-playback `recording-MBID → external-streaming-URL` mappings to Achordion's match cache (POST `https://achordion.xyz/api/track-links/submit`). Each entry stored 90 days with `source: "parachord"`, which outranks Achordion's own Odesli + MB url-rel lookups. Spec: [achordion AGENTS.md L484-507](../../../../achordion/AGENTS.md). This is the **submit half**; the consume half (skip live resolver search on a cache hit) is future work pending an Achordion GET endpoint.

**Plugin shape.** `manifest.type: "meta-service"`, `capabilities.playbackTelemetry: true`. `init()` self-registers a scrobbler-shaped object (`{id, isEnabled, updateNowPlaying, scrobble}`) with `window.scrobbleManager`. `cleanup()` unregisters. The capability filter + `initResolver()` invocation lives in app.js next to the existing `withGenerate`/`withChat`/`withConcerts` branches in *both* the cold-load (`initResolvers`, ~L9216) and the marketplace hot-reload (`handlePluginsUpdated`, ~L9325) — keep those two paths in lockstep when adding any new playback-telemetry-shaped plugin.

**Tiered trigger** — derived from each track's `bestConfidence(track.sources)`:
| Confidence | Hook | Why |
|---|---|---|
| `>= 1.0` (direct-ID match — cached `spotifyId`/`appleMusicId`/etc) | `updateNowPlaying` (track-start) | By definition correct from a prior validated resolution; submit immediately. |
| `>= 0.95` (fuzzy `validateResolvedTrack` pass) | `scrobble` (at scrobble-manager threshold: ≥50% of track or 4min, whichever is sooner) | Containment-match has edge cases (Live/remix/etc); playback-duration is the evidence the match was correct. |
| `< 0.95` | never | Already gate-dropped by `MIN_CONFIDENCE_THRESHOLD` upstream of `track.sources` (see "Match Confidence + Selection Floor"). |

**Inherited filter from scrobbleManager:** tracks with `duration < 30` are excluded from both hooks (see [scrobbler-loader.js:75](../../scrobbler-loader.js)). Affects tier-1 too — a 25s ambient piece with a verified Spotify ID won't submit. Acceptable trade-off for using existing infrastructure; revisit if coverage matters.

**Submission rules** (inside the plugin):
1. Require `track.mbid`. The MBID Mapper enrichment provides it; a track that hasn't gotten a mapper hit yet at fire time is silently dropped (no retry — the next play of the same track will catch it).
2. In-session dedup via a `Set<mbid>` so loops/replays don't re-POST.
3. Build `links[]` from `track.sources`: Spotify (`https://open.spotify.com/track/{spotifyId}`), Apple Music (`appleMusicUrl` if present, else `https://music.apple.com/us/song/{appleMusicId}`), Bandcamp (`bandcampUrl`/`url`), SoundCloud (`soundcloudUrl`/`permalink_url`/`url`), YouTube (`https://www.youtube.com/watch?v={youtubeId}`). Local files skipped (not shareable). Sources with `noMatch` skipped.
4. Skip if `links.length === 0`.
5. POST with `Authorization: Bearer <embedded-token>`. On 401, flip session-scoped `authFailed = true` and suppress all further submissions until restart (mirrors the Apple Music `_appleMusicWebAuthFailedAt` pattern).

**Bearer token** is embedded as a string constant in `implementation.init`. Generated with `crypto.randomBytes(32).toString('base64url')` plus a `parachord_` prefix so Achordion can identify Parachord-client traffic distinctly. ASAR-extractable; same blast radius as any in-binary secret. Achordion server reads matching value from `PARACHORD_TRACK_LINKS_TOKEN` env var.

**Token rotation** if leaked: generate a new value, swap it in `plugins-src/achordion/implementation.js`, bump `manifest.version` in `plugins-src/achordion/manifest.json`, and run `node scripts/build-axes.js` (the generator syncs the `.axe` and the `marketplace-manifest.json` version). Push to main. Marketplace sync fans out to every install on next launch. Coordinate with Achordion owner so the new token is accepted before old installs become invalid (or accept both for an overlap window).

**Disable path for users:** uninstall the plugin via the Plugins UI (writes to `uninstalled_resolvers`). No bespoke "Pre-resolution" toggle exists; the plugin's own `isEnabled()` returns `true` unconditionally.

**Cross-platform parity.** Android client should mirror the same submit semantics if/when it adds Achordion writes — same endpoint, same bearer token (or a sibling `parachord_android_*` token if Achordion wants to distinguish), same tiered confidence gates derived from `ResolverScoring.kt`. The MBID requirement is non-negotiable on both platforms.
