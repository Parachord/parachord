/**
 * Pages as React.memo'd modules (Track 2b state-domain split; performance:
 * every Parachord setState used to re-render the page on screen too): the
 * Collection page and the Home page. A memo only helps while every prop is stable unless its data
 * changed, and that is easy to break silently: pass one function defined in
 * the component body, or one object literal, and the page re-renders on
 * every Parachord render again with nothing failing. These tests pin it.
 */

const fs = require('fs');
const path = require('path');
const espree = require('espree');
const eslintScope = require('eslint-scope');

const ROOT = path.join(__dirname, '..', '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'app.js'), 'utf8');

global.React = global.React || require('react');
global.ReactVirtual = global.ReactVirtual || require('@tanstack/react-virtual');
const { CollectionPage, COLLECTION_PAGE_HANDLERS } = require('../../src/renderer/components/collection-page');
const { HomePage, HOME_PAGE_HANDLERS } = require('../../src/renderer/components/home-page');
const { useStableHandlers } = require('../../src/renderer/lib/stable-handlers');

const PAGES = [
  { component: 'CollectionPage', file: 'collection-page.js', handlersVar: 'collectionPageHandlers', handlers: COLLECTION_PAGE_HANDLERS, memo: CollectionPage },
  { component: 'HomePage', file: 'home-page.js', handlersVar: 'homePageHandlers', handlers: HOME_PAGE_HANDLERS, memo: HomePage },
];

describe.each(PAGES)('$component', ({ memo }) => {
  test('is React.memo', () => {
    expect(memo.$$typeof).toBe(Symbol.for('react.memo'));
  });
});

describe('useStableHandlers', () => {
  // A minimal hook harness: one component instance, re-rendered by calling
  // the hook again with the same slots.
  function harness() {
    const slots = [];
    let i = 0;
    const realReact = global.React;
    const fakeReact = {
      useRef: (init) => { const k = i++; if (!slots[k]) slots[k] = { current: init }; return slots[k]; },
      useState: (init) => { const k = i++; if (!slots[k]) slots[k] = [typeof init === 'function' ? init() : init, () => {}]; return slots[k]; },
    };
    return (latest) => {
      i = 0;
      global.React = fakeReact;
      try { return useStableHandlers(latest); } finally { global.React = realReact; }
    };
  }

  test('keeps identities across renders and always calls the latest closure', () => {
    const render = harness();
    const first = render({ handlePlay: () => 'v1', isOnAir: (x) => x + 1 });
    const second = render({ handlePlay: () => 'v2', isOnAir: (x) => x + 2 });
    expect(second).toBe(first);
    expect(second.handlePlay).toBe(first.handlePlay);
    expect(first.handlePlay()).toBe('v2');
    expect(first.isOnAir(1)).toBe(3);
  });
});

describe.each(PAGES)('$component: the app.js call site keeps every prop stable', ({ component, file, handlersVar, handlers }) => {
  const ast = espree.parse(appSrc, { ecmaVersion: 'latest', range: true, loc: true });
  const scopes = eslintScope.analyze(ast, { ecmaVersion: 2022 });

  let call = null;
  (function walk(n) {
    if (!n || typeof n.type !== 'string' || call) return;
    if (n.type === 'CallExpression' && n.arguments[0]?.type === 'Identifier' && n.arguments[0].name === component) { call = n; return; }
    for (const k in n) { const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === 'string') walk(v); }
  })(ast);

  const resolve = (identifier) => {
    for (const s of scopes.scopes) for (const r of s.references) {
      if (r.identifier === identifier) return r.resolved;
    }
    return null;
  };

  // How a value prop's variable is declared, as far as identity goes.
  const stability = (variable) => {
    const def = variable?.defs[0];
    if (!def || def.node.type !== 'VariableDeclarator') return 'unknown';
    const { id, init } = def.node;
    if (id.type === 'ArrayPattern' && init?.callee?.name === 'useState') return 'state';
    if (init?.type === 'CallExpression' && ['useRef', 'useCallback', 'useMemo', 'useStableHandlers'].includes(init.callee.name)) return init.callee.name;
    // An alias of another stable value (allResolvers = loadedResolvers).
    if (init?.type === 'Identifier') return stability(resolve(init));
    return init ? init.type : 'none';
  };

  test('the call site exists', () => {
    expect(call).not.toBeNull();
    expect(call.arguments[1].type).toBe('ObjectExpression');
  });

  test('every value prop is state, a setter, a ref, or a useCallback/useMemo result', () => {
    const unstable = [];
    for (const prop of call.arguments[1].properties) {
      if (prop.type === 'SpreadElement') continue;
      const kind = stability(resolve(prop.value));
      if (!['state', 'useRef', 'useCallback', 'useMemo'].includes(kind)) unstable.push(`${prop.key.name} (${kind})`);
    }
    expect(unstable).toEqual([]);
  });

  test('plain functions come only through the stable-handlers spread, with the documented keys', () => {
    const spread = call.arguments[1].properties.filter((p) => p.type === 'SpreadElement');
    expect(spread.map((s) => s.argument.name)).toEqual([handlersVar]);
    expect(stability(resolve(spread[0].argument))).toBe('useStableHandlers');

    let handlersCall = null;
    (function walk(n) {
      if (!n || typeof n.type !== 'string' || handlersCall) return;
      if (n.type === 'VariableDeclarator' && n.id.name === handlersVar) { handlersCall = n.init; return; }
      for (const k in n) { const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === 'string') walk(v); }
    })(ast);
    const keys = handlersCall.arguments[0].properties.map((p) => p.key.name).sort();
    expect(keys).toEqual([...handlers].sort());
  });

  test('the page destructures exactly what the call site passes', () => {
    const page = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', file), 'utf8');
    const destructure = page.match(/const \{\n([\s\S]*?)\n {2}\} = props;/)[1]
      .split('\n').map((l) => l.trim().replace(/,$/, '')).filter(Boolean).sort();
    // `_`-prefixed props are memo invalidators the page reads only through a
    // stable handler (HomePage's _metaServices); the page does not destructure them.
    const passed = call.arguments[1].properties
      .filter((p) => p.type !== 'SpreadElement' && !p.key.name.startsWith('_'))
      .map((p) => p.key.name);
    expect(destructure).toEqual([...passed, ...handlers].sort());
  });
});
