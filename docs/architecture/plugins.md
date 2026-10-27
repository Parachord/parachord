# Plugin (.axe) marketplace system

> Moved verbatim out of `CLAUDE.md` on 2026-10-22 so the always-loaded guide stays short; `CLAUDE.md` indexes this file. Line references such as `app.js L####` date from when each passage was written and have drifted: search for the named function instead. Cross-references to other sections point at sibling files in `docs/architecture/`.

## Plugin (`.axe`) Marketplace System

### Extensibility principle — abstract over the plugin registry, don't hardwire services

Any feature shaped like "given a provider URL or entity, do X" MUST route through the resolver-loader capability surface, never a hardcoded service switch. The surface (`resolver-loader.js`):

- `findResolverForUrl(url)` → which resolver owns this URL (matches each `.axe`'s `urlPatterns`)
- `getUrlType(url)` → `'track' | 'album' | 'playlist' | 'artist' | 'unknown'`
- `lookupUrl(url)` / `lookupAlbum(url)` / `lookupPlaylist(url)` → entity → tracks, dispatched to the owning resolver's capability
- `resolve` / `search` on `loadedResolversRef` for playback + search
- `listModels(config)` for AI `dynamic-select` plugins

The payoff: whichever `.axe` declares matching `urlPatterns` + the capability handles it, so **adding a new streaming service is a plugin drop-in with zero feature code.** The anti-pattern is hardcoding the dispatch:

```js
// WRONG — every new service needs a feature-code edit, and the .axe registry is bypassed:
switch (host) { case 'open.spotify.com': return spotifyImport(url); case 'music.apple.com': ... }

// RIGHT — the registry decides; a new service is just another .axe with urlPatterns + lookupPlaylist:
const id = resolverLoaderRef.current.findResolverForUrl(url);
if (id && resolverLoaderRef.current.getUrlType(url) === 'playlist') {
  const { playlist } = await resolverLoaderRef.current.lookupPlaylist(url, await getResolverConfig(id));
}
```

**Worked example — `resolveProviderPlaylistUrl` for `parachord://play/playlist?url=` (parachord#930/#932).** The provider-page branch routes entirely through `findResolverForUrl` + `getUrlType` + `lookupPlaylist`, so Spotify / Apple Music / SoundCloud / any future resolver are handled without naming them. The two `host ===` checks in the pure helper `classifyPlaylistUrl` (protocol-url.js) are **justified pre-processing, not service hardwiring** — keep them, don't "fix" them into the switch anti-pattern:

- **`achordion.xyz`** isn't a streaming resolver; it's a first-party playlist *host* whose `/api/playlist/<mbid>/xspf` returns a tracklist *document*. It feeds the generic `parseProtocolTracklist` path (the document fallback), not a resolver. No `.axe` owns it by design.
- **`on.soundcloud.com`** is a short link the capability surface *can't* classify (no `/sets/` segment for `getUrlType`). It's a redirect-resolve step that produces a canonical `soundcloud.com/.../sets/...` URL which is then handed back to `findResolverForUrl` — it feeds the surface, it doesn't replace it.

**Reusable mechanics when extending this:**

- **Native fast-paths are an optimization, not the gate.** `resolveProtocolPlayInput` has direct `spotify.lookupAlbum` / `window.appleMusicLookupAlbum` arms for cached IDs, but the general path still goes through the loader. Don't let a fast-path become the only path.
- **Audit the capability before assuming it exists.** `lookupPlaylist` is not universal — `resolver-loader.js` returns `null` (and logs "does not support playlist lookup") for resolvers that don't implement it, and some `.axe` lacked it until added (SoundCloud needed `lookupPlaylist` + OAuth before it could resolve a set). A new consumer must handle the `null`, not assume tracks.
- **Cross-platform parity.** This mirrors the mobile principle (`ProviderPlaylistResolver`, the two `lookupPlaylist` polls, `parachord-plugins/<service>.axe`). The mobile note also documents a JS-bridge quirk (a bare async IIFE reaching an `.axe` serializes to `[object Promise]` on iOS / `{}` on Android, so reaching the plugin needs the unique-key poll on both runtimes) — that's a mobile-runtime concern; desktop calls the loader methods directly in-process and isn't affected, but the *registry-abstraction* contract is identical on both sides.

### HTML5 stream resolvers and plugin-rendered settings (drop-in contract)

Subsonic and Plex used to be named in ten transport lists, two config gates and a bespoke settings block each; the renderer now reads three things from the `.axe` instead, and a new self-hosted resolver adds **no** app.js code (`tests/resolver/html5-stream-capability.test.js` pins this):

- **`capabilities.html5Stream: true` + `getStreamUrl(track, config)`** — the host plays the returned `http(s)` URL through the shared HTML5 element: `isHtml5StreamResolver(id)` / `usesSharedAudio(id)` (app.js, next to `loadedResolversRef`) replace every `=== 'subsonic'` style check (play branch of `handlePlay`, play/pause, seek, volume, the wall-clock progress-tracker skip, the element's error dialog, which is labelled with the manifest `name`). Build the URL from the **saved config**, never from fields stored on the track (tracks persist into the queue and playlists). Tag results with `sources: ['<id>']` like every bundled plugin: that is how `handlePlay` and `determineResolverIdFromTrack` attribute a bare result to its resolver without a host-known id field.
- **`isConfigured(config)`** — the Plugins page asks this before flagging an enabled resolver's card as needing configuration. Without it the card never warns.
- **`settings.authType: 'custom'` + `renderSettings(ctx)`** — the settings modal renders the plugin's own panel through `PluginSettingsPanel` (`src/renderer/components/settings-cards.js`, next to `ResolverCard`; app.js imports it). `ctx` is `{ React, resolver, config, saveConfig(next), clearConfig(), isActive, setActive(bool), showToast, showConfirmDialog }`. The wrapper is a real component, so the plugin may call hooks via `ctx.React` as long as it calls them unconditionally; `saveConfig`/`clearConfig` write `meta_service_configs[id]` and invalidate `resolverConfigCache`, and `getResolverConfig` hands any plugin without a hardcoded branch that saved entry (through the ref, so a save is visible to the next search/play). `setActive(true)` after a successful sign-in is what enables the resolver.
- Badge and icon colours fall back to the manifest `color` (`pluginBadgeMeta`, next to `TrackRow` in `src/renderer/components/track-lists.js`); the only per-service art left in the renderer is the optional logo in `SERVICE_LOGO_PATHS` / `SERVICE_LOGOS` (`src/renderer/components/ui-atoms.js`), and `CANONICAL_RESOLVER_ORDER` gives a bundled resolver its default priority slot.

What stays in main: the scoped fetch policy a self-hosted server needs (`main-process/ipc/plex-fetch.js`): an `.axe` must not be able to grant itself unrestricted or TLS-off fetch, so that part is host code by design.

### Architecture
- Plugins are `.axe` files (JSON) in `plugins/` (`/plugins/*.axe` is gitignored — generated artifacts live there, see the next bullet), each with a `manifest` (id, version, etc.) and `implementation`
- **`plugins/*.axe` are GENERATED, UNTRACKED artifacts** (untracked since parachord#1107). The source of truth is `plugins-src/<id>/` — `manifest.json` (the .axe minus its implementation) + `implementation.js` (a real module: `module.exports = { search: fn, ... }`). `scripts/build-axes.js` regenerates the `.axe`, the matching app.js `FALLBACK_RESOLVERS` line, and the `marketplace-manifest.json` entry version from that source. **Never hand-edit `plugins/*.axe` or the FALLBACK lines** — edit `plugins-src/`, bump `manifest.version` there; regeneration runs in the `pretest`/`prestart`/`predev`/`prebuild*` hooks (build-axes FIRST, then build-renderer — order matters, see below), and a manual `node scripts/build-axes.js` works too. **The writer has a second job that is easy to miss: it rewrites two outputs that STAY tracked** — the `FALLBACK_RESOLVERS` block in `src/renderer/app.js` and the entry versions in `marketplace-manifest.json` — and a PR that changes a plugin's source must commit those rewrites. The guards on that (replacing the retired `tests/plugins/axes-drift.test.js`):
  - **The committed-state drift gate** — `.github/workflows/test.yml` runs `git diff --exit-code -- src/renderer/app.js marketplace-manifest.json` after `npm test`'s pretest writer. A check that runs after a hook ran the writer cannot fail on on-disk artifacts (the writer has already regenerated them), so the gate compares committed tracked outputs instead. (Found in review on parachord#1107.)
  - **`build-axes.js` runs before `build-renderer.js` in every hook** — otherwise the bundle is built from a `src/renderer/app.js` whose FALLBACK block the writer has not updated yet, and a one-shot CI `prebuild` ships a release bundle with a stale block. (Also found in review on parachord#1107.)
  - **The PR-only version-bump gate** (`scripts/check-plugin-version-bumps.js`, same workflow) — any PR that touches `plugins-src/<id>/` must change its `manifest.version` (the nested `.manifest.version` path; plugins-src manifests are the `.axe` shell minus `implementation`), or marketplace clients never re-download. This is the enforced form of build-axes' local content-vs-disk warning, which went silent when the artifacts were untracked. New plugins and deletions are exempt. Local-run caveat: with its default `origin/main` base the diff compares against main's tip, so a branch behind main can false-positive — fetch/rebase first (CI can't hit this: HEAD is the merge commit).
- **Marketplace source**: Raw GitHub files from `Parachord/parachord-plugins` repo
- **Manifest**: `marketplace-manifest.json` in this repo — the central catalog of all plugins with version numbers (entry `version` is generator-synced; category/tags/downloadUrl/capabilities in the entry are editorial, hand-maintained)
- **Client sync**: `main.js` fetches manifest + `.axe` files from `https://raw.githubusercontent.com/Parachord/parachord-plugins/main/`

### Plugin Loading Order (main.js `resolvers-load-builtin`)
1. Shipped plugins from app `plugins/` directory (bundled in ASAR for packaged builds)
2. Cached marketplace plugins from `~/.parachord/plugins/`
3. Version comparison: newer version always wins; same version prefers shipped over cached

### How Updates Reach Users (No New Build Required)
1. **Edit `plugins-src/<id>/implementation.js`** (or `manifest.json`) — and bump `manifest.version` in `plugins-src/<id>/manifest.json`
2. **Regenerate** — any lifecycle hook does it (`pretest`/`prestart`/…, build-axes first), or `node scripts/build-axes.js` by hand: regenerates `plugins/<id>.axe`, the app.js `FALLBACK_RESOLVERS` line, and syncs the `marketplace-manifest.json` entry version (warns if content changed without a version bump — and the CI version-bump gate FAILS the PR on it)
3. **Commit the regenerated tracked outputs** (`src/renderer/app.js` FALLBACK block, `marketplace-manifest.json` versions) — the drift gate fails otherwise
4. **Push to main** — the `sync-repos.yml` CI workflow generates the `.axe` files from `plugins-src/` and syncs them plus the manifest to `Parachord/parachord-plugins`
5. **User relaunches Parachord** — `syncPluginsWithMarketplace()` (src/renderer/app.js) compares cached version against marketplace manifest version; if different, downloads the new `.axe` and fires `parachord-plugins-updated` event for hot-reload

### Critical: Both Files Must Be Updated
This footgun is now generator-owned: `node scripts/build-axes.js` writes the `.axe` version and the `marketplace-manifest.json` entry version from the same source manifest. The only manual rule that remains: bump `manifest.version` in `plugins-src/<id>/manifest.json` when the implementation changes — the writer warns on content churn on an unchanged version, and the PR-only CI version-bump gate fails the build on it.

### Absorbing a Reverse-Sync Community Edit (automatic)
`reverse-sync.yml` PRs already carry `plugins-src/` diffs, not `.axe` files: the workflow generates our artifacts from `plugins-src/` first, compares each remote `.axe` against them (adoption only on strictly-greater semver or an unknown plugin — never downgrades/sidegrades, the #754 guard; equal-version-different-bytes is kept-ours and annotated as a workflow warning), and runs `build-axes.js --import` for anything adopted before opening the PR. So a community edit arrives pre-absorbed — review the `plugins-src` diff, never the `.axe`. Two failure behaviors to know: a failed import git-restores both paths so a PR never half-adopts (the daily run retries), and `plugins-src/<id>/build.json` (the es5 flag, which the `.axe` doesn't carry) is stashed/restored across the import. The manifest merge appends community-only entries (synthesizing a minimal one if the remote manifest lacks the adopted plugin) and runs BEFORE the import/regen, because build-axes' write mode hard-requires a marketplace entry per plugins-src id. Manual one-file re-absorb is still: delete the plugin's `plugins-src/<id>/` dir, then `node scripts/build-axes.js --import --plugin <id>`.

### Engine-Portable (ES5) Plugins
Plugins the mobile runtime also evaluates (subsonic, bandcamp) must keep ES5-level implementation text. Flag them via `{ "es5": true }` in `plugins-src/<id>/build.json` — the writer transpiles through esbuild `--target=es5` before serializing (requires esbuild installed). Unflagged plugins may use modern syntax in `implementation.js`.

### Marketplace Sync CI (.github/workflows/sync-repos.yml)
- Triggered on push to main when `plugins-src/**` or `marketplace-manifest.json` change
- Generates `.axe` artifacts in CI (`npm ci && node scripts/build-axes.js` — full npm ci with `ELECTRON_SKIP_BINARY_DOWNLOAD=1`; NOT `--ignore-scripts`, esbuild's postinstall binary is required by the es5 transpile path) and copies them to the `parachord-plugins` repo (does NOT delete community-contributed plugins)
- Merges manifest: updates monorepo entries, preserves community-only entries

### Reverse Sync (.github/workflows/reverse-sync.yml)
- Daily at 6 AM UTC or manual dispatch
- Pulls adopted plugins from `parachord-plugins` into `plugins-src/` via PR (see the auto-absorb section above). **Token hygiene is load-bearing:** this job executes imported plugin code (the writer `require()`s each `plugins-src` implementation — string-form values are evaluated as expressions at require time), so its checkout is `persist-credentials: false` (the push authenticates inline in the same command) and the read-only plugins-repo clone's token URL is dropped from git config immediately after cloning. Keep those two lines deleted-on-purpose when editing the job.

### Dynamic Model Selection
- AI plugins (Ollama, ChatGPT, Gemini, Custom LLM) use `type: "dynamic-select"` in their model setting
- Each plugin implements a `listModels(config)` function that fetches available models from the provider's API
- **Ollama**: `GET {endpoint}/api/tags` — returns locally installed models
- **ChatGPT**: `GET /v1/models` with blocklist filter (excludes `dall-e`, `whisper`, `tts`, `text-embedding`, `babbage`, `davinci`, `canary`, `moderation`, `embedding`, plus `realtime`/`audio`/`transcri`)
- **Gemini**: `GET /v1beta/models?key=` filtered by `supportedGenerationMethods.includes('generateContent')`
- **Claude**: No list endpoint — stays curated with static `type: "select"`
- **Custom LLM** (`customllm.axe`, parachord#997): dialect-aware — `GET {baseUrl}/models` (openai) or `GET {baseUrl}/v1/models` (anthropic). Sets `allowCustom: true` on its dynamic-select, so the settings UI renders a free-text input + `<datalist>` instead of a select — typing an arbitrary model id must always work because not every endpoint implements the list route. Model suggestions refresh when the `baseUrl` or `api` fields change (the generic extra-field renderer in the AI config block refetches dynamic models for those field keys).
- App-side: `dynamicModelOptions` state tracks loading/options/error per resolver; `fetchDynamicModels()` called on settings panel open and after API key/endpoint changes
- `fallbackOptions` in the plugin manifest shown when fetch fails or no API key configured yet
- Refresh button (↻) next to model label for manual re-fetch
- The AI config block renders extra `settings.configurable` fields generically (select/text/number) beyond the auth key + model pair — `customllm` uses it for `api` (dialect select), `baseUrl`, `maxTokens`; older AI plugins declare only apiKey + model so they render nothing extra. For `requiresAuth: false` AI services the block also renders an explicit **Enable toggle** (these services are enabled *solely* by `config.enabled === true` — see `isServiceEnabled` — so the flag must be visible and flippable, same as Ollama's own block), the modal footer's Enable button tracks `enabled !== true` (a set `apiKey` does NOT count as enabled for them), and the apiKey onBlur preserves the toggle (`state.enabled === true || !!value` — deliberately NOT `??`: nullish coalescing doesn't fall through on `false`, so an early empty-key blur would poison `enabled: false` and a later key entry could never re-enable — that exact sequence shipped customllm with a configured-but-disabled service).

## Authoring a plugin (.axe format)

An `.axe` file is JSON with up to five top-level keys: `manifest`, `capabilities`, `urlPatterns`, `settings` and `implementation`. For a bundled plugin you never write that JSON by hand. You write `plugins-src/<id>/manifest.json` (everything except `implementation`) and `plugins-src/<id>/implementation.js` (`module.exports = { search: async function (query, config) { ... }, ... }`), then run `node scripts/build-axes.js`, which serializes each exported function with `String(fn)` into the `.axe`. Because the source is a real module, modern syntax including template literals is fine, except in plugins flagged `es5` (see above). A community plugin installed from a file is the same JSON, however it was produced.

### Manifest

`resolver-loader.js` (`createResolverInstance`) reads `id` and `name` (both required; the file installer rejects a file without them), `version` (semver; the loader and marketplace sync compare it), `author`, `description`, `icon` (an emoji; defaults to 🎵), `color` (hex; defaults to `#888888`), `homepage` and `email`. `type` is either absent (or `"resolver"`), meaning a content resolver that plays or finds tracks, or `"meta-service"`, meaning everything else: AI providers, concert sources, metadata and recommendation services, scrobbling services and the Achordion telemetry plugin. A `manifest.id` may contain only letters, digits, dots, dashes and underscores.

### Capabilities

A flat object of booleans. Content resolvers use `resolve`, `search`, `stream`, `browse`, `urlLookup`, `purchase` (shows a Buy button in the playbar) and `albumSearch` (finds an album by name for the album-page catalog fallback; see "Album search" below). Meta-services use, among others, `generate` (one-shot AI playlist), `chat` (Shuffleupagus), `concerts`, `playbackTelemetry` (self-registers with `window.scrobbleManager`), `recommendations`, `metadata`, `artistImages`, `biography`, `listeningHistory` and `scrobbling`. Several of these gate loading: the renderer loads a meta-service's implementation only when it declares `generate`, `chat`, `concerts` or `playbackTelemetry` alongside the matching function, or `urlLookup` with `urlPatterns`. `mobile: false` (declared by Ollama) marks a plugin the mobile client should not offer. Check the existing `plugins-src/*/manifest.json` files before inventing a new flag; nothing reads an unknown one.

### URL patterns and lookups

`urlPatterns` is a top-level array of glob-like strings, for example `"open.spotify.com/playlist/*"`, `"*.bandcamp.com/album/*"` or `"spotify:track:*"`. The protocol and a trailing slash are ignored, a leading `*.` matches any subdomain, a middle `*` matches one path segment, a trailing `*` matches the rest of the path, and the query string is ignored unless the pattern itself contains `?` (`matchUrlPattern`). `findResolverForUrl(url)` returns the first resolver whose pattern matches.

`lookupUrl(url, config)` returns a track, `lookupAlbum(url, config)` returns `{ name, artist, albumArt, tracks, ... }`, and `lookupPlaylist(url, config)` returns `{ name, tracks, trackCount, ... }`. Each may return `null`, and callers must handle that. Note that `getUrlType(url)` (which decides whether a matched URL is a track, album, playlist or artist) is a per-host switch inside `resolver-loader.js`, not plugin data, so a new service's URLs come back `'unknown'` until that function gets an arm for its host.

### Album search (`searchAlbums`, optional)

A content resolver that can find an album by name declares `capabilities.albumSearch: true` and implements two functions:

- `searchAlbums(query, config)`. `query` is `{ artist, title }` from an album page, or a free-text string from Search. Returns `[{ id, name, artist, albumArt, releaseDate, trackCount, url }]` (any field but `name` and `url` may be `null`), or `[]` on a miss. Never throws for a miss, and returns `[]` without a request when it lacks the credentials it needs (Spotify without a token, Subsonic without a server).
- `lookupAlbum(url, config)`, which must accept every `url` its own `searchAlbums` returns. The host calls it on the resolver that found the album (`ResolverLoader.lookupAlbumFrom`), not through `findResolverForUrl`, so a `url` may be private to the plugin and match no `urlPatterns` (`subsonic:album:<id>`, `localfiles:album:<artist>/<album>`). It returns the usual `{ name, artist, albumArt, releaseDate, trackCount, tracks, url }`, where each track has at least `title`, plus `duration` (seconds), `trackNumber` and `discNumber` when known.

`tests/resolver/album-search-capability.test.js` fails a plugin that declares the capability without both functions. Keep credentials out of anything returned: results and their urls are held in page state, and a Subsonic token in a cover or stream url replays until the password changes.

**Who uses it.** Every album page gets its track list from MusicBrainz through `fetchReleaseData` (Fresh Drops, Charts, Critic's Picks, Home, Search, Collection, the artist page, the playbar, `parachord://album` links). When MusicBrainz fails or doesn't have the album, `loadAlbumFromCatalogs` (src/renderer/app.js; the pure part is `src/renderer/lib/album-catalog.js`) asks the albumSearch resolvers in order (the one a release id came from, then the user's active services in their priority order, then every other installed one), keeps the first result whose artist and title match (`pickCatalogAlbum`: edition suffixes aside, one artist of a joint credit is enough), and loads it with `lookupAlbum`. It also runs when MusicBrainz is merely slow: a page still waiting for its track list after `MB_SLOW_FALLBACK_MS` (5s; every MusicBrainz request waits its turn in the 1 req/s queue) shows the catalogs' list meanwhile, and `fetchReleaseData`'s success replaces it when MusicBrainz answers (its own load leaves a catalog list on screen alone until then, and a MusicBrainz failure leaves it standing). That effect keys on the album (`sameAlbumIdentity`: artist and title), not the id, since a page moves from a release-group id to a release id while it loads, and concurrent lookups for one album share a single request. A release with a service's id (`spotify-…`, `applemusic-…`, `lastfm-…`, `discogs-…`, from a Search result or an artist-page card built from that service) skips MusicBrainz: these used to be sent to MusicBrainz and never open. Search fills its album results from `searchAlbums` when MusicBrainz returns fewer than three (including when it is down), and a result carries `_catalog: { resolverId, url }` so the click loads it without searching again.

MusicBrainz stays first for albums that have a MusicBrainz id. Its track titles are the ones track ids (`trackSlug` of artist, title, album) and the resolution cache are keyed on, and its recording ids feed scrobbles and Achordion; a service's titles differ by edition ("Song (Remastered 2011)"). For the same reason the converted release (`catalogAlbumToRelease`) keeps the requested artist and album title, drops the plugin's track ids and sources (the usual resolution pass finds each track on the user's services), and is not written to the MusicBrainz caches. The page says where the list came from ("Track list from Bandcamp").

Implemented by Apple Music (the public iTunes catalog, so no account is needed; a miss on artist + title retries with the artist alone, since iTunes matches combined terms poorly), Spotify (signed in), Bandcamp (its public search API, albums only), Local Files (the user's own library, `localFiles:searchAlbums` / `localFiles:getAlbumTracks`) and Subsonic (`search3`, `getAlbum`). Amazon Music does not implement it yet: its search and lookups replay the GraphQL request Amazon's own page fires, and the album search and album page requests have not been captured from a live session.

### Settings

`settings.requiresAuth` (boolean), `settings.authType` (`none`, `apikey`, `oauth`, `token`, `username`, `userpass` or `musickit` in the shipped plugins) and `settings.configurable`, a map of field key to `{ type, label, description?, default?, options? }`. Field types in use: `text`, `password`, `select` and `dynamic-select`. A `dynamic-select` gets its options from the plugin's `listModels(config)`, shows `fallbackOptions` until that succeeds, and with `allowCustom: true` renders a free-text input with suggestions (see Dynamic Model Selection above).

### Implementation functions

Each entry in `implementation` is materialized with `new Function('return ' + src)()` in the renderer, then bound so `this` is the resolver object (a `resolve` can call `this.search(...)`). Consequences:

- **Plugins are not sandboxed.** The code runs in the renderer with the same privileges as the app's own renderer code: `fetch`, `window` (including `window.electron.*` bridges such as `proxyFetch`), the DOM, and globals the app sets up. Install only plugins you trust.
- **Each function is isolated from the others.** There is no shared module scope, so a helper used by two functions must be defined inside each.
- Implementation keys that collide with resolver fields (`id`, `name`, `capabilities`, `config`, `__proto__` and similar) are skipped with a warning.

Common signatures, taken from the shipped plugins: `search(query, config)` returns an array of tracks; `resolve(artist, track, album, config)` returns one track or `null`; `play(track, config)` returns a truthy value on success (falsy makes `handlePlay` try the next source); `init(config)` and `cleanup()` run on load and unload. A track carries `id`, `title`, `artist`, `album`, `duration` (seconds), `sources: ['<resolverId>']`, the resolver's own identifier (`spotifyId`, `bandcampUrl`, `youtubeId`, `soundcloudId`, `appleMusicId`, ...) and any cross-cutting metadata such as `isrc` (see "Resolver Result Shape" in [playback.md](playback.md)). Meta-services implement the functions their capability names: `generate(prompt, config, listeningContext)`, `chat(messages, tools, config)`, `listModels(config)`, `searchArtistEvents(artistName, config)` and `searchArtist(artistName, config)`.

Practical rules: return `[]` or `null` instead of throwing on a miss; check a service's minimum query length before calling it; respect the service's rate limits (content resolvers other than Apple Music, Spotify and local files are wrapped by the shared resolver limiter automatically); and log enough to debug a failure.

### Where plugins load from, and installing one

At startup the main process (`resolvers-load-builtin`) reads the app's own `plugins/` directory (inside the ASAR in a packaged build) and `~/.parachord/plugins/` (marketplace downloads and user installs), keeping the newer version of each id and preferring the shipped copy on a tie. The renderer also carries a `FALLBACK_RESOLVERS` copy of every bundled plugin in `src/renderer/app.js` for when that load fails or misses one. The "Add from file" button in Settings → Plug-Ins installs an `.axe` from a file (`resolvers-pick-file` then `resolvers-install`, which writes it into `~/.parachord/plugins/`) and hot-loads it without a restart; the marketplace installs and updates plugins the same way. To contribute a plugin to everyone, add it to [Parachord/parachord-plugins](https://github.com/Parachord/parachord-plugins).
