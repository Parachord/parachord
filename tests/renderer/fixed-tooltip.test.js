/**
 * FixedTooltip (ui-atoms.js): placement, and the show/hide rules.
 * - The clamp (right edge) and the flip (bottom edge) come from one pure
 *   function, placeFixedTooltip.
 * - Coordinates are set only by the layout effect: showing again while
 *   already visible (focus after hover) must not reset them to the unclamped
 *   spot. That was the bug.
 * - Escape dismisses it (WCAG 1.4.13); a blur with the pointer still over
 *   the trigger keeps it.
 */
global.React = require('react');
global.ReactDOM = require('react-dom');
const { renderToStaticMarkup } = require('react-dom/server');
const { Tooltip, FixedTooltip, placeFixedTooltip, placeTooltip, TOOLTIP_DELAY_MS } = require('../../src/renderer/components/ui-atoms');

const view = { width: 1000, height: 800 };
const tip = { width: 200, height: 60 };

describe('placeFixedTooltip', () => {
  test('below the trigger, left-aligned, when it fits', () => {
    expect(placeFixedTooltip({ left: 100, top: 100, bottom: 120 }, tip, view)).toEqual({ left: 100, top: 126 });
  });
  test('clamped inside the right edge', () => {
    expect(placeFixedTooltip({ left: 900, top: 100, bottom: 120 }, tip, view).left).toBe(1000 - 200 - 8);
  });
  test('never past the left margin', () => {
    expect(placeFixedTooltip({ left: -40, top: 100, bottom: 120 }, tip, view).left).toBe(8);
  });
  test('flipped above the trigger when it would pass the bottom', () => {
    expect(placeFixedTooltip({ left: 100, top: 760, bottom: 780 }, tip, view).top).toBe(760 - 6 - 60);
  });
  test('a flip never goes above the top margin', () => {
    expect(placeFixedTooltip({ left: 100, top: 20, bottom: 790 }, tip, view).top).toBe(8);
  });
});

// A hook harness: one instance, effects run on demand, the portal rendered
// inline so the tree can be inspected.
function harness() {
  const slots = [];
  let i = 0;
  let layout = [];
  let effects = [];
  const real = { React: global.React, ReactDOM: global.ReactDOM };
  const listeners = {};
  const doc = {
    body: {},
    addEventListener: (t, f) => { listeners[t] = f; },
    removeEventListener: (t) => { delete listeners[t]; },
  };
  const fake = {
    ...real.React,
    useState: (init) => {
      const k = i++;
      if (!slots[k]) {
        const slot = [init];
        slot[1] = (v) => { slot[0] = typeof v === 'function' ? v(slot[0]) : v; };
        slots[k] = slot;
      }
      return [slots[k][0], slots[k][1]];
    },
    useRef: (init) => { const k = i++; if (!slots[k]) slots[k] = { current: init }; return slots[k]; },
    useLayoutEffect: (fn) => { layout.push(fn); },
    useEffect: (fn) => { effects.push(fn); },
  };
  const triggerRect = { left: 900, top: 100, bottom: 120 };
  // FixedTooltip's props as it passes them to Tooltip; delay 0 so a show is
  // immediate (the delay has its own test).
  let props = { content: 'Because you love slowcore', id: 'tip-1', children: 'x', position: 'bottom-start', block: true, note: true, delay: 0 };
  const render = () => {
    global.React = fake;
    global.ReactDOM = { createPortal: (el) => el };
    global.document = doc;
    global.window = { innerWidth: view.width, innerHeight: view.height };
    layout = []; effects = [];
    try {
      i = 0;
      const tree = Tooltip(props);
      // Attach the refs the DOM would.
      slots[4].current = { getBoundingClientRect: () => triggerRect };
      const tipEl = [].concat(tree.props.children).find((c) => c && c.props && c.props.role === 'tooltip');
      if (tipEl) slots[5].current = { getBoundingClientRect: () => tip };
      return tree;
    } finally {
      global.React = real.React;
      global.ReactDOM = real.ReactDOM;
    }
  };
  const commit = () => {
    const tree = render();
    layout.forEach((fn) => fn());
    effects.forEach((fn) => fn());
    return tree;
  };
  // Render until state settles, as React does after a layout-effect update.
  const settle = () => { commit(); commit(); return render(); };
  const tipOf = (tree) => [].concat(tree.props.children).find((c) => c && c.props && c.props.role === 'tooltip') || null;
  const cleanup = () => { delete global.document; delete global.window; };
  return { render, settle, tipOf, listeners, cleanup };
}

describe('FixedTooltip behaviour', () => {
  test('hover shows it clamped; a focus while visible keeps the clamp', () => {
    const t = harness();
    try {
      t.render().props.onMouseEnter();
      let tree = t.settle();
      expect(t.tipOf(tree).props.style).toMatchObject({ left: 1000 - 200 - 8, top: 126, visibility: 'visible' });
      tree.props.onFocus();
      tree = t.settle();
      expect(t.tipOf(tree).props.style).toMatchObject({ left: 792, top: 126 });
    } finally { t.cleanup(); }
  });

  test('the first, measuring render is hidden until placed', () => {
    const t = harness();
    try {
      t.render().props.onMouseEnter();
      expect(t.tipOf(t.render()).props.style.visibility).toBe('hidden');
    } finally { t.cleanup(); }
  });

  test('role="tooltip" with the given id', () => {
    const t = harness();
    try {
      t.render().props.onMouseEnter();
      const tipEl = t.tipOf(t.settle());
      expect(tipEl.props.role).toBe('tooltip');
      expect(tipEl.props.id).toBe('tip-1');
    } finally { t.cleanup(); }
  });

  test('Escape dismisses it; hovering again re-arms it', () => {
    const t = harness();
    try {
      t.render().props.onMouseEnter();
      t.settle();
      t.listeners.keydown({ key: 'Escape' });
      let tree = t.settle();
      expect(t.tipOf(tree)).toBeNull();
      tree.props.onMouseLeave();
      t.settle().props.onMouseEnter();
      expect(t.tipOf(t.settle())).not.toBeNull();
    } finally { t.cleanup(); }
  });

  test('a blur while the pointer is still over the trigger keeps it', () => {
    const t = harness();
    try {
      let tree = t.render();
      tree.props.onMouseEnter();
      tree = t.settle();
      tree.props.onFocus();
      tree = t.settle();
      tree.props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: null });
      tree = t.settle();
      expect(t.tipOf(tree)).not.toBeNull();
      tree.props.onMouseLeave();
      expect(t.tipOf(t.settle())).toBeNull();
    } finally { t.cleanup(); }
  });

  test('focus alone shows it; blurring out hides it', () => {
    const t = harness();
    try {
      t.render().props.onFocus();
      let tree = t.settle();
      expect(t.tipOf(tree)).not.toBeNull();
      tree.props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: null });
      expect(t.tipOf(t.settle())).toBeNull();
    } finally { t.cleanup(); }
  });
});

describe('placeTooltip', () => {
  const r = { left: 400, right: 440, top: 300, bottom: 320 };
  test('top: centred above', () => {
    expect(placeTooltip(r, tip, view, 'top')).toEqual({ left: 320, top: 300 - 6 - 60 });
  });
  test('top flips below when there is no room above', () => {
    expect(placeTooltip({ ...r, top: 10, bottom: 30 }, tip, view, 'top').top).toBe(36);
  });
  test('top-end: right-aligned with the trigger', () => {
    expect(placeTooltip(r, tip, view, 'top-end').left).toBe(440 - 200);
  });
  test('bottom: centred below, flipped above at the bottom edge', () => {
    expect(placeTooltip(r, tip, view, 'bottom')).toEqual({ left: 320, top: 326 });
    expect(placeTooltip({ ...r, top: 760, bottom: 780 }, tip, view, 'bottom').top).toBe(760 - 6 - 60);
  });
  test('a centred tip near the right edge is clamped inside it', () => {
    expect(placeTooltip({ left: 960, right: 990, top: 300, bottom: 320 }, tip, view, 'top').left).toBe(1000 - 200 - 8);
  });
  test('left and right flip to the other side when they would leave the window', () => {
    expect(placeTooltip({ left: 20, right: 60, top: 300, bottom: 320 }, tip, view, 'left').left).toBe(66);
    expect(placeTooltip({ left: 900, right: 940, top: 300, bottom: 320 }, tip, view, 'right').left).toBe(900 - 6 - 200);
  });
});

describe('Tooltip delay', () => {
  test('waits TOOLTIP_DELAY_MS (400) before showing', () => {
    expect(TOOLTIP_DELAY_MS).toBe(400);
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/components/ui-atoms.js'), 'utf8');
    expect(src).toMatch(/setTimeout\(\(\) => setWaited\(true\), delay\)/);
    expect(src).toMatch(/const visible = wanted && \(delay <= 0 \|\| waited\)/);
  });
});

describe('Tooltip markup', () => {
  test('wraps its trigger in .tooltip-container with no tip until shown', () => {
    const html = renderToStaticMarkup(React.createElement(Tooltip, { content: 'Next', variant: 'dark', className: 'tooltip-fill' },
      React.createElement('button', null, 'n')));
    expect(html).toBe('<div class="tooltip-container tooltip-fill"><button>n</button></div>');
  });
  test('the CSS-only hover rules are gone; the tip is a portalled panel', () => {
    const html = require('fs').readFileSync(require('path').join(__dirname, '../../index.html'), 'utf8');
    expect(html).not.toMatch(/\.tooltip-container:hover/);
    expect(html).toMatch(/\.tooltip-panel \{\s*position: fixed;/);
  });
});

describe('FixedTooltip markup', () => {
  test('renders its children with no tip until shown (the other call sites)', () => {
    const html = renderToStaticMarkup(React.createElement(FixedTooltip, { content: 'why' },
      React.createElement('div', null, React.createElement('h3', null, 'Title'))));
    expect(html).toBe('<div style="position:relative"><div><h3>Title</h3></div></div>');
  });
});
