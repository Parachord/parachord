# Friends Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add social features allowing users to follow friends via Last.fm and ListenBrainz, view their listening history, and see real-time "on air" status.

**Architecture:** Friends data stored locally via electron-store. Sidebar displays pinned friends with hexagonal avatars and on-air indicators. Collection gets a new Friends tab. Friend profiles mirror the existing History page structure, reusing the same API patterns.

**Tech Stack:** React (via CDN), electron-store for persistence, Last.fm API, ListenBrainz API, Tailwind CSS

**Test accounts:**
- Last.fm: `ocelma`
- ListenBrainz: `areyer`

---

## Task 1: Add Friends State Variables

**Files:**
- Modify: `app.js:1305-1360` (after Collection page state, before History page state)

**Step 1: Add state variables after line 1315 (after collectionSort)**

Find this block:
```javascript
const [collectionSort, setCollectionSort] = useState({
  artists: 'alpha-asc',
  albums: 'recent',
  tracks: 'recent'
});
```

Add after it:
```javascript
// Friends state
const [friends, setFriends] = useState([]);
const [pinnedFriendIds, setPinnedFriendIds] = useState([]);
const [currentFriend, setCurrentFriend] = useState(null);
const [friendHistoryTab, setFriendHistoryTab] = useState('recent');
const [friendHistoryData, setFriendHistoryData] = useState({
  recent: [],
  topTracks: [],
  topAlbums: [],
  topArtists: []
});
const [friendHistoryPeriod, setFriendHistoryPeriod] = useState('7day');
const [friendHistoryLoading, setFriendHistoryLoading] = useState(false);
const [addFriendModalOpen, setAddFriendModalOpen] = useState(false);
const [addFriendInput, setAddFriendInput] = useState('');
const [addFriendLoading, setAddFriendLoading] = useState(false);
const friendPollIntervalRef = useRef(null);
```

**Step 2: Update collectionTab comment**

Change:
```javascript
const [collectionTab, setCollectionTab] = useState('tracks'); // 'artists' | 'albums' | 'tracks'
```

To:
```javascript
const [collectionTab, setCollectionTab] = useState('tracks'); // 'artists' | 'albums' | 'tracks' | 'friends'
```

**Step 3: Run the app to verify no errors**

Run: `npm start`
Expected: App starts without errors

**Step 4: Commit**

```bash
git add app.js
git commit -m "feat(friends): add state variables for friends feature"
```

---

## Task 2: Add Friends Persistence (electron-store)

**Files:**
- Modify: `app.js` - find the existing electron-store load/save patterns

**Step 1: Find where metaServiceConfigs is loaded from store**

Search for `window.electron.store.get('meta_service_configs')` and add friends loading nearby.

Add this code in the same useEffect that loads other persisted state (around line 2618-2650):

```javascript
// Load friends from storage
const savedFriends = await window.electron.store.get('friends');
if (savedFriends && Array.isArray(savedFriends)) {
  setFriends(savedFriends);
  console.log(`👥 Loaded ${savedFriends.length} friends from storage`);
}

const savedPinnedFriendIds = await window.electron.store.get('pinnedFriendIds');
if (savedPinnedFriendIds && Array.isArray(savedPinnedFriendIds)) {
  setPinnedFriendIds(savedPinnedFriendIds);
  console.log(`📌 Loaded ${savedPinnedFriendIds.length} pinned friends from storage`);
}
```

**Step 2: Add useEffect to persist friends when they change**

Find the pattern used for other persisted state (like metaServiceConfigs) and add:

```javascript
// Persist friends to storage
useEffect(() => {
  if (friends.length > 0 || window.electron?.store) {
    window.electron?.store?.set('friends', friends);
  }
}, [friends]);

// Persist pinned friend IDs to storage
useEffect(() => {
  if (pinnedFriendIds.length > 0 || window.electron?.store) {
    window.electron?.store?.set('pinnedFriendIds', pinnedFriendIds);
  }
}, [pinnedFriendIds]);
```

**Step 3: Run the app to verify persistence works**

Run: `npm start`
Expected: App starts, check console for friends loading messages

**Step 4: Commit**

```bash
git add app.js
git commit -m "feat(friends): add electron-store persistence for friends"
```

---

## Task 3: Add Friend API Helper Functions

**Files:**
- Modify: `app.js` - add after the existing loadTopAlbums function (around line 8945)

**Step 1: Add parseFriendInput function**

```javascript
// Parse friend input to extract service and username
const parseFriendInput = (input) => {
  const trimmed = input.trim();

  // Check for Last.fm URL
  const lastfmMatch = trimmed.match(/last\.fm\/user\/([^\/\?]+)/i);
  if (lastfmMatch) {
    return { service: 'lastfm', username: lastfmMatch[1] };
  }

  // Check for ListenBrainz URL
  const listenbrainzMatch = trimmed.match(/listenbrainz\.org\/user\/([^\/\?]+)/i);
  if (listenbrainzMatch) {
    return { service: 'listenbrainz', username: listenbrainzMatch[1] };
  }

  // Plain username - will try Last.fm first, then ListenBrainz
  return { service: null, username: trimmed };
};
```

**Step 2: Add fetchLastfmUserInfo function**

```javascript
// Fetch Last.fm user info (avatar, display name)
const fetchLastfmUserInfo = async (username) => {
  const apiKey = lastfmApiKey.current;
  if (!apiKey) throw new Error('Last.fm API key not configured');

  const url = `https://ws.audioscrobbler.com/2.0/?method=user.getinfo&user=${encodeURIComponent(username)}&api_key=${apiKey}&format=json`;
  const response = await fetch(url);

  if (!response.ok) {
    if (response.status === 404) throw new Error('User not found on Last.fm');
    throw new Error(`Last.fm API error: ${response.status}`);
  }

  const data = await response.json();
  if (data.error) throw new Error(data.message || 'User not found on Last.fm');

  const user = data.user;
  return {
    username: user.name,
    displayName: user.realname || user.name,
    avatarUrl: user.image?.[2]?.['#text'] || user.image?.[1]?.['#text'] || null
  };
};
```

**Step 3: Add fetchListenbrainzUserInfo function**

```javascript
// Fetch ListenBrainz user info
const fetchListenbrainzUserInfo = async (username) => {
  const url = `https://api.listenbrainz.org/1/user/${encodeURIComponent(username)}`;
  const response = await fetch(url);

  if (!response.ok) {
    if (response.status === 404) throw new Error('User not found on ListenBrainz');
    throw new Error(`ListenBrainz API error: ${response.status}`);
  }

  // ListenBrainz doesn't have avatars, return username only
  return {
    username: username,
    displayName: username,
    avatarUrl: null // Will use generated avatar fallback
  };
};
```

**Step 4: Add fetchFriendRecentTrack function**

```javascript
// Fetch friend's most recent track (for on-air status)
const fetchFriendRecentTrack = async (friend) => {
  try {
    if (friend.service === 'lastfm') {
      const apiKey = lastfmApiKey.current;
      if (!apiKey) return null;

      const url = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${encodeURIComponent(friend.username)}&api_key=${apiKey}&format=json&limit=1`;
      const response = await fetch(url);
      if (!response.ok) return null;

      const data = await response.json();
      const track = data.recenttracks?.track?.[0];
      if (!track) return null;

      // Check if currently playing (no date means currently playing)
      const isNowPlaying = track['@attr']?.nowplaying === 'true';
      const timestamp = isNowPlaying ? Date.now() : (track.date?.uts ? parseInt(track.date.uts) * 1000 : null);

      return {
        name: track.name,
        artist: track.artist?.['#text'] || track.artist?.name || 'Unknown Artist',
        timestamp: timestamp,
        albumArt: track.image?.[2]?.['#text'] || track.image?.[1]?.['#text'] || null
      };
    } else if (friend.service === 'listenbrainz') {
      const url = `https://api.listenbrainz.org/1/user/${encodeURIComponent(friend.username)}/listens?count=1`;
      const response = await fetch(url);
      if (!response.ok) return null;

      const data = await response.json();
      const listen = data.payload?.listens?.[0];
      if (!listen) return null;

      return {
        name: listen.track_metadata?.track_name || 'Unknown Track',
        artist: listen.track_metadata?.artist_name || 'Unknown Artist',
        timestamp: listen.listened_at ? listen.listened_at * 1000 : null,
        albumArt: null // ListenBrainz doesn't provide album art in listens
      };
    }
    return null;
  } catch (error) {
    console.error(`Error fetching recent track for ${friend.username}:`, error);
    return null;
  }
};
```

**Step 5: Add isOnAir helper function**

```javascript
// Check if friend is "on air" (listened within last 10 minutes)
const isOnAir = (friend) => {
  if (!friend.cachedRecentTrack?.timestamp) return false;
  const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
  return friend.cachedRecentTrack.timestamp > tenMinutesAgo;
};
```

**Step 6: Run the app to verify no errors**

Run: `npm start`
Expected: App starts without errors

**Step 7: Commit**

```bash
git add app.js
git commit -m "feat(friends): add API helper functions for Last.fm and ListenBrainz"
```

---

## Task 4: Add Friend Management Functions

**Files:**
- Modify: `app.js` - add after the helper functions from Task 3

**Step 1: Add addFriend function**

```javascript
// Add a friend from username or URL
const addFriend = async (input) => {
  setAddFriendLoading(true);

  try {
    const { service, username } = parseFriendInput(input);

    if (!username) {
      showToast('Please enter a username or profile URL', 'error');
      return;
    }

    let userInfo = null;
    let finalService = service;

    if (service === 'lastfm') {
      userInfo = await fetchLastfmUserInfo(username);
      finalService = 'lastfm';
    } else if (service === 'listenbrainz') {
      userInfo = await fetchListenbrainzUserInfo(username);
      finalService = 'listenbrainz';
    } else {
      // Try Last.fm first, then ListenBrainz
      try {
        userInfo = await fetchLastfmUserInfo(username);
        finalService = 'lastfm';
      } catch (lfmError) {
        console.log(`User not found on Last.fm, trying ListenBrainz...`);
        try {
          userInfo = await fetchListenbrainzUserInfo(username);
          finalService = 'listenbrainz';
        } catch (lbError) {
          throw new Error('User not found on Last.fm or ListenBrainz');
        }
      }
    }

    // Check if already added
    const existingFriend = friends.find(f =>
      f.username.toLowerCase() === userInfo.username.toLowerCase() &&
      f.service === finalService
    );
    if (existingFriend) {
      showToast(`${userInfo.displayName} is already in your friends list`, 'error');
      return;
    }

    // Create friend object
    const newFriend = {
      id: `friend-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      username: userInfo.username,
      service: finalService,
      displayName: userInfo.displayName,
      avatarUrl: userInfo.avatarUrl,
      addedAt: Date.now(),
      lastFetched: Date.now(),
      cachedRecentTrack: null
    };

    // Fetch recent track for initial on-air status
    const recentTrack = await fetchFriendRecentTrack(newFriend);
    if (recentTrack) {
      newFriend.cachedRecentTrack = recentTrack;
    }

    setFriends(prev => [...prev, newFriend]);
    setAddFriendModalOpen(false);
    setAddFriendInput('');
    showToast(`Added ${newFriend.displayName} from ${finalService === 'lastfm' ? 'Last.fm' : 'ListenBrainz'}`);

    console.log(`👥 Added friend: ${newFriend.displayName} (${finalService})`);
  } catch (error) {
    console.error('Failed to add friend:', error);
    showToast(error.message || 'Failed to add friend', 'error');
  } finally {
    setAddFriendLoading(false);
  }
};
```

**Step 2: Add removeFriend function**

```javascript
// Remove a friend
const removeFriend = (friendId) => {
  setFriends(prev => prev.filter(f => f.id !== friendId));
  setPinnedFriendIds(prev => prev.filter(id => id !== friendId));
  showToast('Friend removed');
};
```

**Step 3: Add pinFriend and unpinFriend functions**

```javascript
// Pin a friend to the sidebar
const pinFriend = (friendId) => {
  if (!pinnedFriendIds.includes(friendId)) {
    setPinnedFriendIds(prev => [...prev, friendId]);
    const friend = friends.find(f => f.id === friendId);
    if (friend) {
      showToast(`${friend.displayName} pinned to sidebar`);
    }
  }
};

// Unpin a friend from the sidebar
const unpinFriend = (friendId) => {
  setPinnedFriendIds(prev => prev.filter(id => id !== friendId));
  const friend = friends.find(f => f.id === friendId);
  if (friend) {
    showToast(`${friend.displayName} unpinned from sidebar`);
  }
};
```

**Step 4: Add reorderPinnedFriends function**

```javascript
// Reorder pinned friends in sidebar (for drag-drop)
const reorderPinnedFriends = (fromIndex, toIndex) => {
  setPinnedFriendIds(prev => {
    const newOrder = [...prev];
    const [removed] = newOrder.splice(fromIndex, 1);
    newOrder.splice(toIndex, 0, removed);
    return newOrder;
  });
};
```

**Step 5: Add refreshPinnedFriends function for polling**

```javascript
// Refresh recent tracks for pinned friends (for polling)
const refreshPinnedFriends = async () => {
  const pinnedFriends = friends.filter(f => pinnedFriendIds.includes(f.id));

  for (const friend of pinnedFriends) {
    const recentTrack = await fetchFriendRecentTrack(friend);
    if (recentTrack) {
      setFriends(prev => prev.map(f =>
        f.id === friend.id
          ? { ...f, cachedRecentTrack: recentTrack, lastFetched: Date.now() }
          : f
      ));
    }
  }
};
```

**Step 6: Add useEffect for polling pinned friends**

```javascript
// Poll pinned friends every 2 minutes for on-air status
useEffect(() => {
  if (pinnedFriendIds.length > 0) {
    // Initial refresh
    refreshPinnedFriends();

    // Set up polling interval
    friendPollIntervalRef.current = setInterval(refreshPinnedFriends, 2 * 60 * 1000);

    return () => {
      if (friendPollIntervalRef.current) {
        clearInterval(friendPollIntervalRef.current);
      }
    };
  }
}, [pinnedFriendIds.length]);
```

**Step 7: Run the app to verify no errors**

Run: `npm start`
Expected: App starts without errors

**Step 8: Commit**

```bash
git add app.js
git commit -m "feat(friends): add friend management functions (add, remove, pin, unpin)"
```

---

## Task 5: Add Friend History Data Loading Functions

**Files:**
- Modify: `app.js` - add after the friend management functions

**Step 1: Add loadFriendRecentTracks function**

```javascript
// Load friend's recent listening history
const loadFriendRecentTracks = async (friend) => {
  setFriendHistoryLoading(true);

  try {
    let tracks = [];

    if (friend.service === 'lastfm') {
      const apiKey = lastfmApiKey.current;
      if (!apiKey) throw new Error('Last.fm API key not configured');

      const url = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${encodeURIComponent(friend.username)}&api_key=${apiKey}&format=json&limit=50`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch recent tracks: ${response.status}`);

      const data = await response.json();
      const recentTracks = data.recenttracks?.track || [];

      tracks = recentTracks.map((track, index) => ({
        id: `friend-recent-${index}-${track.name}`.replace(/\s+/g, '-'),
        title: track.name,
        artist: track.artist?.['#text'] || track.artist?.name || 'Unknown Artist',
        album: track.album?.['#text'] || null,
        albumArt: track.image?.[2]?.['#text'] || track.image?.[1]?.['#text'] || null,
        timestamp: track.date?.uts ? parseInt(track.date.uts) * 1000 : Date.now(),
        nowPlaying: track['@attr']?.nowplaying === 'true',
        sources: {}
      }));
    } else if (friend.service === 'listenbrainz') {
      const url = `https://api.listenbrainz.org/1/user/${encodeURIComponent(friend.username)}/listens?count=50`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch listens: ${response.status}`);

      const data = await response.json();
      const listens = data.payload?.listens || [];

      tracks = listens.map((listen, index) => ({
        id: `friend-recent-${index}-${listen.track_metadata?.track_name}`.replace(/\s+/g, '-'),
        title: listen.track_metadata?.track_name || 'Unknown Track',
        artist: listen.track_metadata?.artist_name || 'Unknown Artist',
        album: listen.track_metadata?.release_name || null,
        albumArt: null,
        timestamp: listen.listened_at ? listen.listened_at * 1000 : Date.now(),
        nowPlaying: false,
        sources: {}
      }));
    }

    setFriendHistoryData(prev => ({ ...prev, recent: tracks }));

    // Resolve tracks in background
    if (tracks.length > 0) {
      resolveHistoryTracks(tracks);
    }
  } catch (error) {
    console.error('Failed to load friend recent tracks:', error);
    showToast('Failed to load listening history', 'error');
  } finally {
    setFriendHistoryLoading(false);
  }
};
```

**Step 2: Add loadFriendTopTracks function**

```javascript
// Load friend's top tracks
const loadFriendTopTracks = async (friend, period = friendHistoryPeriod) => {
  if (friend.service !== 'lastfm') {
    // ListenBrainz uses different endpoint
    return loadFriendTopTracksListenBrainz(friend, period);
  }

  setFriendHistoryLoading(true);

  try {
    const apiKey = lastfmApiKey.current;
    if (!apiKey) throw new Error('Last.fm API key not configured');

    const url = `https://ws.audioscrobbler.com/2.0/?method=user.gettoptracks&user=${encodeURIComponent(friend.username)}&api_key=${apiKey}&format=json&period=${period}&limit=50`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch top tracks: ${response.status}`);

    const data = await response.json();
    const topTracksList = data.toptracks?.track || [];

    const tracks = topTracksList.map((track, index) => ({
      id: `friend-top-track-${index}-${track.name}`.replace(/\s+/g, '-'),
      title: track.name,
      artist: track.artist?.name || 'Unknown Artist',
      albumArt: track.image?.[2]?.['#text'] || null,
      playCount: parseInt(track.playcount) || 0,
      rank: index + 1,
      sources: {}
    }));

    setFriendHistoryData(prev => ({ ...prev, topTracks: tracks }));

    if (tracks.length > 0) {
      resolveTopTracks(tracks);
    }
  } catch (error) {
    console.error('Failed to load friend top tracks:', error);
    showToast('Failed to load top tracks', 'error');
  } finally {
    setFriendHistoryLoading(false);
  }
};

// ListenBrainz version
const loadFriendTopTracksListenBrainz = async (friend, period) => {
  setFriendHistoryLoading(true);

  try {
    const range = period === 'overall' ? 'all_time' : period === '7day' ? 'week' : period === '1month' ? 'month' : period === '3month' ? 'quarter' : period === '6month' ? 'half_yearly' : 'year';
    const url = `https://api.listenbrainz.org/1/stats/user/${encodeURIComponent(friend.username)}/recordings?range=${range}&count=50`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch top recordings: ${response.status}`);

    const data = await response.json();
    const recordings = data.payload?.recordings || [];

    const tracks = recordings.map((rec, index) => ({
      id: `friend-top-track-${index}-${rec.track_name}`.replace(/\s+/g, '-'),
      title: rec.track_name || 'Unknown Track',
      artist: rec.artist_name || 'Unknown Artist',
      albumArt: null,
      playCount: rec.listen_count || 0,
      rank: index + 1,
      sources: {}
    }));

    setFriendHistoryData(prev => ({ ...prev, topTracks: tracks }));
  } catch (error) {
    console.error('Failed to load friend top tracks:', error);
    showToast('Failed to load top tracks', 'error');
  } finally {
    setFriendHistoryLoading(false);
  }
};
```

**Step 3: Add loadFriendTopArtists function**

```javascript
// Load friend's top artists
const loadFriendTopArtists = async (friend, period = friendHistoryPeriod) => {
  setFriendHistoryLoading(true);

  try {
    let artists = [];

    if (friend.service === 'lastfm') {
      const apiKey = lastfmApiKey.current;
      if (!apiKey) throw new Error('Last.fm API key not configured');

      const url = `https://ws.audioscrobbler.com/2.0/?method=user.gettopartists&user=${encodeURIComponent(friend.username)}&api_key=${apiKey}&format=json&period=${period}&limit=50`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch top artists: ${response.status}`);

      const data = await response.json();
      const topArtistsList = data.topartists?.artist || [];

      artists = topArtistsList.map((artist, index) => ({
        id: `friend-top-artist-${index}-${artist.name}`.replace(/\s+/g, '-'),
        name: artist.name,
        image: null,
        playCount: parseInt(artist.playcount) || 0,
        rank: index + 1
      }));
    } else {
      const range = period === 'overall' ? 'all_time' : period === '7day' ? 'week' : period === '1month' ? 'month' : period === '3month' ? 'quarter' : period === '6month' ? 'half_yearly' : 'year';
      const url = `https://api.listenbrainz.org/1/stats/user/${encodeURIComponent(friend.username)}/artists?range=${range}&count=50`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch top artists: ${response.status}`);

      const data = await response.json();
      const artistList = data.payload?.artists || [];

      artists = artistList.map((artist, index) => ({
        id: `friend-top-artist-${index}-${artist.artist_name}`.replace(/\s+/g, '-'),
        name: artist.artist_name || 'Unknown Artist',
        image: null,
        playCount: artist.listen_count || 0,
        rank: index + 1
      }));
    }

    setFriendHistoryData(prev => ({ ...prev, topArtists: artists }));

    // Fetch artist images in background
    if (artists.length > 0) {
      resolveFriendTopArtistImages(artists);
    }
  } catch (error) {
    console.error('Failed to load friend top artists:', error);
    showToast('Failed to load top artists', 'error');
  } finally {
    setFriendHistoryLoading(false);
  }
};

// Resolve friend top artist images
const resolveFriendTopArtistImages = async (artists) => {
  for (const artist of artists) {
    try {
      const result = await getArtistImage(artist.name);
      if (result?.url) {
        setFriendHistoryData(prev => ({
          ...prev,
          topArtists: prev.topArtists.map(a =>
            a.id === artist.id ? { ...a, image: result.url } : a
          )
        }));
      }
    } catch (err) {
      console.error(`Error fetching image for ${artist.name}:`, err);
    }
  }
};
```

**Step 4: Add loadFriendTopAlbums function**

```javascript
// Load friend's top albums
const loadFriendTopAlbums = async (friend, period = friendHistoryPeriod) => {
  setFriendHistoryLoading(true);

  try {
    let albums = [];

    if (friend.service === 'lastfm') {
      const apiKey = lastfmApiKey.current;
      if (!apiKey) throw new Error('Last.fm API key not configured');

      const url = `https://ws.audioscrobbler.com/2.0/?method=user.gettopalbums&user=${encodeURIComponent(friend.username)}&api_key=${apiKey}&format=json&period=${period}&limit=50`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch top albums: ${response.status}`);

      const data = await response.json();
      const topAlbumsList = data.topalbums?.album || [];

      albums = topAlbumsList.map((album, index) => ({
        id: `friend-top-album-${index}-${album.name}`.replace(/\s+/g, '-'),
        name: album.name,
        artist: album.artist?.name || 'Unknown Artist',
        image: album.image?.[3]?.['#text'] || album.image?.[2]?.['#text'] || null,
        playCount: parseInt(album.playcount) || 0,
        rank: index + 1
      }));
    } else {
      const range = period === 'overall' ? 'all_time' : period === '7day' ? 'week' : period === '1month' ? 'month' : period === '3month' ? 'quarter' : period === '6month' ? 'half_yearly' : 'year';
      const url = `https://api.listenbrainz.org/1/stats/user/${encodeURIComponent(friend.username)}/releases?range=${range}&count=50`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch top releases: ${response.status}`);

      const data = await response.json();
      const releaseList = data.payload?.releases || [];

      albums = releaseList.map((release, index) => ({
        id: `friend-top-album-${index}-${release.release_name}`.replace(/\s+/g, '-'),
        name: release.release_name || 'Unknown Album',
        artist: release.artist_name || 'Unknown Artist',
        image: null,
        playCount: release.listen_count || 0,
        rank: index + 1
      }));
    }

    setFriendHistoryData(prev => ({ ...prev, topAlbums: albums }));
  } catch (error) {
    console.error('Failed to load friend top albums:', error);
    showToast('Failed to load top albums', 'error');
  } finally {
    setFriendHistoryLoading(false);
  }
};
```

**Step 5: Add navigateToFriend function**

```javascript
// Navigate to friend's history view
const navigateToFriend = (friend) => {
  setCurrentFriend(friend);
  setFriendHistoryTab('recent');
  setFriendHistoryData({ recent: [], topTracks: [], topAlbums: [], topArtists: [] });
  navigateTo('friendHistory');
  loadFriendRecentTracks(friend);
};
```

**Step 6: Run the app to verify no errors**

Run: `npm start`
Expected: App starts without errors

**Step 7: Commit**

```bash
git add app.js
git commit -m "feat(friends): add friend history data loading functions"
```

---

## Task 6: Add FRIENDS Section to Sidebar

**Files:**
- Modify: `app.js:11408` - after the YOUR MUSIC section closing div, before Settings

**Step 1: Find the YOUR MUSIC section closing and add FRIENDS section**

Find this code (around line 11408):
```javascript
          )
        ),

        // Settings button at bottom of sidebar
```

Insert before `// Settings button at bottom of sidebar`:

```javascript
          // FRIENDS section (only show if there are pinned friends)
          pinnedFriendIds.length > 0 && React.createElement('div', { className: 'mb-4' },
            React.createElement('div', { className: 'px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider' }, 'Friends'),
            pinnedFriendIds.map((friendId, index) => {
              const friend = friends.find(f => f.id === friendId);
              if (!friend) return null;
              const onAir = isOnAir(friend);

              return React.createElement('div', {
                key: friend.id,
                className: 'px-3 py-2 hover:bg-gray-100 rounded cursor-pointer group',
                draggable: true,
                onDragStart: (e) => {
                  e.dataTransfer.setData('friendIndex', index.toString());
                  e.dataTransfer.effectAllowed = 'move';
                },
                onDragOver: (e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                },
                onDrop: (e) => {
                  e.preventDefault();
                  const fromIndex = parseInt(e.dataTransfer.getData('friendIndex'));
                  if (!isNaN(fromIndex) && fromIndex !== index) {
                    reorderPinnedFriends(fromIndex, index);
                  }
                },
                onContextMenu: (e) => {
                  e.preventDefault();
                  showContextMenu(e.clientX, e.clientY, [
                    { label: 'View History', action: () => navigateToFriend(friend) },
                    { label: 'Unpin from Sidebar', action: () => unpinFriend(friend.id) },
                    { type: 'separator' },
                    { label: 'Remove Friend', action: () => removeFriend(friend.id), danger: true }
                  ]);
                }
              },
                React.createElement('div', { className: 'flex items-center gap-2' },
                  // Hexagonal avatar with on-air indicator
                  React.createElement('div', {
                    className: 'relative flex-shrink-0',
                    onClick: (e) => {
                      e.stopPropagation();
                      navigateToFriend(friend);
                    }
                  },
                    React.createElement('div', {
                      className: 'w-8 h-8 bg-gray-200 overflow-hidden',
                      style: {
                        clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)'
                      }
                    },
                      friend.avatarUrl
                        ? React.createElement('img', {
                            src: friend.avatarUrl,
                            alt: friend.displayName,
                            className: 'w-full h-full object-cover'
                          })
                        : React.createElement('div', {
                            className: 'w-full h-full flex items-center justify-center text-gray-500 text-xs font-medium bg-gradient-to-br from-purple-400 to-pink-400 text-white'
                          }, friend.displayName.charAt(0).toUpperCase())
                    ),
                    // On-air indicator dot
                    onAir && React.createElement('div', {
                      className: 'absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-gray-50'
                    })
                  ),
                  // Name and track info
                  React.createElement('div', { className: 'flex-1 min-w-0' },
                    React.createElement('div', {
                      className: 'text-sm text-gray-700 truncate font-medium'
                    }, friend.displayName),
                    onAir && friend.cachedRecentTrack && React.createElement('div', {
                      className: 'text-xs text-gray-400 truncate hover:text-purple-600 cursor-pointer',
                      onClick: (e) => {
                        e.stopPropagation();
                        // Play the track (listen along)
                        const track = {
                          title: friend.cachedRecentTrack.name,
                          artist: friend.cachedRecentTrack.artist,
                          albumArt: friend.cachedRecentTrack.albumArt,
                          sources: {}
                        };
                        playTrack(track);
                      }
                    }, `${friend.cachedRecentTrack.name} - ${friend.cachedRecentTrack.artist}`)
                  )
                )
              );
            })
          ),

          // Empty state hint for Friends when no friends pinned but friends exist
          friends.length > 0 && pinnedFriendIds.length === 0 && React.createElement('div', {
            className: 'mb-4 px-3 py-2 text-xs text-gray-400 italic'
          }, 'Drag friends here to pin'),
```

**Step 2: Run the app to verify sidebar renders**

Run: `npm start`
Expected: App starts, sidebar shows FRIENDS section if there are pinned friends

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat(friends): add FRIENDS section to sidebar with hexagonal avatars"
```

---

## Task 7: Add Friends Tab to Collection Page

**Files:**
- Modify: `app.js` - Collection page tabs (around line 14803-14820)

**Step 1: Update the tab definitions to include Friends**

Find this array in the Collection header:
```javascript
[
  { key: 'artists', label: `${collectionData.artists.length} Artists` },
  { key: 'albums', label: `${collectionData.albums.length} Albums` },
  { key: 'tracks', label: `${library.length + collectionData.tracks.length} Songs` }
]
```

Replace with:
```javascript
[
  { key: 'artists', label: `${collectionData.artists.length} Artists` },
  { key: 'albums', label: `${collectionData.albums.length} Albums` },
  { key: 'tracks', label: `${library.length + collectionData.tracks.length} Songs` },
  { key: 'friends', label: `${friends.length} Friends` }
]
```

Note: This appears twice in the file - once for expanded header and once for collapsed header. Update both.

**Step 2: Update collectionSort to include friends**

Find:
```javascript
const [collectionSort, setCollectionSort] = useState({
  artists: 'alpha-asc',
  albums: 'recent',
  tracks: 'recent'
});
```

Change to:
```javascript
const [collectionSort, setCollectionSort] = useState({
  artists: 'alpha-asc',
  albums: 'recent',
  tracks: 'recent',
  friends: 'alpha-asc'
});
```

**Step 3: Update getCollectionSortOptions function**

Find the getCollectionSortOptions function and add friends case:

```javascript
// Add this case to getCollectionSortOptions
case 'friends':
  return [
    { value: 'alpha-asc', label: 'A-Z' },
    { value: 'alpha-desc', label: 'Z-A' },
    { value: 'recent', label: 'Recently Added' },
    { value: 'on-air', label: 'On Air Now' }
  ];
```

**Step 4: Run the app and verify the Friends tab appears**

Run: `npm start`
Expected: Collection page shows Friends tab alongside Artists, Albums, Tracks

**Step 5: Commit**

```bash
git add app.js
git commit -m "feat(friends): add Friends tab to Collection page header"
```

---

## Task 8: Add Friends Tab Content (Grid View)

**Files:**
- Modify: `app.js` - after the tracks tab content in Collection page (around line 15200)

**Step 1: Find where tracks tab content ends and add friends tab content**

Find where `collectionTab === 'tracks'` content ends (the closing `})(),`) and add after it:

```javascript
// Friends tab
collectionTab === 'friends' && (() => {
  // Sort and filter friends
  const sortedFriends = [...friends].sort((a, b) => {
    const sort = collectionSort.friends;
    if (sort === 'alpha-asc') return a.displayName.localeCompare(b.displayName);
    if (sort === 'alpha-desc') return b.displayName.localeCompare(a.displayName);
    if (sort === 'recent') return b.addedAt - a.addedAt;
    if (sort === 'on-air') {
      const aOnAir = isOnAir(a);
      const bOnAir = isOnAir(b);
      if (aOnAir && !bOnAir) return -1;
      if (!aOnAir && bOnAir) return 1;
      // Secondary sort by most recent activity
      const aTime = a.cachedRecentTrack?.timestamp || 0;
      const bTime = b.cachedRecentTrack?.timestamp || 0;
      return bTime - aTime;
    }
    return 0;
  });

  // Filter by search
  const filtered = collectionSearch
    ? sortedFriends.filter(f =>
        f.displayName.toLowerCase().includes(collectionSearch.toLowerCase()) ||
        f.username.toLowerCase().includes(collectionSearch.toLowerCase())
      )
    : sortedFriends;

  // Filter to only on-air if that sort is selected
  const displayFriends = collectionSort.friends === 'on-air'
    ? filtered.filter(f => isOnAir(f))
    : filtered;

  if (displayFriends.length === 0 && collectionSearch) {
    return React.createElement('div', { className: 'flex-1 flex flex-col items-center justify-center text-gray-400 py-20' },
      React.createElement('p', { className: 'text-lg font-medium text-gray-500' }, 'No friends match your search')
    );
  }

  if (displayFriends.length === 0 && collectionSort.friends === 'on-air') {
    return React.createElement('div', { className: 'flex-1 flex flex-col items-center justify-center text-gray-400 py-20' },
      React.createElement('svg', { className: 'w-16 h-16 mb-4 text-gray-300', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728m-9.9-2.829a5 5 0 010-7.07m7.072 0a5 5 0 010 7.07M13 12a1 1 0 11-2 0 1 1 0 012 0z' })
      ),
      React.createElement('p', { className: 'text-lg font-medium text-gray-500 mb-2' }, 'No friends on air right now'),
      React.createElement('p', { className: 'text-sm text-gray-400' }, 'Check back later to see who\'s listening')
    );
  }

  if (friends.length === 0) {
    return React.createElement('div', { className: 'flex-1 flex flex-col items-center justify-center text-gray-400 py-20' },
      React.createElement('svg', { className: 'w-16 h-16 mb-4 text-gray-300', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' })
      ),
      React.createElement('p', { className: 'text-lg font-medium text-gray-500 mb-2' }, 'No friends yet'),
      React.createElement('p', { className: 'text-sm text-gray-400 mb-4' }, 'Add friends by their Last.fm or ListenBrainz username'),
      React.createElement('button', {
        onClick: () => setAddFriendModalOpen(true),
        className: 'px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors'
      }, 'Add Friend')
    );
  }

  return React.createElement('div', null,
    // Add Friend button
    React.createElement('div', { className: 'mb-4 flex justify-end' },
      React.createElement('button', {
        onClick: () => setAddFriendModalOpen(true),
        className: 'px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2'
      },
        React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M12 4v16m8-8H4' })
        ),
        'Add Friend'
      )
    ),
    // Grid of friend cards
    React.createElement('div', { className: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4' },
      displayFriends.map(friend => {
        const onAir = isOnAir(friend);
        const isPinned = pinnedFriendIds.includes(friend.id);

        return React.createElement('div', {
          key: friend.id,
          className: 'bg-white rounded-xl p-4 hover:shadow-lg transition-all cursor-pointer group border border-gray-100',
          draggable: true,
          onDragStart: (e) => {
            e.dataTransfer.setData('friendId', friend.id);
            e.dataTransfer.effectAllowed = 'copy';
          },
          onClick: () => navigateToFriend(friend),
          onContextMenu: (e) => {
            e.preventDefault();
            showContextMenu(e.clientX, e.clientY, [
              { label: 'View History', action: () => navigateToFriend(friend) },
              isPinned
                ? { label: 'Unpin from Sidebar', action: () => unpinFriend(friend.id) }
                : { label: 'Pin to Sidebar', action: () => pinFriend(friend.id) },
              { type: 'separator' },
              { label: 'Remove Friend', action: () => removeFriend(friend.id), danger: true }
            ]);
          }
        },
          // Hexagonal avatar
          React.createElement('div', { className: 'flex justify-center mb-3' },
            React.createElement('div', { className: 'relative' },
              React.createElement('div', {
                className: 'w-20 h-20 bg-gray-200 overflow-hidden',
                style: {
                  clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)'
                }
              },
                friend.avatarUrl
                  ? React.createElement('img', {
                      src: friend.avatarUrl,
                      alt: friend.displayName,
                      className: 'w-full h-full object-cover'
                    })
                  : React.createElement('div', {
                      className: 'w-full h-full flex items-center justify-center text-2xl font-medium bg-gradient-to-br from-purple-400 to-pink-400 text-white'
                    }, friend.displayName.charAt(0).toUpperCase())
              ),
              // On-air indicator
              onAir && React.createElement('div', {
                className: 'absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-white'
              }),
              // Pin indicator
              isPinned && React.createElement('div', {
                className: 'absolute -top-1 -right-1 w-5 h-5 bg-purple-500 rounded-full flex items-center justify-center'
              },
                React.createElement('svg', { className: 'w-3 h-3 text-white', fill: 'currentColor', viewBox: '0 0 20 20' },
                  React.createElement('path', { d: 'M5 5a2 2 0 012-2h6a2 2 0 012 2v2H5V5zm0 4h10v7a2 2 0 01-2 2H7a2 2 0 01-2-2V9z' })
                )
              )
            )
          ),
          // Name
          React.createElement('div', { className: 'text-center' },
            React.createElement('div', { className: 'font-medium text-gray-900 truncate' }, friend.displayName),
            // Service badge
            React.createElement('div', {
              className: `inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-xs ${
                friend.service === 'lastfm' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
              }`
            }, friend.service === 'lastfm' ? 'Last.fm' : 'ListenBrainz'),
            // Current track if on-air
            onAir && friend.cachedRecentTrack && React.createElement('div', {
              className: 'mt-2 text-xs text-gray-500 truncate'
            },
              React.createElement('span', { className: 'text-green-600' }, '♪ '),
              `${friend.cachedRecentTrack.name}`
            )
          )
        );
      })
    )
  );
})(),
```

**Step 2: Run the app and test the Friends tab content**

Run: `npm start`
Expected: Friends tab shows grid of friend cards, or empty state with "Add Friend" button

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat(friends): add Friends tab content with grid view and friend cards"
```

---

## Task 9: Add "Add Friend" Modal

**Files:**
- Modify: `app.js` - add modal after existing modals (find other modal patterns)

**Step 1: Find where other modals are defined and add the Add Friend modal**

Add this code near other modal definitions (search for existing modal patterns like `showUrlImportDialog`):

```javascript
// Add Friend Modal
addFriendModalOpen && React.createElement('div', {
  className: 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50',
  onClick: (e) => {
    if (e.target === e.currentTarget) {
      setAddFriendModalOpen(false);
      setAddFriendInput('');
    }
  }
},
  React.createElement('div', {
    className: 'bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden',
    onClick: (e) => e.stopPropagation()
  },
    // Header
    React.createElement('div', { className: 'px-6 py-4 border-b border-gray-200 flex items-center justify-between' },
      React.createElement('h3', { className: 'text-lg font-semibold text-gray-900' }, 'Add Friend'),
      React.createElement('button', {
        onClick: () => {
          setAddFriendModalOpen(false);
          setAddFriendInput('');
        },
        className: 'p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors'
      },
        React.createElement('svg', { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M6 18L18 6M6 6l12 12' })
        )
      )
    ),
    // Body
    React.createElement('div', { className: 'p-6' },
      React.createElement('p', { className: 'text-sm text-gray-600 mb-4' },
        'Enter a Last.fm or ListenBrainz username, or paste a profile URL.'
      ),
      React.createElement('input', {
        type: 'text',
        value: addFriendInput,
        onChange: (e) => setAddFriendInput(e.target.value),
        onKeyDown: (e) => {
          if (e.key === 'Enter' && addFriendInput.trim()) {
            addFriend(addFriendInput);
          }
        },
        placeholder: 'Username or profile URL',
        className: 'w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent',
        autoFocus: true
      }),
      // Example hints
      React.createElement('div', { className: 'mt-3 text-xs text-gray-400' },
        React.createElement('p', null, 'Examples:'),
        React.createElement('p', { className: 'mt-1' }, '• username'),
        React.createElement('p', null, '• https://www.last.fm/user/username'),
        React.createElement('p', null, '• https://listenbrainz.org/user/username')
      )
    ),
    // Footer
    React.createElement('div', { className: 'px-6 py-4 bg-gray-50 flex justify-end gap-3' },
      React.createElement('button', {
        onClick: () => {
          setAddFriendModalOpen(false);
          setAddFriendInput('');
        },
        className: 'px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors'
      }, 'Cancel'),
      React.createElement('button', {
        onClick: () => addFriend(addFriendInput),
        disabled: addFriendLoading || !addFriendInput.trim(),
        className: 'px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2'
      },
        addFriendLoading && React.createElement('svg', {
          className: 'w-4 h-4 animate-spin',
          fill: 'none',
          viewBox: '0 0 24 24'
        },
          React.createElement('circle', { className: 'opacity-25', cx: '12', cy: '12', r: '10', stroke: 'currentColor', strokeWidth: '4' }),
          React.createElement('path', { className: 'opacity-75', fill: 'currentColor', d: 'M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z' })
        ),
        addFriendLoading ? 'Adding...' : 'Add Friend'
      )
    )
  )
),
```

**Step 2: Run the app and test the Add Friend modal**

Run: `npm start`
Expected: Clicking "Add Friend" opens modal, can enter username/URL and add friends

**Step 3: Test with real accounts**

Try adding:
- `ocelma` (Last.fm)
- `areyer` (ListenBrainz)
- `https://www.last.fm/user/ocelma`
- `https://listenbrainz.org/user/areyer`

**Step 4: Commit**

```bash
git add app.js
git commit -m "feat(friends): add Add Friend modal with auto-detection"
```

---

## Task 10: Add Friend History View

**Files:**
- Modify: `app.js` - find where other views are rendered (search for `activeView === 'history'`)

**Step 1: Add friendHistory view**

Find the pattern for the history view and add a similar one for friendHistory. Add this where other views are conditionally rendered:

```javascript
// Friend History View
activeView === 'friendHistory' && currentFriend && (() => {
  return React.createElement('div', { className: 'flex-1 flex flex-col overflow-hidden' },
    // Collapsible header
    React.createElement('div', {
      className: `relative overflow-hidden transition-all duration-300 ${
        historyHeaderCollapsed ? 'h-16' : 'h-48'
      }`,
      style: {
        background: 'linear-gradient(135deg, #9333ea 0%, #c026d3 50%, #e11d48 100%)'
      }
    },
      // Expanded header content
      !historyHeaderCollapsed && React.createElement('div', {
        className: 'absolute inset-0 flex items-center px-8'
      },
        // Hexagonal avatar
        React.createElement('div', {
          className: 'w-32 h-32 mr-6 overflow-hidden flex-shrink-0',
          style: {
            clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)'
          }
        },
          currentFriend.avatarUrl
            ? React.createElement('img', {
                src: currentFriend.avatarUrl,
                alt: currentFriend.displayName,
                className: 'w-full h-full object-cover'
              })
            : React.createElement('div', {
                className: 'w-full h-full flex items-center justify-center text-4xl font-medium bg-white/20 text-white'
              }, currentFriend.displayName.charAt(0).toUpperCase())
        ),
        // Info
        React.createElement('div', { className: 'flex-1' },
          React.createElement('div', { className: 'flex items-center gap-3 mb-2' },
            React.createElement('h1', {
              className: 'text-3xl font-bold text-white',
              style: { textShadow: '0 2px 10px rgba(0,0,0,0.3)' }
            }, currentFriend.displayName),
            // On-air badge
            isOnAir(currentFriend) && React.createElement('span', {
              className: 'px-2 py-1 bg-green-500 text-white text-xs font-medium rounded-full flex items-center gap-1'
            },
              React.createElement('span', { className: 'w-2 h-2 bg-white rounded-full animate-pulse' }),
              'On Air'
            ),
            // Service badge
            React.createElement('span', {
              className: `px-2 py-1 text-xs font-medium rounded-full ${
                currentFriend.service === 'lastfm' ? 'bg-red-500/80 text-white' : 'bg-orange-500/80 text-white'
              }`
            }, currentFriend.service === 'lastfm' ? 'Last.fm' : 'ListenBrainz')
          ),
          // Current track if on-air
          isOnAir(currentFriend) && currentFriend.cachedRecentTrack && React.createElement('p', {
            className: 'text-white/80 text-sm mb-3'
          }, `Now playing: ${currentFriend.cachedRecentTrack.name} - ${currentFriend.cachedRecentTrack.artist}`),
          // Tabs
          React.createElement('div', {
            className: 'flex items-center gap-4 text-white/80',
            style: { textShadow: '0 1px 10px rgba(0,0,0,0.5)' }
          },
            [
              { key: 'recent', label: 'Recent' },
              { key: 'topTracks', label: 'Top Tracks' },
              { key: 'topAlbums', label: 'Top Albums' },
              { key: 'topArtists', label: 'Top Artists' }
            ].map((tab, index) => [
              index > 0 && React.createElement('span', { key: `sep-${tab.key}`, className: 'text-white/50' }, '|'),
              React.createElement('button', {
                key: tab.key,
                onClick: () => {
                  setFriendHistoryTab(tab.key);
                  if (tab.key === 'recent') loadFriendRecentTracks(currentFriend);
                  else if (tab.key === 'topTracks') loadFriendTopTracks(currentFriend);
                  else if (tab.key === 'topAlbums') loadFriendTopAlbums(currentFriend);
                  else if (tab.key === 'topArtists') loadFriendTopArtists(currentFriend);
                },
                className: `px-2 py-1 text-sm font-medium uppercase tracking-wider transition-colors ${
                  friendHistoryTab === tab.key ? 'text-white' : 'text-white/60 hover:text-white'
                }`
              }, tab.label)
            ]).flat().filter(Boolean)
          )
        ),
        // Pin button
        React.createElement('button', {
          onClick: () => pinnedFriendIds.includes(currentFriend.id) ? unpinFriend(currentFriend.id) : pinFriend(currentFriend.id),
          className: 'ml-4 px-4 py-2 rounded-full text-sm font-medium transition-colors',
          style: {
            backgroundColor: pinnedFriendIds.includes(currentFriend.id) ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.9)',
            color: pinnedFriendIds.includes(currentFriend.id) ? 'white' : '#9333ea'
          }
        }, pinnedFriendIds.includes(currentFriend.id) ? 'Pinned' : 'Pin to Sidebar')
      ),
      // Collapsed header
      historyHeaderCollapsed && React.createElement('div', {
        className: 'h-full flex items-center px-6 justify-between'
      },
        React.createElement('div', { className: 'flex items-center gap-3' },
          React.createElement('div', {
            className: 'w-10 h-10 overflow-hidden',
            style: {
              clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)'
            }
          },
            currentFriend.avatarUrl
              ? React.createElement('img', {
                  src: currentFriend.avatarUrl,
                  alt: currentFriend.displayName,
                  className: 'w-full h-full object-cover'
                })
              : React.createElement('div', {
                  className: 'w-full h-full flex items-center justify-center text-sm font-medium bg-white/20 text-white'
                }, currentFriend.displayName.charAt(0).toUpperCase())
          ),
          React.createElement('h2', { className: 'text-lg font-semibold text-white' }, currentFriend.displayName),
          isOnAir(currentFriend) && React.createElement('span', {
            className: 'w-2 h-2 bg-green-400 rounded-full'
          })
        ),
        // Tabs in collapsed mode
        React.createElement('div', { className: 'flex items-center gap-2' },
          [
            { key: 'recent', label: 'Recent' },
            { key: 'topTracks', label: 'Top Tracks' },
            { key: 'topAlbums', label: 'Top Albums' },
            { key: 'topArtists', label: 'Top Artists' }
          ].map((tab, index) => [
            index > 0 && React.createElement('span', { key: `csep-${tab.key}`, className: 'text-white/50' }, '|'),
            React.createElement('button', {
              key: `c-${tab.key}`,
              onClick: () => {
                setFriendHistoryTab(tab.key);
                if (tab.key === 'recent') loadFriendRecentTracks(currentFriend);
                else if (tab.key === 'topTracks') loadFriendTopTracks(currentFriend);
                else if (tab.key === 'topAlbums') loadFriendTopAlbums(currentFriend);
                else if (tab.key === 'topArtists') loadFriendTopArtists(currentFriend);
              },
              className: `px-2 py-1 text-sm font-medium uppercase tracking-wider transition-colors ${
                friendHistoryTab === tab.key ? 'text-white' : 'text-white/60 hover:text-white'
              }`
            }, tab.label)
          ]).flat().filter(Boolean)
        )
      )
    ),
    // Content area with scroll handler for header collapse
    React.createElement('div', {
      className: 'flex-1 overflow-y-auto scrollable-content',
      onScroll: (e) => {
        const scrollTop = e.target.scrollTop;
        if (scrollTop > 50 && !historyHeaderCollapsed) {
          setHistoryHeaderCollapsed(true);
        } else if (scrollTop <= 50 && historyHeaderCollapsed) {
          setHistoryHeaderCollapsed(false);
        }
      }
    },
      // Period filter (for non-recent tabs)
      friendHistoryTab !== 'recent' && React.createElement('div', {
        className: 'sticky top-0 z-10 flex items-center px-6 py-3 bg-white border-b border-gray-200'
      },
        React.createElement('div', { className: 'relative' },
          React.createElement('button', {
            onClick: () => setHistoryPeriodDropdownOpen(!historyPeriodDropdownOpen),
            className: 'flex items-center gap-1 px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors'
          },
            React.createElement('span', null, historyPeriodOptions.find(o => o.value === friendHistoryPeriod)?.label || 'Period'),
            React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
              React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M19 9l-7 7-7-7' })
            )
          ),
          historyPeriodDropdownOpen && React.createElement('div', {
            className: 'absolute left-0 top-full mt-1 bg-white rounded-lg shadow-lg py-1 min-w-[160px] z-30 border border-gray-200'
          },
            historyPeriodOptions.map(option =>
              React.createElement('button', {
                key: option.value,
                onClick: () => {
                  setFriendHistoryPeriod(option.value);
                  setHistoryPeriodDropdownOpen(false);
                  if (friendHistoryTab === 'topTracks') loadFriendTopTracks(currentFriend, option.value);
                  else if (friendHistoryTab === 'topAlbums') loadFriendTopAlbums(currentFriend, option.value);
                  else if (friendHistoryTab === 'topArtists') loadFriendTopArtists(currentFriend, option.value);
                },
                className: `w-full px-4 py-2 text-left text-sm hover:bg-gray-100 ${
                  friendHistoryPeriod === option.value ? 'text-gray-900 font-medium' : 'text-gray-600'
                }`
              }, option.label)
            )
          )
        )
      ),
      // Content
      React.createElement('div', { className: 'p-6' },
        // Loading state
        friendHistoryLoading && React.createElement('div', { className: 'flex items-center justify-center py-12' },
          React.createElement('div', { className: 'w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin' })
        ),
        // Recent tab content
        !friendHistoryLoading && friendHistoryTab === 'recent' && React.createElement('div', { className: 'space-y-1' },
          friendHistoryData.recent.length === 0
            ? React.createElement('p', { className: 'text-center text-gray-400 py-8' }, 'No recent listens')
            : friendHistoryData.recent.map((track, index) =>
                React.createElement(TrackRow, {
                  key: track.id || index,
                  track: track,
                  index: index,
                  isPlaying: currentTrack?.title === track.title && currentTrack?.artist === track.artist && isPlaying,
                  isCurrentTrack: currentTrack?.title === track.title && currentTrack?.artist === track.artist,
                  onPlay: () => playTrack(track),
                  onContextMenu: (e) => handleTrackContextMenu(e, track, index),
                  showTimestamp: true,
                  timestamp: track.timestamp
                })
              )
        ),
        // Top tracks tab content
        !friendHistoryLoading && friendHistoryTab === 'topTracks' && React.createElement('div', { className: 'space-y-1' },
          friendHistoryData.topTracks.length === 0
            ? React.createElement('p', { className: 'text-center text-gray-400 py-8' }, 'No top tracks data')
            : friendHistoryData.topTracks.map((track, index) =>
                React.createElement(TrackRow, {
                  key: track.id || index,
                  track: track,
                  index: index,
                  isPlaying: currentTrack?.title === track.title && currentTrack?.artist === track.artist && isPlaying,
                  isCurrentTrack: currentTrack?.title === track.title && currentTrack?.artist === track.artist,
                  onPlay: () => playTrack(track),
                  onContextMenu: (e) => handleTrackContextMenu(e, track, index),
                  showPlayCount: true,
                  playCount: track.playCount
                })
              )
        ),
        // Top albums tab content
        !friendHistoryLoading && friendHistoryTab === 'topAlbums' && React.createElement('div', {
          className: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4'
        },
          friendHistoryData.topAlbums.length === 0
            ? React.createElement('p', { className: 'col-span-full text-center text-gray-400 py-8' }, 'No top albums data')
            : friendHistoryData.topAlbums.map((album, index) =>
                React.createElement('div', {
                  key: album.id || index,
                  className: 'bg-white rounded-lg overflow-hidden hover:shadow-lg transition-shadow cursor-pointer group',
                  onClick: () => fetchArtistData(album.artist)
                },
                  React.createElement('div', { className: 'aspect-square bg-gray-100 relative' },
                    album.image
                      ? React.createElement('img', {
                          src: album.image,
                          alt: album.name,
                          className: 'w-full h-full object-cover'
                        })
                      : React.createElement('div', {
                          className: 'w-full h-full flex items-center justify-center text-gray-300'
                        },
                          React.createElement('svg', { className: 'w-12 h-12', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3' })
                          )
                        ),
                    React.createElement('div', {
                      className: 'absolute top-2 left-2 px-2 py-0.5 bg-black/60 rounded text-xs text-white font-medium'
                    }, `#${album.rank}`)
                  ),
                  React.createElement('div', { className: 'p-3' },
                    React.createElement('p', { className: 'font-medium text-gray-900 truncate text-sm' }, album.name),
                    React.createElement('p', { className: 'text-xs text-gray-500 truncate' }, album.artist),
                    React.createElement('p', { className: 'text-xs text-gray-400 mt-1' }, `${album.playCount} plays`)
                  )
                )
              )
        ),
        // Top artists tab content
        !friendHistoryLoading && friendHistoryTab === 'topArtists' && React.createElement('div', {
          className: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4'
        },
          friendHistoryData.topArtists.length === 0
            ? React.createElement('p', { className: 'col-span-full text-center text-gray-400 py-8' }, 'No top artists data')
            : friendHistoryData.topArtists.map((artist, index) =>
                React.createElement('div', {
                  key: artist.id || index,
                  className: 'bg-white rounded-lg overflow-hidden hover:shadow-lg transition-shadow cursor-pointer group',
                  onClick: () => fetchArtistData(artist.name)
                },
                  React.createElement('div', { className: 'aspect-square bg-gray-100 relative' },
                    artist.image
                      ? React.createElement('img', {
                          src: artist.image,
                          alt: artist.name,
                          className: 'w-full h-full object-cover'
                        })
                      : React.createElement('div', {
                          className: 'w-full h-full flex items-center justify-center text-gray-300'
                        },
                          React.createElement('svg', { className: 'w-12 h-12', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' })
                          )
                        ),
                    React.createElement('div', {
                      className: 'absolute top-2 left-2 px-2 py-0.5 bg-black/60 rounded text-xs text-white font-medium'
                    }, `#${artist.rank}`)
                  ),
                  React.createElement('div', { className: 'p-3' },
                    React.createElement('p', { className: 'font-medium text-gray-900 truncate text-sm' }, artist.name),
                    React.createElement('p', { className: 'text-xs text-gray-400 mt-1' }, `${artist.playCount} plays`)
                  )
                )
              )
        )
      )
    )
  );
})(),
```

**Step 2: Run the app and test the Friend History view**

Run: `npm start`
Expected: Clicking a friend card navigates to their history view with tabs

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat(friends): add Friend History view with tabs and period filters"
```

---

## Task 11: Add Sidebar Drop Zone for Pinning Friends

**Files:**
- Modify: `app.js` - update sidebar to accept friend drops

**Step 1: Find the sidebar's FRIENDS section and add drop handling**

Update the FRIENDS section header to accept drops:

```javascript
// In the FRIENDS section, update the section div to handle drops
React.createElement('div', {
  className: 'mb-4',
  onDragOver: (e) => {
    if (e.dataTransfer.types.includes('friendid')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  },
  onDrop: (e) => {
    e.preventDefault();
    const friendId = e.dataTransfer.getData('friendId');
    if (friendId && !pinnedFriendIds.includes(friendId)) {
      pinFriend(friendId);
    }
  }
},
```

**Step 2: Update the Collection sidebar button to show highlight when dragging a friend**

Add state for tracking friend drag:
```javascript
const [friendDragOverSidebar, setFriendDragOverSidebar] = useState(false);
```

And update the empty hint to show drop target styling:
```javascript
// Update empty state hint for Friends when dragging
friends.length > 0 && pinnedFriendIds.length === 0 && React.createElement('div', {
  className: `mb-4 px-3 py-4 text-xs text-center rounded-lg transition-colors ${
    friendDragOverSidebar ? 'bg-purple-100 border-2 border-dashed border-purple-400 text-purple-600' : 'text-gray-400 italic'
  }`,
  onDragOver: (e) => {
    if (e.dataTransfer.types.includes('friendid')) {
      e.preventDefault();
      setFriendDragOverSidebar(true);
    }
  },
  onDragLeave: () => setFriendDragOverSidebar(false),
  onDrop: (e) => {
    e.preventDefault();
    setFriendDragOverSidebar(false);
    const friendId = e.dataTransfer.getData('friendId');
    if (friendId) {
      pinFriend(friendId);
    }
  }
}, friendDragOverSidebar ? 'Drop to pin friend' : 'Drag friends here to pin'),
```

**Step 3: Run and test drag-to-pin**

Run: `npm start`
Expected: Can drag friend cards from Collection to sidebar to pin them

**Step 4: Commit**

```bash
git add app.js
git commit -m "feat(friends): add drag-to-pin functionality for sidebar"
```

---

## Task 12: Final Testing and Polish

**Step 1: Test complete flow**

Run: `npm start`

Test checklist:
- [ ] Add a Last.fm friend (ocelma)
- [ ] Add a ListenBrainz friend (areyer)
- [ ] Verify friends appear in Collection → Friends tab
- [ ] Verify friend cards show correct service badges
- [ ] Click friend card → navigates to Friend History view
- [ ] Test all History tabs (Recent, Top Tracks, Top Albums, Top Artists)
- [ ] Test period filter dropdown
- [ ] Pin a friend to sidebar (right-click → Pin to Sidebar)
- [ ] Verify friend appears in sidebar FRIENDS section
- [ ] Click avatar in sidebar → navigates to Friend History
- [ ] If friend is on-air, verify green dot appears
- [ ] Click track text in sidebar → plays that track
- [ ] Drag-drop to reorder pinned friends in sidebar
- [ ] Unpin friend (right-click → Unpin from Sidebar)
- [ ] Remove a friend (right-click → Remove Friend)
- [ ] Close and reopen app → verify friends persist

**Step 2: Fix any issues found during testing**

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat(friends): complete Friends feature implementation

- Add friends via Last.fm/ListenBrainz username or profile URL
- Auto-detect service from URL patterns
- View friend's listening history with same tabs as your History
- Hexagonal avatars to differentiate from circular artist avatars
- On-air indicator (green dot) for friends listening within 10 minutes
- Pin/unpin friends to sidebar for quick access
- Drag-drop to reorder pinned friends
- Click avatar to view history, click track to listen along
- Persistent storage via electron-store

Test accounts:
- Last.fm: ocelma
- ListenBrainz: areyer"
```

---

## Future TODO: Continuous Sync (Listen Along v2)

Add to a TODO list for later implementation:

- Real-time sync mode when clicking "Listen Along"
- Poll friend's recent track every 30-60 seconds while synced
- Visual indicator in playbar: "Synced with [Friend]"
- Auto-advance when friend's track changes
- Exit sync by clicking indicator or playing something else
