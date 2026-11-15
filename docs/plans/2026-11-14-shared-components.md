# Plan: shared components (#1385)

Part of the design-audit work (#1391). Findings: [2026-11-13-design-audit.md](2026-11-13-design-audit.md), §4.1–4.6, §4.9 and §5. Lands as commits on the `design-audit` branch (draft PR #1393), like the rest of the audit.

## Goal

Every common element has one component, and pages use it. `SectionHeader` (#1370) and `FilterChips` (#1371) are the pattern: a props-driven module in `src/renderer/components/`, render tests under plain Node, a "comes from X" line in CLAUDE.md's Renderer patterns and in `docs/architecture/renderer-patterns.md`, then callers migrated.

Today the same element is rebuilt per page:
- about 7 primary-button colours, about 8 Cancel looks
- 23 hand-built modal shells, 6 dialog-title sizes, 5 close buttons
- 16 text-input recipes, 3 switch designs, 4 menu families
- 5 empty-state templates, 6 retry states
- 2 tooltip components and about 157 native `title`s

Design-drift counts at the start: `clickableNonInteractive` 131, `inlineOutlineNone` 36, `nativeDialogs` 15, `jsHover` 122.

## Ground rules

- **The building blocks exist already.** Colours come from the theme-token Tailwind classes and variables (#1383), icons from `icons.js` (#1384). A component never takes a colour as a hex prop.
- **Props-driven, no app state.** Components take values and callbacks. Hooks are `React.useState`-style, so the module loads under Node (CLAUDE.md "Extracted modules").
- **Stable props.** Pages are `React.memo`'d, so handlers passed down go through `useStableHandlers` as today.
- **One component per commit, then its callers in the next commits,** page by page, so a regression points at one change. Each migration commit rewrites the drift baseline and updates any skeleton whose box changed.
- **The always-dark surfaces** (playbar, queue drawer, AI panels) get a `tone="dark"` variant where a component appears there, never page tokens.

## Order of work

Modal and CardButton first: the accessibility work (#1386) depends on them. Then the pieces most pages use.

### 1. `Button` (`components/button.js`)
- Variants: `primary` (`bg-accent-fill`), `secondary` (outline on `--border-default`), `destructive` (`--fill-error`), `text`, and `icon` (square, requires `aria-label`; a missing one throws in tests).
- Sizes `sm` / `md`. States: hover, active (pressed), focus-visible ring, `disabled`, and `busy` (spinner, `aria-busy`, keeps its width).
- A `pageColor` option for a page's own primary fill (`PAGE_COLORS[view].fill`), as Concerts' Apply uses.
- **Migrate:** dialog footers first (they come with Modal), then empty/error states, then Settings and the plugin screens.
- **Check:** render tests for every variant and state. The primary-button colours drop to one.

### 2. `Modal` (`components/modal.js`), then the confirm dialog on it
- `role="dialog"`, `aria-modal`, `aria-labelledby` its title, `aria-describedby` its body.
- Focus moves into the dialog on open, is trapped while it's open, and returns to the opener on close. Escape and the scrim close it unless `dismissible={false}`.
- One scrim, one close X (`Icons.X`, labelled), one title size (20px), one radius (16px), sizes `sm` / `md` / `lg`. Enter/exit: opacity plus an 8px rise, 150ms, off under `prefers-reduced-motion`.
- A footer slot laid out right-aligned: Cancel (`secondary`) then the action.
- **The confirm dialog** (77 `showConfirmDialog` calls) becomes `Modal` plus a small API:
  - `confirmLabel` names the action ("Remove", "Disconnect"), with Cancel beside it, never a lone "OK"
  - `destructive` makes the action red; errors that aren't destructive are neutral, not a red OK
  - a fix action (`actionButton`) is the primary button
  - successes move to toasts (a `showConfirmDialog({ type: 'success' })` with nothing to decide becomes `showToast`)
- **Migrate:** the confirm dialog, then the 23 shells one at a time: Add Friend, Import Playlist, Queue Save, sync setup, ID3 editor, What's New, the tutorial, and the rest. The 15 remaining native `confirm()` / `prompt()` calls go with them.
- **Check:** focus-trap and Escape tests in jsdom; `nativeDialogs` → 0.

### 3. `CardButton` and clickable rows (`components/card-button.js`)
- A `<button type="button">` root (or `<a>` where it navigates), a focus-visible ring, hover actions revealed on focus too (Home's `useReveal`, moved here), Shift+F10 / the ContextMenu key opening the same menu as right-click, and hover styling in CSS instead of `onMouseEnter`.
- A `Row` variant for list rows: same behaviour, row layout.
- **Migrate:** the card family in `cards.js`, then track and playlist rows, the Add-to-Playlist panel rows, `ResolverCard`, the tutorial tiles.
- **Check:** `clickableNonInteractive` falls with each caller; `jsHover` falls.

### 4. `Toast`
- Severity from `toastBackground` (already tokens), an icon per severity, a close button on persistent toasts, an `aria-live="polite"` region (assertive for errors), also fed by "Now playing", and a `--z-toast` token.
- **Migrate:** the one toast renderer in app.js; callers don't change.

### 5. `Menu` / `Dropdown`
- One look (the native menu's spacing on `--bg-elevated`), arrow keys, Home/End, Escape, typeahead, `aria-expanded` / `aria-haspopup`, clamped to the viewport, closes on outside click.
- **Migrate:** the 16 sort dropdowns, Share, the three ticket menus, Sync.
- Separately, one native context-menu builder per item type (track, album, artist, playlist) in `lib/`, so the same item gets the same native menu everywhere. `withCollectionState` (#1382) is the start of it.

### 6. `Tabs`
- `role="tablist"` / `tab` / `tabpanel`, `aria-selected`, arrow keys, and a compact mode for collapsed heroes. Hero tabs on images use white with a text shadow at full opacity when selected and 80% when not (60% was 1.7:1, #1386).
- **Migrate:** Charts, History, Collection, the artist page and Settings.

### 7. Fields
- `Field` (label, hint, inline error with `aria-invalid` / `aria-describedby`), `TextField`, `Select`, `Switch` (`role="switch"`, the control tokens), `SecretField` (show/hide), `SubmitButton`, and a real `<form onSubmit>` so Enter submits.
- **Migrate:** Settings and the plugin screens first (most of the 16 input recipes), then the dialogs' inputs as each moves onto Modal.

### 8. `EmptyState` / `ErrorState`
- Icon, title, body, action; `ErrorState` is `role="alert"` with "Try again". The pattern in `cards.js` (release page error) is the reference, and the History "not connected" state (#1382) already follows it.
- **Migrate:** the 5 empty templates and 6 retry states (Fresh Drops, Concerts, Charts, Critical Darlings, Recommendations, History, Collection, Search).

### 9. Tooltip
- One component: FixedTooltip's positioning (escapes overflow) with Tooltip's look, shown on hover and on focus, after a 400ms delay. Native `title`s on controls move to it or to an `aria-label`.

### 10. What's left of #1360
- Concerts' source filter (a dropdown today) and Collection's filters on `FilterChips`.

## After each component
- Render tests (`tests/renderer/<component>.test.js`), including the a11y attributes.
- CLAUDE.md "Renderer patterns" and `renderer-patterns.md` get its "comes from X" line.
- `docs/DESIGN_SYSTEM.md` "Components" gets its entry (part of #1390).

## Risks
- **Modal focus handling** interacts with the native-messaging and protocol flows that open dialogs programmatically. Test the dialogs those paths open (import from the browser extension, `parachord://` links).
- **CardButton changes the DOM of every card.** Drag-and-drop from cards (to playlists, to the queue) must keep working; a `<button>` can be `draggable`. Check each card type's drag before moving on.
- **The confirm dialog's 77 callers** each need a label decision. Do them in groups by feature, and keep the old API working until the last caller moves.

## Not in this plan
Colour tokens (#1383, done), icons (#1384), copy wording beyond button labels (#1388), page layout at narrow widths (#1389).
