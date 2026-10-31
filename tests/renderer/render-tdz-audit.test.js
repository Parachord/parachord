/**
 * Render-evaluated TDZ audit (deps arrays).
 *
 * Why this exists instead of an eslint rule: app.js's house style contains
 * many *legal* forward references — effect/handlers bodies routinely call
 * arrow-function consts declared later in `Parachord`'s body. Those run at
 * commit/invoke time, after the whole render body has executed, so they are
 * TDZ-safe. eslint's `no-use-before-define` cannot distinguish those from
 * render-evaluated references, and `no-undef` cannot see temporal order at
 * all, so neither can guard this class. (Observed crash, 2026-10-31: a
 * spinoff-availability effect's deps array at L6039 named `spinoffMode`,
 * whose `const [spinoffMode, setSpinoffMode]` declaration the extraction
 * had placed at L7163 — `ReferenceError: Cannot access 'spinoffMode' before
 * initialization` at first render.)
 *
 * The provable invariant: the SECOND ARGUMENT of useEffect/useMemo/
 * useCallback (the deps array) is evaluated DURING render, at the call
 * itself. Every identifier it names must therefore be resolvable to a
 * declaration statement that appears ABOVE the hook call in `Parachord`'s
 * body (or at module scope). This audit fails on any violation.
 */

const espree = require('espree');
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js');
const appSource = fs.readFileSync(APP, 'utf8');
const program = espree.parse(appSource, { ecmaVersion: 2022, sourceType: 'script', loc: true });

// Reuse the declaration-index shape from the engine-wiring AST audit: module
// scope + Parachord-body top level, with Object/Array patterns unwrapped.
function declarationLines() {
  const decls = new Map();
  const body = program.body;
  const parachord = body.find((n) => n.type === 'VariableDeclaration'
    && n.declarations.some((d) => d.id.type === 'Identifier' && d.id.name === 'Parachord'));
  const innerBody = (parachord && parachord.declarations[0].init.body.body) || [];
  const record = (name, line) => { if (name && !decls.has(name)) decls.set(name, line); };
  for (const stmts of [body, innerBody]) {
    for (const stmt of stmts) {
      if (stmt.type === 'VariableDeclaration') {
        for (const d of stmt.declarations) {
          if (d.id.type === 'Identifier') record(d.id.name, stmt.loc.start.line);
          else if (d.id.type === 'ObjectPattern' || d.id.type === 'ArrayPattern') {
            for (const p of (d.id.properties || d.id.elements || [])) {
              record(p && (p.value ? p.value.name : p.name), stmt.loc.start.line);
            }
          }
        }
      } else if (stmt.type === 'FunctionDeclaration' && stmt.id) {
        record(stmt.id.name, stmt.loc.start.line);
      }
    }
  }
  return { decls, innerBody };
}

const GLOBALS = new Set([
  'window', 'document', 'console', 'navigator', 'location', 'localStorage',
  'Object', 'Array', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'JSON', 'Math', 'Date',
  'Number', 'String', 'Boolean', 'Symbol', 'Intl', 'Blob', 'File', 'FormData',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  'cancelAnimationFrame', 'URL', 'URLSearchParams', 'fetch', 'Audio', 'Image',
  'React', 'undefined', 'NaN', 'Infinity',
]);

// Walks only identifiers that contribute a VALUE (not property-key positions,
// not callee-less member-property names).
function* valueIdentifiers(node, skipProps) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) yield* valueIdentifiers(n, skipProps);
    return;
  }
  switch (node.type) {
    case 'Identifier':
      if (!skipProps) yield node;
      return;
    case 'MemberExpression':
    case 'OptionalMemberExpression':
      yield* valueIdentifiers(node.object);
      if (node.computed) yield* valueIdentifiers(node.property);
      return;
    // Function expressions inside deps would be malformed deps anyway; treat
    // their *bodies* as non-render-evaluated and skip.
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
      return;
    default:
      for (const k of Object.keys(node)) {
        if (k === 'loc' || k === 'range') continue;
        yield* valueIdentifiers(node[k], k === 'key');
      }
  }
}

describe('render-evaluated TDZ audit: deps arrays never reference a later-declared binding', () => {
  test('every identifier in every useEffect/useMemo/useCallback deps array is declared above its hook call', () => {
    const { decls, innerBody } = declarationLines();

    const HOOKS = new Set(['useEffect', 'useLayoutEffect', 'useMemo', 'useCallback']);
    const offenders = [];

    for (const stmt of innerBody) {
      const stack = [stmt];
      while (stack.length) {
        const node = stack.pop();
        if (!node || typeof node !== 'object') continue;
        if (Array.isArray(node)) { stack.push(...node); continue; }
        let matched = false;
        let callLoc = null;
        if (node.type === 'CallExpression') {
          const callee = node.callee;
          let hookName = null;
          if (callee && callee.type === 'Identifier' && HOOKS.has(callee.name)) hookName = callee.name;
          else if (callee && callee.type === 'MemberExpression' && callee.property && HOOKS.has(callee.property.name)) hookName = callee.property.name;
          if (hookName && node.arguments && node.arguments[1] && node.arguments[1].type === 'ArrayExpression') {
            matched = true;
            callLoc = node.loc.start.line;
            for (const id of valueIdentifiers(node.arguments[1])) {
              const line = decls.get(id.name);
              if (line !== undefined && line >= callLoc) {
                offenders.push(`${id.name} (deps of ${hookName} at line ${callLoc}; declared at line ${line})`);
              }
            }
          }
        }
        if (matched) continue; // don't descend into the deps we just judged (also skips the callback body)
        for (const k of Object.keys(node)) {
          if (k !== 'loc' && k !== 'range') stack.push(node[k]);
        }
      }
    }

    expect([...new Set(offenders)]).toEqual([]);
  });

  test('negative control: re-creating the spinoffTDZ pattern fires this audit', () => {
    // Standalone mock: a deps array referencing a const declared below it.
    const mock = `
      const App = () => {
        const [a] = [1];
        React.useEffect(() => { doStuff(b); }, [b]);
        const [b] = [2];
      };
    `;
    const mockProg = espree.parse(mock, { ecmaVersion: 2022, sourceType: 'script', loc: true });
    const appDecl = mockProg.body[0];
    const mockBody = appDecl.declarations[0].init.body.body;
    const declMap = new Map();
    for (const stmt of mockBody) {
      if (stmt.type === 'VariableDeclaration') {
        for (const d of stmt.declarations) {
          for (const el of (d.id.elements || [])) if (el) declMap.set(el.name, stmt.loc.start.line);
        }
      }
    }
    const effectStmt = mockBody.find((s) => s.type === 'ExpressionStatement');
    const call = effectStmt.expression;
    const deps = call.arguments[1];
    const hit = deps.elements.find((e) => declMap.get(e.name) > call.loc.start.line);
    expect(hit && hit.name).toBe('b');
  });
});
