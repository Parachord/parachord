# Collection Drag-and-Drop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable dragging albums, artists, and tracks onto the Collection sidebar item to add them as favorites, with three independent collection lists persisted to disk.

**Architecture:** Add Electron IPC handlers for collection persistence (JSON files). Create a toast notification system. Add drag handlers to album/artist elements. Make Collection sidebar item a drop zone. Refactor Collection view to use persisted lists instead of deriving from library.

**Tech Stack:** React (createElement), Electron IPC, JSON file storage

---

## Task 1: Add Electron IPC Handlers for Collection Persistence

**Files:**
- Modify: `main.js` (after line ~1406, after localFiles handlers)
- Modify: `preload.js` (after line ~131, after localFiles section)

**Step 1: Add collection IPC handlers to main.js**

Add after the `localFiles:saveId3Tags` handler (~line 1406):

```javascript
// Collection handlers
ipcMain.handle('collection:load', async () => {
  console.log('=== Load Collection ===');
  const fs = require('fs').promises;
  const path = require('path');

  const collectionPath = path.join(__dirname, 'collection.json');

  try {
    const content = await fs.readFile(collectionPath, 'utf8');
    const data = JSON.parse(content);
    console.log(`✅ Loaded collection: ${data.tracks?.length || 0} tracks, ${data.albums?.length || 0} albums, ${data.artists?.length || 0} artists`);
    return data;
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('  No collection file found, returning empty collection');
      return { tracks: [], albums: [], artists: [] };
    }
    console.error('  ❌ Load failed:', error.message);
    return { tracks: [], albums: [], artists: [] };
  }
});

ipcMain.handle('collection:save', async (event, collection) => {
  console.log('=== Save Collection ===');
  const fs = require('fs').promises;
  const path = require('path');

  try {
    const collectionPath = path.join(__dirname, 'collection.json');
    await fs.writeFile(collectionPath, JSON.stringify(collection, null, 2), 'utf8');
    console.log(`✅ Saved collection: ${collection.tracks?.length || 0} tracks, ${collection.albums?.length || 0} albums, ${collection.artists?.length || 0} artists`);
    return { success: true };
  } catch (error) {
    console.error('  ❌ Save failed:', error.message);
    return { success: false, error: error.message };
  }
});
```

**Step 2: Add collection API to preload.js**

Add after the `localFiles` section (~line 131):

```javascript
  // Collection operations (favorites)
  collection: {
    load: () => ipcRenderer.invoke('collection:load'),
    save: (collection) => ipcRenderer.invoke('collection:save', collection)
  },
```

**Step 3: Verify changes compile**

Run: `npm start` and check console for no errors on startup

**Step 4: Commit**

```bash
git add main.js preload.js
git commit -m "feat(collection): add Electron IPC handlers for collection persistence"
```

---

## Task 2: Add Toast Notification System

**Files:**
- Modify: `app.js` (state declarations ~line 1497, and render ~line 7900)

**Step 1: Add toast state**

Add after `draggingTrackForPlaylist` state (~line 1497):

```javascript
  const [toast, setToast] = useState(null); // { message: string, type: 'success' | 'error' }
```

**Step 2: Add toast auto-dismiss effect**

Add after existing useEffect blocks (around line 2700):

```javascript
  // Auto-dismiss toast after 3 seconds
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
```

**Step 3: Add showToast helper function**

Add after the toast effect:

```javascript
  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
  }, []);
```

**Step 4: Add toast UI component**

Add just before the closing fragment in the return statement (find `// Main content area` around line 8090, add before the main wrapper div):

```javascript
      // Toast notification
      toast && React.createElement('div', {
        className: `fixed bottom-24 left-1/2 transform -translate-x-1/2 z-50 px-4 py-2 rounded-lg shadow-lg transition-all ${
          toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-gray-900 text-white'
        }`
      }, toast.message),
```

**Step 5: Test toast manually**

Add temporary test in console: `showToast('Test toast')` - verify it appears and auto-dismisses

**Step 6: Commit**

```bash
git add app.js
git commit -m "feat(ui): add toast notification system"
```

---

## Task 3: Add Collection State and Load/Save Logic

**Files:**
- Modify: `app.js`

**Step 1: Add collection state**

Add after toast state:

```javascript
  const [collectionData, setCollectionData] = useState({ tracks: [], albums: [], artists: [] });
  const [collectionLoading, setCollectionLoading] = useState(true);
```

**Step 2: Add collection load effect**

Add after the library loading effect (~line 2442):

```javascript
  // Load collection data on startup
  useEffect(() => {
    const loadCollection = async () => {
      if (window.electron?.collection?.load) {
        try {
          const data = await window.electron.collection.load();
          setCollectionData(data);
        } catch (error) {
          console.error('Failed to load collection:', error);
        }
      }
      setCollectionLoading(false);
    };
    loadCollection();
  }, []);
```

**Step 3: Add collection save helper**

Add after the load effect:

```javascript
  // Save collection to disk
  const saveCollection = useCallback(async (newData) => {
    setCollectionData(newData);
    if (window.electron?.collection?.save) {
      await window.electron.collection.save(newData);
    }
  }, []);
```

**Step 4: Add helper functions to add items to collection**

```javascript
  // Add track to collection
  const addTrackToCollection = useCallback((track) => {
    const trackId = `${track.artist || 'unknown'}-${track.title || 'untitled'}-${track.album || 'noalbum'}`.toLowerCase().replace(/[^a-z0-9-]/g, '');

    setCollectionData(prev => {
      // Check for duplicate
      if (prev.tracks.some(t => t.id === trackId)) {
        showToast(`${track.title} is already in your collection`);
        return prev;
      }

      const newTrack = {
        id: trackId,
        title: track.title,
        artist: track.artist,
        album: track.album,
        duration: track.duration,
        albumArt: track.albumArt,
        sources: track.sources || {},
        addedAt: Date.now()
      };

      const newData = { ...prev, tracks: [...prev.tracks, newTrack] };
      saveCollection(newData);
      showToast(`Added ${track.title} to Collection`);
      return newData;
    });
  }, [saveCollection, showToast]);

  // Add album to collection
  const addAlbumToCollection = useCallback((album) => {
    const albumId = `${album.artist || 'unknown'}-${album.title || 'untitled'}`.toLowerCase().replace(/[^a-z0-9-]/g, '');

    setCollectionData(prev => {
      // Check for duplicate
      if (prev.albums.some(a => a.id === albumId)) {
        showToast(`${album.title} is already in your collection`);
        return prev;
      }

      const newAlbum = {
        id: albumId,
        title: album.title,
        artist: album.artist,
        year: album.year || null,
        art: album.art || album.albumArt || null,
        addedAt: Date.now()
      };

      const newData = { ...prev, albums: [...prev.albums, newAlbum] };
      saveCollection(newData);
      showToast(`Added ${album.title} to Collection`);
      return newData;
    });
  }, [saveCollection, showToast]);

  // Add artist to collection
  const addArtistToCollection = useCallback((artist) => {
    const artistId = (artist.name || 'unknown').toLowerCase().replace(/[^a-z0-9-]/g, '');

    setCollectionData(prev => {
      // Check for duplicate
      if (prev.artists.some(a => a.id === artistId)) {
        showToast(`${artist.name} is already in your collection`);
        return prev;
      }

      const newArtist = {
        id: artistId,
        name: artist.name,
        image: artist.image || null,
        addedAt: Date.now()
      };

      const newData = { ...prev, artists: [...prev.artists, newArtist] };
      saveCollection(newData);
      showToast(`Added ${artist.name} to Collection`);
      return newData;
    });
  }, [saveCollection, showToast]);

  // Add multiple tracks to collection
  const addTracksToCollection = useCallback((tracks) => {
    let addedCount = 0;

    setCollectionData(prev => {
      const newTracks = [...prev.tracks];

      tracks.forEach(track => {
        const trackId = `${track.artist || 'unknown'}-${track.title || 'untitled'}-${track.album || 'noalbum'}`.toLowerCase().replace(/[^a-z0-9-]/g, '');

        if (!newTracks.some(t => t.id === trackId)) {
          newTracks.push({
            id: trackId,
            title: track.title,
            artist: track.artist,
            album: track.album,
            duration: track.duration,
            albumArt: track.albumArt,
            sources: track.sources || {},
            addedAt: Date.now()
          });
          addedCount++;
        }
      });

      if (addedCount === 0) {
        showToast('Tracks are already in your collection');
        return prev;
      }

      const newData = { ...prev, tracks: newTracks };
      saveCollection(newData);
      showToast(`Added ${addedCount} track${addedCount !== 1 ? 's' : ''} to Collection`);
      return newData;
    });
  }, [saveCollection, showToast]);
```

**Step 5: Commit**

```bash
git add app.js
git commit -m "feat(collection): add collection state management and persistence"
```

---

## Task 4: Add Drop Zone State for Collection Sidebar

**Files:**
- Modify: `app.js`

**Step 1: Add drop zone state**

Add after collection state:

```javascript
  const [collectionDropHighlight, setCollectionDropHighlight] = useState(false);
```

**Step 2: Add drop handler function**

Add after the addTracksToCollection function:

```javascript
  // Handle drop on collection sidebar
  const handleCollectionDrop = useCallback((e) => {
    e.preventDefault();
    setCollectionDropHighlight(false);

    try {
      const data = e.dataTransfer.getData('text/plain');
      if (!data) return;

      const parsed = JSON.parse(data);

      if (parsed.type === 'track') {
        addTrackToCollection(parsed.track);
      } else if (parsed.type === 'album') {
        addAlbumToCollection(parsed.album);
      } else if (parsed.type === 'artist') {
        addArtistToCollection(parsed.artist);
      } else if (parsed.type === 'tracks') {
        addTracksToCollection(parsed.tracks);
      }
    } catch (error) {
      console.error('Failed to parse drop data:', error);
    }
  }, [addTrackToCollection, addAlbumToCollection, addArtistToCollection, addTracksToCollection]);
```

**Step 3: Update Collection sidebar button with drop handlers**

Find the Collection button in sidebar (~line 8030) and update it:

```javascript
            React.createElement('button', {
              onClick: () => navigateTo('library'),
              onDragOver: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; },
              onDragEnter: (e) => { e.preventDefault(); setCollectionDropHighlight(true); },
              onDragLeave: (e) => { e.preventDefault(); setCollectionDropHighlight(false); },
              onDrop: handleCollectionDrop,
              className: `w-full flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors ${
                collectionDropHighlight ? 'bg-purple-100 border-2 border-purple-400 text-purple-700' :
                activeView === 'library' ? 'bg-gray-200 text-gray-900 font-medium' : 'text-gray-600 hover:bg-gray-100'
              }`
            },
```

**Step 4: Commit**

```bash
git add app.js
git commit -m "feat(collection): add drop zone to Collection sidebar item"
```

---

## Task 5: Make Album Art on Release Page Draggable

**Files:**
- Modify: `app.js` (ReleaseTracklist component ~line 743)

**Step 1: Find album art container in release view**

Find the album art div (~line 743) that shows `release.albumArt`. Wrap it with drag handlers:

```javascript
      // Album art container - make draggable
      React.createElement('div', {
        draggable: true,
        onDragStart: (e) => {
          e.dataTransfer.effectAllowed = 'copy';
          const albumData = {
            type: 'album',
            album: {
              id: `${release.artist?.name || 'unknown'}-${release.title || 'untitled'}`.toLowerCase().replace(/[^a-z0-9-]/g, ''),
              title: release.title,
              artist: release.artist?.name,
              year: release.date?.split('-')[0] || null,
              art: release.albumArt
            }
          };
          e.dataTransfer.setData('text/plain', JSON.stringify(albumData));
        },
        className: 'w-48 h-48 rounded bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center shadow-lg relative overflow-hidden cursor-grab active:cursor-grabbing'
      },
```

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat(collection): make release page album art draggable"
```

---

## Task 6: Make ReleaseCard Component Draggable

**Files:**
- Modify: `app.js` (ReleaseCard component ~line 558)

**Step 1: Add draggable props to ReleaseCard outer div**

Find the ReleaseCard component and update the card's outer element to be draggable:

```javascript
const ReleaseCard = ({ release, currentArtist, fetchReleaseData, onContextMenu, onHoverFetch, isVisible = true }) => {
  const year = release.date ? release.date.split('-')[0] : 'Unknown';

  const handleDragStart = (e) => {
    e.dataTransfer.effectAllowed = 'copy';
    const albumData = {
      type: 'album',
      album: {
        id: `${currentArtist?.name || release.artist?.name || 'unknown'}-${release.title || 'untitled'}`.toLowerCase().replace(/[^a-z0-9-]/g, ''),
        title: release.title,
        artist: currentArtist?.name || release.artist?.name,
        year: year !== 'Unknown' ? parseInt(year) : null,
        art: release.albumArt
      }
    };
    e.dataTransfer.setData('text/plain', JSON.stringify(albumData));
  };

  const cardStyle = {
    // ... existing styles
  };
```

Then add `draggable: true` and `onDragStart: handleDragStart` to the main card div, and add `cursor: 'grab'` to cardStyle.

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat(collection): make ReleaseCard component draggable"
```

---

## Task 7: Make Search Result Artist Rows Draggable

**Files:**
- Modify: `app.js` (~line 8350, artist rows in search results)

**Step 1: Add draggable to artist search result rows**

Find the artist rows in search detail view and add drag handlers:

```javascript
                  searchDetailCategory === 'artists' && searchResults.artists.map((artist, index) =>
                    React.createElement('div', {
                      key: artist.id,
                      draggable: true,
                      onDragStart: (e) => {
                        e.dataTransfer.effectAllowed = 'copy';
                        e.dataTransfer.setData('text/plain', JSON.stringify({
                          type: 'artist',
                          artist: {
                            id: (artist.name || 'unknown').toLowerCase().replace(/[^a-z0-9-]/g, ''),
                            name: artist.name,
                            image: null
                          }
                        }));
                      },
                      className: `group flex items-center px-6 py-3 hover:bg-gray-50 cursor-grab active:cursor-grabbing transition-colors ${searchPreviewItem?.id === artist.id ? 'bg-gray-100' : ''}`,
```

**Step 2: Also update compact artist results (~line 8598)**

Find the compact view artist results and add same drag handlers.

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat(collection): make search result artist rows draggable"
```

---

## Task 8: Make Search Result Album Rows Draggable

**Files:**
- Modify: `app.js` (~line 8439, album rows in search results)

**Step 1: Add draggable to album search result rows**

Find the album rows in search detail view and add drag handlers:

```javascript
                  searchDetailCategory === 'albums' && searchResults.albums.map((album, index) =>
                    React.createElement('div', {
                      key: album.id,
                      draggable: true,
                      onDragStart: (e) => {
                        e.dataTransfer.effectAllowed = 'copy';
                        e.dataTransfer.setData('text/plain', JSON.stringify({
                          type: 'album',
                          album: {
                            id: `${album['artist-credit']?.[0]?.name || 'unknown'}-${album.title || 'untitled'}`.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                            title: album.title,
                            artist: album['artist-credit']?.[0]?.name || 'Unknown',
                            year: album['first-release-date']?.split('-')[0] ? parseInt(album['first-release-date'].split('-')[0]) : null,
                            art: null
                          }
                        }));
                      },
                      className: `flex items-center px-6 py-3 hover:bg-gray-50 cursor-grab active:cursor-grabbing transition-colors ${searchPreviewItem?.id === album.id ? 'bg-gray-100' : ''}`,
```

**Step 2: Also update compact album results (~line 8693)**

Find the compact view album results and add same drag handlers.

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat(collection): make search result album rows draggable"
```

---

## Task 9: Make Search Result Track Rows Draggable

**Files:**
- Modify: `app.js` (~line 8403, track rows in search results)

**Step 1: Add draggable to track search result rows**

Track rows should already have some drag support, but ensure they work with collection drop:

```javascript
                  searchDetailCategory === 'tracks' && searchResults.tracks.map((track, index) =>
                    React.createElement('div', {
                      key: track.id,
                      draggable: true,
                      onDragStart: (e) => {
                        e.dataTransfer.effectAllowed = 'copy';
                        e.dataTransfer.setData('text/plain', JSON.stringify({
                          type: 'track',
                          track: {
                            id: track.id,
                            title: track.title,
                            artist: track.artist,
                            album: track.album,
                            duration: track.duration,
                            albumArt: track.albumArt,
                            sources: track.sources || {}
                          }
                        }));
                      },
                      className: `flex items-center px-6 py-3 hover:bg-gray-50 cursor-grab active:cursor-grabbing transition-colors ${searchPreviewItem?.id === track.id ? 'bg-gray-100' : ''}`,
```

**Step 2: Also update compact track results (~line 8623)**

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat(collection): make search result track rows draggable"
```

---

## Task 10: Update Collection View - Albums Tab

**Files:**
- Modify: `app.js`

**Step 1: Remove collectionAlbums useMemo derivation**

Find and remove the `collectionAlbums` useMemo (~line 1190-1208) that derives albums from library.

**Step 2: Update Albums tab to use collectionData.albums**

Find the Albums tab rendering (~line 10365) and update to use `collectionData.albums`:

```javascript
collectionTab === 'albums' && (() => {
  const filtered = filterCollectionItems(collectionData.albums, 'albums');
  const sorted = sortCollectionItems(filtered, 'albums');

  if (sorted.length === 0) {
    return React.createElement('div', { className: 'flex-1 flex flex-col items-center justify-center text-gray-400 py-20' },
      React.createElement('svg', { className: 'w-16 h-16 mb-4 text-gray-300', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3' })
      ),
      React.createElement('p', { className: 'text-lg font-medium text-gray-500 mb-2' }, 'No albums yet'),
      React.createElement('p', { className: 'text-sm text-gray-400' }, 'Drag albums here to add them to your collection')
    );
  }

  return React.createElement('div', { className: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4' },
    sorted.map((album, index) =>
      React.createElement(CollectionAlbumCard, {
        key: `${album.title}-${album.artist}-${index}`,
        album: { ...album, trackCount: 0 }, // No track count for bookmarked albums
        getAlbumArt: getAlbumArt,
        onNavigate: () => handleSearch(`${album.artist} ${album.title}`)
      })
    )
  );
})()
```

**Step 3: Update tab count display**

Find where album count is shown in tabs and update to use `collectionData.albums.length`.

**Step 4: Commit**

```bash
git add app.js
git commit -m "feat(collection): update Albums tab to use persisted collection data"
```

---

## Task 11: Update Collection View - Artists Tab

**Files:**
- Modify: `app.js`

**Step 1: Remove collectionArtists useMemo derivation**

Find and remove the `collectionArtists` useMemo (~line 1173-1187) that derives artists from library.

**Step 2: Update Artists tab to use collectionData.artists**

Find the Artists tab rendering and update:

```javascript
collectionTab === 'artists' && (() => {
  const filtered = filterCollectionItems(collectionData.artists, 'artists');
  const sorted = sortCollectionItems(filtered, 'artists');

  if (sorted.length === 0) {
    return React.createElement('div', { className: 'flex-1 flex flex-col items-center justify-center text-gray-400 py-20' },
      React.createElement('svg', { className: 'w-16 h-16 mb-4 text-gray-300', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' })
      ),
      React.createElement('p', { className: 'text-lg font-medium text-gray-500 mb-2' }, 'No artists yet'),
      React.createElement('p', { className: 'text-sm text-gray-400' }, 'Drag artists here to add them to your collection')
    );
  }

  return React.createElement('div', { className: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4' },
    sorted.map(artist =>
      React.createElement(CollectionArtistCard, {
        key: artist.name,
        artist: { ...artist, trackCount: 0 }, // No track count for bookmarked artists
        getArtistImage: getArtistImage,
        onNavigate: () => fetchArtistData(artist.name)
      })
    )
  );
})()
```

**Step 3: Update tab count display**

Update artist count in tabs to use `collectionData.artists.length`.

**Step 4: Commit**

```bash
git add app.js
git commit -m "feat(collection): update Artists tab to use persisted collection data"
```

---

## Task 12: Update Collection View - Tracks Tab

**Files:**
- Modify: `app.js`

**Step 1: Update Tracks tab to merge local files with collectionData.tracks**

Find the Tracks tab rendering and update to merge both sources:

```javascript
collectionTab === 'tracks' && (() => {
  // Merge local files with collection tracks
  const allTracks = [...library, ...collectionData.tracks];

  // Deduplicate by id
  const trackMap = new Map();
  allTracks.forEach(track => {
    const trackId = track.id || `${track.artist || 'unknown'}-${track.title || 'untitled'}-${track.album || 'noalbum'}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!trackMap.has(trackId)) {
      trackMap.set(trackId, { ...track, id: trackId });
    }
  });

  const mergedTracks = Array.from(trackMap.values());
  const filtered = filterCollectionItems(mergedTracks, 'tracks');
  const sorted = sortCollectionItems(filtered, 'tracks');

  // ... rest of existing tracks rendering
})()
```

**Step 2: Update tab count display**

Update track count to show merged total.

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat(collection): update Tracks tab to merge local files with collection tracks"
```

---

## Task 13: Update sortCollectionItems for addedAt Sorting

**Files:**
- Modify: `app.js`

**Step 1: Find sortCollectionItems function**

Update the 'recent' sort option to use `addedAt` timestamp when available:

```javascript
// For 'recent' sort, use addedAt timestamp if available
if (sortType === 'recent') {
  return [...items].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
}
```

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat(collection): support addedAt timestamp for recent sorting"
```

---

## Task 14: Test End-to-End Flow

**Files:** None (testing only)

**Step 1: Test album drag from release page**

1. Navigate to an artist page
2. Click on an album to view tracklist
3. Drag the album art to Collection in sidebar
4. Verify toast appears
5. Navigate to Collection > Albums tab
6. Verify album appears

**Step 2: Test album drag from search results**

1. Search for an album
2. Drag album row to Collection
3. Verify toast and album appears in Albums tab

**Step 3: Test artist drag from search results**

1. Search for an artist
2. Drag artist row to Collection
3. Verify toast and artist appears in Artists tab

**Step 4: Test track drag**

1. From release tracklist, drag a track to Collection
2. Verify toast and track appears in Tracks tab

**Step 5: Test duplicate prevention**

1. Try dragging same album again
2. Verify "already in collection" toast appears

**Step 6: Test persistence**

1. Quit and restart app
2. Verify collection items persist

---

## Task 15: Final Cleanup and Commit

**Step 1: Remove any debug console.logs**

Search for any temporary debug statements and remove them.

**Step 2: Final commit**

```bash
git add -A
git commit -m "feat(collection): complete drag-and-drop collection feature

- Add Electron IPC for collection persistence (JSON file)
- Add toast notification system
- Make album art, ReleaseCards, and search results draggable
- Collection sidebar is drop zone with visual feedback
- Three independent collection tabs: Artists, Albums, Tracks
- Duplicate prevention with user feedback
- Persistence across app restarts"
```
