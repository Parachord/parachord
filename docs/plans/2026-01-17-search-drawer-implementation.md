# Global Search Drawer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable global search from any page with results displayed in a slide-down drawer organized by entity type (Artists, Albums, Tracks, Playlists).

**Architecture:** Replace existing library-only search with debounced MusicBrainz search API. Search drawer slides down from header with 300ms transition. Track results resolve through active resolvers. Clicking artists/albums navigates to pages, tracks play with drawer open.

**Tech Stack:** React hooks, MusicBrainz API, existing resolver system, Tailwind CSS

---

## Task 1: Add Search Drawer State

**Files:**
- Modify: `app.js:496-510` (Parachord component state section)

**Step 1: Add new state variables**

Locate the existing state declarations around line 496-510 and add new state for search drawer:

```javascript
// Existing states
const [searchQuery, setSearchQuery] = useState('');
const [searchResults, setSearchResults] = useState([]); // Will be changed to object
const [isSearching, setIsSearching] = useState(false);

// Add these new states after existing search states:
const [searchDrawerOpen, setSearchDrawerOpen] = useState(false);
const searchTimeoutRef = useRef(null);
```

**Step 2: Change searchResults structure**

Update the searchResults initialization to support entity grouping:

```javascript
// Change from:
const [searchResults, setSearchResults] = useState([]);

// To:
const [searchResults, setSearchResults] = useState({
  artists: [],
  albums: [],
  tracks: [],
  playlists: []
});
```

**Step 3: Verify state added correctly**

Check: No syntax errors, app still loads (won't break existing functionality)

**Step 4: Commit state changes**

```bash
git add app.js
git commit -m "feat(search): add search drawer state management

- Add searchDrawerOpen state for drawer visibility
- Add searchTimeoutRef for debouncing
- Change searchResults from array to object with entity types"
```

---

## Task 2: Create Debounced Search Input Handler

**Files:**
- Modify: `app.js:~1051` (replace existing handleSearch function)

**Step 1: Replace handleSearch with handleSearchInput**

Find the existing `handleSearch` function (around line 1051) and replace it with:

```javascript
const handleSearchInput = (value) => {
  setSearchQuery(value);

  // Clear existing timeout
  if (searchTimeoutRef.current) {
    clearTimeout(searchTimeoutRef.current);
  }

  // Close drawer if search cleared
  if (!value) {
    setSearchDrawerOpen(false);
    setSearchResults({ artists: [], albums: [], tracks: [], playlists: [] });
    return;
  }

  // Debounce search by 300ms
  searchTimeoutRef.current = setTimeout(() => {
    if (value.length >= 2) {
      performSearch(value);
      setSearchDrawerOpen(true);
    }
  }, 300);
};
```

**Step 2: Update search input onChange handler**

Find the search input element (around line 2582) and change:

```javascript
// From:
onChange: (e) => handleSearch(e.target.value),

// To:
onChange: (e) => handleSearchInput(e.target.value),
```

**Step 3: Test debouncing works**

Run app, type in search - should wait 300ms before searching

**Step 4: Commit input handler**

```bash
git add app.js
git commit -m "feat(search): add debounced search input handler

- Replace handleSearch with handleSearchInput
- Add 300ms debounce before triggering search
- Close drawer when search cleared
- Require minimum 2 characters"
```

---

## Task 3: Create Track Resolution Helper

**Files:**
- Modify: `app.js:~1100` (add new function after handleSearchInput)

**Step 1: Add resolveRecording function**

Add this function after handleSearchInput:

```javascript
const resolveRecording = async (recording) => {
  const track = {
    id: recording.id,
    title: recording.title,
    artist: recording['artist-credit']?.[0]?.name || 'Unknown',
    duration: Math.floor((recording.length || 180000) / 1000), // Convert ms to seconds
    album: recording.releases?.[0]?.title || '',
    sources: {}
  };

  // Query each active resolver (limit to first 2 to avoid slow searches)
  const resolversToTry = activeResolvers.slice(0, 2);

  for (const resolverId of resolversToTry) {
    const resolver = allResolvers.find(r => r.id === resolverId);
    if (!resolver?.capabilities.resolve) continue;

    try {
      const config = getResolverConfig(resolverId);
      const resolved = await resolver.resolve(track.artist, track.title, track.album, config);
      if (resolved) {
        track.sources[resolverId] = resolved;
      }
    } catch (error) {
      console.error(`Resolver ${resolverId} error:`, error);
    }
  }

  return track;
};
```

**Step 2: Verify function compiles**

Check: No syntax errors, app loads

**Step 3: Commit track resolution helper**

```bash
git add app.js
git commit -m "feat(search): add track resolution helper for MusicBrainz recordings

- Extract artist/title/duration from recording object
- Resolve through first 2 active resolvers for speed
- Return track with sources object for TrackRow compatibility"
```

---

## Task 4: Create MusicBrainz Search Function

**Files:**
- Modify: `app.js:~1150` (add new performSearch function)

**Step 1: Add performSearch function**

Add this function after resolveRecording:

```javascript
const performSearch = async (query) => {
  setIsSearching(true);
  const results = {
    artists: [],
    albums: [],
    tracks: [],
    playlists: []
  };

  try {
    // Search MusicBrainz for artists
    const artistResponse = await fetch(
      `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(query)}&fmt=json&limit=5`,
      { headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' }}
    );
    if (artistResponse.ok) {
      const data = await artistResponse.json();
      results.artists = data.artists || [];
    }

    // Search MusicBrainz for albums (release-groups)
    const albumResponse = await fetch(
      `https://musicbrainz.org/ws/2/release-group?query=${encodeURIComponent(query)}&fmt=json&limit=10`,
      { headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' }}
    );
    if (albumResponse.ok) {
      const data = await albumResponse.json();
      results.albums = data['release-groups'] || [];
    }

    // Search MusicBrainz for tracks (recordings) - limit to 5 for performance
    const trackResponse = await fetch(
      `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(query)}&fmt=json&limit=5`,
      { headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' }}
    );
    if (trackResponse.ok) {
      const data = await trackResponse.json();
      const recordings = data.recordings || [];

      // Resolve each recording (happens in parallel but limited to 2 resolvers each)
      const trackPromises = recordings.map(recording => resolveRecording(recording));
      results.tracks = await Promise.all(trackPromises);
    }

    // Search local playlists
    results.playlists = playlists.filter(p =>
      p.title.toLowerCase().includes(query.toLowerCase())
    );

    setSearchResults(results);
    console.log('🔍 Search results:', results);
  } catch (error) {
    console.error('Search error:', error);
  } finally {
    setIsSearching(false);
  }
};
```

**Step 2: Test search API calls**

Run app, search for "radiohead" - check console for results object

**Step 3: Commit MusicBrainz search**

```bash
git add app.js
git commit -m "feat(search): add MusicBrainz entity search

- Search artists (limit 5)
- Search albums/release-groups (limit 10)
- Search tracks/recordings (limit 5, resolve in parallel)
- Search local playlists by title match
- Log results for debugging"
```

---

## Task 5: Create Album Click Handler

**Files:**
- Modify: `app.js:~1400` (add new function after fetchReleaseData)

**Step 1: Add handleAlbumClick function**

Find fetchReleaseData function (around line 1400) and add this after it:

```javascript
// Handle album click from search - fetch release data by release-group ID
const handleAlbumClick = async (album) => {
  try {
    console.log('Fetching album from search:', album.title);

    // Get artist name from album
    const artistName = album['artist-credit']?.[0]?.name || 'Unknown Artist';

    // Create artist object
    const artist = {
      name: artistName,
      mbid: album['artist-credit']?.[0]?.artist?.id || null
    };

    // Fetch release data using the release-group ID
    // This reuses existing fetchReleaseData which handles the release-group -> release conversion
    await fetchReleaseData({ id: album.id, title: album.title }, artist);

    // Switch to artist view to show the release
    setActiveView('artist');
  } catch (error) {
    console.error('Error fetching album from search:', error);
    alert('Failed to load album. Please try again.');
  }
};
```

**Step 2: Verify function compiles**

Check: No syntax errors

**Step 3: Commit album handler**

```bash
git add app.js
git commit -m "feat(search): add album click handler for search results

- Extract artist from album artist-credit
- Reuse existing fetchReleaseData with release-group ID
- Switch to artist view when album clicked"
```

---

## Task 6: Create Playlist Click Handler

**Files:**
- Modify: `app.js:~1450` (add new function after handleAlbumClick)

**Step 1: Add handlePlaylistClick function**

Add this function after handleAlbumClick:

```javascript
// Handle playlist click from search
const handlePlaylistClick = (playlist) => {
  setSelectedPlaylist(playlist);
  setActiveView('playlists');

  // Load playlist tracks if not already loaded
  if (playlistTracks.length === 0 || playlistTracks[0]?.playlistTitle !== playlist.title) {
    // Playlist tracks will be loaded by the useEffect that watches selectedPlaylist
    console.log('Switched to playlist:', playlist.title);
  }
};
```

**Step 2: Verify function compiles**

Check: No syntax errors

**Step 3: Commit playlist handler**

```bash
git add app.js
git commit -m "feat(search): add playlist click handler for search results

- Set selected playlist and switch to playlists view
- Rely on existing useEffect to load playlist tracks"
```

---

## Task 7: Create Search Drawer UI Component

**Files:**
- Modify: `app.js:~2590` (add search drawer and backdrop after header, before main content)

**Step 1: Find header element location**

Search for the main header element (around line 2590). The search drawer should be added right after the closing tag of the header, before the main content div.

**Step 2: Add search drawer component**

After the header element closes (around line 2590), add:

```javascript
// Search Drawer - slides down from header
React.createElement('div', {
  className: `fixed left-0 right-0 bg-slate-900/95 backdrop-blur-md border-b border-white/20 shadow-2xl transition-all duration-300 ease-in-out z-30 overflow-hidden`,
  style: {
    top: '64px', // Below header
    height: '45vh',
    transform: searchDrawerOpen ? 'translateY(0)' : 'translateY(-100%)'
  }
},
  // Scrollable results container
  React.createElement('div', {
    className: 'h-full overflow-y-auto p-6 scrollable-content'
  },
    isSearching ?
      React.createElement('div', { className: 'text-center py-12 text-gray-400' },
        '🔍 Searching...'
      )
    :
    !searchQuery || (
      searchResults.artists.length === 0 &&
      searchResults.albums.length === 0 &&
      searchResults.tracks.length === 0 &&
      searchResults.playlists.length === 0
    ) ?
      React.createElement('div', { className: 'text-center py-12 text-gray-400' },
        searchQuery ? `No results found for "${searchQuery}"` : 'Type to search...'
      )
    :
    React.createElement('div', { className: 'space-y-6' },
      // Artists section
      searchResults.artists?.length > 0 && React.createElement('div', {},
        React.createElement('h3', { className: 'text-sm font-semibold text-gray-400 mb-3' },
          `🎤 Artists (${searchResults.artists.length})`
        ),
        React.createElement('div', { className: 'space-y-2' },
          searchResults.artists.map(artist =>
            React.createElement('button', {
              key: artist.id,
              onClick: () => {
                setSearchDrawerOpen(false);
                fetchArtistData(artist.name);
              },
              className: 'w-full text-left p-3 rounded-lg hover:bg-white/10 transition-colors'
            },
              React.createElement('div', { className: 'font-medium' }, artist.name),
              artist.disambiguation && React.createElement('div', { className: 'text-xs text-gray-500' }, artist.disambiguation)
            )
          )
        )
      ),

      // Albums section
      searchResults.albums?.length > 0 && React.createElement('div', {},
        React.createElement('h3', { className: 'text-sm font-semibold text-gray-400 mb-3' },
          `💿 Albums (${searchResults.albums.length})`
        ),
        React.createElement('div', { className: 'space-y-2' },
          searchResults.albums.map(album =>
            React.createElement('button', {
              key: album.id,
              onClick: () => {
                setSearchDrawerOpen(false);
                handleAlbumClick(album);
              },
              className: 'w-full text-left p-3 rounded-lg hover:bg-white/10 transition-colors'
            },
              React.createElement('div', { className: 'font-medium' }, album.title),
              React.createElement('div', { className: 'text-xs text-gray-500' },
                `${album['artist-credit']?.[0]?.name || 'Unknown'} • ${album['first-release-date']?.split('-')[0] || 'Unknown year'}`
              )
            )
          )
        )
      ),

      // Tracks section
      searchResults.tracks?.length > 0 && React.createElement('div', {},
        React.createElement('h3', { className: 'text-sm font-semibold text-gray-400 mb-3' },
          `🎵 Tracks (${searchResults.tracks.length})`
        ),
        React.createElement('div', { className: 'space-y-2' },
          searchResults.tracks.map(track =>
            React.createElement(TrackRow, {
              key: track.id,
              track: track,
              isPlaying: isPlaying && currentTrack?.id === track.id,
              handlePlay: handlePlay,
              onArtistClick: (artistName) => {
                setSearchDrawerOpen(false);
                fetchArtistData(artistName);
              }
            })
          )
        )
      ),

      // Playlists section
      searchResults.playlists?.length > 0 && React.createElement('div', {},
        React.createElement('h3', { className: 'text-sm font-semibold text-gray-400 mb-3' },
          `📋 Playlists (${searchResults.playlists.length})`
        ),
        React.createElement('div', { className: 'space-y-2' },
          searchResults.playlists.map(playlist =>
            React.createElement('button', {
              key: playlist.title,
              onClick: () => {
                setSearchDrawerOpen(false);
                handlePlaylistClick(playlist);
              },
              className: 'w-full text-left p-3 rounded-lg hover:bg-white/10 transition-colors'
            },
              React.createElement('div', { className: 'font-medium' }, playlist.title),
              React.createElement('div', { className: 'text-xs text-gray-500' },
                `${playlist.tracks?.length || 0} tracks`
              )
            )
          )
        )
      )
    )
  )
),

// Backdrop - click to close drawer
searchDrawerOpen && React.createElement('div', {
  onClick: () => setSearchDrawerOpen(false),
  className: 'fixed inset-0 bg-black/40 backdrop-blur-sm z-20',
  style: { top: '64px' }
})
```

**Step 3: Test drawer renders**

Run app, search for something - drawer should slide down

**Step 4: Commit search drawer UI**

```bash
git add app.js
git commit -m "feat(search): add search drawer UI component

- Slide-down drawer at 45vh height
- Display results grouped by entity type
- Artists/albums show name and metadata
- Tracks use existing TrackRow component
- Playlists show track count
- Backdrop click closes drawer
- Loading and empty states"
```

---

## Task 8: Add Keyboard Support (Escape Key)

**Files:**
- Modify: `app.js:~750` (add useEffect for keyboard listener)

**Step 1: Add escape key handler**

Find the useEffect hooks section (around line 750) and add:

```javascript
// Keyboard shortcuts - Escape closes search drawer
useEffect(() => {
  const handleKeyDown = (e) => {
    if (e.key === 'Escape' && searchDrawerOpen) {
      setSearchDrawerOpen(false);
    }
  };

  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [searchDrawerOpen]);
```

**Step 2: Test escape key**

Run app, open search drawer, press Escape - should close

**Step 3: Commit keyboard support**

```bash
git add app.js
git commit -m "feat(search): add Escape key to close search drawer

- Listen for Escape keydown when drawer is open
- Close drawer while preserving search query
- Clean up event listener on unmount"
```

---

## Task 9: Remove Old Library-Specific Search Display

**Files:**
- Modify: `app.js:~3170` (remove old search results display from library view)

**Step 1: Find old search results section**

Search for the library view rendering (around line 3170) where it shows `activeView === 'library'` and displays search results.

**Step 2: Simplify library view**

The library view should no longer conditionally show search results. Change it to always show the library (no searchQuery branching):

```javascript
// From:
activeView === 'library' && !isSearching && React.createElement('div', { className: 'space-y-2' },
  getFilteredResults().length === 0 && searchQuery ?
    React.createElement('div', { className: 'text-center py-12 text-gray-400' },
      resultFilters.length < activeResolvers.length ?
        '🔍 No results from selected sources. Try clicking more filter badges above.' :
        '🔍 No results found for "' + searchQuery + '"'
    )
  :
  getFilteredResults().map(track => ...)
),

// To:
activeView === 'library' && React.createElement('div', { className: 'space-y-2' },
  library.length === 0 ?
    React.createElement('div', { className: 'text-center py-12 text-gray-400' },
      'Your library is empty. Search for music to add tracks!'
    )
  :
  library.map(track =>
    React.createElement(TrackRow, {
      key: track.id,
      track: track,
      isPlaying: isPlaying && currentTrack?.id === track.id,
      handlePlay: (track) => {
        setCurrentQueue(library);
        handlePlay(track);
      },
      onArtistClick: fetchArtistData
    })
  )
),
```

**Step 3: Remove old search logic**

Also remove the `getFilteredResults()` function if it's only used for search (check if library uses it for filtering).

**Step 4: Test library view**

Run app, go to library - should show library tracks only, not search results

**Step 5: Commit library view cleanup**

```bash
git add app.js
git commit -m "refactor(search): remove library-specific search results display

- Library view now always shows library tracks
- Search results only appear in drawer
- Remove searchQuery branching from library view
- Simplify empty state messaging"
```

---

## Task 10: Test Complete Search Flow

**Files:**
- None (manual testing)

**Step 1: Test artist search and navigation**

1. Search for "radiohead"
2. Verify drawer slides down
3. Click an artist result
4. Verify drawer closes and artist page loads

**Step 2: Test album search and navigation**

1. Search for "ok computer"
2. Click an album result
3. Verify drawer closes and album page loads with tracks

**Step 3: Test track search and playback**

1. Search for "karma police"
2. Click a track result
3. Verify track starts playing
4. Verify drawer stays open

**Step 4: Test playlist search**

1. Search for playlist name
2. Click playlist result
3. Verify drawer closes and playlist view loads

**Step 5: Test keyboard and backdrop**

1. Open drawer with search
2. Press Escape - drawer should close, query should remain
3. Open drawer again
4. Click backdrop - drawer should close

**Step 6: Test debouncing**

1. Type fast in search box
2. Verify search doesn't trigger until 300ms after stopping
3. Verify < 2 characters doesn't trigger search

**Step 7: Test from different pages**

1. Navigate to artist page
2. Search from there - drawer should work
3. Navigate to playlist page
4. Search from there - drawer should work

**Step 8: Document any bugs found**

Create issues for any problems discovered during testing

**Step 9: Final commit**

```bash
git add .
git commit -m "test: verify global search drawer functionality

Manual testing completed:
- Artist/album/playlist navigation ✓
- Track playback with drawer open ✓
- Keyboard (Escape) and backdrop close ✓
- Debouncing and character minimum ✓
- Works from all pages ✓"
```

---

## Success Criteria Checklist

Test these before considering the feature complete:

- [ ] Search works from any page (library, artist, playlist views)
- [ ] Results appear in slide-down drawer with 300ms debounce
- [ ] Minimum 2 characters required to trigger search
- [ ] Clicking artists navigates to artist discography page
- [ ] Clicking albums navigates to album page with tracks
- [ ] Clicking tracks plays them with drawer staying open
- [ ] Clicking playlists navigates to playlist view
- [ ] Drawer closes on backdrop click
- [ ] Drawer closes on Escape key press
- [ ] Search query persists when drawer closes
- [ ] Tracks resolve through active resolvers with resolver badges
- [ ] Empty states show appropriate messages
- [ ] Loading state shows while searching
- [ ] No console errors during search flow

---

## Notes

- **Performance**: Limited track results to 5 with only 2 resolvers each to keep search fast
- **Rate limiting**: MusicBrainz requests already have rate limiting in existing code
- **Error handling**: All API calls have try/catch with console logging
- **Code reuse**: Uses existing TrackRow, fetchArtistData, fetchReleaseData
- **DRY**: Minimal new code, maximum reuse of existing patterns
- **YAGNI**: No caching, history, or advanced features - just core functionality
