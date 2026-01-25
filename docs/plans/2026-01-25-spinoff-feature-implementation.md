# Spinoff Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a radio-like "Spinoff" feature that plays similar tracks based on the currently playing track using Last.fm's track.getSimilar API.

**Architecture:** New state variables track spinoff mode and the pool of similar tracks. When active, tracks play directly from the pool (bypassing the queue) while the existing queue remains visible but dimmed. The context banner shows "spun off from [track name]".

**Tech Stack:** React (via createElement), Last.fm API, existing app.js patterns

---

### Task 1: Add Spinoff State Variables

**Files:**
- Modify: `app.js:1550-1580` (state declarations section)

**Step 1: Add spinoff state after playbackContext declaration (around line 1556)**

Find the line:
```javascript
  const [playbackContext, setPlaybackContext] = useState(null);
```

Add after it:
```javascript
  // Spinoff mode - radio-like playback of similar tracks
  const [spinoffMode, setSpinoffMode] = useState(false);
  const [spinoffSourceTrack, setSpinoffSourceTrack] = useState(null); // { title, artist } of original track
  const [spinoffLoading, setSpinoffLoading] = useState(false);
  const spinoffTracksRef = useRef([]); // Pool of similar tracks to play
```

**Step 2: Verify the app still loads**

Run: `npm start` (or refresh the app)
Expected: App loads without errors

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat(spinoff): add spinoff state variables"
```

---

### Task 2: Add fetchSimilarTracks Function

**Files:**
- Modify: `app.js:12600-12610` (after getLastfmSimilarArtists function)

**Step 1: Add the fetchSimilarTracks function**

Find the closing of `getLastfmSimilarArtists` (around line 12603-12604):
```javascript
    } catch (error) {
      console.error('Failed to fetch similar artists from Last.fm:', error);
      return [];
    }
  };
```

Add after it:
```javascript

  // Fetch similar tracks from Last.fm API (for Spinoff feature)
  const fetchSimilarTracks = async (artistName, trackName) => {
    if (!artistName || !trackName) return [];

    const apiKey = lastfmApiKey.current;
    if (!apiKey) {
      console.log('🔀 Last.fm similar tracks skipped: no API key');
      return [];
    }

    try {
      const url = `https://ws.audioscrobbler.com/2.0/?method=track.getsimilar&artist=${encodeURIComponent(artistName)}&track=${encodeURIComponent(trackName)}&api_key=${apiKey}&format=json&limit=20`;

      console.log(`🔀 Fetching similar tracks for "${trackName}" by ${artistName}`);
      const response = await fetch(url);
      if (!response.ok) {
        console.error('Last.fm similar tracks request failed:', response.status);
        return [];
      }

      const data = await response.json();
      if (data.similartracks?.track) {
        const tracks = data.similartracks.track.map(t => ({
          title: t.name,
          artist: t.artist?.name || 'Unknown Artist',
          match: Math.round(parseFloat(t.match) * 100),
          source: 'lastfm-similar'
        }));
        console.log(`🔀 Found ${tracks.length} similar tracks`);
        return tracks;
      }

      return [];
    } catch (error) {
      console.error('Failed to fetch similar tracks from Last.fm:', error);
      return [];
    }
  };
```

**Step 2: Verify the app still loads**

Run: Refresh the app
Expected: App loads without errors

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat(spinoff): add fetchSimilarTracks function for Last.fm API"
```

---

### Task 3: Add startSpinoff and exitSpinoff Functions

**Files:**
- Modify: `app.js` (after fetchSimilarTracks function, around line 12650)

**Step 1: Add the spinoff control functions**

Add after the `fetchSimilarTracks` function:
```javascript

  // Start spinoff mode - play similar tracks based on current track
  const startSpinoff = async (track) => {
    if (!track || !track.artist || !track.title) {
      console.log('🔀 Cannot start spinoff: missing track info');
      return;
    }

    setSpinoffLoading(true);
    console.log(`🔀 Starting spinoff from "${track.title}" by ${track.artist}`);

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

      showToast(`Spinoff: ${similarTracks.length} similar tracks queued`);
      console.log(`🔀 Spinoff mode activated with ${similarTracks.length} tracks`);
    } catch (error) {
      console.error('Failed to start spinoff:', error);
      showToast('Failed to fetch similar tracks');
    } finally {
      setSpinoffLoading(false);
    }
  };

  // Exit spinoff mode - return to normal queue playback
  const exitSpinoff = () => {
    console.log('🔀 Exiting spinoff mode');
    setSpinoffMode(false);
    setSpinoffSourceTrack(null);
    spinoffTracksRef.current = [];
    // Don't clear playbackContext - let next track from queue set its own
  };
```

**Step 2: Verify the app still loads**

Run: Refresh the app
Expected: App loads without errors

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat(spinoff): add startSpinoff and exitSpinoff functions"
```

---

### Task 4: Add Spinoff Icon to Playbar

**Files:**
- Modify: `app.js:22766-22810` (playbar right section, before heart icon)

**Step 1: Add the spinoff icon button**

Find the comment and div (around line 22766-22767):
```javascript
        // RIGHT: Heart + Progress bar + Shuffle + Repeat + Volume
        React.createElement('div', { className: 'flex items-center gap-3' },
          // Heart/favorite button
```

Replace with:
```javascript
        // RIGHT: Spinoff + Heart + Progress bar + Shuffle + Repeat + Volume
        React.createElement('div', { className: 'flex items-center gap-3' },
          // Spinoff button - radio-like playback of similar tracks
          React.createElement('button', {
            onClick: () => {
              if (spinoffMode) {
                exitSpinoff();
              } else if (currentTrack) {
                startSpinoff(currentTrack);
              }
            },
            disabled: !currentTrack || spinoffLoading,
            className: `p-1.5 rounded-full transition-colors ${
              !currentTrack ? 'text-gray-600 cursor-not-allowed' :
              spinoffLoading ? 'text-gray-400' :
              spinoffMode ? 'text-purple-400 hover:text-purple-300' :
              'text-gray-400 hover:text-white'
            }`,
            title: spinoffMode ? 'Exit spinoff mode' : 'Start spinoff (play similar tracks)'
          },
            spinoffLoading
              ? React.createElement('span', { className: 'animate-spin inline-block w-5 h-5' }, '◌')
              : React.createElement('svg', {
                  className: 'w-5 h-5',
                  viewBox: '0 0 24 24',
                  fill: 'none',
                  stroke: 'currentColor',
                  strokeWidth: 2
                },
                  // Branching/fork icon
                  React.createElement('path', {
                    strokeLinecap: 'round',
                    strokeLinejoin: 'round',
                    d: 'M6 3v12M6 9c0-2 2-3 4-3h4c2 0 4 1 4 3v6M18 21v-6M6 21a3 3 0 100-6 3 3 0 000 6zM18 21a3 3 0 100-6 3 3 0 000 6z'
                  })
                )
          ),
          // Heart/favorite button
```

**Step 2: Verify the icon appears**

Run: Refresh the app and play a track
Expected: New branching icon appears left of the heart icon in the playbar

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat(spinoff): add spinoff icon to playbar"
```

---

### Task 5: Modify handleNext to Support Spinoff Mode

**Files:**
- Modify: `app.js:5998-6035` (handleNext function, queue navigation section)

**Step 1: Add spinoff handling at the start of queue navigation**

Find the section (around line 5998):
```javascript
      if (queue.length === 0) {
        console.log('No queue set, cannot go to next track');
        return;
      }
```

Replace with:
```javascript
      // Check if we're in spinoff mode - play from spinoff pool instead of queue
      if (spinoffMode && spinoffTracksRef.current.length > 0) {
        const nextSimilar = spinoffTracksRef.current.shift();
        console.log(`🔀 Spinoff: playing next similar track "${nextSimilar.title}"`);

        handlePlay({
          ...nextSimilar,
          _playbackContext: {
            type: 'spinoff',
            sourceTrack: spinoffSourceTrack
          }
        });
        return;
      }

      // If spinoff mode but no tracks left, exit spinoff and continue with queue
      if (spinoffMode && spinoffTracksRef.current.length === 0) {
        console.log('🔀 Spinoff pool exhausted, returning to queue');
        exitSpinoff();
      }

      if (queue.length === 0) {
        console.log('No queue set, cannot go to next track');
        return;
      }
```

**Step 2: Verify the app still loads**

Run: Refresh the app
Expected: App loads without errors

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat(spinoff): modify handleNext to play from spinoff pool"
```

---

### Task 6: Update Queue Display for Spinoff/Listen-Along Mode

**Files:**
- Modify: `app.js:25264-25272` (queue track number display)

**Step 1: Update track number display to show ·· when in spinoff mode**

Find the track number section (around line 25264-25272):
```javascript
                // Track number / status indicator - fixed width
                React.createElement('span', {
                  className: 'text-sm text-gray-500 text-right',
                  style: { width: '28px', flexShrink: 0 }
                },
                  isLoading ? React.createElement('span', { className: 'animate-spin inline-block' }, '◌') :
                  isError ? '⚠' :
                  isCurrentTrack ? '▶' : String(index + 1).padStart(2, '0')
                ),
```

Replace with:
```javascript
                // Track number / status indicator - fixed width
                // In spinoff/listen-along mode, show ·· instead of numbers (queue is "paused")
                React.createElement('span', {
                  className: `text-sm text-right ${
                    (spinoffMode || playbackContext?.type === 'spinoff' || playbackContext?.type === 'friend')
                      ? 'text-gray-600' : 'text-gray-500'
                  }`,
                  style: { width: '28px', flexShrink: 0 }
                },
                  isLoading ? React.createElement('span', { className: 'animate-spin inline-block' }, '◌') :
                  isError ? '⚠' :
                  isCurrentTrack ? '▶' :
                  (spinoffMode || playbackContext?.type === 'spinoff' || playbackContext?.type === 'friend')
                    ? '··' : String(index + 1).padStart(2, '0')
                ),
```

**Step 2: Update the queue item styling to dim when in spinoff mode**

Find the queue item className (around line 25255-25262):
```javascript
                className: `group flex items-center gap-3 py-2 px-3 border-b border-gray-600/30 hover:bg-white/10 transition-all duration-300 ${
                  isCurrentTrack ? 'bg-purple-900/40' : ''
                } ${isDragging ? 'opacity-50 bg-gray-700/50' : ''} ${
                  isError ? 'opacity-50' : ''
                } ${isDraggedOver ? 'border-t-2 border-t-purple-400' : ''} ${
                  isLoading || isError ? '' : 'cursor-grab active:cursor-grabbing'} ${
                  isFallingDown ? 'queue-track-drop' : ''} ${
                  isInserted ? 'queue-track-insert' : ''}`
```

Replace with:
```javascript
                className: `group flex items-center gap-3 py-2 px-3 border-b border-gray-600/30 hover:bg-white/10 transition-all duration-300 ${
                  isCurrentTrack ? 'bg-purple-900/40' : ''
                } ${isDragging ? 'opacity-50 bg-gray-700/50' : ''} ${
                  isError ? 'opacity-50' : ''
                } ${isDraggedOver ? 'border-t-2 border-t-purple-400' : ''} ${
                  isLoading || isError ? '' : 'cursor-grab active:cursor-grabbing'} ${
                  isFallingDown ? 'queue-track-drop' : ''} ${
                  isInserted ? 'queue-track-insert' : ''} ${
                  (spinoffMode || playbackContext?.type === 'spinoff' || playbackContext?.type === 'friend') && !isCurrentTrack ? 'opacity-50' : ''}`
```

**Step 3: Verify the queue dims when spinoff is active**

Run: Refresh the app, play a track, click spinoff icon
Expected: Queue items show ·· instead of numbers and are dimmed

**Step 4: Commit**

```bash
git add app.js
git commit -m "feat(spinoff): dim queue and hide numbers in spinoff/listen-along mode"
```

---

### Task 7: Update Context Banner for Spinoff

**Files:**
- Modify: `app.js:25450-25465` (context banner text section)

**Step 1: Add spinoff case to context banner text**

Find the context banner text section (around line 25453-25462):
```javascript
          React.createElement('span', { className: 'text-xs font-medium text-purple-100' },
            playbackContext.type === 'playlist' ? `${playbackContext.name || 'Playlist'}` :
            playbackContext.type === 'album' ? `${playbackContext.name || 'Album'} by ${playbackContext.artist || 'Unknown'}` :
            playbackContext.type === 'search' ? `"${playbackContext.name || 'Search'}"` :
            playbackContext.type === 'library' ? 'Collection' :
            playbackContext.type === 'recommendations' ? 'Recommendations' :
            playbackContext.type === 'history' ? 'History' :
            playbackContext.type === 'friend' ? `${playbackContext.name || 'Friend'}'s ${playbackContext.tab === 'topTracks' ? 'top tracks' : 'recent listens'}` :
            playbackContext.type === 'url' ? playbackContext.name || 'External link' :
            playbackContext.name || 'Unknown'
          )
```

Replace with:
```javascript
          React.createElement('span', { className: 'text-xs font-medium text-purple-100' },
            playbackContext.type === 'playlist' ? `${playbackContext.name || 'Playlist'}` :
            playbackContext.type === 'album' ? `${playbackContext.name || 'Album'} by ${playbackContext.artist || 'Unknown'}` :
            playbackContext.type === 'search' ? `"${playbackContext.name || 'Search'}"` :
            playbackContext.type === 'library' ? 'Collection' :
            playbackContext.type === 'recommendations' ? 'Recommendations' :
            playbackContext.type === 'history' ? 'History' :
            playbackContext.type === 'friend' ? `${playbackContext.name || 'Friend'}'s ${playbackContext.tab === 'topTracks' ? 'top tracks' : 'recent listens'}` :
            playbackContext.type === 'spinoff' ? `spun off from "${playbackContext.sourceTrack?.title || 'Unknown'}"` :
            playbackContext.type === 'url' ? playbackContext.name || 'External link' :
            playbackContext.name || 'Unknown'
          )
```

**Step 2: Update the "Playing from" label for spinoff**

Find the "Playing from" label (around line 25452):
```javascript
          React.createElement('span', { className: 'text-xs text-purple-300' }, 'Playing from'),
```

Replace with:
```javascript
          React.createElement('span', { className: 'text-xs text-purple-300' },
            playbackContext.type === 'spinoff' ? 'Playing' : 'Playing from'
          ),
```

**Step 3: Make spinoff context banner non-clickable**

Find the banner onClick handler (around line 25416-25447). Update the onClick to not navigate for spinoff:

After line 25440 (`} else if (playbackContext.type === 'history') {`), add a condition for spinoff:
```javascript
          } else if (playbackContext.type === 'spinoff') {
            // Spinoff has no destination page - do nothing
```

**Step 4: Remove arrow icon for spinoff**

Find the arrow icon section (around line 25465-25484). The icon should not show for spinoff.

Replace the icon section:
```javascript
        playbackContext.type !== 'spinoff' && React.createElement('svg', {
          className: 'w-4 h-4 text-purple-400',
```

(Note: This wraps the svg in a conditional)

**Step 5: Verify the context banner shows correctly**

Run: Refresh the app, play a track, click spinoff icon
Expected: Context banner shows "Playing spun off from [track name]" with no arrow

**Step 6: Commit**

```bash
git add app.js
git commit -m "feat(spinoff): update context banner for spinoff mode"
```

---

### Task 8: Add Exit Conditions for Spinoff

**Files:**
- Modify: `app.js` (multiple locations where tracks are played)

**Step 1: Exit spinoff when clicking a track in the queue**

Find the queue track click handler (around line 25283-25294):
```javascript
                  onClick: () => {
                    if (isLoading || isError) return;
                    // Trigger drop animation for all tracks at index <= clicked index
                    // These tracks will fall down into the player together
                    setDroppingFromIndex(index);
                    // After animation, play the track
                    setTimeout(() => {
                      setCurrentQueue(prev => prev.slice(index + 1));
                      handlePlay(track);
                      setDroppingFromIndex(null);
                    }, 300);
                  }
```

Replace with:
```javascript
                  onClick: () => {
                    if (isLoading || isError) return;
                    // Exit spinoff mode when user clicks a track in the queue
                    if (spinoffMode) {
                      exitSpinoff();
                    }
                    // Trigger drop animation for all tracks at index <= clicked index
                    // These tracks will fall down into the player together
                    setDroppingFromIndex(index);
                    // After animation, play the track
                    setTimeout(() => {
                      setCurrentQueue(prev => prev.slice(index + 1));
                      handlePlay(track);
                      setDroppingFromIndex(null);
                    }, 300);
                  }
```

**Step 2: Exit spinoff when user plays a track from anywhere else**

The handlePlay function is called when playing tracks. We need to exit spinoff when a new track is played from a non-spinoff context.

Find the handlePlay function and add at the very beginning (after the function declaration):
```javascript
    // Exit spinoff mode if playing a track that isn't from the spinoff pool
    // (unless this is being called FROM spinoff mode's handleNext)
    if (spinoffMode && !track._playbackContext?.type?.includes('spinoff')) {
      exitSpinoff();
    }
```

Note: The exact location of handlePlay needs to be found - search for `const handlePlay = ` or `handlePlay = async`.

**Step 3: Verify exit conditions work**

Run: Refresh the app, start spinoff, then click a track in the queue
Expected: Spinoff mode exits, clicked track plays

**Step 4: Commit**

```bash
git add app.js
git commit -m "feat(spinoff): add exit conditions for spinoff mode"
```

---

### Task 9: Final Testing and Polish

**Step 1: Test the complete spinoff flow**

Test cases:
1. Play a track → click spinoff icon → verify loading spinner → verify toast with track count
2. Verify context banner shows "spun off from [track name]"
3. Verify queue numbers show ·· and items are dimmed
4. Let track finish → verify next similar track plays automatically
5. Click spinoff icon again → verify mode exits
6. Click a track in the queue → verify spinoff exits and track plays
7. Play a track from search/library → verify spinoff exits
8. Let all 20 tracks play → verify spinoff exits and queue resumes

**Step 2: Test error handling**

1. Try spinoff with no Last.fm API key configured → should show toast
2. Try spinoff on a track with no similar tracks found → should show toast

**Step 3: Commit any final fixes**

```bash
git add app.js
git commit -m "feat(spinoff): complete spinoff feature implementation"
```

---

## Summary of Changes

| File | Changes |
|------|---------|
| `app.js:1556` | Add spinoff state variables |
| `app.js:12604` | Add fetchSimilarTracks function |
| `app.js:12650` | Add startSpinoff and exitSpinoff functions |
| `app.js:22766` | Add spinoff icon to playbar |
| `app.js:5998` | Modify handleNext for spinoff mode |
| `app.js:25255` | Dim queue items in spinoff mode |
| `app.js:25264` | Show ·· instead of numbers in spinoff mode |
| `app.js:25416` | Make spinoff banner non-clickable |
| `app.js:25452` | Update banner label for spinoff |
| `app.js:25453` | Add spinoff case to banner text |
| `app.js:25465` | Hide arrow icon for spinoff |
| `app.js:25283` | Exit spinoff on queue track click |
| `app.js` (handlePlay) | Exit spinoff when playing non-spinoff tracks |
