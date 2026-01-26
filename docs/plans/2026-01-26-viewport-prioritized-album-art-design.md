# Viewport-Prioritized Album Art Loading

## Problem

Album art loading on artist pages is slow. Currently, albums are fetched sequentially with 100ms delays, meaning an artist with 50 albums takes 5+ seconds to fully load art. Users see shimmers for albums they're looking at while the system fetches art for off-screen content.

## Solution

Prioritize fetching album art for visible albums first, in parallel batches. Off-screen albums load in the background sequentially.

## Architecture

### Data Structures

```javascript
const visibleAlbumIds = useRef(new Set());      // Currently in viewport
const albumArtQueue = useRef([]);               // Ordered queue of release IDs to fetch
const isAlbumArtFetching = useRef(false);       // Prevents multiple fetcher loops
```

### Flow

```
Scroll/Mount → IntersectionObserver → Update visible set →
Queue reorders → Batch fetcher pulls from front →
Results update state + cache
```

## Implementation

### 1. Intersection Observer Setup

Each album card in the grid gets a `data-release-id` attribute. A single IntersectionObserver watches all cards:

- `threshold: 0` (any pixel visible triggers)
- On intersection change: add/remove IDs from `visibleAlbumIds`
- Call `reprioritizeQueue()` after changes

### 2. Queue Management

**`reprioritizeQueue()`**
- Splits current queue into visible vs non-visible based on `visibleAlbumIds`
- Reconstructs: `[...visible, ...nonVisible]`
- Does not cancel in-flight requests

### 3. Fetcher Loop

**`processAlbumArtQueue()`**
```
while queue not empty:
  - Pull up to 4 items that are in visibleAlbumIds
  - If found: fetch all 4 in parallel with Promise.all
  - Else: fetch 1 item (low priority), wait 100ms
  - Update state + cache after each batch/item
```

### 4. Integration Points

**`fetchArtistData`** (line ~9546):
- Populate `albumArtQueue.current` with release IDs not in cache
- Start fetcher via `processAlbumArtQueue()`

**Album grid component**:
- Add `data-release-id={release.id}` to each card
- Set up IntersectionObserver on mount
- Disconnect observer on unmount

**Navigation away**:
- Fetcher stops via `isMounted` ref check
- Queue cleared on next artist load

## Error Handling

| Scenario | Behavior |
|----------|----------|
| 429/503 response | Push item to end of queue, continue |
| 3+ consecutive failures | Reduce batch to 2, restore after 10 successes |
| Fast scrolling | Queue reorders cheaply, no debounce needed |
| Empty viewport | Falls back to sequential low-priority mode |
| Navigation mid-fetch | `isMounted` check prevents stale updates |
| Already cached | Filtered on initial queue, skipped on dequeue |

## Expected Performance

| Scenario | Before | After |
|----------|--------|-------|
| First visit, visible albums | 2-3s | 200-400ms |
| Scroll to new section | 2-3s | 200-400ms |
| Full discography load | 5-7s | 5-7s (unchanged, just reordered) |

## Files Modified

- `app.js` - New refs, `reprioritizeQueue()`, `processAlbumArtQueue()`, observer setup, modify `fetchArtistData`

## No Changes To

- Cache TTLs or structure
- API endpoints
- Fallback chain logic (release-group → release)
