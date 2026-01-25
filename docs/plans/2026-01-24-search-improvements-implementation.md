# Search Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix typeahead race condition, add fuzzy re-ranking with popularity, persist search history, and support Lucene query syntax with typed filters.

**Architecture:** All changes in `app.js` (renderer) and `main.js` (IPC handlers). Search history persisted via electron-store. Fuzzy matching via fuse.js CDN. Query preprocessing maps user-friendly filters to MusicBrainz Lucene fields.

**Tech Stack:** React (createElement), electron-store, fuse.js (CDN), MusicBrainz Lucene query syntax.

---

## Task 1: Fix Typeahead Race Condition

**Files:**
- Modify: `app.js:1494-1527` (state declarations)
- Modify: `app.js:6220-6250` (handleSearchInput)
- Modify: `app.js:6337-6432` (performSearch)

**Step 1: Add refs for query tracking and abort controller**

Find the search state declarations around line 1494 in `app.js`. Add after `searchTimeoutRef`:

```javascript
const searchQueryRef = useRef('');
const abortControllerRef = useRef(null);
```

**Step 2: Update handleSearchInput to track current query**

In `handleSearchInput` (around line 6220), add after `setSearchQuery(value);`:

```javascript
searchQueryRef.current = value;
```

**Step 3: Update performSearch to use AbortController**

Replace the `performSearch` function (lines 6337-6432) with this version that cancels stale requests:

```javascript
const performSearch = async (query) => {
  // Cancel any in-flight request
  if (abortControllerRef.current) {
    abortControllerRef.current.abort();
  }
  abortControllerRef.current = new AbortController();
  const signal = abortControllerRef.current.signal;

  setIsSearching(true);
  const results = {
    artists: [],
    albums: [],
    tracks: [],
    playlists: []
  };

  try {
    const fetchOptions = {
      headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' },
      signal
    };

    // Search MusicBrainz for artists (fetch more than we initially display)
    const artistResponse = await fetch(
      `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(query)}&fmt=json&limit=25`,
      fetchOptions
    );
    if (artistResponse.ok) {
      const data = await artistResponse.json();
      const rawArtists = data.artists || [];

      // Deduplicate artists by name (case-insensitive)
      const seenArtists = new Set();
      results.artists = rawArtists.filter(artist => {
        const name = artist.name?.toLowerCase() || '';
        if (seenArtists.has(name)) return false;
        seenArtists.add(name);
        return true;
      });
    }

    // Check if query is still current before continuing
    if (query !== searchQueryRef.current) return;

    // Search MusicBrainz for albums (release-groups)
    const albumResponse = await fetch(
      `https://musicbrainz.org/ws/2/release-group?query=${encodeURIComponent(query)}&fmt=json&limit=30`,
      fetchOptions
    );
    if (albumResponse.ok) {
      const data = await albumResponse.json();
      const rawAlbums = data['release-groups'] || [];

      // Deduplicate albums by artist + title (case-insensitive)
      const seen = new Set();
      results.albums = rawAlbums.filter(album => {
        const artist = album['artist-credit']?.[0]?.name?.toLowerCase() || '';
        const title = album.title?.toLowerCase() || '';
        const key = `${artist}|${title}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    // Check if query is still current before continuing
    if (query !== searchQueryRef.current) return;

    // Search MusicBrainz for tracks (recordings)
    const trackResponse = await fetch(
      `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(query)}&fmt=json&limit=50`,
      fetchOptions
    );
    if (trackResponse.ok) {
      const data = await trackResponse.json();
      const recordings = data.recordings || [];

      // Only resolve the first batch of tracks for performance
      // Rest will be resolved on-demand when "Load more" is clicked or when played
      const initialBatchSize = 8;
      const trackPromises = recordings.slice(0, initialBatchSize).map(recording => resolveRecording(recording));
      const resolvedTracks = await Promise.all(trackPromises);

      // Store unresolved tracks without sources (will resolve on-demand)
      const unresolvedTracks = recordings.slice(initialBatchSize).map(recording => ({
        id: recording.id,
        title: recording.title,
        artist: recording['artist-credit']?.[0]?.name || 'Unknown',
        duration: Math.floor((recording.length || 180000) / 1000),
        album: recording.releases?.[0]?.title || '',
        releaseId: recording.releases?.[0]?.id || null,
        length: recording.length,
        sources: {}
      }));

      results.tracks = [...resolvedTracks, ...unresolvedTracks];
    }

    // Search local playlists
    results.playlists = playlists.filter(p =>
      p.title.toLowerCase().includes(query.toLowerCase())
    );

    // Final check: only update results if query is still current
    if (query !== searchQueryRef.current) return;

    setSearchResults(results);
    console.log('🔍 Search results:', results);

    // Fetch album art lazily in background (don't block search results)
    fetchSearchAlbumArt(results.albums, results.tracks);
  } catch (error) {
    // Ignore abort errors - these are expected when cancelling stale requests
    if (error.name === 'AbortError') {
      console.log('🔍 Search request cancelled (newer query in progress)');
      return;
    }
    console.error('Search error:', error);
  } finally {
    // Only clear loading state if this query is still current
    if (query === searchQueryRef.current) {
      setIsSearching(false);
    }
  }
};
```

**Step 4: Test the fix**

Run the app with `npm start`, go to search, type "beatles", then quickly backspace and type "rolling stones". The results should update correctly without showing stale "beatles" results.

**Step 5: Commit**

```bash
git add app.js
git commit -m "fix(search): resolve typeahead race condition with AbortController

Cancel in-flight requests when new search starts. Track current query
with ref and verify before updating results."
```

---

## Task 2: Add Fuse.js and Re-ranking Function

**Files:**
- Modify: `index.html` (add fuse.js CDN)
- Modify: `app.js` (add reRankResults function)

**Step 1: Add fuse.js CDN to index.html**

Find the script tags section in `index.html` (where React CDN is loaded). Add fuse.js before the app.js script:

```html
<script src="https://cdn.jsdelivr.net/npm/fuse.js@7.0.0/dist/fuse.min.js"></script>
```

**Step 2: Add reRankResults function to app.js**

Add this function after the `handleLoadMore` function (around line 6258):

```javascript
// Re-rank search results using fuzzy matching + MusicBrainz popularity score
const reRankResults = (items, query, nameKey = 'name') => {
  if (!items || items.length === 0 || !query) return items;

  // Configure Fuse.js for fuzzy matching
  const fuse = new Fuse(items, {
    keys: [nameKey],
    includeScore: true,
    threshold: 0.6,
    ignoreLocation: true,
    useExtendedSearch: false
  });

  const fuzzyResults = fuse.search(query);

  // Create a map of fuzzy scores (Fuse score is 0-1 where 0 is perfect match)
  const fuzzyScoreMap = new Map();
  fuzzyResults.forEach(result => {
    // Convert Fuse score (0=best, 1=worst) to 0-100 (100=best)
    fuzzyScoreMap.set(result.item, (1 - result.score) * 100);
  });

  // Score and sort all items
  return items
    .map(item => {
      const fuzzyScore = fuzzyScoreMap.get(item) || 0;
      const mbScore = item.score || 50; // MusicBrainz popularity score (0-100)
      // Blend: 60% fuzzy relevance, 40% popularity
      const finalScore = (fuzzyScore * 0.6) + (mbScore * 0.4);
      return { ...item, _finalScore: finalScore };
    })
    .sort((a, b) => b._finalScore - a._finalScore);
};
```

**Step 3: Apply re-ranking in performSearch**

In the `performSearch` function, after deduplicating artists (around where `results.artists = rawArtists.filter(...)` ends), add:

```javascript
// Re-rank artists with fuzzy matching + popularity
results.artists = reRankResults(results.artists, query, 'name');
```

After deduplicating albums, add:

```javascript
// Re-rank albums with fuzzy matching + popularity
results.albums = reRankResults(results.albums, query, 'title');
```

After creating `results.tracks`, add:

```javascript
// Re-rank tracks with fuzzy matching + popularity
results.tracks = reRankResults(results.tracks, query, 'title');
```

**Step 4: Test re-ranking**

Run the app, search for "bealtes" (misspelled). Results should still show Beatles content due to fuzzy matching, with more popular items ranked higher.

**Step 5: Commit**

```bash
git add index.html app.js
git commit -m "feat(search): add fuzzy re-ranking with fuse.js

Blend fuzzy match score (60%) with MusicBrainz popularity (40%)
to improve result relevance, especially for typos."
```

---

## Task 3: Add Search History IPC Handlers

**Files:**
- Modify: `main.js` (add IPC handlers for search history)

**Step 1: Add search history load handler**

After the playlist handlers section (around line 1540), add:

```javascript
// Search history handlers - stored in electron-store (search_history key)
ipcMain.handle('search-history-load', async () => {
  console.log('=== Load Search History from electron-store ===');
  try {
    const history = store.get('search_history') || [];
    console.log(`✅ Loaded ${history.length} search history entries`);
    return history;
  } catch (error) {
    console.error('Error loading search history:', error.message);
    return [];
  }
});
```

**Step 2: Add search history save handler**

Add after the load handler:

```javascript
ipcMain.handle('search-history-save', async (event, entry) => {
  console.log('=== Save Search History Entry ===');
  console.log('  Query:', entry?.query);

  try {
    const history = store.get('search_history') || [];
    const MAX_HISTORY = 50;

    // Check if this query already exists (case-insensitive)
    const existingIndex = history.findIndex(h =>
      h.query.toLowerCase() === entry.query.toLowerCase()
    );

    if (existingIndex >= 0) {
      // Update existing entry with new timestamp and selected result
      history[existingIndex] = {
        ...history[existingIndex],
        ...entry,
        timestamp: Date.now()
      };
      console.log('  ✅ Updated existing entry');
    } else {
      // Add new entry at the beginning
      history.unshift({
        ...entry,
        timestamp: Date.now()
      });
      console.log('  ✅ Added new entry');
    }

    // Trim to max size
    const trimmedHistory = history.slice(0, MAX_HISTORY);

    // Sort by timestamp descending (most recent first)
    trimmedHistory.sort((a, b) => b.timestamp - a.timestamp);

    store.set('search_history', trimmedHistory);
    console.log(`  ✅ Saved ${trimmedHistory.length} history entries`);
    return { success: true };
  } catch (error) {
    console.error('  ❌ Save failed:', error.message);
    return { success: false, error: error.message };
  }
});
```

**Step 3: Add search history clear handler**

Add after the save handler:

```javascript
ipcMain.handle('search-history-clear', async (event, entryQuery) => {
  console.log('=== Clear Search History ===');
  console.log('  Entry query:', entryQuery || 'ALL');

  try {
    if (entryQuery) {
      // Clear single entry
      const history = store.get('search_history') || [];
      const filtered = history.filter(h =>
        h.query.toLowerCase() !== entryQuery.toLowerCase()
      );
      store.set('search_history', filtered);
      console.log(`  ✅ Removed entry, ${filtered.length} remaining`);
    } else {
      // Clear all
      store.set('search_history', []);
      console.log('  ✅ Cleared all history');
    }
    return { success: true };
  } catch (error) {
    console.error('  ❌ Clear failed:', error.message);
    return { success: false, error: error.message };
  }
});
```

**Step 4: Commit**

```bash
git add main.js
git commit -m "feat(search): add electron-store IPC handlers for search history

Supports load, save (with deduplication), and clear operations.
Maintains max 50 entries sorted by recency."
```

---

## Task 4: Add Search History State and Functions in Renderer

**Files:**
- Modify: `app.js` (state, load/save functions)

**Step 1: Add search history state**

Find the search state declarations (around line 1494). Add:

```javascript
const [searchHistory, setSearchHistory] = useState([]);
```

**Step 2: Add loadSearchHistory function**

Add after the `handleSearchInput` function (around line 6250):

```javascript
// Load search history from electron-store
const loadSearchHistory = async () => {
  try {
    const history = await window.electron.invoke('search-history-load');
    setSearchHistory(history || []);
  } catch (error) {
    console.error('Failed to load search history:', error);
  }
};
```

**Step 3: Add saveSearchHistory function**

Add after `loadSearchHistory`:

```javascript
// Save a search history entry when user clicks a result
const saveSearchHistory = async (query, selectedResult) => {
  if (!query || query.trim().length < 2) return;

  const entry = {
    query: query.trim(),
    selectedResult: selectedResult ? {
      type: selectedResult.type,
      id: selectedResult.id,
      name: selectedResult.name || selectedResult.title,
      artist: selectedResult.artist,
      imageUrl: selectedResult.imageUrl || selectedResult.albumArt
    } : null
  };

  try {
    await window.electron.invoke('search-history-save', entry);
    // Reload history to reflect update
    loadSearchHistory();
  } catch (error) {
    console.error('Failed to save search history:', error);
  }
};
```

**Step 4: Add clearSearchHistory function**

Add after `saveSearchHistory`:

```javascript
// Clear search history (single entry or all)
const clearSearchHistory = async (entryQuery = null) => {
  try {
    await window.electron.invoke('search-history-clear', entryQuery);
    loadSearchHistory();
  } catch (error) {
    console.error('Failed to clear search history:', error);
  }
};
```

**Step 5: Load history on mount**

Find the main `useEffect` that runs on mount (the one that loads playlists, around line 3829-3853). Add inside it:

```javascript
// Load search history
loadSearchHistory();
```

**Step 6: Commit**

```bash
git add app.js
git commit -m "feat(search): add search history state and IPC functions

Load history on mount, save on result click, clear individual or all."
```

---

## Task 5: Wire Up History Saving on Result Clicks

**Files:**
- Modify: `app.js` (update click handlers)

**Step 1: Update artist click to save history**

Find where artist results are clicked in the search results UI. Look for `handleArtistClick` calls within the search page (around line 15200-15300). The artist card has an `onClick` handler.

In the `SearchArtistCard` component's onClick or wherever artists are clicked from search results, add history saving. Find the click handler and wrap or extend it:

```javascript
onClick: () => {
  // Save to search history before navigating
  saveSearchHistory(searchQuery, {
    type: 'artist',
    id: artist.id,
    name: artist.name,
    imageUrl: null // Will be populated later if we cache it
  });
  handleArtistClick(artist);
}
```

**Step 2: Update album click to save history**

Find where albums are clicked in search results (around line 15300-15400). Update the onClick:

```javascript
onClick: () => {
  saveSearchHistory(searchQuery, {
    type: 'album',
    id: album.id,
    name: album.title,
    artist: album['artist-credit']?.[0]?.name,
    imageUrl: album.albumArt
  });
  handleAlbumClick(album);
}
```

**Step 3: Update track click to save history**

Find where tracks are clicked in search results. Update the onClick for track rows:

```javascript
onClick: () => {
  saveSearchHistory(searchQuery, {
    type: 'track',
    id: track.id,
    name: track.title,
    artist: track.artist,
    imageUrl: null
  });
  // existing play/queue logic
}
```

**Step 4: Update playlist click to save history**

Find playlist clicks in search results. Update onClick:

```javascript
onClick: () => {
  saveSearchHistory(searchQuery, {
    type: 'playlist',
    id: playlist.id,
    name: playlist.title,
    imageUrl: null
  });
  handlePlaylistClick(playlist);
}
```

**Step 5: Test history saving**

Run the app, search for something, click a result. Check electron-store or restart app to verify history persisted.

**Step 6: Commit**

```bash
git add app.js
git commit -m "feat(search): save history when clicking search results

Records query + selected result for artists, albums, tracks, playlists."
```

---

## Task 6: Build Empty Search History UI

**Files:**
- Modify: `app.js` (search page empty state)

**Step 1: Create SearchHistoryItem component**

Add this component near the other search-related components (around line 600):

```javascript
// Search history item for empty search page
const SearchHistoryItem = ({ entry, onQueryClick, onResultClick, onRemove }) => {
  const { query, selectedResult, timestamp } = entry;

  return React.createElement('div', {
    className: 'flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 group transition-colors'
  },
    // Result thumbnail or search icon
    selectedResult?.imageUrl ?
      React.createElement('img', {
        src: selectedResult.imageUrl,
        className: 'w-12 h-12 rounded object-cover',
        onError: (e) => { e.target.style.display = 'none'; }
      }) :
      React.createElement('div', {
        className: 'w-12 h-12 rounded bg-gray-100 flex items-center justify-center'
      },
        React.createElement('svg', {
          className: 'w-5 h-5 text-gray-400',
          fill: 'none',
          stroke: 'currentColor',
          viewBox: '0 0 24 24'
        },
          React.createElement('path', {
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            strokeWidth: 2,
            d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'
          })
        )
      ),

    // Query and result info
    React.createElement('div', { className: 'flex-1 min-w-0' },
      React.createElement('button', {
        onClick: () => onQueryClick(query),
        className: 'text-sm font-medium text-gray-900 hover:text-blue-600 truncate block text-left w-full'
      }, `"${query}"`),
      selectedResult && React.createElement('button', {
        onClick: () => onResultClick(selectedResult),
        className: 'text-xs text-gray-500 hover:text-blue-600 truncate block text-left w-full'
      },
        `${selectedResult.type}: ${selectedResult.name}${selectedResult.artist ? ` • ${selectedResult.artist}` : ''}`
      )
    ),

    // Remove button
    React.createElement('button', {
      onClick: (e) => { e.stopPropagation(); onRemove(query); },
      className: 'opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-opacity'
    },
      React.createElement('svg', {
        className: 'w-4 h-4',
        fill: 'none',
        stroke: 'currentColor',
        viewBox: '0 0 24 24'
      },
        React.createElement('path', {
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          strokeWidth: 2,
          d: 'M6 18L18 6M6 6l12 12'
        })
      )
    )
  );
};
```

**Step 2: Replace skeleton loader with history when no query**

Find the empty state conditional in the search page (around line 15134 where it shows skeletons when `!searchQuery`). Replace the skeleton section to show history instead:

```javascript
// Show history when no query, skeletons when searching
(!searchQuery) ?
  // Search history view
  (searchHistory.length > 0 ?
    React.createElement('div', { className: 'space-y-4' },
      // Header with clear all button
      React.createElement('div', { className: 'flex items-center justify-between' },
        React.createElement('h3', {
          className: 'text-xs font-semibold text-gray-400 uppercase tracking-wider'
        }, 'Recent Searches'),
        React.createElement('button', {
          onClick: () => clearSearchHistory(),
          className: 'text-xs text-gray-400 hover:text-red-500 transition-colors'
        }, 'Clear All')
      ),
      // History list
      React.createElement('div', { className: 'space-y-1' },
        ...searchHistory.slice(0, 10).map((entry, i) =>
          React.createElement(SearchHistoryItem, {
            key: `history-${i}-${entry.query}`,
            entry,
            onQueryClick: (query) => {
              handleSearchInput(query);
            },
            onResultClick: (result) => {
              // Navigate directly to the result
              if (result.type === 'artist') {
                handleArtistClick({ id: result.id, name: result.name });
              } else if (result.type === 'album') {
                handleAlbumClick({ id: result.id, title: result.name, 'artist-credit': [{ name: result.artist }] });
              } else if (result.type === 'playlist') {
                const playlist = playlists.find(p => p.id === result.id);
                if (playlist) handlePlaylistClick(playlist);
              }
              // For tracks, just re-run the search
              else {
                handleSearchInput(entry.query);
              }
            },
            onRemove: (query) => clearSearchHistory(query)
          })
        )
      )
    ) :
    // No history yet - show placeholder
    React.createElement('div', { className: 'text-center py-12' },
      React.createElement('svg', {
        className: 'w-12 h-12 mx-auto text-gray-300 mb-4',
        fill: 'none',
        stroke: 'currentColor',
        viewBox: '0 0 24 24'
      },
        React.createElement('path', {
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          strokeWidth: 1.5,
          d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'
        })
      ),
      React.createElement('p', { className: 'text-gray-400 text-sm' }, 'Start typing to search')
    )
  ) :
isSearching ?
  // Loading skeletons (keep existing skeleton code)
  React.createElement('div', { className: 'space-y-10' },
    // ... existing skeleton code ...
```

**Step 3: Test history UI**

Run the app, go to search page. Should see history if you have any, or placeholder if empty. Click a query to re-search, click a result to navigate directly.

**Step 4: Commit**

```bash
git add app.js
git commit -m "feat(search): display search history on empty search page

Shows recent queries with selected results. Click query to re-search,
click result to navigate directly. Clear individual or all entries."
```

---

## Task 7: Add Query Preprocessing for Lucene Filters

**Files:**
- Modify: `app.js` (add preprocessQuery function, update performSearch)

**Step 1: Add preprocessQuery function**

Add this function before `performSearch` (around line 6330):

```javascript
// Preprocess search query for MusicBrainz Lucene syntax
// Maps user-friendly filters to MusicBrainz field names
const preprocessQuery = (query, endpoint) => {
  let processed = query;

  // Map album: to appropriate field based on endpoint
  if (endpoint === 'release-group') {
    processed = processed.replace(/\balbum:/gi, 'releasegroup:');
  } else if (endpoint === 'recording') {
    processed = processed.replace(/\balbum:/gi, 'release:');
  } else if (endpoint === 'artist') {
    // For artist endpoint, album: doesn't make sense - strip it
    processed = processed.replace(/\balbum:[^\s]*/gi, '').trim();
  }

  // Map track:/song: to recording: (only for recording endpoint)
  if (endpoint === 'recording') {
    processed = processed.replace(/\b(track|song):/gi, 'recording:');
  } else {
    // Strip track:/song: from non-recording endpoints
    processed = processed.replace(/\b(track|song):[^\s]*/gi, '').trim();
  }

  // Clean up any double spaces from removals
  processed = processed.replace(/\s+/g, ' ').trim();

  return processed;
};
```

**Step 2: Update performSearch to use preprocessQuery**

In `performSearch`, update each fetch URL to preprocess the query. Replace the artist fetch URL:

```javascript
const artistQuery = preprocessQuery(query, 'artist');
const artistResponse = await fetch(
  `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(artistQuery)}&fmt=json&limit=25`,
  fetchOptions
);
```

Replace the album fetch URL:

```javascript
const albumQuery = preprocessQuery(query, 'release-group');
const albumResponse = await fetch(
  `https://musicbrainz.org/ws/2/release-group?query=${encodeURIComponent(albumQuery)}&fmt=json&limit=30`,
  fetchOptions
);
```

Replace the track fetch URL:

```javascript
const trackQuery = preprocessQuery(query, 'recording');
const trackResponse = await fetch(
  `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(trackQuery)}&fmt=json&limit=50`,
  fetchOptions
);
```

**Step 3: Test Lucene queries**

Run the app and test:
- `"dark side of the moon"` - exact phrase match
- `artist:beatles` - field query
- `album:thriller artist:michael` - combined fields
- `beatles AND abbey` - boolean operator
- `track:yesterday` - maps to recording:yesterday

**Step 4: Commit**

```bash
git add app.js
git commit -m "feat(search): add Lucene query preprocessing with typed filters

Maps artist:, album:, track:, song: to MusicBrainz field syntax.
Passes through quotes, AND/OR/NOT, parentheses unchanged."
```

---

## Task 8: Final Testing and Polish

**Files:**
- All modified files

**Step 1: Test typeahead race condition**

- Type "beatles" quickly
- Backspace to "bea" then type "ch boys"
- Verify results show Beach Boys, not stale Beatles results

**Step 2: Test fuzzy matching**

- Search "bealtes" (misspelled) - should still find Beatles
- Search "pink flod" - should find Pink Floyd
- Verify popular artists appear higher than obscure ones

**Step 3: Test search history**

- Search and click various result types (artist, album, track, playlist)
- Restart app - verify history persists
- Click query to re-search
- Click result to navigate directly
- Clear individual entry
- Clear all

**Step 4: Test Lucene syntax**

- `"abbey road"` - exact phrase
- `artist:"pink floyd"` - exact artist
- `artist:beatles album:abbey` - combined
- `let it be AND beatles` - boolean
- `track:yesterday` - song filter

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(search): polish and bug fixes from testing"
```

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Fix typeahead race condition with AbortController |
| 2 | Add fuse.js and fuzzy re-ranking function |
| 3 | Add search history IPC handlers in main.js |
| 4 | Add search history state and functions in app.js |
| 5 | Wire up history saving on result clicks |
| 6 | Build empty search history UI |
| 7 | Add Lucene query preprocessing |
| 8 | Final testing and polish |
