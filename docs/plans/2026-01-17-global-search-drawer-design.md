# Global Search Drawer Design

**Date:** 2026-01-17
**Status:** Approved
**Goal:** Enable search from any page in the app with results displayed in a slide-down drawer

---

## Problem

Currently, search only works when viewing the "My Library" tab. The search bar is globally visible in the header, but typing a query while on artist pages, playlists, or other views produces no results. This creates a confusing UX where the search input is accessible but non-functional depending on context.

## Solution Overview

Implement a global search drawer that slides down from the header, overlaying the current page. Search results are organized by entity type (Artists, Albums, Tracks, Playlists) and clicking results navigates to the appropriate page or plays the track while keeping the drawer open.

---

## User Experience

### Search Input Behavior
- Search bar remains in top header (globally visible)
- 300ms debounce after user stops typing before triggering search
- Minimum 2 characters required to trigger search
- Subtle loading indicator in input while searching
- Clearing search closes the drawer

### Drawer Presentation
- Fixed height at 45% of viewport
- Slides down from below header with 300ms transition
- Semi-transparent dark backdrop with blur effect
- Internal scrolling for results
- Click backdrop or press Escape to close (keeps search query)
- Drawer stays open when clicking tracks (for browsing/queueing)
- Drawer closes when navigating to artist/album/playlist pages

### Search Result Types

Results are grouped into four entity types:

**🎤 Artists**
- Source: MusicBrainz artist search (limit: 5)
- Display: Artist name
- Click: Close drawer → navigate to artist discography page

**💿 Albums**
- Source: MusicBrainz release-group search (limit: 10)
- Display: Album title - Artist name
- Click: Close drawer → navigate to album/release page

**🎵 Tracks**
- Source: MusicBrainz recording search (limit: 15)
- Resolution: Each track resolved through active resolvers (Spotify, YouTube, etc.)
- Display: Reuse `TrackRow` component with resolver badges
- Click: Play track, drawer stays open

**📋 Playlists**
- Source: Local playlist files
- Display: Playlist name
- Click: Close drawer → navigate to playlist view

---

## Technical Architecture

### State Management

```javascript
const [searchQuery, setSearchQuery] = useState('');
const [searchDrawerOpen, setSearchDrawerOpen] = useState(false);
const [isSearching, setIsSearching] = useState(false);
const [searchResults, setSearchResults] = useState({
  artists: [],
  albums: [],
  tracks: [],
  playlists: []
});
const searchTimeoutRef = useRef(null);
```

### Debounced Search Handler

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

### Search Implementation

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
      { headers: { 'User-Agent': 'Parachord/1.0.0' }}
    );
    if (artistResponse.ok) {
      const data = await artistResponse.json();
      results.artists = data.artists || [];
    }

    // Search MusicBrainz for albums (release-groups)
    const albumResponse = await fetch(
      `https://musicbrainz.org/ws/2/release-group?query=${encodeURIComponent(query)}&fmt=json&limit=10`,
      { headers: { 'User-Agent': 'Parachord/1.0.0' }}
    );
    if (albumResponse.ok) {
      const data = await albumResponse.json();
      results.albums = data['release-groups'] || [];
    }

    // Search MusicBrainz for tracks (recordings)
    const trackResponse = await fetch(
      `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(query)}&fmt=json&limit=15`,
      { headers: { 'User-Agent': 'Parachord/1.0.0' }}
    );
    if (trackResponse.ok) {
      const data = await trackResponse.json();
      const recordings = data.recordings || [];

      // For each recording, resolve with active resolvers
      for (const recording of recordings) {
        const trackWithSources = await resolveRecording(recording);
        results.tracks.push(trackWithSources);
      }
    }

    // Search local playlists
    results.playlists = playlists.filter(p =>
      p.title.toLowerCase().includes(query.toLowerCase())
    );

    setSearchResults(results);
  } catch (error) {
    console.error('Search error:', error);
  } finally {
    setIsSearching(false);
  }
};
```

### Track Resolution

```javascript
const resolveRecording = async (recording) => {
  const track = {
    id: recording.id,
    title: recording.title,
    artist: recording['artist-credit']?.[0]?.name || 'Unknown',
    duration: Math.floor(recording.length / 1000) || 180,
    sources: {}
  };

  // Query each active resolver
  for (const resolverId of activeResolvers) {
    const resolver = allResolvers.find(r => r.id === resolverId);
    if (!resolver?.capabilities.resolve) continue;

    try {
      const config = getResolverConfig(resolverId);
      const resolved = await resolver.resolve(track.artist, track.title, '', config);
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

### UI Component Structure

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
            }, artist.name)
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
                // Will need album click handler - similar to fetchReleaseData
                handleAlbumClick(album);
              },
              className: 'w-full text-left p-3 rounded-lg hover:bg-white/10 transition-colors'
            },
              `${album.title} - ${album['artist-credit']?.[0]?.name || 'Unknown'}`
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
            }, playlist.title)
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

---

## Implementation Notes

### Reuse Existing Patterns
- Track resolution: Same pattern as artist/album page track loading
- Navigation: Reuse `fetchArtistData()` and `fetchReleaseData()`
- UI components: Reuse `TrackRow` for track results

### New Handlers Needed
- `handleAlbumClick(album)`: Navigate to album from search (fetch release data by release-group ID)
- `handlePlaylistClick(playlist)`: Navigate to playlist from search

### Performance Considerations
- Debouncing reduces API calls while typing
- Progressive loading: Show results as each section completes
- Track resolution happens asynchronously (may show "Resolving..." state)
- MusicBrainz rate limiting: 1 second between requests (already implemented)

### Keyboard Support
- Escape key closes drawer (keeps search query)
- Can navigate app with arrow keys/tab while drawer open

### Z-index Hierarchy
```
z-50: Settings panel
z-40: Embedded player drawer
z-30: Search drawer
z-20: Search backdrop
z-10: Main content
```

---

## Future Enhancements (Out of Scope)

- Search within current artist/album (context-aware search)
- Search history/recent searches
- Keyboard navigation within search results
- "Search powered by MusicBrainz" attribution
- Cache search results for repeated queries
- Advanced search filters (by year, type, etc.)

---

## Success Criteria

✅ Search works from any page in the app
✅ Results appear in slide-down drawer with 300ms debounce
✅ Clicking artists/albums navigates to their pages
✅ Clicking tracks plays them with drawer staying open
✅ Drawer closes on backdrop click or Escape key
✅ Search query persists when drawer closes
✅ Tracks resolve through active resolvers like existing track rows
