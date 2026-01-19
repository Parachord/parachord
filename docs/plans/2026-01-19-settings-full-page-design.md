# Settings Full Page Redesign

## Overview

Convert the existing settings modal into a full-page view with vertical tabs, matching the clean aesthetic of the Tomahawk "Connect" page reference.

## Layout Structure

```
┌─────────────────────────────────────────────────────┐
│  Main Sidebar  │  Settings Tabs  │  Content Area   │
│  (existing)    │  (new vertical) │  (tab content)  │
│                │                 │                 │
│  SEARCH        │  Installed      │  [Grid of       │
│  CHARTS        │  Resolvers      │   resolver      │
│  ...           │                 │   cards]        │
│                │  Marketplace    │                 │
│  COLLECTION    │                 │                 │
│  PLAYLISTS     │  General        │                 │
│  ...           │                 │                 │
│                │  About          │                 │
│                │                 │                 │
│  Settings ←────┼─────────────────┼─────────────────│
│  (active)      │                 │                 │
└─────────────────────────────────────────────────────┘
```

- Settings tabs column: ~180-200px wide
- Content area: Fills remaining space
- Navigation via existing back/forward buttons works naturally

## Tab Styling

- Clean vertical list of text labels (no icons)
- Font: Regular weight, gray text (`text-gray-600`)
- Active tab: Darker text (`text-gray-900`) with left border accent (`border-l-2 border-purple-600`)
- Hover state: Light background tint (`hover:bg-gray-50`)
- Padding: `py-3 px-4`

## Tab Order

1. Installed Resolvers
2. Marketplace
3. General (placeholder)
4. About (placeholder)

## Card Design (Tomahawk-style)

### Visual Style
- Square or near-square cards with solid color background
- Centered icon/logo inside the card
- Resolver name below the card in clean text
- Minimal metadata - just essentials
- No capability badge clusters on cards - keep it clean
- Generous whitespace between cards

### Installed Resolvers Tab
- Grid of resolver cards
- Enabled resolvers have subtle visual distinction
- Toggle/enable controls appear on hover or via interaction
- Drag-to-reorder with subtle visual feedback
- "Add from file" button top-right, simple styling

### Marketplace Tab
- Same card grid style
- Clean search bar at top
- Simple category filter
- Install state shown subtly (checkmark or "Installed" text)

## Placeholder Tabs

### General Tab
- Empty state: "General settings coming soon"
- Centered, light gray text

### About Tab
- Empty state: "About coming soon"
- Centered, light gray text

## State Changes

- Remove `showSettings` modal boolean
- Add `'settings'` as a navigation page/view
- Expand `settingsTab` to: `'installed' | 'marketplace' | 'general' | 'about'`

## What Changes

1. Remove settings modal entirely
2. Add full-page settings view when "Settings" clicked in sidebar
3. Settings page has vertical tab list
4. Redesign resolver cards to Tomahawk aesthetic
5. Update grid layout with more whitespace
6. Simplify UI by reducing badge clutter

## What Stays the Same

- All resolver functionality (enable/disable, reorder, install, marketplace)
- State management logic (adapted from modal to page)
- Main sidebar structure
- Back/forward navigation behavior
