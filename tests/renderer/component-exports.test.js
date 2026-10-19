/**
 * Component-module contract: every name app.js destructures from a
 * `require('./components/<mod>')` must be exported by that module.
 *
 * The failure class (#1061, review catch): destructuring a name the module
 * doesn't export binds `undefined` — invisible to lint (it's a declared
 * binding, not an undefined reference), to jest (nothing renders the
 * components), and to the esbuild bundle (bundling succeeds); React throws
 * error #130 on first render and the window comes up empty. That shipped
 * past every existing gate, which is why this test exists.
 *
 * Parses both sides with espree (the parser eslint uses — an explicit
 * devDependency). Handles object-literal exports (shorthand + key: value) and
 * identifier re-exports (`module.exports = Icons;`) by resolving the identifier
 * to its declaration (following a ternary to the fallback object literal, the
 * vendor-or-fallback pattern).
 */

const fs = require('fs');
const path = require('path');
const espree = require('espree');

const ROOT = path.join(__dirname, '..', '..');
const APP = path.join(ROOT, 'src', 'renderer', 'app.js');
const COMPONENTS_DIR = path.join(ROOT, 'src', 'renderer', 'components');

function parse(file) {
  return espree.parse(fs.readFileSync(file, 'utf8'), { ecmaVersion: 'latest', sourceType: 'script' });
}

// require('./components/x') destructure bindings in app.js:
//   const { A, B } = require('./components/x');
function requiredNames(appAst) {
  const found = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'VariableDeclaration') {
      for (const decl of node.declarations) {
        const init = decl.init;
        if (
          decl.id.type === 'ObjectPattern' && init && init.type === 'CallExpression' &&
          init.callee.type === 'Identifier' && init.callee.name === 'require' &&
          init.arguments.length === 1 && init.arguments[0].type === 'Literal' &&
          typeof init.arguments[0].value === 'string' &&
          /^\.\/components\/([\w.-]+)$/.test(init.arguments[0].value)
        ) {
          const mod = init.arguments[0].value.replace('./components/', '');
          const names = [];
          for (const prop of decl.id.properties) {
            if (prop.type === 'Property' && prop.key.type === 'Identifier') names.push(prop.key.name);
          }
          found.push({ mod, names });
        }
      }
    }
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (Array.isArray(child)) child.forEach(walk);
      else if (child && typeof child === 'object' && child.type) walk(child);
    }
  };
  walk(appAst);
  return found;
}

// Exported names of a component module: module.exports = { ... } or
// module.exports = SomeIdentifier (resolved to its declaration; a ternary
// resolves to the fallback object literal).
function exportedNames(moduleFile) {
  const ast = parse(moduleFile);
  let result = null;
  let identifierExport = null;
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (
      node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression' &&
      node.left.object.name === 'module' && node.left.property.name === 'exports'
    ) {
      if (node.right.type === 'ObjectExpression') {
        result = node.right.properties.map((p) => {
          if (p.type === 'SpreadElement') return null;
          return p.key.name || (p.key.value != null ? String(p.key.value) : null);
        }).filter(Boolean);
      } else if (node.right.type === 'Identifier') {
        identifierExport = node.right.name;
      }
    }
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (Array.isArray(child)) child.forEach(walk);
      else if (child && typeof child === 'object' && child.type) walk(child);
    }
  };
  walk(ast);
  if (result) return result;
  if (identifierExport) {
    // resolve const <identifierExport> = <expr>; — follow a ternary to the
    // fallback object literal (the vendor-or-fallback pattern in icons.js)
    let value = null;
    const resolve = (node) => {
      if (node.type === 'VariableDeclaration') {
        for (const d of node.declarations) {
          if (d.id.type === 'Identifier' && d.id.name === identifierExport) value = d.init;
        }
      }
      for (const key of Object.keys(node)) {
        const child = node[key];
        if (Array.isArray(child)) child.forEach(resolve);
        else if (child && typeof child === 'object' && child.type) resolve(child);
      }
    };
    resolve(ast);
    if (value && value.type === 'ConditionalExpression') value = value.alternate;
    if (value && value.type === 'ObjectExpression') {
      return value.properties.map((p) => (p.key && (p.key.name || p.key.value)) != null ? String(p.key.name ?? p.key.value) : null).filter(Boolean);
    }
  }
  throw new Error(`${path.basename(moduleFile)}: unrecognized module.exports shape`);
}

describe('app.js require-destructure vs component module exports', () => {
  const appAst = parse(APP);
  const requirements = requiredNames(appAst);

  test('app.js destructures from at least one component module', () => {
    expect(requirements.length).toBeGreaterThan(0);
  });

  test.each(requirements.map((r) => [r.mod, r]))('%s: every destructured name is exported', (mod, r) => {
    const moduleFile = path.join(COMPONENTS_DIR, `${mod}.js`);
    expect(fs.existsSync(moduleFile)).toBe(true);
    const exported = new Set(exportedNames(moduleFile));
    const missing = r.names.filter((n) => !exported.has(n));
    expect(missing).toEqual([]);
  });
});
