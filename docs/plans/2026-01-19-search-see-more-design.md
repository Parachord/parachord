# Search "See More" Page Design

## Overview

Add a detailed "See More" search results page with tabs, preview pane, and infinite scroll. This page is accessed via "Show more" links on the main search page. Also add a static header image to both search pages.

## Navigation & State

**Entry point:** Clicking "Show more" on any category (Artists, Tracks, Albums, Playlists) on the main search page.

**New state variables:**
- `searchDetailCategory` - `null` (main search view) or `'artists'|'tracks'|'albums'|'playlists'` (detailed view)
- `searchPreviewItem` - The currently hovered/previewed item (defaults to first result of active tab)

**View logic:**
- `activeView === 'search' && !searchDetailCategory` → Main horizontal scroll search page
- `activeView === 'search' && searchDetailCategory` → Detailed tabbed "See More" page

**Navigation behavior:**
- Clicking a tab switches `searchDetailCategory`, resets scroll to top, previews first item
- Clicking "CLOSE" or pressing Escape → `navigateBack()` (clears search state)
- Search input updates results in real-time with debounce (same as main search page)

## Layout Structure

```
┌─────────────────────────────────────────────────────────────────┐
│  [Header image - static decorative background]                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 🔍 JAMES                    150 Artists | 15 Albums | 72 Songs│
│  │ [search input]                                    [CLOSE ×] ││
│  └─────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐  ┌──────────────────────────────────────────┐ │
│  │              │  │  SEARCH RESULTS                          │ │
│  │  [Square     │  ├──────────────────────────────────────────┤ │
│  │   Preview    │  │ 01  James Blunt      11 Albums  130 songs│ │
│  │   Image]     │  │ 02  James            20 Albums  237 songs│ │
│  │              │  │ 03  James Blake ←    13 Albums   ▶ ≡    │ │
│  │              │  │ 04  James Otto        4 Albums   40 songs│ │
│  ├──────────────┤  │ 05  James Brown     820 Albums 12438 songs│ │
│  │ Artist Name  │  │ ...                                      │ │
│  │              │  │                                          │ │
│  │ Bio excerpt  │  │         [infinite scroll]                │ │
│  │ ...          │  │                                          │ │
│  │ Read more    │  └──────────────────────────────────────────┘ │
│  └──────────────┘                                               │
└─────────────────────────────────────────────────────────────────┘
```

- Header with search input, tab counts (showing total results), and close button
- Left: Square preview pane (~300px) with image and metadata
- Right: Scrollable results list with infinite scroll
- Hovered row shows action icons (play, queue, etc. for tracks)

## Header Image

**Both search pages (main and detailed):**
- Static decorative header image
- Same style as Critics Picks and Charts pages
- Blurred/gradient background effect

## Tab Counts

Show total result counts from search in header tabs:
- "150 Artists" | "15 Albums" | "72 Songs" | "5 Playlists"
- Active tab visually highlighted

## Results List Columns

**Artists tab:**
- # | Name | All Releases count | Songs count

**Tracks tab:**
- Standard track list design with resolver badges and action icons
- Same columns and styling as used elsewhere in the app

**Albums tab:**
- # | Title | Artist | Year | Release type (Album, EP, Single)

**Playlists tab:**
- # | Title | Author Name (if available from XSPF) | Track count

## Preview Pane Content

**Default behavior:** Shows first item in list. Updates on hover. Reverts to first item when mouse leaves the list area.

**Artists tab preview:**
- Square artist photo (from `getArtistImage`)
- Artist name below image
- First 2-3 lines of bio (from MusicBrainz/last.fm)
- "Read more" link

**Tracks tab preview:**
- Album art (from track's release)
- Album title
- Artist name
- Year
- Same metadata layout as album cards on artist page

**Albums tab preview:**
- Album art
- Album title
- Artist name
- Year
- Release type (Album, EP, Single)

**Playlists tab preview:**
- 2x2 grid cover (first 4 album arts from playlist tracks)
- Playlist title
- Author name (if available)
- Track count
- Total duration (if available)

## Click Behavior

Same as main search page:
- Artists → navigate to artist page
- Tracks → play track
- Albums → navigate to release page
- Playlists → navigate to playlist view

## Pagination

Infinite scroll - automatically load more results as user scrolls to bottom of the list.

## Tab Switching

Reset on switch:
- Scroll position resets to top
- Preview pane shows first item of new tab
- No state preserved between tabs
