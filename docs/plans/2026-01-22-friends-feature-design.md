# Friends Feature Design

## Overview

Add social features allowing users to follow friends via Last.fm and ListenBrainz, view their listening history, and see when they're actively listening.

## Data Model

### Friend Object

```javascript
{
  id: string,           // unique ID (uuid)
  username: string,     // Last.fm or ListenBrainz username
  service: 'lastfm' | 'listenbrainz',
  displayName: string,  // defaults to username, user can customize
  avatarUrl: string,    // fetched from service
  addedAt: number,      // timestamp when added
  lastFetched: number,  // timestamp of last data fetch
  cachedRecentTrack: {  // for "on air" display without re-fetching
    name: string,
    artist: string,
    timestamp: number,
    albumArt: string
  } | null
}
```

### Sidebar Pins (separate storage)

```javascript
{
  pinnedFriendIds: string[]  // ordered array of friend IDs visible in sidebar
}
```

- Only friends in this array appear in the sidebar
- Array order = display order (drag/drop reorders this array)
- Unpinning removes from array, friend remains in collection

### Storage

- Friends array stored in electron-store under key `friends`
- Pinned friend IDs stored separately under key `pinnedFriendIds`
- Avatar URLs cached locally

## On-Air Detection

- Friend is "on air" if `cachedRecentTrack.timestamp` is within **10 minutes**
- Pinned friends poll every 2-3 minutes for fresh data
- Visual indicator: small green dot on hexagonal avatar

## Adding Friends

### Single Input with Auto-Detection

One text field accepts:
- `username` → tries Last.fm first, then ListenBrainz
- `https://www.last.fm/user/username` → Last.fm
- `https://listenbrainz.org/user/username` → ListenBrainz

### Detection Logic

```javascript
if (input.includes('last.fm/user/'))          → extract username, use Last.fm
if (input.includes('listenbrainz.org/user/')) → extract username, use ListenBrainz
else → treat as username, try Last.fm API first, fallback to ListenBrainz
```

### Add Flow

1. Parse input to determine service + username
2. Fetch user info from appropriate API
3. If user exists, create friend object with fetched avatar
4. If user not found, show error toast
5. Fetch recent track for initial "on air" state
6. Add to friends collection, show success toast

### Location

- "Add Friend" button in Friends tab header (Collection → Friends tab)
- Opens modal/popover with input field

## Sidebar Display

### Location

New "FRIENDS" section below existing sidebar sections.

### Structure

```
FRIENDS                         [section header]
├── [⬡ avatar] Dan              [green dot if on-air]
│   └── "Track Name - Artist"   [clickable, faded]
├── [⬡ avatar] Casey
│   └── "Eels - Novocaine..."
├── [⬡ avatar] Iñigo
└── [⬡ avatar] Kevin
```

### Visual Elements

- **Avatar:** ~32px hexagonal image (`clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)`)
- **Name:** Display name next to avatar
- **On-air indicator:** Small green dot on avatar when active
- **Current track:** If on-air, truncated "Track - Artist" below name

### Interactions

- Click avatar → navigate to friend's History view
- Click current track → play that track (listen along)
- Right-click → context menu: "Unpin from Sidebar", "View History"
- Drag/drop to reorder within sidebar

### Pinning Actions

- Drag friend card from Collection → sidebar to pin
- Right-click friend → "Pin to Sidebar"
- Right-click pinned friend in sidebar → "Unpin from Sidebar"

### Empty State

Section visible with hint: "Drag friends here"

## Collection Friends Tab

### Location

New "Friends" tab in Collection view (alongside Artists, Albums, Tracks).

### Grid Layout

- Card grid matching Albums/Artists aesthetic
- Each card ~150-180px wide

### Friend Card Contents

- Hexagonal avatar (~80px)
- Display name below avatar
- Service badge (Last.fm or ListenBrainz icon)
- On-air indicator + current track snippet if active
- Pin icon if already pinned to sidebar

### Card Interactions

- Click card → navigate to friend's History view
- Right-click → "Pin to Sidebar" / "Unpin", "Remove Friend"
- Drag card to sidebar → pins friend

### Header

- Collapsible gradient header
- "Add Friend" button
- Search/filter input
- Sort options: A-Z, Z-A, Recently Added, On Air Now

### Empty State

"No friends yet. Add friends by their Last.fm or ListenBrainz username." with "Add Friend" button.

## Friend History View

### View Name

`friendHistory`

### Layout

Identical to existing History page, populated with friend's data.

### Header

- Collapsible gradient header
- Friend's hexagonal avatar (large)
- Display name + service badge
- On-air indicator if active
- "Pin to Sidebar" / "Unpin" button

### Tabs

- Recent
- Top Tracks
- Top Albums
- Top Artists

### Period Filter

Overall, 7 days, 1 month, 3 months, 6 months, 12 months

### Track Interactions

- Play track (listen along)
- Add to queue
- Add to playlist
- Full context menu

## API Integration

### Last.fm Endpoints

| Purpose | Endpoint |
|---------|----------|
| Validate user & get avatar | `user.getInfo` |
| Recent tracks | `user.getRecentTracks` |
| Top tracks | `user.getTopTracks` |
| Top albums | `user.getTopAlbums` |
| Top artists | `user.getTopArtists` |

### ListenBrainz Endpoints

| Purpose | Endpoint |
|---------|----------|
| Validate user | `GET /1/user/{username}` |
| Recent tracks | `GET /1/user/{username}/listens` |
| Top tracks | `GET /1/stats/user/{username}/recordings` |
| Top albums | `GET /1/stats/user/{username}/releases` |
| Top artists | `GET /1/stats/user/{username}/artists` |

### Avatar Fetching

- **Last.fm:** From `user.getInfo` response (`image` array)
- **ListenBrainz:** No native avatar - use generated fallback

### Polling Strategy

- Pinned friends: fetch recent track every 2 minutes
- Collection Friends tab: refresh all on mount
- Friend History view: fetch full data on navigation

## State Management

### New State Variables

```javascript
const [friends, setFriends] = useState([])
const [pinnedFriendIds, setPinnedFriendIds] = useState([])
const [currentFriend, setCurrentFriend] = useState(null)
const [friendHistoryTab, setFriendHistoryTab] = useState('recent')
const [friendHistoryData, setFriendHistoryData] = useState({
  recent: [],
  topTracks: [],
  topAlbums: [],
  topArtists: []
})
const [friendHistoryPeriod, setFriendHistoryPeriod] = useState('7day')
const [friendHistoryLoading, setFriendHistoryLoading] = useState(false)
```

### Persisted in electron-store

- `friends` - full friends array
- `pinnedFriendIds` - sidebar pin order

### Collection Tab Update

Add `'friends'` to possible `collectionTab` values.

## Test Accounts

- **Last.fm:** `ocelma` (https://www.last.fm/user/ocelma)
- **ListenBrainz:** `areyer` (https://listenbrainz.org/user/areyer/)

## Future Enhancement: Continuous Sync

Initial listen-along plays single track. Future enhancement:

- Real-time sync mode polling friend every 30-60 seconds
- Visual indicator: "Synced with [Friend]" in playbar
- Auto-advance when friend's track changes
- Exit sync by clicking indicator or playing something else
