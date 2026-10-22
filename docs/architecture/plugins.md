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

### Plugin Loading Order (main.js L4270–4545)
1. Shipped plugins from app `plugins/` directory (bundled in ASAR for packaged builds)
2. Cached marketplace plugins from `~/.parachord/plugins/`
3. Version comparison: newer version always wins; same version prefers shipped over cached

### How Updates Reach Users (No New Build Required)
1. **Edit `plugins-src/<id>/implementation.js`** (or `manifest.json`) — and bump `manifest.version` in `plugins-src/<id>/manifest.json`
2. **Run `node scripts/build-axes.js`** — regenerates `plugins/<id>.axe`, the app.js `FALLBACK_RESOLVERS` line, and syncs the `marketplace-manifest.json` entry version (warns if content changed without a version bump — marketplace clients won't re-download)
3. **Push to main** — the `sync-repos.yml` CI workflow automatically syncs `.axe` files and manifest to `Parachord/parachord-plugins`
4. **User relaunches Parachord** — `syncPluginsWithMarketplace()` (app.js L993) compares cached version against marketplace manifest version; if different, downloads the new `.axe` and fires `parachord-plugins-updated` event for hot-reload

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
