# Web sessions: the generic web-session host

> Host machinery for the #1356 split: a plugin (Amazon Music first) owns every piece of service knowledge, and each host supplies the same small set of generic primitives for driving a cookie-session web service through capture-and-replay. **Rollout status:** `main-process/web-session.js` (the host module) is landed and unit-tested; the IPC bridge (`window.electron.webSession.*`) and the move of Amazon's flows from `amazon-web-player.js` onto it follow in later stages, so today the module is not yet in any live path — `amazon-web-player.js` still is. Every rule below is already what that file learned the hard way; the module is the generalization, and the tests (`tests/main-process/web-session.test.js`) pin the contract before anything depends on it.

## The primitives

One `createWebSessionHost(config)` instance per session (Amazon's config: `id: 'amazon-music'`, `partition: 'persist:amazon-music'`, `cookieDomains: ['amazon.com']`, the Amazon preload, a hardened UA; see the module header for every field):

| Primitive | Does |
|---|---|
| `setHost(win)` | The app window that hosts the hidden view; when it closes, the view dies |
| `load(url, { timeoutMs, capture })` → `{ finalUrl, captures? }` | A budgeted page navigation in the persistent hidden session, serialized per session, with the requests the page fired captured for the caller (bodies paired with headers by request id) |
| `pageFetch(request)` → `{ status, text }` \| `{ error }` | A fetch from inside the page world — its origin, cookies, CORS — parallel-safe; never throws, every failure is a recoverable `{ error }` |
| `fetch(request)` → `{ status, headers, text }` | A request outside the page carrying the session's cookie jar; **the host owns the Cookie header** — the caller's is dropped, and a cookie value never crosses this boundary in either direction |
| `state()` → `{ url, signInUrl, cookieNames }` | The facts a plugin composes its signed-in/wall verdicts from — the hidden view's URL, the sign-in window's, and cookie NAMES (empty values dropped) |
| `signIn(url, { decide })` → `{ signedIn }` | A visible window (no preload — it must behave like a normal browser window) ticked once a second; `decide({ url, cookieNames, stableTicks })` is the plugin's pure verdict; the person closing it first is NOT signed in |
| `clear()` | Sign out: views die, the sign-in window closes, the partition's storage clears (the declared `cookieDomains` are the portable contract; Electron clears the whole partition, a superset) |

What stays in the host and must never leak into a plugin: the view and its capture hook, the cookie store (values especially), the player, the per-session limits, the quality-to-track-selection policy. What lives in the plugin and must never leak into this module: every service name, URL, wall predicate, GraphQL shape and parsing rule — **this file must never grow a service name**.

## The concurrency contract

The primitive signatures don't show the half that makes them safe; these rules are the contract, pinned by the tests (each is "rule N" in the module header and the test suite):

1. **Loads serialize.** `webRequest` has a single listener slot per method per session, so two page loads must never interleave captures. Every `load` runs on an internal chain. A plugin wanting flow-level serialization (a multi-step import) serializes itself.
2. **A navigation waits out in-flight pageFetches.** Tearing a frame mid-fetch kills a replay: pageFetch is a reader, `load` and the idle park are writers on a readers/writer gate. A pageFetch arriving while a navigation holds the gate resolves `{ error: 'busy' }` — the caller falls back to its page flow.
3. **The idle park never blanks a busy view.** A page fetch needs an origin page world (`about:blank` is a null origin: no cookies, no CORS), so the view stays warm `warmMs` after the last activity and parks then (an idle SPA otherwise runs at full speed forever). The fuse re-arms at fire time while any load/pageFetch is in flight. Known residual: a plugin flow's gaps BETWEEN host calls (pure parsing) don't hold the view — keep inter-call gaps well under `warmMs` or accept the re-mint.
4. **Captures flag our own traffic.** The capture listener is session-wide, so a pageFetch racing a load's capture window shows up in that load's captures. Any capture observed while a pageFetch was in flight is flagged `echo: true`; the plugin's matchers use that to skip template re-mints and degrade fast-fail graces (the #1152 class: an echoed replay once poisoned a template and left the search breaker open for a day).
5. **The capture window is quiet-bounded.** `load` returns its captures when the page's request burst goes quiet (`quietMs` with no new captured request after the load finishes), never later than `budgetMs`. The host cannot know which request matters — the matcher is plugin-side, pure, over the returned captures — so it must not stop early on a match it can't see.

Error convention: `load` throws `Error`s with `.reason` (`'load-failed'`, `'not-ready'`, `'invalid'`) — the same shape `amazon-web-player`'s flows throw today; `pageFetch` never throws.

## The rest of the #1356 plan

From the issue (and its review): the IPC bridge with sender gating and per-resolver session namespacing; the renderer-mediated DRM direction (the engine passes the whole track to the plugin's `getPlaybackManifest`, and `reason`/`licenseDenied`/`denialReason`/`plan` error fields are contract); a generic plugin-status surface feeding `src/renderer/lib/playback-limits.js`; then the flow-by-flow move of Amazon's logic from `amazon-web-player.js`/`amazon-dmls.js` into `plugins-src/amazonmusic/` against `this.lib` (the `_lib` prerequisite, landed in `resolver-loader.js`), retargeting `tests/resolver/amazon-*.test.js` as each flow moves. `getUrlType`'s per-service arms in `resolver-loader.js` should become manifest data along the way. The scope boundary: the web player as a *data source* (these primitives) — not the web player as a *player* (Bandcamp's embed control, SoundCloud's widget RPC stay on the per-adapter embed-player path).
