# Charts Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a Charts page that displays top albums from Apple Music's most-played RSS feed in an album grid (same pattern as Critics Picks).

**Architecture:** Add state for charts data, create parser for Apple RSS format, load data when navigating to Charts, render album grid with hover actions and artist navigation.

**Tech Stack:** React (createElement), Apple Music RSS feed, MusicBrainz/Cover Art Archive for album art

---

## Task 1: Add Charts State

**Files:**
- Modify: `app.js:862-864` (after critics picks state)

**Step 1: Add state declarations**

Add these lines after line 864 (`const criticsPicksLoaded = useRef(false);`):

```javascript
// Charts state
const [charts, setCharts] = useState([]);
const [chartsLoading, setChartsLoading] = useState(false);
const chartsLoaded = useRef(false);
```

**Step 2: Verify the app still loads**

Run: Open the app and confirm no errors in console.

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat: add charts state variables"
```

---

## Task 2: Create Apple RSS Parser

**Files:**
- Modify: `app.js:4216` (after parseCriticsPicksRSS function)

**Step 1: Add the parseChartsRSS function**

Add after line 4216 (after the `parseCriticsPicksRSS` function closing brace):

```javascript
// Parse Apple Music Charts RSS feed
const parseChartsRSS = (rssString) => {
  try {
    const parser = new DOMParser();
    const xml = parser.parseFromString(rssString, 'text/xml');

    const items = xml.querySelectorAll('item');
    const albums = [];

    items.forEach((item, index) => {
      const titleText = item.querySelector('title')?.textContent || '';
      const link = item.querySelector('link')?.textContent || '';
      const description = item.querySelector('description')?.textContent || '';
      const pubDate = item.querySelector('pubDate')?.textContent || '';

      // Get artist from category with domain attribute
      const categories = item.querySelectorAll('category');
      let artist = '';
      let genres = [];

      categories.forEach(cat => {
        if (cat.getAttribute('domain')) {
          // Category with domain is the artist link
          artist = cat.textContent || '';
        } else {
          // Categories without domain are genres
          genres.push(cat.textContent);
        }
      });

      // Title format is "Album Name - Artist Name"
      // But we already have artist from category, so extract album from title
      let album = titleText;
      if (titleText.includes(' - ') && artist) {
        album = titleText.replace(` - ${artist}`, '').trim();
      }

      // Fallback: if no artist from category, try parsing from title
      if (!artist && titleText.includes(' - ')) {
        const parts = titleText.split(' - ');
        album = parts[0].trim();
        artist = parts.slice(1).join(' - ').trim();
      }

      if (album && artist) {
        albums.push({
          id: `charts-${index}-${artist}-${album}`.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
          artist: artist,
          title: album,
          rank: index + 1,
          link: link,
          genres: genres.filter(g => g !== 'Music'),
          pubDate: pubDate ? new Date(pubDate) : null,
          albumArt: null
        });
      }
    });

    return albums;
  } catch (error) {
    console.error('Error parsing Charts RSS:', error);
    return [];
  }
};
```

**Step 2: Verify no syntax errors**

Run: Open the app and confirm no errors in console.

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat: add Apple Music charts RSS parser"
```

---

## Task 3: Create Load Charts Function

**Files:**
- Modify: `app.js` (after loadCriticsPicks function, around line 4253)

**Step 1: Add loadCharts function**

Add after the `loadCriticsPicks` function:

```javascript
// Load Charts from Apple Music RSS feed
const loadCharts = async () => {
  if (chartsLoading || chartsLoaded.current) return;

  setChartsLoading(true);
  console.log('📊 Loading Charts...');

  try {
    const response = await fetch('https://rss.marketingtools.apple.com/api/v2/us/music/most-played/50/albums.rss');
    if (!response.ok) {
      throw new Error(`Failed to fetch RSS: ${response.status}`);
    }

    const rssText = await response.text();
    const albums = parseChartsRSS(rssText);

    console.log(`📊 Parsed ${albums.length} albums from Charts`);

    setCharts(albums);
    chartsLoaded.current = true;

    // Fetch album art in background
    fetchChartsAlbumArt(albums);

  } catch (error) {
    console.error('Failed to load Charts:', error);
    showConfirmDialog({
      type: 'error',
      title: 'Load Failed',
      message: 'Failed to load Charts. Please try again.'
    });
  } finally {
    setChartsLoading(false);
  }
};
```

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat: add loadCharts function for Apple Music RSS"
```

---

## Task 4: Create Album Art Fetcher for Charts

**Files:**
- Modify: `app.js` (after loadCharts function)

**Step 1: Add fetchChartsAlbumArt function**

Add after `loadCharts`:

```javascript
// Fetch album art for Charts in background
const fetchChartsAlbumArt = async (albums) => {
  const albumsNeedingFetch = [];
  const cachedUpdates = [];

  for (const album of albums) {
    const lookupKey = `${album.artist}-${album.title}`.toLowerCase();
    const cachedReleaseId = albumToReleaseIdCache.current[lookupKey];

    if (cachedReleaseId && albumArtCache.current[cachedReleaseId]?.url) {
      cachedUpdates.push({ id: album.id, albumArt: albumArtCache.current[cachedReleaseId].url });
    } else if (cachedReleaseId !== null) {
      albumsNeedingFetch.push(album);
    }
  }

  if (cachedUpdates.length > 0) {
    console.log(`📊 Using cached art for ${cachedUpdates.length} Charts albums`);
    setCharts(prev => prev.map(a => {
      const cached = cachedUpdates.find(u => u.id === a.id);
      return cached ? { ...a, albumArt: cached.albumArt } : a;
    }));
  }

  for (const album of albumsNeedingFetch) {
    try {
      const artUrl = await getAlbumArt(album.artist, album.title);
      if (artUrl) {
        setCharts(prev => prev.map(a =>
          a.id === album.id ? { ...a, albumArt: artUrl } : a
        ));
      }
    } catch (error) {
      console.log(`Could not fetch art for: ${album.artist} - ${album.title}`);
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
};
```

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat: add album art fetcher for charts"
```

---

## Task 5: Create Charts Album Navigation Functions

**Files:**
- Modify: `app.js` (after fetchChartsAlbumArt)

**Step 1: Add openChartsAlbum function**

```javascript
// Navigate to a Charts album release page
const openChartsAlbum = async (album) => {
  console.log(`🎵 Opening Chart Album: ${album.artist} - ${album.title}`);

  try {
    const searchQuery = encodeURIComponent(`release:"${album.title}" AND artist:"${album.artist}"`);
    const mbResponse = await fetch(
      `https://musicbrainz.org/ws/2/release/?query=${searchQuery}&fmt=json&limit=1`,
      { headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' } }
    );

    if (!mbResponse.ok) {
      throw new Error('MusicBrainz search failed');
    }

    const mbData = await mbResponse.json();

    if (mbData.releases && mbData.releases.length > 0) {
      const release = mbData.releases[0];
      setSelectedRelease({
        id: release.id,
        title: release.title,
        artist: album.artist,
        albumArt: album.albumArt,
        date: release.date || album.pubDate?.toISOString().split('T')[0],
        label: release['label-info']?.[0]?.label?.name || 'Unknown Label',
        country: release.country || 'Unknown',
        tracks: []
      });
      navigateTo('release');
    } else {
      showConfirmDialog({
        type: 'error',
        title: 'Album Not Found',
        message: `Could not find "${album.title}" by ${album.artist} in MusicBrainz.`
      });
    }
  } catch (error) {
    console.error('Error opening chart album:', error);
    showConfirmDialog({
      type: 'error',
      title: 'Error',
      message: 'Failed to load album details. Please try again.'
    });
  }
};
```

**Step 2: Add prefetchChartsTracks function**

```javascript
// Prefetch tracks for a Charts album on hover
const prefetchChartsTracks = async (album) => {
  const cacheKey = `charts-${album.artist}-${album.title}`.toLowerCase();
  if (trackPrefetchCache.current[cacheKey]) return;

  try {
    const searchQuery = encodeURIComponent(`release:"${album.title}" AND artist:"${album.artist}"`);
    const mbResponse = await fetch(
      `https://musicbrainz.org/ws/2/release/?query=${searchQuery}&fmt=json&limit=1`,
      { headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' } }
    );

    if (mbResponse.ok) {
      const mbData = await mbResponse.json();
      if (mbData.releases?.[0]) {
        trackPrefetchCache.current[cacheKey] = mbData.releases[0];
      }
    }
  } catch (error) {
    // Silent fail for prefetch
  }
};
```

**Step 3: Add addChartsToQueue function**

```javascript
// Add all tracks from a Charts album to the queue
const addChartsToQueue = async (album) => {
  console.log(`➕ Adding chart album to queue: ${album.artist} - ${album.title}`);

  try {
    const searchQuery = encodeURIComponent(`release:"${album.title}" AND artist:"${album.artist}"`);
    const mbResponse = await fetch(
      `https://musicbrainz.org/ws/2/release/?query=${searchQuery}&fmt=json&limit=1`,
      { headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' } }
    );

    if (!mbResponse.ok) throw new Error('MusicBrainz search failed');

    const mbData = await mbResponse.json();
    if (!mbData.releases?.[0]) {
      showConfirmDialog({
        type: 'error',
        title: 'Album Not Found',
        message: `Could not find tracks for "${album.title}"`
      });
      return;
    }

    const releaseId = mbData.releases[0].id;
    const tracksResponse = await fetch(
      `https://musicbrainz.org/ws/2/release/${releaseId}?inc=recordings&fmt=json`,
      { headers: { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' } }
    );

    if (!tracksResponse.ok) throw new Error('Failed to fetch tracks');

    const releaseData = await tracksResponse.json();
    const tracks = [];

    releaseData.media?.forEach(medium => {
      medium.tracks?.forEach(track => {
        tracks.push({
          id: track.recording?.id || track.id,
          title: track.title,
          artist: album.artist,
          duration: track.length ? Math.round(track.length / 1000) : null,
          albumArt: album.albumArt
        });
      });
    });

    if (tracks.length > 0) {
      setQueue(prev => [...prev, ...tracks]);
      showConfirmDialog({
        type: 'success',
        title: 'Added to Queue',
        message: `Added ${tracks.length} tracks from "${album.title}"`
      });
    }
  } catch (error) {
    console.error('Error adding chart album to queue:', error);
    showConfirmDialog({
      type: 'error',
      title: 'Error',
      message: 'Failed to add album to queue. Please try again.'
    });
  }
};
```

**Step 4: Commit**

```bash
git add app.js
git commit -m "feat: add charts album navigation and queue functions"
```

---

## Task 6: Update Charts Navigation Button

**Files:**
- Modify: `app.js:5873-5884` (Charts button in sidebar)

**Step 1: Update the Charts button onClick handler**

Change lines 5873-5884 from:

```javascript
React.createElement('button', {
  onClick: () => navigateTo('discover'),
  className: `w-full flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors ${
    activeView === 'discover' ? 'bg-gray-200 text-gray-900 font-medium' : 'text-gray-600 hover:bg-gray-100'
  }`
},
  // Bar chart icon for Charts
  React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' })
  ),
  'Charts'
),
```

To:

```javascript
React.createElement('button', {
  onClick: () => {
    navigateTo('discover');
    loadCharts();
  },
  className: `w-full flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors ${
    activeView === 'discover' ? 'bg-gray-200 text-gray-900 font-medium' : 'text-gray-600 hover:bg-gray-100'
  }`
},
  // Bar chart icon for Charts
  React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' })
  ),
  'Charts'
),
```

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat: trigger loadCharts on Charts navigation"
```

---

## Task 7: Replace Charts Placeholder with Album Grid

**Files:**
- Modify: `app.js:7374-7415` (Charts view)

**Step 1: Replace the entire Charts view**

Replace lines 7374-7415 with:

```javascript
// Charts view with hero
activeView === 'discover' && React.createElement('div', {
  className: 'h-full overflow-y-auto scrollable-content'
},
  // Hero section
  React.createElement('div', {
    className: 'relative h-64 bg-gradient-to-br from-orange-500 via-pink-500 to-purple-600 overflow-hidden'
  },
    // Background pattern
    React.createElement('div', {
      className: 'absolute inset-0 opacity-20',
      style: {
        backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'0.4\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")'
      }
    }),
    // Hero content
    React.createElement('div', {
      className: 'absolute inset-0 flex items-end p-8'
    },
      React.createElement('div', null,
        React.createElement('div', {
          className: 'inline-flex items-center gap-2 px-3 py-1 bg-white/20 backdrop-blur-sm rounded-full text-white/90 text-sm mb-3'
        },
          React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6' })
          ),
          'Trending Now'
        ),
        React.createElement('h1', { className: 'text-4xl font-bold text-white mb-2' }, 'Charts'),
        React.createElement('p', { className: 'text-white/80 text-lg' }, 'Top 50 most played albums on Apple Music')
      )
    )
  ),
  // Content area
  React.createElement('div', { className: 'p-6' },

  // Loading state
  chartsLoading && React.createElement('div', {
    className: 'flex items-center justify-center py-12'
  },
    React.createElement('div', {
      className: 'w-8 h-8 border-2 border-purple-600 border-t-transparent rounded-full animate-spin'
    })
  ),

  // Albums grid
  !chartsLoading && charts.length > 0 && React.createElement('div', {
    className: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 pb-6'
  },
    charts.map(album =>
      React.createElement('div', {
        key: album.id,
        className: 'group cursor-pointer',
        onMouseEnter: () => prefetchChartsTracks(album),
        onClick: () => openChartsAlbum(album)
      },
        // Album art with hover overlay
        React.createElement('div', {
          className: 'aspect-square rounded-lg overflow-hidden mb-3 bg-gradient-to-br from-orange-500 to-pink-500 relative'
        },
          album.albumArt ?
            React.createElement('img', {
              src: album.albumArt,
              alt: album.title,
              className: 'w-full h-full object-cover group-hover:scale-105 transition-transform duration-300'
            })
          :
            React.createElement('div', {
              className: 'w-full h-full flex items-center justify-center text-white/80 text-4xl'
            }, '💿'),
          // Rank badge
          React.createElement('div', {
            className: 'absolute top-2 left-2 px-2 py-1 rounded bg-black/70 text-white text-xs font-bold'
          }, `#${album.rank}`),
          // Hover overlay with Add to Queue button
          React.createElement('div', {
            className: 'absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center'
          },
            React.createElement('button', {
              onClick: (e) => {
                e.stopPropagation();
                addChartsToQueue(album);
              },
              className: 'bg-white text-gray-900 px-4 py-2 rounded-full text-sm font-medium hover:bg-gray-100 transition-colors flex items-center gap-2 shadow-lg'
            },
              React.createElement('svg', {
                className: 'w-4 h-4',
                fill: 'none',
                viewBox: '0 0 24 24',
                stroke: 'currentColor'
              },
                React.createElement('path', {
                  strokeLinecap: 'round',
                  strokeLinejoin: 'round',
                  strokeWidth: 2,
                  d: 'M12 4v16m8-8H4'
                })
              ),
              'Add to Queue'
            )
          )
        ),
        // Album info
        React.createElement('div', { className: 'space-y-1' },
          React.createElement('div', {
            className: 'font-medium text-gray-900 truncate group-hover:text-purple-600 transition-colors'
          }, album.title),
          React.createElement('div', {
            className: 'text-sm text-gray-500 truncate hover:text-purple-600 hover:underline cursor-pointer transition-colors',
            onClick: (e) => {
              e.stopPropagation();
              fetchArtistData(album.artist);
            }
          }, album.artist)
        )
      )
    )
  ),

  // Empty state
    !chartsLoading && charts.length === 0 && React.createElement('div', {
      className: 'text-center py-12 text-gray-400'
    },
      React.createElement('div', { className: 'text-4xl mb-4' }, '📊'),
      React.createElement('div', null, 'No charts data found. Try refreshing.')
    )
  )
),
```

**Step 2: Verify the Charts page displays**

Run: Open app, click Charts, verify album grid loads with rank badges.

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat: implement Charts page with album grid and rank badges"
```

---

## Task 8: Final Testing

**Step 1: Test full Charts flow**

1. Click "Charts" in sidebar
2. Verify loading spinner appears
3. Verify album grid populates with 50 albums
4. Verify rank badges (#1, #2, etc.) appear on each album
5. Verify album art loads progressively
6. Hover over album - verify "Add to Queue" button appears
7. Click album - verify it navigates to release page
8. Click artist name - verify it navigates to artist page
9. Click "Add to Queue" - verify tracks are added

**Step 2: Final commit**

```bash
git add -A
git commit -m "feat: complete Charts page implementation with Apple Music RSS feed"
```

---

## Summary

This implementation adds:
- State management for charts data (`charts`, `chartsLoading`, `chartsLoaded`)
- Apple Music RSS parser (`parseChartsRSS`)
- Data loading function (`loadCharts`)
- Album art fetcher with caching (`fetchChartsAlbumArt`)
- Album navigation (`openChartsAlbum`, `prefetchChartsTracks`, `addChartsToQueue`)
- Album grid UI with rank badges, hover effects, and artist navigation

The Charts page follows the exact same pattern as Critics Picks but displays rank position instead of Metacritic score.
