# Search Improvements Design

## Overview

Enhance the search experience with bug fixes, better matching, history, and advanced query syntax.

## Features

### 1. Typeahead Bug Fix

**Problem:** Race condition in debounced search. When user types, backspaces, and retypes quickly, multiple 400ms timers fire out of order, causing stale "no results" responses to overwrite valid results.

**Solution:**
- Add query token check before setting results - verify response matches current input
- Use `AbortController` to cancel in-flight fetch requests when new search starts

```javascript
const abortControllerRef = useRef(null);

const performSearch = async (query) => {
  // Cancel previous request
  if (abortControllerRef.current) {
    abortControllerRef.current.abort();
  }
  abortControllerRef.current = new AbortController();

  try {
    const response = await fetch(url, {
      signal: abortControllerRef.current.signal,
      // ...
    });

    // Verify query still matches before updating
    if (query === searchQueryRef.current) {
      setSearchResults(results);
    }
  } catch (err) {
    if (err.name === 'AbortError') return; // Ignore cancelled requests
    // handle other errors
  }
};
```

### 2. Fuzzy Matching & Re-ranking

**Approach:** Keep MusicBrainz as the source, re-rank results locally using fuzzy string matching + popularity signals.

**Fuzzy Scoring:**
- Use `fuse.js` for lightweight fuzzy matching
- Score each result against the query, accounting for:
  - Exact substring match (highest)
  - Word boundary matches
  - Typo tolerance (edit distance)
  - Accent/diacritic normalization

**Popularity Weighting:**
- MusicBrainz returns a `score` field (0-100) representing relevance/popularity
- Combine: `finalScore = (fuzzyScore * 0.6) + (mbScore * 0.4)`
- Weights are tunable if results feel off

**Re-ranking Flow:**
1. Receive results from MusicBrainz
2. Compute fuzzy score for each item against original query
3. Blend with MusicBrainz score
4. Sort by final score descending
5. Display re-ranked results

```javascript
const reRankResults = (items, query, nameKey = 'name') => {
  const fuse = new Fuse(items, {
    keys: [nameKey],
    includeScore: true,
    threshold: 0.6,
  });

  const fuzzyResults = fuse.search(query);

  return items
    .map(item => {
      const fuzzyMatch = fuzzyResults.find(r => r.item === item);
      const fuzzyScore = fuzzyMatch ? (1 - fuzzyMatch.score) * 100 : 0;
      const mbScore = item.score || 50;
      const finalScore = (fuzzyScore * 0.6) + (mbScore * 0.4);
      return { ...item, finalScore };
    })
    .sort((a, b) => b.finalScore - a.finalScore);
};
```

### 3. Search History

**Data Structure:**
```javascript
{
  query: "beatles abbey road",
  timestamp: 1706123456789,
  selectedResult: {
    type: "album",        // "artist" | "album" | "track" | "playlist"
    id: "mb-release-group-id",
    name: "Abbey Road",
    artist: "The Beatles",  // for albums/tracks
    imageUrl: "..."         // cached for quick display
  }
}
```

**Storage:**
- Electron store at `searchHistory` key
- Keep last 50 entries
- Deduplicate by query string (update timestamp + selectedResult on repeat searches)

**Empty Search Page Display:**
- Header: "Recent Searches"
- Show query text with the result item the user clicked
- Clicking an entry:
  - Re-runs the search (if clicking the query)
  - Goes directly to the item (if clicking the result)
- Clear individual entries or "Clear All" option

**When to Record:**
- Save when user clicks a result from search
- Update existing entry if same query is searched again

### 4. Lucene Query Passthrough & Typed Filters

**Principle:** Don't interfere with MusicBrainz's Lucene syntax. Pass queries through mostly unchanged.

**Typed Filter Mapping:**

| User Types | MusicBrainz Field (recordings) | MusicBrainz Field (release-groups) |
|------------|-------------------------------|-----------------------------------|
| `artist:` | `artist:` | `artist:` |
| `album:` | `release:` | `releasegroup:` |
| `track:` | `recording:` | — |
| `song:` | `recording:` | — |

**Query Preprocessing:**
1. Detect field prefixes (`artist:`, `album:`, `track:`, `song:`)
2. Map to MusicBrainz field names based on endpoint
3. Pass everything else unchanged (quotes, AND/OR/NOT, parentheses, wildcards)

**Example Transformations:**
- `artist:"pink floyd"` → sent as-is to all endpoints
- `album:thriller` → `releasegroup:thriller` on release-groups, `release:thriller` on recordings
- `track:billie jean artist:michael` → `recording:billie jean artist:michael`
- `"dark side" AND moon` → sent as-is (Lucene handles it)

**No query validation** - if user enters invalid syntax, MusicBrainz returns an error, we show "no results" gracefully.

```javascript
const preprocessQuery = (query, endpoint) => {
  let processed = query;

  // Map album: to appropriate field
  if (endpoint === 'release-group') {
    processed = processed.replace(/\balbum:/gi, 'releasegroup:');
  } else if (endpoint === 'recording') {
    processed = processed.replace(/\balbum:/gi, 'release:');
  }

  // Map track:/song: to recording:
  processed = processed.replace(/\b(track|song):/gi, 'recording:');

  return processed;
};
```

## Implementation

### Files to Modify
- `app.js` - Main search logic, UI components, state management

### New Dependencies
- `fuse.js` - Lightweight fuzzy search library

### State Additions
```javascript
const [searchHistory, setSearchHistory] = useState([]);
const searchQueryRef = useRef('');
const abortControllerRef = useRef(null);
```

### New Functions
- `preprocessQuery(query, endpoint)` - Maps typed filters to MusicBrainz fields
- `reRankResults(results, query)` - Fuzzy + popularity scoring
- `saveSearchHistory(query, selectedResult)` - Persists to Electron store
- `loadSearchHistory()` - Reads from Electron store on mount
- `clearSearchHistory(entryId?)` - Clears one or all entries

### UI Additions
- Empty search state showing recent searches with clicked results
- Click handlers to re-run search or navigate to result directly
- Clear button(s) for history management

## Task Breakdown

1. **Fix typeahead race condition**
   - Add `AbortController` to cancel stale requests
   - Add `searchQueryRef` to track current query
   - Verify query matches before setting results

2. **Add fuzzy re-ranking**
   - Install `fuse.js`
   - Implement `reRankResults()` function
   - Apply to artists, albums, and tracks after fetch

3. **Implement search history**
   - Add Electron store integration for `searchHistory`
   - Create `saveSearchHistory()` called on result click
   - Create `loadSearchHistory()` called on mount
   - Build empty search page UI with history display
   - Add clear functionality

4. **Add Lucene query support**
   - Implement `preprocessQuery()` with field mapping
   - Update `performSearch()` to preprocess before fetch
   - Test with quotes, operators, and field prefixes

5. **Testing & polish**
   - Test rapid typing/backspacing scenarios
   - Test various Lucene query combinations
   - Verify history persistence across app restarts
