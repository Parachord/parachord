# Spinoff Feature Design

## Overview

The Spinoff feature creates a radio-like listening experience based on the currently playing track. When activated, it fetches similar tracks from Last.fm and plays them one-by-one without showing upcoming tracks in the queue. The user's existing queue is preserved and resumes when spinoff mode ends.

## User Flow

1. User is playing a track
2. User clicks the spinoff icon (left of heart icon in playbar)
3. App fetches 20 similar tracks from Last.fm
4. Queue numbers are replaced with `··` and queue is visually dimmed
5. Context banner shows "spun off from [track name]"
6. Similar tracks play one-by-one (radio-style, not shown in queue)
7. User exits spinoff mode (toggle off, click another track, or tracks run out)
8. Current spinoff track finishes playing
9. Queue numbers reappear, dimming removed
10. Playback continues from the preserved queue

## API

**Endpoint:** Last.fm `track.getSimilar`

```
https://ws.audioscrobbler.com/2.0/?method=track.getsimilar
  &artist={artist}
  &track={track}
  &api_key={key}
  &format=json
  &limit=20
```

**Response format:**
```json
{
  "similartracks": {
    "track": [
      {
        "name": "Track Name",
        "artist": { "name": "Artist Name" },
        "match": 0.95
      }
    ]
  }
}
```

## State

### New State Variables

```javascript
const [spinoffMode, setSpinoffMode] = useState(false);
const [spinoffSourceTrack, setSpinoffSourceTrack] = useState(null);
const spinoffTracksRef = useRef([]); // Pool of similar tracks to play
```

### Playback Context

```javascript
{
  type: 'spinoff',
  sourceTrack: {
    title: 'Original Track Name',
    artist: 'Original Artist'
  }
}
```

## UI Components

### Playbar Icon

**Position:** Left of heart/favorite icon

**Icon:** Branching/fork SVG (similar to git branch icon)

**States:**
- **Disabled** (`text-gray-600`, `cursor-not-allowed`): No track playing
- **Default** (`text-gray-400`, `hover:text-white`): Track playing, spinoff available
- **Active** (`text-purple-400`): Spinoff mode is active
- **Loading** (spinner): Fetching similar tracks

### Queue Display

When `spinoffMode === true` OR `playbackContext.type === 'spinoff'`:
- Track numbers show `··` instead of `01`, `02`, etc.
- Queue items have reduced opacity (`opacity-50`)
- This visual treatment applies to both Spinoff and Listen Along modes

### Context Banner

When `playbackContext.type === 'spinoff'`:
- Text: "spun off from [track name]"
- Non-clickable (no destination page)
- No arrow icon (since it's not a navigable link)

## Logic

### Starting Spinoff

```javascript
const startSpinoff = async (track) => {
  if (!track || !track.artist || !track.title) return;

  // Show loading state on icon
  setSpinoffLoading(true);

  try {
    const similarTracks = await fetchSimilarTracks(track.artist, track.title);

    if (similarTracks.length === 0) {
      showToast(`No similar tracks found for "${track.title}"`);
      return;
    }

    // Enter spinoff mode
    setSpinoffMode(true);
    setSpinoffSourceTrack({ title: track.title, artist: track.artist });
    spinoffTracksRef.current = similarTracks;

    // Set playback context
    setPlaybackContext({
      type: 'spinoff',
      sourceTrack: { title: track.title, artist: track.artist }
    });

  } catch (error) {
    console.error('Failed to start spinoff:', error);
    showToast('Failed to fetch similar tracks');
  } finally {
    setSpinoffLoading(false);
  }
};
```

### Track Advancement (in handleNext)

```javascript
// After current track ends, check if we're in spinoff mode
if (spinoffMode && spinoffTracksRef.current.length > 0) {
  const nextSimilar = spinoffTracksRef.current.shift();

  // Play the track directly (don't add to queue)
  handlePlay({
    ...nextSimilar,
    _playbackContext: {
      type: 'spinoff',
      sourceTrack: spinoffSourceTrack
    }
  });
  return; // Don't advance the normal queue
}

// If spinoff mode but no tracks left, exit spinoff
if (spinoffMode && spinoffTracksRef.current.length === 0) {
  exitSpinoff();
}

// Normal queue advancement continues...
```

### Exiting Spinoff

```javascript
const exitSpinoff = () => {
  setSpinoffMode(false);
  setSpinoffSourceTrack(null);
  spinoffTracksRef.current = [];
  // Don't clear playbackContext - let the next track set its own
};
```

### Exit Conditions

Spinoff mode ends when:

1. **User toggles spinoff icon off** - `exitSpinoff()` called, current track finishes, queue resumes
2. **User clicks any track** - From search, library, playlist, queue, etc.
3. **User drags a track into queue** - Indicates manual queue management
4. **Similar tracks exhausted** - All 20 tracks played, queue resumes
5. **User clicks track within queue** - Making a deliberate playback choice

What does NOT exit spinoff:
- Clicking next/previous buttons
- Clicking resolver icons on current track

## Error Handling

| Scenario | Behavior |
|----------|----------|
| No Last.fm API key | Show toast: "Last.fm API key required for Spinoff" |
| No similar tracks found | Show toast: "No similar tracks found for [track]" |
| API request fails | Show toast: "Failed to fetch similar tracks" |
| Track missing artist/title | Spinoff icon disabled |

## Visual Reference

```
┌─────────────────────────────────────────────────────────────┐
│  Playbar                                                    │
│  ┌────┬────┬─────────────────────┬────┬────┬────┬────────┐ │
│  │ ⏮️ │ ▶️ │ Track - Artist      │ 🔀 │ ❤️ │ ⏭️ │ 🔊     │ │
│  └────┴────┴─────────────────────┴────┴────┴────┴────────┘ │
│                                    ↑                        │
│                              Spinoff icon                   │
│                              (branching)                    │
└─────────────────────────────────────────────────────────────┘

Queue Drawer (spinoff active):
┌─────────────────────────────────────────┐
│ Up Next                                 │
├─────────────────────────────────────────┤
│ ··  Track A - Artist A         3:42    │  ← dimmed
│ ··  Track B - Artist B         4:15    │  ← dimmed
│ ··  Track C - Artist C         3:58    │  ← dimmed
├─────────────────────────────────────────┤
│ spun off from "Original Track"         │  ← no arrow
└─────────────────────────────────────────┘
```

## Implementation Checklist

1. Add `fetchSimilarTracks()` function using Last.fm `track.getSimilar` API
2. Add spinoff state variables (`spinoffMode`, `spinoffSourceTrack`, `spinoffTracksRef`)
3. Add spinoff icon to playbar (left of heart icon)
4. Implement `startSpinoff()` and `exitSpinoff()` functions
5. Modify `handleNext()` to check spinoff mode and play from pool
6. Update queue display to show `··` and dim when spinoff/listen-along active
7. Update context banner to handle `type: 'spinoff'` (non-clickable)
8. Add exit condition checks in track selection handlers
9. Handle error cases with appropriate toasts
