# Charts Page Enhancement: Tabs, Sources & Filters

## Overview

Enhance the Charts page ("Pop of the Tops") with:
1. Header tabs to switch between Albums and Songs views
2. Source dropdown to select chart provider (iTunes/Apple Music vs Last.fm)
3. Secondary filters for country and genre (based on source capabilities)

## Current State

- Single view showing Apple Music Top 50 Albums
- Sort dropdown (Rank, A-Z, Z-A)
- Collapsible header with gradient background
- Album grid with rank badges, hover states, and queue actions

## Target State

```
┌─────────────────────────────────────────────────────────────────┐
│                      POP OF THE TOPS                            │
│                    Albums  |  Songs                             │  ← Header tabs
├─────────────────────────────────────────────────────────────────┤
│ Source: [iTunes ▼]  Country: [United States ▼]  Sort: [Rank ▼] │  ← Filter bar
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Albums Tab: Grid of album cards (existing style)               │
│  Songs Tab: List rows like Recommended Songs                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Sources & API Endpoints

### Albums Tab

| Source | Endpoint | Filters Available |
|--------|----------|-------------------|
| **iTunes/Apple Music** | `https://rss.applemarketingtools.com/api/v2/{country}/music/most-played/{limit}/albums.json` | Country (ISO code) |
| **Last.fm** | `geo.gettopartracks` doesn't have albums; use `tag.gettopalbums` | Genre/Tag |

**Note:** Last.fm doesn't have a direct "top albums" chart endpoint. Options:
- `tag.gettopalbums` - Top albums by genre tag (rock, pop, electronic, etc.)
- `user.gettopalbums` - User's personal top albums (not global)
- Consider showing only iTunes for Albums, or use tag-based charts for Last.fm

### Songs Tab

| Source | Endpoint | Filters Available |
|--------|----------|-------------------|
| **iTunes/Apple Music** | `https://rss.applemarketingtools.com/api/v2/{country}/music/most-played/{limit}/songs.json` | Country (ISO code) |
| **Last.fm** | `geo.gettoptracks&country={country}` | Country (full name) |
| **Last.fm** | `chart.gettoptracks` | None (global) |
| **Last.fm** | `tag.gettoptracks&tag={genre}` | Genre/Tag |

### Country Codes

**iTunes countries** (ISO 3166-1 alpha-2):
```javascript
const itunesCountries = [
  { code: 'us', name: 'United States' },
  { code: 'gb', name: 'United Kingdom' },
  { code: 'ca', name: 'Canada' },
  { code: 'au', name: 'Australia' },
  { code: 'de', name: 'Germany' },
  { code: 'fr', name: 'France' },
  { code: 'jp', name: 'Japan' },
  { code: 'kr', name: 'South Korea' },
  { code: 'br', name: 'Brazil' },
  { code: 'mx', name: 'Mexico' },
  // ... more as needed
];
```

**Last.fm countries** (full names):
```javascript
const lastfmCountries = [
  'United States', 'United Kingdom', 'Canada', 'Australia',
  'Germany', 'France', 'Japan', 'Brazil', 'Mexico', 'Spain',
  'Italy', 'Netherlands', 'Sweden', 'Poland', 'Russia',
  // ... Last.fm uses full country names
];
```

**Last.fm Tags/Genres:**
```javascript
const lastfmTags = [
  'rock', 'pop', 'electronic', 'hip-hop', 'indie', 'metal',
  'jazz', 'classical', 'r&b', 'country', 'folk', 'punk',
  'alternative', 'soul', 'blues', 'reggae', 'latin'
];
```

---

## Implementation Tasks

### Task 1: Add State Variables

Add new state for tabs, source selection, and filters:

```javascript
// Charts tab state
const [chartsTab, setChartsTab] = useState('albums'); // 'albums' | 'songs'

// Charts source state
const [chartsSource, setChartsSource] = useState('itunes'); // 'itunes' | 'lastfm'

// Charts filter state
const [chartsCountry, setChartsCountry] = useState('us'); // ISO code for iTunes, full name for Last.fm
const [chartsGenre, setChartsGenre] = useState(''); // For Last.fm tag-based charts

// Charts songs data (new)
const [chartsSongs, setChartsSongs] = useState([]);
const [chartsSongsLoading, setChartsSongsLoading] = useState(false);

// Dropdown open states
const [chartsSourceDropdownOpen, setChartsSourceDropdownOpen] = useState(false);
const [chartsCountryDropdownOpen, setChartsCountryDropdownOpen] = useState(false);
const [chartsGenreDropdownOpen, setChartsGenreDropdownOpen] = useState(false);
```

**Location:** Around line 3296 in app.js (near existing charts state)

---

### Task 2: Add Header Tabs

Add tabs in the collapsible header, following the Artist page pattern:

**Expanded header state:**
```javascript
// Below the "POP OF THE TOPS" title
React.createElement('div', {
  className: 'flex items-center gap-1 mt-4',
  style: { textShadow: '0 1px 10px rgba(0,0,0,0.5)' }
},
  ['albums', 'songs'].map((tab, index) => [
    index > 0 && React.createElement('span', {
      key: `sep-${tab}`,
      className: 'text-white/50 mx-3'
    }, '|'),
    React.createElement('button', {
      key: tab,
      onClick: () => {
        setChartsTab(tab);
        // Load data for tab if needed
        if (tab === 'songs' && chartsSongs.length === 0) {
          loadChartsSongs();
        }
      },
      className: `px-2 py-1 text-sm font-medium uppercase tracking-wider transition-colors no-drag ${
        chartsTab === tab
          ? 'text-white'
          : 'text-white/60 hover:text-white'
      }`
    }, tab.charAt(0).toUpperCase() + tab.slice(1))
  ]).flat().filter(Boolean)
)
```

**Collapsed header state:**
```javascript
// Inline with title on the right side
React.createElement('div', {
  className: 'flex items-center gap-1 ml-6'
},
  ['albums', 'songs'].map((tab, index) => [
    index > 0 && React.createElement('span', {
      key: `sep-${tab}`,
      className: 'text-white/50 mx-2'
    }, '|'),
    React.createElement('button', {
      key: tab,
      onClick: () => setChartsTab(tab),
      className: `px-2 py-1 text-sm font-medium uppercase tracking-wider transition-colors no-drag ${
        chartsTab === tab ? 'text-white' : 'text-white/60 hover:text-white'
      }`
    }, tab.charAt(0).toUpperCase() + tab.slice(1))
  ]).flat().filter(Boolean)
)
```

**Location:** Lines 28462-28520 (header rendering)

---

### Task 3: Update Filter Bar with Source & Country Dropdowns

Replace/extend the existing sort dropdown area:

```javascript
React.createElement('div', {
  className: 'flex items-center gap-4 px-6 py-3 bg-white border-b border-gray-200',
  style: { flexShrink: 0 }
},
  // Source dropdown
  React.createElement('div', { className: 'relative' },
    React.createElement('button', {
      onClick: () => setChartsSourceDropdownOpen(!chartsSourceDropdownOpen),
      className: 'flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors'
    },
      React.createElement('span', { className: 'text-gray-400' }, 'Source:'),
      React.createElement('span', { className: 'font-medium' },
        chartsSource === 'itunes' ? 'iTunes' : 'Last.fm'
      ),
      // Chevron down SVG
    ),
    chartsSourceDropdownOpen && React.createElement('div', {
      className: 'absolute left-0 top-full mt-1 bg-white rounded-lg shadow-lg py-1 min-w-[140px] z-30 border border-gray-200'
    },
      [
        { value: 'itunes', label: 'iTunes', icon: '🍎' },
        { value: 'lastfm', label: 'Last.fm', icon: '📻' }
      ].map(option => /* dropdown item with checkmark */)
    )
  ),

  // Country dropdown (shown for both sources)
  React.createElement('div', { className: 'relative' },
    React.createElement('button', {
      onClick: () => setChartsCountryDropdownOpen(!chartsCountryDropdownOpen),
      className: 'flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors'
    },
      React.createElement('span', { className: 'text-gray-400' }, 'Country:'),
      React.createElement('span', { className: 'font-medium' },
        getCountryName(chartsCountry)
      ),
      // Chevron down SVG
    ),
    chartsCountryDropdownOpen && /* country dropdown menu */
  ),

  // Genre dropdown (shown only for Last.fm)
  chartsSource === 'lastfm' && React.createElement('div', { className: 'relative' },
    React.createElement('button', {
      onClick: () => setChartsGenreDropdownOpen(!chartsGenreDropdownOpen),
      className: 'flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors'
    },
      React.createElement('span', { className: 'text-gray-400' }, 'Genre:'),
      React.createElement('span', { className: 'font-medium' },
        chartsGenre || 'All'
      ),
      // Chevron down SVG
    ),
    chartsGenreDropdownOpen && /* genre dropdown menu */
  ),

  // Spacer
  React.createElement('div', { className: 'flex-1' }),

  // Existing sort dropdown (for albums tab)
  chartsTab === 'albums' && /* existing sort dropdown */
)
```

**Location:** Lines 28525-28570 (filter bar)

---

### Task 4: Add iTunes Songs API Parser

Create parser for iTunes songs JSON feed:

```javascript
function parseChartsSongsJSON(data) {
  try {
    const songs = data.feed.results || [];
    return songs.map((song, index) => ({
      id: song.id || `itunes-song-${index}`,
      title: song.name,
      artist: song.artistName,
      album: song.collectionName || '',
      albumArt: song.artworkUrl100?.replace('100x100', '300x300') || null,
      rank: index + 1,
      genres: song.genres?.map(g => g.name) || [],
      releaseDate: song.releaseDate,
      url: song.url,
      duration: song.durationInMillis ? Math.floor(song.durationInMillis / 1000) : null,
      source: 'itunes'
    }));
  } catch (error) {
    console.error('Error parsing iTunes songs:', error);
    return [];
  }
}
```

**Location:** Near line 14500 (after parseChartsJSON)

---

### Task 5: Add Last.fm Charts API Functions

Create functions to fetch Last.fm chart data:

```javascript
// Fetch Last.fm top tracks by country
async function loadLastfmChartsSongs(country = 'United States') {
  setChartsSongsLoading(true);
  try {
    const params = new URLSearchParams({
      method: 'geo.gettoptracks',
      country: country,
      api_key: lastfmApiKey,
      format: 'json',
      limit: 50
    });

    const response = await fetch(`https://ws.audioscrobbler.com/2.0/?${params}`);
    const data = await response.json();

    if (data.tracks?.track) {
      const songs = data.tracks.track.map((track, index) => ({
        id: `lastfm-${track.mbid || index}`,
        title: track.name,
        artist: track.artist.name,
        album: '', // Last.fm doesn't include album in geo.gettoptracks
        rank: index + 1,
        listeners: parseInt(track.listeners) || 0,
        url: track.url,
        duration: parseInt(track.duration) || null,
        source: 'lastfm',
        mbid: track.mbid
      }));
      setChartsSongs(songs);
    }
  } catch (error) {
    console.error('Error fetching Last.fm charts:', error);
    showNotification('Failed to load Last.fm charts', 'error');
  } finally {
    setChartsSongsLoading(false);
  }
}

// Fetch Last.fm top tracks by tag/genre
async function loadLastfmChartsTagSongs(tag) {
  setChartsSongsLoading(true);
  try {
    const params = new URLSearchParams({
      method: 'tag.gettoptracks',
      tag: tag,
      api_key: lastfmApiKey,
      format: 'json',
      limit: 50
    });

    const response = await fetch(`https://ws.audioscrobbler.com/2.0/?${params}`);
    const data = await response.json();

    if (data.tracks?.track) {
      const songs = data.tracks.track.map((track, index) => ({
        id: `lastfm-tag-${track.mbid || index}`,
        title: track.name,
        artist: track.artist.name,
        album: '',
        rank: index + 1,
        duration: parseInt(track.duration) || null,
        source: 'lastfm',
        mbid: track.mbid
      }));
      setChartsSongs(songs);
    }
  } catch (error) {
    console.error('Error fetching Last.fm tag charts:', error);
  } finally {
    setChartsSongsLoading(false);
  }
}

// Fetch Last.fm top albums by tag (for Albums tab with Last.fm source)
async function loadLastfmChartsAlbums(tag = 'rock') {
  setChartsLoading(true);
  try {
    const params = new URLSearchParams({
      method: 'tag.gettopalbums',
      tag: tag,
      api_key: lastfmApiKey,
      format: 'json',
      limit: 50
    });

    const response = await fetch(`https://ws.audioscrobbler.com/2.0/?${params}`);
    const data = await response.json();

    if (data.albums?.album) {
      const albums = data.albums.album.map((album, index) => ({
        id: album.mbid || `lastfm-album-${index}`,
        title: album.name,
        artist: album.artist.name,
        rank: index + 1,
        url: album.url,
        source: 'lastfm',
        mbid: album.mbid,
        // Last.fm provides image array
        albumArt: album.image?.find(img => img.size === 'extralarge')?.['#text'] || null
      }));
      setCharts(albums);
    }
  } catch (error) {
    console.error('Error fetching Last.fm album charts:', error);
  } finally {
    setChartsLoading(false);
  }
}
```

**Location:** Near line 14700 (after existing chart functions)

---

### Task 6: Add iTunes Songs Loader

```javascript
async function loadChartsSongs() {
  setChartsSongsLoading(true);
  try {
    const country = chartsSource === 'itunes' ? chartsCountry : 'us';
    const url = `https://rss.applemarketingtools.com/api/v2/${country}/music/most-played/50/songs.json`;

    const response = await fetch(url);
    const data = await response.json();
    const songs = parseChartsSongsJSON(data);
    setChartsSongs(songs);
  } catch (error) {
    console.error('Error loading iTunes songs charts:', error);
    showNotification('Failed to load songs charts', 'error');
  } finally {
    setChartsSongsLoading(false);
  }
}
```

---

### Task 7: Add Effect to Reload on Filter Changes

```javascript
useEffect(() => {
  if (chartsTab === 'albums') {
    if (chartsSource === 'itunes') {
      loadCharts(); // Existing function, update to use chartsCountry
    } else {
      loadLastfmChartsAlbums(chartsGenre || 'rock');
    }
  } else {
    if (chartsSource === 'itunes') {
      loadChartsSongs();
    } else if (chartsGenre) {
      loadLastfmChartsTagSongs(chartsGenre);
    } else {
      loadLastfmChartsSongs(chartsCountry);
    }
  }
}, [chartsTab, chartsSource, chartsCountry, chartsGenre]);
```

---

### Task 8: Render Songs Tab Content

Create the songs list view following Recommended Songs pattern:

```javascript
// Inside charts page content area
chartsTab === 'songs' && React.createElement('div', {
  className: 'px-6 py-4'
},
  chartsSongsLoading
    ? /* Loading shimmer rows */
    : chartsSongs.map((song, index) =>
        React.createElement('div', {
          key: song.id,
          className: `flex items-center gap-4 py-3 px-4 cursor-grab active:cursor-grabbing transition-all group hover:bg-gray-50/80`,
          style: { borderRadius: '8px', marginBottom: '2px' },
          draggable: true,
          onClick: () => handlePlayChartSong(song),
          onContextMenu: (e) => handleSongContextMenu(e, song)
        },
          // Rank number
          React.createElement('span', {
            className: 'flex-shrink-0 text-right font-medium',
            style: { width: '32px', fontSize: '12px', color: '#9ca3af' }
          }, String(song.rank).padStart(2, '0')),

          // Album art (small, for songs)
          song.albumArt && React.createElement('img', {
            src: song.albumArt,
            alt: song.title,
            className: 'rounded',
            style: { width: '40px', height: '40px', objectFit: 'cover', flexShrink: 0 }
          }),

          // Song title
          React.createElement('span', {
            className: 'truncate transition-colors',
            style: { width: '300px', flexShrink: 0, fontSize: '13px', color: '#374151', fontWeight: 500 }
          }, song.title),

          // Artist name (clickable)
          React.createElement('span', {
            className: 'truncate hover:text-purple-600 hover:underline cursor-pointer transition-colors',
            style: { width: '200px', flexShrink: 0, fontSize: '12px', color: '#6b7280' },
            onClick: (e) => { e.stopPropagation(); fetchArtistData(song.artist); }
          }, song.artist),

          // Album name
          React.createElement('span', {
            className: 'truncate',
            style: { width: '150px', flexShrink: 0, fontSize: '12px', color: '#9ca3af' }
          }, song.album || ''),

          // Duration
          song.duration && React.createElement('span', {
            className: 'text-right tabular-nums',
            style: { width: '50px', flexShrink: 0, marginLeft: 'auto', fontSize: '12px', color: '#9ca3af' }
          }, formatTime(song.duration)),

          // Source badge
          React.createElement('span', {
            className: 'px-2 py-0.5 rounded text-xs',
            style: {
              backgroundColor: song.source === 'lastfm' ? '#dc262615' : '#7c3aed15',
              color: song.source === 'lastfm' ? '#dc2626' : '#7c3aed'
            }
          }, song.source === 'lastfm' ? 'Last.fm' : 'iTunes')
        )
      )
)
```

**Location:** Lines 28580+ (content area)

---

### Task 9: Update Existing loadCharts to Support Country

Modify the existing `loadCharts` function to use the country filter:

```javascript
async function loadCharts() {
  setChartsLoading(true);
  try {
    const country = chartsCountry || 'us';
    const url = `https://rss.applemarketingtools.com/api/v2/${country}/music/most-played/50/albums.json`;

    const response = await fetch(url);
    const data = await response.json();
    const albums = parseChartsJSON(data);
    setCharts(albums.map(a => ({ ...a, source: 'itunes' })));

    // Fetch album art in background
    fetchChartsAlbumArt(albums);
  } catch (error) {
    console.error('Error loading charts:', error);
  } finally {
    setChartsLoading(false);
  }
}
```

---

### Task 10: Add Click-Outside Handlers for Dropdowns

Add event listeners to close dropdowns when clicking outside:

```javascript
useEffect(() => {
  const handleClickOutside = (e) => {
    if (chartsSourceDropdownOpen || chartsCountryDropdownOpen || chartsGenreDropdownOpen) {
      // Close all dropdowns when clicking outside
      setChartsSourceDropdownOpen(false);
      setChartsCountryDropdownOpen(false);
      setChartsGenreDropdownOpen(false);
    }
  };

  document.addEventListener('click', handleClickOutside);
  return () => document.removeEventListener('click', handleClickOutside);
}, [chartsSourceDropdownOpen, chartsCountryDropdownOpen, chartsGenreDropdownOpen]);
```

---

## Constants to Add

```javascript
const CHARTS_COUNTRIES = [
  { code: 'us', name: 'United States', lastfmName: 'United States' },
  { code: 'gb', name: 'United Kingdom', lastfmName: 'United Kingdom' },
  { code: 'ca', name: 'Canada', lastfmName: 'Canada' },
  { code: 'au', name: 'Australia', lastfmName: 'Australia' },
  { code: 'de', name: 'Germany', lastfmName: 'Germany' },
  { code: 'fr', name: 'France', lastfmName: 'France' },
  { code: 'jp', name: 'Japan', lastfmName: 'Japan' },
  { code: 'kr', name: 'South Korea', lastfmName: 'South Korea' },
  { code: 'br', name: 'Brazil', lastfmName: 'Brazil' },
  { code: 'mx', name: 'Mexico', lastfmName: 'Mexico' },
  { code: 'es', name: 'Spain', lastfmName: 'Spain' },
  { code: 'it', name: 'Italy', lastfmName: 'Italy' },
  { code: 'nl', name: 'Netherlands', lastfmName: 'Netherlands' },
  { code: 'se', name: 'Sweden', lastfmName: 'Sweden' },
  { code: 'pl', name: 'Poland', lastfmName: 'Poland' },
];

const LASTFM_GENRES = [
  'rock', 'pop', 'electronic', 'hip-hop', 'indie', 'metal',
  'jazz', 'classical', 'r&b', 'country', 'folk', 'punk',
  'alternative', 'soul', 'blues', 'reggae', 'latin', 'dance'
];
```

---

## File Changes Summary

| File | Changes |
|------|---------|
| `app.js` | Add state variables (~line 3296) |
| `app.js` | Add constants for countries/genres (~line 200) |
| `app.js` | Update header with tabs (~line 28462) |
| `app.js` | Update filter bar with dropdowns (~line 28525) |
| `app.js` | Add songs parser function (~line 14500) |
| `app.js` | Add Last.fm chart functions (~line 14700) |
| `app.js` | Add songs tab content rendering (~line 28580) |
| `app.js` | Update loadCharts for country support (~line 14644) |
| `app.js` | Add useEffect for filter changes |
| `app.js` | Add click-outside handlers |

---

## Testing Checklist

- [ ] Albums tab shows iTunes charts by default
- [ ] Songs tab shows iTunes songs charts
- [ ] Source dropdown switches between iTunes and Last.fm
- [ ] Country dropdown filters charts correctly
- [ ] Genre dropdown appears only for Last.fm source
- [ ] Last.fm songs charts load and display correctly
- [ ] Last.fm album charts (by tag) load and display correctly
- [ ] Song rows have correct hover states
- [ ] Songs are playable (click to play)
- [ ] Artist names are clickable (navigate to artist page)
- [ ] Drag-and-drop works for adding songs to queue
- [ ] Header collapses correctly with tabs visible
- [ ] Dropdowns close when clicking outside
- [ ] Loading states show shimmer/skeleton
- [ ] Error states show notifications

---

## Future Enhancements

1. **Billboard Charts** - Add via unofficial API or scraping service
2. **Spotify Charts** - Add if API access becomes available
3. **Chart History** - Show how songs/albums moved up/down
4. **Personal Charts** - User's own listening stats as a "chart"
5. **Chart Playlists** - One-click to create playlist from chart
