# Collection Page Redesign

## Overview

Redesign the Collection (Library) page with a collapsible header, filter tabs (Artists | Albums | Tracks), sort options, and inline search filtering. Matches the visual patterns established in the Artist page and Search Results page.

## Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │  Gradient + vinyl pattern
│                                                                 │
│                         COLLECTION                              │  Title centered
│                   X Artists | X Albums | X Tracks               │  Stats line
│                                                                 │
│        [ Artists ]  [ Albums ]  [ Tracks ]     [Sort ▼] [🔎]   │  Filter bar
└─────────────────────────────────────────────────────────────────┘
│                                                                 │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐                            │  Content grid/list
│  └────┘ └────┘ └────┘ └────┘ └────┘                            │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐                            │
│  └────┘ └────┘ └────┘ └────┘ └────┘                            │
└─────────────────────────────────────────────────────────────────┘
```

## Header States

### Expanded (~120px)
- Gradient background (purple/indigo matching current design)
- Vinyl record SVG pattern overlay at 5-10% opacity
- "COLLECTION" title: Centered, large (32-36px), ALL-CAPS, letter-spacing
- Stats line: "X Artists | X Albums | X Tracks" centered below title
- Filter bar: Tabs left, sort dropdown + search icon right

### Collapsed (~70px)
- Same gradient + pattern (cropped by height)
- "COLLECTION" title: Left-aligned, smaller (20-24px)
- Stats line: Hidden
- Filter tabs: Inline to right of title
- Sort dropdown + search icon: Far right

### Collapse Trigger
- Scroll position > 50px toggles `collectionHeaderCollapsed` state
- CSS transitions on height/layout (300ms ease)
- Header uses `position: sticky; top: 0`

## Filter Tabs

Three tabs: **Artists** | **Albums** | **Tracks**

- Default tab: Tracks (matches current Collection behavior)
- Active tab: Visual indicator (underline or background highlight, white text)
- Inactive tabs: Gray text with hover effect
- Clicking tab updates `collectionTab` state and swaps content view

## Sort Dropdown

Each tab has its own sort options:

| Tab | Sort Options |
|-----|-------------|
| Artists | Alphabetical (A-Z), Alphabetical (Z-A), Most Tracks, Recently Added |
| Albums | Alphabetical (A-Z), Alphabetical (Z-A), Artist Name, Year (Newest), Year (Oldest), Recently Added |
| Tracks | Title (A-Z), Title (Z-A), Artist Name, Album Name, Duration, Recently Added |

**Defaults:**
- Artists: Alphabetical (A-Z)
- Albums: Recently Added
- Tracks: Recently Added

**UI:**
- Dropdown button showing current sort
- Opens menu on click with checkmark next to selected option
- Semi-transparent background matching app style

## Inline Search

**Icon behavior:**
1. Click 🔎 icon → field expands to ~200px width with auto-focus
2. User types → filters results in real-time
3. Blur when empty → field collapses back to icon only
4. Blur with text → field stays open showing active filter
5. Small "×" button appears when text present to clear filter

**Filter logic:**
- Filters current tab's results as user types
- Artists tab: matches artist name
- Albums tab: matches album title OR artist name
- Tracks tab: matches track title OR artist name OR album name
- Case-insensitive matching

## Content Views

### Artists View (Grid)
- Responsive grid: `grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4`
- Card contents: Artist image (rounded), artist name below
- Hover: Scale 1.05, subtle background highlight
- Click: Navigate to artist page
- Data: Derived from library tracks (unique artists)

### Albums View (Grid)
- Same responsive grid layout
- Reuse existing `ReleaseCard` pattern
- Card contents: Album art, album title, artist name, year badge
- Hover: Scale 1.05, purple background highlight
- Click: Navigate to release page
- Data: Derived from library tracks (unique album + artist combinations)

### Tracks View (List)
- Current Collection implementation (no changes)
- Columns: #, Title, Artist, Album, Duration, Resolver icons
- Click to play, right-click for context menu
- Data: Existing library array

## State Variables

```javascript
// Collection page state
const [collectionTab, setCollectionTab] = useState('tracks'); // 'artists' | 'albums' | 'tracks'
const [collectionHeaderCollapsed, setCollectionHeaderCollapsed] = useState(false);
const [collectionSearchOpen, setCollectionSearchOpen] = useState(false);
const [collectionSearch, setCollectionSearch] = useState('');
const [collectionSort, setCollectionSort] = useState({
  artists: 'alpha-asc',
  albums: 'recent',
  tracks: 'recent'
});
```

## Derived Data

```javascript
// Unique artists from library
const collectionArtists = useMemo(() => {
  const artistMap = new Map();
  library.forEach(track => {
    if (!artistMap.has(track.artist)) {
      artistMap.set(track.artist, { name: track.artist, trackCount: 0 });
    }
    artistMap.get(track.artist).trackCount++;
  });
  return Array.from(artistMap.values());
}, [library]);

// Unique albums from library
const collectionAlbums = useMemo(() => {
  const albumMap = new Map();
  library.forEach(track => {
    const key = `${track.album}|||${track.artist}`;
    if (!albumMap.has(key)) {
      albumMap.set(key, {
        title: track.album,
        artist: track.artist,
        year: track.year,
        art: track.art,
        trackCount: 0
      });
    }
    albumMap.get(key).trackCount++;
  });
  return Array.from(albumMap.values());
}, [library]);
```

## Empty States

Match existing app empty state styling:
- Centered container
- Subtle icon above text (gray, ~48px)
- Message text in gray

**Messages:**
- "No artists match your search"
- "No albums match your search"
- "No tracks match your search"

## Transitions

- Header height collapse: 300ms ease (matching Artist page)
- Search field expand/collapse: 200ms ease
- Tab switching: Instant content swap
- Sort changes: Instant reorder
- Hover effects: 150ms ease

## Vinyl Pattern

Simple SVG pattern overlay for header:
- Concentric circles or vinyl groove lines
- Semi-transparent (5-10% opacity)
- Subtle texture without being distracting

## Files to Modify

1. `app.js`:
   - Add new state variables for collection page
   - Add scroll listener for header collapse (when `activeView === 'library'`)
   - Add derived data computations for artists and albums
   - Replace current library view with new Collection page structure
   - Add filter, sort, and search logic
   - Add Artists grid and Albums grid views
