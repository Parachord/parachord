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
const { SERVICE_LOGO_PATHS, SERVICE_LOGO_IMAGES, ResolverIcon, SERVICE_LOGOS } = require('./brand-logos');

// The post-mount React-tree loader (AnimatedLoadingWordmark) used to live
// here, with a duplicate copy of the index.html splash SVG so the React
// tree could keep showing the wordmark while cache loaded. It was removed
// when the splash moved to a body-level overlay (#parachord-splash in
// index.html) that survives React mount — the overlay is now the only
// loader visual; the React tree renders null underneath until cacheLoaded.

const ParachordWordmark = ({ fill = 'black', height = 40 }) => React.createElement('svg', {
  viewBox: '0 0 1046 273',
  style: {
    height: height + 'px',
    width: 'auto',
    display: 'block',
    backfaceVisibility: 'hidden',
    WebkitBackfaceVisibility: 'hidden'
  },
  fill: 'none',
  xmlns: 'http://www.w3.org/2000/svg',
  preserveAspectRatio: 'xMidYMid meet'
},
  React.createElement('path', { d: 'M764.5 102.5C788.725 102.5 809.5 123.347 809.5 150.5C809.5 177.654 788.725 198.5 764.5 198.5C740.275 198.5 719.5 177.654 719.5 150.5C719.5 123.347 740.275 102.5 764.5 102.5Z', stroke: fill, strokeWidth: 27 }),
  React.createElement('path', { d: 'M237.5 102.5C261.725 102.5 282.5 123.347 282.5 150.5C282.5 177.654 261.725 198.5 237.5 198.5C213.275 198.5 192.5 177.654 192.5 150.5C192.5 123.347 213.275 102.5 237.5 102.5Z', stroke: fill, strokeWidth: 27 }),
  React.createElement('rect', { x: 271, y: 89.0005, width: 25, height: 123, fill: fill }),
  React.createElement('path', { d: 'M424.5 102.5C448.725 102.5 469.5 123.347 469.5 150.5C469.5 177.654 448.725 198.5 424.5 198.5C400.275 198.5 379.5 177.654 379.5 150.5C379.5 123.347 400.275 102.5 424.5 102.5Z', stroke: fill, strokeWidth: 27 }),
  React.createElement('rect', { x: 458, y: 89.0005, width: 25, height: 123, fill: fill }),
  React.createElement('rect', { x: 307, y: 152, width: 27, height: 60, fill: fill }),
  React.createElement('path', { d: 'M307 152C307 117.207 333.191 89.0005 365.5 89.0005C365.667 89.0005 365.833 89.0029 366 89.0044L366 116.008C365.833 116.005 365.667 116 365.5 116C350.195 116 334.499 129.759 334.012 150.984L334 152L307 152Z', fill: fill }),
  React.createElement('rect', { x: 828, y: 152, width: 27, height: 60, fill: fill }),
  React.createElement('path', { d: 'M828 152C828 117.207 854.191 89.0005 886.5 89.0005C886.667 89.0005 886.833 89.0029 887 89.0044L887 116.008C886.833 116.005 886.667 116 886.5 116C871.195 116 855.499 129.759 855.012 150.984L855 152L828 152Z', fill: fill }),
  React.createElement('rect', { x: 676, y: 152, width: 25, height: 60, fill: fill }),
  React.createElement('rect', { x: 597, y: 45.8784, width: 25, height: 165, fill: fill }),
  React.createElement('path', { d: 'M622 38.0005V50.5005L597 45.8784L622 38.0005Z', fill: fill }),
  React.createElement('path', { d: 'M648.702 96.0005C675.533 96.0005 698.054 122.271 700.898 156H675.816C673.171 131.764 657.459 121 648.702 121C640.176 121 624.661 131.504 622.075 156H597C599.787 122.271 621.871 96.0005 648.702 96.0005Z', fill: fill }),
  React.createElement('path', { d: 'M547.5 92.0005C565.823 92.0005 582.177 100.857 592.903 114.719L569.128 128.445C563.289 122.472 555.491 119 547.5 119C531.36 119 516 133.158 516 153.5C516 173.843 531.36 188 547.5 188C554.915 188 562.163 185.011 567.835 179.808L591.812 193.651C581.084 206.724 565.212 215 547.5 215C515.191 215 489 187.466 489 153.5C489 119.535 515.191 92.0005 547.5 92.0005Z', fill: fill }),
  React.createElement('rect', { x: 1004.01, y: 151.398, width: 25, height: 100.266, transform: 'rotate(-180 1004.01 151.398)', fill: fill }),
  React.createElement('path', { d: 'M1039.72 33.8887C1042.39 35.348 1042.43 39.1612 1039.8 40.6846L984.893 72.4893C982.313 73.9831 979.08 72.1478 979.039 69.167L978.192 6.85254C978.152 3.86674 981.345 1.94449 983.965 3.37793L1039.72 33.8887Z', fill: '#E12949', stroke: 'white', strokeWidth: 0.2 }),
  React.createElement('path', { d: 'M945.5 102.5C969.725 102.5 990.5 123.347 990.5 150.5C990.5 177.654 969.725 198.5 945.5 198.5C921.275 198.5 900.5 177.654 900.5 150.5C900.5 123.347 921.275 102.5 945.5 102.5Z', stroke: fill, strokeWidth: 27 }),
  React.createElement('path', { d: 'M945.5 102.5C969.725 102.5 990.5 123.347 990.5 150.5C990.5 177.654 969.725 198.5 945.5 198.5C921.275 198.5 900.5 177.654 900.5 150.5C900.5 123.347 921.275 102.5 945.5 102.5Z', stroke: fill, strokeOpacity: 0.2, strokeWidth: 27 }),
  React.createElement('path', { d: 'M59 260.805L59 242.676M59 203.856L59 224.803', stroke: 'white', strokeWidth: 0.2, strokeLinecap: 'round' }),
  React.createElement('path', { d: 'M7.29194 100.001C7.32449 100.03 7.16169 101.377 6.90132 102.986C6.08765 108.341 5.46898 114.633 5.14351 121.363C4.16715 140.559 7.45444 156.098 14.3544 165.316C18.3253 170.612 26.072 175.44 40.8486 181.878C49.0502 185.448 52.3379 187.262 56.2109 190.334L58.8476 192.412V186.211H63.4042C63.4041 257.673 63.3388 265.772 62.8837 266.359C62.5258 266.827 62.0696 267.002 61.1259 267.002C59.0103 267.002 58.8476 266.534 58.8476 260.477V255.238L57.1875 252.722C54.0629 247.923 51.0032 244.411 46.5117 240.373C41.6947 236.042 38.3425 233.818 32.6142 231.126C26.3002 228.112 22.6871 225.742 18.5537 221.821C8.39888 212.194 2.14945 198.528 0.261671 181.761C-0.226521 177.518 0.0335781 163.501 0.684523 158.994C1.0425 156.39 1.07508 155.512 0.684523 153.288C0.0336106 149.542 -0.226209 135.731 0.229445 130.902C1.01061 122.738 3.06059 113.081 5.8271 104.215C6.57471 101.848 7.22547 99.9476 7.29194 100.001ZM5.66499 172.338C6.28338 178.015 7.8456 184.628 9.53804 188.871C12.4673 196.187 16.0803 200.635 22.3945 204.673C27.8298 208.184 31.7356 210.145 44.2011 215.588C46.6096 216.641 49.7671 218.222 51.1992 219.07C52.6312 219.89 54.9417 221.587 56.3085 222.757L58.8476 224.952V223.986C58.8475 223.372 58.2943 222.143 57.3505 220.651C51.492 211.433 42.7362 203.649 33.1347 199.113C30.9543 198.089 28.1881 196.656 26.9511 195.924C18.4889 190.891 11.8166 183.341 6.5439 172.777L5.43648 170.582L5.66499 172.338Z', fill: '#767575' }),
  React.createElement('path', { d: 'M115.5 102.5C139.725 102.5 160.5 123.346 160.5 150.5C160.5 177.654 139.725 198.5 115.5 198.5C91.2754 198.5 70.5 177.654 70.5 150.5C70.5 123.346 91.2754 102.5 115.5 102.5Z', stroke: fill, strokeWidth: 27 }),
  React.createElement('path', { d: 'M82 256.261L57 272.5L57 255.66L57 238.819L82 256.261Z', fill: fill }),
  React.createElement('rect', { x: 57, y: 148, width: 25, height: 108.261, fill: fill })
);

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
  const slider = React.createElement('input', {
    type: 'range',
    min: '0',
    max: duration || 100,
    value: shown,
    disabled: seekDisabled,
    // A screen reader hears "Seek, 1:23 of 4:56", not a raw number.
    'aria-label': 'Seek',
    'aria-valuetext': hasTrack && !browserPlaybackActive && duration
      ? `${formatTime(shown)} of ${formatTime(duration)}` : 'Nothing playing',
    onChange: (e) => onSeek(Number(e.target.value)),
    className: `progress-slider w-full h-1 rounded-full ${seekDisabled ? 'opacity-50' : ''}`
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
