# Parachord desktop design audit

**Date:** 2026-11-13. **Code audited:** `main` at cfd893a9 (after #1370, #1371, #1375). Read-only: sixteen parallel audits of the renderer source, each over one area, plus `index.html`, `main.js` and `docs/DESIGN_SYSTEM.md`.

**Areas:** discovery pages · library pages · artist / album / search · settings, dialogs and app chrome · notifications · empty and loading states · context menus and tooltips · icons and colours · accessibility and keyboard · typography and spacing · forms and inputs · animations · narrow window widths · dark mode · onboarding and first run · copy and terminology.

Line numbers are `src/renderer/app.js` unless a file is named; component files are `src/renderer/components/<name>.js`.

---

## 1. Summary

The app has the pieces of a design system, but most of the code doesn't use them:

- **The theme variables exist and are bypassed.** `index.html` defines tokens for colour, radius, type, spacing, z-index and motion. The radius, tracking, leading, z and motion tokens are used **zero** times. `--success` is used 2 times, `--error` once and `--warning` never. Meanwhile there are 152 distinct hex colours, 36 distinct transition strings and about 20 font sizes.
- **There are three theming mechanisms side by side:** CSS variables, `.dark` overrides of Tailwind greys in `index.html`, and per-component `isDark` ternaries. Classes that none of them cover stay light in dark mode, notably `bg-gray-900` (every "Try again" button), `text-gray-300` (empty-state icons), `hover:text-purple-600` (row links), and the red, amber, green and blue tint classes.
- **The accent is two different purples.** The token is `#7c3aed` (Tailwind violet-600), but 123 Tailwind `purple-*` classes are `#9333ea`, and 26 hard-coded `#7c3aed` values don't follow dark mode's `#a78bfa`.
- **Each common element is rebuilt per page.** Counts of distinct styles:
  - primary buttons: about 7 colours
  - text inputs: about 16 recipes
  - dialog titles: 6 sizes
  - close buttons: 5 styles
  - Cancel buttons: about 8 looks
  - empty-state templates: 5
  - "couldn't load, retry" states: 6
  - spinners: 6–7
  - HTML menu families: 4
  - switch designs: 3
  - small uppercase label recipes: 6
- **The shared icon set doesn't work.** `icons.js` wraps Lucide, but Lucide is never loaded, so every shared icon renders as a text character (▶ ⏸ ⏭ ⏮ ✕ ♫), and its size and colour props are discarded. That includes the playbar's transport buttons and the Play button on every card. About 300 other icons are hand-pasted SVG paths from four different icon families.
- **A new user hits dead ends in their first minutes.** The Home checklist's "Connect Spotify" and the "Import" card do nothing useful. The tutorial ends on the Plug-Ins page, and only Bandcamp plays without setup.
- **Dark mode is half-built.** No `color-scheme` is declared. Every page except Home sits on the card colour. About 25 light tint classes, 9 near-black buttons and about 20 white-on-light-accent buttons aren't adapted, and the window flashes light at launch.
- **The same concept has five names** (resolver / source / service / plugin / provider). Messages point to Settings tabs that don't exist and show raw technical errors.
- **Keyboard and screen-reader support is close to absent outside Home.** The renderer has 0 `tabIndex` and 0 `role="button"`. About 79 kinds of card, row and tile are clickable `div`s that a keyboard can't reach. No dialog has dialog semantics, Escape-to-close or a focus trap. No live region exists, so nothing is announced.

The good parts to build on:
- Home (`home-sections.js`) is the reference for everything: CSS variables, `aria-label`s, focus reveal of hover actions (`useReveal`), and real `<button>` cards.
- `SectionHeader` (#1370) and `FilterChips` (#1371) are the shared-component pattern to copy.
- `FixedTooltip` handles focus, Escape and clamping correctly.
- The token-based error state in `cards.js:1745` / `artist-page.js:1217` (`role=alert`, CSS vars, accent button) is the error pattern to standardise on.

---

## 2. Bugs found along the way

These are functional defects, not style drift. Each is small and independent, so it can be fixed in its own PR before any redesign.

| # | Bug | Where |
|---|---|---|
| 1 | An empty playlist shows a loading skeleton forever (`displayTracks.length > 0 ? list : skeleton`) | `playlist-view-page.js:1105` |
| 2 | Recommendations shows a blank page when it has loaded with no error and no sections | `app.js:42046-42062` |
| 3 | Album page header tabs always highlight "Music" (`tab === 'music'`) | `artist-page.js:535-575` |
| 4 | Album page swaps the EP and Single badge colours (versus the release cards and the filter chips) | `cards.js:1424-1425` |
| 5 | Toast types misrender. `success` is grey, not green, and `warning` isn't handled, so 7 warnings (e.g. "Spotify session expired") look like successes. About 17 error toasts pass no type (mostly import failures). The updater passes a duration where the type goes, so "Update error" shows grey and its 5s/8s durations are ignored. | toast render `36838`. Untyped errors: `11758, 11820, 12017, 12218, 12236-12341, 12354, 22157, 40400`, `use-playback-engine.js:1705, 3871, 3954`. Updater `12378, 12391, 12398` |
| 6 | Confirm dialog's secondary button uses the undefined `var(--border)` (no border at all) and the undefined `--card-secondary-bg` (fallback nearly invisible in dark mode). This is the "No Source Found" dialog. | `53851-53852` |
| 7 | Add-to-Playlist "Done": white text on `--hover-bg-default` (#f3f4f6) when nothing is selected, so it's unreadable in light mode | `52737` |
| 8 | Stop-sync "Keep imported items": its background disappears after the first hover (mouse-leave sets `transparent`) | `55057-55064` |
| 9 | Spotify "Clear" re-saves the old Client ID and reports success: a stale closure reads the pre-clear value | `48906-48910` → `34426` |
| 10 | Escape in the main search box does nothing. The global handler returns whenever an input has focus, even though `search-page.js:1283` says Escape should go back. | `15436` |
| 11 | Cmd/Ctrl+F does nothing unless the Search page is already open (`searchInputRef` is unset elsewhere) | `10896` |
| 12 | Card hover lift never happens on 22 card types. `.card-fade-up`'s `forwards` fill keeps `transform` overriding `.release-card:hover`, and inline `boxShadow` blocks the hover shadow, Home cards included. | `index.html:969-1024`; `cards.js:285/481/586/793`, `search-page.js:483…`, `app.js:37792, 38681, 39385, 39872, 41154…` |
| 13 | Queue insert and drop keyframes replace the virtual list's `translateY` positioning, so the row draws at the top of the list while it animates | `track-lists.js:346-356` |
| 14 | `fadeIn` animation is referenced but never defined, so the concert list stagger does nothing | `artist-page.js:1933`, `app.js:40746` |
| 15 | Lucide never loads, so every `Icons.*` is a text glyph whose `size` and `className` are discarded | `icons.js`; e.g. `cards.js:680`, playbar `46164-46180` |
| 16 | Weekly-playlist context menu offers "Export as XSPF…" and "Delete Playlist" for a playlist that isn't local; Export silently no-ops | `main.js:4653-4673`; `app.js:14604` |
| 17 | "Add Album to Collection" never switches to "Remove". Tracks offer "Add to Collection" when already saved everywhere except Collection and the playbar title. Playbar art and title give different menus for the same track. | `main.js:4764`; `collection-page.js:711`, `app.js:46304/46362` |
| 18 | Recommendations album context menu is always disabled ("click album first"): it sends no tracks | `41269-41274` |
| 19 | Queue row context menu offers "Add to Queue" and has no "Remove from Queue" | `track-lists.js:319` |
| 20 | Settings inputs render white with light text in dark mode: no background class and no `color-scheme` declared | `settings-cards.js:433, 455, 463`; `51725`; New Playlist `52923` |
| 21 | Playbar runs past the right edge below a ~1120px window. At the 1000px minimum width, the volume slider is off-screen. | `46151, 46262`; `ui-atoms.js:333` |
| 22 | `isCompactHeader` (`< 700`) can never be true: the minimum content width is 744px, so the compact "Play" label never shows | `4967-4980` |
| 23 | Search's width measurement goes stale after opening a detail view: the ResizeObserver keeps watching an unmounted node | `18067-18083` |
| 24 | Queue drawer: when closed, it stays in the Tab order. At small window heights it can be dragged above the top of the window. | `55530-55560` |
| 25 | Playlist push failure uses `window.alert`, while pull failure uses a toast. ID3 editor and Settings also use `alert()`. | `playlist-view-page.js:545, 549`; `44824, 45824, 45937, 53621, 53625` |
| 26 | A playlist title can be saved empty | `playlist-view-page.js:311` |
| 27 | History treats "not connected" as an error and offers "Try Again" | `29173` → `42368` |
| 28 | Fresh Drops and Concerts are blank (no skeleton) at launch until `cacheLoaded` | `39312`, `40587` |
| 29 | Buy button shows two tooltips (a `Tooltip` plus a native `title`) | `46730, 46750` |
| 30 | Marketplace AI-model dropdown has hard-coded model options, not the plugin's list. Blur-saving an empty key or URL sets `enabled: true`. | `51753`; `51729, 50886` |
| 31 | Text fields have no Cut / Copy / Paste context menu (no `webContents.on('context-menu')`) | `main.js` |
| 32 | AI results skeleton widths re-roll on every render (`Math.random()`) | `47792, 47796` |
| 33 | **"Connect Spotify" on the Home checklist does nothing** without a developer Client ID (true for every new user): `openSyncSetupModal` ignores the `{error: 'no_client_id'}` it gets back | `9450-9453` vs `main.js:3319-3326` |
| 34 | **Home "Import" card is a dead end.** It opens Settings → General, which says "No sync providers connected… first" and has no button. The real setup is in the Plug-Ins → Spotify / Apple Music detail. | `home-page.js:568`; `45790` vs `48976-49083` |
| 35 | Home checklist "Connect Last.fm / ListenBrainz" opens General, which has only a toggle. Recommendations already does this right with `setSelectedResolver`. | `home-page.js:189` vs `42023-42034` |
| 36 | Splash has no timeout: if `cacheLoaded` never flips it stays up forever. A store read error sets `cacheLoaded` but skips the tutorial. First launch can show no window for up to 10s while Widevine downloads. | `7589-7628`; `19481-19489`; `main.js:94, 1872` |
| 37 | Dark launch flickers light. `effectiveTheme` starts as `'light'`, so the apply effect strips `.dark` until the IPC round trip returns. The window `backgroundColor` is fixed at `#f3f4f6`. | `3717, 5013`; `main.js:952` |
| 38 | "copyies" (bad pluralisation) in the repair toast. About 56 strings print "1 tracks" / "1 hours ago". | `3969`; e.g. `main.js:4470-4548` |
| 39 | An error tells users to open "View > Toggle Developer Tools", which doesn't exist in the View menu | `use-playback-engine.js:2489` |
| 40 | Settings › Plug-Ins claims plug-ins run "in a secure sandbox" that "keeps your credentials secure". README.md:29 says they aren't sandboxed. | `44065, 44087` |
| 41 | Messages point to Settings paths that don't exist: "Settings → Resolvers" / "> Resolvers", "Settings → Plugins", "Settings → Installed → SoundCloud → Advanced", "Settings → Apple Music" | `45029, 29173, 34858`; `use-playback-engine.js:2026/2031`; `9348, 9547`; `main.js:3465`; `playback-limits.js:56` |
| 42 | Dark mode: the main content area is `bg-white` (→ #252525), so every page except Home sits on the card colour, cards lose their edges, and pages are two-tone under the #161616 sticky bars | `36869`; `playlist-view-page.js:190`; `artist-page.js:583`; `search-page.js:124/186/1229` |
| 43 | Dark mode: scrollbars are almost invisible (hard-coded black alpha; the `--scrollbar-*` tokens are unused); off toggles are almost invisible (knob remapped to #252525 on #444; 12 toggles) | `index.html:359-371`; `45111…`, `44925, 50798, 51034` |
| 44 | Dark mode, unreadable: SHARED badge (white on #c4b5fd, 1.85:1), Collection now-playing row (`bg-cyan-50` near-white), Add-to-Playlist "Added" row (1.05:1), AI results play button (blank white disc), sync-setup ListenBrainz text (1.3:1), Apple Music notices and sync diff banners (1.35–2.4:1) | `37996, 38157`, `pv:171`; `collection-page.js:687`; `53160`; `47877/47886`; `54429`; `49443-49467`; `54094-54095` |
| 45 | About 15 row links set an inline `color`, so their `hover:text-purple-600` never applies in either theme. In 6 more places the `!important` dark remaps kill the hover. | e.g. `38886, 39043`, `collection-page.js:743`, `search-page.js:801` |
| 46 | Home checklist "Add more music sources" counts installed plugins, not enabled ones, so it's ticked on day one. "Add the Raycast extension" can never be completed. Dismissed items can't be restored. A brand-new user gets an unread "What's New" dot. | `lib/home-setup.js:8-35`; `9155` |
| 47 | The tutorial can only be reopened from Developer Settings (via `alert()`, applied on next launch) | `45804-45845` |

---

## 3. Accessibility blockers

These are things a keyboard-only user cannot do at all:

1. **Open most items.** About 79 kinds of card, row and tile are `div`s with `onClick`. Affected:
   - Playlists tiles and table rows
   - every Search result
   - Charts, Fresh Drops, Critical Darlings, Recommendations, History and Friend-history items
   - friends, and artist and album name links in rows

   Only Home cards, Collection album cards and release cards are buttons.
2. **Add to a playlist, or set up a service.** The Add-to-Playlist panel rows (`53100`, `52838`), the Settings `ResolverCard` (`settings-cards.js:70`), the resolver enable toggle (`48656`) and the first-run tutorial tiles (`55288`) are all `div`s.
3. **Use right-click actions or reorder anything.** Menus open only on right-click of rows that can't take focus. The queue, playlists and resolver priority reorder only by drag.
4. **Use dialogs properly.** None of the ~21 modals has `role="dialog"` or `aria-modal`, closes on Escape, traps focus or restores it on close, and 17 don't move focus in at all.
5. **Play/pause from the keyboard.** There is no accelerator for it (the Space binding was removed, `main.js:2134`).

Also:
- **Nothing is announced:** no `aria-live` anywhere, no toast role, no track-change announcement, no `aria-current` on the now-playing row.
- **Unnamed controls:**
  - the playbar Previous, Play and Next buttons
  - the search and clear buttons in every filter bar
  - six dialog close buttons
  - 70 of 80 form fields, including the main search box
  - 8 toggle switches
- **The seek bar reads raw seconds** ("143").
- **Contrast fails:**
  - `--text-tertiary`: 2.54:1 in light, 3.17–3.74:1 in dark, across about 330 uses
  - white on the dark-mode accent `#a78bfa`: 2.72:1 (about 10 places)
  - white on teal, amber, cyan or green fills: 2.1–2.8:1
  - idle hero tabs (`white/60`): 1.7–1.9:1
- **Reduced motion is ignored:** a single `prefers-reduced-motion` rule exists, for `.now-playing-pending`.
- **Focus is invisible** on 24 inputs, 3 selects and 1 button: an inline `outline: 'none'` beats the global `:focus-visible` ring.
- **Hover-only reveal and tooltips:** card hover actions are revealed by keyboard focus only on Home, and the CSS `Tooltip` shows on hover only.

---

## 4. Inconsistencies by area

### 4.1 Buttons
- **Primary:**
  - hard-coded colours, near-black for errors: `#E91E63` pink hero CTAs (`artist-page.js:328`, `collection-page.js:190`), `#10c9b4` teal, `bg-gray-900` "Retry"
  - filter-bar actions in different colours: green-600 Create, cyan-500 Add Friend, `#06b6d4` Sync, orange-500 SAVE, `#8b5cf6` Pin
  - two accents: `var(--accent-primary)` vs hard-coded `#7c3aed`, and `bg-purple-600`
  - seven hover treatments, from none to `scale-105`
- **Secondary and Cancel:** about 8 looks. Two Cancels hard-code a `#e5e7eb` border that stays light in dark mode (`54038, 54199`). Import vs Share still differ in size (14px/32px tall vs 12px/30px).
- **Destructive:**
  - fills: `#ef4444`, `bg-red-600`, `#dc2626`, and tinted red
  - Scrobbler Disconnect is neutral grey
  - "Stop Syncing" is a purple primary in one dialog and a grey text link in another
  - Last.fm's brand red Connect button looks like Delete
- **Text links:** accent var, `text-purple-600`, inline `#9333ea`, and `hover:text-blue-600` (search history).
- **Labels:** "Retry" / "Try Again" / "Try again"; "..." in about 30 places vs "…" in 9.

### 4.2 Text
- **Card titles:** 13px/500 `var(--text-primary)` on album and playlist cards, vs 14px `text-sm text-gray-900` on artist cards and every Recommendations card. In dark mode the gray-500 meta maps to tertiary, a step dimmer than the variables beside it.
- **Hero:** titles start at three different gutters (24px, 32px on the playlist view, 64px on the artist collapsed and album headers), so the title jumps sideways between pages. The playlist view has a fixed 140px bold hero, and Friend history uses `text-4xl`.
- **Dialog titles:** 14, 16, 17, 18 and 20px, plus `text-lg`.
- **Small uppercase labels:** 6 recipes (10, 11 or 12px; tracking .04 to .1em).
- **Settings → General:** interleaves two card styles and two heading styles on one scrolling page (`45466–45875`, `settings-cards.js:205` vs `44673`).

### 4.3 Dialogs and modals (including your "No Source Found" example)
- The shared confirm dialog (77 uses: 49 error, 15 info, 12 success, 1 warning) has these problems:
  - it renders every error as a red ✕, a red title and a solid red OK, so a dead end reads as destructive
  - its useful action ("Open Resolver Settings") is the grey button while OK gets the colour, and the equal widths wrap the label
  - it uses two reds (`var(--error)` title vs `#dc2626` icon and button)
  - its icons are text glyphs
- Many of these, all successes plus "No Source Found" mid-playback, belong in a toast with an action rather than a modal.
- Close X: 5 styles, and 8 dialogs have none. Overlays: 5 scrim/blur combinations. Panel widths: 360–560px.
- Two "save as playlist" dialogs (AI Save `47915`, Save Queue `48027`) use different always-dark recipes, unlike every other dialog.

### 4.4 Notifications
**Severity colours by surface**

| | Toast | Home banner | Inline | Theme var |
|---|---|---|---|---|
| Success | grey | `#15803d` | `#22c55e` / `text-green-600` / `#10b981` | `--success` `#10b981` |
| Error | `#dc2626` | `#b91c1c` | `#dc2626` / `red-500` / `#f87171` | `--error` `#ef4444` |
| Warning | grey | `#b45309` ("warn") | yellow / amber / `#d97706` / `#f97316` | `--warning` (unused) |
| Info | `#2563eb` | `#2563eb` | `#1e3a8a` on blue 8% | none |

- **The toast:**
  - has no icon, no close button (though 7 toasts are persistent) and no live region
  - sits at `z-50`, the same as modals, and `--z-toast` is unused
- **Inline error boxes:** 4 styles. Some are unreadable or glaring in dark mode (`#1e3a8a` and `#9a1f2e` text, `bg-red-50`, `text-yellow-700`).
- **Sidebar unread dots** pulse in page colours. Critical Darlings' red dot reads as an error.

### 4.5 Empty and loading states
- **Empty states:** 5 designs:
  - icon + title + body (+ button)
  - icon + one line
  - one 16px line
  - one 14px line
  - a token block with no icon
- **More variation:**
  - titles at 15, 16, `text-lg` and `text-xl`
  - icons in four sizes, some inside tinted circles
  - six "retry" button styles
  - "Not configured" handled three ways
  - Playlists' empty state says "Import a playlist" but has no button
- **Breaking your loading-skeleton rule:**
  - Friend history and On Tour show a lone spinner
  - Collection Artists/Albums and Related Artists stay blank
  - Home "Made from your listening" has no skeleton and pops in, pushing Playlists down
  - Recommendations goes blank when empty
- **Skeletons that don't match the content:**
  - the artist page's pre-load draws two headers
  - Concerts uses a different row design
  - the album track list jumps about 80px over 10 rows (missing the 140px resolver column)
  - the History, Playlists, Charts and Search skeletons have different gaps, card boxes or column widths
- **Shimmer:** `.shimmer-light` and `.shimmer-strong` are each defined twice. Three variants are used for the same art placeholder, and the stagger differs per page. `tests/ui/loading-skeletons.test.js` pins only Recommendations, Critical Darlings and Home.

### 4.6 Context menus and tooltips
- **Context menus:**
  - an album gets a different menu, or none, depending on the page (see bugs 16–19)
  - no menu on Collection artists, Search playlists, Concerts, Recommendations friends or Friend-history artists
  - four HTML menu families: dark `--tooltip-bg` (Share, editions, link menu), the playbar gradient, light `--card-bg` (Collection Sync), Tailwind white (sort, tickets)
  - three ticket-menu implementations
  - only two menus close on Escape
- **Tooltips:**
  - about 157 native `title`s vs 22 `Tooltip` and 4 `FixedTooltip`
  - the `variant: 'dark'` tooltip draws a white bubble
  - wording drifts: "Add to Queue" / "Add album to queue" / "Add {title} to the queue"; "Add to collection" / "Save to collection"; "Play via X" / "Play from X"

### 4.7 Icons and colour
- **Icons:**
  - about 300 inline SVGs, 130 distinct paths, from Heroicons v1/v2, Material, Carbon and Feather
  - common icons are copy-pasted: close ×26, check ×23, search ×22, plus ×20
  - close has 4 forms and disclosure 4 idioms (chevron, rotated ▶, ▲/▼), plus 7 spinner forms
  - sidebar icons: w-5 for Home and Search, w-4 for the rest
- **Page colours:**
  - Critical Darlings is red in the sidebar, but its hero starts in Recommendations' amber
  - Fresh Drops (#10b981) and Concerts (#10c9b4) are near-identical teal-greens with near-identical heroes
  - Concerts uses purple `#7c3aed` controls
  - Friend history's gradient doesn't match History's (the comment says it does)
  - `PAGE_COLOR` covers only 3 of 9 pages
- **Playbar:** slider thumbs are blue `#3b82f6`, unlike anything else; active toggles are `#c084fc`.
- **Brand colours hard-coded and wrong:** Bandcamp `#1DA0C3` vs manifest `#629AA9`, Apple Music `#FA2D48` vs `#FA243C`, Local Files `#A855F7` / `#6B7280` vs `#6366f1` (`app.js:46496-46503`, `search-page.js:1747-1751`).

### 4.8 Typography, spacing, radius, shadow
- **Sizes:** about 20 font sizes are used; 9 would cover everything. Near-duplicates: 10/10.5/11/12, 13/14, 15/16, 17/18, 20/22/24, 28/30/32, plus rem duplicates of px values.
- **Line height:** inline 12px and 14px text gets an 18px and a 21px line, while `text-xs` and `text-sm` get 16px and 20px.
- **Gutters:** 24px on most pages; 32px on the playlist view, the Settings header and Search's query view; 64px on the artist collapsed header and the album header; 40px Settings content.
- **Grid gaps on sibling pages:** `gap-4` vs `gap-x-4 gap-y-5` vs `gap-6`. Three grid systems: viewport breakpoints (20 grids, against DESIGN_SYSTEM.md's "no breakpoint-based"), `auto-fill minmax`, and Home's fixed 6 columns.
- **Card anatomy:** padded (10 / r10 / art r6) vs full-bleed (`rounded-lg p-3`). The same album card is padded on History and full-bleed on Friend history. Home art is r8.
- **Radius:** 4, 6, 8, 10, 12, 14 and 16px, plus full, written three ways (999px, 9999px, 50%).
- **Shadows:** 33 distinct inline shadow strings; dialogs use 2 shadow recipes and menus 3.

### 4.9 Forms and inputs
- **Text inputs:** about 16 recipes with 7 focus treatments (three with no visible focus); hard-coded `#7c3aed` focus colours; two border tokens (`--border-subtle` is barely visible).
- **Errors:** five channels (toast, confirm modal, red box, `alert()`, silence). No field ever shows an inline error. Several AI and plugin fields save on blur with no feedback.
- **Enter:** submits only where someone wrote a keydown handler. Add Friend and both save dialogs have no protection against a double submit.
- **Mixed controls for the same choice:**
  - "Auto adjust quality" is an On/Off select next to the Atmos switch
  - the AI provider is a native select in one panel and a custom menu in the other
  - 4 single-choice patterns in Settings
- **Switches and sliders:**
  - 3 switch designs, one of them a non-focusable `div`
  - sliders in 3 accent colours (blue, `#7c3aed`, `#9333ea`)
- **Secrets:** no show/hide toggle anywhere. The ListenBrainz token is in plain text in the Scrobbler card and masked elsewhere.

### 4.10 Animation
- **Instant appearance:** about 22 modals, 15 dropdowns and the toast appear and disappear with no transition, while the AI sidebar slides in and the queue drawer slides up.
- **Hero collapse:** the header shrinks smoothly but its content pops. The 20 opacity transitions on it never run, because the nodes are mounted conditionally.
- **Timing:** 36 distinct transition values, 8 durations, 6+ easings; the motion tokens are unused.
- **Hover implementation:** about 120 hover effects are done by mutating `style` in JavaScript. Sidebar nav items have no hover at all.
- **Performance:**
  - `transition-all` on 12 track-row lists
  - layout properties animated (height ×11, `bottom`, `left`, `max-width`, `width`)
  - the queue drawer's resize lags behind the cursor because of a 300ms transition

### 4.11 Narrow windows (minimum 1000px window, 744px content)
- **Collapsed hero headers have no narrow-width plan.** The artist header overflows by about 134px at the minimum (crowded below ~1280). The Collection tabs wrap to two lines. The Friend history and Search-detail names push their tabs out of view.
- **The playlist view squeezes track titles** to about 74px at the minimum: a fixed 240px art column plus a 140px icon column.
- **Home uses fixed column counts:** 101px cards in the 6-across rows, 84px cards in the Fresh Drops / Critical Darlings halves, and a 63px text column on concert cards.
- **Viewport breakpoints:** cards jump 217 → 165 → 229 → 180px as the window widens, and Settings' plugin tiles overflow their columns at 1024–1100px windows.
- **The Recommendations hero title** has about 0px to spare at the minimum width and clips on Windows.

### 4.12 Dark mode
- **How it works:**
  - `.dark` on `<html>` swaps the CSS variables.
  - `index.html:245-288` remaps a fixed list of Tailwind classes, with `!important`.
  - Everything else stays light: other Tailwind colours and tints, inline hex, `isDark` ternaries (36 of them), and form controls.
  - No `color-scheme` is declared, so native checkboxes, ranges, radios, selects, scrollbars and background-less inputs stay light.
  - The `.dark .*violet*` rules target classes nothing uses.
- **Remap quirk:** `text-gray-500` maps to `--text-tertiary` in dark (one step dimmer than in light), across 226 uses with `text-gray-400`.
- **The always-dark surfaces get dimmer in dark mode,** because they use remapped greys. These are the playbar, queue, AI panels and save dialogs. In light mode, their loading shimmer shows light-grey squares on the dark drawer.
- **What a user sees, worst first:**
  - invisible "Try again" buttons (`bg-gray-900` ×9)
  - white input fields with near-white text
  - two-tone pages with edgeless cards (bug 42)
  - near-white tint pills and boxes (16 resting tint classes plus 7 hover tints are unmapped, e.g. `bg-indigo-50`, `bg-teal-100`, `bg-red-50`, `bg-amber-100`, `hover:bg-purple-200`)
  - light-theme status text at 1.3–3.1:1
  - white on the dark accent (19 places, 2.72:1)
  - a white `variant: 'dark'` tooltip on the playbar
  - the light flash at launch
- **Fix plan, smallest changes first:**
  1. `color-scheme`; define the missing variables; dark values for success/warning/error, plus status-text tokens.
  2. Use `var(--bg-primary)` for the 7 page backdrops (no change in light mode).
  3. Seed `effectiveTheme` from the `<html>` class and set the window background from the theme.
  4. Extend the remap block to the classes actually used, and delete the violet rules.
  5. Scrollbars on the `--scrollbar-*` tokens.
  6. Toggles with a fixed white knob.
  7. `--accent-fill` / `--on-accent` for white-on-accent and the Retry buttons.
  8. Replace the `isDark` ternaries and the inline light hex with tokens.

### 4.13 Onboarding and first run
**Journey:**
1. Up to 10s with no window.
2. The splash.
3. Tutorial "welcome".
4. "Enable Your Music Sources": 8 toggles; Bandcamp and Local Files are pre-on, Local Files with no folder chosen.
5. "You're All Set!"
6. The only exit is "Go to Settings", which lands on Settings → Plug-Ins under a developer-facing "Extensible Plug-in Architecture… sandbox" card.

**What goes wrong:**
- **Only Bandcamp plays without any setup.** YouTube is off by default and opens the browser anyway. Nothing points a new user to either.
- **The tutorial's tiles hide what each source needs** (sign-in, folder, developer key, Premium plus the desktop app). It never asks for an account, though the welcome screen promises friends on Last.fm and ListenBrainz; there's an unused "social" step in the code. It says "You're All Set!" even when nothing usable is on.
- **The checklist and Import card dead-end** (bugs 33–35, 46). History's empty state names a tab that doesn't exist. The AI chat toast lists only two of five AI plugins. Marketplace load failures and failed folder adds are silent.

**Credentials a new user must create:**
- a Spotify Client ID, plus redirect URIs, Premium and the desktop app running
- keys for all four concert services
- ChatGPT, Claude and Gemini API keys
- a ListenBrainz token
- an Apple developer token, when no key ships with the build

**Fixes:**
- The tutorial ends on "Start listening" (Home), with "Open Plug-Ins" as the secondary button.
- Requirement badges on each source tile, and "Choose folder…" on Local Files.
- A line that names what works right away.
- Route checklist items, the Import card and the History, Concerts and AI empty states straight to the right plugin detail or the sync setup.
- "Show welcome tour" in About.
- A splash timeout with an error message.
- On first run, mark What's New as read and seed the checklist correctly.

### 4.14 Copy and terminology
**Glossary.** One concept per term:

| Concept | Terms in use | Recommended |
|---|---|---|
| Playback backends | resolver 41, service ~52, source ~50, plug-in / plugin 22, provider 12, "Meta Services", "Content Resolvers", `.axe` | **plugin** (what you install), **service** (Spotify etc.), **source** (where a track plays from). Never "resolver" in the UI. |
| Saved music | Collection, library (3 meanings), "Your Music" | **Collection** |
| Loved tracks | Loves, loved tracks, favorite | **Loves** |
| The AI | Shuffleupagus, AI, AI DJ, Conversational DJ, AI companion, assistant | **Shuffleupagus**, with "your AI DJ" as the descriptor |
| Track vs song | track 268, song 22 | **track** (also fixes "Top Songs" vs "Top Tracks") |
| Album | album, release, edition, version | **album**, with **edition** for alternate pressings |
| Sync | sync, mirror, import, push/pull, backfill, "classic sync engine" | **sync** (two-way) and **import** (one-time), plus plain verbs |

Feature names drop out in their own errors ("Failed to load new releases", "Critic's Picks", "Charts" instead of Fresh Drops, Critical Darlings, Pop of the Tops). "Discover" means three different things.

**Internals that reach users:** MBID, XSPF, `.axe`, MusicKit, Widevine CDM, `preload.js`, "Check console for details", HTTP codes, raw resolver ids, "listen-along". Raw `error.message` appears in about 28 toasts and 10 dialogs.

**Capitalisation:** tooltips, toasts and empty states are mostly sentence case, while buttons, dialog titles and native menus are Title Case. Literal ALL-CAPS appears in hero titles, the queue drawer and playlist-view buttons, five "CLOSE ×" labels and the SHARED badge.

**Punctuation and format:**
- "..." ×103 vs "…" ×23
- 15 exclamation marks, mostly "Link copied!"
- 4 different plural rules plus about 56 hard-coded plurals
- two relative-time implementations
- `'en-US'` hard-coded ×18
- "50mi" vs "50 mi"

**Messages:**
- About 70 confirm dialogs use the default "OK". Action dialogs have no Cancel.
- Native `confirm`/`alert`/`prompt` are used for deletes and resets.
- Success modals ("Added to Queue", "Installed") should be toasts.
- Dead-end empty states: "No chart data available", "No top tracks data".

**Voice.** The playful page names sit next to engineering copy ("Content Resolvers", git-style "Pull Remote / Sync Conflict"). The speaker shifts between impersonal, "Parachord", "the app" and "we", and only Shuffleupagus says "I".

**Native menu vs in-app wording:**
- "Export Queue as Playlist…" vs "Save Queue as Playlist" vs "SAVE"
- "Uninstall Resolver" vs "Remove"
- "Report an Issue…" vs "Report a problem"
- "Copy Link" vs "Copy parachord:// Link"

**Copy rules:**
1. Use the glossary terms above, and feature names in every message about that feature.
2. Title Case only for native menus, tabs, Settings section headings and page titles. Sentence case everywhere else. Never type caps; use CSS `uppercase`.
3. Always "…": on items that open a dialog, and in progress text.
4. A shared `plural()` helper, `toLocaleString`, one relative-time helper, and the system locale for dates.
5. Errors follow "Couldn't X. Why. What to do." with an action, and no raw errors.
6. Confirm buttons are named for the action, always with Cancel. Destructive confirmations say what's lost and whether it can be undone. No native `confirm` or `alert`.
7. Success messages are toasts, with no exclamation marks.

---

## 5. Recommended standard

Most fixes are shared: build one thing, then migrate pages to it. Each item names the existing code to copy.

**Tokens (in `index.html`, then actually used)**
- **Colour:**
  - one `--accent` with `--accent-fill` (fixed `#7c3aed`) for fills that must not lighten
  - `--success` / `--warning` / `--error` / `--info`, each with a dark value
  - fix `--text-tertiary` contrast (≈`#6b7280` in light, ≈`#9ca3af` in dark)
  - delete or define `--border` and `--card-secondary-bg`
  - one `PAGE_COLOR` map covering all nine pages, used by sidebar, hero, links and chips
  - service colours always from `resolver.color`
  - declare `color-scheme` per theme
- **Type:** 11 · 12 · 13 · 14 · 16 · 20 · 24 · 28 · 48px; weights 300–700 as numbers; tracking .08em (small caps), .05em (tab caps), .2/.3em (display).
- **Spacing:** 4px steps (2 4 6 8 12 16 20 24 32 40 48), with 10px only for card padding. One 24px page gutter everywhere, 40px between sections, 16px from a header to its content, and a 16×20 card-grid gap.
- **Radius:** 4 badge · 6 inner art/input · 8 button/row/menu · 10 card · 12 panel · 16 dialog · full.
- **Shadow:** card · menu · dialog, each with a dark variant.
- **Motion:** 100 / 150 / 200 / 300 / 400ms, a standard curve, an ease-out for entrances and an ease-in for exits, and one `prefers-reduced-motion` block.
- **Dark mode:**
  - `color-scheme` per theme
  - `--accent-fill` and `--on-accent` for buttons, so white text never sits on #a78bfa
  - status-text tokens: `--text-success`, `--text-warning`, `--text-danger`, `--text-info`
  - extend the `.dark` remap block only for classes actually used
  - aim to retire the `isDark` ternaries
- **Copy:** the glossary and rules in §4.14, kept in `docs/DESIGN_SYSTEM.md` next to the tokens.

**Shared components (in `src/renderer/components/`, like `section-header.js` and `filter-chips.js`)**
- **`Icon`:** real SVGs for the ~25 meanings in use, honouring `size` and `className`. Either load Lucide or inline its paths. Includes a `Spinner`.
- **`Button`:** primary, secondary, destructive, text and icon, with hover, active, disabled and busy states. Icon buttons require an `aria-label`.
- **`Modal`:** `role="dialog"`, `aria-modal`, labelled by its title, focus moved in, focus trap, focus restored on close, Escape to close, one scrim, one close X, one title size, enter/exit motion. Rebuild the confirm dialog on it, with the fix action as the primary button and neutral colours for non-destructive errors. Move success messages and most errors to toasts.
- **Toast:** severity colours from the tokens, an icon, a close button on persistent toasts, an `aria-live` region, and `--z-toast`. Feed the same live region with "Now playing" announcements.
- **`Menu` / `Dropdown`:** one look (`--card-bg` or `--tooltip-bg`, pick one), keyboard support (arrows, Escape), `aria-expanded`, and clamping to the viewport. It replaces the 16 sort dropdowns, the Share menu, the ticket menus and the sync menu. One context-menu builder per item type, so a track, album, artist or playlist gets the same menu everywhere.
- **`Tabs`:** `role="tab"` and `aria-selected` for Charts, History, Collection, Artist and Settings, with a compact mode for narrow widths.
- **`Field`, `TextField`, `Select`, `Switch`, `SecretField`, `FilterPill`, `SubmitButton`:** one input look, inline errors with `aria-invalid`, a real `<form onSubmit>`, and a show/hide toggle for secrets.
- **`EmptyState` / `ErrorState`:** icon, title, body and action, following the `cards.js:1745` pattern (`role=alert`, CSS vars, accent button, label "Try again").
- **`CardButton` / clickable row:** a real `<button>` root, `useReveal` so hover actions also appear on focus, a context-menu key, and CSS hover with no JavaScript. Fix `card-fade-up` to `animation-fill-mode: backwards` so the lift works.
- **`Tooltip`:** one component (FixedTooltip's behaviour with Tooltip's look), shown on focus as well as hover, plus a show delay.

---

## 6. Suggested order of work

1. **The bugs in §2.** Small, independent PRs; most are a few lines. Start with:
   - **New-user dead ends:** the checklist, the Import card, and the tutorial's ending (#33–35, §4.13). These are the first things a new user touches.
   - toast types (#5)
   - the confirm dialog's border (#6)
   - Lucide icons (#15)
   - empty playlist (#1)
   - Spotify Clear (#9)
   - card lift (#12)
   - the playbar at narrow widths (#21)
   - dark-mode quick wins: `color-scheme` (#20), the page backdrop (#42), the launch flicker (#37), scrollbars and toggles (#43)
   - the false sandbox claim (#40)
   - Settings paths that don't exist (#41)
2. **Tokens.** The colour and contrast fixes, semantic colours, `PAGE_COLOR` for all pages, `color-scheme`, a reduced-motion block, and removing or adopting the unused tokens. This is one PR that changes many pages' colours at once, so review it visually.
3. **Shared components in order of reach:**
   - `Icon`
   - `Button`
   - `Modal`, with a confirm-dialog redesign
   - Toast, with the live region
   - `CardButton`, which fixes most keyboard blockers
   - `Menu`, `Tabs`, `Field`
   - `EmptyState`, `ErrorState`
4. **Page-by-page migration** onto the components, with skeletons updated in the same PR per CLAUDE.md, and skeleton dimensions pinned in `tests/ui/loading-skeletons.test.js`.
5. **Narrow-width layout:**
   - collapsed headers
   - container-based grids (`auto-fill`) instead of viewport breakpoints
   - Home's fixed column counts
   - the playlist view's columns
6. **Docs.** `docs/DESIGN_SYSTEM.md` is out of date in many places:
   - unused tokens it presents as in use
   - "no breakpoint-based responsive design"
   - the Recommendations heading style
   - the Bandcamp colour
   - the Tailwind scan path
   - animations it lists as in use that aren't
   - blue slider thumbs, documented with no note that they break the accent

   Rewrite it alongside step 2, and add the components to `renderer-patterns.md` the way SectionHeader and FilterChips were.

No Android ticket is needed for any of this: it's desktop-renderer styling and behaviour with no shared data shape.
