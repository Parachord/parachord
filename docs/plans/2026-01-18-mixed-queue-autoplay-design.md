# Mixed Queue Auto-Play Design

**Date:** 2026-01-18
**Status:** Approved
**Related Files:** `app.js`, `main.js`, `resolvers/*.axe`

## Overview

Add intelligent auto-play functionality to Parachord Desktop that handles queues containing both in-app streaming tracks (Spotify, Qobuz) and external browser tracks (Bandcamp, YouTube). The system automatically advances through streaming tracks while prompting for user confirmation before opening external browser windows.

## Problem Statement

Parachord supports multiple music sources with different playback mechanisms:
- **In-app streaming**: Resolvers with `capabilities.stream = true` (Spotify via Spotify Connect, Qobuz previews, potential future HTML5 audio resolvers)
- **External browser**: Resolvers with `capabilities.stream = false` (Bandcamp, YouTube, SoundCloud)

Currently, tracks don't automatically advance when they finish playing. Users must manually click Next for every track. When queues mix streaming and external tracks, there's no smooth transition mechanism.

## User Requirements

1. Streaming tracks should automatically advance to the next track when they finish
2. External browser tracks should prompt for user confirmation before opening
3. Users should maintain control over when external browsers open
4. The UI should clearly communicate which resolver is playing each track
5. The system should handle timeouts gracefully if users don't respond to prompts

## Design Solution

### 1. Auto-Advance for In-App Streaming

**Spotify (Spotify Connect API):**
- Poll Spotify Web API's `/v1/me/player` endpoint every 2 seconds during playback
- Monitor `progress_ms` and `duration_ms` fields
- When `progress_ms` approaches `duration_ms` (within 1 second), trigger `handleNext()`
- Clear polling interval when track changes or playback stops

**HTML5 Audio-based Resolvers:**
- For resolvers using `<audio>` elements, attach `ended` event listener
- Automatically trigger `handleNext()` when audio element fires `ended` event
- Works for Qobuz previews and future HTML5-based resolvers

**Future Resolver Extension:**
Streaming resolvers can provide either:
- A `getPlaybackState()` method for polling
- A callback mechanism for track end notifications
- Use standard web APIs with built-in event support

### 2. External Browser Track Transitions

**When Streaming Track → External Browser Track:**

**Prompt Display:**
- Replace player controls with in-player prompt
- Message: `🌐 Next track requires browser`
- Show track name, artist, and resolver badge: `via Bandcamp`
- Two action buttons: `[Open in Browser]` `[Skip Track]`
- Gray out progress bar (dashed border)

**User Actions:**

**A) User clicks "Open in Browser":**
1. Call `resolver.play()` to open external browser via `shell.openExternal()`
2. Update player UI to external playback state (see below)
3. Clear the prompt timeout
4. Browser tab/window opens in user's default browser

**B) User clicks "Skip Track":**
1. Remove track from queue
2. Immediately call `handleNext()` to play next track
3. If next track is also external, show prompt again
4. If next track is streaming, start playing immediately

**C) User does nothing (15-second timeout):**
1. Automatically skip to next track
2. Show toast notification: `Skipped [Track Name] - browser tab remains open` (if browser was opened)
3. Continue queue as if user clicked Skip
4. External browser tab (if opened) remains open

**Technical Note on Browser Windows:**
- `shell.openExternal()` doesn't return a window reference
- Cannot programmatically close external browser tabs/windows
- Browser tabs remain open after timeout - user manages them
- This is acceptable: users might want to continue listening or browse related content

### 3. External Browser Playback State

**Player UI During External Playback:**

**Track Display:**
- Current track shows as active with normal metadata
- Resolver badge: `🌐 via Bandcamp` or `🌐 via YouTube`
- Status text: `🌐 Playing in browser` below track title

**Progress Bar:**
- Grayed out with dashed border outline
- Not interactive (no scrubbing)
- Shows static time: `0:00 / 3:45` (total duration only, grayed out)
- Communicates "no app control over playback"

**Playback Controls:**
- Large primary button: `✓ Done - Play Next`
- Previous/Next buttons remain enabled but slightly grayed
- Play/Pause hidden during external playback

**"Done - Play Next" Button Behavior:**
Clicking this button:
1. Removes current external track from queue
2. Calls `handleNext()` immediately
3. If next track is streaming → starts playing
4. If next track is external → shows prompt again
5. If queue is empty → returns to idle state

**External Browser Tab:**
- Stays open (cannot be closed programmatically)
- User manages it independently
- App doesn't track external playback state

### 4. Resolver Name Display

**Requirement:**
Show which resolver is handling each track, regardless of playback method.

**Implementation:**

**For Streaming Tracks:**
- Badge: `▶️ via Spotify` or `▶️ via Qobuz`
- Appears next to track metadata in player UI
- Uses resolver's icon and color from manifest

**For External Browser Tracks:**
- Badge: `🌐 via Bandcamp` or `🌐 via YouTube`
- Uses browser icon (🌐) instead of play icon (▶️)
- Same visual style and positioning

**Display Locations:**
- Now Playing view (main player)
- Queue items list
- External playback state screen
- Transition prompts ("Next track requires browser - via Bandcamp")

**Visual Design:**
- Small badge with resolver icon + "via [name]"
- Accent color from resolver's `color` manifest property
- Consistent styling across all contexts
- Positioned below track title or next to artist name

### 5. State Management

**New State Variables (app.js):**

```javascript
const [isExternalPlayback, setIsExternalPlayback] = useState(false);
const [externalTrackTimeout, setExternalTrackTimeout] = useState(null);
const [playbackPoller, setPlaybackPoller] = useState(null);
const [showExternalPrompt, setShowExternalPrompt] = useState(false);
const [pendingExternalTrack, setPendingExternalTrack] = useState(null);
```

**State Transitions:**

```
[Idle]
  → handlePlay(streaming track)
  → [Streaming Playback]
  → track ends (detected via polling/events)
  → handleNext()
  → next is external
  → [External Prompt]
  → user clicks "Open"
  → [External Playback]
  → user clicks "Done - Play Next"
  → handleNext()
  → [back to Streaming Playback or Idle]
```

### 6. Implementation Details

**New Functions:**

**`startAutoAdvancePolling(resolver, track, config)`**
```javascript
// Called after successful resolver.play() for streaming tracks
// Sets up appropriate auto-advance mechanism based on resolver type

if (resolverId === 'spotify') {
  // Poll Spotify Web API every 2 seconds
  const pollInterval = setInterval(async () => {
    const state = await fetch('https://api.spotify.com/v1/me/player', {
      headers: { Authorization: `Bearer ${config.token}` }
    });
    const data = await state.json();

    if (data.progress_ms >= data.item.duration_ms - 1000) {
      clearInterval(pollInterval);
      handleNext();
    }
  }, 2000);

  setPlaybackPoller(pollInterval);
} else if (resolver.usesAudioElement) {
  // For HTML5 audio-based resolvers
  const audioElement = document.querySelector('#resolver-audio');
  audioElement.addEventListener('ended', handleNext, { once: true });
}
```

**`showExternalTrackPrompt(track)`**
```javascript
// Show in-player prompt for external browser track
setPendingExternalTrack(track);
setShowExternalPrompt(true);

// Set 15-second auto-skip timeout
const timeout = setTimeout(() => {
  handleSkipExternalTrack();
}, 15000);

setExternalTrackTimeout(timeout);
```

**`handleOpenExternalTrack(track)`**
```javascript
// User confirmed opening external browser
clearTimeout(externalTrackTimeout);
setShowExternalPrompt(false);
setIsExternalPlayback(true);

const resolver = getResolverById(track.resolverId);
const config = getResolverConfig(track.resolverId);
await resolver.play(track, config); // Opens browser via shell.openExternal

setCurrentTrack(track);
```

**`handleSkipExternalTrack()`**
```javascript
// Auto-skip or manual skip of external track
clearTimeout(externalTrackTimeout);
setShowExternalPrompt(false);

// Show toast notification
showToast(`Skipped ${pendingExternalTrack.title}`);

// Move to next track
handleNext();
```

**`handleDoneWithExternalTrack()`**
```javascript
// User clicked "Done - Play Next" during external playback
setIsExternalPlayback(false);
handleNext();
```

**Modified Functions:**

**`handlePlay(track)` - Add auto-advance logic:**
```javascript
// After successful resolver.play() for streaming tracks:
if (resolver.capabilities.stream) {
  startAutoAdvancePolling(resolver, track, config);
} else {
  // External browser track
  showExternalTrackPrompt(track);
  return; // Don't immediately play, wait for user confirmation
}
```

**`handleNext()` - Clean up polling/timeouts:**
```javascript
// At start of handleNext():
if (playbackPoller) {
  clearInterval(playbackPoller);
  setPlaybackPoller(null);
}
if (externalTrackTimeout) {
  clearTimeout(externalTrackTimeout);
  setExternalTrackTimeout(null);
}
setIsExternalPlayback(false);
setShowExternalPrompt(false);

// Then proceed with existing next track logic
```

**`handlePrevious()` - Same cleanup:**
```javascript
// Same cleanup logic as handleNext()
```

### 7. UI Components

**External Track Prompt Component:**
```jsx
{showExternalPrompt && pendingExternalTrack && (
  <div className="external-track-prompt">
    <div className="prompt-icon">🌐</div>
    <div className="prompt-message">Next track requires browser</div>
    <div className="track-info">
      <div className="track-title">{pendingExternalTrack.title}</div>
      <div className="track-artist">{pendingExternalTrack.artist}</div>
      <div className="resolver-badge">
        via {getResolverById(pendingExternalTrack.resolverId).name}
      </div>
    </div>
    <div className="prompt-actions">
      <button onClick={() => handleOpenExternalTrack(pendingExternalTrack)}>
        Open in Browser
      </button>
      <button onClick={handleSkipExternalTrack}>
        Skip Track
      </button>
    </div>
  </div>
)}
```

**External Playback State Component:**
```jsx
{isExternalPlayback && currentTrack && (
  <div className="external-playback-state">
    <div className="track-metadata">
      {/* Album art, title, artist */}
      <div className="resolver-badge">
        🌐 via {getResolverById(currentTrack.resolverId).name}
      </div>
      <div className="external-status">🌐 Playing in browser</div>
    </div>

    <div className="progress-bar grayed-out dashed">
      <div className="time-display grayed-out">
        0:00 / {formatDuration(currentTrack.duration)}
      </div>
    </div>

    <button className="done-button" onClick={handleDoneWithExternalTrack}>
      ✓ Done - Play Next
    </button>
  </div>
)}
```

**Resolver Badge Component:**
```jsx
const ResolverBadge = ({ resolverId, isExternal }) => {
  const resolver = getResolverById(resolverId);
  const icon = isExternal ? '🌐' : '▶️';

  return (
    <div
      className="resolver-badge"
      style={{
        color: resolver.color,
        borderColor: resolver.color
      }}
    >
      {icon} via {resolver.name}
    </div>
  );
};
```

### 8. Error Handling

**Network Errors (Spotify API polling):**
- If API request fails, retry once after 5 seconds
- If second attempt fails, log error and stop polling
- Don't auto-advance (require manual Next)
- Show error toast: "Lost connection to Spotify"

**External Browser Open Failures:**
- If `shell.openExternal()` fails, show error alert
- Don't mark track as "playing"
- Keep prompt visible for retry or skip
- Error message: "Failed to open browser: [error]"

**Token Expiration (Spotify):**
- Detect 401 Unauthorized during polling
- Trigger token refresh flow
- Resume polling after refresh
- If refresh fails, show "Spotify disconnected" alert

**Empty Queue During Auto-Advance:**
- If `handleNext()` called but queue is empty
- Return to idle state
- Clear all polling/timeouts
- Show "Queue complete" message

### 9. Edge Cases

**User Manually Clicks Next During External Playback:**
- Clear external playback state
- Proceed to next track normally
- External browser tab stays open

**User Manually Clicks Previous During External Playback:**
- Clear external playback state
- Go to previous track
- If previous is external, show prompt again

**Multiple External Tracks in a Row:**
- Each shows prompt separately
- User can skip all, or open each one
- Timeout applies to each individually

**App Closed During External Playback:**
- Browser tab remains open (unaffected)
- On app restart, no "resume" state
- User starts fresh

**Spotify Track Playing in External Spotify App:**
- Polling still works (Connect API tracks any active device)
- Auto-advance functions normally

### 10. Future Enhancements (Out of Scope)

- User preference: "Always skip external tracks"
- User preference: "Always auto-open external tracks"
- Queue view shows track types with icons before playing
- Visual countdown timer on 15-second timeout prompt
- Remember last choice per resolver ("always open Bandcamp")
- Detect if browser tab is still open/active
- Integration with system media controls for external playback

## Success Criteria

✅ Spotify tracks automatically advance to next track when finished
✅ Qobuz preview tracks automatically advance when finished
✅ External browser tracks show confirmation prompt before opening
✅ Users can skip external tracks without opening browser
✅ 15-second timeout auto-skips if user doesn't respond
✅ "Done - Play Next" button works during external playback
✅ All tracks show resolver name badge regardless of playback type
✅ Progress bar is grayed out for external playback
✅ No crashes or state corruption when mixing track types
✅ Token refresh works during Spotify polling

## Testing Considerations

- Test queue with: Spotify → Spotify → Bandcamp → Spotify
- Test queue with: All external tracks (Bandcamp → YouTube → Bandcamp)
- Test queue with: All streaming tracks (Spotify → Qobuz → Spotify)
- Test timeout on external track prompt (wait 15 seconds)
- Test skipping external track during prompt
- Test opening external track and clicking "Done - Play Next"
- Test manual Next/Previous during external playback
- Test Spotify token expiration during polling
- Test network disconnection during Spotify polling
- Test empty queue after auto-advance
- Verify resolver badges appear on all track types
- Verify external browser tabs remain open after skips/timeouts

## Implementation Checklist

- [ ] Add new state variables to app.js
- [ ] Implement `startAutoAdvancePolling()` with Spotify polling
- [ ] Implement `showExternalTrackPrompt()` with 15s timeout
- [ ] Implement `handleOpenExternalTrack()`
- [ ] Implement `handleSkipExternalTrack()`
- [ ] Implement `handleDoneWithExternalTrack()`
- [ ] Modify `handlePlay()` to route streaming vs external
- [ ] Modify `handleNext()` to cleanup polling/timeouts
- [ ] Modify `handlePrevious()` to cleanup polling/timeouts
- [ ] Create External Track Prompt UI component
- [ ] Create External Playback State UI component
- [ ] Create Resolver Badge component
- [ ] Add resolver badges to all track displays
- [ ] Style grayed-out progress bar for external playback
- [ ] Add error handling for network failures
- [ ] Add error handling for browser open failures
- [ ] Test complete flow with mixed queues
- [ ] Update comprehensive test plan

---

**Design Approved:** 2026-01-18
**Ready for Implementation**
