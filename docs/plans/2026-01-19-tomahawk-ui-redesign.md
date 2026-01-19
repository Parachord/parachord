# Parachord UI Redesign - Tomahawk/Rdio Style

## Overview

Redesign Parachord's UI to match the Tomahawk design mockups, converting from the current dark theme to a light/white aesthetic inspired by Rdio.

## Scope

### 1. Remove Resolver Toggles from Sidebar
- Remove resolver enable/disable toggles (now controlled in Settings)
- Remove resolver status indicators from sidebar

### 2. Sidebar Redesign

**Layout (top to bottom):**
- Navigation arrows (back/forward) - back returns to previous view
- Search input
- DISCOVER section
  - Charts
  - New Releases
- YOUR MUSIC section
  - Collection (maps to current "My Library")
  - Playlists
  - Stations (placeholder)
  - History (placeholder)

**Styling:**
- Light gray/white background
- Clean typography with section headers in small caps/muted text
- Active item indicator (subtle highlight or left border)
- Minimal, text-focused navigation items

### 3. Playbar Redesign

**Layout (left to right):**
- **Left:** Transport controls (prev, play/pause, next) + queue button (hamburger icon)
- **Center:** Album art (small) + track metadata (title on line 1, artist + resolver on line 2)
- **Right:** Progress bar with current/total timestamps, shuffle button (placeholder), repeat button (placeholder), volume slider

**Styling:**
- Translucent/frosted glass effect (backdrop blur over content)
- Light theme colors
- Fixed at bottom of window

### 4. Playlists View Redesign

**Hero Header:**
- Large hero image area (placeholder for now, user will add high-quality photo later)
- "PLAYLISTS" title centered/overlaid
- Playlist count
- Action button (e.g., "Import Playlist")

**Playlist Grid:**
- Responsive grid of playlist cards
- Each card shows 2x2 mosaic of album artwork from first 4 tracks
- Playlist name and track count below mosaic

**Album Art Resolution:**
- Use existing album art when available
- Query Cover Art Archive API for tracks missing artwork
- Fall back to placeholder image if no match found

### 5. Overall Theme Conversion

Convert from dark theme to light theme:
- Background: white/light gray (`#f5f5f5` or similar)
- Text: dark gray/black
- Borders: light gray (`#e0e0e0` or similar)
- Accent colors: keep resolver colors for source indicators
- Cards: white with subtle shadows

## Technical Approach

All changes in `app.js` - update Tailwind classes:
- Replace `bg-slate-900`, `bg-black/*` with light equivalents
- Replace `text-white` with `text-gray-900` or similar
- Update border colors from `white/10` to light gray
- Add `backdrop-blur` for playbar translucency

## Out of Scope

- Social features (Friends, Inbox, Feed)
- Stations functionality (placeholder only)
- History functionality (placeholder only)
- Actual hero images (placeholder for now)

## Files to Modify

- `app.js` - Main React application (sidebar, playbar, playlists view, theme colors)
- `index.html` - May need CSS updates for scrollbar styling, etc.
