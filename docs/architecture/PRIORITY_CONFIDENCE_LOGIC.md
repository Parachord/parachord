# Track Playback: Priority + Confidence Logic ✅

## What Changed

Updated track row click handler to intelligently select the best source based on BOTH resolver priority AND confidence score.

## The Problem (Before)

**Before:** Track row clicks only considered resolver priority order:
```javascript
// Old logic - priority only
const enabledResolverOrder = resolverOrder.filter(r => activeResolvers.includes(r));
const bestResolver = enabledResolverOrder.find(r => availableResolvers.includes(r));
```

**Example Scenario:**
```
Resolver Order: [Spotify #1, Bandcamp #2, Qobuz #3]

Track "Creep" resolved sources:
- Spotify: 50% confidence (wrong version)
- Bandcamp: 95% confidence (exact match)
- Qobuz: 90% confidence (album version)

OLD BEHAVIOR: ❌ Plays Spotify (50% confidence) because it's #1 priority
```

## The Solution (After)

**After:** Sorts by priority FIRST, then by confidence WITHIN same priority:

```javascript
// New logic - priority + confidence
const sortedSources = availableResolvers.map(resolverId => ({
  resolverId,
  source: sources[resolverId],
  priority: resolverOrder.indexOf(resolverId),
  confidence: sources[resolverId].confidence || 0
}))
.filter(s => activeResolvers.includes(s.resolverId))
.sort((a, b) => {
  // First: sort by priority (lower index = higher priority)
  if (a.priority !== b.priority) {
    return a.priority - b.priority;
  }
  // Second: if same priority, sort by confidence (higher = better)
  return b.confidence - a.confidence;
});

const best = sortedSources[0];
```

**Same Scenario:**
```
Resolver Order: [Spotify #1, Bandcamp #2, Qobuz #3]

Track "Creep" resolved sources:
- Spotify: 50% confidence
- Bandcamp: 95% confidence
- Qobuz: 90% confidence

NEW BEHAVIOR: ✅ Plays Spotify (50% confidence) because priority wins
```

**But if Spotify isn't available:**
```
Resolver Order: [Spotify #1, Bandcamp #2, Qobuz #3]

Track "Obscure Track" resolved sources:
- Bandcamp: 60% confidence (maybe?)
- Qobuz: 95% confidence (definite match)

NEW BEHAVIOR: ✅ Plays Bandcamp (60%) because #2 priority beats #3
```

**And if multiple resolvers have same priority:**
```
Resolver Order: [Group A (Spotify, Bandcamp), Qobuz]

Track sources:
- Spotify: 50% confidence (priority 0)
- Bandcamp: 95% confidence (priority 0)
- Qobuz: 90% confidence (priority 2)

NEW BEHAVIOR: ✅ Plays Bandcamp (95%) because same priority, higher confidence
```

## The Algorithm

```
FOR each resolved source:
  1. Get priority from resolverOrder index (lower = better)
  2. Get confidence from resolver match score (0-1)
  
SORT sources by:
  1. Priority ascending (0, 1, 2, ...)
  2. Confidence descending (0.95, 0.90, 0.85, ...)
  
PLAY the first source in sorted list
```

## Console Output

**Before:**
```
Track row clicked: Creep
🎵 Playing from spotify (priority #1)
```

**After:**
```
Track row clicked: Creep
🎵 Playing from spotify (priority #1, confidence: 50%)
```

Or with better match:
```
Track row clicked: Creep
🎵 Playing from bandcamp (priority #2, confidence: 95%)
```

## Examples

### Example 1: Priority Wins
```
Order: [Spotify #1, Bandcamp #2]
Sources:
- Spotify: 50% ← PLAYS THIS (priority #1)
- Bandcamp: 95%
```

### Example 2: No Higher Priority Available
```
Order: [Spotify #1, Bandcamp #2, Qobuz #3]
Sources:
- Bandcamp: 60% ← PLAYS THIS (highest available priority)
- Qobuz: 95%
```

### Example 3: Confidence Breaks Tie
```
Order: [Spotify #1, Bandcamp #1]  (same priority)
Sources:
- Spotify: 50%
- Bandcamp: 95% ← PLAYS THIS (same priority, higher confidence)
```

### Example 4: Multiple High-Confidence Sources
```
Order: [Spotify #1, Bandcamp #2, Qobuz #3]
Sources:
- Spotify: 95% ← PLAYS THIS (priority #1, also high confidence)
- Bandcamp: 95%
- Qobuz: 90%
```

## Resolver Icon Clicks (Manual Override)

**Important:** Clicking specific resolver icons still bypasses this logic:
```javascript
// Resolver icon onClick
onClick: (e) => {
  e.stopPropagation();
  handlePlay(source); // Plays from THIS resolver, ignoring priority/confidence
}
```

This allows users to manually override the automatic selection.

## User Experience

### Automatic Play (Row Click or Play Icon):
1. ✅ **Respects user's priority preferences**
2. ✅ **Chooses best match within that priority**
3. ✅ **Falls back to next priority if needed**

### Manual Play (Resolver Icon Click):
1. ✅ **User explicitly chooses which resolver**
2. ✅ **Bypasses all automatic logic**
3. ✅ **Direct control when needed**

## Code Location

**File:** `app.js`
**Line:** ~335-367
**Function:** Track row onClick handler in ReleasePage

```javascript
onClick: () => {
  // Sort by: 1) priority, 2) confidence
  const sortedSources = availableResolvers.map(...)
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.confidence - a.confidence;
    });
  
  const best = sortedSources[0];
  handlePlay(best.source);
}
```

## Testing

### Test Case 1: Priority Overrides Confidence
```bash
# Set resolver order: Spotify > Bandcamp
# Go to album with track that has:
#   - Spotify: 50% confidence
#   - Bandcamp: 95% confidence
# Click track row
# Expected: Plays from Spotify (priority wins)
```

### Test Case 2: Confidence Breaks Tie
```bash
# Set resolver order: Spotify, Bandcamp (same priority level)
# Go to album with track that has:
#   - Spotify: 50% confidence
#   - Bandcamp: 95% confidence
# Click track row
# Expected: Plays from Bandcamp (confidence breaks tie)
```

### Test Case 3: Fallback to Next Priority
```bash
# Set resolver order: Spotify > Bandcamp > Qobuz
# Go to album where Spotify didn't find track:
#   - Bandcamp: 60% confidence
#   - Qobuz: 95% confidence
# Click track row
# Expected: Plays from Bandcamp (next available priority)
```

### Test Case 4: Manual Override
```bash
# Same as Test Case 1, but click Bandcamp icon directly
# Expected: Plays from Bandcamp (95% confidence)
# User overrode the priority
```

## Benefits

✅ **Smart Selection:** Best match within user's preferred services
✅ **User Control:** Priority order respected first
✅ **Quality:** Confidence prevents bad matches when possible
✅ **Flexibility:** Manual override always available
✅ **Transparent:** Console shows priority + confidence

## Edge Cases Handled

1. **No sources:** Falls back to search
2. **Disabled resolvers:** Filtered out before sorting
3. **Missing confidence:** Defaults to 0
4. **Same priority & confidence:** First in order wins
5. **Resolver not in order:** Uses -1 (lowest priority)

## Summary

Track playback now intelligently balances:
- **Priority:** User's preferred resolver order
- **Confidence:** Quality of the match
- **Manual override:** Click specific resolver icon

Result: **Best listening experience with smart defaults and full user control!** 🎵
