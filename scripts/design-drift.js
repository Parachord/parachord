#!/usr/bin/env node
// scripts/design-drift.js: counts the design anti-patterns the 2026-11-13
// design audit found (docs/plans/2026-11-13-design-audit.md), so the count
// can only go down. tests/ci/design-drift.test.js compares a fresh scan of
// src/renderer/ with tests/ci/design-drift-baseline.json and fails when any
// count rises (new drift) or falls (lock the improvement in).
//
//   node scripts/design-drift.js          print the counts and the top files
//   node scripts/design-drift.js --write  rewrite the baseline (after an
//                                         intentional change; say why in the PR)
//
// Each metric is a heuristic over the parsed source, not a lint rule: it
// counts places, it doesn't judge them. A legitimate new use (a service's
// brand colour, an always-dark surface) still raises the count; prefer the
// shared component or token that already exists, and only rewrite the
// baseline when there is no shared way to do it yet.
//
// @babel/parser comes in through jest (babel-jest), so it is always installed
// in a dev checkout.

const fs = require('fs');
const path = require('path');
const { parse } = require('@babel/parser');

const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const BASELINE = path.join(ROOT, 'tests', 'ci', 'design-drift-baseline.json');

// The type and radius scales from the audit (CLAUDE.md "Design system").
const FONT_SIZES = new Set([11, 12, 13, 14, 16, 20, 24, 28, 48]);
const RADII = new Set([0, 4, 6, 8, 10, 12, 16, 999, 9999]);

const NON_INTERACTIVE = new Set(['div', 'span', 'li', 'img', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'td', 'section', 'article', 'header']);
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
const RGB = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/g;
const PALETTE_CLASS = /(?:^|[\s:"'`])(?:text|bg|border|ring|from|via|to|fill|stroke|divide|placeholder|accent|outline|decoration)-(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;
const THEME_TERNARY = /\bisDark\s*\?|effectiveTheme\s*===\s*['"](?:dark|light)['"]\s*\?/g;

// Plug-in ids, for serviceNameBranches: the folder names under plugins-src/.
const PLUGIN_IDS = (() => {
  try {
    return new Set(fs.readdirSync(path.join(ROOT, 'plugins-src'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name));
  } catch {
    return new Set();
  }
})();
// What a plug-in's id is called: x.id, resolverId, providerId, serviceId.
// Only these count, so a string that happens to equal a plug-in id but names
// something else isn't a branch: MusicBrainz's relation types
// (rel.type === 'youtube' | 'bandcamp'), a link's kind
// (classified.kind === 'achordion'). tests/ci/design-drift-service-branches.test.js
// pins both sides (#1523).
const isPluginIdRef = (n) => n && ((n.type === 'MemberExpression' && !n.computed && n.property.name === 'id')
  || (n.type === 'Identifier' && /^(?:resolver|provider|service|plugin)Id$/.test(n.name)));

const METRICS = {
  hexColors: 'Hard-coded hex colours in the renderer. Use a CSS variable from index.html (add one, with a .dark value, if none fits).',
  rgbColors: 'Hard-coded coloured rgb()/rgba() values (a status green, the accent purple…). Use the token, or color-mix(in srgb, var(--token) N%, transparent) for a faint one.',
  rgbNeutrals: 'Hard-coded black / white / grey rgba() values (shadows, scrims, lines on dark panels). Use --on-dark-*, --shadow-* / --scrim tokens.',
  paletteClasses: 'Tailwind palette colour classes (text-gray-500, bg-red-50, purple-600…). Most have no dark-mode remap; use CSS variables.',
  themeTernaries: 'isDark / effectiveTheme ternaries. Theme through CSS variables instead.',
  clickableNonInteractive: 'div/span/li/img… with onClick and no role: unreachable by keyboard. Use a <button> (or role, tabIndex and Enter/Space).',
  inlineOutlineNone: "Inline outline: 'none', which hides the global :focus-visible ring.",
  nativeDialogs: 'alert()/confirm()/prompt(). Use showToast or a dialog component.',
  asciiEllipsis: 'Strings with "..." (three dots). Use the "…" character.',
  svgPaths: 'Hand-written <path> elements. Use the shared icon set (components/icons.js) for a glyph, the brand logo kit (components/brand-logos.js) for a logo.',
  offScaleFontSizes: 'Inline font sizes off the type scale (11, 12, 13, 14, 16, 20, 24, 28, 48px).',
  offScaleRadii: 'Inline border radii off the radius scale (4, 6, 8, 10, 12, 16px, full).',
  jsHover: 'onMouseEnter / onFocus handlers that change style (hover or focus styling done in JS). Use CSS :hover / Tailwind hover: classes, and the shared fields\' focus-visible ring.',
  roleButtonDivs: 'div/span/li… with role="button" (lib/activate-on-key.js, a stopgap). Use a <button>, or CardButton for a card or row that holds buttons.',

  // Copies: a hand-built version of something a shared component already
  // draws. The audit counted colours and classes but not these, so a page
  // could keep its own track row or empty state while every colour in it
  // was a token (2026-11-15). Each counts places outside the shared
  // component's own file (COPY_HOMES).
  trackRowCopies: 'Hand-built track rows (a sourceRowState() call outside components/track-lists.js). Use the shared TrackRow.',
  sourceButtonCopies: 'Hand-built "Play from <service>" source buttons. Use the shared source-icon button.',
  spinnerCopies: 'Hand-drawn spinners (an element with animate-spin or a border-t-transparent ring). Use Icons.Spinner.',
  emptyStateCopies: 'Hand-built empty states ("No …" / "Nothing …" text in a plain element). Use EmptyState (components/states.js).',
  filterPillCopies: 'Hand-built pill buttons (rounded-full px-3 py-1…). Use FilterChips.',
  heroCopies: 'Hand-built page heroes (a 320px block collapsing to 80px). Use PageHero (components/page-hero.js); the artist page\'s photo hero is the one other design.',
  stickyBarCopies: 'Hand-built sticky bars (sticky top-0 classes). Use StickyBar (components/filter-box.js).',
  rawTransitions: 'Transitions off the motion tokens: an inline transition written with its own times or `all`, a transition-all class, or a numbered duration-N class. Use transition() from lib/motion.js, or Tailwind transition-colors / -opacity / -transform with duration-fast / -base / -slow.',
  inputCopies: 'Raw <input> / <select> / <textarea> elements. Use TextField, Select, Checkbox, Slider, Switch or RadioGroup (components/fields.js).',
  serviceNameBranches: "Branches on a plug-in's id (x.id === 'spotify', resolverId !== 'applemusic'): code that does something for one named service. Route by the plug-in registry instead (resolver-loader.js, a capability or a manifest field), so a new plug-in needs no code change (CLAUDE.md, the first invariants). The plug-in settings dialog's per-service sections grew this way (docs/plans/2026-11-17-plugin-settings-audit.md).",
  handBuiltButtons: 'Buttons and links styled as buttons by hand (their own padding plus a fill, border or radius, in classes or inline style). Use Button / buttonClassName (components/button.js), or the shared component for that control.',
};

// The file each copy metric's shared component (or canonical data) lives in:
// its own uses don't count.
const COPY_HOMES = {
  trackRowCopies: ['components/track-lists.js'],
  sourceButtonCopies: ['components/track-lists.js', 'components/menu.js', 'components/source-icon-button.js'],
  spinnerCopies: ['components/icons.js'],
  emptyStateCopies: ['components/states.js'],
  filterPillCopies: ['components/filter-chips.js'],
  stickyBarCopies: ['components/filter-box.js'],
  heroCopies: ['components/page-hero.js'],
  // The field components, and FilterBox's own borderless input inside its pill.
  inputCopies: ['components/fields.js', 'components/filter-box.js'],
  // The canonical colour data: each page's colour (CLAUDE.md "A page's colour
  // comes from PAGE_COLORS"), the artist stand-in art's palettes, and the
  // brands' own colours in their logos, and each release type's colour
  // (lib/release-types.js, one palette for every badge and chip).
  hexColors: ['lib/page-colors.js', 'lib/artist-pattern.js', 'components/brand-logos.js', 'lib/release-types.js'],
  rgbColors: ['lib/page-colors.js', 'lib/artist-pattern.js', 'components/brand-logos.js', 'lib/release-types.js'],
  paletteClasses: ['lib/page-colors.js'],
  // Shared components whose own buttons are the one look for their control.
  handBuiltButtons: ['components/button.js', 'components/header-control.js', 'components/card-button.js', 'components/filter-chips.js',
    'components/menu.js', 'components/sort-menu.js', 'components/fields.js', 'components/collection-radio-button.js',
    'components/tickets-button.js', 'components/hero-tabs.js', 'components/toast.js', 'components/reason-badge.js',
    'components/album-card.js', 'components/artist-card.js', 'components/listener-card.js', 'components/card-art.js',
    'components/nav-item.js', 'components/option-tile.js', 'components/list-row.js',
    'components/source-icon-button.js', 'components/queue-context-bar.js', 'components/friend-mini-playbar.js'],
};

function rendererFiles(dir = RENDERER, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) rendererFiles(full, out);
    else if (name.endsWith('.js') && !name.endsWith('.generated.js')) out.push(full);
  }
  return out.sort();
}

function definedCssVars() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  return new Set((html.match(/--[a-zA-Z0-9-]+(?=\s*:)/g) || []));
}

function isCreateElement(callee) {
  return (callee.type === 'MemberExpression' && callee.object.name === 'React' && callee.property.name === 'createElement')
    || (callee.type === 'Identifier' && callee.name === 'e');
}

function isConsoleCall(node) {
  return node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.object.name === 'console';
}

function propKey(p) {
  if (p.type !== 'ObjectProperty') return null;
  if (p.key.type === 'Identifier') return p.key.name;
  if (p.key.type === 'StringLiteral') return p.key.value;
  return null;
}

// A px number from 12, '12px' or '0.75rem'; null for anything else (calc, var, '8px 8px 0 0').
function pxValue(node) {
  if (node.type === 'NumericLiteral') return node.value;
  if (node.type !== 'StringLiteral') return null;
  const m = /^\s*(\d+(?:\.\d+)?)(px|rem)?\s*$/.exec(node.value);
  if (!m) return null;
  return m[2] === 'rem' ? Number(m[1]) * 16 : Number(m[1]);
}

function scanSource(src) {
  const counts = Object.fromEntries(Object.keys(METRICS).map((k) => [k, 0]));
  const cssVars = new Set();
  const svgUnits = new WeakSet();
  const ast = parse(src, { sourceType: 'script', allowReturnOutsideFunction: true, errorRecovery: true, plugins: [] });

  const visit = (node, inConsole) => {
    if (!node || typeof node.type !== 'string') return;
    const consoleHere = inConsole || isConsoleCall(node);

    const strings = node.type === 'StringLiteral' ? [node.value]
      : node.type === 'TemplateLiteral' ? node.quasis.map((q) => q.value.cooked || '') : null;
    if (strings && !consoleHere) {
      for (const s of strings) {
        counts.hexColors += (s.match(HEX) || []).length;
        for (const m of s.matchAll(RGB)) {
          const [r, g, b] = [m[1], m[2], m[3]].map(Number);
          if (r === g && g === b) counts.rgbNeutrals += 1; else counts.rgbColors += 1;
        }
        counts.paletteClasses += (s.match(PALETTE_CLASS) || []).length;
        counts.rawTransitions += (s.match(/(?:^|[\s`'"])(?:[\w-]+:)?(?:transition-all|duration-\d+)(?=[\s`'"]|$)/g) || []).length;
        if (s.includes('...')) counts.asciiEllipsis += 1;
        // A name cut off by a template (`var(--motion-${speed})`) ends in '-': not a variable.
        for (const v of s.match(/var\(\s*(--[a-zA-Z0-9-]+)/g) || []) if (!v.endsWith('-')) cssVars.add(v.replace(/var\(\s*/, ''));
      }
    }

    if (node.type === 'BinaryExpression' && /^[!=]==?$/.test(node.operator)) {
      const [l, r] = [node.left, node.right];
      const lit = l.type === 'StringLiteral' ? l : (r.type === 'StringLiteral' ? r : null);
      const other = lit === l ? r : l;
      if (lit && PLUGIN_IDS.has(lit.value) && isPluginIdRef(other)) counts.serviceNameBranches += 1;
    }

    if (node.type === 'CallExpression') {
      const c = node.callee;
      const name = c.type === 'Identifier' ? c.name
        : (c.type === 'MemberExpression' && c.object.name === 'window' ? c.property.name : null);
      if (name === 'alert' || name === 'confirm' || name === 'prompt') counts.nativeDialogs += 1;
      if (name === 'sourceRowState') counts.trackRowCopies += 1;

      if (isCreateElement(c) && node.arguments[0] && node.arguments[0].type === 'StringLiteral') {
        const tag = node.arguments[0].value;
        const props = node.arguments[1] && node.arguments[1].type === 'ObjectExpression' ? node.arguments[1].properties : [];
        const keys = props.map(propKey);
        if (tag === 'path') counts.svgPaths += 1;
        if (tag === 'input' || tag === 'select' || tag === 'textarea') counts.inputCopies += 1;
        const cls = props.find((p) => propKey(p) === 'className');
        const classText = cls && cls.value ? src.slice(cls.value.start, cls.value.end) : '';
        if (/\banimate-spin\b|\bborder-t-transparent\b/.test(classText)) counts.spinnerCopies += 1;
        if (tag === 'button' && /\brounded-full\b/.test(classText) && /\bpx-3\b/.test(classText) && /\bpy-1(?:\.5)?\b/.test(classText)) counts.filterPillCopies += 1;
        if (tag === 'button' || tag === 'a') {
          // A Menu trigger spreads its props: Object.assign({}, t, { ... }).
          const arg = node.arguments[1];
          const own = arg && arg.type === 'CallExpression' && arg.arguments.length ? arg.arguments[arg.arguments.length - 1] : arg;
          const ps = own && own.type === 'ObjectExpression' ? own.properties : [];
          const c = ps.find((p) => propKey(p) === 'className');
          const cText = c && c.value ? src.slice(c.value.start, c.value.end) : '';
          const st = ps.find((p) => propKey(p) === 'style');
          const sText = st && st.value ? src.slice(st.value.start, st.value.end) : '';
          const byClass = /(?:^|[\s`'"])(?:p|px|py|pl|pr|pt|pb)-\d/.test(cText) && /(?:^|[\s`'"])(?:rounded(?:-\w+)?|bg-[\w[]|border(?:-\w+)?)(?=[\s`'"]|$)/.test(cText);
          // A text link drawn as a button (no padding, no fill, no border)
          // isn't a button look: "See all", an artist name, Advanced.
          const bare = /\bpadding:\s*(?:'0(?:px)?'|0)(?=[\s,}])/.test(sText)
            && !/\bbackground(?:Color)?:\s*(?!\s|'(?:none|transparent)')/.test(sText)
            && !/\bborder(?:Radius)?:\s*(?!\s|'none')/.test(sText);
          const byStyle = !bare && /\bpadding\b/.test(sText) && /\b(?:backgroundColor|background|borderRadius|border)\b/.test(sText);
          if ((byClass || byStyle) && !/buttonClassName\(|APP_PLAY_BTN|card-button-hit/.test(cText)) counts.handBuiltButtons += 1;
        }
        if (/\bsticky\b/.test(classText) && /\btop-0\b/.test(classText)) counts.stickyBarCopies += 1;
        const aria = props.find((p) => propKey(p) === 'aria-label');
        const ariaText = aria && aria.value ? (aria.value.type === 'StringLiteral' ? aria.value.value : aria.value.type === 'TemplateLiteral' ? aria.value.quasis[0].value.cooked : '') : '';
        if (/^Play from \S?/.test(ariaText) && ariaText.length > 'Play from'.length) counts.sourceButtonCopies += 1;
        for (const kid of node.arguments.slice(2)) {
          if (kid.type === 'StringLiteral' && /^(?:No|Nothing) /.test(kid.value)) counts.emptyStateCopies += 1;
        }
        if (NON_INTERACTIVE.has(tag) && keys.includes('onClick') && !keys.includes('role')) counts.clickableNonInteractive += 1;
        const roleProp = props.find((p) => propKey(p) === 'role');
        if (NON_INTERACTIVE.has(tag) && roleProp && roleProp.value && roleProp.value.value === 'button') counts.roleButtonDivs += 1;
        // Hover styling only: a handler that prefetches or shows a tooltip
        // on enter is behaviour, not drift.
        // Focus styling in JS too: a field's focus look is the shared
        // focus-visible ring (components/fields.js).
        for (const handler of ['onMouseEnter', 'onFocus']) {
          const h = props.find((p) => propKey(p) === handler);
          if (h && h.value && /\.style\b/.test(src.slice(h.value.start, h.value.end))) counts.jsHover += 1;
        }
      }
    }

    // An SVG <text>'s fontSize is in viewBox units (the "10" on the Play
    // Top 10 icon), not a CSS size: it is not on the type scale's terms.
    if (node.type === 'CallExpression' && node.arguments[0] && node.arguments[0].type === 'StringLiteral'
      && node.arguments[0].value === 'text' && node.arguments[1] && node.arguments[1].type === 'ObjectExpression') {
      for (const p of node.arguments[1].properties) if (propKey(p) === 'fontSize') svgUnits.add(p);
    }

    if (node.type === 'ObjectProperty') {
      const key = propKey(node);
      if (key === 'outline' && node.value.type === 'StringLiteral' && node.value.value === 'none') counts.inlineOutlineNone += 1;
      // An inline transition with its own times (or `all`), not the tokens.
      if (key === 'transition' && (node.value.type === 'StringLiteral' || node.value.type === 'TemplateLiteral')) {
        const text = src.slice(node.value.start, node.value.end);
        if (/\d(?:\.\d+)?m?s\b|\ball\b/.test(text)) counts.rawTransitions += 1;
      }
      if (key === 'height' && /\? '80px' : '320px'/.test(src.slice(node.value.start, node.value.end))) counts.heroCopies += 1;
      if (key === 'fontSize' && !svgUnits.has(node)) {
        const px = pxValue(node.value);
        if (px != null && !FONT_SIZES.has(px)) counts.offScaleFontSizes += 1;
      }
      if (key === 'borderRadius') {
        const px = pxValue(node.value);
        if (px != null && !RADII.has(px)) counts.offScaleRadii += 1;
      }
    }

    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'start' || k === 'end' || k === 'leadingComments' || k === 'trailingComments' || k === 'innerComments') continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach((n) => visit(n, consoleHere));
      else if (v && typeof v.type === 'string') visit(v, consoleHere);
    }
  };
  visit(ast.program, false);

  // Theme ternaries are easiest to see in the text.
  counts.themeTernaries = (src.match(THEME_TERNARY) || []).length;
  return { counts, cssVars };
}

function scan() {
  const totals = Object.fromEntries(Object.keys(METRICS).map((k) => [k, 0]));
  const byFile = {};
  const used = new Set();
  for (const file of rendererFiles()) {
    const rel = path.relative(ROOT, file);
    const { counts, cssVars } = scanSource(fs.readFileSync(file, 'utf8'));
    // The shared icon set and the brand logo kit are where paths belong;
    // svgPaths counts the copies.
    if (rel === path.join('src', 'renderer', 'components', 'icons.js')
      || rel === path.join('src', 'renderer', 'components', 'brand-logos.js')) counts.svgPaths = 0;
    for (const [metric, homes] of Object.entries(COPY_HOMES)) {
      if (homes.some((h) => rel === path.join('src', 'renderer', ...h.split('/')))) counts[metric] = 0;
    }
    byFile[rel] = counts;
    for (const k of Object.keys(totals)) totals[k] += counts[k];
    for (const v of cssVars) used.add(v);
  }
  const defined = definedCssVars();
  const undefinedCssVars = [...used].filter((v) => !defined.has(v)).sort();
  return { totals, byFile, undefinedCssVars };
}

function readBaseline() {
  return JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
}

function writeBaseline(result) {
  const data = { _readme: 'Counts from scripts/design-drift.js. Lower is better; rewrite with `npm run design-drift -- --write` only when a count falls, or rises for a reason the PR explains.', metrics: result.totals, undefinedCssVars: result.undefinedCssVars };
  fs.writeFileSync(BASELINE, JSON.stringify(data, null, 2) + '\n');
}

function topFiles(byFile, metric, n = 5) {
  return Object.entries(byFile).map(([f, c]) => [f, c[metric]]).filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]).slice(0, n);
}

module.exports = { METRICS, scan, scanSource, readBaseline, writeBaseline, topFiles, BASELINE };

if (require.main === module) {
  const result = scan();
  if (process.argv.includes('--write')) {
    writeBaseline(result);
    console.log(`Wrote ${path.relative(ROOT, BASELINE)}`);
  }
  let base = null;
  try { base = readBaseline(); } catch { /* no baseline yet */ }
  for (const [k, v] of Object.entries(result.totals)) {
    const was = base && base.metrics[k];
    const delta = was == null ? '' : v === was ? '' : ` (baseline ${was})`;
    console.log(`${k.padEnd(24)} ${String(v).padStart(5)}${delta}`);
    for (const [f, c] of topFiles(result.byFile, k, 3)) console.log(`    ${String(c).padStart(5)}  ${f}`);
  }
  console.log(`undefinedCssVars: ${result.undefinedCssVars.join(', ') || '(none)'}`);
}
