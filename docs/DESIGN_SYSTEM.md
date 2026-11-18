# Parachord Design System

Reference guide for the visual design language, tokens, components, and patterns used across the Parachord desktop application.

This guide matches the code as of the 2026-11-13 [design audit](plans/2026-11-13-design-audit.md) and its follow-up (#1382–#1391). The design-drift ratchet (`tests/ci/design-drift.test.js`) enforces the scales and tokens; CLAUDE.md's "Design system" section has the rules in short. A PR that changes a token, a scale or a shared component updates this guide.

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

**The accent is one colour: `--accent-base` (`#7c3aed`, violet-600).** Every other accent token in both themes, and the playbar's, is mixed from it with `color-mix(in srgb, …)`: darker with black for hover, lighter with white for dark mode and the playbar, with `transparent` for the alphas (mixed from `--accent-primary`, so they follow the theme). A different accent, a theme's or a user's, is that one value; never write a purple, or an `rgba()` of one, anywhere else (`tests/ui/theme-tokens.test.js` fails on an accent token that isn't mixed from the base, and checks contrast on the mixed values).

| Token | Tailwind | Light | Dark | Usage |
|-------|----------|-------|------|-------|
| `--accent-base` | — | `#7c3aed` | (same) | The one accent value; nothing reads it directly but the tokens below |
| `--accent-primary` | `text-accent`, `ring-accent` | the base | base 61% + white (≈ `#af87f4`) | Accent text, icons, focus rings, slider `accent-color` |
| `--accent-fill` | `bg-accent-fill` | the base | the base | **Fills with white text on them** |
| `--accent-fill-hover` | `hover:bg-accent-fill-hover` | base 90% + black | the same | Their hover |
| `--on-accent` | `text-ink-on-accent` | `#ffffff` | `#ffffff` | Text on a fill |
| `--accent-primary-alpha-10` | `bg-accent-tint` | 10% | 10% | Selected and now-playing rows, accent chips |
| `--accent-primary-alpha-15` | `bg-accent-tint-hover` | 15% | 15% | Their hover |

#### Status tints and photo shades

| Token | Usage |
|-------|-------|
| `--tint-success` / `-warning` / `-danger` / `-info` (`bg-tint-*`) | A status note's faint background: its status text colour at 12% (`--tint-danger-hover` 20%), so it follows the theme |
| `--border-success` / `-warning` / `-info` | Its border: the status text colour at 30% (`--border-danger` is its own pair) |
| `--photo-shade` / `-bar` / `-empty` | The darkening over an artist photo in a hero, the collapsed 80px bar, and no photo (same in both themes) |

Never write a colour as `rgba(…)` in the renderer: the drift script's `rgbColors` (coloured) and `rgbNeutrals` (black, white, grey) both count them, and both are 0.

#### Neutral roles (same in both themes)

| Token | Usage |
|-------|-------|
| `--on-art-ink` | Near-black text on art or a bright fill (`readableTextOn` picks it or `--on-accent`); the same in both themes |
| `--on-color-secondary` / `-fill` / `-border` / `-chip` | White on a coloured header or tile: secondary text, a pill's fill, a border, a corner chip |
| `--on-dark-faint` / `-line` / `-border` / `-hover` / `-fill` / `-inset` | The always-dark panels: a faint fill, a divider, a border, a hover, a stronger fill, a darker well |
| `--scrim-soft` / `--scrim` / `--scrim-strong` | Darkening over content (a busy tile, a backdrop, art) at 40 / 50 / 80% |
| `--cover-shade`, `--shimmer-on-dark` | The playlist cover's shade; a loading shimmer on a dark panel |
| `--shadow-xs` / `-tile` / `-popover` / `-panel` / `-dialog` / `-dialog-dark` / `-drawer` | Shadows by role, with `--shadow-sm/md/lg` and `--card-shadow` |
| `--hero-text-shadow` / `-bar` / `-line`, `--photo-text-shadow`, `--text-shadow-soft`, `--icon-shadow` | Text and icons over a hero, a photo or art |

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

The values are CSS variables in `index.html`: `--page-<id>` (text, icons, the tint), `--page-<id>-fill` (a white-text fill, at least 4.5:1) and `--page-<id>-hero` (the hero gradient, painted by the `.page-hero-bg-<id>` class that `PAGE_COLORS[id].hero` names). A theme or a user recolours a page by setting those. Home's are the accent's, and its hero gradient is mixed from `--accent-base`, so it follows the accent. `pageTint(view)` is the page colour at 10% (`color-mix`).

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

A music service's colour is its plug-in's `manifest.color` (`plugins-src/<id>/manifest.json`), exposed as `resolver.color` (`#888888`, the loader's no-colour marker, when a manifest has none; `NO_PLUGIN_COLOR`, exported by `components/brand-logos.js`, tests for it). Every surface reads it from the plug-in registry, never a copy: the track rows' source buttons, the playbar's source button and "Play from" menu, Search's source dots, Home's source chips, the Sync menu's tiles and the sync dialog (`syncProviderConfig`, which reads the loader so meta-services like ListenBrainz count), and the concert ticket sellers (`lib/ticket-sellers.js` gets a lookup from app.js via `setSellerColorLookup`; the fallback is the Concerts page colour). A seller's text is its colour mixed 70% with `--text-primary`, so one value reads on both themes. Brand colours that aren't a plug-in's (Chrome's logo, Raycast's orange) are in `components/brand-logos.js`.

Inside a service's own plugin panel (its header, Connect, Save and sync buttons), the service's brand colour is used on purpose instead of the accent: a decision of 2026-11-14. Everywhere else, buttons are `Button`'s variants.

### Shadows

| Token | Light | Dark |
|-------|-------|------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | `0 1px 2px rgba(0,0,0,0.3)` |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.07)` | `0 4px 6px rgba(0,0,0,0.4)` |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)` | `0 10px 15px rgba(0,0,0,0.5)` |
| `--card-shadow` | `0 1px 3px rgba(0,0,0,0.05), 0 4px 12px rgba(0,0,0,0.03)` | `0 1px 3px rgba(0,0,0,0.2), 0 4px 12px rgba(0,0,0,0.15)` |

Shadows by role, the same in both themes: `--shadow-xs` (a small chip), `--shadow-tile` (a Settings tile), `--shadow-popover` (a menu or dropdown), `--shadow-panel` (a dialog panel, a toast), `--shadow-dialog` / `--shadow-dialog-dark` (a large dialog, on a light or a dark surface), `--shadow-drawer` (the AI panel's edge). Never write a shadow's `rgba()` in the renderer: `rgbNeutrals` counts it.

### Typography

| Token | Value | Usage |
|-------|-------|-------|
| `--font-sans` | `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif` | All UI text |
| `--font-mono` | `ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace` | Code, technical values |

**Type, radius and motion are scales, not tokens.** The unused `--leading-*`, `--tracking-*`, `--radius-*`, `--duration-*` and `--ease-*` tokens were deleted in the design audit (#1383); the scales below are what `scripts/design-drift.js` enforces (CLAUDE.md "Design system"):

- **Type:** 11 · 12 · 13 · 14 · 16 · 20 · 24 · 28 · 48px; weights as numbers.
- **Radius:** 4 · 6 · 8 · 10 · 12 · 16px · full.
- **Spacing:** the 4px scale; 10px only for card padding.
- **Motion:** 100–400ms on transform and opacity; never `transition-all` on list rows. `prefers-reduced-motion` turns it off (spinners excepted).

### Z-Index

| Token | Value | Usage |
|-------|-------|-------|
| `--z-scroll-edge` | `15` | The scroll-edge shadow (`.scroll-edge`): above the content and sticky bars (10), below dropdowns, so it never paints over an open menu |
| `--z-dropdown` | `20` | Sort menus and other in-page dropdowns |
| `--z-popover` | `9999` | `Menu` (context and "More" menus), above the playbar |
| `--z-toast` | `99999` | Toasts, above dialogs |

Dialogs sit at `z-[60]`. Inside a card, `CardButton`'s stretched button is at 1, card actions at 2 and the reason badge at 3.

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

What sits on them uses the `--on-dark-*` tokens, the same in both themes, never the page tokens (`--text-secondary` is 2.2:1 there) or palette classes. As Tailwind colours they are `text-on-dark-*` and `bg-surface-dark-placeholder` (`tailwind.config.js`).

| Token | Value | For |
|-------|-------|-----|
| `--on-dark-primary` / `-secondary` / `-tertiary` | white at 0.95 / 0.7 / 0.55 | Text and icons: titles and active controls / idle controls and labels / hints |
| `--on-dark-disabled` | white at 0.3 | A control that can't be used now |
| `--on-dark-track` / `--on-dark-track-disabled` | white at 0.2 / 0.1 | A slider's track (the playbar's scrubber and volume) |
| `--surface-dark-placeholder` | white at 0.1 | An art or text placeholder before the track loads |
| `--on-dark-fill-muted` | white at 0.25 | A muted fill behind white text (the queue badge in Spinoff) |
| `--on-dark-love` / `-love-hover` | `#f87171` / `#fca5a5` | The playbar's heart when the track is in the Collection |
| `--on-dark-success` | `#4ade80` | Buy on hover |
| `--on-dark-info` | `#a5b4fc` | The "playing in the browser" pill |
| `--playbar-accent` / `-hover` | `#a78bfa` / `#c4b5fd` | Slider handles, and Shuffle, Repeat and Spinoff when on (the dark-mode accent, in both themes) |

---

## Tailwind Configuration

Defined in `tailwind.config.js`; the generated CSS is `vendor/tailwind.css` (rebuild with `npm run build:css` and commit it). Dark mode is `darkMode: 'class'`.

The config adds **theme-token colours**: each reads a CSS variable from `index.html`, so a class like `text-ink-secondary` is right in both themes with no dark override. The groups are `ink-*` (text), `surface-*` (backgrounds), `line-*` (borders), `accent-*`, `control-*`, `status-*` and `tint-*`; the tables above list them. It also extends `teal` with the Concerts shades.

`index.html` still has a few `.dark` overrides that remap Tailwind palette classes (`.dark .text-gray-500`, `.dark .bg-white`, ...) for code not yet converted, mostly the always-dark surfaces. Don't rely on them in new code. `tests/ui/theme-tokens.test.js` fails when a remap rule outlives its last user, so delete the rule with the last class.

---

## Components

Components use `React.createElement()` (no JSX) and live in `src/renderer/components/`, required by `src/renderer/app.js`. **Reuse before you build:** before writing any UI element, find the shared one below. A second copy of something that exists gets extracted into a shared component first, and a page never restyles a shared component's output (CLAUDE.md "Design system"). Each one also has a "comes from" line in [architecture/renderer-patterns.md](architecture/renderer-patterns.md).

### Which component, when

| You need | Use | Module | Notes |
|----------|-----|--------|-------|
| A button | `Button` | `button.js` | `variant`: primary (one per view), secondary, destructive, quietDestructive (red text on a secondary button, for a rare destructive action that opens a confirmation), text, icon (needs `aria-label`); `size` sm/md; `busy`; `tone: 'dark'` on the always-dark surfaces; `pageColor` for a hero's fill |
| A page or drawer header's Close / Edit / Save / Cancel | `HeaderControl` | `header-control.js` | The shared `Button`, small and sentence case; `close` is an icon-only ✕ with its label as name and tooltip; tones default / primary / dark |
| How far along something is | `ProgressBar` | `progress-bar.js` | `value`, `max`, `color` (a service's, else the accent), `label` for screen readers |
| A dialog | `Modal` | `modal.js` | Focus moves in and comes back, Escape and the scrim close it, one title size and three widths. `ConfirmModal` for confirm/cancel (the confirm button named for its action, `destructive` for red); `DontShowAgain` for the checkbox |
| A panel that slides out beside the sidebar (Add to playlist) | `SidePanel` | `modal.js` | `Modal`'s focus handling and labelling; Escape goes to an inner field first; its scrim can leave the sidebar uncovered |
| A success, info or error message | `showToast(message, type, action, options)` | `toast.js` (`ToastRegion`) | Success is a toast, never a dialog |
| A menu at the pointer whose actions run in the page (the header's Copy link) | `ContextMenu` | `menu.js` | `Menu`'s panel, keys and look at `{ x, y }`, kept inside the window |
| A menu (right-click or "More") | `Menu`, items from `lib/item-menus.js` | `menu.js` | Portalled, keyboard and typeahead, flips up near the bottom; the dark 12px look. An item's `toggle` puts an on/off switch (a `menuitemcheckbox`) beside it |
| A sort control | `SortMenu` | `sort-menu.js` | |
| A clickable card or row | `CardButton` | `card-button.js` | A stretched `<button>` under the card; inner buttons sit above it; `onContextMenu` also opens on Shift+F10 / the Menu key; `tooltip` for a whole-card note. Use the cards and `TrackRow` below first; `CardButton` is what they are built on |
| An album card (any grid of albums, or a track shown as a card) | `AlbumCard` (`AlbumRankBadge` for a rank) | `album-card.js` | The inset card: `HOME_CARD_BOX`, rounded art, title, artist (or `onOpenArtist` for a link), `subtitle`. `releaseType` badge, `reason` badge, `cornerBadge`; `onHoverPrefetch` dwells 250ms; `getAlbumArt` to look up its own cover; `label` when a click doesn't open; `hidden` for a card a filter hides but keeps mounted (a class can't hide it: the card sets its display inline) |
| A playlist card | `PlaylistCard` | `playlist-card.js` | The playlist's own cover (`coverArt`) over the mosaic of its tracks' covers, or the playlist glyph; `titleBadge` (Shared), `badge`, `cornerBadges` (Hosted, AI); a saved playlist's actions from `playlistCardActions` in app.js |
| An artist card | `ArtistCard` (`RankBadge` for a rank) | `artist-card.js` | Play on hover (the top tracks), queue in the artist menu |
| A person (friend, recommended listener) | `ListenerCard` | `listener-card.js` | The hexagon avatar (`LISTENER_HEXAGON`); user avatars are always hexagons |
| A friend's avatar (sidebar, profile hero) | `FriendAvatar` | `friend-avatar.js` | The hexagon: their photo, or the initial on `--avatar-gradient`, also when the photo fails |
| A concert's Tickets (Concerts page, Home's concert cards, an artist's On tour) | `TicketsButton` | `tickets-button.js` | The primary button in the Concerts hero's teal (`PAGE_COLORS.concerts.color`) with white text; one seller is a link, several open `Menu` with a link per seller |
| A plug-in's logo on its colour, in small (Home's setup tiles, the welcome tour) | `ServiceMark` | `home-getting-started.js` | The `SERVICE_LOGOS` mark on the plug-in's `color`, 36px with an 8px radius: the Plug-Ins tile in small |
| A section of a plug-in's settings that only some plug-ins have (the app's own sign-in, client keys, a username account, Advanced keys, library sync, open at startup, an install note, watch folders) | `ServiceAccount`, `ClientKeys`, `UsernameAccount`, `AdvancedKeys`, `LibrarySync`, `StartupRow`, `InstallCallout`, `WatchFolders` | `plugin-extras.js` | Each chosen by a capability or manifest field (docs/architecture/plugins.md "Settings"), never by the plug-in's id, and drawn from `AccountRow`, `Disclosure`, `SettingRow` and the fields; the host's account state is `hostAccounts[id]` from app.js. `AdvancedKeys`' line is the manifest's hint, or the host's `notice` (`advancedNotice`, warning colour) while something is wrong with the saved keys |
| Home's first-run setup (three steps, in place of Home's sections) | `GettingStarted`, `GettingStartedSkeleton` | `home-getting-started.js` | One card: `ListRow` step headers, `OptionTile` choices, `Badge` for Connected; step 1's tiles from the plug-in registry |
| Parachord's own app icon in a picture of the app | `ParachordAppIcon` | `brand-logos.js` | The Dock icon (`assets/icons/icon128.png`), decorative |
| Starting Collection Radio (Home's greeting, the Collection hero and its collapsed header) | `CollectionRadioButton` | `collection-radio-button.js` | The accent fill with a round Play mark; `compact` for a collapsed header |
| A link to a page in the sidebar, or a section in Settings (`NavSearch`: the sidebar's Search box) | `NavItem` | `nav-item.js` | The page's colour and tint when current (`aria-current`), a hover tint otherwise; `unread` dot and `count` badge |
| A choice shown as a bordered tile (a title and a line under it) | `OptionTile` | `option-tile.js` | `tone: 'danger'` for the destructive choice; `compact` for the album page's edition card |
| A row in a list you pick from (suggestions, Add to playlist) | `ListRow` | `list-row.js` | `size`, `divider`, `state`: `added` / `drop` / `current` |
| A cover's hover actions (Add to playlist, Play, Add to queue) | `ArtOverlay` + `useReveal` | `card-art.js` | Shown on hover and keyboard focus. Without `shown`, CSS reveals it (`.card-actions`) for a card drawn in a list. `ArtBox` is the square art (cover, mosaic or placeholder, reporting a dead cover) |
| A track list row | `TrackRow` | `track-lists.js` | number · title · artist · `cells` · source icons · `duration` (the last column, the icons right up against it). `lead` (edit-mode handles), `showArtist`, `resolving`, `dimResolving`; `onPlay(resolverId?)` covers the row and each icon |
| A service's play button (a source icon) | `SourceIconButton` (`TrackSources` for the column) | `source-icon-button.js` (re-exported by `track-lists.js`) | The plug-in's colour and logo, "Play from X (95% match)"; `quiet` on the dark queue drawer (`.source-quiet`: faded and desaturated at rest, full on hover or focus) |
| A page's coloured header | `PageHero` | `page-hero.js` | 320px, collapsing to 80px; gradient and pattern from `PAGE_COLORS`; the page passes `expanded` and `collapsedContent`. The artist page's photo hero is the one other design |
| A page's Filter… box | `FilterBox` | `filter-box.js` | Opens focused; an empty box closes on blur; ✕ or Escape empties and closes it (and its Escape doesn't close a dialog around it) |
| The strip that stays at the top of a page's scroll area | `StickyBar` | `filter-box.js` | `variant` 'filter' or 'header' |
| An action pill (a suggestion, an active location) | `Chip` | `filter-chips.js` | The filter chips' style; `onRemove` puts a ✕ button beside it, never inside |
| A small label on a card or row (Shared, Hosted, AI, a service) | `Badge` | `badge.js` | Tones neutral, info, accent, surface, or a service colour |
| A spinner | `Icons.Spinner` | `icons.js` | The one loading spinner |
| A heading over a row or grid | `SectionHeader` | `section-header.js` | Home's style, with the optional "See all" link |
| Pick-one filter buttons | `FilterChips` | `filter-chips.js` | Home's source filter style |
| Tabs in a hero | `HeroTabs` | `hero-tabs.js` | `role="tablist"`, arrow keys |
| A section of Settings (its card and heading) | `SettingsSection` | `settings-cards.js` | The card, the small-capitals heading (written in Title Case), an optional line under it |
| A setting row, text field, secret field, select, checkbox, slider, switch or radio group | `SettingRow`, `TextField`, `SecretField`, `Select`, `Checkbox`, `Slider`, `Switch`, `RadioGroup` | `fields.js` | Every field has a label; on/off in a setting is a `Switch`; a setting that only applies while the one above is on is a `SettingRow` with `nested` (indented under a line) and a `size: 'sm'` switch, and a group of them (a sign-in with what needs it) is `NestedSettings`; `tone: 'dark'` on the dark panels; no raw `<input>` / `<select>` (`inputCopies` 0) |
| The AI provider picker | `ProviderMenu` | `provider-menu.js` | The shared `Menu` of AI plug-ins, on both Shuffleupagus panels |
| A pick-one row of equal tiles, each with an icon (Settings' theme) | `SegmentedChoice` | `fields.js` | `role="radiogroup"`; the current tile has an accent border and tint |
| Nothing to show yet / a load that failed | `EmptyState` / `ErrorState` | `states.js` | `ErrorState` has "Try again" (`onRetry`); `tone: 'dark'` on the dark panels, `icon: null` for none |
| A loading placeholder (the playbar's three now-playing lines: `PlaybarLineSkeleton`, `playbar-skeleton.js`; a concert list: `ConcertListSkeleton`, `concert-skeletons.js`) | `CardSkeleton` (one card, any grid; `CardRowSkeleton` for Home's rows), `ArtistCardSkeleton` (an artist card), `TrackRowSkeleton` (a track row, `TrackRow`'s own columns), `ConcertListSkeleton` (a month of concert rows: `photo: true` for the Concerts page's row, without for an artist's On tour), the page's skeletons | `home-skeletons.js`, `track-lists.js`, `recommendation-skeletons.js`, `concert-skeletons.js` | Same box and columns as the content (see Shimmer classes), so nothing jumps when it lands |
| A tooltip | `Tooltip`, or `data-tooltip` on a control | `ui-atoms.js` | Never a native `title` (below) |
| A "why it's here" badge on a cover | `ReasonBadge` (`ReasonMark` for a heading) | `reason-badge.js` | Shuffleupagus picks, Critical Darlings summaries |
| A service's icon or logo | `ResolverIcon`, `SERVICE_LOGOS` | `brand-logos.js` (re-exported by `ui-atoms.js`) | The colour comes from the plug-in's `manifest.color` |
| Any other logo (Shuffleupagus' elephant, Chrome, X, Instagram, Facebook, YouTube) or Parachord's wordmark | `BrandMark` (`id`), `ParachordWordmark` | `brand-logos.js` | One-colour marks take `fill`; Chrome keeps its own colours |
| The queue's "Playing from" bar | `QueueContextBar` | `queue-context-bar.js` | `interactive` false for a Spinoff; app.js passes the click |
| A friend's now-playing pill in the sidebar | `FriendMiniPlaybar` | `friend-mini-playbar.js` (re-exported by `settings-cards.js`) | |
| An icon | `Icons.*` | `icons.js` | Real SVGs from one set (see Icons); never a pasted path or a text glyph |
| A track's source icons | `visibleSources` / `sourceRowState` | `lib/visible-sources.js` | One rule for every list (`TrackRow` runs it) |
| A page's colour, gradient or hero pattern | `PAGE_COLORS`, `pageTint` | `lib/page-colors.js` | Names `index.html`'s `--page-<id>` / `-fill` / `-hero` variables |
| A page's icon | `PAGE_ICONS` | `lib/page-icons.js` | Icon names from `icons.js`, keyed like `PAGE_COLORS`; the sidebar and What's New read it |
| A plug-in capability's name in UI text | `capabilityLabel` | `lib/capability-labels.js` | Sentence case; an unknown id is spelled out, never shown raw |
| An artist with no photo | `generateArtistPattern` | `lib/artist-pattern.js` | A gradient and initials picked by a hash of the name |
| A release type's colour | `RELEASE_TYPE_COLORS`, `releaseTypeColor` | `lib/release-types.js` | The album page's badge, the cards' badge and the type chips |
| A hover prefetch on an element that isn't a shared card | `hoverDwell` | `lib/hover-dwell.js` | Runs after a 250ms rest, so a scroll past doesn't fetch |
| Share | `ShareButton` | `ui-atoms.js` | |
| A count, a relative time or an error message | `countOf`, `timeAgo`, `errorText` | `lib/plural.js`, `lib/time-ago.js`, `lib/error-copy.js` | See Copy |

### Modules

| Module | Exports |
|--------|---------|
| `button.js`, `header-control.js`, `modal.js`, `toast.js`, `menu.js`, `provider-menu.js`, `sort-menu.js`, `card-button.js`, `section-header.js`, `filter-chips.js` (`FilterChips`, `Chip`), `filter-box.js` (`FilterBox`, `StickyBar`), `hero-tabs.js`, `page-hero.js`, `badge.js`, `fields.js`, `states.js`, `reason-badge.js`, `keyboard-shortcuts.js`, `whats-new-dialog.js`, `option-tile.js`, `list-row.js`, `nav-item.js` (`NavItem`, `NavSearch`), `tickets-button.js`, `collection-radio-button.js`, `queue-context-bar.js` | The shared controls in the table above, the keyboard shortcuts dialog and What's New |
| `album-card.js`, `playlist-card.js`, `artist-card.js`, `listener-card.js`, `card-art.js` | The cards, and the art and overlay they share |
| `ui-atoms.js` | `Tooltip`, `FixedTooltip`, `TooltipLayer`, `placeTooltip`, `PlaybackProgress`, `ShareButton`; re-exports the logo kit |
| `brand-logos.js` | `ResolverIcon`, `SERVICE_LOGO_PATHS` / `_IMAGES`, `SERVICE_LOGOS`, `BRAND_MARKS` / `BrandMark`, `ParachordWordmark`, `BRAND_COLORS` |
| `icons.js` | `Icons`, the one icon set (custom: `Spinner`, `Spinoff`, `Playlist`, `PlayTop10`) |
| `track-lists.js` | `TrackRow`, `TrackSources`, `VirtualizedQueueList`, `VirtualizedTrackList`; re-exports `SourceIconButton` (`source-icon-button.js`) |
| `cards.js` | `ReleasePage` (the album page), `ReleaseCard` (the artist page's discography card, an `AlbumCard`), `AlbumVersionsMenu`, `SearchHistoryItem`, `PlayTop10Icon` (= `Icons.PlayTop10`), `RELEASE_BADGE_STYLES`; re-exports `generateArtistPattern` (`lib/artist-pattern.js`) |
| `settings-cards.js` | `ResolverCard` (the plug-in tile), `McpSettingsSection`, `ScrobblerSettingsCard`, `SettingsSection`; re-exports `FriendMiniPlaybar` (`friend-mini-playbar.js`) |
| `fields.js` | `SettingRow`, `StackedField` (a name over a long field, a line under it: keys, URLs, usernames; a `status` and a `link` row), `HelpLink` (where to get a key or make an account: accent, arrow, no underline; the one help-link style), `TextField`, `SecretField`, `Select`, `Switch`, `RadioGroup`, `SegmentedChoice`, `Checkbox`, `Slider`, `NestedSettings` |
| `plugin-extras.js` | The plug-in settings dialog's shared sections, chosen by capability or manifest field: `ServiceAccount`, `ClientKeys`, `UsernameAccount`, `AdvancedKeys`, `LibrarySync`, `StartupRow`, `InstallCallout`, `WatchFolders` |
| `home-sections.js`, `home-banner.js`, `home-setup.js`, `home-skeletons.js`, `recommendation-skeletons.js`, `concert-skeletons.js`, `playbar-skeleton.js` | Home's rows and the pages' and playbar's skeletons |
| `home-page.js`, `collection-page.js`, `artist-page.js`, `playlist-view-page.js`, `search-page.js` | Whole pages, each `React.memo`'d and fed stable props |

Everything else still renders inline in `src/renderer/app.js`. Details of a few:

### Tooltip

```
Tooltip({ children, content, position, variant, className, id, delay })
data-tooltip="…"   (any control, through TooltipLayer)
```

One tooltip, two ways in (#1385 step 9):

- **`Tooltip`** wraps a trigger. **`data-tooltip`** goes on a control with no wrapper; `TooltipLayer`, mounted once at the app root, shows it. Controls never use a native `title` (it shows late, never on focus, and in the OS's look); `tests/renderer/tooltip-layer.test.js` fails on one.
- **Panel:** `.tooltip-panel` in `index.html`, portalled to `<body>` and `position: fixed`, so no `overflow: hidden` clips it. `variant: 'dark'` / `data-tooltip-variant="dark"` adds an outline on the always-dark surfaces (same dark tip); `.tooltip-bio` wraps long text.
- **Placement:** `position` = `'top'` (default) | `'top-end'` | `'bottom'` | `'bottom-start'` | `'left'` | `'right'` (`data-tooltip-position`). `placeTooltip` (pure) keeps it inside the window and flips it when its side has no room.
- **Behaviour:** shows on hover and on keyboard focus (`:focus-visible` only, for both ways in: the focus a click gives a button never shows one) after 400ms (`TOOLTIP_DELAY_MS`), stays while either lasts, and Escape or a scroll dismisses it (WCAG 1.4.13). A click on the trigger hides it, and so does the pointer leaving the window (no mouseleave reaches a trigger on the window's edge, such as the playbar). Before 2026-11-16 the wrapper showed on any focus, so a playbar button's tip stayed up after the click until something else took focus.
- **Names:** a tooltip is a description, not a name. An icon-only control needs an `aria-label` too, usually the same words. A wrapped single element gets `aria-describedby` pointing at the tip while it shows.

### FixedTooltip

```
FixedTooltip({ children, content, id })
```

`Tooltip` preset for a card's explanation (Fresh Drops' "why", Recommendations' reason): `bottom-start`, wrapping (`.tooltip-note`), with a block trigger. `placeFixedTooltip` is `placeTooltip(…, 'bottom-start')`.

### TrackRow

```
TrackRow({ track, number, lead, isNowPlaying, sources, allResolvers, onPlay, onOpenArtist, onContextMenu,
           cells, duration, sourcesWidth, rowRef, showArtist, resolving, dimResolving, ...CardButton props })
```

- The row every page list renders: History, a friend's history, Recommendations, Charts, the playlist page, Collection, Search and an album's tracklist (10 copies until 2026-11-15). The queue drawer's row has its own layout.
- `sources` is `{ trackSources, playbackResolvers, resolverOrder }`; the row runs `sourceRowState` on it, so a row resolving shows a shimmer and an unplayable one is dimmed. A local file's Local Files icon is one more source, in the user's source order.
- `onPlay(resolverId?)` is both the row click and each source icon's, so they can't disagree about the queue or the context.
- Columns: `number` (or `lead`) 32px · title (flex 1) · artist (flex 0.7, a link when `onOpenArtist`) · `cells` (`{ content, width | flex, align, onClick }`) · icons, right-aligned (`--source-col`: one 24px slot per playable service, at most 140px; `sourcesWidth` overrides) · `duration` 50px, right-aligned, last. The icons always touch the duration and the durations line up down the row's end. `TrackRowSkeleton` has the same columns.

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
- The plug-in tile on Settings › Plug-Ins: the service's colour and logo, its priority number, an enabled check and a status line ("Setup required").
- Reordering: drag a tile, or use Raise Priority / Lower Priority in its menu (right-click, or Shift+F10 / the Menu key on the focused tile).

### ScrobblerSettingsCard

```
ScrobblerSettingsCard({ scrobbler, config, onConfigChange })
```

- `React.memo` wrapped
- Configuration card for scrobbling services (Last.fm, ListenBrainz, Libre.fm)

### Cards

`AlbumCard`, `PlaylistCard`, `ArtistCard` and `ListenerCard` are every card in the app (2026-11-15: one copy per page before). They share the box (`HOME_CARD_BOX` from `home-skeletons.js`: 10px padding, 10px radius, `--card-bg`, `--card-shadow`), the rounded art (`HOME_CARD_ART_RADIUS`), the text gap (`HOME_CARD_TEXT_GAP`), the `release-card` hover lift and the `card-fade-up` entry. Every page's card skeleton uses those same constants.

- **`ReleaseCard`** (`cards.js`) is the artist page's discography card: an `AlbumCard` with the year as its subtitle and the type badge on the art. It keeps its own replacement-art state for the broken-art retry.
- **Critical Darlings** keeps its wide review-card layout (art beside the text), with the shared `ArtOverlay`.

### Recommendation rows

The Recommendations page reuses Home's and the other tabs' pieces. Each section (Tracks, Albums, Artists, Playlists, Friends) sits under a `SectionHeader`, Home's heading; its **"See all" / "Show less"** link is the header's link (accent text, right-aligned on the heading's line), and sections carry no item counts. Sources are filtered for the whole page by `FilterChips` under the hero: All, then one chip per source, no counts, one pick at a time. Collapsed, a card section shows two full rows. Cards are the shared `AlbumCard`, `PlaylistCard`, `ArtistCard` and `ListenerCard`, and songs are `TrackRow`s; a Shuffleupagus pick carries the `ReasonBadge` (its reason as the tooltip), and any other pick's reason is the card's tooltip. Items carry no source badges.

### PageHero

```
PageHero({ collapsed, page, title, onTitleContextMenu, expanded, collapsedContent })
```

- The coloured header of Collection, Playlists, History (and a friend's), Recommendations, Pop of the Tops, Fresh Drops, Critical Darlings and Concerts.
- The gradient and pattern come from `PAGE_COLORS[page]` (`hero`, `pattern`, `patternOpacity`). The title is written in words; CSS draws the tracked capitals. Right-clicking it copies the page's link.
- `title: null` for a page that draws its own (a friend's page leads with the avatar).

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

## Copy

The words are part of the design system: one concept, one name. The audit (#1388) found five names for a plug-in and "song" next to "track".

### Glossary

| Say | Meaning | Not |
|-----|---------|-----|
| **plug-in** (Title Case "Plug-Ins" in headings) | What you install and enable | resolver, plugin, extension, provider |
| **enable** | Turn a plug-in on | activate |
| **service** | Spotify, Apple Music, Bandcamp and so on | provider |
| **source** | Where a track plays from | resolver |
| **Collection** | Your saved tracks, albums and artists, with your local files merged in (capitalised: a feature name) | library, Your Music |
| **Loves** | Tracks you've loved | favourites, likes (a service's own "Liked Songs" keeps its name) |
| **Shuffleupagus** | The AI DJ ("your AI DJ" on first mention) | the assistant, the AI |
| **track** | One recording | song |
| **album** / **edition** | A release / one version of it | |
| **sync** / **import** | Keep a playlist matched with a service / copy it in once | |
| Feature names | Fresh Drops, Critical Darlings, Pop of the Tops, Recommendations, Concerts, History | new releases, Critic's Picks |

"Library" stays only where it means local files or a service's own library ("your Spotify library").

### Rules

- **Never in UI text:** "resolver", ids, file extensions, internals (MBID, Widevine CDM, MusicKit, preload.js), HTTP codes, raw `error.message`, or Settings paths that don't exist.
- **Sentence case** everywhere except native menus, tabs, Settings section headings and page titles. Never type caps; use CSS `uppercase`. `tests/renderer/dialog-title-case.test.js` checks titles.
- **"…"**, not "...": the `asciiEllipsis` drift metric.
- **Counts:** `countOf(n, 'track')` (`src/renderer/lib/plural.js`), never `${n} tracks`.
- **Relative times:** `timeAgo` (`src/renderer/lib/time-ago.js`).
- **Dates:** US English (`en-US`) until the UI is translated (#1416).
- **Errors:** what happened, then what to do ("Couldn't load Fresh Drops. Check your connection and try again."). Show `errorText(err, fallback)` (`src/renderer/lib/error-copy.js`); throw `userError('…')` for a message written for the reader; log the raw error.
- **Buttons:** a confirm button is named for its action and sits next to Cancel. Success is a toast, not a dialog.
- **Native menus** use the app's words in Title Case: "Save Queue as Playlist…", "Remove Plug-In".

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

**Sizes:** 16px (`w-4 h-4`) in rows, chips, small buttons and inline with text; 20px (`w-5 h-5`) in buttons and dialog titles; 12px (`w-3 h-3`) only inside a text badge or a 16px control; 32–48px only for an empty state's illustration. Stroke 2 (1.5 on the large illustrations); a heavier stroke only marks a state, like the active sidebar item.

**The set:** Play, Pause, SkipForward, SkipBack, Volume2, Music, Smartphone, Headphones, List, Users, Radio, Heart, Search, Settings, Plus, ListPlus, X, Check, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Info, MoreHorizontal, AlertTriangle, RefreshCw, ExternalLink, Link, Download, Folder, Copy, QueueAdd, ArrowRight, MapPin, Bookmark, Zap, Star, Ticket, Shuffle, Home, Clock, RotateCcw, Radar, User, Droplet, Trophy, Upload, FilePlus, Globe, AddToQueue, ShoppingCart, AppWindow, Dices, Sparkles, Trash2, ListMusic, Library, ListOrdered, LocateFixed, Share, FileText, ArrowLeft, Repeat, Repeat1, VolumeX, and **Spinner** (the one loading spinner). To add an icon, copy its shapes from lucide.dev into `SHAPES` in `icons.js`. `Spinoff` is the playbar's fork, solid in its own 32px box (like `Spinner`, outside the 24px grid). `Playlist` (the Playlists placeholder: three bars and a play triangle, solid) and `PlayTop10` (a play triangle with a green "10" badge) are custom, like `Spinner`.

**Logos are not icons.** A service's, a brand's or Parachord's own logo comes from `components/brand-logos.js`: `ResolverIcon` for a service badge, `BrandMark` (`id`: `shuffleupagus`, `chrome`, `x`, `instagram`, `facebook`, `youtube`) for the rest, `ParachordWordmark`. Never paste a logo's `<path>`; the drift script counts pasted paths outside icons.js and brand-logos.js.

### Service Logos

Large service logos are stored in the `SERVICE_LOGOS` object (`brand-logos.js`), sized `w-16 h-16` and mostly white for coloured backgrounds. Services include: Spotify, Apple Music, Amazon Music, YouTube, Bandcamp, SoundCloud, Subsonic, Local Files, MusicBrainz, Last.fm, Libre.fm, ListenBrainz, ChatGPT, Claude, Gemini, Ollama, Shuffleupagus, Wikipedia, Discogs, Bandsintown, Songkick, SeatGeek, Ticketmaster and Achordion. SoundCloud and Subsonic are images; the rest are SVGs.

### Custom Icons

Custom icons live in `icons.js` beside the Lucide ones, as components that draw their own SVG (outside the 24px stroke grid):

- **`Icons.Spinner`**: the one loading spinner
- **`Icons.Spinoff`**: the playbar's Spinoff fork, solid, in its own 32px box
- **`Icons.Playlist`**: the Playlists placeholder (three bars and a play triangle), solid
- **`Icons.PlayTop10`**: a play triangle with a green "10" badge (Play an artist's or a listener's top 10; `cards.js` still exports it as `PlayTop10Icon`)

### App Icons

Located in `assets/icons/`:
- `icon.icns` (macOS), `icon.ico` (Windows), `icon-square.svg`
- PNG sizes: 16, 32, 48, 128, 256, 512, 1024
- `linux/` — the same PNGs named `16x16.png` … `1024x1024.png`, the Linux package icon set (`build.linux.icon`); `scripts/generate-icons-from-svg.sh` refreshes it
- `logo-wordmark-white.png` — White wordmark for dark backgrounds

---

## Animations

Every animation is a `@keyframes` rule in `index.html`, and every one listed here is in use (the design audit removed the unused `spin-reverse`, `loadingFadeInUp`, `loadingDotPulse` and `friendStatusChange`). With `prefers-reduced-motion`, one block in `index.html` turns animations and transitions off; spinners keep turning.

### Motion tokens

Every transition and short animation runs on these (`index.html`, #1450). Reduced motion sets every duration to 0.01ms in one block, so whatever reads them settles at once.

| Token | Value | For |
|-------|-------|-----|
| `--motion-fast` | 150ms | Colour and small state changes: hover, a switch, a row's tint. Tailwind's default (`transition-colors` with no duration) |
| `--motion-base` | 200ms | Something appearing: a menu, a fade, the results panel |
| `--motion-slow` | 300ms | Movement across the screen: the queue drawer, a side panel, the hero's collapse, a progress fill |
| `--motion-deliberate` | 400ms | The one long settle: the artist hero, a card grid fading up |
| `--ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` | A change in place (Tailwind's default) |
| `--ease-out` | `cubic-bezier(0, 0, 0.2, 1)` | Something arriving |
| `--ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | Something leaving |

- **In classes:** `transition-colors` / `-opacity` / `-transform`, or `transition-[box-shadow,border-color]` for two, with `duration-fast` / `-base` / `-slow` / `-deliberate` and `ease-out` / `ease-in` (all read the tokens; `tailwind.config.js`).
- **Inline:** `transition('opacity transform', 'slow', 'out')` from `lib/motion.js`. It refuses `all` and off-scale names.
- **Never** `transition-all`, a numbered `duration-300`, or an inline string with its own times: the drift script counts them (`rawTransitions`).
- Animate transform, opacity, colours and filters. A size or position (width, height, max-width) only where it is the design: a progress fill, the hero's collapse. The queue drawer slides on `transform` and its height isn't animated, so dragging its handle resizes it under the cursor (it lagged with `transition-all`).

### Loading and feedback

| Keyframes | Class or use | Notes |
|-----------|--------------|-------|
| `spin` | `.animate-spin` | 1s linear loop; the one loading spinner (`Icons.Spinner`) |
| `shimmer` | `.animate-shimmer`, `.now-playing-pending` | 1.5s loop; skeletons, and the playbar while a play starts |
| `loadingWordmarkPulse` | `.loading-wordmark-svg` | The splash wordmark's per-letter pop-in |

### Dialogs, toasts and tooltips

| Keyframes | Class | Notes |
|-----------|-------|-------|
| `modalScrimIn` | `.modal-scrim` | `Modal`'s scrim fades in |
| `modalPanelIn` | `.modal-panel` | `Modal`'s panel fades and rises 8px |
| `toastIn` | `.toast-enter` | A toast fades and rises 8px |
| `tooltip-in` | `.tooltip-panel` | The shared tooltip |
| `menuIn` | `[role="menu"]`, `[role="listbox"]` | Menus and pick lists (`Menu`, `SortMenu`) fade and drop 4px in, on `--motion-base` |
| `sidePanelIn` | a modal dialog that isn't `.modal-panel` | The Add to playlist panel slides 16px out from the sidebar, on `--motion-slow` |
| `motionFadeIn` | `.motion-fade-in` | Content that swaps as it mounts: the page hero's full and collapsed sides, so they don't pop while its height animates |
| `toastIn` | `.motion-rise-in` | Rises an element in from below; no current user (the Shuffleupagus prompt panel it was made for was removed in #1020) |
| `fadeIn` | inline `animation` | Concert rows appearing |

### Queue

| Keyframes | Class | Notes |
|-----------|-------|-------|
| `queue-pulse` | `.queue-pulse` | The queue button when something is added |
| `badge-flash` | `.badge-flash` | The queue count badge |
| `queue-track-drop` | `.queue-track-drop` | A track leaving the queue |
| `queue-track-insert` | `.queue-track-insert` | A track entering the queue: a 1s accent glow, the one deliberate exception to the 100–400ms rule (it is the only "added to queue" signal) |

### Navigation, cards and friends

| Keyframes | Class or use | Notes |
|-----------|--------------|-------|
| `slideInRight` / `slideOutRight` | inline `animation` | The results sidebar opening and closing (it slides in from the right, above the playbar) |
| `cardFadeUp` | `.card-fade-up` | Card grids appearing |
| `friendSlideIn` | `.friend-entry` | A friend joining the sidebar |
| `friendMoved` | `.friend-moved` | A friend changing places |
| `onAirPulse` | `.on-air-indicator` | The on-air dot (2s loop) |
| `marquee-scroll` | `.animate-marquee` | Long names that scroll (pauses on hover) |

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
- **Card grids use `.card-grid`** (`index.html`): `repeat(auto-fill, minmax(180px, 1fr))`, as many columns as the content area holds; the grid's own gap class sets the spacing, and its skeleton uses the same class. Never Tailwind's `sm:`/`md:`/`lg:`/`xl:` for columns: they measure the **window**, not the content area (at the 1000px minimum window the content is only 744px wide). The Size setting (zoom, `main-process/ui-zoom.js`) raises the window's minimum with the zoom, so this holds at every size.

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

## Auditing

Two kinds of drift, two kinds of check:

- **Element drift** (a sixth button colour, a hand-built input, a hex value) is what `scripts/design-drift.js` counts; the ratchet (`tests/ci/design-drift.test.js`) fails when a count rises. That includes `serviceNameBranches`, code that branches on one plug-in's id instead of the registry.
- **Structural drift** (one job done with different controls across a surface's variants) passes every count: each variant uses the shared `Button` and fields, just differently. Find it by comparing variants side by side and by task: for each job (turn on, sign in, enter a key, save, remove), list how every variant does it; one job should be one control. `scripts/ui-contact-sheet.js` (`npm run ui-sheets -- <recipe>`) captures every variant of a surface, light and dark, with a structural summary (headings, buttons, fields, switches, links) per variant. The plug-in settings audit (`docs/plans/2026-11-17-plugin-settings-audit.md`) is the example: 23 dialogs, zero drift counts, five ways to enter a key.

Copy that reaches the UI from plug-in manifests is checked by `tests/plugins/manifest-copy.test.js` (no developer text in descriptions, a label for every capability).

## Focus & Accessibility

- **Keyboard focus:** `:focus-visible` shows a `2px solid var(--accent-primary)` outline with `2px` offset
- **Mouse focus:** `:focus:not(:focus-visible)` suppresses the outline
- **After a click, no ring at all:** `lib/input-modality.js` sets `<html data-input="pointer">` on pointer down and `"keyboard"` on a key (a modifier alone doesn't count); `html[data-input="pointer"] :focus-visible` drops the outline, Tailwind's ring and the menu items' inset. Chromium matches `:focus-visible` when code moves focus after a click on something that can't hold it (a right-click menu, a dialog, the Add to playlist panel), which lit the ring for mouse users. A text field keeps its accent border
- **Filter pill focus:** `.filter-pill:focus-within` highlights the outer border, suppressing inner input outline
- **Text selection:** `.no-select` disables user selection in non-editable areas
- **Window dragging:** `.drag` / `.no-drag` control Electron's window drag regions

---

## Slider Controls

Every slider is `Slider` (`fields.js`) on one class, `.slider` in `index.html` (the seek bar's and volume's own copies, `.progress-slider` and `.volume-slider`, are gone):

- Track: 4px, 2px radius, `--slider-track` (`--control-off`; `--on-dark-track` in `.slider-dark`)
- Thumb: 12px circle, `--slider-fill` (`--accent-fill`, or the `color` prop: Concerts' radius is the page's teal; `--playbar-accent` in `.slider-dark`), its hover `--slider-fill-hover`
- Disabled: `--slider-disabled` thumb on `--slider-track-disabled`
- `tone: 'dark'` on the playbar (seek and volume); `onChange` gets a number

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
