# Configurable OAuth / Local-Server Port (parachord#958)

**Goal:** Let a user change the local server port (default **8888**) so Parachord can run when 8888 collides with another app, without breaking any existing install.

**Status:** Design accepted. Not yet implemented. Placement + apply-mode decided (see Decisions).

**Issue:** [parachord#958](https://github.com/Parachord/parachord/issues/958) — "8888 is an incredibly generic port."

---

## Problem / root cause

A single Express server (`main.js:1057`, `expressApp.listen(8888, '127.0.0.1', …)`) serves **both**:

- OAuth redirect callbacks — Spotify (`/callback`) and SoundCloud (`/callback/soundcloud`)
- the `parachord://` HTTP bridge (`/protocol`) used by the Raycast extension and curl-style integrations

The port is hardcoded in the listener, in four redirect-URI sites, in five settings-UI copy-paste strings, and across docs. There is **no** way to change it. `AUTH_SERVER_PORT` exists in `.env.example` but is **never read**.

## Load-bearing constraints (why auto-picking a port is wrong)

Researched against current (2026) provider docs — high confidence, cited below.

1. **Spotify requires the redirect URI to match exactly, including the port.** The only carve-out is registering a *port-less* loopback literal (`http://127.0.0.1/callback`) and appending the live port per authorization request. It does **not** blanket-accept "any port on 127.0.0.1."
   - <https://developer.spotify.com/documentation/web-api/concepts/redirect_uri>: *"The definition of the redirect URI must exactly match the redirect URI you provide when you create your app. The only exception is for loopback IP literals, which can dynamically be assigned ports."*
   - `localhost` is rejected; use literal `127.0.0.1` / `[::1]`. `http://` is allowed for loopback; https required elsewhere. (Rules auto-enforced for apps since 2025-04-09; migration deadline 2025-11-27 — live as of 2026.)
   - Multiple redirect URIs per app **are** supported; no documented cap.
2. **SoundCloud requires exact match with NO loopback/port carve-out**, and steers desktop apps to a custom URI scheme. Multi-URI support is undocumented — treat as one fixed URI per app.
   - <https://developers.soundcloud.com/docs/api/guide>: *"YOUR_REDIRECT_URI: Must match the URI used in the authorization request exactly."*
3. **Client-ID model:** Spotify is **bring-your-own** (each user registers their own app + controls their redirect URI). SoundCloud is **hybrid** — a bundled **Parachord-owned** client ID registered at `:8888`, which the user *cannot* re-point; users may optionally supply their own SoundCloud creds.

**Conclusion:** An ephemeral/auto-scanned port produces a redirect URI the provider hasn't allow-listed → silent `INVALID_CLIENT` / redirect-mismatch. The only viable design is a **user-chosen fixed port** (default 8888) that the user also registers.

## Decision

- **One source of truth.** New persisted setting `oauth_callback_port` (electron-store, default 8888), read once at startup by a `getAuthPort()` helper. Precedence: **stored value → `AUTH_SERVER_PORT` env → 8888**. Clamp to 1024–65535; also reject **9876** (the embed-WebSocket port) to avoid a self-inflicted collision. Fall back to 8888 on invalid input.
- **Placement:** in the **resolver settings** section, applied to all resolver OAuth callbacks (Spotify, SoundCloud, future providers). Helper text notes the same port also drives the `parachord://` HTTP bridge.
- **Apply mode:** **restart to apply** (simplest; avoids tearing down a listener mid-OAuth). Live-rebind deferred.
- **Default users are byte-identical to today** — key unset → 8888 → same listener, same URIs, same external contract. No token invalidation, no re-registration. Feature is inert until explicitly changed.

### Rejected alternatives

| Approach | Why rejected |
|---|---|
| Ephemeral `listen(0)` + Spotify port-less registration | Breaks SoundCloud entirely (no carve-out); breaks the fixed `/protocol` bridge contract; still forces every existing user to re-register a port-less URI. |
| Auto-scan free port on EADDRINUSE | Silently changed port → unregistered redirect URI → silent provider rejection. User must consciously choose the port to register it. |
| Split servers (bridge fixed on 8888, OAuth movable) | Doesn't solve #958 — the collision is with the *whole* 8888 listener. Adds a second server/port/EADDRINUSE path for a speculative population. YAGNI. |
| Configurable **bind address** / bind `[::1]` too | Security footgun (risk of 0.0.0.0). Listener stays IPv4-loopback only; Spotify accepts the 127.0.0.1 literal. |

## Code changes

**`main.js`**

| Site | Change |
|---|---|
| module scope (~L926) | Add `getAuthPort()` (store → `AUTH_SERVER_PORT` env → 8888; clamp 1024–65535; reject 9876) and `getRedirectUri(path)` → `` `http://127.0.0.1:${getAuthPort()}${path}` ``. Single source of truth. |
| `startAuthServer()` L1057 | `expressApp.listen(getAuthPort(), '127.0.0.1', …)` (stays IPv4-loopback). Add `.on('error')` → on `EADDRINUSE`, `safeSendToRenderer('auth-server-error', { code, port })`; else log. |
| Spotify token exchange L1454 & auth handler L3236 | `getRedirectUri('/callback')` at **both** — authorize-request and token-exchange URIs must be byte-identical or Spotify rejects. |
| SoundCloud L1523 & L3375 | **Conditional:** use `getRedirectUri('/callback/soundcloud')` **only when the effective SoundCloud creds are user-provided**; when using the bundled/env-default client, **pin to `:8888`** (that client's registration is fixed and user-uneditable). Gate on `getSoundCloudCredentials()` source. |
| `ALLOWED_STORE_KEYS` L2867–2891 | Add `'oauth_callback_port'` (reuse the generic store-get/set IPC — no new store handler). |
| new IPC | `ipcMain.handle('auth-server-get-port', () => getAuthPort())` so the renderer displays the **actually-bound** port (not just-saved state) until restart. |

**`preload.js`** — add `authServer: { getPort, onError }` bridge (port readback + `auth-server-error` listener).

**`app.js`**

| Site | Change |
|---|---|
| settings state + mount effect (mirror theme_preference load ~L7485) | `authPort` state; load via `store.get('oauth_callback_port')`; save handler validates + persists + shows "restart to apply" notice. Display the **bound** port via `auth-server-get-port` until restart to avoid staleness. |
| Spotify help text L36871-2; Spotify `<code>` blocks L58252-61; Spotify inputs+copy L58295-343 | Interpolate `authPort` into all display + `clipboard.writeText` strings. Label the `[::1]` variant an **optional** allow-list entry (listener is IPv4-only) — `127.0.0.1` is the one that must be registered. |
| SoundCloud input+copy L58842-57 | Interpolate `authPort`; add note: a custom port works **only** with your own SoundCloud credentials registered to this exact URI — the default SoundCloud login requires 8888. |
| new resolver-settings control | Numeric port field (default 8888, validated), **Reset to 8888** button, restart notice, and an `auth-server-error` listener → persistent toast "Port {N} is in use — change it in Settings" with a jump-to-setting action. |

**Docs / config / external**

- `.env.example` — make `AUTH_SERVER_PORT` the real fallback; either remove the standalone `SPOTIFY_REDIRECT_URI` override or document it must agree with the port. Do **not** silently drop it (CI/dev may rely on it) — feed its port into `getAuthPort()` or warn when set-but-ignored.
- `docs/protocol-schema.md` (~11 hardcoded 8888 sites incl. the `PARACHORD_HTTP_PORT` const + `/protocol` contract), `docs/setup/API_CREDENTIALS_SETUP.md` (~5 sites), `docs/development/DEBUGGING.md` — enumerate each, note "default 8888, configurable in Settings." Fix the pre-existing "localhost:8888" prose (nothing binds localhost).
- `raycast-extension/src/utils.ts:3` (`PARACHORD_HTTP_PORT = 8888`) is an **in-repo** consumer — add a Raycast preference to override, or explicitly document custom-port + Raycast as unsupported.
- Future `docs/plans/2026-03-04-youtube-music-sync-design.md` Google OAuth must use `getRedirectUri('/callback/google')`, not hardcode 8888.

**Out of scope:** the 9876 embed-WebSocket server (separate server + contract — parachord-button/smart-links) is unrelated to the 8888 collision.

## Security

IPv4-loopback bind only (never 0.0.0.0, address not configurable). Port clamped 1024–65535 and 9876 excluded → no privileged-port bind, no self-collision. Store whitelist grows by one scalar. EADDRINUSE payload carries no secrets. Bridge SSRF/`redirect:error` protections unchanged (only the port moves).

## Tests

- `getAuthPort()` — clamping (non-integer, <1024, >65535, ==9876) + precedence (stored > env > 8888).
- Redirect-URI **parity** test — L1454 and L3236 produce byte-identical strings (guards against future drift).
- EADDRINUSE path fires the `auth-server-error` IPC.

## Risks / honest caveats

- Changing the port requires the user to re-register the redirect URI in **their** Spotify dashboard (BYO app). The UI shows the exact URI; one-time step. Failure to do so is a **deferred** break — existing refresh tokens keep working until the next full re-auth, then fail with no obvious cause. *(Optional mitigation: store `last_successful_auth_port`; if it differs from current, the auth-error handler can name the likely-unregistered URI.)*
- SoundCloud on a custom port needs the user's own creds (bundled client is pinned to 8888).
- Custom-port + Raycast/curl integrations need manual re-point; default-8888 keeps the majority working.
- `AUTH_SERVER_PORT` becomes live — a dev who set it expecting a no-op will bind that port on upgrade; the settings field must reflect the effective (env-derived) port so it's visible.

## Provenance

Design produced by a research → design → adversarial-review workflow (5 fact-finders, branch-aware design, 2 independent reviewers, both **SOUND_WITH_FIXES**; the SoundCloud-pinning fix and doc/test/staleness items above are the folded-in review corrections).
