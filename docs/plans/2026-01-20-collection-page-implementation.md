# Collection Page Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the Collection page with collapsible header, filter tabs (Artists | Albums | Tracks), sort dropdown, and inline search filtering.

**Architecture:** Replace the current library view with a new Collection component featuring a sticky collapsible header (120px → 70px), three tab views with derived data from library tracks, and real-time filtering/sorting.

**Tech Stack:** React (createElement), Tailwind CSS, existing app patterns

---

## Task 1: Add Collection State Variables

**Files:**
- Modify: `app.js:954-957` (after existing state declarations)

**Step 1: Add the new state variables after line 957**

Add after `const [watchFolders, setWatchFolders] = useState([]);`:

```javascript
// Collection page state
const [collectionTab, setCollectionTab] = useState('tracks'); // 'artists' | 'albums' | 'tracks'
const [collectionHeaderCollapsed, setCollectionHeaderCollapsed] = useState(false);
const [collectionSearchOpen, setCollectionSearchOpen] = useState(false);
const [collectionSearch, setCollectionSearch] = useState('');
const [collectionSortDropdownOpen, setCollectionSortDropdownOpen] = useState(false);
const [collectionSort, setCollectionSort] = useState({
  artists: 'alpha-asc',
  albums: 'recent',
  tracks: 'recent'
});
```

**Step 2: Verify the file still parses**

Run: `node -c app.js`
Expected: No syntax errors

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat(collection): add state variables for collection page redesign"
```

---

## Task 2: Add Derived Data Computations

**Files:**
- Modify: `app.js` (after state declarations, around line 965)

**Step 1: Add useMemo computations for derived artists and albums**

Add after the collection state variables:

```javascript
// Derive unique artists from library
const collectionArtists = useMemo(() => {
  const artistMap = new Map();
  library.forEach(track => {
    const artistName = track.artist || 'Unknown Artist';
    if (!artistMap.has(artistName)) {
      artistMap.set(artistName, {
        name: artistName,
        trackCount: 0,
        image: null // Will be fetched on demand
      });
    }
    artistMap.get(artistName).trackCount++;
  });
  return Array.from(artistMap.values());
}, [library]);

// Derive unique albums from library
const collectionAlbums = useMemo(() => {
  const albumMap = new Map();
  library.forEach(track => {
    const albumTitle = track.album || 'Unknown Album';
    const artistName = track.artist || 'Unknown Artist';
    const key = `${albumTitle}|||${artistName}`;
    if (!albumMap.has(key)) {
      albumMap.set(key, {
        title: albumTitle,
        artist: artistName,
        year: track.year || null,
        art: track.art || null,
        trackCount: 0
      });
    }
    albumMap.get(key).trackCount++;
  });
  return Array.from(albumMap.values());
}, [library]);
```

**Step 2: Verify the file still parses**

Run: `node -c app.js`
Expected: No syntax errors

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat(collection): add derived data computations for artists and albums"
```

---

## Task 3: Add Scroll Handler and Filter/Sort Logic

**Files:**
- Modify: `app.js` (after the derived data, around line 990)

**Step 1: Add scroll handler for collection header collapse**

```javascript
// Collection page scroll handler for header collapse
const handleCollectionScroll = useCallback((e) => {
  const { scrollTop } = e.target;
  setCollectionHeaderCollapsed(scrollTop > 50);
}, []);

// Reset collection header collapse when leaving library view
useEffect(() => {
  if (activeView !== 'library') {
    setCollectionHeaderCollapsed(false);
    setCollectionSearchOpen(false);
    setCollectionSearch('');
  }
}, [activeView]);
```

**Step 2: Add filter and sort helper functions**

```javascript
// Filter collection items by search query
const filterCollectionItems = useCallback((items, type) => {
  if (!collectionSearch.trim()) return items;
  const query = collectionSearch.toLowerCase();

  if (type === 'artists') {
    return items.filter(a => a.name.toLowerCase().includes(query));
  }
  if (type === 'albums') {
    return items.filter(a =>
      a.title.toLowerCase().includes(query) ||
      a.artist.toLowerCase().includes(query)
    );
  }
  if (type === 'tracks') {
    return items.filter(t =>
      (t.title || '').toLowerCase().includes(query) ||
      (t.artist || '').toLowerCase().includes(query) ||
      (t.album || '').toLowerCase().includes(query)
    );
  }
  return items;
}, [collectionSearch]);

// Sort collection items
const sortCollectionItems = useCallback((items, type) => {
  const sortKey = collectionSort[type];
  const sorted = [...items];

  if (type === 'artists') {
    switch (sortKey) {
      case 'alpha-asc': return sorted.sort((a, b) => a.name.localeCompare(b.name));
      case 'alpha-desc': return sorted.sort((a, b) => b.name.localeCompare(a.name));
      case 'tracks': return sorted.sort((a, b) => b.trackCount - a.trackCount);
      case 'recent': return sorted; // Keep original order (most recently added)
      default: return sorted;
    }
  }
  if (type === 'albums') {
    switch (sortKey) {
      case 'alpha-asc': return sorted.sort((a, b) => a.title.localeCompare(b.title));
      case 'alpha-desc': return sorted.sort((a, b) => b.title.localeCompare(a.title));
      case 'artist': return sorted.sort((a, b) => a.artist.localeCompare(b.artist));
      case 'year-new': return sorted.sort((a, b) => (b.year || 0) - (a.year || 0));
      case 'year-old': return sorted.sort((a, b) => (a.year || 9999) - (b.year || 9999));
      case 'recent': return sorted;
      default: return sorted;
    }
  }
  if (type === 'tracks') {
    switch (sortKey) {
      case 'title-asc': return sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
      case 'title-desc': return sorted.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
      case 'artist': return sorted.sort((a, b) => (a.artist || '').localeCompare(b.artist || ''));
      case 'album': return sorted.sort((a, b) => (a.album || '').localeCompare(b.album || ''));
      case 'duration': return sorted.sort((a, b) => (a.duration || 0) - (b.duration || 0));
      case 'recent': return sorted;
      default: return sorted;
    }
  }
  return sorted;
}, [collectionSort]);

// Get sort options for current tab
const getCollectionSortOptions = (tab) => {
  if (tab === 'artists') {
    return [
      { value: 'alpha-asc', label: 'A-Z' },
      { value: 'alpha-desc', label: 'Z-A' },
      { value: 'tracks', label: 'Most Tracks' },
      { value: 'recent', label: 'Recently Added' }
    ];
  }
  if (tab === 'albums') {
    return [
      { value: 'alpha-asc', label: 'A-Z' },
      { value: 'alpha-desc', label: 'Z-A' },
      { value: 'artist', label: 'Artist Name' },
      { value: 'year-new', label: 'Year (Newest)' },
      { value: 'year-old', label: 'Year (Oldest)' },
      { value: 'recent', label: 'Recently Added' }
    ];
  }
  return [
    { value: 'title-asc', label: 'Title A-Z' },
    { value: 'title-desc', label: 'Title Z-A' },
    { value: 'artist', label: 'Artist Name' },
    { value: 'album', label: 'Album Name' },
    { value: 'duration', label: 'Duration' },
    { value: 'recent', label: 'Recently Added' }
  ];
};
```

**Step 3: Verify the file still parses**

Run: `node -c app.js`
Expected: No syntax errors

**Step 4: Commit**

```bash
git add app.js
git commit -m "feat(collection): add scroll handler and filter/sort logic"
```

---

## Task 4: Build the Collapsible Header Component

**Files:**
- Modify: `app.js:9283-9314` (replace current hero section)

**Step 1: Replace the library view header**

Find the library view starting at line 9283. Replace the entire hero section (lines 9287-9314) with the new collapsible header:

```javascript
// Collapsible header section
React.createElement('div', {
  className: 'sticky top-0 z-20',
  style: {
    height: collectionHeaderCollapsed ? '70px' : '120px',
    transition: 'height 300ms ease',
    overflow: 'hidden'
  }
},
  // Gradient background
  React.createElement('div', {
    className: 'absolute inset-0 bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-700'
  }),
  // Vinyl pattern overlay
  React.createElement('div', {
    className: 'absolute inset-0',
    style: {
      opacity: 0.08,
      backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'%23ffffff\'%3E%3Ccircle cx=\'30\' cy=\'30\' r=\'20\' fill=\'none\' stroke=\'%23fff\' stroke-width=\'2\'/%3E%3Ccircle cx=\'30\' cy=\'30\' r=\'12\' fill=\'none\' stroke=\'%23fff\' stroke-width=\'1\'/%3E%3Ccircle cx=\'30\' cy=\'30\' r=\'4\'/%3E%3C/g%3E%3C/svg%3E")'
    }
  }),
  // Header content - expanded state
  !collectionHeaderCollapsed && React.createElement('div', {
    className: 'absolute inset-0 flex flex-col items-center justify-center',
    style: {
      opacity: collectionHeaderCollapsed ? 0 : 1,
      transition: 'opacity 200ms ease'
    }
  },
    React.createElement('h1', {
      className: 'text-3xl font-bold text-white mb-1 tracking-widest uppercase'
    }, 'COLLECTION'),
    React.createElement('p', {
      className: 'text-white/70 text-sm mb-4'
    }, `${collectionArtists.length} Artists  |  ${collectionAlbums.length} Albums  |  ${library.length} Tracks`)
  ),
  // Header content - collapsed state (inline)
  collectionHeaderCollapsed && React.createElement('div', {
    className: 'absolute inset-0 flex items-center px-6',
    style: {
      opacity: collectionHeaderCollapsed ? 1 : 0,
      transition: 'opacity 200ms ease'
    }
  },
    React.createElement('h1', {
      className: 'text-xl font-bold text-white tracking-wider uppercase'
    }, 'COLLECTION')
  ),
  // Filter bar (always visible at bottom of header)
  React.createElement('div', {
    className: 'absolute bottom-0 left-0 right-0 flex items-center px-6 pb-3',
    style: { height: '44px' }
  },
    // Tabs
    React.createElement('div', { className: 'flex items-center gap-1' },
      ['artists', 'albums', 'tracks'].map((tab, index) => [
        index > 0 && React.createElement('span', {
          key: `sep-${tab}`,
          className: 'text-white/40 mx-2'
        }, '|'),
        React.createElement('button', {
          key: tab,
          onClick: () => setCollectionTab(tab),
          className: `px-2 py-1 text-sm font-medium uppercase tracking-wider transition-colors ${
            collectionTab === tab
              ? 'text-white'
              : 'text-white/50 hover:text-white/80'
          }`
        }, tab.charAt(0).toUpperCase() + tab.slice(1))
      ]).flat().filter(Boolean)
    ),
    // Spacer
    React.createElement('div', { className: 'flex-1' }),
    // Sort dropdown
    React.createElement('div', { className: 'relative mr-3' },
      React.createElement('button', {
        onClick: () => setCollectionSortDropdownOpen(!collectionSortDropdownOpen),
        className: 'flex items-center gap-1 px-3 py-1.5 text-sm text-white/80 hover:text-white bg-white/10 rounded-full transition-colors'
      },
        React.createElement('span', null, getCollectionSortOptions(collectionTab).find(o => o.value === collectionSort[collectionTab])?.label || 'Sort'),
        React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M19 9l-7 7-7-7' })
        )
      ),
      // Dropdown menu
      collectionSortDropdownOpen && React.createElement('div', {
        className: 'absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg py-1 min-w-[160px] z-30'
      },
        getCollectionSortOptions(collectionTab).map(option =>
          React.createElement('button', {
            key: option.value,
            onClick: () => {
              setCollectionSort(prev => ({ ...prev, [collectionTab]: option.value }));
              setCollectionSortDropdownOpen(false);
            },
            className: `w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center justify-between ${
              collectionSort[collectionTab] === option.value ? 'text-purple-600 font-medium' : 'text-gray-700'
            }`
          },
            option.label,
            collectionSort[collectionTab] === option.value && React.createElement('svg', {
              className: 'w-4 h-4',
              fill: 'none',
              viewBox: '0 0 24 24',
              stroke: 'currentColor'
            },
              React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M5 13l4 4L19 7' })
            )
          )
        )
      )
    ),
    // Search toggle/field
    React.createElement('div', { className: 'flex items-center' },
      collectionSearchOpen ?
        React.createElement('div', { className: 'flex items-center bg-white/10 rounded-full px-3 py-1.5' },
          React.createElement('input', {
            type: 'text',
            value: collectionSearch,
            onChange: (e) => setCollectionSearch(e.target.value),
            onBlur: () => {
              if (!collectionSearch.trim()) {
                setCollectionSearchOpen(false);
              }
            },
            autoFocus: true,
            placeholder: 'Filter...',
            className: 'bg-transparent text-white text-sm placeholder-white/50 outline-none',
            style: { width: '150px' }
          }),
          collectionSearch && React.createElement('button', {
            onClick: () => {
              setCollectionSearch('');
              setCollectionSearchOpen(false);
            },
            className: 'ml-2 text-white/60 hover:text-white'
          },
            React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
              React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M6 18L18 6M6 6l12 12' })
            )
          )
        )
      :
        React.createElement('button', {
          onClick: () => setCollectionSearchOpen(true),
          className: 'p-1.5 text-white/60 hover:text-white transition-colors'
        },
          React.createElement('svg', { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
          )
        )
    )
  )
),
```

**Step 2: Verify the file still parses**

Run: `node -c app.js`
Expected: No syntax errors

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat(collection): add collapsible header with tabs, sort, and search"
```

---

## Task 5: Update Scrollable Content Container

**Files:**
- Modify: `app.js:9283-9284` (the library view wrapper)

**Step 1: Update the outer container and add scroll handler**

Change the library view wrapper to use the scroll handler:

```javascript
activeView === 'library' && React.createElement('div', {
  className: 'h-full overflow-y-auto scrollable-content',
  onScroll: handleCollectionScroll
},
```

**Step 2: Close sort dropdown when clicking outside**

Add a click-outside handler by wrapping the dropdown logic. Add this effect after the collection state variables:

```javascript
// Close collection sort dropdown when clicking outside
useEffect(() => {
  const handleClickOutside = () => setCollectionSortDropdownOpen(false);
  if (collectionSortDropdownOpen) {
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }
}, [collectionSortDropdownOpen]);
```

**Step 3: Verify the file still parses**

Run: `node -c app.js`
Expected: No syntax errors

**Step 4: Commit**

```bash
git add app.js
git commit -m "feat(collection): wire up scroll handler and click-outside for dropdown"
```

---

## Task 6: Build the Artists Grid View

**Files:**
- Modify: `app.js` (in the library view content area)

**Step 1: Add the Artists tab content**

After the header, add the tabbed content. The content area should show different views based on `collectionTab`:

```javascript
// Content area
React.createElement('div', { className: 'p-6' },
  // Artists tab
  collectionTab === 'artists' && (() => {
    const filtered = filterCollectionItems(collectionArtists, 'artists');
    const sorted = sortCollectionItems(filtered, 'artists');

    if (sorted.length === 0 && collectionSearch) {
      return React.createElement('div', { className: 'text-center py-12 text-gray-400' },
        React.createElement('svg', { className: 'w-12 h-12 mx-auto mb-4 text-gray-300', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
        ),
        React.createElement('div', { className: 'text-sm' }, 'No artists match your search')
      );
    }

    if (sorted.length === 0) {
      return React.createElement('div', { className: 'text-center py-12 text-gray-400' },
        React.createElement('svg', { className: 'w-12 h-12 mx-auto mb-4 text-gray-300', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' })
        ),
        React.createElement('div', { className: 'text-sm' }, 'No artists in your collection')
      );
    }

    return React.createElement('div', {
      className: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4'
    },
      sorted.map(artist =>
        React.createElement('button', {
          key: artist.name,
          onClick: () => fetchArtistData(artist.name),
          className: 'group text-left p-4 rounded-xl bg-white border border-gray-100 hover:border-purple-200 hover:shadow-md transition-all'
        },
          // Artist image placeholder (circular)
          React.createElement('div', {
            className: 'w-full aspect-square rounded-full bg-gradient-to-br from-purple-500 to-pink-500 mb-3 flex items-center justify-center overflow-hidden'
          },
            React.createElement('svg', { className: 'w-12 h-12 text-white/70', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
              React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' })
            )
          ),
          // Artist name
          React.createElement('h3', {
            className: 'font-medium text-gray-900 truncate group-hover:text-purple-600 transition-colors'
          }, artist.name),
          // Track count
          React.createElement('p', {
            className: 'text-sm text-gray-500'
          }, `${artist.trackCount} track${artist.trackCount !== 1 ? 's' : ''}`)
        )
      )
    );
  })(),
```

**Step 2: Verify the file still parses**

Run: `node -c app.js`
Expected: No syntax errors

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat(collection): add Artists grid view"
```

---

## Task 7: Build the Albums Grid View

**Files:**
- Modify: `app.js` (continue in the library view content area)

**Step 1: Add the Albums tab content after the Artists tab**

```javascript
  // Albums tab
  collectionTab === 'albums' && (() => {
    const filtered = filterCollectionItems(collectionAlbums, 'albums');
    const sorted = sortCollectionItems(filtered, 'albums');

    if (sorted.length === 0 && collectionSearch) {
      return React.createElement('div', { className: 'text-center py-12 text-gray-400' },
        React.createElement('svg', { className: 'w-12 h-12 mx-auto mb-4 text-gray-300', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
        ),
        React.createElement('div', { className: 'text-sm' }, 'No albums match your search')
      );
    }

    if (sorted.length === 0) {
      return React.createElement('div', { className: 'text-center py-12 text-gray-400' },
        React.createElement('svg', { className: 'w-12 h-12 mx-auto mb-4 text-gray-300', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3' })
        ),
        React.createElement('div', { className: 'text-sm' }, 'No albums in your collection')
      );
    }

    return React.createElement('div', {
      className: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4'
    },
      sorted.map((album, index) =>
        React.createElement('button', {
          key: `${album.title}-${album.artist}-${index}`,
          onClick: () => {
            // Navigate to album - search for it to get full release data
            handleSearch(`${album.artist} ${album.title}`);
          },
          className: 'group text-left'
        },
          // Album card (similar to ReleaseCard styling)
          React.createElement('div', {
            className: 'p-4 rounded-xl bg-white border border-gray-100 hover:border-purple-200 hover:shadow-md transition-all',
            style: { backgroundColor: 'rgba(255, 255, 255, 0.05)' }
          },
            // Album art
            React.createElement('div', {
              className: 'w-full aspect-square rounded-lg mb-3 overflow-hidden',
              style: {
                background: 'linear-gradient(135deg, #9333ea 0%, #ec4899 100%)'
              }
            },
              album.art ?
                React.createElement('img', {
                  src: album.art,
                  alt: album.title,
                  className: 'w-full h-full object-cover',
                  onError: (e) => { e.target.style.display = 'none'; }
                })
              :
                React.createElement('div', { className: 'w-full h-full flex items-center justify-center' },
                  React.createElement('svg', { className: 'w-12 h-12 text-white/50', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3' })
                  )
                )
            ),
            // Album title
            React.createElement('h3', {
              className: 'font-medium text-gray-900 truncate group-hover:text-purple-600 transition-colors text-sm'
            }, album.title),
            // Artist name
            React.createElement('p', {
              className: 'text-sm text-gray-500 truncate'
            }, album.artist),
            // Year and track count
            React.createElement('div', { className: 'flex items-center gap-2 mt-1' },
              album.year && React.createElement('span', {
                className: 'text-xs text-gray-400'
              }, album.year),
              React.createElement('span', {
                className: 'text-xs text-gray-400'
              }, `${album.trackCount} track${album.trackCount !== 1 ? 's' : ''}`)
            )
          )
        )
      )
    );
  })(),
```

**Step 2: Verify the file still parses**

Run: `node -c app.js`
Expected: No syntax errors

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat(collection): add Albums grid view"
```

---

## Task 8: Keep Existing Tracks View with Filter/Sort

**Files:**
- Modify: `app.js` (the existing track list in library view)

**Step 1: Wrap the existing tracks view in the tab conditional**

The existing library track list (skeleton loaders + empty state + track rows) needs to be wrapped:

```javascript
  // Tracks tab (existing implementation with filter/sort applied)
  collectionTab === 'tracks' && (() => {
    if (libraryLoading) {
      // Keep existing skeleton loader code
      return React.createElement('div', { className: 'space-y-0' },
        // ... existing skeleton code ...
      );
    }

    const filtered = filterCollectionItems(library, 'tracks');
    const sorted = sortCollectionItems(filtered, 'tracks');

    if (sorted.length === 0 && collectionSearch) {
      return React.createElement('div', { className: 'text-center py-12 text-gray-400' },
        React.createElement('svg', { className: 'w-12 h-12 mx-auto mb-4 text-gray-300', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
        ),
        React.createElement('div', { className: 'text-sm' }, 'No tracks match your search')
      );
    }

    if (sorted.length === 0) {
      return React.createElement('div', { className: 'text-center py-12 text-gray-400' },
        React.createElement('div', { className: 'text-5xl mb-4' }, '\uD83D\uDCDA'),
        React.createElement('div', { className: 'text-lg font-medium text-gray-600 mb-2' }, 'Your Collection is Empty'),
        React.createElement('div', { className: 'text-sm' }, 'Search for music to add tracks!')
      );
    }

    return React.createElement('div', { className: 'space-y-0' },
      sorted.map((track, index) => {
        // ... existing track row code, but use sorted array instead of library ...
      })
    );
  })()
)
```

**Step 2: Update the track row mapping to use sorted array**

In the existing track mapping, change `library.map` to use the sorted/filtered result and update the queue logic:

```javascript
onClick: () => {
  // Find the index in the sorted array for queue
  const tracksAfter = sorted.slice(index + 1);
  setCurrentQueue(tracksAfter);
  handlePlay(track);
},
```

**Step 3: Verify the file still parses**

Run: `node -c app.js`
Expected: No syntax errors

**Step 4: Test the app**

Run: `npm start`
Expected: Collection page shows with collapsible header, three tabs, sort dropdown, and search filter

**Step 5: Commit**

```bash
git add app.js
git commit -m "feat(collection): integrate filter/sort with existing tracks view"
```

---

## Task 9: Final Polish and Testing

**Files:**
- Modify: `app.js` (minor adjustments)

**Step 1: Test all interactions**

Verify:
- [ ] Header collapses when scrolling down
- [ ] Header expands when scrolling back to top
- [ ] Tab switching works (Artists, Albums, Tracks)
- [ ] Sort dropdown opens/closes and sorts correctly
- [ ] Search field expands on click, filters in real-time
- [ ] Search field collapses when empty and blurred
- [ ] Empty states show correctly when filter yields no results
- [ ] Clicking an artist navigates to artist page
- [ ] Clicking an album searches for it (temporary until we have album pages from library)
- [ ] Clicking a track plays it with correct queue

**Step 2: Fix any visual issues found during testing**

Common adjustments might include:
- Padding/margin tweaks
- Color adjustments for better contrast
- Transition timing adjustments

**Step 3: Final commit**

```bash
git add app.js
git commit -m "feat(collection): complete collection page redesign

- Collapsible header (120px -> 70px) with gradient + vinyl pattern
- Filter tabs: Artists | Albums | Tracks
- Sort dropdown with per-tab options
- Inline search filter with expand/collapse behavior
- Artists grid view with circular images
- Albums grid view matching ReleaseCard style
- Tracks list view with filter/sort applied
- Empty states for search with no results"
```
