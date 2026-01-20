# Search Full-Page Implementation Design

## Overview

Replace the current search drawer with a full-page search view. Users click "SEARCH" in the sidebar to navigate to a dedicated search page with a large input field and horizontally-scrolling result categories.

## Navigation

**Route:** Add `search` as a view in the `activeView` system.

**Entry:** Clicking "SEARCH" in sidebar calls `navigateTo('search')`.

**Exit:**
- "Close ×" button → `navigateBack()` to return to previous page
- Clicking any sidebar nav item → navigates away (clears search state)
- Clicking a result → navigates to artist/album/playlist (clears search state)
- Escape key → `navigateBack()`

**State cleanup:** Clear `searchQuery`, `searchResults`, `isSearching`, and `displayLimits` when `activeView` changes away from `search`.

**Remove:** `searchDrawerOpen` state (no longer needed).

## Layout

```
┌─────────────────────────────────────────────────────┐
│  SEARCH          [CLOSE ×]                          │  Header row
├─────────────────────────────────────────────────────┤
│  [Large search input with query text]               │  Auto-focus
├─────────────────────────────────────────────────────┤
│  ARTISTS                                            │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ →  [Show more] │  Horizontal scroll
├─────────────────────────────────────────────────────┤
│  TRACKS                                             │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ →              │
├─────────────────────────────────────────────────────┤
│  ALBUMS                                             │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ →  [Show more] │
├─────────────────────────────────────────────────────┤
│  PLAYLISTS                                          │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ →              │
└─────────────────────────────────────────────────────┘
```

- Page scrolls vertically
- Each category row scrolls horizontally independently
- Category order: Artists → Tracks → Albums → Playlists

## States

### Initial (before typing)
- Show header with "SEARCH" title and "CLOSE ×" button
- Empty large input with blinking cursor, auto-focused
- Skeleton loaders in all four category sections (pulsing gray placeholders)

### Loading (during search)
- Input remains editable with current query
- Skeleton loaders in category sections

### Results loaded
- Replace skeletons with actual result cards
- Hide category section entirely if no results for that category
- "Show more" link if more results available

### No results
- Show "No results found" message below input
- Hide all category sections

## Search Input

- Large text (~48px) using app's existing typography
- Auto-focus on mount
- Debounced search: 400ms delay
- Minimum 2 characters to trigger search

## Card Styling

Adapt existing drawer result styling to fixed-width horizontal cards (~180-200px).

**Artists:**
- Name and disambiguation text (if available)
- Click → navigate to artist page

**Tracks:**
- Reuse `TrackRow` styling: album art thumbnail, title, artist, resolver badges
- Click → resolve and play track

**Albums:**
- Thumbnail art, title, artist name, year
- Click → navigate to release page

**Playlists:**
- Title and track count
- Click → navigate to playlist view

**Hover:** Existing patterns (`hover:bg-gray-100`)

## Implementation Changes

### State
- Remove: `searchDrawerOpen`
- Keep: `searchQuery`, `searchResults`, `isSearching`, `searchTimeoutRef`, `displayLimits`
- Add: Clear search state in `navigateTo()` when leaving search view

### Sidebar
- Change "SEARCH" click handler from opening drawer to `navigateTo('search')`
- Remove search input from sidebar (search happens on the full page now)

### Main content area
- Add `activeView === 'search'` case to render the search page component
- Remove the search drawer overlay/backdrop code

### Search page component
- Header with title and close button
- Large input field
- Four category sections with horizontal scroll
- Skeleton loaders for initial/loading states
- Result cards adapted from existing styling
