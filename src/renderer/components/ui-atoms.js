// src/renderer/components/ui-atoms.js — the leaf UI atoms, extracted from
// app.js's module scope (maintainability plan Track 2b, presentational slice 1).
//
// All props-driven, no app state; memoized where they were memoized before the
// move (React is the renderer's vendor global — loaded by index.html before the
// bundle, never bundled). SERVICE_LOGO_PATHS/IMAGES/LOGOS + ResolverIcon are the
// resolver-badge kit; Tooltip/FixedTooltip the two tooltip shells;
// ParachordWordmark the splash/about wordmark; PlaybackProgress the playbar's
// isolated progress leaf (parachord#768 — progress ticks re-render only it).

const { Button } = require('./button');
const Icons = require('./icons');
const { Slider } = require('./fields');

// Tooltip (#1385 step 9): the one tooltip. There used to be two: a
// CSS-only Tooltip (hover only, clipped by any overflow:hidden parent, shown
// at once) and FixedTooltip (portal-positioned, shown on focus too). This is
// FixedTooltip's behaviour with Tooltip's look:
//   - the tip is portalled to <body> and position:fixed, so no overflow
//     clips it; placeTooltip keeps it inside the window and flips it when
//     its side has no room
//   - it shows on hover and on keyboard focus inside the trigger, after
//     `delay` ms (400), and stays while either lasts
//   - Escape (WCAG 1.4.13) or a scroll dismisses it until the pointer or
//     focus comes back
//   - role="tooltip"; a single element child gets aria-describedby while it
//     shows
// Props: content, position ('top' | 'top-end' | 'bottom' | 'bottom-start' |
// 'left' | 'right'), variant ('light' | 'dark': an outline on the always-dark
// surfaces), className ('tooltip-fill' caps the trigger at its column so a
// truncating child still ellipsizes; 'tooltip-bio' wraps long text), id,
// delay. The look is the .tooltip-panel classes in index.html.

// Where the tip goes for a position. Pure, so the clamp and the flips are
// tested without a DOM.
const placeTooltip = (rect, tip, view, position = 'top', margin = 8, gap = 6) => {
  const clampX = (x) => Math.max(margin, Math.min(x, view.width - tip.width - margin));
  const clampY = (y) => Math.max(margin, Math.min(y, view.height - tip.height - margin));
  const width = rect.right != null ? rect.right - rect.left : 0;
  const height = rect.bottom - rect.top;
  const above = rect.top - gap - tip.height;
  const below = rect.bottom + gap;
  const fitsAbove = above >= margin;
  const fitsBelow = below + tip.height <= view.height - margin;
  switch (position) {
    case 'bottom-start':
      return { left: clampX(rect.left), top: fitsBelow ? below : Math.max(margin, above) };
    case 'bottom':
      return { left: clampX(rect.left + width / 2 - tip.width / 2), top: fitsBelow || !fitsAbove ? below : above };
    case 'top-end':
      return { left: clampX(rect.right - tip.width), top: fitsAbove || !fitsBelow ? Math.max(margin, above) : below };
    case 'left': {
      const x = rect.left - gap - tip.width;
      return { left: x >= margin ? x : clampX(rect.right + gap), top: clampY(rect.top + height / 2 - tip.height / 2) };
    }
    case 'right': {
      const x = rect.right + gap;
      return { left: x + tip.width <= view.width - margin ? x : clampX(rect.left - gap - tip.width), top: clampY(rect.top + height / 2 - tip.height / 2) };
    }
    case 'top':
    default:
      return { left: clampX(rect.left + width / 2 - tip.width / 2), top: fitsAbove || !fitsBelow ? Math.max(margin, above) : below };
  }
};

// The old FixedTooltip placement: below the trigger, left-aligned, flipped
// above at the bottom edge.
const placeFixedTooltip = (rect, tip, view, margin = 8, gap = 6) => placeTooltip(rect, tip, view, 'bottom-start', margin, gap);

let tooltipSeq = 0;
const TOOLTIP_DELAY_MS = 400;

const Tooltip = ({ children, content, position = 'top', variant = 'light', className = '', id, delay = TOOLTIP_DELAY_MS, block = false, note = false }) => {
  const [hover, setHover] = React.useState(false);
  const [focus, setFocus] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);
  const [coords, setCoords] = React.useState(null);
  const triggerRef = React.useRef(null);
  const tipRef = React.useRef(null);
  const [waited, setWaited] = React.useState(false);
  const autoId = React.useRef(null);
  if (!autoId.current) autoId.current = `tooltip-${++tooltipSeq}`;
  const tipId = id || autoId.current;
  const wanted = (hover || focus) && !dismissed && !!content;
  const visible = wanted && (delay <= 0 || waited);

  React.useEffect(() => {
    if (!wanted) { setWaited(false); return undefined; }
    if (delay <= 0 || waited) return undefined;
    const t = setTimeout(() => setWaited(true), delay);
    return () => clearTimeout(t);
  }, [wanted, delay, waited]);

  React.useLayoutEffect(() => {
    if (!visible) {
      setCoords(null);
      return;
    }
    if (!tipRef.current || !triggerRef.current) return;
    const next = placeTooltip(
      triggerRef.current.getBoundingClientRect(),
      tipRef.current.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
      position
    );
    setCoords((c) => (c && c.left === next.left && c.top === next.top ? c : next));
  }, [visible, content, position]);

  React.useEffect(() => {
    if (!visible) return undefined;
    const onKey = (ev) => { if (ev.key === 'Escape') setDismissed(true); };
    // A fixed tip would stay put while its trigger scrolls away.
    const onScroll = () => setDismissed(true);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [visible]);

  const single = React.isValidElement(children) && !Array.isArray(children);
  const trigger = visible && single
    ? React.cloneElement(children, {
      'aria-describedby': [children.props['aria-describedby'], tipId].filter(Boolean).join(' '),
    })
    : children;

  const panelClass = [
    'tooltip-panel',
    variant === 'dark' ? 'tooltip-on-dark' : '',
    note ? 'tooltip-note' : '',
    /\btooltip-bio\b/.test(className) ? 'tooltip-wrap' : '',
  ].filter(Boolean).join(' ');

  return React.createElement('div', Object.assign({
    ref: triggerRef,
    onMouseEnter: () => { setHover(true); setDismissed(false); },
    onMouseLeave: () => setHover(false),
    // Keyboard focus anywhere inside shows it too (React's focus events bubble).
    onFocus: () => { if (!focus) setDismissed(false); setFocus(true); },
    onBlur: (ev) => {
      if (!ev.currentTarget.contains(ev.relatedTarget)) setFocus(false);
    },
  }, block
    ? { style: { position: 'relative' } }
    : { className: `tooltip-container ${className}`.trim() }),
    trigger,
    visible && ReactDOM.createPortal(
      React.createElement('div', {
        ref: tipRef,
        id: tipId,
        role: 'tooltip',
        className: panelClass,
        style: {
          top: coords ? coords.top : 0,
          left: coords ? coords.left : 0,
          // Unplaced (the first, measuring render) it stays hidden.
          visibility: coords ? 'visible' : 'hidden',
        }
      }, content),
      document.body
    )
  );
};

// FixedTooltip: the Tooltip for a card's explanation (Fresh Drops' "why",
// Recommendations' reason): below and left-aligned, wrapping, block trigger.
const FixedTooltip = ({ children, content, id, delay }) => React.createElement(Tooltip, {
  content, id, delay, position: 'bottom-start', block: true, note: true,
}, children);

// TooltipLayer: the Tooltip for a control that has no wrapper. Mounted once
// at the app root; any element with data-tooltip="…" gets the same panel,
// the same 400ms delay, keyboard focus (focus-visible only, so a click
// doesn't leave one up), Escape and scroll dismissal. This is what replaced
// the native `title` on controls (#1385 step 9): a title showed late, never
// on focus, and in the OS's look. data-tooltip-position picks a side (top by
// default); data-tooltip-variant="dark" is for the always-dark surfaces.
const tooltipTarget = (node) => (node && node.closest ? node.closest('[data-tooltip]') : null);

const TooltipLayer = ({ delay = TOOLTIP_DELAY_MS }) => {
  const [tip, setTip] = React.useState(null);
  const [coords, setCoords] = React.useState(null);
  const tipRef = React.useRef(null);
  const timer = React.useRef(null);
  const current = React.useRef(null);

  React.useEffect(() => {
    const hide = () => {
      clearTimeout(timer.current);
      current.current = null;
      setTip(null);
    };
    const arm = (el) => {
      if (current.current === el) return;
      clearTimeout(timer.current);
      current.current = el;
      setTip(null);
      const text = el.getAttribute('data-tooltip');
      if (!text) return;
      timer.current = setTimeout(() => {
        if (current.current !== el || !el.isConnected) return;
        setTip({
          el,
          text: el.getAttribute('data-tooltip'),
          position: el.getAttribute('data-tooltip-position') || 'top',
          dark: el.getAttribute('data-tooltip-variant') === 'dark',
        });
      }, delay);
    };
    const onOver = (ev) => {
      const el = tooltipTarget(ev.target);
      if (el) arm(el);
      else if (current.current) hide();
    };
    const onFocusIn = (ev) => {
      const el = tooltipTarget(ev.target);
      if (el && ev.target.matches && ev.target.matches(':focus-visible')) arm(el);
    };
    const onFocusOut = (ev) => { if (current.current && current.current.contains(ev.target)) hide(); };
    const onKey = (ev) => { if (ev.key === 'Escape' && current.current) hide(); };
    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      clearTimeout(timer.current);
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, [delay]);

  React.useLayoutEffect(() => {
    if (!tip) { setCoords(null); return; }
    if (!tipRef.current) return;
    setCoords(placeTooltip(
      tip.el.getBoundingClientRect(),
      tipRef.current.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
      tip.position
    ));
  }, [tip]);

  if (!tip) return null;
  return ReactDOM.createPortal(
    React.createElement('div', {
      ref: tipRef,
      role: 'tooltip',
      className: `tooltip-panel${tip.dark ? ' tooltip-on-dark' : ''}`,
      style: { top: coords ? coords.top : 0, left: coords ? coords.left : 0, visibility: coords ? 'visible' : 'hidden' },
    }, tip.text),
    document.body
  );
};

// The service logo kit (SERVICE_LOGO_PATHS / _IMAGES / SERVICE_LOGOS,
// ResolverIcon) lives in components/brand-logos.js; re-exported below.
const { SERVICE_LOGO_PATHS, SERVICE_LOGO_IMAGES, ResolverIcon, SERVICE_LOGOS, ParachordWordmark } = require('./brand-logos');

// ParachordWordmark lives in components/brand-logos.js (re-exported below).

// PlaybackProgress — the playbar's elapsed-time / seek-slider / duration section,
// isolated as a memoized leaf so playback progress ticks re-render ONLY this
// small component instead of the whole Parachord tree (parachord#768). It owns a
// local `value` state seeded from `initialProgress` and updated by subscribing to
// the progress emitter via `subscribe`. Everything else (track/resolver/seek
// state) is static-per-track and arrives via props, so it changes at most on
// track/playback-method change — never on a tick.
const PlaybackProgress = React.memo(function PlaybackProgress({
  subscribe, initialProgress, hasTrack, browserPlaybackActive,
  duration, seekDisabled, seekTooltip, onSeek, formatTime
}) {
  const [value, setValue] = React.useState(initialProgress || 0);
  React.useEffect(() => subscribe(setValue), [subscribe]);

  const shown = hasTrack && !browserPlaybackActive ? value : 0;
  const slider = React.createElement(Slider, {
    tone: 'dark',
    min: 0,
    max: duration || 100,
    value: shown,
    disabled: seekDisabled,
    // A screen reader hears "Seek, 1:23 of 4:56", not a raw number.
    'aria-label': 'Seek',
    'aria-valuetext': hasTrack && !browserPlaybackActive && duration
      ? `${formatTime(shown)} of ${formatTime(duration)}` : 'Nothing playing',
    onChange: (v) => onSeek(v),
    className: `w-full ${seekDisabled ? 'opacity-50' : ''}`
  });
  // Shrinks to 120px in a narrow window (was a 200px minimum, which pushed
  // the playbar's right-hand controls off-screen below ~1120px).
  return React.createElement('div', { className: 'flex items-center gap-2', style: { minWidth: '120px' } },
    React.createElement('span', {
      className: 'text-xs text-on-dark-secondary tabular-nums',
      style: { width: '36px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', lineHeight: '1' }
    }, hasTrack && !browserPlaybackActive ? formatTime(shown) : '0:00'),
    React.createElement('div', { className: 'flex-1 w-24 flex items-center' },
      seekTooltip
        ? React.createElement(Tooltip, { content: seekTooltip, position: 'top', variant: 'dark' }, slider)
        : slider
    ),
    React.createElement('span', {
      className: 'text-xs text-on-dark-secondary tabular-nums',
      style: { width: '36px', textAlign: 'left', fontVariantNumeric: 'tabular-nums', lineHeight: '1' }
    }, hasTrack ? formatTime(duration) : '0:00')
  );
});

// ShareButton — the Share control under the album and playlist art: the
// shared secondary Button (small), with the Share icon. `open` keeps the
// hover look while its menu is showing. It is Menu's trigger
// (components/menu.js): renderTrigger passes its props straight through.
const ShareButton = ({ open = false, ...triggerProps }) => {
  return React.createElement(Button, Object.assign({}, triggerProps, {
    variant: 'secondary', size: 'sm',
    className: open ? '!bg-surface-hover' : undefined,
  }),
    React.createElement(Icons.Share, { className: 'w-4 h-4', 'aria-hidden': 'true' }),
    'Share'
  );
};

module.exports = {
  Tooltip, FixedTooltip, TooltipLayer, placeFixedTooltip, placeTooltip, TOOLTIP_DELAY_MS, SERVICE_LOGO_PATHS, SERVICE_LOGO_IMAGES,
  ResolverIcon, SERVICE_LOGOS,
  ParachordWordmark, PlaybackProgress, ShareButton,
};
