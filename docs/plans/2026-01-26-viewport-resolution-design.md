# Viewport-Based Resolution Optimization

## Problem

Collected Songs and other large track lists resolve all tracks even when only a small portion are visible. Resolution continues after navigating away from the page, wasting resources.

## Solution

A `ResolutionScheduler` that resolves only imminently-playable tracks based on visibility, with proper abort handling when tracks leave visibility.

## Visibility Contexts

| Context | Visible Set | Priority | Abort Trigger |
|---------|-------------|----------|---------------|
| Queue | Viewport + 10 overscan + 5 playback lookahead | 1 | Track removed from queue |
| Hover | Single hovered track | 2 | Hover-out (demotes to page priority) |
| Pools (spinoffs/listen-along) | Next 5 from current position | 3 | Track removed / pool ends |
| Page (Collected Songs, albums, playlists) | Viewport + 10 overscan | 4 | Navigation away (after current batch) |
| Sidebar (friends now playing) | Visible friend tracks | 5 | Scroll out / collapse |

## Abort Architecture

Two-tier system:

1. **Context-level AbortController** - One per page/navigation context
   - Created when entering a page
   - Aborted on navigation away (after current batch of ~5 completes)
   - All pending track resolutions for that page share this controller

2. **Per-track AbortController map** - For granular cancellation
   - Map of `trackKey -> AbortController`
   - Used by queue, pools, sidebar for individual track removal
   - Cleaned up after abort or successful resolution

Either signal aborting cancels the request.

## Visibility Tracking

**Queue:** Hook into `FixedSizeList` via `onItemsRendered` callback. Provides `visibleStartIndex` and `visibleStopIndex`. Add overscan (10) + playback lookahead (5 from `currentTrackIndex`).

**Pools:** Track `currentPoolIndex` for each active pool. Visible = indices `currentPoolIndex` to `currentPoolIndex + 5`.

**Page:** Add `onItemsRendered` to track list virtualization. For non-virtualized lists, use IntersectionObserver on track rows.

**Sidebar:** IntersectionObserver on friend track elements.

On visibility change: diff against previous set, enqueue new visible tracks, abort newly hidden tracks.

## Resolution Scheduler

Central module managing all pending resolution requests:

```
ResolutionScheduler
├── contexts: Map<contextId, ResolutionContext>
├── priorityQueue: Array<PendingResolution>
├── isProcessing: boolean
├── hoverTrack: { trackKey, contextId } | null
│
├── registerContext(id, type, getVisibleTracks)
├── unregisterContext(id)  // aborts after current batch
├── updateVisibility(contextId, visibleTrackKeys)
├── setHoverTrack(trackKey, contextId)
├── clearHoverTrack()
│
├── enqueue(trackKey, contextId, trackData)
├── abort(trackKey)
├── abortContext(contextId, afterCurrentBatch)
│
└── processNext()  // main loop
```

**Processing loop:**
1. Pick highest priority pending track
2. Check: still visible? still in context?
   - No: skip, move to next
   - Yes: resolve (cache check first, then resolvers)
3. On complete: remove from pending, cache result
4. On abort: remove from pending, clean up controller
5. Pick next track

Respects existing rate limiting (100-150ms between resolver calls).

## Abort Signal Integration

Changes to `resolveTrack()`:

```javascript
const resolveTrack = async (track, artistName, options = {}) => {
  const { signal, contextId } = options;

  // Early abort check
  if (signal?.aborted) return;

  // ... cache check (unchanged) ...

  // Pass signal to each resolver
  const resolverPromises = enabledResolvers.map(async (resolver) => {
    if (signal?.aborted) return;

    try {
      const result = await resolver.resolve(
        artistName,
        track.title,
        track.album,
        config,
        { signal }  // Pass to resolver
      );

      if (signal?.aborted) return;
      // ... handle result ...
    } catch (error) {
      if (error.name === 'AbortError') return; // Silent abort
      // ... handle other errors ...
    }
  });

  await Promise.all(resolverPromises);

  if (signal?.aborted) return;
  // ... update state ...
};
```

Each resolver's `resolve()` method accepts and respects the signal. HTTP-based resolvers pass to `fetch()`. IPC-based resolvers check `signal.aborted` periodically.

## Files to Modify

**Create:**
- `src/resolution-scheduler.js` - Central scheduler module

**Modify:**
- `app.js`:
  - Update `resolveTrack()` to accept AbortSignal
  - Remove `resolveAllTracks()` and `resolveQueueTracks()`
  - Add scheduler integration and visibility hooks
- Track list components: Add `onItemsRendered` callbacks
- Queue component: Visibility tracking + playback lookahead logic
- Pool components (spinoffs/listen-along): Visibility tracking
- Sidebar: IntersectionObserver for friend tracks

## Behavior Notes

- Cache continues to work - revisiting resolved tracks is instant
- Batched state updates (5 tracks) still apply
- Current batch completes before page abort (no wasted partial work)
- Hover promotes track to priority 2; click adds to queue promoting to priority 1
- Rate limiting preserved (100-150ms between resolver calls)
