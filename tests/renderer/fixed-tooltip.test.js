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
const { FixedTooltip, placeFixedTooltip } = require('../../src/renderer/components/ui-atoms');

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
  let props = { content: 'Because you love slowcore', id: 'tip-1', children: 'x' };
  const render = () => {
    global.React = fake;
    global.ReactDOM = { createPortal: (el) => el };
    global.document = doc;
    global.window = { innerWidth: view.width, innerHeight: view.height };
    layout = []; effects = [];
    try {
      i = 0;
      const tree = FixedTooltip(props);
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

describe('FixedTooltip markup', () => {
  test('renders its children with no tip until shown (the other call sites)', () => {
    const html = renderToStaticMarkup(React.createElement(FixedTooltip, { content: 'why' },
      React.createElement('div', null, React.createElement('h3', null, 'Title'))));
    expect(html).toBe('<div style="position:relative"><div><h3>Title</h3></div></div>');
  });
});
