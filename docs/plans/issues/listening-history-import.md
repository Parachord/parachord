# Feature: Import Lifetime Listening History from GDPR Data Exports

## Summary

Add support for importing full lifetime listening history from Spotify and Apple Music GDPR/privacy data exports. Both services expose lifetime play history only through manual data dumps — not their REST APIs — making this the only way to access complete listening data.

## Motivation

- Spotify's Web API and Apple's MusicKit API only expose **recent** play history (limited, deduplicated)
- Both services provide **lifetime** play history through their GDPR data export portals
- Use cases: scrobbling backfill, recommendation seeding, listening stats/analytics, migration between services

## Data Sources

### Spotify Extended Streaming History

- Requested manually at Account > Privacy Settings > "Extended streaming history"
- Takes up to 30 days to prepare
- JSON files with rich fields:
  - `spotify_track_uri` (proper track identifier)
  - `ts` (ISO 8601 timestamp)
  - `ms_played`, `reason_start`, `reason_end`
  - `shuffle`, `skipped`, `offline`
  - `master_metadata_track_name`, `master_metadata_album_artist_name`, `master_metadata_album_album_name`

### Apple Music Privacy Export

- Requested manually at privacy.apple.com > "Apple Media Services Information"
- Takes up to 7 days to prepare
- Key file: `Apple Music Play Activity.csv` (~45 columns)
  - Full lifetime play history with timestamps
  - **No dedicated artist column** — must parse from "Item Description"
  - Lower data quality than Spotify's export
- Secondary file: `Apple Music - Play History Daily Tracks.csv` (daily aggregation)

## Proposed Approach

1. **File upload UI** — Let users drag-and-drop or select their exported ZIP/JSON/CSV files
2. **Parser per service** — Separate parsers for Spotify JSON and Apple Music CSV formats
3. **Deduplication** — Handle repeated plays, partial plays (ms_played thresholds)
4. **Storage** — Store listening history in a local database (separate from library sync)
5. **Display** — Stats dashboard, timeline view, top artists/tracks/albums

## Out of Scope (for initial implementation)

- Automated triggering of GDPR exports (not possible — manual only)
- YouTube Music listening history (no equivalent export known yet)
- Write-back / scrobbling to external services (Last.fm, etc.)

## Related

- Design doc: `docs/plans/2026-03-04-youtube-music-sync-design.md` (Appendix A & B)
- Existing sync providers: `sync-providers/spotify.js`, `sync-providers/applemusic.js`

## Labels

`enhancement`, `listening-history`, `data-import`
