# Recommendations Page Design

## Overview

Add a "Recommendations" page to the Discover section that displays personalized music recommendations from Last.fm, grouped into Artists and Songs sections matching the search results layout.

## Data Source

- URL: `https://www.last.fm/player/station/user/jherskowitz/recommended`
- Returns JSON with `playlist` array of ~30 tracks
- Each track includes: name, duration, artists array, playlinks (YouTube)

## Navigation

- Sidebar: Add "Recommendations" under Discover section (after "Critical Darlings")
- New `activeView` value: `'recommendations'`
- New state: `recommendations = { artists: [], tracks: [], loading: true, error: null }`

## Data Fetching

`loadRecommendations()` function:
1. Fetch from Last.fm URL
2. Parse JSON, extract `playlist` array
3. Transform tracks to app format:
   - id: spelling_id
   - title: track.name
   - artist: track.artists[0].name
   - duration: track.duration
   - playlinks: track.playlinks
4. Extract unique artists from tracks
5. Fetch artist images lazily via existing `getArtistImage()`

## UI Layout

Matches search results quick view:

**Header:**
- Title: "Recommendations"
- Subtitle: "Personalized picks from Last.fm"

**ARTISTS section:**
- Horizontal row, 7 max visible
- Uses existing `SearchArtistCard` component
- Click → `fetchArtistData(artist.name)`
- "Show more" if > 7

**SONGS section:**
- Horizontal row, 7 max visible
- Square cards (w-28 h-28) with music note placeholder (no album art)
- Track title + artist name
- Click → `handlePlay(track)`
- Drag/drop + context menu support
- "Show more" if > 7

**States:**
- Loading: Skeleton loaders (same as search)
- Error: Message + retry button
