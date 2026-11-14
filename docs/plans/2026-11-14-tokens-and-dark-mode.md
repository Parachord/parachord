# Plan: tokens and the dark-mode foundation (#1383)

Part of the design-audit work (#1391). Findings: [2026-11-13-design-audit.md](2026-11-13-design-audit.md), §4.7, §4.12 and §5. Lands as commits on the `design-audit` branch (draft PR #1393), like the rest of the audit.

## Goal

Every colour in the renderer comes from a CSS variable that has a light and a dark value, so both themes work by construction. Today the variables exist, but most of the code bypasses them:
- 656 hex colours, 947 Tailwind palette classes and 38 `isDark` ternaries (design-drift counts at the start of this plan)
- `color-scheme` is never declared
- every page except Home sits on the card colour in dark mode
- white text sits on the light dark-mode accent in about 20 places
- the window flashes light at launch

## Order of work

Each step is one commit. Each runs `npm test`, rewrites the drift baseline when a count falls, and gets a light/dark check in the running app before the next step.

### 1. Foundations in `index.html` (no page changes yet)
- [x] `color-scheme: light` on `:root`, `color-scheme: dark` on `.dark`. This fixes native checkboxes, ranges, radios, selects, scrollbars and the background-less inputs (the white Settings fields) in one line.
- [x] Dark values for `--success`, `--warning` and `--error`, which are light-only today. Add `--info`.
- [x] Status-text tokens for coloured text on page backgrounds, readable in both themes: `--text-success`, `--text-warning`, `--text-danger`, `--text-info`.
- [x] `--accent-fill` (fixed `#7c3aed`) and `--on-accent` (`#fff`): the fill-accent convention Home and FilterChips already use, given a name.
- [x] Define `--accent-secondary-fg` (the last undefined variable), or replace its 3 uses.
- [x] `--text-tertiary` contrast. Decided: light secondary `#4b5563` / tertiary `#6b7280`; dark tertiary `#8b8f97` (secondary stays `#9ca3af`). Both levels pass 4.5:1 on pages and cards in both themes and stay distinct. Check every surface that uses it (about 330 places), especially the 10–11px labels.

**Check:** the drift test's undefined-variable list is empty. Settings fields, sliders and checkboxes look right in dark mode.

### 2. Launch and backdrop
- [x] Seed `effectiveTheme` from `document.documentElement.classList.contains('dark')` instead of `'light'` (app.js `useState`), so the first render never strips `.dark`.
- [x] The window's `backgroundColor` (main.js `BrowserWindow`) follows `theme_preference` / `nativeTheme`, and updates on `theme-changed`.
- [x] In `handleThemeChange`, use `setNative()`'s result instead of calling `getSystem()` first.
- [x] Page bodies `bg-white` → `var(--bg-primary)`: the main content area and the 6 page bodies the audit lists. No change in light mode; in dark mode pages sit on `#161616` and cards on `#252525` stand out again.

**Check:** launch in dark mode twice, once with the 5s fallback path forced. No light flash. Every page in dark mode has visible card edges.

### 3. Semantic colours and the accent
- [x] Toasts and the Home banner use the status fill tokens (`--fill-*`). Inline errors and success lines move with step 4's page conversions. `lib/toast-style.js` and `lib/home-banners.js` read from them, not hex.
- [x] The 20 or so white-on-`var(--accent-primary)` buttons and gradients use `--accent-fill` / `--on-accent`.
- [x] The confirm dialog uses one red: the status token, not three different reds.
- [x] Hard-coded `#7c3aed` focus borders and slider accents use the accent variable. The playbar slider thumbs, blue today, move to the accent.

**Check:** `hexColors` falls. Every toast type and banner severity looks right in both themes.

### 4. Remap what's left, then shrink the remap block
- [ ] Extend the `.dark` remap block to the palette classes actually used that have no remap: `text-gray-200/300`, the 16 tint backgrounds, the 7 hover tints, `border-red-200`, `border-teal-300`, `bg-gray-900` and others. Delete the unused `violet` rules.
- [ ] Then, page by page, replace palette classes with variables (inline style, or a small set of utility classes added to `index.html` that read variables). As each page is converted, delete the remap rules nothing uses any more.

**Check:** `paletteClasses` falls with each page. Pages convert in this order, highest count first: Settings, Concerts, Charts, Recommendations, History, Search, Collection, the artist page.

### 5. Page colours and service colours
- [ ] One `PAGE_COLOR` map for all nine pages, extending `section-header.js`, used by the sidebar, heroes, links and chips.
- [ ] Fix the mismatches the audit lists:
  - Critical Darlings' hero starts in Recommendations' amber.
  - Fresh Drops and Concerts are near-identical teals.
  - Friend history's gradient doesn't match History's.
  - Concerts uses purple controls.
- [ ] Service colours only from `resolver.color`. Remove the hard-coded Bandcamp, Apple Music and Local Files copies in the playbar and Search.

### 6. Retire the theme ternaries
- [ ] Replace the 38 `isDark` / `effectiveTheme === 'dark'` ternaries (artist page On Tour, Concerts rows and ticket menus, sync setup) with variables.

**Check:** `themeTernaries` is 0.

### 7. Docs
- [ ] Rewrite the colour and dark-mode parts of `docs/DESIGN_SYSTEM.md` (#1390): the token list, how to add a colour (both themes), the fill-accent convention, `PAGE_COLOR`.
- [ ] Update CLAUDE.md "Design system" if a rule changes.

## Risks
- **Step 1's `--text-tertiary` change** moves a lot of text at once. Review it on the densest pages (Settings, track lists, card meta) in both themes before moving on.
- **Step 4 touches many files.** Keep each page's conversion in its own commit so a regression points at one page.
- **The always-dark surfaces** (playbar, queue drawer, AI panels) must stay dark in light mode. They use `--surface-dark*`; don't convert them to page tokens.

## Not in this plan
Type, spacing and radius tokens (part of #1385's components); icons (#1384); copy (#1388).
