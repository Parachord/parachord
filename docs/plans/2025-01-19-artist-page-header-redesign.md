# Artist Page Header Redesign

## Overview

Redesign the artist page header to match Tomahawk's style with a collapsible hero, navigation tabs, and smooth scroll animations.

## Layout States

### Expanded (scroll = 0)
- Height: ~320px
- Background: Artist image with face-centered positioning
- Artist name: Centered, large (48px), ALL-CAPS, letter-spacing: 0.2em
- Navigation tabs: Centered below name - "Music | Biography | Related Artists"
- "Start Artist Station" button: Centered below tabs, coral/pink color (#E91E63)
- Back button: Top-left corner, semi-transparent

### Collapsed (scroll > 100px)
- Height: ~80px
- Background: Artist image (same, cropped by height)
- Artist name: Left-aligned, smaller (24px), ALL-CAPS
- Navigation tabs: Inline to right of name
- "Start Artist Station" button: Far right
- Back button: Same position

## Scroll Behavior

- CSS transitions on all animated properties (300ms ease)
- JavaScript scroll listener toggles `isHeaderCollapsed` state
- Header uses `position: sticky; top: 0`
- Content scrolls underneath

## New State Variables

```javascript
const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false);
const [artistPageTab, setArtistPageTab] = useState('music'); // music | biography | related
const [artistBio, setArtistBio] = useState(null);
const [relatedArtists, setRelatedArtists] = useState([]);
```

## Data Fetching

### Biography (Last.fm)
```javascript
const getArtistBio = async (artistName) => {
  const apiKey = '3b09ef20686c217dbd8e2e8e5da1ec7a';
  const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(artistName)}&api_key=${apiKey}&format=json`;
  // Returns: data.artist.bio.summary and data.artist.bio.content
};
```

### Related Artists (Last.fm)
```javascript
const getRelatedArtists = async (artistName) => {
  const apiKey = '3b09ef20686c217dbd8e2e8e5da1ec7a';
  const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getsimilar&artist=${encodeURIComponent(artistName)}&api_key=${apiKey}&format=json&limit=12`;
  // Returns: data.similarartists.artist[]
};
```

Fetch lazily when tabs are first clicked to avoid unnecessary API calls.

## Tab Content

### Music Tab
- Existing filter buttons: All | Albums | EPs | Singles
- Existing release grid (discography)
- No changes to functionality

### Biography Tab
- Full bio text from Last.fm `bio.content`
- Strip HTML tags, render as paragraphs
- "Read more on Last.fm" link
- Loading state while fetching

### Related Artists Tab
- Grid of artist cards (3-4 per row)
- Artist name (clickable to navigate)
- Artist image from Spotify (reuse getArtistImage)
- Match/similarity percentage
- Loading state while fetching

## Files to Modify

1. `app.js`:
   - Add new state variables
   - Add scroll listener for header collapse
   - Add `getArtistBio` and `getRelatedArtists` functions
   - Redesign artist page header with two states
   - Add tab navigation and content switching
   - Style with Tailwind classes + inline styles for transitions
