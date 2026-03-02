# UI Consistency Audit - Remaining Items

## Context
The `ui-consistency-audit` branch already has CSS custom properties, dark mode, and palette unification. This plan addresses the remaining audit findings: accent color standardization, typography tokens, button/focus states, spacing, z-index, animation fixes, and selective visual polish.

## Files
- `index.html` — CSS variables, global styles
- `app.js` — All React UI (~54k lines)

---

## Phase 1: CSS Token Foundation (index.html only — zero risk)
Only adds new CSS variables. Nothing references them yet.

### 1A. Accent Color Extended Tokens
Add after existing accent vars in `:root` and `.dark`:
```css
--accent-secondary: #8b5cf6;      /* Now-playing indicators */
--accent-tertiary: #a855f7;       /* Gradient endpoints */
--accent-soft: #a78bfa;           /* Soft accent for dark UI */
--accent-surface: #ede9fe;        /* Light purple bg for badges */
--accent-primary-alpha-06 through -alpha-60  /* rgba(124,58,237,N) */
```
Dark overrides map to lighter purple tones (`#c4b5fd`, etc.)

### 1B. Typography Tokens
```css
--font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
--font-mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
--leading-tight: 1.2;   --leading-normal: 1.4;
--leading-body: 1.5;    --leading-relaxed: 1.6;
--tracking-tight: 0.005em;  --tracking-normal: 0.02em;
--tracking-wide: 0.05em;    --tracking-caps: 0.08em;
--tracking-display: 0.2em;  --tracking-display-wide: 0.3em;
```

### 1C. Border Radius Tokens
```css
--radius-sm: 4px;  --radius-md: 6px;  --radius-lg: 8px;
--radius-xl: 10px; --radius-2xl: 12px; --radius-pill: 16px;
--radius-full: 9999px;
```

### 1D. Z-Index Scale
```css
--z-base: 0;     --z-raised: 10;   --z-dropdown: 20;
--z-sticky: 30;  --z-overlay: 40;  --z-modal: 50;
--z-popover: 9999;  --z-toast: 99999;
```

### 1E. Animation/Transition Tokens
```css
--duration-fast: 100ms;  --duration-base: 150ms;  --duration-slow: 300ms;
--ease-default: ease;
--ease-out: cubic-bezier(0.4, 0, 0.2, 1);
--ease-spring: cubic-bezier(0.16, 1, 0.3, 1);
```

---

## Phase 2: Global CSS Improvements (index.html — low risk)

### 2A. `:focus-visible` Styles
```css
:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: 2px; }
:focus:not(:focus-visible) { outline: none; }
input:focus-visible, textarea:focus-visible, select:focus-visible {
  outline: 2px solid var(--accent-primary); outline-offset: -1px;
  box-shadow: 0 0 0 3px var(--accent-primary-alpha-15);
}
```

### 2B. Font Family
Update `body, html` rule to use `font-family: var(--font-sans);`

---

## Phase 3: app.js Targeted Fixes (high impact)

### 3A. Accent Purple → CSS Variables
- 87× `#7c3aed` → `var(--accent-primary)`
- 7× `#6d28d9` → `var(--accent-primary-hover)` (all in onMouseEnter handlers)
- 11× `#8b5cf6` → `var(--accent-secondary)`
- 4× `#a855f7` → `var(--accent-tertiary)`
- 10× `#a78bfa` → `var(--accent-soft)`
- ~25× `rgba(124, 58, 237, N)` → alpha tokens (in color/bg/border only, NOT in boxShadow strings)
- 4× `#ede9fe` → `var(--accent-surface)`

### 3B. Fix `transition: 'all ...'` (7 instances)
Replace each with specific properties (background-color, color, border-color, etc.)

### 3C. Font Family Cleanup
Replace 3× `fontFamily: 'system-ui, -apple-system, sans-serif'` with `var(--font-sans)`

---

## Phase 4: Visual Polish (selective, low risk)

### 4A. Line-Height Normalization
- 4× `lineHeight: '1.35'` → `'1.4'`
- 1× `lineHeight: '1.7'` → `'1.6'`
- 1× `lineHeight: '1.8'` → `'1.6'`

### 4B. Border-Radius Normalization
- 3× `borderRadius: '20px'` → `'16px'` (align to pill token)

### 4C. Letter-Spacing Normalization
- 3× `letterSpacing: '0.1em'` → `'0.08em'` (align to caps token)

---

## What We're NOT Doing (and why)
- **Not mass-changing font-size** — 367 instances of 12/13px is too risky and the sizes serve different purposes
- **Not mass-changing button padding** — 300+ instances, would break layouts
- **Not mass-changing border-radius** — already mostly consistent at 8px
- **Not replacing z-index in JS** — React `zIndex` requires numbers, can't use CSS vars
- **Not adding a display font** — aesthetic choice for a separate discussion
- **Not replacing rgba in boxShadow strings** — CSS vars can't be partial values inside shorthand strings

## Verification
- Launch app in both light and dark mode
- Check accent purple renders correctly on buttons, nav items, now-playing indicators
- Tab through UI to verify focus-visible rings appear on keyboard navigation
- Hover buttons to verify transitions still animate smoothly
- Check tooltips, modals, dropdowns still layer correctly
