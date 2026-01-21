# External Playback System Test Checklist

**Date:** 2026-01-20
**Tester:** _______________
**App Version:** _______________

## Prerequisites

- [ ] App running (`npm start`)
- [ ] Browser extension installed (Chrome → Extensions → Load unpacked → select `parachord-extension/`)
- [ ] Extension WebSocket connected (green badge in extension popup)
- [ ] Have Bandcamp track URLs ready for testing

---

## 1. Electron Playback Window Tests

### PW-01: Embedded Player Opens
**Steps:**
1. Search for a Bandcamp track or drop a Bandcamp URL
2. Click play on a track that has `bandcampTrackId` cached

**Expected:**
- [ ] 400x200 window opens with Bandcamp embed
- [ ] Console shows: `=== Open Playback Window ===`
- [ ] Console shows: `Playback window loaded, injecting auto-play script...`

**Actual:** _______________

### PW-02: Auto-Play Triggers
**Steps:**
1. Watch the embedded player window after it opens

**Expected:**
- [ ] Play button is automatically clicked
- [ ] Console shows: `Auto-play injection result: clicked: [classname]`
- [ ] Music starts playing within 3 seconds

**Actual:** _______________

### PW-03: Playing Event Received
**Steps:**
1. Observe console after music starts

**Expected:**
- [ ] Console shows: `Playback window event: playing`
- [ ] Console shows: `🎵 Playback window event: playing`
- [ ] App UI shows play state (progress bar active, play icon changes)

**Actual:** _______________

### PW-04: Track Ends → Auto-Advance
**Steps:**
1. Let the embedded track play to completion (or seek near end if possible)

**Expected:**
- [ ] Console shows: `Playback window event: ended`
- [ ] Console shows: `🎵 Playback window track ended, advancing to next`
- [ ] Next track in queue starts playing
- [ ] Embedded window closes or loads next embed

**Actual:** _______________

### PW-05: Manual Window Close
**Steps:**
1. While a track is playing, close the playback window manually (X button)

**Expected:**
- [ ] Console shows: `🎵 Playback window closed`
- [ ] Playback stops
- [ ] Queue does NOT auto-advance (by design)

**Actual:** _______________

---

## 2. Browser Extension Tests

### EXT-01: Extension Connects
**Steps:**
1. Open Chrome and ensure extension is installed
2. Start Parachord app

**Expected:**
- [ ] Console shows: `Extension WebSocket server running on ws://127.0.0.1:9876`
- [ ] Console shows: `Browser extension connected`
- [ ] Extension popup shows green "Connected" status

**Actual:** _______________

### EXT-02: Content Script Loads on Bandcamp
**Steps:**
1. Open a Bandcamp track page in Chrome (e.g., `artist.bandcamp.com/track/song`)
2. Open Chrome DevTools on that page

**Expected:**
- [ ] Console shows: `[Parachord] Content script loaded on: bandcamp`
- [ ] Console shows: `[Parachord] Bandcamp detected, scheduling auto-play...`

**Actual:** _______________

### EXT-03: Auto-Play Attempts
**Steps:**
1. Navigate to Bandcamp track with extension loaded

**Expected:**
- [ ] Console shows: `[Parachord] First auto-play attempt (1s)`
- [ ] Console shows: `[Parachord] Found Bandcamp play button: [classname]`
- [ ] Music begins playing automatically

**Actual:** _______________

### EXT-04: Playing Event Sent to App
**Steps:**
1. With Bandcamp playing in browser, check Parachord app console

**Expected:**
- [ ] Console shows: `Extension message: event playing`
- [ ] Console shows: `🎬 Browser playback connected: bandcamp`
- [ ] App UI shows "Playing in browser" state

**Actual:** _______________

### EXT-05: Ended Event Triggers Advance
**Steps:**
1. Let Bandcamp track finish playing in browser

**Expected:**
- [ ] Extension sends `ended` event
- [ ] Console shows: `⏹️ Browser playback ended`
- [ ] `handleNext()` is called via ref
- [ ] Next track in queue starts

**Actual:** _______________

### EXT-06: Manual Tab Close → Advance
**Steps:**
1. While browser is playing Bandcamp, manually close the tab

**Expected:**
- [ ] Console shows: `🚪 Browser tab closed by user`
- [ ] `handleNext()` is called
- [ ] Next track starts

**Actual:** _______________

---

## 3. Transport Control Sync Tests

### TC-01: Play Command to Extension
**Steps:**
1. With Bandcamp paused in browser extension
2. Click Play in Parachord app

**Expected:**
- [ ] Console shows: `🌐 Sending play/pause to browser extension`
- [ ] Browser extension resumes playback

**Actual:** _______________

### TC-02: Pause Command to Extension
**Steps:**
1. With Bandcamp playing in browser extension
2. Click Pause in Parachord app

**Expected:**
- [ ] Console shows: `🌐 Sending play/pause to browser extension`
- [ ] Browser extension pauses playback

**Actual:** _______________

### TC-03: Next Stops Browser Before Playing
**Steps:**
1. With browser extension playing
2. Click Next in Parachord app

**Expected:**
- [ ] Console shows: `⏹️ Stopping browser playback before next track`
- [ ] Previous tab closes or stops
- [ ] Next track loads

**Actual:** _______________

### TC-04: Progress Bar Disabled
**Steps:**
1. During browser/external playback, check progress bar

**Expected:**
- [ ] Progress bar is grayed out / not draggable
- [ ] Shows 0:00 / [duration]

**Actual:** _______________

---

## 4. Mixed Queue Auto-Advance Tests

### MQ-01: Spotify → Bandcamp Transition
**Preconditions:** Queue with Spotify track followed by Bandcamp track

**Steps:**
1. Play Spotify track, let it finish (or use Spotify auto-advance)

**Expected:**
- [ ] Spotify track ends and auto-advances
- [ ] Bandcamp track detected as external
- [ ] (If prompt implemented) Prompt shows "Next track requires browser"
- [ ] (Current behavior) Opens in browser/embed directly

**Actual:** _______________

### MQ-02: Bandcamp → Spotify Transition
**Preconditions:** Queue with Bandcamp track followed by Spotify track

**Steps:**
1. Play Bandcamp track via embed/extension, let it finish

**Expected:**
- [ ] Bandcamp `ended` event received
- [ ] Spotify track starts playing automatically
- [ ] No browser prompt needed (Spotify streams in-app)

**Actual:** _______________

### MQ-03: All External Queue
**Preconditions:** Queue with Bandcamp → YouTube → Bandcamp

**Steps:**
1. Play first Bandcamp track, let each finish

**Expected:**
- [ ] Each track opens in browser/embed
- [ ] Auto-advance works between all external tracks
- [ ] Queue depletes correctly

**Actual:** _______________

---

## 5. Error Handling Tests

### ERR-01: Extension Disconnect During Playback
**Steps:**
1. While browser extension is playing
2. Disable the extension in Chrome

**Expected:**
- [ ] Console shows: `Browser extension disconnected`
- [ ] App UI updates (browserPlaybackActive = false)
- [ ] Graceful handling, no crash

**Actual:** _______________

### ERR-02: Bandcamp Page Load Failure
**Steps:**
1. Try to play a Bandcamp URL that 404s

**Expected:**
- [ ] Error logged
- [ ] App doesn't crash
- [ ] Can continue to next track

**Actual:** _______________

### ERR-03: WebSocket Port Conflict
**Steps:**
1. Start another app on port 9876
2. Start Parachord

**Expected:**
- [ ] Error logged about port conflict
- [ ] App still functions for local playback

**Actual:** _______________

---

## Summary

| Category | Pass | Fail | N/A |
|----------|------|------|-----|
| Playback Window (PW-01 to PW-05) | | | |
| Extension (EXT-01 to EXT-06) | | | |
| Transport Control (TC-01 to TC-04) | | | |
| Mixed Queue (MQ-01 to MQ-03) | | | |
| Error Handling (ERR-01 to ERR-03) | | | |

**Issues Found:**
1. _______________
2. _______________
3. _______________

**Notes:**
_______________

---

## Bug Fixed During Review

**Issue:** Playback window `ended` event handler at line 2472 was calling `handleNext()` directly instead of using `handleNextRef.current`, causing stale closure issues.

**Fix:** Changed to `if (handleNextRef.current) handleNextRef.current();`

**Commit:** `fix(playback): use handleNextRef in playback window ended event`
