# Scrobbling and the Achordion plugin

> Moved verbatim out of `CLAUDE.md` on 2026-10-22 so the always-loaded guide stays short; `CLAUDE.md` indexes this file. Line references such as `app.js L####` date from when each passage was written and have drifted: search for the named function instead. Cross-references to other sections point at sibling files in `docs/architecture/`.

## Scrobbling: inline core, plugin contract for the rest

The three OAuth-based scrobblers (Last.fm, ListenBrainz, Libre.fm) live **inline** in [scrobbler-loader.js](../../scrobbler-loader.js) — `ScrobbleManager` plus `BaseScrobbler` and one subclass per service, all in one ~600-line file. They are NOT loaded as `.axe` plugins despite the existence of [plugins/lastfm.axe](../../plugins/lastfm.axe), [plugins/listenbrainz.axe](../../plugins/listenbrainz.axe), and [plugins/librefm.axe](../../plugins/librefm.axe) — those `.axe` files declare `type: "meta-service"` with `capabilities: { recommendations: true, metadata: true }` and cover only the *read* half (recommendations, library metadata). The *write* half (now-playing pings + scrobble submissions) stays inline.

### Why inline for the write path

1. **Code shape doesn't fit `.axe`.** A `.axe` is a JSON file whose `implementation.init` is a stringified function. That works for additive, mostly-stateless logic (Achordion's submit flow, AI providers). It's awkward for stateful 600-line classes with retry queues, OAuth state machines, persisted tokens, and protocol-callback wiring.

2. **Privileged-path coupling.** Each scrobbler needs:
   - `window.electron.proxyFetch` for token-exchange CORS bypass (`main-process/ipc/proxy-fetch.js`: it accepts the same addresses it always has, checks every redirect hop the same way before requesting it, so a public URL can't redirect to the local network, drops credentials on a cross-origin hop, and caps the body at 50 MB)
   - `electron.store` for persisted user tokens (key per provider)
   - Protocol-handler registration for `parachord://lastfm-callback` (and friends)
   - Polling for OAuth-completion detection (commit `a380040`)
   - main.js IPC handlers that have to know each provider specifically (endpoint allowlist, token rotation)
   
   These can't be added by an `.axe` alone — main.js has to ship support, which means a desktop release ships with the scrobbler anyway. Bundling closes the loop.

3. **Marketplace hot-push is wrong for load-bearing code.** A bad Achordion `.axe` push = "submit pipeline idle this session." A bad scrobbler push = "user's plays don't scrobble until next desktop release." For users who scrobble, that's the central feature — risk profile too asymmetric for the marketplace path.

4. **Earlier modular attempt didn't pan out.** A `scrobblers/` directory + `scrobble-manager.js` (a separate older copy) sat dead in the tree until 2026-10 (parachord#757). Commit [`26b7ebd`](https://github.com/Parachord/parachord/commit/26b7ebd) was the explicit consolidation: *"The app uses ScrobbleManager from scrobbler-loader.js (not the separate scrobble-manager.js file)"* — keeping two implementations in sync was a recurring source of bugs. `scrobbler-loader.js` is the only implementation now.

### What CAN come from an `.axe`

The plugin contract is `window.scrobbleManager.registerPlugin({ id, isEnabled, scrobble, updateNowPlaying })` — public, stable — plus an optional `queuedTrack(track)` (what a queued retry needs beyond title, artist, album and length). Achordion uses it via `capabilities.playbackTelemetry: true` (see Achordion Pre-resolution Plugin below), and so does Subsonic, a playing plug-in (see "A playing plug-in reporting its own plays" below). Anything that's:

- Additive (a new write target — Maloja, Spotify-history-as-a-source, custom analytics)
- Mostly stateless (no OAuth, no persistent retry queue)
- Doesn't need new main.js IPC

…can ship as a `.axe`. The capability filter + `initResolver()` invocation lives in app.js's cold-load (`initResolvers`, ~L9216) and marketplace hot-reload (`handlePluginsUpdated`, ~L9325) paths — keep those two in lockstep when adding any new playback-telemetry-shaped plugin (same rule as `withGenerate` / `withChat` / `withConcerts`).

### A playing plug-in reporting its own plays

A content resolver can report plays to its own service through the same contract. Subsonic does (#1546): with "Report plays to your server" on (`settings.switches.reportPlays` in its manifest, off by default, saved in `meta_service_configs.subsonic.reportPlays`), a track that played **from Subsonic** is sent to the server's `scrobble.view` with the song id, `submission=false` from `updateNowPlaying` at the start (the server's Now Playing) and `submission=true&time=<start, ms>` from `scrobble` at the threshold (the server's play count, and its own scrobbling if set up there). It's off by default because someone who also scrobbles from Parachord may not want the server counting the same play, or scrobbling it a second time.

- **How it starts.** `capabilities.playbackTelemetry` on a content resolver: once the resolvers load (and after an install or update), `initPlaybackTelemetry` (`src/renderer/lib/playback-telemetry.js`) calls the plug-in's `init(config, host)` through `resolverLoader.initResolver(id, config, host)`, with `host.getConfig()` reading its saved settings at each call (`getResolverConfig`), so the switch and the password apply to the next play without a reload. The init registers `{ id, isEnabled, updateNowPlaying, scrobble, queuedTrack }`; `cleanup` unregisters it. Without `window.scrobbleManager` or `host.getConfig` (an older desktop, the mobile apps today, whose telemetry init passes `{}` and nothing else) it registers nothing.
- **Only its own plays.** The manager calls every registered plugin for every track, so the plug-in reads `track._activeResolver` (the resolver actually playing) and reports only its own; the song id is the playing source's `subsonicId` (spread onto the track), else `track.sources.subsonic.subsonicId`. Every other play returns quietly, which the manager reads as success, and is never queued.
- **Failures.** A Now Playing failure is logged once a session and swallowed. A failed submission throws, so the manager queues it. An error the server will never take back (Subsonic codes 10, 20, 30, 41–43, 50, 60, 70, or HTTP 404/410/501) is logged once and dropped instead. Wrong credentials (40, 44, HTTP 401/403) throw with `authError`, so a retry pass stops at the first one and keeps the rest (no loop). No log line carries the request URL: it has the token and salt.
- **What the queue keeps.** A queued item keeps the track's title, artist, album and length, plus what the plugin's optional `queuedTrack(track)` returns (plain values only): Subsonic's song id and `_activeResolver`, without which the retry couldn't name the song.
- **Retries and late registration.** The startup retry pass (`initializeScrobblers`) runs before plugins load, so it now keeps an item whose plugin hasn't registered (it used to drop it; one that never registers expires after 14 days), and a plugin that registers after that pass gets its own items retried then (`registerPlugin` → `retryFailedScrobbles(pluginId)`). The queue's read-change-write runs one at a time (`_queueTask`), so a retry pass and a new failure can't write over each other.

### Where to look

| Concern | File |
|---|---|
| Track-state machine, retry queue, plugin dispatch | [scrobbler-loader.js](../../scrobbler-loader.js) — `ScrobbleManager` |
| Last.fm scrobbler | [scrobbler-loader.js](../../scrobbler-loader.js) — `LastFmScrobbler` |
| ListenBrainz scrobbler | [scrobbler-loader.js](../../scrobbler-loader.js) — `ListenBrainzScrobbler` |
| Libre.fm scrobbler | [scrobbler-loader.js](../../scrobbler-loader.js) — `LibreFmScrobbler` |
| Recommendations / library metadata for those services | `plugins/lastfm.axe`, `listenbrainz.axe`, `librefm.axe` (meta-service) |
| Playback-telemetry plugin (Achordion) | [plugins/achordion.axe](../../plugins/achordion.axe) |
| A playing plug-in reporting its own plays (Subsonic) | `init` in [plugins-src/subsonic/implementation.js](../../plugins-src/subsonic/implementation.js), started by [src/renderer/lib/playback-telemetry.js](../../src/renderer/lib/playback-telemetry.js) |
| Loved-tracks push toggles + backfill, and the import action (`runLoveImport`) | inline in app.js, persisted at `scrobbler_love_push_enabled` / `love_pushed_keys` / `love_import_cursor`; pure helpers in `src/renderer/lib/love-import.js` |
| Removed | `scrobblers/` directory and `scrobble-manager.js` were a dead older copy, deleted 2026-10 (parachord#757; consolidation was commit [`26b7ebd`](https://github.com/Parachord/parachord/commit/26b7ebd)) |

### Signed in vs scrobbling on

Each scrobbler has two tests: `isEnabled()` (signed in **and** "Scrobble to X" switched on: what scrobbling reads) and `isSignedIn()` (a session or token, whatever the switch says). Loved-track syncing (the live push, `runLoveBackfill`, `runLoveImport` and its cross-service offer) reads `isSignedIn()`, so the scrobbling switch pauses scrobbling only; until 2026-11-17 it stopped loved tracks too. Sign out (the Scrobbling section) ends both. The username row's Remove forgets only Last.fm's or ListenBrainz's username: "Enable", the API keys and the scrobbling session stay (it used to delete the whole settings record, switching Enable off).

### Last.fm's API key: which one, and when Last.fm turns it down

From 1 December 2026 a Last.fm API key works only while the account that owns it has Last.fm Pro ([announcement](https://support.last.fm/t/api-keys-will-require-pro-from-1st-december/121030)). Parachord's built-in key is covered. A person can also enter their own key and secret in the Last.fm plug-in's Advanced settings, and the app then uses them instead (#1538).

**One chooser.** `src/renderer/lib/lastfm-key.js` (`createLastfmKeys`, one instance at `window.lastfmKeys`) holds the person's pair (fed from `metaServiceConfigs.lastfm` by an effect whenever it changes) and the built-in pair (env, else `FALLBACK_LASTFM_API_KEY` / `_SECRET` in `main.js`, read at launch through `config-get` and `getScrobblerConfig`). `readPair()` is the person's key if set and not refused, else the built-in one; `signedPair()` (sign-in only) is the person's key **and** secret if both are set and the key isn't refused, else the built-in pair; `pairForKey(key)` is the pair a session was made with. A key and its secret are always used together. `getLastfmApiKey()` in app.js is `lastfmKeys.apiKey()`.

**Two integration points.**
- Renderer GETs: `installLastfmKeyFallback` in app.js wraps `window.fetch` with `createLastfmFetch`. Every GET to `ws.audioscrobbler.com` made with one of our keys (app.js's own reads through `lastfmFetch`, the Last.fm plug-in's `getSimilarUsers`, Spinoff's pool, the charts URL from `src/charts-utils.js`) goes out with `readPair()`'s key.
- The scrobbler: `LastFmScrobbler` reads from the same object at each call (`setKeySource`, passed in by `initializeScrobblers`). `setApiCredentials` is only the fallback for a scrobbler without a source (Libre.fm, tests). Its calls go through main's `proxyFetch`, not `window.fetch`. Its reads (the loved-tracks import) and the sign-in calls that carry no session yet (`auth.getToken`, then `auth.getSession` with the token's own pair, `authPair`) use `lastfmKeys.call`, so they fall back like any read. Calls that carry a session (`sk`: scrobble, now playing, love) never switch keys: see "The session key".

**The fallback, for reads.** A reply with error `10` (invalid API key) or `26` (suspended) to a read made with the person's key marks that key refused for reads (memory only, no store key; a relaunch, saving the keys again (`clearRefusal`), or saving a different key tries a key of theirs again), and the read is retried once with the built-in key. That's harmless: a read carries no session. The first refusal in a session shows one toast with an "Open Last.fm" action (it doesn't claim Pro is the cause: a `10` can also be a mistyped or revoked key). Whenever the refused state changes (`onChange`), the plug-in's Advanced section shows the same news in place of its hint, or stops showing it (the host account's `advancedNotice`; with or without a username). Error `29` (rate limit) and `9` (session) never switch keys, and the rate-limit toast no longer sends people to a key of their own. Last.fm answers a refused key with HTTP 403 and a JSON body, so the interceptor reads the body (from a clone) of non-2xx replies only. It never re-keys a URL that carries `api_sig` or `sk` (that would break the signature, error 13), and it knows the person's earlier keys from the session as well as the current one.

**The built-in key refused.** No retry: the request throws `lastfmUnavailableError` (`err.lastfmUnavailable`, readable text through `errorText`), never an empty answer a caller could cache as a miss ("No resolver holds a row"). On a scrobble the session is kept and the scrobble is queued.

**The session key.** A Last.fm session key is issued to the API account that asked for it (the token from `auth.getToken`, the sign-in page and `auth.getSession` all carry that `api_key`). Last.fm's docs don't say what another key does with it, and nothing here relies on a guess:
- sign-in records the session's key as `sessionApiKey` in `scrobbler-config-lastfm`; a session from before that field signs with the pair the scrobbler always used (the person's key and secret if both are saved, `storedSignedPair()`, whatever reads are doing) and records it from the first signed call that works;
- every session call is signed with the session's own pair (`sessionPair` → `pairForKey(sessionApiKey)`), so a Pro user whose key works keeps using it, and a session made with the built-in key keeps using the built-in pair;
- a `10` or `26` on a session call made with the person's key switches reads at once, but signs out only when it repeats on the next signed call (two in a row; a call that works resets the count). Then it asks them to sign in again through the Scrobbling section's own sign-in (`scrobbler-auth-error` with a `userMessage`), and the new session is made with the built-in pair. Error `9` keeps the three-strikes rule for a transient blip;
- during sign-in, a refused key or a dead token (`4`, `15`) stops the poll and asks for a new sign-in.

**No scrobble is lost.** `ScrobbleManager.submitScrobble` queues every failed scrobble, auth errors included (it used to drop those). `retryFailedScrobbles` keeps a signed-out scrobbler's items until the person signs in again, for up to 14 days.

### A resumed track isn't scrobbled twice

`ScrobbleManager` scrobbles once a track's position passes the threshold: half its length or 4 minutes, whichever is sooner, and at least 30 s. Every `onTrackStart` resets that.

A restored queue's track resumes where it was (#1319, see playback.md), and Play starts it through `handlePlay`. So a track paused past its threshold, then restored after a restart and resumed, was scrobbled again within a second of Play.

The fix:
- The queue's saved position records whether that listen was scrobbled: `saved_queue_position.scrobbled`, from `ScrobbleManager.hasScrobbled`.
- The restore carries the flag on the pending start position, and a seek before Play keeps it.
- `handlePlay` passes `onTrackStart(track, { continuesScrobbled: true })` when it resumes that listen. The scrobbler then doesn't submit it again; Now Playing still goes out.

A restored track that starts over from 0:00 is a new listen and scrobbles as usual. That happens when its position was in its first 5 s or last 10 s, or when Previous moved it back to the start. Tests: `tests/scrobbling/resume-no-double-scrobble.test.js`.

### ListenBrainz client identity

Every listen carries `additional_info.media_player: "Parachord"`, `submission_client: "Parachord"` and `submission_client_version: "<app version> (desktop)"` (`formatSubmissionClientVersion` in `scrobbler-loader.js`; the version comes from `window.electron.updater.getVersion()` once per session, and a failed lookup sends `unknown (desktop)` and retries on the next submit). Mobile sends `"<version> (android)"` / `"<version> (ios)"` (parachord-mobile#418); the platform names match the `X-Parachord-Client` allowlist. The version used to be a hard-coded `"1.1.0"` on every client, so two Parachord clients on one ListenBrainz token could not be told apart in duplicate-listen reports (parachord#1125). Keep `submission_client` at `"Parachord"`: Achordion's importer detection (`lib/clients/listenbrainz.ts`) reads only that field, matching spotify / last.fm / libre.fm to spot ListenBrainz importers.

### Album share links (Copy Link)

Copy Link on an album asks Achordion's `entity-link` endpoint (`fetchEntityLink` in the Achordion plugin, `type: 'album'`) for the album's URL and falls back to `/release-group/lookup?artist=&title=`. Achordion's album pages are release groups, and `entity-link` builds `/release-group/<mbid>` from whatever MBID it is given: it does **not** map a release MBID to its group (jherskowitz/achordion#107), so a release id makes a link that 404s. Every share path therefore asks for a release-group MBID first: the album page records `releaseGroupMbid` when its track list loads (`fetchReleaseData`; the release lookup includes `release-groups`, and a page opened by release-group id falls back to that id), the Share menu and the top-bar share read it before `mbid` / `id`, and the context-menu path in `main.js` puts `album.releaseGroupMbid` / `releaseGroupMbid` ahead of `album.mbid`. Before 2026-11-02 the comments here said Achordion did the mapping, and album links built after MusicBrainz's list loaded pointed at the release.

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
