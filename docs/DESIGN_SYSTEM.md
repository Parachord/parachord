# Parachord Design System

Reference guide for the visual design language, tokens, components, and patterns used across the Parachord desktop application.

## Overview

Parachord is an Electron-based music player built with React (via `React.createElement`, no JSX), Tailwind CSS v3, and CSS custom properties for theming. The UI supports light and dark modes, toggled via the `.dark` class on the root element (`darkMode: 'class'`).

**Tech stack:**
- **Framework:** React 18 (production UMD build, no build step/JSX)
- **Styling:** Tailwind CSS 3.4 + CSS custom properties + inline styles
- **Icons:** Lucide React with emoji fallbacks
- **Virtualization:** TanStack Virtual (for queue list)
- **Search:** Fuse.js (fuzzy re-ranking)

---

## Design Tokens

All design tokens are defined as CSS custom properties on `:root` (light) and `.dark` (dark) in `index.html`. Components reference these tokens for theme-consistent styling.

### Colors

#### Backgrounds

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--bg-primary` | `#ffffff` | `#161616` | Main content area |
| `--bg-secondary` | `#f9fafb` | `#1e1e1e` | Secondary surfaces |
| `--bg-elevated` | `#ffffff` | `#252525` | Elevated cards, modals |
| `--bg-inset` | `#f3f4f6` | `#1a1a1a` | Recessed/inset areas |
| `--bg-tertiary` | `#fafafa` | `#1e1e1e` | Tertiary backgrounds |

#### Text

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--text-primary` | `#111827` | `#f3f4f6` | Headings, primary content |
| `--text-secondary` | `#6b7280` | `#9ca3af` | Secondary labels, metadata |
| `--text-tertiary` | `#9ca3af` | `#6b7280` | Placeholders, hints |

#### Accent (Purple)

The primary accent color is **purple**, shifting slightly between themes for contrast.

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--accent-primary` | `#7c3aed` | `#a78bfa` | Primary actions, links |
| `--accent-primary-hover` | `#6d28d9` | `#8b5cf6` | Hover state |
| `--accent-secondary` | `#8b5cf6` | `#c4b5fd` | Secondary accent |
| `--accent-tertiary` | `#a855f7` | `#a855f7` | Tertiary accent |
| `--accent-soft` | `#a78bfa` | `#c4b5fd` | Soft/muted accent |
| `--accent-surface` | `#ede9fe` | `rgba(139,92,246,0.15)` | Accent-tinted surface |

Alpha variants exist at 6%, 8%, 10%, 15%, 20%, 30%, 50%, and 60% opacity as `--accent-primary-alpha-{N}`.

#### Semantic Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--success` | `#10b981` | Resolved states, positive indicators |
| `--warning` | `#f59e0b` | Warnings, unresolved states |
| `--error` | `#ef4444` | Errors, destructive actions |

#### Borders

| Token | Light | Dark |
|-------|-------|------|
| `--border-default` | `#e5e7eb` | `#2e2e2e` |
| `--border-light` | `#f3f4f6` | `#252525` |
| `--border-subtle` | `rgba(0,0,0,0.06)` | `rgba(255,255,255,0.06)` |

#### Resolver / Service Colors

Each music service has a branded color used in badges and icons:

| Service | Text Class | Badge Color | Icon Hex |
|---------|-----------|-------------|----------|
| Spotify | `text-green-400` | `bg-green-600/20` | `#1DB954` |
| YouTube | `text-red-400` | `bg-red-600/20` | `#FF0000` |
| Bandcamp | `text-cyan-400` | `bg-cyan-600/20` | `#1DA0C3` |
| Qobuz | `text-blue-400` | `bg-blue-600/20` | `#4285F4` |
| SoundCloud | `text-orange-400` | `bg-orange-600/20` | `#FF5500` |
| Local Files | `text-purple-400` | — | — |

### Shadows

| Token | Light | Dark |
|-------|-------|------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | `0 1px 2px rgba(0,0,0,0.3)` |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.07)` | `0 4px 6px rgba(0,0,0,0.4)` |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)` | `0 10px 15px rgba(0,0,0,0.5)` |
| `--card-shadow` | `0 1px 3px rgba(0,0,0,0.05), 0 4px 12px rgba(0,0,0,0.03)` | `0 1px 3px rgba(0,0,0,0.2), 0 4px 12px rgba(0,0,0,0.15)` |

### Typography

| Token | Value | Usage |
|-------|-------|-------|
| `--font-sans` | `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif` | All UI text |
| `--font-mono` | `ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace` | Code, technical values |

**Line height scale:**

| Token | Value | Usage |
|-------|-------|-------|
| `--leading-tight` | `1.2` | Headings |
| `--leading-normal` | `1.4` | Default |
| `--leading-body` | `1.5` | Body text |
| `--leading-relaxed` | `1.6` | Readable paragraphs |

**Letter spacing scale:**

| Token | Value | Usage |
|-------|-------|-------|
| `--tracking-tight` | `0.005em` | Tight headings |
| `--tracking-normal` | `0.02em` | Default |
| `--tracking-wide` | `0.05em` | Slightly spaced |
| `--tracking-caps` | `0.08em` | Uppercase labels |
| `--tracking-display` | `0.2em` | Display text |
| `--tracking-display-wide` | `0.3em` | Wide display |

### Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | `4px` | Small elements, badges |
| `--radius-md` | `6px` | Buttons, inputs |
| `--radius-lg` | `8px` | Cards |
| `--radius-xl` | `10px` | Larger cards |
| `--radius-2xl` | `12px` | Panels |
| `--radius-pill` | `16px` | Pill shapes |
| `--radius-full` | `9999px` | Circles, full-round |

### Z-Index Scale

| Token | Value | Usage |
|-------|-------|-------|
| `--z-base` | `0` | Default layer |
| `--z-raised` | `10` | Raised cards |
| `--z-dropdown` | `20` | Dropdown menus |
| `--z-sticky` | `30` | Sticky headers |
| `--z-overlay` | `40` | Overlays |
| `--z-modal` | `50` | Modals |
| `--z-popover` | `9999` | Popovers |
| `--z-toast` | `99999` | Toast notifications |

### Transitions

| Token | Value | Usage |
|-------|-------|-------|
| `--duration-fast` | `100ms` | Micro-interactions |
| `--duration-base` | `150ms` | Standard transitions |
| `--duration-slow` | `300ms` | Panel animations |
| `--ease-default` | `ease` | General purpose |
| `--ease-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | Elements entering |
| `--ease-spring` | `cubic-bezier(0.16, 1, 0.3, 1)` | Bouncy/spring motion |

---

## Always-Dark Surfaces

Certain UI elements (player bar, queue drawer, AI chat panels) remain dark regardless of the active theme. These use dedicated surface tokens:

| Token | Light | Dark |
|-------|-------|------|
| `--surface-dark` | `rgba(31,41,55,0.95)` | `rgba(22,22,22,0.95)` |
| `--surface-dark-solid` | `rgba(17,24,39,0.98)` | `rgba(22,22,22,0.98)` |
| `--surface-dark-border` | `#374151` | `rgba(255,255,255,0.06)` |

---

## Tailwind Configuration

Defined in `tailwind.config.js`. The config extends the default Tailwind palette with custom teal shades:

```js
colors: {
  teal: {
    100: '#d1fcf4',
    400: '#36dcc8',
    500: '#10c9b4',
    600: '#0eb3a0',
  }
}
```

Dark mode is applied via `darkMode: 'class'`. The generated CSS is output to `vendor/tailwind.css`.

Additionally, `index.html` contains overrides that map standard Tailwind classes (e.g., `.dark .text-gray-900`, `.dark .bg-white`) to CSS custom property values, ensuring dark mode consistency even when components use hardcoded Tailwind classes.

---

## Components

All components are defined in `app.js` using `React.createElement()` (no JSX). Key reusable components:

### Tooltip

```
Tooltip({ children, content, position, variant, className })
```

- **Props:** `position` = `'top'` | `'bottom'` | `'left'` | `'right'` | `'top-end'`; `variant` = `'light'` | `'dark'`
- **Behavior:** CSS-only hover reveal with fade + translate animation (150ms ease)
- **Bio variant:** `.tooltip-bio` allows text wrapping with `max-width: 480px`

### FixedTooltip

```
FixedTooltip({ children, content })
```

- Uses `position: fixed` + `ReactDOM.createPortal` to escape `overflow: hidden` containers (e.g., sidebar)
- Positioned below the trigger element

### TrackRow

```
TrackRow({ track, isPlaying, handlePlay, onArtistClick, onContextMenu, allResolvers, resolverOrder, activeResolvers })
```

- `React.memo` wrapped for performance
- Displays track title, artist, duration, and resolver source badges
- Shows resolver priority indicators with branded colors

### VirtualizedQueueList

```
VirtualizedQueueList({ ... })
```

- `React.memo` wrapped
- Uses TanStack Virtual for efficient rendering of large queues
- Always rendered on a dark surface

### ResolverCard

```
ResolverCard({ ... })
```

- `React.memo` wrapped
- Settings card for configuring individual music resolvers
- Includes toggle, status indicator, and priority drag handle

### ScrobblerSettingsCard

```
ScrobblerSettingsCard({ scrobbler, config, onConfigChange })
```

- `React.memo` wrapped
- Configuration card for scrobbling services (Last.fm, ListenBrainz, Libre.fm)

### ReleaseCard

```
ReleaseCard({ release, currentArtist, fetchReleaseData, onContextMenu, onHoverFetch, isVisible, animationDelay, ... })
```

- Album/single/EP card with cover art, title, year, and release type badge
- Hover effect: `translateY(-6px)` lift with enhanced shadow
- Active state: `translateY(-2px)` with reduced shadow
- Entry animation: `cardFadeUp` with staggered delays

### Artist Cards

- **`RelatedArtistCard`** — Related artist display on artist pages
- **`SearchArtistCard`** — Artist cards in search results (responsive width via `itemWidth` prop)
- **`CollectionArtistCard`** — Artist cards in the library/collection view
- **`CollectionAlbumCard`** — Album cards in the library/collection view

### FriendMiniPlaybar

```
FriendMiniPlaybar({ track, getAlbumArt, onPlay, onContextMenu })
```

- Compact playbar showing what a friend is currently listening to

### ResolverIcon

```
ResolverIcon({ resolverId, size, fill })
```

- Renders the branded SVG icon for a given music service
- SoundCloud uses a PNG image; all others use inline SVGs

### ParachordWordmark

```
ParachordWordmark({ fill, height })
```

- SVG wordmark logo component for branding

### McpSettingsSection

- Settings panel for MCP (Model Context Protocol) server configuration

---

## Icons

### Primary Icon Set

The app uses **Lucide React** icons as the primary icon set, with emoji fallbacks when Lucide is unavailable:

| Icon | Lucide | Fallback |
|------|--------|----------|
| Play | `lucideReact.Play` | `▶` |
| Pause | `lucideReact.Pause` | `⏸` |
| SkipForward | `lucideReact.SkipForward` | `⏭` |
| SkipBack | `lucideReact.SkipBack` | `⏮` |
| Volume2 | `lucideReact.Volume2` | `🔊` |
| Music | `lucideReact.Music` | `♫` |
| List | `lucideReact.List` | SVG (3 horizontal lines) |
| Users | `lucideReact.Users` | `👥` |
| Radio | `lucideReact.Radio` | `📻` |
| Heart | `lucideReact.Heart` | `♥` |
| Search | `lucideReact.Search` | `🔍` |
| Settings | `lucideReact.Settings` | `⚙` |
| Plus | `lucideReact.Plus` | `+` |
| X | `lucideReact.X` | `✕` |

### Service Logos

Inline SVG logos for music services are stored in the `SERVICE_LOGOS` object. Each service has a white SVG with standardized `w-16 h-16` sizing. Services include: Spotify, Bandcamp, Qobuz, YouTube, SoundCloud, Apple Music, Local Files, MusicBrainz, Last.fm, Libre.fm, ChatGPT, Claude, Gemini, Ollama, Wikipedia, Discogs, Bandsintown, Songkick, SeatGeek, and Ticketmaster.

### Custom Icons

- **`PlayTop10Icon`** — Play triangle with green "10" badge (for artist top tracks)
- **`QueueTop10Icon`** — Queue/list icon with green "10" badge

### App Icons

Located in `assets/icons/`:
- `icon.icns` (macOS), `icon.ico` (Windows), `icon-square.svg`
- PNG sizes: 16, 32, 48, 128, 256, 512, 1024
- `logo-wordmark-white.png` — White wordmark for dark backgrounds

---

## Animations

All animations are defined as `@keyframes` in `index.html`.

### Loading & Feedback

| Animation | Duration | Easing | Usage |
|-----------|----------|--------|-------|
| `spin` | 1s linear infinite | — | Spinner |
| `spin-reverse` | 1s linear infinite | — | Reverse spinner |
| `shimmer` | 1.5s ease-in-out infinite | — | Skeleton loading |
| `loadingFadeInUp` | 0.7s spring | `cubic-bezier(0.16,1,0.3,1)` | App loading wordmark |
| `loadingDotPulse` | 1.4s ease-in-out infinite | Staggered 0.15s | Loading dots |

### Queue Animations

| Animation | Duration | Usage |
|-----------|----------|-------|
| `queue-pulse` | 0.3s ease-out | Queue icon feedback |
| `badge-flash` | 0.3s ease-out | Queue count badge update |
| `queue-track-drop` | 0.3s ease-in | Track leaving queue (slides down, fades) |
| `queue-track-insert` | 1s ease-out | Track entering queue (slides in with purple glow) |

### Navigation & Layout

| Animation | Usage |
|-----------|-------|
| `slideInRight` | Sidebar opening (translateX 100% → 0) |
| `slideOutRight` | Sidebar closing (translateX 0 → 100%) |
| `cardFadeUp` | Card grid entry (0.4s, translateY 12px → 0 with fade) |
| `friendSlideIn` | Friend sidebar entry (0.3s, translateX -12px → 0) |
| `friendMoved` | Friend reorder feedback (0.4s, subtle scale + purple tint) |
| `friendStatusChange` | Friend status update (0.3s, vertical bounce) |

### Hover & Interactive

| Animation | Usage |
|-----------|-------|
| `onAirPulse` | Green pulsing glow for "on air" friends (2s infinite) |
| `marquee-scroll` | Scrolling text for truncated labels (8s linear, pauses on hover) |
| Release card hover | `translateY(-6px)` + enhanced shadow (0.25s ease-out) |

### Shimmer Classes

Three shimmer variants for skeleton loading states:

| Class | Usage |
|-------|-------|
| `.shimmer-light` | Default theme-aware shimmer |
| `.shimmer-strong` | Higher contrast shimmer |
| `.shimmer-on-dark` / `.shimmer-dark` | Always-dark surfaces (player bar, queue) |

---

## Layout & Navigation

### App Shell

The main layout is a single-page app with:
- **Title bar** (macOS only) — draggable region via `.drag` class
- **Left sidebar** — Navigation with icons, friend activity list
- **Main content area** — Scrollable, responsive width tracked via `mainContentWidth` state
- **Player bar** — Fixed bottom, always-dark surface
- **Results sidebar** — Slides in from right for AI results, search detail, etc.
- **Queue drawer** — Slides in from right, always-dark, virtualized track list

### Views (Routes)

Navigation is state-driven via `activeView`. Available views:

| View | Description |
|------|-------------|
| `home` | Dashboard with recommendations, weekly jams, new releases |
| `search` | Search results with category tabs and detail panels |
| `library` | Collection browser (tracks, albums, artists tabs) |
| `artist` | Artist detail page with discography, bio, related artists, concerts |
| `history` | Listening history (recent plays, top tracks) |
| `playlists` | Playlist list and management |
| `playlist-view` | Individual playlist detail |
| `settings` | App settings (resolvers, scrobblers, AI, plugins) |
| `recommendations` | AI-powered music recommendations |
| `discover` | Charts (Pop of the Tops) |
| `critics-picks` | Curated editor/critic selections |
| `new-releases` | Latest releases |
| `concerts` | Upcoming concerts |
| `friendHistory` | Friend's listening history |

Navigation history is maintained with `viewHistory` and `forwardHistory` arrays for back/forward navigation.

### Responsive Behavior

- Main content width is tracked via `ResizeObserver` on the content container
- Search results grid adjusts item count based on `searchContainerWidth`
- Artist cards accept `itemWidth` prop for responsive sizing
- No breakpoint-based responsive design (desktop Electron app)

---

## Scrollbars

Custom scrollbar styling for three contexts:

| Class | Width | Usage |
|-------|-------|-------|
| `.scrollable-content` | 12px | Main content areas (theme-aware) |
| `.scrollable-content-dark` | 12px | Always-dark surfaces (queue drawer) |
| `.chat-messages-scroll` | 6px | AI chat messages (slim, dark) |

All scrollbars use rounded thumbs (`border-radius: 10px` or `3px`) with transparent-to-subtle hover states.

---

## Focus & Accessibility

- **Keyboard focus:** `:focus-visible` shows a `2px solid var(--accent-primary)` outline with `2px` offset
- **Mouse focus:** `:focus:not(:focus-visible)` suppresses the outline
- **Filter pill focus:** `.filter-pill:focus-within` highlights the outer border, suppressing inner input outline
- **Text selection:** `.no-select` disables user selection in non-editable areas
- **Window dragging:** `.drag` / `.no-drag` control Electron's window drag regions

---

## Slider Controls

### Progress Slider (`.progress-slider`)

- Track: 4px height, `#4b5563`, rounded
- Thumb: 12px circle, `#3b82f6` (hover: `#60a5fa`, disabled: `#6b7280`)

### Volume Slider (`.volume-slider`)

- Same dimensions as progress slider
- Disabled state uses `.disabled` class modifier

---

## Patterns

### Artist Placeholder Patterns

When no artist image is available, `generateArtistPattern()` creates a deterministic gradient based on the artist's name hash. It selects from 15 curated color palettes and 6 gradient types (linear, radial, diagonal split, soft radial, corner, mesh). Each pattern includes derived initials and accent colors.

### Album Art Depth

`.album-art-container::after` adds an inner shadow overlay (`inset 0 0 0 1px rgba(0,0,0,0.06)`) for subtle depth on album artwork.

### Card Interaction

Release cards (`.release-card`) use CSS transitions for hover lift:
```css
transition: transform 0.25s ease-out, box-shadow 0.25s ease-out;
/* Hover: translateY(-6px) + enhanced shadow */
/* Active: translateY(-2px) + reduced shadow */
```

### Context Menus

Context menus are handled natively via Electron's `contextMenu` API (`window.electron.contextMenu.showTrackMenu`), not as React components.

### Tooltips

Two tooltip systems coexist:
1. **CSS tooltips** (`Tooltip` component) — Pure CSS hover-triggered, positioned relative to parent
2. **Portal tooltips** (`FixedTooltip` component) — `position: fixed` via React portal, escapes `overflow: hidden`

---

## Tailwind Custom Extensions

The Tailwind config (`tailwind.config.js`) is minimal, relying primarily on CSS custom properties for theming. The custom teal color scale is used specifically for the app's teal accents:

```
teal-100: #d1fcf4  (light tint)
teal-400: #36dcc8  (medium)
teal-500: #10c9b4  (primary)
teal-600: #0eb3a0  (dark)
```

Content sources scanned by Tailwind: `index.html`, `app.js`, `resolution-scheduler.js`, `musickit-web.js`, `resolver-loader.js`, `scrobbler-loader.js`.

---

## Release Type Badges

`.release-badge` styling for album type indicators:
- Font: 10px, weight 600, uppercase, `0.08em` letter spacing
- Padding: `3px 8px`, border radius `4px`

---

## Dark Mode Strategy

1. **Toggle mechanism:** `.dark` class on root element (Tailwind `darkMode: 'class'`)
2. **CSS custom properties:** All tokens have light/dark variants
3. **Tailwind overrides:** `index.html` maps `.dark .text-gray-*`, `.dark .bg-*`, `.dark .border-*`, etc. to CSS variable values
4. **Always-dark surfaces:** Player bar, queue drawer, and AI panels use `--surface-dark-*` tokens that remain dark in both themes
5. **Shimmer variants:** Separate shimmer gradients for theme-aware and always-dark contexts
