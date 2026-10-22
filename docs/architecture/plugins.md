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

### Architecture
- Plugins are `.axe` files (JSON) in `plugins/` directory, each with a `manifest` (id, version, etc.) and `implementation`
- **`plugins/*.axe` are GENERATED artifacts.** The source of truth is `plugins-src/<id>/` — `manifest.json` (the .axe minus its implementation) + `implementation.js` (a real module: `module.exports = { search: fn, ... }`). `scripts/build-axes.js` regenerates the `.axe`, the matching app.js `FALLBACK_RESOLVERS` line, and the `marketplace-manifest.json` entry version from that source. **Never hand-edit `plugins/*.axe` or the FALLBACK lines** — edit `plugins-src/`, bump `manifest.version` there, run `node scripts/build-axes.js`. The jest drift guard (`tests/plugins/axes-drift.test.js`) fails any artifact drift, including a hand edit of an `.axe`. **It has a second job that is easy to miss: it is what makes a PR commit the regenerated outputs that stay tracked.** `build-axes.js` in write mode rewrites the `FALLBACK_RESOLVERS` block in `src/renderer/app.js` and the entry versions in `marketplace-manifest.json`, and both are committed files. The drift test compares them with `plugins-src/` and fails when a PR changed a plugin's source without committing them. Anything that replaces or retires the drift test (parachord#1099 untracks the `.axe` files) has to keep that guarantee, and two traps sit in the way: (1) **a check that runs after a hook has run the writer cannot fail**, because the writer has already brought those files in line with `plugins-src/`; check the committed state instead, e.g. `git diff --exit-code -- src/renderer/app.js marketplace-manifest.json` after the hooks; (2) **`build-axes.js` must run before `build-renderer.js`** in any hook that runs both, or the bundle is built from a `src/renderer/app.js` whose FALLBACK block the writer has not updated yet, and a one-shot CI `prebuild` ships it (both found in review on #1107).
- **Marketplace source**: Raw GitHub files from `Parachord/parachord-plugins` repo
- **Manifest**: `marketplace-manifest.json` in this repo — the central catalog of all plugins with version numbers (entry `version` is generator-synced; category/tags/downloadUrl/capabilities in the entry are editorial, hand-maintained)
- **Client sync**: `main.js` fetches manifest + `.axe` files from `https://raw.githubusercontent.com/Parachord/parachord-plugins/main/`

### Plugin Loading Order (main.js `resolvers-load-builtin`)
1. Shipped plugins from app `plugins/` directory (bundled in ASAR for packaged builds)
2. Cached marketplace plugins from `~/.parachord/plugins/`
3. Version comparison: newer version always wins; same version prefers shipped over cached

### How Updates Reach Users (No New Build Required)
1. **Edit `plugins-src/<id>/implementation.js`** (or `manifest.json`) — and bump `manifest.version` in `plugins-src/<id>/manifest.json`
2. **Run `node scripts/build-axes.js`** — regenerates `plugins/<id>.axe`, the app.js `FALLBACK_RESOLVERS` line, and syncs the `marketplace-manifest.json` entry version (warns if content changed without a version bump — marketplace clients won't re-download)
3. **Push to main** — the `sync-repos.yml` CI workflow automatically syncs `.axe` files and manifest to `Parachord/parachord-plugins`
4. **User relaunches Parachord** — `syncPluginsWithMarketplace()` (src/renderer/app.js) compares cached version against marketplace manifest version; if different, downloads the new `.axe` and fires `parachord-plugins-updated` event for hot-reload

### Critical: Both Files Must Be Updated
This footgun is now generator-owned: `node scripts/build-axes.js` writes the `.axe` version and the `marketplace-manifest.json` entry version from the same source manifest, and `tests/plugins/axes-drift.test.js` fails if they drift. The only manual rule that remains: bump `manifest.version` in `plugins-src/<id>/manifest.json` when the implementation changes — the writer warns when it detects content churn on an unchanged version.

### Absorbing a Reverse-Sync Community Edit
A community edit landing in `plugins/<id>.axe` (via `reverse-sync.yml`) makes the drift test fail until absorbed: `node scripts/build-axes.js --import --plugin <id>` re-imports the `.axe` into `plugins-src/<id>/` (delete the dir first to re-import) — review the resulting `plugins-src` diff, then run the writer. Never hand-edit the `.axe` to make the check pass.

### Engine-Portable (ES5) Plugins
Plugins the mobile runtime also evaluates (subsonic, bandcamp) must keep ES5-level implementation text. Flag them via `{ "es5": true }` in `plugins-src/<id>/build.json` — the writer transpiles through esbuild `--target=es5` before serializing (requires esbuild installed). Unflagged plugins may use modern syntax in `implementation.js`.

### Marketplace Sync CI (.github/workflows/sync-repos.yml)
- Triggered on push to main when `plugins/*.axe` or `marketplace-manifest.json` change
- Copies `.axe` files to `parachord-plugins` repo (does NOT delete community-contributed plugins)
- Merges manifest: updates monorepo entries, preserves community-only entries

### Reverse Sync (.github/workflows/reverse-sync.yml)
- Daily at 6 AM UTC or manual dispatch
- Pulls community contributions from `parachord-plugins` back into this repo via PR

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

A flat object of booleans. Content resolvers use `resolve`, `search`, `stream`, `browse`, `urlLookup` and `purchase` (shows a Buy button in the playbar). Meta-services use, among others, `generate` (one-shot AI playlist), `chat` (Shuffleupagus), `concerts`, `playbackTelemetry` (self-registers with `window.scrobbleManager`), `recommendations`, `metadata`, `artistImages`, `biography`, `listeningHistory` and `scrobbling`. Several of these gate loading: the renderer loads a meta-service's implementation only when it declares `generate`, `chat`, `concerts` or `playbackTelemetry` alongside the matching function, or `urlLookup` with `urlPatterns`. `mobile: false` (declared by Ollama) marks a plugin the mobile client should not offer. Check the existing `plugins-src/*/manifest.json` files before inventing a new flag; nothing reads an unknown one.

### URL patterns and lookups

`urlPatterns` is a top-level array of glob-like strings, for example `"open.spotify.com/playlist/*"`, `"*.bandcamp.com/album/*"` or `"spotify:track:*"`. The protocol and a trailing slash are ignored, a leading `*.` matches any subdomain, a middle `*` matches one path segment, a trailing `*` matches the rest of the path, and the query string is ignored unless the pattern itself contains `?` (`matchUrlPattern`). `findResolverForUrl(url)` returns the first resolver whose pattern matches.

`lookupUrl(url, config)` returns a track, `lookupAlbum(url, config)` returns `{ name, artist, albumArt, tracks, ... }`, and `lookupPlaylist(url, config)` returns `{ name, tracks, trackCount, ... }`. Each may return `null`, and callers must handle that. Note that `getUrlType(url)` (which decides whether a matched URL is a track, album, playlist or artist) is a per-host switch inside `resolver-loader.js`, not plugin data, so a new service's URLs come back `'unknown'` until that function gets an arm for its host.

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
