# History Tab Design

## Overview

Add a "History" tab to the Your Music section that displays the user's recently played tracks from Last.fm, using the same visual treatment as Recommendations > Songs and the same header pattern as Charts.

## Data Source

- Last.fm API: `user.getRecentTracks`
- Endpoint: `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user={username}&api_key={key}&format=json&limit=50`
- Username retrieved from: `window.electron.store.get('lastfm')` → `lastfm.username`
- API key from: `lastfmApiKey.current` (loaded from env)

## Navigation

- Enable existing grayed-out "History" button in sidebar (under Your Music)
- New `activeView` value: `'history'`

## State Variables

```javascript
const [historyHeaderCollapsed, setHistoryHeaderCollapsed] = useState(false);
const [historySearchOpen, setHistorySearchOpen] = useState(false);
const [historySearch, setHistorySearch] = useState('');
const [historySortDropdownOpen, setHistorySortDropdownOpen] = useState(false);
const [historySort, setHistorySort] = useState('recent');
const [listeningHistory, setListeningHistory] = useState({ tracks: [], loading: true, error: null });
```

## UI Layout

### Header (Collapsible Hero)
- Height: 320px expanded → 80px collapsed
- Gradient: `from-cyan-500 via-blue-500 to-indigo-600`
- Title: "HISTORY" with track count
- Subtitle: "Your recent listening activity from Last.fm"

### Sticky Filter Bar
- Sort dropdown: "Recent" (default), "Artist A-Z", "Title A-Z"
- Expandable search/filter input

### Content Area
Track list table matching Recommendations > Songs:
- Columns: #, Title (280px), Artist (180px), Duration, Resolver icons
- Draggable rows
- Click to play (sets queue from remaining tracks)
- Right-click context menu
- Artist name clickable → navigate to artist page

## Data Fetching

`loadListeningHistory()` function:
1. Get username from `window.electron.store.get('lastfm')`
2. Get API key from `lastfmApiKey.current`
3. Handle missing username with friendly error
4. Fetch recent tracks from Last.fm API
5. Transform to track format:
   - `id`: `history-${index}-${timestamp}`
   - `title`: `track.name`
   - `artist`: `track.artist['#text']`
   - `album`: `track.album['#text']`
   - `albumArt`: `track.image[2]['#text']`
   - `playedAt`: `track.date?.uts`
   - `nowPlaying`: `track['@attr']?.nowplaying === 'true'`
6. Run through resolver pipeline

## Error States

- No Last.fm username: "Connect your Last.fm account in Settings > Resolvers"
- API error: "Failed to load history" + retry button
- Empty history: "No recent tracks found"

## Implementation Checklist

1. [x] Add state declarations (~line 1201)
2. [x] Add `handleHistoryScroll` callback (~line 1329)
3. [x] Add reset effect for history view (~line 1383)
4. [x] Add `filterHistory`, `sortHistory`, `historySortOptions` (~line 1618)
5. [x] Add `loadListeningHistory()` function (~line 7073)
6. [x] Update `loadRecommendations` to use dynamic username
7. [x] Enable sidebar History button (~line 9032)
8. [x] Add history view rendering (~line 13085)
9. [x] Add click-outside handler for history sort dropdown (~line 1266)
