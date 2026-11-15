/**
 * #1385 step 9: one tooltip.
 * - Controls carry data-tooltip, not a native title: a title shows late,
 *   never on keyboard focus, and in the OS's look. TooltipLayer (mounted
 *   once at the app root) shows the shared .tooltip-panel for them.
 * - An icon-only control that had only a title also gets an aria-label,
 *   because the title was its accessible name.
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('@babel/parser');

const ROOT = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const rendererFiles = () => {
  const out = ['src/renderer/app.js'];
  for (const dir of ['src/renderer/components', 'src/renderer/hooks']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) if (f.endsWith('.js')) out.push(`${dir}/${f}`);
  }
  return out;
};

const isCE = (n) => n && n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.property.name === 'createElement';

function controlsWith(src, predicate) {
  const ast = parse(src, { sourceType: 'script', errorRecovery: true });
  const hits = [];
  (function walk(n) {
    if (!n || typeof n.type !== 'string') return;
    if (isCE(n) && n.arguments[0] && n.arguments[0].type === 'StringLiteral'
      && ['button', 'a', 'input'].includes(n.arguments[0].value)
      && n.arguments[1] && n.arguments[1].type === 'ObjectExpression') {
      const props = n.arguments[1].properties.filter((p) => p.type === 'ObjectProperty' && !p.computed);
      const keys = props.map((p) => p.key.name || p.key.value);
      if (predicate(keys, n)) hits.push(n.loc.start.line);
    }
    for (const k in n) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v.type === 'string') walk(v);
    }
  })(ast);
  return hits;
}

describe('controls use the shared tooltip, not a native title', () => {
  test.each(rendererFiles())('%s: no button, link or input sets title', (file) => {
    expect(controlsWith(read(file), (keys) => keys.includes('title'))).toEqual([]);
  });

  test('TooltipLayer is mounted once at the app root', () => {
    expect(read('src/renderer/app.js').match(/React\.createElement\(TooltipLayer, null\)/g)).toHaveLength(1);
  });

  test('the playbar and its tooltip-wrapped icon buttons have names', () => {
    const app = read('src/renderer/app.js');
    for (const name of ['Previous', 'Next', 'Queue', 'Back', 'Forward', 'Volume']) {
      expect(app).toContain(`'aria-label': '${name}'`);
    }
  });
});

// TooltipLayer behaviour, against a small fake document.
describe('TooltipLayer', () => {
  let listeners;
  let real;
  const slots = [];
  let i;
  let effects;
  let layout;

  const fakeReact = () => ({
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
    useEffect: (fn) => { effects.push(fn); },
    useLayoutEffect: (fn) => { layout.push(fn); },
  });

  const el = (attrs, focusVisible = true) => {
    const node = {
      isConnected: true,
      getAttribute: (k) => (k in attrs ? attrs[k] : null),
      getBoundingClientRect: () => ({ left: 100, right: 140, top: 300, bottom: 320 }),
      matches: (sel) => sel === ':focus-visible' && focusVisible,
      contains: (n) => n === node,
    };
    node.closest = (sel) => (sel === '[data-tooltip]' && 'data-tooltip' in attrs ? node : null);
    return node;
  };

  let TooltipLayer;
  const render = () => {
    i = 0; effects = []; layout = [];
    global.React = fakeReact();
    try { return TooltipLayer({ delay: 400 }); } finally { global.React = real.React; }
  };

  beforeEach(() => {
    jest.useFakeTimers();
    slots.length = 0;
    real = { React: require('react'), ReactDOM: require('react-dom') };
    global.React = real.React;
    global.ReactDOM = { createPortal: (node) => node };
    listeners = {};
    global.document = {
      body: {},
      addEventListener: (t, f) => { listeners[t] = f; },
      removeEventListener: (t) => { delete listeners[t]; },
    };
    global.window = { innerWidth: 1000, innerHeight: 800, addEventListener: () => {}, removeEventListener: () => {} };
    ({ TooltipLayer } = require('../../src/renderer/components/ui-atoms'));
    render();
    effects.forEach((fn) => fn());
  });

  afterEach(() => {
    jest.useRealTimers();
    delete global.document;
    delete global.window;
  });

  test('a hover shows the tip only after the delay', () => {
    listeners.pointerover({ target: el({ 'data-tooltip': 'Add to queue' }) });
    expect(render()).toBeNull();
    jest.advanceTimersByTime(399);
    expect(render()).toBeNull();
    jest.advanceTimersByTime(1);
    const tip = render();
    expect(tip.props.role).toBe('tooltip');
    expect(tip.props.children).toBe('Add to queue');
    expect(tip.props.className).toBe('tooltip-panel');
  });

  test('keyboard focus shows it; a mouse focus (not focus-visible) does not', () => {
    listeners.focusin({ target: el({ 'data-tooltip': 'Play' }, false) });
    jest.advanceTimersByTime(400);
    expect(render()).toBeNull();
    listeners.focusin({ target: el({ 'data-tooltip': 'Play' }, true) });
    jest.advanceTimersByTime(400);
    expect(render().props.children).toBe('Play');
  });

  test('Escape, a scroll and a click hide it', () => {
    for (const dismiss of [() => listeners.keydown({ key: 'Escape' }), () => listeners.scroll(), () => listeners.pointerdown()]) {
      listeners.pointerover({ target: el({ 'data-tooltip': 'Next' }) });
      jest.advanceTimersByTime(400);
      expect(render()).not.toBeNull();
      dismiss();
      expect(render()).toBeNull();
      listeners.pointerover({ target: el({}) });
    }
  });

  test('data-tooltip-variant="dark" uses the on-dark look; position comes from data-tooltip-position', () => {
    listeners.pointerover({ target: el({ 'data-tooltip': 'Queue', 'data-tooltip-variant': 'dark', 'data-tooltip-position': 'bottom' }) });
    jest.advanceTimersByTime(400);
    const tip = render();
    expect(tip.props.className).toBe('tooltip-panel tooltip-on-dark');
  });
});
