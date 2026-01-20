# Search "See More" Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a detailed "See More" search results page with tabs, preview pane, infinite scroll, and header images for both search pages.

**Architecture:** Add new state variables (`searchDetailCategory`, `searchPreviewItem`) to toggle between main search view and detailed tabbed view. The search page conditionally renders either the horizontal-scroll quick results or the detailed two-pane layout based on `searchDetailCategory`. Add hero header section to both search page modes.

**Tech Stack:** React (createElement API), Tailwind CSS, existing MusicBrainz API integration

---

## Task 1: Add New State Variables for Search Detail View

**Files:**
- Modify: `app.js` around line 827 (after existing search state)

**Step 1: Add new state variables**

After the `displayLimits` state (around line 834), add:

```javascript
const [searchDetailCategory, setSearchDetailCategory] = useState(null); // null = main view, 'artists'|'tracks'|'albums'|'playlists' = detail view
const [searchPreviewItem, setSearchPreviewItem] = useState(null); // Currently previewed item in detail view
```

**Step 2: Update navigateTo to clear detail state**

In the `navigateTo` function (around line 5432), update the search state clearing block to also clear the new state:

```javascript
if (activeView === 'search') {
  setSearchQuery('');
  setSearchResults({ artists: [], albums: [], tracks: [], playlists: [] });
  setIsSearching(false);
  setDisplayLimits({ artists: 5, albums: 5, tracks: 8, playlists: 5 });
  setSearchDetailCategory(null);
  setSearchPreviewItem(null);
}
```

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat: add state variables for search detail view"
```

---

## Task 2: Add Hero Header to Main Search Page

**Files:**
- Modify: `app.js` - the search page view (around line 6449)

**Step 1: Wrap search page in scrollable container and add hero**

Replace the opening of the search page (starting at `activeView === 'search' ? React.createElement('div', {`) with a structure that includes a hero section similar to Charts/Critics Picks.

The hero should have:
- Gradient background (blue/purple theme for search)
- Search icon pattern overlay
- Title: "Search"
- Subtitle: "Find artists, albums, tracks, and playlists"

Insert hero section at the top of the search page, before the search input.

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat: add hero header to main search page"
```

---

## Task 3: Update "Show more" Links to Set Detail Category

**Files:**
- Modify: `app.js` - the search results sections (around lines 6555-6680)

**Step 1: Change "Show more" button onClick handlers**

For each category's "Show more" button, change from `handleLoadMore` to setting the detail category:

Artists section:
```javascript
onClick: () => {
  setSearchDetailCategory('artists');
  setSearchPreviewItem(searchResults.artists[0] || null);
}
```

Tracks section:
```javascript
onClick: () => {
  setSearchDetailCategory('tracks');
  setSearchPreviewItem(searchResults.tracks[0] || null);
}
```

Albums section:
```javascript
onClick: () => {
  setSearchDetailCategory('albums');
  setSearchPreviewItem(searchResults.albums[0] || null);
}
```

Playlists section:
```javascript
onClick: () => {
  setSearchDetailCategory('playlists');
  setSearchPreviewItem(searchResults.playlists[0] || null);
}
```

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat: show more buttons navigate to detail view"
```

---

## Task 4: Create Search Detail View Structure

**Files:**
- Modify: `app.js` - add conditional rendering for detail view

**Step 1: Add detail view conditional**

Modify the search page to conditionally render either the main view or detail view based on `searchDetailCategory`.

The structure should be:
```javascript
activeView === 'search' ? React.createElement('div', { className: '...' },
  // Hero section (same for both views)

  searchDetailCategory ?
    // Detail view with tabs and preview pane
    React.createElement('div', { ... })
  :
    // Main search view (existing horizontal scroll layout)
    React.createElement('div', { ... })
) : ...
```

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat: add conditional structure for search detail view"
```

---

## Task 5: Build Detail View Header with Tabs

**Files:**
- Modify: `app.js` - detail view section

**Step 1: Create header with search input and tabs**

The header should contain:
- Search input (same large input, carries over the query)
- Tab counts: "X Artists" | "X Albums" | "X Tracks" | "X Playlists"
- Active tab highlighted
- Close button

```javascript
// Detail view header
React.createElement('div', { className: 'flex items-center justify-between px-8 py-4 border-b border-gray-200' },
  // Search input
  React.createElement('div', { className: 'flex items-center gap-3 flex-1' },
    React.createElement('svg', { className: 'w-5 h-5 text-gray-400', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
    ),
    React.createElement('input', {
      type: 'text',
      value: searchQuery,
      onChange: (e) => handleSearchInput(e.target.value),
      className: 'text-2xl font-light text-gray-900 bg-transparent border-none outline-none flex-1',
      placeholder: 'Search...'
    })
  ),
  // Tabs
  React.createElement('div', { className: 'flex items-center gap-6' },
    // Artists tab
    React.createElement('button', {
      onClick: () => { setSearchDetailCategory('artists'); setSearchPreviewItem(searchResults.artists[0] || null); },
      className: `text-sm font-medium ${searchDetailCategory === 'artists' ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'}`
    }, `${searchResults.artists.length} Artists`),
    // Albums tab
    React.createElement('button', {
      onClick: () => { setSearchDetailCategory('albums'); setSearchPreviewItem(searchResults.albums[0] || null); },
      className: `text-sm font-medium ${searchDetailCategory === 'albums' ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'}`
    }, `${searchResults.albums.length} Albums`),
    // Tracks tab
    React.createElement('button', {
      onClick: () => { setSearchDetailCategory('tracks'); setSearchPreviewItem(searchResults.tracks[0] || null); },
      className: `text-sm font-medium ${searchDetailCategory === 'tracks' ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'}`
    }, `${searchResults.tracks.length} Tracks`),
    // Playlists tab
    React.createElement('button', {
      onClick: () => { setSearchDetailCategory('playlists'); setSearchPreviewItem(searchResults.playlists[0] || null); },
      className: `text-sm font-medium ${searchDetailCategory === 'playlists' ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'}`
    }, `${searchResults.playlists.length} Playlists`)
  ),
  // Close button
  React.createElement('button', {
    onClick: () => setSearchDetailCategory(null),
    className: 'ml-6 flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 transition-colors border border-gray-300 rounded px-3 py-1'
  },
    'CLOSE',
    React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M6 18L18 6M6 6l12 12' })
    )
  )
)
```

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat: add detail view header with tabs"
```

---

## Task 6: Build Preview Pane Component

**Files:**
- Modify: `app.js` - add preview pane to detail view

**Step 1: Create preview pane structure**

The preview pane shows different content based on the active tab:

```javascript
// Preview pane (left side, ~300px)
React.createElement('div', { className: 'w-80 flex-shrink-0 p-6 border-r border-gray-200' },
  searchPreviewItem ? (
    searchDetailCategory === 'artists' ?
      // Artist preview: image + name + bio
      React.createElement('div', null,
        React.createElement('div', { className: 'w-full aspect-square bg-gray-200 rounded-lg mb-4 overflow-hidden' },
          // Artist image placeholder - will be loaded dynamically
        ),
        React.createElement('h3', { className: 'text-xl font-semibold text-gray-900 mb-2' }, searchPreviewItem.name),
        searchPreviewItem.disambiguation && React.createElement('p', { className: 'text-sm text-gray-500 mb-3' }, searchPreviewItem.disambiguation),
        React.createElement('p', { className: 'text-sm text-gray-600 line-clamp-4' }, 'Biography loading...'),
        React.createElement('button', { className: 'text-sm text-purple-600 hover:text-purple-700 mt-2' }, 'Read more')
      )
    : searchDetailCategory === 'tracks' ?
      // Track preview: album art + album metadata
      React.createElement('div', null,
        React.createElement('div', { className: 'w-full aspect-square bg-gray-200 rounded-lg mb-4 overflow-hidden' },
          // Album art
        ),
        React.createElement('h3', { className: 'text-xl font-semibold text-gray-900 mb-1' }, searchPreviewItem.album || 'Unknown Album'),
        React.createElement('p', { className: 'text-sm text-gray-600' }, searchPreviewItem.artist)
      )
    : searchDetailCategory === 'albums' ?
      // Album preview: album art + metadata
      React.createElement('div', null,
        React.createElement('div', { className: 'w-full aspect-square bg-gray-200 rounded-lg mb-4 overflow-hidden' },
          searchPreviewItem.albumArt && React.createElement('img', {
            src: searchPreviewItem.albumArt,
            alt: searchPreviewItem.title,
            className: 'w-full h-full object-cover'
          })
        ),
        React.createElement('h3', { className: 'text-xl font-semibold text-gray-900 mb-1' }, searchPreviewItem.title),
        React.createElement('p', { className: 'text-sm text-gray-600' }, searchPreviewItem['artist-credit']?.[0]?.name || 'Unknown'),
        React.createElement('p', { className: 'text-sm text-gray-500' }, searchPreviewItem['first-release-date']?.split('-')[0] || '')
      )
    : // Playlists preview: 2x2 grid + metadata
      React.createElement('div', null,
        React.createElement('div', { className: 'w-full aspect-square bg-gray-200 rounded-lg mb-4 grid grid-cols-2 gap-0.5 overflow-hidden' },
          // 2x2 playlist cover grid
        ),
        React.createElement('h3', { className: 'text-xl font-semibold text-gray-900 mb-1' }, searchPreviewItem.title),
        React.createElement('p', { className: 'text-sm text-gray-600' }, `${searchPreviewItem.tracks?.length || 0} tracks`)
      )
  ) : React.createElement('div', { className: 'text-gray-400 text-center py-12' }, 'No item selected')
)
```

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat: add preview pane to detail view"
```

---

## Task 7: Build Artists Results List

**Files:**
- Modify: `app.js` - artists tab content

**Step 1: Create artists results list**

Columns: # | Name | All Releases count | Songs count

```javascript
// Artists results list
searchDetailCategory === 'artists' && React.createElement('div', { className: 'flex-1 overflow-y-auto' },
  React.createElement('div', { className: 'px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100' }, 'SEARCH RESULTS'),
  searchResults.artists.map((artist, index) =>
    React.createElement('div', {
      key: artist.id,
      className: `flex items-center px-6 py-3 hover:bg-gray-50 cursor-pointer ${searchPreviewItem?.id === artist.id ? 'bg-gray-100' : ''}`,
      onMouseEnter: () => setSearchPreviewItem(artist),
      onMouseLeave: () => setSearchPreviewItem(searchResults.artists[0] || null),
      onClick: () => fetchArtistData(artist.name)
    },
      React.createElement('span', { className: 'w-10 text-sm text-gray-400' }, String(index + 1).padStart(2, '0')),
      React.createElement('span', { className: 'flex-1 font-medium text-gray-900' }, artist.name),
      React.createElement('span', { className: 'w-32 text-sm text-gray-500 text-right' }, `${artist['release-count'] || '-'} Albums`),
      React.createElement('span', { className: 'w-32 text-sm text-gray-500 text-right' }, `${artist['recording-count'] || '-'} songs`)
    )
  )
)
```

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat: add artists results list in detail view"
```

---

## Task 8: Build Tracks Results List

**Files:**
- Modify: `app.js` - tracks tab content

**Step 1: Create tracks results list**

Use the standard TrackRow component styling with resolver badges:

```javascript
// Tracks results list
searchDetailCategory === 'tracks' && React.createElement('div', { className: 'flex-1 overflow-y-auto' },
  React.createElement('div', { className: 'px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100' }, 'SEARCH RESULTS'),
  searchResults.tracks.map((track, index) =>
    React.createElement('div', {
      key: track.id,
      className: `flex items-center px-6 py-2 hover:bg-gray-50 cursor-pointer ${searchPreviewItem?.id === track.id ? 'bg-gray-100' : ''}`,
      onMouseEnter: () => setSearchPreviewItem(track),
      onMouseLeave: () => setSearchPreviewItem(searchResults.tracks[0] || null),
      onClick: () => handlePlay(track)
    },
      // Use TrackRow-style rendering with resolver badges
      React.createElement(TrackRow, {
        track: track,
        isPlaying: isPlaying && currentTrack?.id === track.id,
        handlePlay: handlePlay,
        onArtistClick: (artistName) => fetchArtistData(artistName),
        allResolvers: allResolvers,
        resolverOrder: resolverOrder,
        activeResolvers: activeResolvers
      })
    )
  )
)
```

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat: add tracks results list in detail view"
```

---

## Task 9: Build Albums Results List

**Files:**
- Modify: `app.js` - albums tab content

**Step 1: Create albums results list**

Columns: # | Title | Artist | Year | Release type

```javascript
// Albums results list
searchDetailCategory === 'albums' && React.createElement('div', { className: 'flex-1 overflow-y-auto' },
  React.createElement('div', { className: 'px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100' }, 'SEARCH RESULTS'),
  searchResults.albums.map((album, index) =>
    React.createElement('div', {
      key: album.id,
      className: `flex items-center px-6 py-3 hover:bg-gray-50 cursor-pointer ${searchPreviewItem?.id === album.id ? 'bg-gray-100' : ''}`,
      onMouseEnter: () => setSearchPreviewItem(album),
      onMouseLeave: () => setSearchPreviewItem(searchResults.albums[0] || null),
      onClick: () => handleAlbumClick(album)
    },
      React.createElement('span', { className: 'w-10 text-sm text-gray-400' }, String(index + 1).padStart(2, '0')),
      React.createElement('span', { className: 'flex-1 font-medium text-gray-900' }, album.title),
      React.createElement('span', { className: 'w-40 text-sm text-gray-600' }, album['artist-credit']?.[0]?.name || 'Unknown'),
      React.createElement('span', { className: 'w-20 text-sm text-gray-500 text-center' }, album['first-release-date']?.split('-')[0] || '-'),
      React.createElement('span', { className: 'w-24 text-sm text-gray-500 text-right capitalize' }, album['primary-type'] || 'Album')
    )
  )
)
```

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat: add albums results list in detail view"
```

---

## Task 10: Build Playlists Results List

**Files:**
- Modify: `app.js` - playlists tab content

**Step 1: Create playlists results list**

Columns: # | Title | Author Name | Track count

```javascript
// Playlists results list
searchDetailCategory === 'playlists' && React.createElement('div', { className: 'flex-1 overflow-y-auto' },
  React.createElement('div', { className: 'px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100' }, 'SEARCH RESULTS'),
  searchResults.playlists.map((playlist, index) =>
    React.createElement('div', {
      key: playlist.title,
      className: `flex items-center px-6 py-3 hover:bg-gray-50 cursor-pointer ${searchPreviewItem?.title === playlist.title ? 'bg-gray-100' : ''}`,
      onMouseEnter: () => setSearchPreviewItem(playlist),
      onMouseLeave: () => setSearchPreviewItem(searchResults.playlists[0] || null),
      onClick: () => handlePlaylistClick(playlist)
    },
      React.createElement('span', { className: 'w-10 text-sm text-gray-400' }, String(index + 1).padStart(2, '0')),
      React.createElement('span', { className: 'flex-1 font-medium text-gray-900' }, playlist.title),
      React.createElement('span', { className: 'w-40 text-sm text-gray-600' }, playlist.creator || '-'),
      React.createElement('span', { className: 'w-24 text-sm text-gray-500 text-right' }, `${playlist.tracks?.length || 0} tracks`)
    )
  )
)
```

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat: add playlists results list in detail view"
```

---

## Task 11: Add Infinite Scroll for Detail View

**Files:**
- Modify: `app.js` - add scroll handler for loading more results

**Step 1: Add scroll event handler**

Add an onScroll handler to the results list container that loads more results when near the bottom:

```javascript
const handleSearchDetailScroll = (e) => {
  const { scrollTop, scrollHeight, clientHeight } = e.target;
  // Load more when within 200px of bottom
  if (scrollHeight - scrollTop - clientHeight < 200) {
    handleLoadMore(searchDetailCategory);
  }
};
```

Apply this to each results list's parent container:
```javascript
React.createElement('div', {
  className: 'flex-1 overflow-y-auto',
  onScroll: handleSearchDetailScroll
}, ...)
```

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat: add infinite scroll to search detail view"
```

---

## Task 12: Enhance Artist Preview with Image and Bio

**Files:**
- Modify: `app.js` - artist preview pane

**Step 1: Fetch artist image on hover**

When an artist becomes the preview item, fetch their image using the existing `getArtistImage` function. Store in a local state or use the existing artist image cache.

**Step 2: Fetch artist bio snippet**

Use the existing Last.fm bio fetching logic (similar to artist page) but only get a short snippet.

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat: add artist image and bio to preview pane"
```

---

## Task 13: Test the Implementation

**Step 1: Manual testing checklist**

1. Click SEARCH in sidebar → shows main search page with hero header
2. Type a query → results appear in horizontal scroll sections
3. Click "Show more" on Artists → switches to detail view with Artists tab active
4. Tab counts show total result numbers
5. Hover over artist rows → preview pane updates with artist info
6. Mouse leave results list → preview reverts to first item
7. Click different tabs → switches result lists, preview updates
8. Click Close button → returns to main search view
9. Click an artist row → navigates to artist page
10. Scroll to bottom of results → more results load automatically
11. Type new query in detail view → results update in real-time

**Step 2: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found during testing"
```
