# Parachord Design System

Reference guide for the visual design language, tokens, components, and patterns used across the Parachord desktop application.

> **Partly out of date (2026-11-13).** The [design audit](plans/2026-11-13-design-audit.md) compared this guide with the code. It found several points where they disagree:
> - tokens documented here that nothing uses (radius, tracking, leading, z-index, motion)
> - "no breakpoint-based responsive design" (20 grids use breakpoints)
> - the Recommendations heading style
> - the Bandcamp colour
> - the Tailwind scan path
> - animations listed as in use
> - the blue slider thumbs
>
> Until this guide is rewritten, the "Design system" section of [CLAUDE.md](../CLAUDE.md) and the audit win where they disagree. The design-drift ratchet (`tests/ci/design-drift.test.js`) enforces them.

## Overview

Parachord is an Electron-based music player built with React (via `React.createElement`, no JSX), Tailwind CSS v3, and CSS custom properties for theming. The UI supports light and dark modes, toggled via the `.dark` class on the root element (`darkMode: 'class'`).

**Tech stack:**
- **Framework:** React 18 (vendored production UMD build in `vendor/`, no JSX); `src/renderer/app.js` and its component modules are bundled by esbuild into the root `app.js` with no transforms
- **Styling:** Tailwind CSS 3.4 + CSS custom properties + inline styles
- **Icons:** inline SVGs, plus the small `Icons` fallback set in `src/renderer/components/icons.js` (Lucide React is not loaded; see [Icons](#icons))
- **Virtualization:** TanStack Virtual (for queue list)
- **Search:** Fuse.js (fuzzy re-ranking)

---

## Design Tokens

All design tokens are defined as CSS custom properties on `:root` (light) and `.dark` (dark) in `index.html`. Components reference these tokens for theme-consistent styling.

### Colors

Every colour has a light and a dark value, so both themes work by construction. In code, reach for them in this order:

1. **A theme-token Tailwind class** (`tailwind.config.js`, below): `text-ink-secondary`, `bg-surface-card`, `border-line`, `bg-accent-fill`.
2. **The CSS variable** in an inline style: `color: 'var(--text-secondary)'`.
3. **A new token** when nothing fits: add it to `:root` and `.dark` together in `index.html`, and to `tailwind.config.js` if classes will use it.

Never a hex value, a Tailwind palette class (`text-gray-500`, `bg-purple-600`, ...) or an `isDark` / `effectiveTheme` ternary. `tests/ci/design-drift.test.js` counts all three, and `themeTernaries` is 0. `:root` and `.dark` also set `color-scheme`, so native controls, scrollbars and background-less inputs follow the theme.

#### Backgrounds

| Token | Tailwind | Light | Dark | Usage |
|-------|----------|-------|------|-------|
| `--bg-primary` | `bg-surface-page`, `.page-bg` | `#ffffff` | `#161616` | A page's body |
| `--bg-elevated` | `bg-surface-card` | `#ffffff` | `#252525` | Cards, menus, modals |
| `--bg-secondary` | `bg-surface-subtle` | `#f9fafb` | `#1e1e1e` | Secondary surfaces |
| `--bg-inset` | `bg-surface-inset` | `#f3f4f6` | `#1a1a1a` | Recessed areas, neutral chips |
| `--hover-bg-default` | `bg-surface-hover` | `#f3f4f6` | `rgba(255,255,255,0.05)` | Row and item hover |
| `--placeholder-bg` | `bg-surface-placeholder` | `#e5e7eb` | `#383838` | Image placeholders, skeleton bars |

A page body is `--bg-primary` and the cards on it `--bg-elevated`, so in dark mode cards keep their edges. Never put a page body on `bg-white` (dark mode maps it to the card colour).

#### Text

| Token | Tailwind | Light | Dark | Usage |
|-------|----------|-------|------|-------|
| `--text-primary` | `text-ink-primary` | `#111827` | `#f3f4f6` | Headings, primary content |
| `--text-secondary` | `text-ink-secondary` | `#4b5563` | `#9ca3af` | Secondary labels, metadata |
| `--text-tertiary` | `text-ink-tertiary` | `#6b7280` | `#8b8f97` | Hints, counts, timestamps |
| `--icon-faint` | `text-ink-faint` | `#d1d5db` | `#4b5563` | Large decorative empty-state icons only |

Secondary and tertiary both pass 4.5:1 on the page and on cards in both themes, and stay distinct (`tests/ui/theme-tokens.test.js`). Map Tailwind greys as: gray-900/800 → primary, 700/600 → secondary, 500/400 → tertiary.

#### Accent (Purple)

| Token | Tailwind | Light | Dark | Usage |
|-------|----------|-------|------|-------|
| `--accent-primary` | `text-accent`, `ring-accent` | `#7c3aed` | `#a78bfa` | Accent text, icons, focus rings, slider `accent-color` |
| `--accent-fill` | `bg-accent-fill` | `#7c3aed` | `#7c3aed` | **Fills with white text on them** |
| `--accent-fill-hover` | `hover:bg-accent-fill-hover` | `#6d28d9` | `#6d28d9` | Their hover |
| `--on-accent` | `text-ink-on-accent` | `#ffffff` | `#ffffff` | Text on a fill |
| `--accent-primary-alpha-10` | `bg-accent-tint` | 10% | 10% | Selected and now-playing rows, accent chips |
| `--accent-primary-alpha-15` | `bg-accent-tint-hover` | 15% | 15% | Their hover |

**The fill-accent convention.** `--accent-primary` turns light purple in dark mode, where white text on it is 2.72:1. So a button, badge or switch track with white text uses `--accent-fill` / `--on-accent`, and `--accent-primary` is for accent-coloured text, icons and outlines. Other accent tokens (`--accent-secondary`, `--accent-soft`, `--accent-surface`, alpha variants at 6–60%) are in `index.html`.

#### Status

| Purpose | Tokens | Tailwind |
|---------|--------|----------|
| Status text on a page or card (≥ 4.5:1 in both themes) | `--text-success`, `--text-warning`, `--text-danger`, `--text-info` | `text-ink-success`, `text-ink-warning`, `text-ink-danger`, `text-ink-info` |
| A faint background behind status text (the colour at 12%) | — | `bg-tint-success`, `bg-tint-warning`, `bg-tint-danger`, `bg-tint-info` |
| Fills with white text: toasts, the Home banner, the confirm dialog's button | `--fill-success`, `--fill-warning`, `--fill-error`, `--fill-info` (the same in both themes, each ≥ 4.5:1 with white) | `bg-status-error`, `hover:bg-status-error-hover` |
| Dots, icons and indicators | `--success`, `--warning`, `--error`, `--info` | — |

`lib/home-banners.js` (`BANNER_SEVERITY_COLORS`) and `lib/toast-style.js` read the fill tokens; a severity is one colour wherever it shows.

#### Borders and controls

| Token | Tailwind | Light | Dark |
|-------|----------|-------|------|
| `--border-default` | `border-line` | `#e5e7eb` | `#2e2e2e` |
| `--border-light` | `border-line-light` | `#f3f4f6` | `#252525` |
| `--border-strong` | `border-line-strong` | `#d1d5db` | `#404040` |
| `--border-danger` | `border-line-danger` | `#fecaca` | red at 35% |
| `--border-subtle` | — | `rgba(0,0,0,0.06)` | `rgba(255,255,255,0.06)` |
| `--control-off` | `bg-control-off` | `#d1d5db` | `#707070` |
| `--control-knob` | `bg-control-knob` | `#ffffff` | `#ffffff` |

A switch is an `--accent-fill` track when on, `--control-off` when off, and always a white `--control-knob`.

#### Page colours

Each page has one colour, in `src/renderer/lib/page-colors.js` (`PAGE_COLORS`): the sidebar item's active text and 10% tint (`pageTint(view)`), the hero gradient, links to the page (`SectionHeader`'s `pageColor`), Home's panels that preview it, and the page's own controls (Concerts' location and radius). Each entry has `color`, `rgb`, `fill` (a darker shade for white-text buttons, ≥ 4.5:1) and `hero` (full Tailwind gradient classes, so Tailwind's scan generates them).

| Page | Colour | Hero |
|------|--------|------|
| Home | the accent | purple → violet → indigo |
| Playlists | `#ec4899` | rose → pink → fuchsia |
| Collection | `#06b6d4` | cyan → blue |
| History (and a friend's history) | `#3b82f6` | sky → blue → indigo |
| Fresh Drops | `#22c55e` | lime → green → emerald |
| Recommendations | `#f59e0b` | amber → orange |
| Charts | `#f97316` | orange → pink → purple |
| Critical Darlings | `#ef4444` | red → rose |
| Concerts | `#10c9b4` | teal → cyan |

No two heroes start in the same colour family (`tests/renderer/page-colors.test.js`). Never copy a page colour into a component; read the map.

#### Service colours

A music service's colour is its plug-in's `manifest.color` (`plugins-src/<id>/manifest.json`), exposed as `resolver.color` (`#888888` when a manifest has none). The track-list badges, the playbar's source button and "Play from" menu, Search's source dots and Home's source chips all read it. (`TrackRow` in `track-lists.js` still has its own `resolverMeta` table, but nothing renders `TrackRow` any more.) Concert ticket sellers' colours are in `src/renderer/lib/ticket-sellers.js`, equal to their plug-ins' manifest colours (tested); their text is the brand colour mixed 70% with `--text-primary`, so one value reads on both themes.

Inside a service's own plugin panel (its header, Connect, Save and sync buttons), the service's brand colour is used on purpose instead of the accent: a decision of 2026-11-14. Everywhere else, buttons are `Button`'s variants.

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
| `--surface-dark` | `rgba(31,41,55,0.95)` | `rgba(38,38,38,0.95)` |
| `--surface-dark-solid` | `rgba(17,24,39,0.98)` | `rgba(38,38,38,0.98)` |
| `--surface-dark-gradient-from` | `rgba(17,24,39,0.9)` | `rgba(38,38,38,0.95)` |
| `--surface-dark-gradient-to` | `rgba(17,24,39,0.5)` | `rgba(38,38,38,0.85)` |
| `--surface-dark-header` | `rgba(17,24,39,0.6)` | `rgba(42,42,42,0.95)` |
| `--surface-dark-border` | `#374151` | `rgba(255,255,255,0.1)` |

In dark mode these surfaces are lifted slightly above `--bg-primary` so they still read as separate panels (values from `index.html`).

---

## Tailwind Configuration

Defined in `tailwind.config.js`; the generated CSS is `vendor/tailwind.css` (rebuild with `npm run build:css` and commit it). Dark mode is `darkMode: 'class'`.

The config adds **theme-token colours**: each reads a CSS variable from `index.html`, so a class like `text-ink-secondary` is right in both themes with no dark override. The groups are `ink-*` (text), `surface-*` (backgrounds), `line-*` (borders), `accent-*`, `control-*`, `status-*` and `tint-*`; the tables above list them. It also extends `teal` with the Concerts shades.

`index.html` still has a few `.dark` overrides that remap Tailwind palette classes (`.dark .text-gray-500`, `.dark .bg-white`, ...) for code not yet converted, mostly the always-dark surfaces. Don't rely on them in new code. `tests/ui/theme-tokens.test.js` fails when a remap rule outlives its last user, so delete the rule with the last class.

---

## Components

Components use `React.createElement()` (no JSX). The reusable ones live in `src/renderer/components/`, required by `src/renderer/app.js`:

| Module | Exports |
|--------|---------|
| `ui-atoms.js` | `Tooltip`, `FixedTooltip`, `TooltipLayer`, `ResolverIcon`, `SERVICE_LOGO_PATHS`, `SERVICE_LOGO_IMAGES`, `SERVICE_LOGOS`, `ParachordWordmark`, `PlaybackProgress` |
| `icons.js` | `Icons` (the fallback icon set) |
| `track-lists.js` | `TrackRow`, `VirtualizedQueueList`, `VirtualizedTrackList`, `getBestSourceConfidence` |
| `cards.js` | `ReleaseCard`, `ReleasePage`, `RelatedArtistCard`, `SearchArtistCard`, `SearchHistoryItem`, `CollectionArtistCard`, `CollectionAlbumCard`, `PlayTop10Icon`, `QueueTop10Icon`, `generateArtistPattern` |
| `settings-cards.js` | `ResolverCard`, `McpSettingsSection`, `ScrobblerSettingsCard`, `FriendMiniPlaybar` |
| `home-page.js`, `collection-page.js`, `artist-page.js`, `playlist-view-page.js`, `search-page.js` | Whole pages (`HomePage`, `CollectionPage`, `ArtistPage`, `PlaylistViewPage`, `SearchPage`), each `React.memo`'d |

Everything else still renders inline in `src/renderer/app.js`. Key reusable components:

### Tooltip

```
Tooltip({ children, content, position, variant, className, id, delay })
data-tooltip="…"   (any control, through TooltipLayer)
```

One tooltip, two ways in (#1385 step 9):

- **`Tooltip`** wraps a trigger. **`data-tooltip`** goes on a control with no wrapper; `TooltipLayer`, mounted once at the app root, shows it. Controls never use a native `title` (it shows late, never on focus, and in the OS's look); `tests/renderer/tooltip-layer.test.js` fails on one.
- **Panel:** `.tooltip-panel` in `index.html`, portalled to `<body>` and `position: fixed`, so no `overflow: hidden` clips it. `variant: 'dark'` / `data-tooltip-variant="dark"` is the light tip for the always-dark surfaces; `.tooltip-bio` wraps long text.
- **Placement:** `position` = `'top'` (default) | `'top-end'` | `'bottom'` | `'bottom-start'` | `'left'` | `'right'` (`data-tooltip-position`). `placeTooltip` (pure) keeps it inside the window and flips it when its side has no room.
- **Behaviour:** shows on hover and on keyboard focus (focus-visible only for `data-tooltip`) after 400ms (`TOOLTIP_DELAY_MS`), stays while either lasts, and Escape or a scroll dismisses it (WCAG 1.4.13). A click hides a `data-tooltip` one.
- **Names:** a tooltip is a description, not a name. An icon-only control needs an `aria-label` too, usually the same words. A wrapped single element gets `aria-describedby` pointing at the tip while it shows.

### FixedTooltip

```
FixedTooltip({ children, content, id })
```

`Tooltip` preset for a card's explanation (Fresh Drops' "why", Recommendations' reason): `bottom-start`, wrapping (`.tooltip-note`), with a block trigger. `placeFixedTooltip` is `placeTooltip(…, 'bottom-start')`.

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

### Recommendation rows

The Recommendations page reuses Home's and the other tabs' pieces. Each section is one row under its heading (`text-lg font-semibold`); **"See all" / "Show less"** is Home's purple link (accent colour text, no button chrome, right-aligned on the heading's line); sections carry no item counts. Sources are filtered for the whole page in a **filter bar** under the hero, Fresh Drops' bar and pills: All, then one pill per source, no counts, one pick at a time, each pill with its own active colour as on the other tabs (All `#7c3aed`, a source its plugin's brand colour, Shuffleupagus `var(--accent-primary)`). Collapsed, a card section shows two full rows. Items carry no source badges.

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

- Renders the branded icon for a given music service
- SoundCloud and Subsonic use PNG images (`SERVICE_LOGO_IMAGES`); the others use inline SVG paths (`SERVICE_LOGO_PATHS`)

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

`src/renderer/components/icons.js` is the app's icon set: each icon is a component drawn with Lucide's paths (ISC licence), inlined so nothing has to load at runtime. Use it for every interface icon; don't paste an SVG `<path>` or use a text glyph (✕ × ✓ ⚠ ◌ …) as an icon. `tests/renderer/icons.test.js` fails on a glyph icon, and the design-drift `svgPaths` count tracks the pasted SVGs still to move.

```js
const Icons = require('./icons');            // in a component module
React.createElement(Icons.X, { className: 'w-4 h-4' })
React.createElement(Icons.Check, { size: 16, strokeWidth: 2.5 })
React.createElement(Icons.Spinner, { className: 'w-5 h-5', label: 'Loading' })
```

Props: `size` (default 24; a `w-*`/`h-*` class or `style` overrides it), `className`, `style`, `strokeWidth` (default 2), `fill`, and `title`. An icon is `aria-hidden` unless it has a `title`; an icon-only button carries the `aria-label`. The transport icons (Play, Pause, SkipBack, SkipForward) are solid; the rest are outlines. Inside text, size an icon to the text with `style: { width: '1em', height: '1em' }`.

**Sizes:** 16px (`w-4 h-4`) in rows, chips and inline with text; 20px (`w-5 h-5`) in buttons and dialogs; stroke 2.

**The set:** Play, Pause, SkipForward, SkipBack, Volume2, Music, List, Users, Radio, Heart, Search, Settings, Plus, X, Check, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Info, AlertTriangle, RefreshCw, ExternalLink, Trash2, and **Spinner** (the one loading spinner). To add an icon, copy its shapes from lucide.dev into `SHAPES` in `icons.js`.

### Service Logos

Large service logos are stored in the `SERVICE_LOGOS` object (`ui-atoms.js`), sized `w-16 h-16` and mostly white for coloured backgrounds. Services include: Spotify, Apple Music, Amazon Music, YouTube, Bandcamp, SoundCloud, Subsonic, Local Files, MusicBrainz, Last.fm, Libre.fm, ListenBrainz, ChatGPT, Claude, Gemini, Ollama, Shuffleupagus, Wikipedia, Discogs, Bandsintown, Songkick, SeatGeek, Ticketmaster and Achordion. SoundCloud and Subsonic are images; the rest are SVGs.

### Custom Icons

- **`PlayTop10Icon`** — Play triangle with green "10" badge (for artist top tracks)
- **`QueueTop10Icon`** — Queue/list icon with green "10" badge

### App Icons

Located in `assets/icons/`:
- `icon.icns` (macOS), `icon.ico` (Windows), `icon-square.svg`
- PNG sizes: 16, 32, 48, 128, 256, 512, 1024
- `linux/` — the same PNGs named `16x16.png` … `1024x1024.png`, the Linux package icon set (`build.linux.icon`); `scripts/generate-icons-from-svg.sh` refreshes it
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

A skeleton has the same box as the content it stands in for (grid, card size and padding, row columns, item count), so nothing moves when the content lands; a layout change updates its skeleton in the same PR. See "A layout change ships with its loading skeleton" in [architecture/renderer-patterns.md](architecture/renderer-patterns.md).

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
| `home` | Dashboard with recommendations, AI suggestions, new releases |
| `search` | Search results with category tabs and detail panels |
| `library` | Collection browser (tracks, albums, artists tabs) |
| `artist` | Artist detail page with discography, bio, related artists, concerts |
| `history` | Listening history (recent plays, top tracks) |
| `playlists` | Playlist list and management |
| `playlist-view` | Individual playlist detail |
| `settings` | App settings (resolvers, scrobblers, AI, plugins) |
| `recommendations` | A source filter bar, then five sections (Songs, Albums, Artists, Playlists, Listeners), each one row blending every provider's picks, weekly playlists first in Playlists |
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

One system: `Tooltip`, its `FixedTooltip` preset, and `data-tooltip` through `TooltipLayer` (see Tooltip above).

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
