/**
 * Render smoke test for every extracted component module: the module loads
 * under plain Node with the renderer's globals set (React/ReactDOM from npm —
 * the same versions the vendor script tags carry — plus the ReactVirtual
 * vendor global), and every component-shaped export renders via
 * renderToStaticMarkup without a ReferenceError.
 *
 * The failure class (#1058 review): in the esbuild bundle the __commonJS
 * module wrappers close over the entry IIFE's scope, where app.js's
 * `const { useState, ... } = React` destructure lives — so a bare hook inside
 * an extracted module resolves there BY ACCIDENT and nothing catches it until
 * the module is required outside the bundle. Under this test there is no
 * bundle: a bare `useState` is a plain ReferenceError, exactly like in a
 * jest require or a plain Node consumer. Same for a global the module forgot
 * to require (e.g. ResolverIcon) — ReferenceError at render.
 *
 * Prop-dereference TypeErrors are expected and ignored (components render
 * with empty props here; that's not this test's concern — the destructure/
 * exports contract test and the app's own boot cover that side).
 */

const fs = require('fs');
const path = require('path');

// The renderer's vendor globals — set BEFORE requiring the modules.
global.React = require('react');
global.ReactDOM = require('react-dom');
global.ReactVirtual = require('@tanstack/react-virtual');

const { renderToStaticMarkup } = require('react-dom/server');

const COMPONENTS_DIR = path.join(__dirname, '..', '..', 'src', 'renderer', 'components');
const modules = fs.readdirSync(COMPONENTS_DIR).filter((f) => f.endsWith('.js'));

describe('component module render smoke', () => {
  test('there are component modules to smoke (guards the glob against rot)', () => {
    expect(modules.length).toBeGreaterThan(0);
  });

  test.each(modules)('%s: loads under Node and every component export renders without a ReferenceError', (file) => {
    const mod = require(path.join(COMPONENTS_DIR, file)); // a throw here fails the test
    for (const [name, value] of Object.entries(mod)) {
      if (!/^[A-Z]/.test(name)) continue; // convention: components are PascalCase
      // PascalCase DATA constants (SERVICE_LOGOS & co.) are objects — require
      // them loadable but don't render them; only function exports are
      // components.
      if (typeof value !== 'function') continue;
      try {
        renderToStaticMarkup(global.React.createElement(value));
      } catch (err) {
        // Prop-shape TypeErrors are fine; a ReferenceError means the module
        // references a global/identifier it doesn't actually have (the
        // bare-hook class, the forgot-to-require class).
        if (err instanceof ReferenceError) {
          throw new Error(`${file}: ${name} — ${err.message}`);
        }
      }
    }
  });
});
