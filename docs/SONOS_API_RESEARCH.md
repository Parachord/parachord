# Sonos API Research for Third-Party Integration

## Overview

This document summarizes available Sonos APIs and SDKs that allow third-party applications to control Sonos systems, evaluated for potential integration with Parachord.

## 1. Official Sonos Cloud Control API

The primary supported integration path. A JSON-over-HTTPS protocol routed through Sonos's cloud.

- **Base URL**: `api.ws.sonos.com/control/api/v1`
- **Protocol**: HTTPS with JSON request/response bodies
- **Authentication**: OAuth 2.0 bearer tokens
- **Developer Portal**: https://developer.sonos.com/reference/control-api/
- **Documentation**: https://docs.sonos.com/docs/control
- **Sample App**: https://github.com/sonos/api-web-sample-app

### Capabilities

| Feature | Commands |
|---|---|
| **Playback** | `play`, `pause`, `seek`, `seekRelative`, `skipToNextTrack`, `skipToPreviousTrack`, `setPlayModes`, `getPlaybackStatus` |
| **Sessions** | `createSession`, `joinOrCreateSession`, `loadCloudQueue`, `loadStreamUrl`, `loadLineIn` |
| **Volume** | Per-group and per-player volume control, fixed-volume and pass-through modes |
| **Groups** | Discover and manage player groupings within a household |
| **Favorites** | Fetch and play Sonos favorites |
| **Cloud Queue** | Host your own queue server that feeds tracks to Sonos players |
| **Events** | Real-time state change subscriptions (playback, volume, groups) via webhooks; subscriptions last 3 days |

### Authentication Flow

1. Register as a developer and obtain client credentials
2. User authorizes your integration via OAuth to control their household
3. Include `Authorization: Bearer {token}` header with all API requests
4. No longer need `X-Sonos-API-Key` header (token is sufficient)

### Hierarchy Model

- **Account** → can have multiple **Households**
- **Household** → contains multiple **Players** (permanent IDs tied to MAC address)
- **Group** → ephemeral grouping of players for synchronized playback
- **Session** → ephemeral playback session on a group

### Limitations

- **Cannot browse/search music services** — only plays Sonos Favorites or content from your own cloud queue
- **Cloud-dependent** — requires internet connectivity with higher latency than local control
- **Rate limits** — must include `User-Agent` header; responds with HTTP 429 when throttled
- **Cloud queue infrastructure** — playing arbitrary audio requires hosting a cloud queue server that Sonos players pull tracks from

### Error Codes

| Code | Meaning |
|---|---|
| 400 | Bad request |
| 401 | Unauthorized (invalid/expired token) |
| 403 | Forbidden |
| 404 | Resource not found |
| 429 | Rate limited |
| 499 | Client closed request |

## 2. Unofficial Local UPnP/SOAP API

Every Sonos speaker exposes UPnP services on the local network. This is what Sonos's own apps historically used internally.

- **Discovery**: SSDP on UDP port 1900
- **Control**: SOAP/XML over HTTP on port 1400
- **Specifications**: MediaServer:4 and MediaRenderer:3 (Open Connectivity Foundation)

### Capabilities

Approximately 200 individual APIs exposed via UPnP services, including:

- Full transport control (play, pause, seek, queue management)
- Music library browsing and search
- Alarm management
- Speaker configuration
- Zone/group management
- Audio input selection

### Community Libraries

| Library | Language | URL |
|---|---|---|
| node-sonos-http-api | Node.js | https://github.com/jishi/node-sonos-http-api |
| sonos-controller | Java | https://github.com/vmichalak/sonos-controller |
| sonos-api-docs | Multi (generators) | https://github.com/svrooij/sonos-api-docs |
| Sonos API Reference | Documentation | https://sonos.svrooij.io/ |

### Limitations

- **Completely unofficial** — never documented by Sonos, unsupported
- **Being gradually deprecated** — Sonos is removing UPnP functionality in S2 firmware updates
- **No encryption** — all traffic is plaintext on the LAN
- **LAN-only** — no remote control capability

## 3. Future: Local HTTP API (Restricted)

Sonos is developing a local HTTP-based API as a UPnP replacement, but it is currently restricted to certified **"Works with Sonos"** partners only. Not available to general third-party developers.

## Comparison

| Aspect | Cloud Control API | Local UPnP/SOAP |
|---|---|---|
| **Officially supported** | Yes | No |
| **Network requirement** | Internet | LAN only |
| **Protocol** | HTTPS/JSON | SOAP/XML over HTTP |
| **Latency** | Higher (cloud round-trip) | Low (direct) |
| **Functionality** | Limited | Comprehensive (~200 APIs) |
| **Music browsing** | No (favorites + cloud queue only) | Yes |
| **Long-term stability** | Stable | Being deprecated |
| **Encryption** | TLS | None |

## Integration Considerations for Parachord

### Current State

Parachord has no existing Sonos integration. Existing audio output paths include:
- Spotify Connect (remote playback routing to Spotify devices)
- Browser/embedded playback (Bandcamp, YouTube, SoundCloud)
- Local file playback
- Planned AirPlay support (iOS)

### Recommended Approach

**Cloud Control API** is the viable officially-supported path, but comes with significant constraints:

1. **Cloud Queue Server Required**: To play arbitrary audio (not just Sonos favorites), Parachord would need to host a cloud queue server. Sonos players pull tracks from this server, and it continues serving even after the controlling app disconnects.

2. **Content Service Integration**: Full content browsing requires integrating as a Sonos content service partner, which has additional certification requirements.

3. **Spotify on Sonos**: Since Parachord already integrates with Spotify, and Sonos has its own native Spotify integration, the practical benefit of a Sonos integration may be limited to non-Spotify sources (local files, Bandcamp, SoundCloud, YouTube).

### Architecture Sketch

```
┌──────────────┐     OAuth 2.0      ┌─────────────────┐
│  Parachord   │◄──────────────────►│  Sonos Cloud     │
│  Client      │   Control API      │  (api.ws.sonos)  │
└──────┬───────┘                    └────────┬─────────┘
       │                                     │
       │  Manage queue                       │ Forward commands
       ▼                                     ▼
┌──────────────┐     Pull tracks     ┌──────────────────┐
│  Parachord   │◄───────────────────│  Sonos Players    │
│  Cloud Queue │    (HTTP GET)       │  (in household)   │
│  Server      │                    └──────────────────┘
└──────────────┘
```

### Open Questions

- Is the cloud queue infrastructure cost/complexity justified for the use case?
- Would Sonos's native Spotify/Apple Music integrations make direct Parachord-to-Sonos control redundant for most users?
- Should we monitor the restricted local HTTP API for eventual public availability?
- Is the UPnP path worth pursuing despite deprecation risk for a quick prototype?
