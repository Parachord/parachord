# Web sessions: the generic web-session host

> Host machinery for the #1356 split: a plugin (Amazon Music first) owns every piece of service knowledge, and each host supplies the same small set of generic primitives for driving a cookie-session web service through capture-and-replay. **Rollout status:** the one-owner step and the IPC bridge are done — `amazon-web-player.js`'s machinery (the hidden view, the capture, the page-world fetch, the load chain, the gate, the idle-park fuse, the sign-in window, sign-out) runs on ONE `createWebSessionHost` instance it owns at module scope, and that instance is exposed to the renderer through the bridge (`window.electron.webSession.*`, see "The IPC bridge" below); the flows still live in `amazon-web-player.js` and compose the host's primitives. The flow-by-flow move of that logic into `plugins-src/amazonmusic/` follows in later stages. Every rule below is already what that file learned the hard way; the module is the generalization, and the tests (`tests/main-process/web-session.test.js`, `tests/main-process/web-session-bridge.test.js`) pin the contract before anything depends on it.

## The primitives

One `createWebSessionHost(config)` instance per session (Amazon's config: `id: 'amazon-music'`, `partition: 'persist:amazon-music'`, `cookieDomains: ['amazon.com']`, the Amazon preload, a hardened UA; see the module header for every field):

| Primitive | Does |
|---|---|
| `setHost(win)` | The app window that hosts the hidden view; when it closes, the view dies |
| `load(url, { timeoutMs, capture })` → `{ finalUrl, captures? }` | A budgeted page navigation in the persistent hidden session, serialized per session, with the requests the page fired captured for the caller (bodies paired with headers by request id) |
| `pageFetch(request)` → `{ status, text }` \| `{ error }` | A fetch from inside the page world — its origin, cookies, CORS — parallel-safe; never throws, every failure is a recoverable `{ error }` |
| `fetch(request)` → `{ status, headers, text }` | A request outside the page carrying the session's cookie jar; **Chromium owns the jar** (`useSessionCookies: true` — request cookies attach on every hop including redirects, response cookies save/delete/reject by browser rules, and the host never parses `Set-Cookie`); the caller's own Cookie header is dropped and the returned headers carry set-cookie **names** only; budgeted like every other wait (default `loadTimeoutMs`), and the request aborts when the budget fires |
| `state()` → `{ url, signInUrl, cookieNames }` | The facts a plugin composes its signed-in/wall verdicts from — the hidden view's URL, the sign-in window's, and cookie NAMES (empty values dropped) |
| `signIn(url, { decide })` → `{ signedIn }` | A visible window (no preload — it must behave like a normal browser window) ticked once a second; `decide({ url, cookieNames, stableTicks })` is the plugin's pure verdict; the person closing it first is NOT signed in |
| `clear()` | Sign out: views die, the sign-in window closes, the partition's storage clears (the declared `cookieDomains` are the portable contract; Electron clears the whole partition, a superset), and the load chain — both lanes — is cut: a new account starts clean |

What stays in the host and must never leak into a plugin: the view and its capture hook, the cookie store (values especially), the player, the per-session limits, the quality-to-track-selection policy. What lives in the plugin and must never leak into this module: every service name, URL, wall predicate, GraphQL shape and parsing rule — **this file must never grow a service name**. (`chromeUserAgent` lived here as a deliberate copy of `amazon-web-player.js`'s until the move; the move deleted the Amazon copy — `amazon-web-player.js` imports it from this module.)

## The move: one owner of the partition

During the flow-by-flow move, `amazon-web-player.js`'s own machinery and a host instance would BOTH run on `persist:amazon-music`: they would share the partition's single `webRequest` listener slot while each keeping its own view, chain and gate — so rules 1 and 2 would not hold *between* the two modules, and either one's capture could silently replace the other's listener. (The permission handlers are guarded by a one-time flag on the session and only one allowlist would apply — harmless while both allow only `fullscreen`.)

**The order that avoided this, now done:** the first consumer step moved `amazon-web-player.js`'s view, chain, capture, gate, fuse, sign-in window and sign-out onto ONE `createWebSessionHost` instance (`webSession`, module scope in `amazon-web-player.js`) — before any flow logic moved. From then on the slot has exactly one owner, and the flow logic (which URL loads, which request to capture and how to patch and parse it) stays in `amazon-web-player.js`, composed over the host's primitives, moving over one flow at a time later.

## The concurrency contract

The primitive signatures don't show the half that makes them safe; these rules are the contract, pinned by the tests (each is "rule N" in the module header and the test suite):

1. **Loads serialize.** `webRequest` has a single listener slot per method per session, so two page loads must never interleave captures. Every `load` runs on an internal chain — `enqueue(fn, { lane })`, the host's job queue in two lanes (#1423's semantics): a FOREGROUND job (something the user is waiting on, by the plugin's judgment) starts before every queued BACKGROUND job, FIFO within a lane, the one running job never interrupted; `clear()` resets both lanes. A plugin wanting flow-level serialization (a multi-step import) serializes itself.
2. **A navigation waits out in-flight pageFetches.** Tearing a frame mid-fetch kills a replay: pageFetch is a reader, `load` and the idle park are writers on a readers/writer gate. A pageFetch arriving while a navigation holds the gate resolves `{ error: 'busy' }` — the caller falls back to its page flow.
3. **The idle park never blanks a busy view.** A page fetch needs an origin page world (`about:blank` is a null origin: no cookies, no CORS), so the view stays warm `warmMs` after the last activity and parks then (an idle SPA otherwise runs at full speed forever). The fuse re-arms at fire time while any load/pageFetch is in flight. Known residual: a plugin flow's gaps BETWEEN host calls (pure parsing) don't hold the view — keep inter-call gaps well under `warmMs` or accept the re-mint.
4. **Captures flag our own traffic.** The capture listener is session-wide, so a pageFetch racing a load's capture window shows up in that load's captures. Any capture observed while a pageFetch was in flight is flagged `echo: true`; the plugin's matchers use that to skip template re-mints and degrade fast-fail graces (the #1152 class: an echoed replay once poisoned a template and left the search breaker open for a day).
5. **The capture window is quiet-bounded.** `load` returns its captures when the page's request burst goes quiet (`quietMs` with no new captured request after the load finishes), never later than `budgetMs`. The host cannot know which request matters — the matcher is plugin-side, pure, over the returned captures — so it must not stop early on a match it can't see.

Error convention: `load` throws `Error`s with `.reason` (`'load-failed'`, `'not-ready'`, `'invalid'`, `'superseded'` — a `clear()` superseded the load, and its captures belong to the old account) — the same shape `amazon-web-player`'s flows throw today; `pageFetch` never throws. One exception: a navigation aborted by a client redirect or by the view being destroyed rejects with Chromium's raw error (`ERR_ABORTED`), which carries no `.reason` — the same thing `amazon-web-player`'s `loadURLBudgeted` propagates today; callers treat it as a failed load.

## The IPC bridge

`main-process/ipc/web-session-bridge.js` exposes registered host instances to the renderer as `window.electron.webSession.*` (the thin wrappers live in `preload.js`). Every call names its session by the id its host registered under — Amazon's is `amazon-music`; the plugin owns the knowledge of which session it drives. `registerWebSession(id, host)` is main.js's seam: Amazon's ONE `webSession` instance registers there **by reference** (never re-created — a second instance would fight for the partition's single webRequest slot, see "The move" above), and main.js stays thin.

Channels (`ipcMain.handle`), all gated like the widevine bridge — only the main window's top frame may call (`isAllowedSender`, literally the same predicate main.js passes both bridges) — with the same honest note the widevine bridge carries: that is sender gating, NOT plugin isolation.

| Channel | Invoke payload | Resolves |
|---|---|---|
| `webSession:load` | `{id, url, opts}` | `{success: true, finalUrl, captures?}` |
| `webSession:pageFetch` | `{id, request}` | `{success: true, status, text}` or `{success: true, error}` |
| `webSession:fetch` | `{id, request}` | `{success: true, status, headers, text}` |
| `webSession:state` | `{id}` | `{success: true, url, signInUrl, cookieNames}` |
| `webSession:clear` | `{id}` | `{success: true}` or `{success: false, reason: 'clear-failed', error}` |
| `webSession:signIn` | `{id, url, window?}` | `{success: true, callId}` — settles via the settled event below |
| `webSession:sign-in-decide` | `{callId, verdict}` | `{success: true}` |

Error contract, same as the widevine bridge: handlers resolve `{success: false, reason, error}` — never throw over IPC — and a host throw's `.reason` crosses verbatim (`'load-failed'`, `'not-ready'`, `'invalid'`, `'superseded'`). Unknown session id → `reason: 'not-ready'`. `pageFetch` never throws (the host's contract), so its channel outcomes are always `{success: true, ...outcome}` — a caller distinguishes a response (`status` present) from a recoverable miss (`error: 'busy' | 'no-origin-page' | …`) by the error key.

**URL scoping.** `webSession:fetch` and `webSession:pageFetch` reject with `reason: 'invalid'` any request whose URL host is not under the session's registered `cookieDomains` (the host carries them — the bridge reads them off the host, so the list cannot drift from what the jar actually scopes). The jar already scopes cookies to those domains, so a session-bearing fetcher for any other host would be a generic proxy surface with nothing to do with the session. `load` and `signIn` take any URL: the plugin navigates its own service's pages, and a sign-in flow may legitimately live on an identity host the cookie domains don't cover.

**The signIn protocol.** The plugin's `decide()` verdict cannot cross IPC as a function, so the bridge runs the host's ticker with its OWN decide() and shuttles the verdict across:

1. `signIn(id, url, {decide, window})` (the preload wrapper) invokes `webSession:signIn`; the channel answers `{success: true, callId}` immediately and the host opens the window.
2. Every host tick is forwarded to the main window as `webSession:sign-in-tick` `{callId, url, cookieNames, stableTicks}`.
3. The wrapper runs the plugin's `decide(tick)` — the host's tick shape (`{url, cookieNames, stableTicks}`; the callId is the protocol's routing key, stripped before the call — the plugin's decide is the same pure verdict it would hand the host) — and invokes `webSession:sign-in-decide` `{callId, verdict}` (a throwing decide is ignored — verdict false — exactly what the host does with one).
4. The bridge's decide() answers the host with the LATCHED verdict — the latest renderer answer per callId, true when any joined call says true — so a true verdict lands on the NEXT tick, up to one `signInTickMs` (1s) later than a host-side decide would have settled. That one-tick latency is the price of reusing the host's ticker unduplicated: the bridge never runs its own interval, so it can never double-tick or drift from the host's trace logging.
5. When the host promise settles (a true verdict closes the window; the person closing it first is NOT signed in), every callId gets `webSession:sign-in-settled` `{callId, signedIn, error?}`, and the wrapper's promise resolves `{success: true, signedIn}`. A refused invoke (unknown session, gated sender) resolves `{success: false, reason, error}` instead — the wrapper's promise always settles.

Two signIn calls for the same session JOIN, exactly like the host's own join: one window, one ticker, one `host.signIn` call — the bridge mints a `callId` per invoke and mirrors them onto the same run, so no second window opens and no second interval runs. Both callIds receive every tick, and both settle together. A joined call's `url`/`window` are ignored — the open window's flow is the one that runs.

Nothing calls the bridge yet — the Amazon plugin starts when its flows move. The hostBridges declaration a plugin uses to require the bridge (`requires.hostBridges`, `window.__parachordHostBridges`) is #1355's per-platform loading rule; see "Minimum app version" / "Required host bridges" in [plugins.md](plugins.md).

## The rest of the #1356 plan

**Done:** the IPC bridge with sender gating and per-session namespacing, with `fetch`/`pageFetch` URLs limited at the bridge to the session's `cookieDomains` (`main-process/ipc/web-session-bridge.js` — which keeps the contract simple: the jar already scopes cookies, nothing else needs a session-bearing fetcher for other hosts), and the #1355 hostBridges machinery (`requires.hostBridges` in plugin manifests, `window.__parachordHostBridges` advertised by the preload, the hide rule in plugin-compat.js + the renderer's plugin loading — no shipped plugin declares a requirement yet; the Amazon plugin starts when its flows move).

Still ahead, from the issue (and its reviews): the renderer-mediated DRM direction (the engine passes the whole track to the plugin's `getPlaybackManifest`, and `reason`/`licenseDenied`/`denialReason`/`plan` error fields are contract); a generic plugin-status surface feeding `src/renderer/lib/playback-limits.js`; then the flow-by-flow move of Amazon's logic from `amazon-web-player.js`/`amazon-dmls.js` into `plugins-src/amazonmusic/` against `this.lib` (the `_lib` prerequisite, #1402), following the one-owner order above, retargeting `tests/resolver/amazon-*.test.js` as each flow moves. `getUrlType`'s per-service arms in `resolver-loader.js` should become manifest data along the way. The scope boundary: the web player as a *data source* (these primitives) — not the web player as a *player* (Bandcamp's embed control, SoundCloud's widget RPC stay on the per-adapter embed-player path).
