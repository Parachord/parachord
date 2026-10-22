# MBID Mapper integration (ListenBrainz)

> Moved verbatim out of `CLAUDE.md` on 2026-10-22 so the always-loaded guide stays short; `CLAUDE.md` indexes this file. Line references such as `app.js L####` date from when each passage was written and have drifted: search for the named function instead. Cross-references to other sections point at sibling files in `docs/architecture/`.

## MBID Mapper Integration (ListenBrainz)

### Overview
We use the [ListenBrainz MBID Mapper v2.0](https://mapper.listenbrainz.org) to resolve music metadata to MusicBrainz IDs in ~4ms. This replaces or shortcuts several slow MusicBrainz API calls that are rate-limited to 1 req/sec.

### API
- **Endpoint**: `GET https://mapper.listenbrainz.org/mapping/lookup`
- **Required params**: `artist_credit_name`, `recording_name`
- **Optional params**: `release_name` (improves accuracy)
- **Response**: `{ recording_mbid, artist_credit_mbids[], release_mbid, release_name, recording_name, artist_credit_name, confidence (0-1) }`
- **Speed**: ~4ms typical response time
- **No auth required**, no documented strict rate limit
- **Docs**: https://mapper.listenbrainz.org/docs

### What It Can Do
- Map `artist + track title` → `recording_mbid`, `artist_credit_mbids[]`, `release_mbid`
- Return canonical/corrected names (useful when metadata has typos or alternate spellings)
- Confidence score (0-1) indicates match quality; ≥0.9 is a strong match

### What It Cannot Do
- **Not a search engine** — takes exact metadata, returns one result (not a list)
- **Cannot look up by album alone** — requires a recording name
- **Cannot replace discography fetches** — only maps recordings, not release-groups
- **Cannot replace open-ended search** — user queries still need MusicBrainz `/ws/2/` search endpoints

### Where We Use It
1. **handlePlay** — mapper fires in parallel with resolver searches; enriches track with `mbid`, `artistMbids`, `releaseMbid`; canonical name fallback retries resolution when all resolvers fail (confidence ≥ 0.7)
2. **Search results** — MusicBrainz `recording.id` stored as `mbid` directly; background mapper lookups warm cache for future use
3. **Album tracks** — `recording.id` and artist-credit IDs extracted from MB release data
4. **Queue additions** — background batch enrichment via `enrichTracksWithMbids()`
5. **Playlist loading** — all 3 load paths (XSPF, ListenBrainz, direct) fire background enrichment
6. **Background resolution** — mapper runs alongside resolver searches
7. **Artist page** — `getArtistMbidFromMapperCache()` shortcuts MB artist search (~0ms vs ~500ms)
8. **Fresh Drops** — mapper cache checked before rate-limited MB artist search (saves ~1100ms per hit)
9. **Scrobblers** — ListenBrainz sends `recording_mbid`, `artist_mbids`, `release_mbid` in `additional_info`; Last.fm/Libre.fm sends `mbid` parameter

### Outage fallback: labs `acr-lookup`
`mapper.listenbrainz.org` has been unreachable since 2026-09-21 (it serves a `*.musicbrainz.org` certificate that doesn't cover its own hostname, and answers 502 even with verification skipped), and was 502 for two days in June. Upstream ticket: [LB-2007](https://tickets.metabrainz.org/browse/LB-2007) (filed 2026-06-18, no reply as of 2026-10). The resolvers never used it, so playback was unaffected; what broke was MBID enrichment for ISRC-less tracks, the canonical-name retry in `handlePlay`, and ListenBrainz playlist sync. `mbid-lookup.js` (root; loaded by index.html for the renderer, `require`d by `sync-providers/listenbrainz.js`) is the one lookup both sides use: mapper first, then the labs dataset hoster's `acr-lookup` (`labs.api.listenbrainz.org/acr-lookup/json`, valid cert, CORS `*`) when the mapper can't be reached. acr-lookup returns the same identifiers (recording/artist/release MBIDs, canonical names) as a mapper-shaped result with `source: 'acr-lookup'` and a fixed `confidence` of 0.9; it is a semi-exact matcher (case/punctuation normalized, suffixes like "(Remastered)" not), so an acr miss is trusted for 6h in the renderer cache instead of 90 days, and labs calls go through a 2-concurrent / 150ms gate. `resolveRecordingMbid` returns `status: 'hit' | 'miss' | 'unreachable'`; **`unreachable` is never cached and never counted against a track** — the LB hydration guard recording it as a miss is what put every LB-synced track into the 7→30 day cooldown during the outage (main.js drops those cached misses once via `lb_mbid_hydration_misses_reset`). Mobile has the same mapper dependency and needs the same fallback.

### Cache Strategy
- **Key**: `"artist_lowercase|title_lowercase"` → `{ result, timestamp, source? }`
- **TTL**: 90 days (MBIDs are permanent identifiers); 6 hours for an `acr-lookup` miss
- **Null caching**: misses are cached too to avoid repeated lookups for unknown tracks; an `unreachable` lookup is not cached
- **Persisted**: saved/loaded via `electron.store` key `cache_mbid_mapper`
- **Helper**: `getArtistMbidFromMapperCache(artistName)` scans cache for any track by that artist

### Track MBID Fields
Tracks are enriched with these fields throughout the app:
- `track.mbid` — MusicBrainz recording ID
- `track.artistMbids` — array of MusicBrainz artist IDs
- `track.releaseMbid` — MusicBrainz release ID

### Fresh Drops Artist Limit (50 artists)
`gatherNewReleasesArtists()` caps at 50 artists per fetch, shuffled across sources (collection, library, history). This limit exists because of the MusicBrainz release-groups fetch (`GET /ws/2/release-group?artist={mbid}`), which is rate-limited at 1 req/sec regardless of mapper cache. The mapper only eliminates the *artist search* call (~1100ms each), not the release-groups call. At 50 artists with full mapper cache coverage, Fresh Drops still takes ~55s; doubling to 100 would mean ~110s. The shuffle+accumulate design covers the full library over multiple sessions while keeping each load time reasonable.

### MusicBrainz API Calls That Benefit
| Use case | Before | After (with mapper) |
|---|---|---|
| Artist MBID from track context | `/ws/2/artist?query=...` search (~500ms, rate limited) | Mapper cache hit (~0ms) or live call (~4ms) |
| Artist page initial load | Fuzzy search + validation | Direct `/ws/2/artist/{mbid}` lookup |
| Fresh Drops batch (50 artists) | 50 × 1100ms = ~55s worst case | Cache hits skip MB search entirely |
| handlePlay canonical fallback | No fallback for metadata mismatches | Mapper canonical names retry resolution |

### MusicBrainz API Calls That Don't Benefit
- Discography fetch (`/ws/2/release-group?artist={mbid}`) — still needs MB, mapper has no release-group data
- Release details (`/ws/2/release/{id}?inc=recordings`) — need full tracklist, mapper only maps single recordings
- Album art (`/ws/2/release?query=...`) — need release ID for Cover Art Archive
- Global search (artist/album/track) — open-ended queries need MB's fuzzy search, not mapper's exact lookup
