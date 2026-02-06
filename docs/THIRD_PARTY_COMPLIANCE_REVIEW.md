# Third-Party Compliance Review

**Date:** 2026-02-05
**Scope:** All third-party service integrations in Parachord

## Executive Summary

Parachord integrates with approximately 20 third-party services spanning music streaming, metadata, AI, and chart aggregation. After reviewing each integration against available terms of service, **several areas of concern** were identified. The issues range from likely TOS violations (ad-skipping, web scraping) to security practices that need improvement (hardcoded credentials, private keys in source).

---

## Compliance Status by Service

### LIKELY TOS VIOLATIONS

#### 1. YouTube — Ad Skipping (HIGH RISK)

**Issue:** The browser extension (`parachord-extension/content.js`, lines ~130-358) implements automatic YouTube ad detection and skipping. It:
- Monitors for `ad-showing` / `ad-interrupting` CSS classes
- Programmatically clicks skip buttons using multiple selector patterns
- Uses MutationObserver for real-time DOM monitoring
- Detects post-roll ads and sends "ended" events to bypass them

**Why this is a problem:** YouTube's Terms of Service (Section 5.B) prohibit circumventing ads:
> "You shall not...circumvent, disable, fraudulently engage with, or otherwise interfere with any part of the Service (or attempt to do any of these things), including...advertisements."

**Risk Level:** HIGH — This is one of the clearest TOS violations. Ad-skipping extensions have been the subject of enforcement actions by Google.

**Recommendation:** Remove the automatic ad-skipping functionality. If users want ad-free YouTube, they should subscribe to YouTube Premium.

---

#### 2. Bandcamp — Search Scraping (MEDIUM RISK)

**Issue:** While most of the Bandcamp integration is compliant, the **search function** scrapes Bandcamp's website:
- **Search scraping** (Bandcamp resolver in `app.js`): Fetches raw HTML from `bandcamp.com/search`, parses with DOMParser, extracts `.searchresult` elements
- **CORS bypass** (`main.js`, `proxy-fetch` IPC handler): Uses Electron's main process to make these requests
- **User-Agent spoofing**: Search requests use a browser-like UA string to disguise their origin

**What's compliant:**
- **Playback** goes through Bandcamp's actual website in the user's browser (`shell.openExternal()`), preserving ads and purchase flows
- **Browser extension DOM reading** (`scrapeBandcampTracks()` in `content.js`) reads pages the user is already viewing — standard browser extension behavior, same as screen readers, password managers, etc.
- **Purchase links** are prominently surfaced, actively supporting Bandcamp's business model

**Why the search scraping is a concern:** Bandcamp's Terms of Use (Section 3) state:
> "You agree not to...use any robot, spider, scraper, or other automated means to access the Site for any purpose without our express written permission."

The search function makes automated HTTP requests with a spoofed User-Agent, which falls under this prohibition. However, this is limited to user-initiated searches, returns metadata that drives traffic to Bandcamp, and does not crawl or harvest data at scale.

**Risk Level:** MEDIUM — The search scraping technically violates TOS, but the overall integration is supportive of Bandcamp's model. The volume is low and user-initiated.

**Recommendation:** Replace the search HTML scraping with Bandcamp's oEmbed endpoint or embedded player iframes for a fully compliant integration.

---

#### 3. Spotify — Hardcoded Client Secret (RESOLVED)

**Issue:** A Spotify Client Secret was previously hardcoded in source code and used as a fallback credential.

**Resolution:** Migrated to the PKCE (Proof Key for Code Exchange) authorization flow. The client secret has been removed entirely — only the Client ID is needed (which is safe to expose publicly). The PKCE flow uses a one-time cryptographic `code_verifier`/`code_challenge` pair generated at runtime, eliminating the need for a shared secret. The Client Secret input field has also been removed from the Settings UI.

---

### MODERATE CONCERNS

#### 4. Qobuz — Shared Demo App ID (MEDIUM RISK)

**Issue:** The Qobuz integration uses a hardcoded "public demo" App ID (`285473059`) in `app.js`.

**Why this is a concern:** Demo/development credentials are typically intended for testing, not production distribution. Using a shared demo ID in a distributed application may violate Qobuz's developer terms and could be rate-limited or revoked without notice.

**Risk Level:** MEDIUM — Limited to search and 30-second previews, so the functional impact is lower, but it's still an unauthorized use of development credentials.

**Recommendation:** Apply for a proper Qobuz API key for production use, or remove the integration until one is obtained.

---

#### 5. SoundCloud — Deprecated API (MEDIUM RISK)

**Issue:** The SoundCloud integration uses the official OAuth 2.0 API, but SoundCloud deprecated their public API and stopped accepting new app registrations. The documentation (`docs/setup/API_CREDENTIALS_SETUP.md`, line ~135) acknowledges this.

**Why this is a concern:** While existing credentials may still work, using a deprecated API means:
- It could stop working at any time without notice
- There is no support or recourse if issues arise
- Continued use may not align with SoundCloud's current terms

**Risk Level:** MEDIUM — Not an active violation, but relying on a deprecated service is fragile.

**Recommendation:** Add prominent user-facing warnings about SoundCloud's deprecated status. Consider the integration experimental/unsupported.

---

#### 6. Apple Music — Private Key in Repository (MEDIUM RISK)

**Issue:** A real EC256 private key is committed at `resources/keys/AuthKey_437JVHZMMK.p8`. This key is used to sign MusicKit developer tokens (JWTs).

**Why this is a concern:**
- Apple's Developer Program License Agreement requires protecting signing keys
- Anyone with access to the repo can generate valid MusicKit tokens for this developer account
- This is a security vulnerability, not just a TOS issue

**Risk Level:** MEDIUM — The key should be rotated immediately and removed from version control.

**Recommendation:** (1) Rotate the key in the Apple Developer portal. (2) Remove it from the repository and add to `.gitignore`. (3) Use environment variables or a secrets manager for key material. (4) Consider using `git filter-branch` or BFG Repo-Cleaner to remove it from git history.

---

#### 7. Spotify — Unnecessary OAuth Scopes (RESOLVED)

**Issue:** The OAuth flow previously requested `user-read-private` and `user-read-email` scopes, but neither was used in the codebase.

**Resolution:** Removed `user-read-private` and `user-read-email` from the requested scopes. Only scopes actually used by the app are now requested.

---

### LOW RISK / COMPLIANT

#### 8. Spotify — Playback via Spotify Connect (COMPLIANT)

Playback uses the official Spotify Connect API to control existing Spotify clients. No audio is extracted or cached locally. This is the intended use case for Spotify Connect and is compliant with their terms.

#### 9. Last.fm — Scrobbling (COMPLIANT)

The Last.fm integration (`scrobblers/lastfm-scrobbler.js`) follows the official API correctly:
- Proper MD5 signature generation on all requests
- Standard OAuth flow for user authorization
- Correct use of `track.scrobble` and `track.updateNowPlaying` endpoints
- Session-based authentication (no raw credential storage)

#### 10. ListenBrainz — Scrobbling (COMPLIANT)

Uses the official API with proper Bearer token authentication. ListenBrainz is an open-source project that encourages third-party integrations.

#### 11. Libre.fm — Scrobbling (COMPLIANT)

Uses the Last.fm-compatible API as documented. Libre.fm is open-source and welcomes third-party clients.

#### 12. MusicBrainz / Cover Art Archive (COMPLIANT)

Uses the official API with proper `User-Agent` header (`Parachord/1.0`) as required by MusicBrainz's rate-limiting policy. Respects the ~1 request/second guideline.

#### 13. Wikipedia / Wikidata (COMPLIANT)

Uses public APIs as documented. No authentication required. These are open data projects that support third-party access.

#### 14. Discogs (COMPLIANT)

Uses the official public API. Optional authentication for higher rate limits.

#### 15. Apple Music RSS Charts (COMPLIANT)

Uses Apple's public RSS feed generator API (`rss.applemarketingtools.com`). This is a public service intended for third-party use.

#### 16. iTunes Search API (COMPLIANT)

Public API, no authentication required. The implementation includes appropriate rate limiting (500ms delays).

#### 17. AI Plugins — OpenAI, Google Gemini, Anthropic, Ollama (COMPLIANT)

All AI integrations use official APIs with user-provided API keys. No credentials are hardcoded. Users bring their own keys and are subject to their own API agreements.

#### 18. GitHub (COMPLIANT)

Standard use for version control, releases, and plugin distribution.

#### 19. Pitchfork — Browser Extension Scraping (LOW RISK)

The browser extension can scrape Pitchfork review pages, but this is limited to the user's own browser session and behaves similarly to a bookmarklet. Lower risk than server-side scraping.

---

## Summary Table

| Service | Status | Risk | Primary Issue |
|---------|--------|------|---------------|
| YouTube | **VIOLATION** | High | Automatic ad skipping |
| Bandcamp (search) | **CONCERN** | Medium | Search scraping + UA spoofing |
| Spotify (credentials) | **RESOLVED** | — | Migrated to PKCE; secret removed |
| Qobuz | **CONCERN** | Medium | Shared demo App ID in production |
| SoundCloud | **CONCERN** | Medium | Using deprecated API |
| Apple Music (key) | **CONCERN** | Medium | Private key committed to repo |
| Spotify (scopes) | **RESOLVED** | — | Unnecessary scopes removed |
| Spotify (playback) | Compliant | — | — |
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

---

## Recommended Priority Actions

1. ~~**Immediate:** Remove the YouTube ad-skipping code from the browser extension~~ **DONE**
2. **Immediate:** Rotate and remove the Apple MusicKit `.p8` private key from the repository
3. ~~**Immediate:** Remove the hardcoded Spotify client secret; migrate to PKCE flow~~ **DONE**
4. **Short-term:** Replace Bandcamp search scraping with oEmbed or embedded player approach
5. **Short-term:** Obtain a proper Qobuz production App ID or remove the integration
6. ~~**Short-term:** Remove unnecessary Spotify OAuth scopes (`user-read-private`, `user-read-email`)~~ **DONE**
7. **Ongoing:** Add deprecation warnings for SoundCloud integration
