# Search Full-Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the search drawer with a full-page search view featuring horizontal-scrolling result categories.

**Architecture:** Add `search` as a new view in the existing `activeView` routing system. The search page displays a large input at top with four horizontally-scrolling category sections (Artists, Tracks, Albums, Playlists). State clears on navigation away.

**Tech Stack:** React (createElement API), Tailwind CSS, existing MusicBrainz API integration

---

## Task 1: Remove searchDrawerOpen State and Update handleSearchInput

**Files:**
- Modify: `app.js:827` (state declaration)
- Modify: `app.js:2722-2754` (handleSearchInput function)

**Step 1: Remove searchDrawerOpen state declaration**

At line 827, delete:
```javascript
const [searchDrawerOpen, setSearchDrawerOpen] = useState(false);
```

**Step 2: Update handleSearchInput to navigate instead of opening drawer**

Replace the `handleSearchInput` function (lines 2722-2755) with:

```javascript
const handleSearchInput = (value) => {
  setSearchQuery(value);

  // Clear existing timeout
  if (searchTimeoutRef.current) {
    clearTimeout(searchTimeoutRef.current);
  }

  // Clear results if search cleared
  if (!value) {
    setSearchResults({ artists: [], albums: [], tracks: [], playlists: [] });
    setIsSearching(false);
    setDisplayLimits({ artists: 5, albums: 5, tracks: 8, playlists: 5 });
    return;
  }

  // Show loading state for responsive feel
  if (value.length >= 2) {
    setIsSearching(true);
  }

  // Reset pagination on new search
  setDisplayLimits({ artists: 5, albums: 5, tracks: 8, playlists: 5 });

  // Debounce search by 400ms
  searchTimeoutRef.current = setTimeout(() => {
    if (value.length >= 2) {
      performSearch(value);
    }
  }, 400);
};
```

**Step 3: Verify the changes compile**

Run: Open the app in Electron and check the console for errors.

**Step 4: Commit**

```bash
git add app.js
git commit -m "refactor: remove searchDrawerOpen state, update handleSearchInput for full-page search"
```

---

## Task 2: Update navigateTo to Clear Search State When Leaving Search View

**Files:**
- Modify: `app.js:5436-5444` (navigateTo function)

**Step 1: Update navigateTo function**

Replace lines 5436-5444 with:

```javascript
const navigateTo = (view) => {
  if (view !== activeView) {
    // Clear search state when leaving search view
    if (activeView === 'search') {
      setSearchQuery('');
      setSearchResults({ artists: [], albums: [], tracks: [], playlists: [] });
      setIsSearching(false);
      setDisplayLimits({ artists: 5, albums: 5, tracks: 8, playlists: 5 });
    }
    setViewHistory(prev => [...prev, view]);
    setActiveView(view);
    if (view === 'settings') {
      setSettingsTab('installed');
    }
  }
};
```

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat: clear search state when navigating away from search view"
```

---

## Task 3: Update Escape Key Handler for Search View

**Files:**
- Modify: `app.js:1861-1871` (keyboard shortcuts useEffect)

**Step 1: Update the Escape key handler**

Replace lines 1861-1871 with:

```javascript
// Keyboard shortcuts - Escape navigates back from search view
useEffect(() => {
  const handleKeyDown = (e) => {
    if (e.key === 'Escape' && activeView === 'search') {
      navigateBack();
    }
  };

  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [activeView]);
```

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat: escape key navigates back from search view"
```

---

## Task 4: Update Sidebar Search to Navigate to Search Page

**Files:**
- Modify: `app.js:6274-6292` (sidebar search section)

**Step 1: Replace the sidebar search input with a navigation button**

Replace lines 6274-6292 with:

```javascript
// Search - navigates to search page
React.createElement('div', { className: 'px-4 py-2' },
  React.createElement('button', {
    className: `w-full flex items-center gap-2 text-gray-500 hover:text-gray-700 cursor-pointer transition-colors ${
      activeView === 'search' ? 'text-gray-900 font-medium' : ''
    }`,
    onClick: () => navigateTo('search')
  },
    React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
    ),
    React.createElement('span', { className: 'text-sm' }, 'SEARCH')
  )
),
```

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat: sidebar search button navigates to search page"
```

---

## Task 5: Remove Search Drawer and Backdrop Code

**Files:**
- Modify: `app.js:6452-6642` (search drawer and backdrop)

**Step 1: Delete the search drawer code**

Delete lines 6452-6642 (the entire search drawer block and backdrop):
- Lines 6452-6635: The search drawer `div` starting with `searchDrawerOpen && React.createElement('div', {`
- Lines 6637-6642: The backdrop `div` starting with `searchDrawerOpen && React.createElement('div', {`

**Step 2: Commit**

```bash
git add app.js
git commit -m "refactor: remove search drawer and backdrop code"
```

---

## Task 6: Add Search Page View to Main Content Area

**Files:**
- Modify: `app.js` - Add after the External Track Prompt Modal (around line 6450), before the artist view

**Step 1: Add the search page view**

Insert the following code after the External Track Prompt Modal closing parenthesis (after line 6450), before the artist view (before `activeView === 'artist'`):

```javascript
// Search Page - Full page search view
activeView === 'search' ? React.createElement('div', {
  className: 'flex-1 flex flex-col overflow-hidden bg-gray-50'
},
  // Header with SEARCH title and Close button
  React.createElement('div', {
    className: 'flex items-center justify-between px-8 pt-6 pb-4'
  },
    React.createElement('span', {
      className: 'text-sm font-semibold text-gray-400 uppercase tracking-wider'
    }, 'SEARCH'),
    React.createElement('button', {
      onClick: () => navigateBack(),
      className: 'flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 transition-colors'
    },
      'CLOSE',
      React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M6 18L18 6M6 6l12 12' })
      )
    )
  ),

  // Large search input
  React.createElement('div', { className: 'px-8 pb-6' },
    React.createElement('input', {
      ref: (el) => el && activeView === 'search' && !searchQuery && el.focus(),
      type: 'text',
      value: searchQuery,
      onChange: (e) => handleSearchInput(e.target.value),
      placeholder: 'Search artists, tracks, albums...',
      className: 'w-full text-5xl font-light text-gray-900 bg-transparent border-none outline-none placeholder-gray-300',
      style: { caretColor: '#6b7280' }
    })
  ),

  // Scrollable results area
  React.createElement('div', {
    className: 'flex-1 overflow-y-auto px-8 pb-8 scrollable-content'
  },
    // Show skeletons when no query or loading
    !searchQuery || isSearching ? React.createElement('div', { className: 'space-y-8' },
      // Artists skeleton section
      React.createElement('div', null,
        React.createElement('h3', { className: 'text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4' }, 'ARTISTS'),
        React.createElement('div', { className: 'flex gap-4 overflow-x-auto pb-2' },
          ...Array(6).fill(null).map((_, i) =>
            React.createElement('div', { key: `artist-skeleton-${i}`, className: 'flex-shrink-0 w-44' },
              React.createElement('div', { className: 'w-44 h-24 bg-gray-200 rounded-lg animate-pulse mb-2' }),
              React.createElement('div', { className: 'h-4 bg-gray-200 rounded animate-pulse w-3/4' })
            )
          )
        )
      ),
      // Tracks skeleton section
      React.createElement('div', null,
        React.createElement('h3', { className: 'text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4' }, 'TRACKS'),
        React.createElement('div', { className: 'flex gap-4 overflow-x-auto pb-2' },
          ...Array(6).fill(null).map((_, i) =>
            React.createElement('div', { key: `track-skeleton-${i}`, className: 'flex-shrink-0 w-44' },
              React.createElement('div', { className: 'w-44 h-44 bg-gray-200 rounded-lg animate-pulse mb-2' }),
              React.createElement('div', { className: 'h-4 bg-gray-200 rounded animate-pulse w-3/4 mb-1' }),
              React.createElement('div', { className: 'h-3 bg-gray-200 rounded animate-pulse w-1/2' })
            )
          )
        )
      ),
      // Albums skeleton section
      React.createElement('div', null,
        React.createElement('h3', { className: 'text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4' }, 'ALBUMS'),
        React.createElement('div', { className: 'flex gap-4 overflow-x-auto pb-2' },
          ...Array(6).fill(null).map((_, i) =>
            React.createElement('div', { key: `album-skeleton-${i}`, className: 'flex-shrink-0 w-44' },
              React.createElement('div', { className: 'w-44 h-44 bg-gray-200 rounded-lg animate-pulse mb-2' }),
              React.createElement('div', { className: 'h-4 bg-gray-200 rounded animate-pulse w-3/4 mb-1' }),
              React.createElement('div', { className: 'h-3 bg-gray-200 rounded animate-pulse w-1/2' })
            )
          )
        )
      ),
      // Playlists skeleton section
      React.createElement('div', null,
        React.createElement('h3', { className: 'text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4' }, 'PLAYLISTS'),
        React.createElement('div', { className: 'flex gap-4 overflow-x-auto pb-2' },
          ...Array(6).fill(null).map((_, i) =>
            React.createElement('div', { key: `playlist-skeleton-${i}`, className: 'flex-shrink-0 w-44' },
              React.createElement('div', { className: 'w-44 h-24 bg-gray-200 rounded-lg animate-pulse mb-2' }),
              React.createElement('div', { className: 'h-4 bg-gray-200 rounded animate-pulse w-3/4' })
            )
          )
        )
      )
    )
    :
    // No results state
    searchResults.artists.length === 0 &&
    searchResults.albums.length === 0 &&
    searchResults.tracks.length === 0 &&
    searchResults.playlists.length === 0 ?
      React.createElement('div', { className: 'text-center py-12 text-gray-400' },
        `No results found for "${searchQuery}"`
      )
    :
    // Results
    React.createElement('div', { className: 'space-y-8' },
      // Artists section
      searchResults.artists.length > 0 && React.createElement('div', null,
        React.createElement('div', { className: 'flex items-center justify-between mb-4' },
          React.createElement('h3', { className: 'text-xs font-semibold text-gray-400 uppercase tracking-wider' }, 'ARTISTS'),
          displayLimits.artists < searchResults.artists.length &&
            React.createElement('button', {
              onClick: () => handleLoadMore('artists'),
              className: 'text-xs text-purple-600 hover:text-purple-700 font-medium'
            }, 'Show more')
        ),
        React.createElement('div', { className: 'flex gap-4 overflow-x-auto pb-2 scrollable-content' },
          ...searchResults.artists.slice(0, displayLimits.artists).map(artist =>
            React.createElement('button', {
              key: artist.id,
              onClick: () => fetchArtistData(artist.name),
              className: 'flex-shrink-0 w-44 text-left p-3 rounded-lg bg-white hover:bg-gray-100 transition-colors border border-gray-100'
            },
              React.createElement('div', { className: 'font-medium text-gray-900 truncate' }, artist.name),
              artist.disambiguation && React.createElement('div', { className: 'text-xs text-gray-500 truncate mt-1' }, artist.disambiguation)
            )
          )
        )
      ),

      // Tracks section
      searchResults.tracks.length > 0 && React.createElement('div', null,
        React.createElement('div', { className: 'flex items-center justify-between mb-4' },
          React.createElement('h3', { className: 'text-xs font-semibold text-gray-400 uppercase tracking-wider' }, 'TRACKS'),
          displayLimits.tracks < searchResults.tracks.length &&
            React.createElement('button', {
              onClick: () => handleLoadMore('tracks'),
              className: 'text-xs text-purple-600 hover:text-purple-700 font-medium'
            }, 'Show more')
        ),
        React.createElement('div', { className: 'flex gap-4 overflow-x-auto pb-2 scrollable-content' },
          ...searchResults.tracks.slice(0, displayLimits.tracks).map(track =>
            React.createElement('div', {
              key: track.id,
              className: 'flex-shrink-0 w-44'
            },
              React.createElement('button', {
                onClick: () => handlePlay(track),
                className: 'w-full text-left p-3 rounded-lg bg-white hover:bg-gray-100 transition-colors border border-gray-100'
              },
                // Track info
                React.createElement('div', { className: 'font-medium text-gray-900 truncate' }, track.title),
                React.createElement('div', { className: 'text-xs text-gray-500 truncate mt-1' }, track.artist),
                // Resolver badges
                track.sources && Object.keys(track.sources).length > 0 &&
                  React.createElement('div', { className: 'flex gap-1 mt-2 flex-wrap' },
                    ...Object.keys(track.sources).map(source => {
                      const colors = {
                        spotify: 'bg-green-100 text-green-700',
                        youtube: 'bg-red-100 text-red-700',
                        bandcamp: 'bg-cyan-100 text-cyan-700',
                        qobuz: 'bg-blue-100 text-blue-700'
                      };
                      return React.createElement('span', {
                        key: source,
                        className: `text-xs px-1.5 py-0.5 rounded ${colors[source] || 'bg-gray-100 text-gray-600'}`
                      }, source);
                    })
                  )
              )
            )
          )
        )
      ),

      // Albums section
      searchResults.albums.length > 0 && React.createElement('div', null,
        React.createElement('div', { className: 'flex items-center justify-between mb-4' },
          React.createElement('h3', { className: 'text-xs font-semibold text-gray-400 uppercase tracking-wider' }, 'ALBUMS'),
          displayLimits.albums < searchResults.albums.length &&
            React.createElement('button', {
              onClick: () => handleLoadMore('albums'),
              className: 'text-xs text-purple-600 hover:text-purple-700 font-medium'
            }, 'Show more')
        ),
        React.createElement('div', { className: 'flex gap-4 overflow-x-auto pb-2 scrollable-content' },
          ...searchResults.albums.slice(0, displayLimits.albums).map(album =>
            React.createElement('button', {
              key: album.id,
              onClick: () => handleAlbumClick(album),
              className: 'flex-shrink-0 w-44 text-left rounded-lg bg-white hover:bg-gray-100 transition-colors border border-gray-100 overflow-hidden'
            },
              // Album art
              React.createElement('div', { className: 'w-44 h-44 bg-gray-100 flex items-center justify-center' },
                album.albumArt ?
                  React.createElement('img', {
                    src: album.albumArt,
                    alt: album.title,
                    className: 'w-full h-full object-cover'
                  })
                :
                  React.createElement('span', { className: 'text-4xl text-gray-300' }, '💿')
              ),
              // Album info
              React.createElement('div', { className: 'p-3' },
                React.createElement('div', { className: 'font-medium text-gray-900 truncate' }, album.title),
                React.createElement('div', { className: 'text-xs text-gray-500 truncate mt-1' },
                  `${album['artist-credit']?.[0]?.name || 'Unknown'} • ${album['first-release-date']?.split('-')[0] || ''}`
                )
              )
            )
          )
        )
      ),

      // Playlists section
      searchResults.playlists.length > 0 && React.createElement('div', null,
        React.createElement('div', { className: 'flex items-center justify-between mb-4' },
          React.createElement('h3', { className: 'text-xs font-semibold text-gray-400 uppercase tracking-wider' }, 'PLAYLISTS'),
          displayLimits.playlists < searchResults.playlists.length &&
            React.createElement('button', {
              onClick: () => handleLoadMore('playlists'),
              className: 'text-xs text-purple-600 hover:text-purple-700 font-medium'
            }, 'Show more')
        ),
        React.createElement('div', { className: 'flex gap-4 overflow-x-auto pb-2 scrollable-content' },
          ...searchResults.playlists.slice(0, displayLimits.playlists).map(playlist =>
            React.createElement('button', {
              key: playlist.title,
              onClick: () => handlePlaylistClick(playlist),
              className: 'flex-shrink-0 w-44 text-left p-3 rounded-lg bg-white hover:bg-gray-100 transition-colors border border-gray-100'
            },
              React.createElement('div', { className: 'font-medium text-gray-900 truncate' }, playlist.title),
              React.createElement('div', { className: 'text-xs text-gray-500 truncate mt-1' },
                `${playlist.tracks?.length || 0} tracks`
              )
            )
          )
        )
      )
    )
  )
) :
```

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat: add search page view with horizontal scrolling categories"
```

---

## Task 7: Update Result Click Handlers to Clear State

**Files:**
- The search page code added in Task 6 already handles this via `navigateTo()` clearing state

**Step 1: Verify click handlers navigate properly**

The artist click calls `fetchArtistData(artist.name)` which internally calls `navigateTo('artist')`.
The album click calls `handleAlbumClick(album)` which navigates to the release page.
The playlist click calls `handlePlaylistClick(playlist)` which navigates to playlist view.

All these will trigger the state cleanup in `navigateTo()`.

**Step 2: No code changes needed, commit final verification**

```bash
git add -A
git commit -m "feat: complete search full-page implementation"
```

---

## Task 8: Test the Implementation

**Step 1: Manual testing checklist**

1. Click SEARCH in sidebar → navigates to search page
2. Search page shows skeleton loaders initially
3. Type a query → loading skeletons appear, then results
4. Results show in horizontal scroll rows: Artists, Tracks, Albums, Playlists
5. Click an artist → navigates to artist page, search state clears
6. Navigate back → search page is cleared (shows skeletons)
7. Press Escape → navigates back to previous page
8. Click Close button → navigates back to previous page
9. Clear search input → results clear but stay on page
10. Click sidebar nav item while on search → navigates and clears search state

**Step 2: Commit any fixes if needed**

```bash
git add -A
git commit -m "fix: address any issues found during testing"
```
