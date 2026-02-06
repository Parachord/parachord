# Parachord Security & Code Quality Review

**Date:** 2026-02-06
**Scope:** Full codebase review of Parachord v0.6.0-alpha.1
**Reviewer:** Automated deep review (Claude Opus 4.6)

---

## Executive Summary

This review covers the entire Parachord codebase: Electron main process, preload bridge, plugin/resolver system, local files module, browser extension, scrobblers, sync providers, and AI chat services. The review identified **7 critical**, **15 high**, **18 medium**, and **25+ low** severity findings across security, code quality, and architecture concerns.

The most pressing systemic issue is **arbitrary code execution via the plugin system** -- `.axe` resolver files contain executable JavaScript strings that are run via `new Function()` with no sandboxing, giving any installed plugin full access to the renderer process, stored credentials, and IPC bridge. This is compounded by the browser extension using the same pattern to inject code into active browser tabs over an unauthenticated WebSocket.

---

## Table of Contents

1. [Critical Findings](#1-critical-findings)
2. [High Severity Findings](#2-high-severity-findings)
3. [Medium Severity Findings](#3-medium-severity-findings)
4. [Low Severity Findings](#4-low-severity-findings)
5. [Architectural Concerns](#5-architectural-concerns)
6. [Recommendations](#6-recommendations)

---

## 1. Critical Findings

### C1. Arbitrary Code Execution via Plugin System (`new Function()`)

**File:** `resolver-loader.js:85`

```js
const fn = new Function('return ' + fnString)();
```

The `.axe` plugin format stores executable JavaScript as strings in the `implementation` object. These are parsed and executed via `new Function()`, which is equivalent to `eval()`. Any installed plugin gains full access to:
- The `window.electron` IPC bridge (store read/write, proxyFetch, shell commands)
- All application state in the DOM
- All stored credentials (Spotify tokens, Last.fm session keys, API keys)
- The ability to exfiltrate data via `window.electron.proxyFetch()`

**Impact:** A malicious `.axe` file installed from the marketplace, file picker, or URL can steal all user credentials and control the application.

### C2. Remote Code Injection in Browser Extension

**File:** `parachord-extension/background.js:134-160`

The extension accepts `injectCode` messages from a WebSocket and uses `new Function()` to construct executable functions from string payloads, then injects them into active browser tabs via `chrome.scripting.executeScript`. While Manifest V3's default CSP currently blocks `new Function()` in the extension's isolated world, the architectural intent is dangerous -- any CSP relaxation or execution world change would enable full cross-site scripting in the user's browser.

### C3. Unauthenticated, Unencrypted WebSocket C2 Channel

**File:** `parachord-extension/background.js:4`, `main.js:773`

```js
const PARACHORD_WS_URL = 'ws://127.0.0.1:9876';
```

The entire command channel between the desktop app and browser extension uses plain `ws://` with **no authentication**. Any local process can:
- Connect to port 9876 and send commands
- Impersonate the desktop app to the browser extension
- Combined with C2, inject code into the user's browser tabs

This is also vulnerable to DNS rebinding attacks where a malicious webpage redirects WebSocket connections to `127.0.0.1:9876`.

### C4. Open Proxy (`proxy-fetch`) with No URL Restrictions

**File:** `main.js:2581-2638`

The `proxy-fetch` IPC handler fetches arbitrary URLs from the main process with a spoofed User-Agent and no URL validation. It accepts any URL (including `file://`, internal network addresses, cloud metadata endpoints like `http://169.254.169.254/`). Any code in the renderer (including malicious plugins via C1) can use this as an SSRF proxy.

### C5. Unrestricted `store-get` / `store-set` IPC Handlers

**File:** `main.js:1857-1869`

```js
ipcMain.handle('store-get', (event, key) => store.get(key));
ipcMain.handle('store-set', (event, key, value) => { store.set(key, value); });
```

The electron-store is fully readable and writable from the renderer via IPC with no key restrictions. This means any code in the renderer (including malicious plugins) can read `spotify_token`, `spotify_refresh_token`, `soundcloud_client_secret`, all scrobbler session keys, and any other stored credential. It can also overwrite any configuration.

### C6. `debug-store` Handler Dumps All Stored Data

**File:** `main.js:2193-2198`

```js
ipcMain.handle('debug-store', () => {
  const allData = store.store;
  return allData;
});
```

This handler returns the entire electron-store contents (all tokens, refresh tokens, API keys, user settings) to the renderer. It is exposed via `window.electron.store.debug()` in the preload bridge and has no access control.

### C7. Generic `invoke` Passthrough in Preload Bridge

**File:** `preload.js:422`

```js
invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args)
```

The preload bridge exposes a generic `invoke` function that can call **any** IPC channel with arbitrary arguments. This completely bypasses the purpose of the structured API exposed via `contextBridge`, allowing any renderer code to invoke any handler registered with `ipcMain.handle()`.

---

## 2. High Severity Findings

### H1. Path Traversal in Plugin Installation

**File:** `main.js:2870-2871`

The `filename` parameter in the `resolvers-install` handler is passed directly to `path.join()` without sanitization. A filename like `../../.bashrc` would write outside the plugins directory.

### H2. Path Traversal via `manifest.id` in Marketplace Downloads

**File:** `main.js:3334`

```js
const filename = `${axe.manifest.id}.axe`;
```

The `manifest.id` from attacker-controlled JSON is used as a filename without validating it contains no path separators.

### H3. No Path Validation on `local-audio://` Protocol Handler

**File:** `main.js:1177-1250`

The `local-audio://` protocol handler serves any file on the filesystem. The file path is extracted from the URL via `decodeURIComponent()` with no validation that the path is within a watched music folder. Any renderer code can read arbitrary files.

### H4. `saveId3Tags` Writes to Any File on Disk

**File:** `local-files/index.js:216-228`

The only check is `fs.existsSync(filePath)`. There is no validation that the file resides within a watched folder. Any MP3/audio file the process can write to can have its metadata overwritten.

### H5. No Path Validation on `addWatchFolder`

**File:** `local-files/index.js:59`

No validation on the folder path. It's not checked for being an absolute path, being within allowed boundaries, or path canonicalization. An attacker who can call this (via IPC) could register `/etc` or `/` as a watch folder.

### H6. SSRF via `downloadImage` in Local Files Module

**File:** `local-files/index.js:325-357`

The `downloadImage` method accepts any URL from `tags.albumArtUrl` and makes an HTTP(S) request with no URL validation, no redirect depth limit, and no response size limit. This is exploitable for SSRF against internal network services.

### H7. SSRF via Unvalidated Pagination URLs in Sync Providers

**Files:** `sync-providers/spotify.js:62,96-99`, `sync-providers/applemusic.js:29,60-67`

The `spotifyFetch` and `appleMusicFetch` functions follow `data.next` URLs from API responses without validating the hostname. A compromised or MITM'd API response could redirect the bearer token to an attacker-controlled server.

### H8. All Scrobbler Internals Exposed on `window` Object

**File:** `scrobbler-loader.js:825-840`

Eleven identifiers including singleton instances, class constructors, and the scrobble manager are attached to `window`, making API keys, session keys, and user tokens accessible to any code in the renderer.

### H9. Prototype Pollution via Plugin Implementation Spread

**File:** `resolver-loader.js:125`

The `implFunctions` object from `.axe` files is spread directly into the resolver object. Keys like `__proto__`, `constructor`, `id`, `name`, or `config` would overwrite resolver metadata or pollute Object.prototype.

### H10. No Input Validation on `.axe` Plugin Content

**File:** `resolver-loader.js:16-51`

Only `manifest.id` existence is checked. No validation of: ID format, implementation field types, URL pattern count/format, maximum file size, or structure integrity.

### H11. File Descriptor Leak in WAV Duration Calculation

**File:** `local-files/metadata-reader.js:66-125`

A file descriptor opened at line 66 is not closed in the `catch` block at line 123. Sustained scanning of malformed WAV files could exhaust the process's file descriptor limit.

### H12. Hardcoded Fallback API Keys in Source Code

**File:** `main.js:1649-1652`

```js
const FALLBACK_LASTFM_API_KEY = '3b09ef20686c217dbd8e2e8e5da1ec7a';
const FALLBACK_LASTFM_API_SECRET = '37d8a3d50b2aa55124df13256b7ec929';
const FALLBACK_SPOTIFY_CLIENT_ID = 'c040c0ee133344b282e6342198bcbeea';
```

API keys and secrets are hardcoded in source. While the Spotify client ID is safe to expose with PKCE, the Last.fm API secret should not be in source code as it's used for request signing.

### H13. `webviewTag: true` in BrowserWindow Configuration

**File:** `main.js:592`

```js
webviewTag: true  // Enable webview support for embedded players
```

Enabling the `<webview>` tag in Electron is a known security risk. Webviews can load arbitrary web content with elevated privileges if not carefully constrained. The Electron security documentation explicitly recommends against enabling this.

### H14. XSS in OAuth Callback HTML Response

**File:** `main.js:683`

```js
<p>${error}</p>
```

The `error` query parameter from the OAuth callback is interpolated directly into HTML without escaping. A crafted callback URL with a malicious `error` parameter could execute JavaScript in the auth server's context.

### H15. Massive Code Duplication in Scrobbler System

**Files:** `scrobble-manager.js` + `scrobblers/*.js` vs `scrobbler-loader.js`

The 859-line `scrobbler-loader.js` duplicates the entire modular scrobbler system. The two copies have already diverged in behavior (auth polling, response handling). Security fixes applied to one copy may not be applied to the other.

---

## 3. Medium Severity Findings

### M1. LIKE Pattern Injection in Local Files Database

**Files:** `local-files/database.js:92-95`, `local-files/scanner.js:36-38`

Folder paths containing `%` or `_` are not escaped before use in SQL LIKE clauses. A folder path containing `%` would match all records.

### M2. Symlink Following in Directory Scanner

**File:** `local-files/scanner.js:107-118`

No symlink detection. A symlink inside a watched folder pointing to `/etc` or another sensitive directory would be followed.

### M3. Infinite Redirect Following in Image Download

**File:** `local-files/index.js:331-334`

Recursive redirect following with no depth limit. A redirect loop causes stack overflow.

### M4. No Response Size Limit in Image Download

**File:** `local-files/index.js:342-345`

No limit on response body size. A malicious server could cause OOM.

### M5. Unbounded Retry Recursion in Sync Providers

**Files:** `sync-providers/spotify.js:39-42`, `sync-providers/applemusic.js:40-43`

Rate-limit retries via recursion with no maximum count. A server consistently returning 429 causes unbounded recursion.

### M6. ReDoS Risk in Resolver URL Pattern Compilation

**File:** `resolver-loader.js:234-240`

URL patterns from `.axe` files are compiled into regex with no limit on wildcards. Crafted patterns could cause catastrophic backtracking.

### M7. Race Condition in Resolution Scheduler

**File:** `resolution-scheduler.js:438-483`

Non-awaited recursive `_processNext()` call can lead to concurrent processing loops.

### M8. Unbounded `resolved` Set (Memory Leak)

**File:** `resolution-scheduler.js:36`

The `resolved` set grows without bound and is never cleared. Long sessions accumulate tens of thousands of entries.

### M9. Prompt Injection via Track Metadata in AI Chat

**File:** `services/ai-chat.js:208-218`

Track titles, artist names, and album names are interpolated directly into the LLM system prompt without escaping.

### M10. Plaintext Credential Storage

**Files:** `scrobblers/base-scrobbler.js:17-18`, `scrobbler-loader.js:242-249`

Session keys and user tokens are stored in plaintext via electron-store, readable by any renderer code.

### M11. Excessive `tabs` Permission in Browser Extension

**File:** `parachord-extension/manifest.json:10`

The `tabs` permission grants access to URL, title, and favicon for all tabs. The `activeTab` permission already declared would suffice.

### M12. Tab Close Command Without Authorization

**File:** `parachord-extension/background.js:259-263`

Any content script can close any tab by sending a `closeTab` message with an arbitrary tab ID.

### M13. `all_frames: true` for Content Scripts

**File:** `parachord-extension/manifest.json:57,65`

Content scripts inject into all iframes including third-party content, expanding the attack surface.

### M14. No Content Security Policy in Extension Manifest

**File:** `parachord-extension/manifest.json`

No explicit CSP defined. Relies entirely on Manifest V3 defaults.

### M15. Unbounded Message Queue in Extension

**File:** `parachord-extension/background.js:14,100-103`

When the WebSocket is disconnected, messages queue with no upper bound.

### M16. Apple Music Token Parsed Without Error Handling

**Files:** `sync-providers/applemusic.js:154,169,191,232,248,279`

`JSON.parse(token)` called without try-catch or validation on every method.

### M17. Watcher Close Errors Not Handled

**File:** `local-files/watcher.js:127-130,184-188`

`watcher.close()` called without await or try-catch. Failed closures leak resources.

### M18. Multiple Unguarded `JSON.parse` Calls on API Responses

**File:** `scrobbler-loader.js:397,500,538,565,729`

`JSON.parse(response.text)` without try-catch. HTML error responses from servers cause unhandled exceptions.

---

## 4. Low Severity Findings

| # | File | Description |
|---|------|-------------|
| L1 | `main.js:14-28` | Debug logging of environment variable presence on startup |
| L2 | `local-files/index.js:183` | `file://` URL not properly encoded for special characters |
| L3 | `local-files/album-art.js:91` | No content-type validation on downloaded images |
| L4 | `local-files/album-art.js:84` | `releaseId` not URL-encoded in API URL |
| L5 | `local-files/album-art.js:87` | No timeout on fetch calls |
| L6 | `local-files/database.js:206-208` | Underscore passes through `normalize()` as LIKE wildcard |
| L7 | `local-files/scanner.js:101` | Synchronous I/O (`readdirSync`) blocks event loop in async context |
| L8 | `local-files/metadata-reader.js:146` | MD5 used for file hashing (collision risk) |
| L9 | `local-files/scanner.js:17-23` | TOCTOU race on `scanning` flag |
| L10 | `resolver-loader.js:28` | No type/format validation on resolver ID |
| L11 | `scrobbler-loader.js:90` | `nowPlayingSent` flag set regardless of success |
| L12 | `scrobbler-loader.js:699` | MD5 for password hashing (API constraint) |
| L13 | `services/ai-chat.js:96` | No message length limit in AI chat |
| L14 | `services/ai-chat.js:216-218` | Template replacement uses non-global string replace |
| L15 | `services/protocol-handler.js:16-19` | URL-decoded segments used without sanitization |
| L16 | `sync-providers/spotify.js:171` | Tautological ownership check (`id === id`) |
| L17 | `sync-providers/spotify.js:11-12` | Track ID collision risk from aggressive normalization |
| L18 | `parachord-extension/popup.js:153-158` | `innerHTML` usage (currently hardcoded, but risky pattern) |
| L19 | `parachord-extension/background.js:115-127` | Race condition on `programmaticCloseTabId` variable |
| L20 | `parachord-extension/background.js:484-502` | Heartbeat leaks full tab URL every 20 seconds |
| L21 | All extension files | Excessive console logging of operational data |
| L22 | Extension content scripts | MutationObservers on full DOM subtree without throttling |
| L23 | `scrobblers/lastfm-scrobbler.js:107,130` | API keys transmitted in URL query parameters |
| L24 | `local-files/database.js:349-354` | `db.close()` not wrapped in try-catch |
| L25 | `local-files/index.js:26` | `db.init()` failure not caught |

---

## 5. Architectural Concerns

### 5.1 Plugin Sandbox Architecture

The most fundamental security concern is the lack of any sandboxing for `.axe` plugins. The current architecture gives plugins the same privileges as the application itself. Consider:
- Running plugin code in a Web Worker with a restricted API surface
- Using a sandboxed iframe with a restrictive CSP
- Running plugins in a separate Electron process with limited IPC
- Requiring cryptographic signatures on plugins from the marketplace

### 5.2 Credential Isolation

All credentials (OAuth tokens, API keys, session keys) are stored in the same electron-store with no encryption and no access isolation. A compromised renderer has access to everything. Consider:
- Encrypting sensitive values at rest using `safeStorage` from Electron
- Moving credential management to the main process with restricted IPC APIs
- Removing the generic `store-get`/`store-set` handlers and the `debug-store` handler

### 5.3 Browser Extension Communication

The WebSocket channel between the app and extension has no security properties. Consider:
- Using `wss://` with a self-signed certificate generated at first run
- Implementing a shared-secret authentication scheme
- Using native messaging instead of WebSocket (eliminates DNS rebinding risk)

### 5.4 Monolith Frontend

The entire React application is a single 47,000-line `app.js` file with no build step. This makes security auditing extremely difficult and increases the risk of XSS from inline HTML construction.

---

## 6. Recommendations

### Immediate (Critical/High)

1. **Sandbox plugin execution** -- Replace `new Function()` with a Web Worker or sandboxed iframe
2. **Remove generic `invoke` passthrough** from preload.js (line 422)
3. **Remove `debug-store` handler** or gate it behind a developer mode flag
4. **Add URL validation to `proxy-fetch`** -- restrict to known API domains or at minimum block RFC 1918 addresses
5. **Add path validation to `local-audio://` protocol** -- verify paths are within watched folders
6. **Sanitize plugin `filename` and `manifest.id`** -- strip path separators, validate format
7. **HTML-escape the `error` parameter** in OAuth callback responses
8. **Remove `webviewTag: true`** unless actively needed; use `<iframe>` or `BrowserView` instead
9. **Restrict `store-get`/`store-set`** to a whitelist of allowed keys, or remove them and use specific handlers

### Short-term (Medium)

10. **Switch WebSocket to native messaging** for the browser extension
11. **Encrypt credentials at rest** using Electron's `safeStorage` API
12. **Add redirect depth limits** and response size limits to all HTTP clients
13. **Fix LIKE pattern injection** by escaping `%` and `_` in folder paths
14. **Add symlink detection** in the directory scanner
15. **Add retry limits** to recursive API calls in sync providers
16. **Validate pagination URLs** against expected hostnames before following them
17. **Remove or consolidate `scrobbler-loader.js`** to eliminate the duplicated codebase

### Longer-term (Architecture)

18. **Introduce a build step** for the frontend (bundler, minifier, CSP enforcement)
19. **Break up `app.js`** into modular components for auditability
20. **Implement a capability-based permission system** for plugins
21. **Add automated security scanning** (SAST) to the CI pipeline
22. **Remove globals** from `window` -- use module imports or a controlled dependency injection pattern
