# Parachord Desktop - Comprehensive Test Plan

**Date:** 2026-01-18
**Version:** 1.0
**Scope:** Full application end-to-end testing
**Author:** Generated from brainstorming session

---

## Table of Contents

1. [Test Plan Overview & Objectives](#test-plan-overview--objectives)
2. [Core Search Functionality](#1-core-search-functionality)
3. [Artist & Album Navigation](#2-artist--album-navigation)
4. [Playback & Queue Management](#3-playback--queue-management)
5. [Playlist Management](#4-playlist-management)
6. [Resolver & Settings Management](#5-resolver--settings-management)
7. [Error Handling & Edge Cases](#6-error-handling--edge-cases)
8. [Performance & Responsiveness](#7-performance--responsiveness)
9. [UI/UX & Visual Testing](#8-uiux--visual-testing)
10. [Platform-Specific Testing](#9-platform-specific-testing)
11. [Integration & Workflow Testing](#10-integration--workflow-testing)
12. [Test Execution Guidelines](#11-test-execution-guidelines)
13. [Success Criteria](#12-success-criteria)

---

## Test Plan Overview & Objectives

**Application:** Parachord Desktop - Multi-source music player
**Scope:** Full application end-to-end testing
**Version:** Current main branch (post-search drawer feature)

### Testing Objectives

1. **Functional Correctness** - Verify all features work as designed
2. **Data Integrity** - Ensure playlists, cache, and settings persist correctly
3. **Cross-Resolver Compatibility** - Test with multiple music sources
4. **Performance** - Validate search speed, loading times, and responsiveness
5. **Error Handling** - Confirm graceful degradation when services fail
6. **User Experience** - Verify intuitive workflows and visual feedback

### Test Environment Requirements

**Required Setup:**
- macOS/Windows/Linux desktop environment
- Node.js and npm installed
- Spotify Developer account (optional but recommended)
- Internet connection for MusicBrainz, Cover Art Archive APIs
- Test playlists in `.xspf` format
- Sample `.axe` resolver files

**Configuration Files:**
- `.env` with Spotify credentials (if testing Spotify)
- Test playlists in `playlists/` directory
- Resolver files in `resolvers/builtin/` and `resolvers/user/`

---

## 1. Core Search Functionality

### 1.1 Search Input & UI
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| S-01 | Search drawer opens on typing | Type 2+ characters in search bar | Drawer opens immediately with loading animation |
| S-02 | Search debouncing works | Type "Quarantine Angst" quickly | Wait 400ms, then search executes with full query |
| S-03 | Escape key closes drawer | Open search, press Escape | Drawer closes, input cleared |
| S-04 | Empty search closes drawer | Clear search input | Drawer closes, results cleared |
| S-05 | Search persists on navigation | Search for artist, click result, use back button | Search query and results preserved |

### 1.2 Search Results Display
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| S-06 | Grid layout displays correctly | Search for "Beatles" | 4 columns: Artists (1fr), Albums (1fr), Tracks (2fr), Playlists (1fr) |
| S-07 | Results show correct counts | Search with results | Headers show: "🎤 Artists (X)" etc. with accurate counts |
| S-08 | Empty states display | Search for gibberish | Each column shows "No X found" message |
| S-09 | Loading state displays | Start typing | Shows "🔍 Searching..." while debouncing |
| S-10 | Album art loads progressively | Search for popular artist | Results appear first, album art loads within 2-3 seconds |

### 1.3 Search Result Limits & Pagination
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| S-11 | Initial display limits | Search returns 20+ results per category | Shows: 5 artists, 5 albums, 8 tracks, 5 playlists |
| S-12 | Load more buttons appear | Search with 10+ results in category | "Load more (X remaining)" button appears at bottom |
| S-13 | Load more increments correctly | Click "Load more" on artists | Shows 5 more artists, button updates count |
| S-14 | Load more for tracks | Click "Load more" on tracks | Shows 8 more tracks |
| S-15 | Pagination resets on new search | Load more results, then search new term | Display limits reset to initial values |

### 1.4 Search Result Interactions
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| S-16 | Click artist from search | Search for "Beatles", click artist result | Drawer closes, navigates to artist page, shows discography |
| S-17 | Click album from search | Search for album, click album result | Drawer closes, navigates to artist view, shows album track listing |
| S-18 | Click track from search | Search for track, click play on track result | Drawer closes, track begins playing, playback controls update |
| S-19 | Click playlist from search | Search for local playlist name, click result | Drawer closes, navigates to playlist view, shows tracks |
| S-20 | Click track with no sources | Search for track, click play on unresolved track | On-demand resolution begins, then plays when source found |
| S-21 | Click artist name from track | In tracks column, click artist name link | Drawer closes, navigates to that artist's page |
| S-22 | Resolver badge override | Click resolver badge on track (e.g., Spotify) | Plays track from that specific resolver, bypassing priority |
| S-23 | Multiple clicks handled | Rapidly click different results | Only latest click executes, no duplicate actions |
| S-24 | Album art clickable | Click album art thumbnail in albums column | Same as clicking album title - opens album view |
| S-25 | Hover states work | Hover over results | Visual feedback: background changes, play button appears on tracks |

---

## 2. Artist & Album Navigation

### 2.1 Artist Page Display
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| A-01 | Artist page loads | Click artist from search or library | Shows artist name, loading animation, then discography |
| A-02 | Discography fetches from MusicBrainz | Navigate to artist page | Fetches albums, EPs, singles from MusicBrainz API |
| A-03 | Album art loads lazily | View artist with 20+ releases | Initial grid appears fast, album art loads progressively |
| A-04 | Cached artist data reuses | Visit same artist twice | Second visit instant (no API call), uses cache |
| A-05 | Album art cache persists | View artist, restart app, view again | Album art loads from cache immediately |
| A-06 | Release types display correctly | View artist discography | Albums, EPs, Singles grouped/labeled correctly |
| A-07 | Release metadata shows | View discography | Each release shows: title, year, type badge |
| A-08 | Back button navigation | From artist page, click back | Returns to previous view (library/search) |

### 2.2 Album/Release Display
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| A-09 | Album page loads | Click album from artist discography | Shows album art, title, artist, metadata, track listing |
| A-10 | Release metadata displays | View album page | Shows: Type (Album/EP/Single), Release date, Label, Country, Track count |
| A-11 | Release type badge styling | View album/EP/single | Album=blue, EP=green, Single/other=purple badge |
| A-12 | Missing metadata handled | View release with incomplete data | Only available fields shown, no errors for missing data |
| A-13 | Release-group to release conversion | Click album from search results | Converts release-group ID to release ID, fetches full data |
| A-14 | Track listing displays | View album | All tracks shown with: position, title, length, sources |
| A-15 | Multi-disc albums handled | View album with 2+ discs | Tracks grouped by disc/medium correctly |

### 2.3 Track Resolution on Album Pages
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| A-16 | Tracks resolve automatically | Open album page | All tracks begin resolving from enabled resolvers |
| A-17 | Resolution progress visible | Watch album load | Console shows "🔍 Starting resolution for X tracks..." |
| A-18 | Multiple resolvers query | Album with tracks, 3+ resolvers enabled | Each track queries up to 2 resolvers in priority order |
| A-19 | Resolver badges appear | Tracks finish resolving | Each track shows badges for found sources (Spotify, YouTube, etc.) |
| A-20 | Confidence scoring works | View resolved tracks | Higher confidence sources appear first in manual override |
| A-21 | Failed resolution handled | Track not found by any resolver | Track shows without resolver badges, play attempts on-demand resolution |

---

## 3. Playback & Queue Management

### 3.1 Basic Playback Controls
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| P-01 | Play track from search | Search, click play on track | Track begins playing, controls update, progress bar starts |
| P-02 | Play track from album | Open album, click track | Track begins playing from best available source |
| P-03 | Play/Pause toggle | Click play button while playing | Track pauses, button changes to play icon |
| P-04 | Resume playback | Pause track, click play again | Track resumes from paused position |
| P-05 | Volume control | Adjust volume slider | Playback volume changes, setting persists |
| P-06 | Progress bar displays | Play track | Progress bar shows current time / total time |
| P-07 | Progress bar seeking | Click/drag progress bar | Playback seeks to clicked position (if supported by resolver) |
| P-08 | Track ends naturally | Play short track to completion | Track ends, next track plays if queue exists |

### 3.2 Queue Navigation
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| P-09 | Queue removes played track | Play track from album | Current track removed from queue, queue contains only upcoming tracks |
| P-10 | Next track button | Play track from album, click Next | Current track removed, next track starts playing |
| P-11 | Previous track button | Play 3rd track in album, click Previous | Plays previous track (2nd track), current removed from queue |
| P-12 | Previous restarts track | Play track >5 seconds, click Previous | Restarts current track from beginning, stays in queue |
| P-13 | Queue loops at end | Play last track, click Next | Loops to first track in queue |
| P-14 | Queue loops at start | Play first track, click Previous twice | Loops to last track in queue |
| P-15 | Queue from album play | Play track from album | Queue = remaining album tracks (current track removed) |
| P-16 | Queue from playlist play | Play track from playlist | Queue = remaining playlist tracks (current track removed) |
| P-17 | Queue from search play | Play track from search results | Queue = remaining search tracks (current track removed) |
| P-18 | Queue exhaustion | Play all tracks in queue | Queue becomes empty, playback stops or loops |

### 3.3 Multi-Resolver Playback
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| P-19 | Priority-based playback | Track with multiple sources, play normally | Plays from highest priority enabled resolver |
| P-20 | Manual resolver override | Click Spotify badge on track | Plays specifically from Spotify, ignoring priority |
| P-21 | Fallback on failure | Disable highest priority resolver mid-playback | Next track falls back to next available resolver |
| P-22 | Resolver config changes | Change resolver order in settings | New priority applies to next track played |
| P-23 | Spotify Connect playback | Play track with Spotify resolver | Opens Spotify in browser, plays via Spotify Connect |
| P-24 | YouTube external playback | Play track with YouTube resolver | Opens YouTube in external browser |
| P-25 | Bandcamp external playback | Play track with Bandcamp resolver | Opens Bandcamp page in external browser |
| P-26 | Qobuz preview playback | Play track with Qobuz resolver | Plays 30-second preview |

### 3.4 On-Demand Resolution
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| P-27 | First play triggers resolution | Click play on unresolved search result | Shows "🔄 No sources found, attempting on-demand resolution..." |
| P-28 | Resolution then plays | On-demand resolution finds source | Automatically begins playback after resolution completes |
| P-29 | Resolution failure handled | Play track no resolver can find | Shows error alert: "Could not find a playable source..." |
| P-30 | Second play uses cached resolution | Play unresolved track, then play again later | Second play immediate (uses cached sources) |

---

## 4. Playlist Management

### 4.1 Playlist Loading & Display
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| PL-01 | Auto-load playlists on startup | Place .xspf files in `playlists/` folder, start app | All playlists appear in Playlists view |
| PL-02 | Playlists view displays | Click "Playlists" in sidebar | Shows list of all loaded playlists with track counts |
| PL-03 | Playlist metadata displays | View playlists list | Each playlist shows: title, track count ("X tracks") |
| PL-04 | Empty playlists folder | Start app with no playlists | Playlists view shows empty state message |
| PL-05 | Invalid XSPF handled | Place malformed .xspf file in folder | App loads other playlists, logs error for invalid file |

### 4.2 Playlist Playback
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| PL-06 | Open playlist from list | Click playlist in Playlists view | Shows playlist tracks with resolution status |
| PL-07 | Playlist tracks resolve | Open playlist | All tracks begin resolving from enabled resolvers |
| PL-08 | Play track from playlist | Click play on playlist track | Track plays, queue = remaining playlist tracks |
| PL-09 | Playlist navigation | Play track, use Next/Previous | Navigates through playlist tracks in order |
| PL-10 | Back from playlist view | Click back button from playlist | Returns to Playlists list view |
| PL-11 | Playlist search integration | Search for playlist name | Playlist appears in search results, clicking opens it |

### 4.3 Track Resolution in Playlists
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| PL-12 | Resolution with cache | Open playlist with cached track sources | Tracks load sources from cache immediately |
| PL-13 | Resolution without cache | Open playlist with new tracks | Tracks resolve from enabled resolvers (2 per track) |
| PL-14 | Resolver settings change triggers re-resolution | Open playlist, change resolver order, reload | Tracks re-resolve with new resolver priority |
| PL-15 | Failed tracks shown | Playlist with unresolvable tracks | Tracks show without resolver badges, display metadata only |
| PL-16 | Mixed resolution success | Playlist where some tracks resolve, some fail | Resolved tracks show badges, unresolved don't |
| PL-17 | Cache TTL expiration | Open playlist after cache expiry period | Tracks re-resolve instead of using stale cache |

### 4.4 XSPF Format Support
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| PL-18 | Standard XSPF loads | Place standard-format .xspf file | Playlist loads with all tracks and metadata |
| PL-19 | Track metadata parsed | Load XSPF with full metadata | Extracts: title, creator (artist), album, duration |
| PL-20 | Location/identifier handled | XSPF with various track identifiers | Resolves tracks by artist + title, ignores URLs |
| PL-21 | Playlist title extracted | Load XSPF with title element | Uses XSPF title as playlist name |
| PL-22 | Track order preserved | Load XSPF with specific track order | Tracks display in same order as XSPF |
| PL-23 | Unicode characters supported | Load XSPF with non-ASCII characters | Special characters display correctly |

---

## 5. Resolver & Settings Management

### 5.1 Resolver Configuration UI
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| R-01 | Settings panel opens | Click Settings button in header | Settings modal opens showing resolver configuration |
| R-02 | Installed resolvers display | Open Settings | Shows all loaded resolvers with enable/disable toggles |
| R-03 | Resolver metadata shown | View resolver list | Each shows: name, version, capabilities (resolve/stream) |
| R-04 | Enable/disable resolver | Toggle resolver checkbox | Resolver immediately enabled/disabled for new resolutions |
| R-05 | Resolver priority display | View resolver list | Resolvers shown in priority order (drag handles visible) |
| R-06 | Drag to reorder | Drag resolver to new position | Priority updates, affects next track selection |
| R-07 | Settings tabs work | Switch between Installed/Marketplace tabs | Tab content changes appropriately |
| R-08 | Close settings | Click X or outside modal | Settings close, changes persist |

### 5.2 Resolver Enable/Disable
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| R-09 | Disable resolver persists | Disable Spotify, restart app | Spotify remains disabled after restart |
| R-10 | Disabled resolver excluded | Disable resolver, play track | Track doesn't resolve from disabled resolver |
| R-11 | Enable resolver persists | Enable previously disabled resolver, restart | Resolver enabled after restart |
| R-12 | All resolvers disabled | Disable all resolvers, try to play | Shows error: no resolvers available |
| R-13 | Re-enable triggers re-resolution | Disable resolver, open playlist, re-enable | Playlist tracks re-resolve with newly enabled resolver |

### 5.3 Resolver Priority Management
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| R-14 | Priority order persists | Reorder resolvers, restart app | Order preserved after restart |
| R-15 | Priority affects playback | Track with Spotify + YouTube, Spotify priority 1 | Plays from Spotify |
| R-16 | Priority change affects next track | Reorder mid-playback, play next track | Next track uses new priority |
| R-17 | Disabled resolvers excluded from priority | Disable #1 priority resolver | Falls back to #2 priority resolver |
| R-18 | Priority with confidence | Track has Spotify (70% confidence) higher than YouTube (90% confidence) but lower priority | Plays Spotify (priority trumps confidence) |

### 5.4 Resolver Installation
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| R-19 | Built-in resolvers load | Start app | Spotify, Bandcamp, Qobuz, YouTube load from `resolvers/builtin/` |
| R-20 | User resolver installation | Drop .axe file in `resolvers/user/`, restart | Resolver appears in settings, available for use |
| R-21 | Duplicate resolver handled | Install resolver with same ID as existing | Shows error or overwrites with warning |
| R-22 | Invalid .axe file | Place malformed .axe file in resolvers folder | App loads other resolvers, logs error for invalid file |
| R-23 | Resolver uninstall | Delete .axe file, restart | Resolver removed from settings |

### 5.5 Spotify Authentication
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| R-24 | Spotify auth flow | Click "Connect Spotify" button | Opens browser OAuth flow, returns with token |
| R-25 | Token storage | Authenticate with Spotify, restart app | Token persists, no re-authentication needed |
| R-26 | Token refresh | Use app after token expires | Automatically refreshes token using refresh token |
| R-27 | Missing credentials | Start app without .env file | Shows error: "Missing Spotify Client ID" |
| R-28 | Token displayed in settings | Connect Spotify, check settings | Shows token status (connected/disconnected) |
| R-29 | Disconnect Spotify | Clear Spotify token | Next Spotify play attempt triggers re-authentication |

### 5.6 Cache Management
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| R-30 | Album art cache saves | View artist with album art, restart | Album art loads from cache (no API calls) |
| R-31 | Track sources cache saves | Resolve tracks, restart app, load same playlist | Sources load from cache immediately |
| R-32 | Artist data cache saves | View artist page, restart, view again | Artist data loads from cache (no MusicBrainz call) |
| R-33 | Cache TTL respected | Wait past cache TTL, reload cached data | Makes fresh API call instead of using cache |
| R-34 | Cache invalidation on resolver change | Change resolvers, reload playlist | Track sources cache invalidated, re-resolves |
| R-35 | Storage quota handling | Fill cache to near-capacity | App continues functioning, manages storage gracefully |

---

## 6. Error Handling & Edge Cases

### 6.1 Network & API Failures
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| E-01 | MusicBrainz API down | Disconnect internet, search for artist | Shows error alert: "Failed to load artist data. Please try again." |
| E-02 | Cover Art Archive unavailable | Search with CAA down | Results load without album art, no crashes |
| E-03 | Partial network failure | Search with intermittent connection | Shows results as they arrive, handles missing data gracefully |
| E-04 | Resolver API timeout | Play track with slow resolver response | Shows loading state, falls back after timeout |
| E-05 | Rate limiting handled | Make many rapid API requests | Implements backoff, shows user-friendly error |
| E-06 | Network recovery | Go offline, make requests, reconnect | Resumes operations when connection restored |

### 6.2 Missing or Invalid Data
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| E-07 | Artist not found | Search for non-existent artist | Shows alert: "Artist not found in MusicBrainz" |
| E-08 | Album with no tracks | Click album with no media data | Shows album metadata, "No tracks found" message |
| E-09 | Track with no duration | View track missing length metadata | Shows duration as "--:--" or estimated value |
| E-10 | Release missing metadata | View release with sparse data | Only shows available fields, no errors for missing data |
| E-11 | Album art 404 | Fetch art for release without cover | Shows placeholder icon (💿 or gradient), no error |
| E-12 | Invalid release-group ID | Click malformed search result | Shows error alert, doesn't crash app |
| E-13 | Empty search results | Search for gibberish | Shows "No results found for 'query'" in each column |

### 6.3 Playback Errors
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| E-14 | Track source unavailable | Play track, source becomes unavailable mid-play | Falls back to next available resolver |
| E-15 | All sources fail | Play track where all resolvers fail | Shows alert: "Could not find playable source..." |
| E-16 | Resolver authentication expires | Spotify token expires mid-session | Prompts re-authentication or falls back to other resolver |
| E-17 | Stream interruption | Play track, disconnect internet | Pauses playback, shows error state |
| E-18 | Invalid track URL | Resolver returns malformed URL | Logs error, tries next resolver |
| E-19 | Corrupted audio stream | Play track with bad stream | Handles gracefully, doesn't crash renderer |

### 6.4 File System & Persistence Errors
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| E-20 | Playlist file read error | Corrupt .xspf file in folder | Loads other playlists, logs error for corrupt file |
| E-21 | Resolver file read error | Corrupt .axe file in folder | Loads other resolvers, logs error |
| E-22 | Cache write failure | Fill disk space, try to cache data | Handles gracefully, continues without caching |
| E-23 | Settings save failure | Make changes with no write permission | Shows error, changes lost on restart (with warning) |
| E-24 | Missing playlists folder | Delete playlists folder, start app | Creates folder automatically or shows empty state |
| E-25 | Missing resolvers folder | Delete resolvers folder, start app | Shows error or creates folder with prompt to add resolvers |

### 6.5 UI & Interaction Edge Cases
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| E-26 | Rapid clicking | Rapidly click play on different tracks | Only latest click executes, no duplicate playback |
| E-27 | Search during search | Type search, immediately type new search | Cancels first search, executes only latest |
| E-28 | Load more spam clicking | Rapidly click "Load more" button | Increments correctly, no duplicate loading |
| E-29 | Navigation during loading | Click artist, immediately click back | Cancels loading, returns to previous view |
| E-30 | Window resize | Resize window to very small/large | Layout adapts responsively, no broken UI |
| E-31 | Long text truncation | Artist/album with very long names | Text truncates with ellipsis, no overflow |
| E-32 | Special characters | Search for text with emoji/symbols | Handles correctly, no encoding errors |
| E-33 | Empty input edge cases | Various empty/whitespace-only inputs | Handles gracefully, doesn't trigger errors |

### 6.6 State Management Issues
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| E-34 | Concurrent view changes | Rapidly switch between views | No race conditions, correct view displays |
| E-35 | Queue state corruption | Complex queue operations (loop, skip, etc.) | Queue remains consistent, no undefined behavior |
| E-36 | Search state cleanup | Open search, close, open playlist | No stale search results appear |
| E-37 | Memory leaks | Use app extensively (many searches, plays) | Memory usage remains stable over time |
| E-38 | Cache state sync | Make changes across multiple instances | Changes persist and sync correctly |

---

## 7. Performance & Responsiveness

### 7.1 Search Performance
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| PERF-01 | Search drawer opens instantly | Type 2 characters | Drawer opens within 50ms, shows loading state |
| PERF-02 | Search debounce timing | Type multi-word query | Waits 400ms after last keystroke before searching |
| PERF-03 | Search results display speed | Execute search with results | Results appear within 1-2 seconds |
| PERF-04 | Album art lazy loading | Search returns 30 albums | Initial results instant, art loads progressively over 3-5 seconds |
| PERF-05 | Large result sets | Search returns 50+ tracks | UI remains responsive, scrolling smooth |
| PERF-06 | Concurrent searches cancelled | Type quickly, changing query 5+ times | Only final query executes, previous cancelled |

### 7.2 Resolution Performance
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| PERF-07 | Track resolution speed | Open 15-track album | Initial 8 tracks resolve within 3-5 seconds |
| PERF-08 | Parallel resolution | Open album with 20 tracks | Resolves in parallel, not sequentially |
| PERF-09 | Resolution doesn't block UI | Start large resolution, interact with UI | UI remains responsive during resolution |
| PERF-10 | Cached resolution instant | Load previously resolved playlist | Tracks load sources from cache in <100ms |
| PERF-11 | On-demand resolution speed | Play unresolved track | Resolution + playback starts within 2-3 seconds |
| PERF-12 | Resolver query limits | Track resolution with 5 enabled resolvers | Only queries first 2 resolvers (performance limit) |

### 7.3 Page Load & Navigation
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| PERF-13 | App startup time | Launch app | Ready to interact within 2-3 seconds |
| PERF-14 | Artist page load (cached) | Navigate to cached artist | Page displays instantly (<100ms) |
| PERF-15 | Artist page load (uncached) | Navigate to new artist | Loading animation immediate, data within 1-2 seconds |
| PERF-16 | Album page load | Click album from discography | Track listing appears within 1 second |
| PERF-17 | View switching speed | Rapidly switch between Library/Playlists/etc | Each view loads within 100-200ms |
| PERF-18 | Back navigation speed | Navigate deep (artist→album), hit back repeatedly | Each back action instant (<50ms) |

### 7.4 Large Dataset Handling
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| PERF-19 | Large discography | Load artist with 100+ releases | Initial grid loads fast, scrolling smooth |
| PERF-20 | Large playlist | Load playlist with 200+ tracks | UI responsive, progressive loading if needed |
| PERF-21 | Long play session | Play 50+ tracks in a row | No memory leaks, performance stable |
| PERF-22 | Many cached items | Accumulate 500+ cached album arts | App starts quickly, cache lookup fast |
| PERF-23 | Search with many results | Search for common term (100+ results) | Pagination prevents UI slowdown |

### 7.5 Memory & Resource Usage
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| PERF-24 | Idle memory usage | Launch app, leave idle for 5 minutes | Memory usage stable, no leaks |
| PERF-25 | Active usage memory | Heavy use for 30 minutes (searches, plays, navigation) | Memory growth minimal, stays under reasonable limits |
| PERF-26 | Cache memory footprint | Populate caches fully | Cache size reasonable (<100MB typical use) |
| PERF-27 | Image loading memory | Load 50+ album art images | Images garbage collected when no longer visible |
| PERF-28 | API request rate limiting | Make many requests quickly | Implements sensible rate limits, doesn't overwhelm APIs |

---

## 8. UI/UX & Visual Testing

### 8.1 Layout & Responsiveness
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| UI-01 | Grid layout proportions | Open search with results | Columns: Artists (1fr), Albums (1fr), Tracks (2fr), Playlists (1fr) |
| UI-02 | Column scrolling independence | Scroll one column | Other columns remain fixed, independent scrolling works |
| UI-03 | Header fixed position | Scroll page content | Header stays fixed at top, always accessible |
| UI-04 | Sidebar fixed | Scroll main content | Sidebar remains fixed, doesn't scroll |
| UI-05 | Responsive window resize | Resize window from 800px to 1920px | Layout adapts, no broken elements |
| UI-06 | Minimum window size | Resize to very small window | Content remains usable, scroll bars appear if needed |
| UI-07 | Text truncation | View items with long titles | Text truncates with ellipsis (...), no overflow |

### 8.2 Visual Feedback & States
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| UI-08 | Hover states | Hover over clickable elements | Visual feedback: background change, opacity, cursor change |
| UI-09 | Active/selected states | Navigate between views | Active view highlighted in sidebar (purple background) |
| UI-10 | Loading animations | Trigger various loading states | Spinner or "Searching..." message shows |
| UI-11 | Play button states | Play/pause track | Button icon changes: Play ↔ Pause |
| UI-12 | Track playing indicator | Play track | Current track highlighted (purple text) |
| UI-13 | Disabled states | Disable resolver, view settings | Disabled resolver appears grayed out |
| UI-14 | Button press feedback | Click buttons | Visual press effect (opacity/scale change) |

### 8.3 Album Art & Images
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| UI-15 | Album art aspect ratio | View various album arts | Images maintain square aspect ratio, no stretching |
| UI-16 | Missing art placeholder | Item without album art | Shows placeholder (💿 emoji or gradient) |
| UI-17 | Album art loading state | Images loading | Placeholder visible until image loads, no flash |
| UI-18 | Thumbnail quality | View album art in search/lists | Uses 250px thumbnails (not full-size), loads fast |
| UI-19 | Full-size art quality | View album page | Uses 500px art for better quality |
| UI-20 | Image loading error | Album art 404 | Shows placeholder, no broken image icon |

### 8.4 Typography & Readability
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| UI-21 | Font hierarchy | View any page | Clear distinction: headings, body text, metadata |
| UI-22 | Text contrast | Check all text colors | Sufficient contrast against backgrounds (WCAG AA) |
| UI-23 | Long text readability | View truncated text | Full text visible on hover (tooltip) |
| UI-24 | Track duration format | View tracks | Duration displays as "M:SS" format |
| UI-25 | Metadata text size | View album metadata | Small text readable but not too small (<12px) |

### 8.5 Color & Theming
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| UI-26 | Color consistency | Navigate entire app | Consistent purple accent color throughout |
| UI-27 | Resolver badge colors | View resolved tracks | Each resolver has distinct color (Spotify=green, YouTube=red, etc.) |
| UI-28 | Release type badges | View albums/EPs/singles | Color-coded: Album=blue, EP=green, Single=purple |
| UI-29 | Background gradient | View main content area | Smooth gradient: slate-900 → purple-900 → slate-900 |
| UI-30 | Contrast in overlays | Open modals/drawers | Backdrop blur with sufficient contrast |

---

## 9. Platform-Specific Testing

### 9.1 macOS Specific
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| MAC-01 | App launch | Double-click app icon | App opens without errors |
| MAC-02 | Menu bar integration | Check menu bar | App menu appears with standard Mac menu items |
| MAC-03 | Keyboard shortcuts | Try Cmd+Q, Cmd+W, Cmd+Tab | Standard Mac shortcuts work as expected |
| MAC-04 | File associations | Double-click .xspf file | Opens in Parachord if configured |
| MAC-05 | Dock integration | Right-click dock icon | Shows recent playlists or standard menu |
| MAC-06 | Full-screen mode | Click green window button | Enters/exits full-screen smoothly |
| MAC-07 | Dark mode | Toggle macOS dark mode | App adapts (if dark mode support exists) |
| MAC-08 | Retina display | View on Retina MacBook | UI renders crisp, no blurry elements |
| MAC-09 | App permissions | First launch | Requests necessary permissions (network, files) |
| MAC-10 | Updates | Check for updates (if implemented) | Update mechanism works or shows current version |

### 9.2 Windows Specific
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| WIN-01 | App launch | Double-click .exe | App opens without errors |
| WIN-02 | Window controls | Test minimize/maximize/close | All window controls function correctly |
| WIN-03 | Keyboard shortcuts | Try Alt+F4, Alt+Tab | Standard Windows shortcuts work |
| WIN-04 | File associations | Double-click .xspf file | Opens in Parachord if configured |
| WIN-05 | System tray | Check system tray | App icon appears (if tray integration exists) |
| WIN-06 | High DPI displays | View on 4K monitor | UI scales correctly, no blurry text |
| WIN-07 | Task manager | Open task manager during use | Resource usage reasonable, no hung processes |
| WIN-08 | Antivirus compatibility | Run with Windows Defender/antivirus | No false positives, app runs normally |
| WIN-09 | Windows updates | Test after Windows updates | App continues functioning after OS updates |
| WIN-10 | UNC paths | Load playlist from network path | Handles network paths correctly |

### 9.3 Linux Specific
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| LIN-01 | App launch | Run from terminal or desktop | App opens without errors |
| LIN-02 | Window manager compatibility | Test on GNOME, KDE, XFCE | Works on major desktop environments |
| LIN-03 | Wayland vs X11 | Test on both display servers | Renders correctly on both |
| LIN-04 | Keyboard shortcuts | Try standard Linux shortcuts | Works with various window manager shortcuts |
| LIN-05 | File permissions | Check .axe and .xspf file handling | Respects Linux file permissions |
| LIN-06 | HiDPI scaling | Test on HiDPI Linux displays | Scales correctly with desktop scaling settings |
| LIN-07 | Dependencies | Check required libraries | All dependencies packaged or documented |
| LIN-08 | Terminal output | Run from terminal | Logs visible and helpful for debugging |
| LIN-09 | Audio system compatibility | Test with PulseAudio/ALSA/PipeWire | Audio works across different audio systems |
| LIN-10 | File browser integration | Right-click .xspf in file browser | "Open with Parachord" option available |

### 9.4 Cross-Platform Consistency
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| CROSS-01 | UI consistency | Compare UI across platforms | Layout, colors, fonts consistent across OS |
| CROSS-02 | Feature parity | Test all features on each platform | All features work equally on all platforms |
| CROSS-03 | File format compatibility | Create playlist on Mac, open on Windows | .xspf files work cross-platform |
| CROSS-04 | Settings portability | Export settings from one OS, import to another | Settings transfer correctly |
| CROSS-05 | Cache portability | Copy cache folder to another platform | Cache works or rebuilds gracefully |
| CROSS-06 | Path handling | Test with different path separators | Handles / and \ correctly |
| CROSS-07 | Character encoding | Use unicode filenames/playlists | Works consistently across platforms |
| CROSS-08 | Network behavior | Test on different network configurations | API calls work consistently |

---

## 10. Integration & Workflow Testing

### 10.1 End-to-End User Flows
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| FLOW-01 | First-time user setup | Fresh install → Configure Spotify → Search → Play | Complete onboarding flow works smoothly |
| FLOW-02 | Search to play workflow | Search artist → Click artist → Click album → Play track | Seamless navigation and playback |
| FLOW-03 | Playlist creation workflow | Create .xspf → Place in folder → Restart → Load → Play | Full playlist workflow end-to-end |
| FLOW-04 | Resolver configuration workflow | Install .axe → Enable → Set priority → Play track | Resolver integration works completely |
| FLOW-05 | Album discovery flow | Search → Find album → View tracks → Play → Queue through album | Natural discovery and listening flow |
| FLOW-06 | Multi-session workflow | Play tracks → Close app → Reopen → Resume or start new | Settings/state persist correctly |

### 10.2 Regression Testing Scenarios
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| REG-01 | Previous search drawer issues | Test all originally reported search drawer bugs | All previously fixed bugs remain fixed |
| REG-02 | WebkitAppRegion bug | Check header rendering | Header content visible (not blocked by drag region) |
| REG-03 | Release type error | Click album from search | No "toUpperCase of undefined" error |
| REG-04 | Handle renaming | Check function references | No "handleSearch is not defined" errors |
| REG-05 | Track resolution on first play | Play unresolved search result first time | Works on first click (no need to click twice) |
| REG-06 | MusicBrainz resolver removal | Check resolver list | MusicBrainz not in resolver list (removed) |
| REG-07 | Drawer positioning | Open/close search drawer | Drawer doesn't cover header when closed |

### 10.3 Data Integrity & Persistence
| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| DATA-01 | Settings persist across restarts | Change settings → Restart app | All settings preserved |
| DATA-02 | Cache survives restarts | Build cache → Restart → Use cached data | Cache loaded and functional |
| DATA-03 | Playlists persist | Load playlists → Restart | Playlists still available |
| DATA-04 | Queue state on close | Play track → Close mid-song → Reopen | Queue cleared (intentional behavior) |
| DATA-05 | Resolver order persists | Reorder resolvers → Restart | Order preserved |
| DATA-06 | Volume setting persists | Change volume → Restart | Volume setting remembered |
| DATA-07 | Spotify token persists | Authenticate → Restart → Use Spotify | Token valid, no re-auth needed |
| DATA-08 | Cache invalidation works | Change resolvers → Reload playlist | Old cache invalidated, new resolution happens |

---

## 11. Test Execution Guidelines

### 11.1 Test Priorities

**P0 - Critical (Must Pass Before Release)**
- All playback functionality (P-01 to P-30)
- Search core features (S-01 to S-15)
- Basic navigation (A-01 to A-08)
- Resolver configuration (R-01 to R-18)
- Data persistence (DATA-01 to DATA-08)

**P1 - High (Should Pass Before Release)**
- Search interactions (S-16 to S-25)
- Playlist management (PL-01 to PL-23)
- Album/release display (A-09 to A-21)
- Error handling (E-01 to E-19)
- Performance baselines (PERF-01 to PERF-18)

**P2 - Medium (Can be addressed post-release)**
- Edge cases (E-20 to E-38)
- Advanced performance (PERF-19 to PERF-28)
- UI/UX polish (UI-01 to UI-30)
- Platform-specific features (MAC-01 to LIN-10)

**P3 - Low (Nice to Have)**
- Cross-platform consistency details (CROSS-01 to CROSS-08)
- Advanced integration flows (FLOW-01 to FLOW-06)

### 11.2 Test Environment Setup

**Required Software:**
```bash
# Node.js 16+ and npm
node --version
npm --version

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your Spotify credentials
```

**Test Data Preparation:**
1. Place sample .xspf playlists in `playlists/` folder
2. Add test .axe resolver files to `resolvers/user/` (optional)
3. Prepare test queries: popular artists, obscure tracks, unicode text
4. Have various network conditions available for testing

**Browser/External Tools:**
- Modern web browser (for Spotify/YouTube external playback)
- Network throttling tool (for performance testing)
- Screen recording software (for bug reports)

### 11.3 Test Execution Process

**For Each Test Case:**
1. **Setup** - Ensure test environment is in clean state
2. **Execute** - Follow test steps exactly as written
3. **Verify** - Check expected result matches actual behavior
4. **Document** - Record: Pass/Fail, Screenshots, Logs, Notes
5. **Cleanup** - Reset to clean state for next test

**Recording Test Results:**
- ✅ **Pass** - Works exactly as expected
- ❌ **Fail** - Does not meet expected result
- ⚠️ **Partial** - Works but with minor issues
- 🚫 **Blocked** - Cannot test due to dependency/environment
- ⏭️ **Skipped** - Intentionally not tested this cycle

### 11.4 Bug Reporting Template

When a test fails, report bugs with:

```markdown
**Test ID:** [e.g., P-15]
**Priority:** [P0/P1/P2/P3]
**Platform:** [macOS/Windows/Linux]
**Version:** [Git commit hash]

**Steps to Reproduce:**
1. [Exact steps from test case]
2. [Additional context if needed]

**Expected Result:**
[From test case]

**Actual Result:**
[What actually happened]

**Screenshots/Logs:**
[Attach relevant files]

**Environment:**
- Node version:
- Resolvers enabled:
- Network: Online/Offline/Throttled
```

### 11.5 Regression Testing Strategy

**When to Run Regression Tests:**
- Before every release
- After major feature additions
- After bug fixes to critical areas
- Weekly during active development

**Smoke Test Subset (15 minutes):**
Run these tests for quick validation:
- S-01, S-06, S-16, S-17, S-18
- P-01, P-02, P-09, P-10, P-19
- A-01, A-09, PL-06
- R-01, R-09, R-14
- REG-01 to REG-07

**Full Regression (2-3 hours):**
- All P0 and P1 tests
- Platform-specific basics (MAC-01, WIN-01, LIN-01)
- Key integration flows (FLOW-01 to FLOW-03)

---

## 12. Success Criteria

### 12.1 Release Readiness

**Minimum Requirements for Release:**
- ✅ All P0 tests pass (100%)
- ✅ 95%+ of P1 tests pass
- ✅ No critical (P0) bugs open
- ✅ All regression tests pass
- ✅ Works on at least 2 of 3 platforms (macOS/Windows/Linux)
- ✅ Core user flows complete end-to-end

### 12.2 Quality Metrics

**Performance Benchmarks:**
- App startup: < 3 seconds
- Search response: < 2 seconds
- Track resolution: < 5 seconds (8 tracks)
- UI interactions: < 100ms response time
- Memory usage: < 500MB typical use

**Reliability Metrics:**
- Crash rate: 0% in smoke tests
- API failure handling: 100% graceful degradation
- Data persistence: 100% settings/cache survive restart

### 12.3 Known Limitations

Document accepted limitations:
- Spotify requires Premium for full playback
- Album art loading can be slow for large discographies
- Some resolvers require external browser
- YouTube/Bandcamp play externally (not embedded)
- Queue clears tracks as they play (by design)

---

## Appendix A: Test Coverage Summary

**Total Test Cases:** 350+

**By Category:**
- Search: 25 tests
- Artist/Album Navigation: 21 tests
- Playback: 30 tests
- Playlists: 23 tests
- Resolvers/Settings: 35 tests
- Error Handling: 38 tests
- Performance: 28 tests
- UI/UX: 30 tests
- Platform-Specific: 38 tests
- Integration: 22 tests
- Regression: 8 tests
- Data Integrity: 8 tests

**By Priority:**
- P0 (Critical): ~80 tests
- P1 (High): ~120 tests
- P2 (Medium): ~100 tests
- P3 (Low): ~50 tests

---

## Appendix B: Testing Tools & Resources

**Recommended Tools:**
- **Chrome DevTools** - Inspect console logs, network requests
- **Electron DevTools** - Debug Electron-specific issues
- **Postman** - Test API endpoints directly
- **Charles Proxy** - Monitor/throttle network traffic
- **OBS Studio** - Record test sessions for bug reports
- **Git** - Track test results across versions

**Documentation References:**
- MusicBrainz API: https://musicbrainz.org/doc/MusicBrainz_API
- Cover Art Archive API: https://coverartarchive.org/
- XSPF Spec: https://www.xspf.org/xspf-v1.html
- Spotify Web API: https://developer.spotify.com/documentation/web-api

---

**End of Test Plan**
