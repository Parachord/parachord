# Third-Party Compliance Review

**Date:** 2026-02-25 (updated from 2026-02-05)
**Scope:** All third-party service integrations in Parachord

## Executive Summary

Parachord integrates with approximately 20 third-party services spanning music streaming, metadata, AI, and chart aggregation. Since the initial review on 2026-02-05, significant progress has been made on the highest-priority compliance and security issues. The YouTube ad-skipping code has been removed, the Apple MusicKit private key has been removed from the repository and added to `.gitignore`, the Spotify client secret was replaced with PKCE, unnecessary OAuth scopes were removed, and the browser extension's communication channel was migrated from an unauthenticated WebSocket to Chrome native messaging with IPC sockets. A comprehensive privacy policy has also been added.

**Remaining concerns** are limited to Bandcamp search scraping, Qobuz's shared demo App ID, and SoundCloud's deprecated API status.

---

## Changes Since Last Review (2026-02-05)

| Change | Date | Impact |
|--------|------|--------|
| YouTube ad-skipping code removed from browser extension | Pre-2026-02-05 | Resolved HIGH RISK TOS violation |
| Apple MusicKit `.p8` private key removed; `.gitignore` rule added | Post-2026-02-05 | Resolved MEDIUM RISK security issue |
| Browser extension migrated from WebSocket C2 to Chrome native messaging | 2026-02-25 | Resolved critical security vulnerability (DNS rebinding, unauthenticated access) |
| Privacy policy added covering desktop app and browser extension | 2026-02-25 | New compliance artifact for Chrome Web Store submission |
| Browser extension packaged for Chrome Web Store submission | 2026-02-25 | Distribution channel change |
| Spotify resolver enhanced with URL lookup (tracks, albums, playlists) | 2026-02-25 | Uses existing compliant Spotify API |
| Smart Links enrichment added using iTunes, Spotify, YouTube APIs | Post-2026-02-05 | Uses already-documented, compliant APIs |

---

## Compliance Status by Service

### RESOLVED ISSUES

#### 1. YouTube — Ad Skipping (RESOLVED)

**Previous Issue:** The browser extension (`parachord-extension/content.js`) implemented automatic YouTube ad detection and skipping, including monitoring for `ad-showing` / `ad-interrupting` CSS classes, programmatically clicking skip buttons, and using MutationObserver for real-time DOM monitoring.

**Resolution:** All ad-skipping code has been removed from the browser extension. The current `content.js` contains only legitimate functionality: media playback control (play, pause, ended events), Bandcamp playlist scraping, and SPA navigation detection. No ad-detection or ad-circumvention code remains in the codebase.

---

#### 2. Spotify — Hardcoded Client Secret (RESOLVED)

**Previous Issue:** A Spotify Client Secret was previously hardcoded in source code and used as a fallback credential.

**Resolution:** Migrated to the PKCE (Proof Key for Code Exchange) authorization flow. The client secret has been removed entirely — only the Client ID is needed (which is safe to expose publicly). The PKCE flow uses a one-time cryptographic `code_verifier`/`code_challenge` pair generated at runtime, eliminating the need for a shared secret. The Client Secret input field has also been removed from the Settings UI.

---

#### 3. Spotify — Unnecessary OAuth Scopes (RESOLVED)

**Previous Issue:** The OAuth flow previously requested `user-read-private` and `user-read-email` scopes, but neither was used in the codebase.

**Resolution:** Removed `user-read-private` and `user-read-email` from the requested scopes. Only scopes actually used by the app are now requested.

---

#### 4. Apple Music — Private Key in Repository (RESOLVED)

**Previous Issue:** A real EC256 private key was committed at `resources/keys/AuthKey_437JVHZMMK.p8`, used to sign MusicKit developer tokens (JWTs).

**Resolution:** The private key file has been removed from the repository. The `resources/keys/` directory now contains only a `.gitkeep` placeholder. A `.gitignore` rule (`resources/keys/*.p8`) prevents accidental re-commits of key material. The key should still be rotated in the Apple Developer portal if it hasn't been already, and BFG Repo-Cleaner should be used to scrub it from git history before the repository is made public.

---

#### 5. Browser Extension — WebSocket C2 Channel (RESOLVED)

**Previous Issue:** The browser extension communicated with the desktop app via an unauthenticated WebSocket on `ws://127.0.0.1:9876`, which was flagged as a critical security vulnerability (DNS rebinding, no authentication, no encryption).

**Resolution:** The browser extension now uses Chrome native messaging (`chrome.runtime.connectNative`) with an IPC socket relay:
- **Host process:** `native-messaging/host.js` bridges Chrome's stdin/stdout protocol to a local IPC socket
- **IPC transport:** Unix domain socket (`~/.parachord/native-messaging.sock`) on Linux/macOS, named pipe (`\\.\pipe\parachord-native-messaging`) on Windows
- **Security properties:** Process-based isolation (only Chrome can launch the host), OS-level socket permissions, structured length-prefixed binary protocol
- **Eliminates:** DNS rebinding risk, network-accessible attack surface

**Note:** The WebSocket server on port 9876 still exists but is now used exclusively for embedded player communication (external websites connecting to control playback), not for browser extension C2. The code explicitly documents this distinction.

---

### REMAINING CONCERNS

#### 6. Bandcamp — Search Scraping (MEDIUM RISK)

**Issue:** The Bandcamp search function in `plugins/bandcamp.axe` scrapes Bandcamp's website:
- Fetches raw HTML from `https://bandcamp.com/search`, parses with DOMParser, extracts `.searchresult` elements
- Uses Electron's `proxy-fetch` IPC handler to bypass CORS
- Includes User-Agent spoofing with a browser-like UA string

**What's compliant:**
- **Playback** goes through Bandcamp's actual website in the user's browser (`shell.openExternal()`), preserving ads and purchase flows
- **Browser extension DOM reading** (`scrapeBandcampTracks()` in `content.js`) reads pages the user is already viewing — standard browser extension behavior
- **Purchase links** are prominently surfaced, actively supporting Bandcamp's business model

**Why the search scraping is a concern:** Bandcamp's Terms of Use (Section 3) state:
> "You agree not to...use any robot, spider, scraper, or other automated means to access the Site for any purpose without our express written permission."

**Risk Level:** MEDIUM — The search scraping technically violates TOS, but the overall integration is supportive of Bandcamp's model. The volume is low and user-initiated.

**Recommendation:** Replace the search HTML scraping with Bandcamp's oEmbed endpoint or embedded player iframes for a fully compliant integration.

---

#### 7. Qobuz — Shared Demo App ID (MEDIUM RISK)

**Issue:** The Qobuz integration uses a hardcoded "public demo" App ID (`285473059`) in `app.js`.

**Why this is a concern:** Demo/development credentials are typically intended for testing, not production distribution. Using a shared demo ID in a distributed application may violate Qobuz's developer terms and could be rate-limited or revoked without notice.

**Risk Level:** MEDIUM — Limited to search and 30-second previews, so the functional impact is lower, but it's still an unauthorized use of development credentials.

**Recommendation:** Apply for a proper Qobuz API key for production use, or remove the integration until one is obtained.

---

#### 8. SoundCloud — Deprecated API (MEDIUM RISK)

**Issue:** The SoundCloud integration uses the official OAuth 2.0 API, but SoundCloud deprecated their public API and stopped accepting new app registrations. The documentation (`docs/setup/API_CREDENTIALS_SETUP.md`, line ~135) acknowledges this.

**Why this is a concern:** While existing credentials may still work, using a deprecated API means:
- It could stop working at any time without notice
- There is no support or recourse if issues arise
- Continued use may not align with SoundCloud's current terms

**Status Update:** No user-facing deprecation warnings have been added to the Settings UI yet, as was recommended in the prior review.

**Risk Level:** MEDIUM — Not an active violation, but relying on a deprecated service is fragile.

**Recommendation:** Add prominent user-facing warnings about SoundCloud's deprecated status in the Settings UI. Consider the integration experimental/unsupported.

---

### LOW RISK / COMPLIANT

#### 9. Spotify — Playback via Spotify Connect (COMPLIANT)

Playback uses the official Spotify Connect API to control existing Spotify clients. No audio is extracted or cached locally. This is the intended use case for Spotify Connect and is compliant with their terms.

#### 10. Spotify — URL Lookup (COMPLIANT)

The Spotify resolver now supports URL lookups for tracks, albums, and playlists via the official Web API (`/v1/tracks/`, `/v1/albums/`, `/v1/playlists/`). This uses proper OAuth tokens and is standard API usage.

#### 11. Last.fm — Scrobbling (COMPLIANT)

The Last.fm integration (`scrobblers/lastfm-scrobbler.js`) follows the official API correctly:
- Proper MD5 signature generation on all requests
- Standard OAuth flow for user authorization
- Correct use of `track.scrobble` and `track.updateNowPlaying` endpoints
- Session-based authentication (no raw credential storage)

#### 12. ListenBrainz — Scrobbling (COMPLIANT)

Uses the official API with proper Bearer token authentication. ListenBrainz is an open-source project that encourages third-party integrations.

#### 13. Libre.fm — Scrobbling (COMPLIANT)

Uses the Last.fm-compatible API as documented. Libre.fm is open-source and welcomes third-party clients.

#### 14. MusicBrainz / Cover Art Archive (COMPLIANT)

Uses the official API with proper `User-Agent` header (`Parachord/1.0`) as required by MusicBrainz's rate-limiting policy. Respects the ~1 request/second guideline.

#### 15. Wikipedia / Wikidata (COMPLIANT)

Uses public APIs as documented. No authentication required. These are open data projects that support third-party access.

#### 16. Discogs (COMPLIANT)

Uses the official public API. Optional authentication for higher rate limits.

#### 17. Apple Music RSS Charts (COMPLIANT)

Uses Apple's public RSS feed generator API (`rss.applemarketingtools.com`). This is a public service intended for third-party use.

#### 18. iTunes Search API (COMPLIANT)

Public API, no authentication required. The implementation includes appropriate rate limiting (500ms delays).

#### 19. AI Plugins — OpenAI, Google Gemini, Anthropic, Ollama (COMPLIANT)

All AI integrations use official APIs with user-provided API keys. No credentials are hardcoded. Users bring their own keys and are subject to their own API agreements.

#### 20. GitHub (COMPLIANT)

Standard use for version control, releases, and plugin distribution.

#### 21. Pitchfork — Browser Extension Scraping (LOW RISK)

The browser extension can scrape Pitchfork review pages, but this is limited to the user's own browser session and behaves similarly to a bookmarklet. Lower risk than server-side scraping.

#### 22. Cloudflare — Smart Links (COMPLIANT)

Smart Links (`go.parachord.com`) are hosted on Cloudflare Workers with KV storage. Server-side enrichment uses existing compliant APIs (iTunes Search, Spotify Client Credentials, YouTube) to fill in missing service URLs for shared links. This is standard Cloudflare platform usage.

---

## Summary Table

| Service | Status | Risk | Primary Issue |
|---------|--------|------|---------------|
| YouTube | **RESOLVED** | — | Ad-skipping code removed |
| Bandcamp (search) | **CONCERN** | Medium | Search scraping + UA spoofing |
| Spotify (credentials) | **RESOLVED** | — | Migrated to PKCE; secret removed |
| Spotify (scopes) | **RESOLVED** | — | Unnecessary scopes removed |
| Apple Music (key) | **RESOLVED** | — | Key removed; `.gitignore` added |
| Extension C2 channel | **RESOLVED** | — | Migrated to native messaging |
| Qobuz | **CONCERN** | Medium | Shared demo App ID in production |
| SoundCloud | **CONCERN** | Medium | Using deprecated API; no UI warning |
| Spotify (playback) | Compliant | — | — |
| Spotify (URL lookup) | Compliant | — | — |
| Last.fm | Compliant | — | — |
| ListenBrainz | Compliant | — | — |
| Libre.fm | Compliant | — | — |
| MusicBrainz | Compliant | — | — |
| Wikipedia/Wikidata | Compliant | — | — |
| Discogs | Compliant | — | — |
| Apple RSS Charts | Compliant | — | — |
| iTunes Search API | Compliant | — | — |
| AI Plugins | Compliant | — | — |
| GitHub | Compliant | — | — |
| Cloudflare (Smart Links) | Compliant | — | — |
| Pitchfork | Low Risk | Low | Browser-session scraping only |

---

## Recommended Priority Actions

1. ~~**Immediate:** Remove the YouTube ad-skipping code from the browser extension~~ **DONE**
2. ~~**Immediate:** Rotate and remove the Apple MusicKit `.p8` private key from the repository~~ **DONE** (removed + `.gitignore` rule added; verify key rotation in Apple Developer portal)
3. ~~**Immediate:** Remove the hardcoded Spotify client secret; migrate to PKCE flow~~ **DONE**
4. ~~**Short-term:** Remove unnecessary Spotify OAuth scopes (`user-read-private`, `user-read-email`)~~ **DONE**
5. **Short-term:** Replace Bandcamp search scraping with oEmbed or embedded player approach
6. **Short-term:** Obtain a proper Qobuz production App ID or remove the integration
7. **Short-term:** Add deprecation warnings for SoundCloud integration in the Settings UI
8. **Recommended:** Use BFG Repo-Cleaner to scrub the Apple `.p8` key from git history before the repository is made public
