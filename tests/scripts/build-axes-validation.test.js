/**
 * build-axes' self-containment validation (the #1356 plugin-library review):
 * serialized functions lose their closure, so an implementation entry that
 * reaches for module scope only fails at RUNTIME, on a user's machine, with
 * a ReferenceError. scripts/build-axes.js materializes every entry the way
 * resolver-loader does — in a clean scope with nothing closed over — and
 * calls the _lib factory once. These tests pin that gate.
 *
 * The validator is exported behind a require.main guard (the writer must
 * never run on require).
 */

const { validateImplementationEntries, checkEntriesForFreeVariables } = require('../../scripts/build-axes');

// Serialize real functions the way build-axes does.
const entries = (fns) => Object.fromEntries(Object.entries(fns).map(([k, fn]) => [k, String(fn)]));

describe('build-axes checkEntriesForFreeVariables (the no-undef gate)', () => {
  test("the maintainer's example: a helper the factory RETURNS closes over module scope", () => {
    // validateImplementationEntries does not catch this (calling the factory
    // once never calls the returned helper) — no-undef does, without calling
    // anything. Review on #1402.
    const THRESHOLD = 0.6;
    const problems = checkEntriesForFreeVariables({
      _lib: String(function () { return { passes(c) { return c >= THRESHOLD; } }; })
    });
    expect(problems).toEqual([expect.stringContaining('references "THRESHOLD"')]);
  });

  test('a free variable in a METHOD is caught too (same gap, same gate)', () => {
    const API_BASE = 'https://example.com';
    const problems = checkEntriesForFreeVariables({
      search: String(async function () { return fetch(API_BASE + '/search'); })
    });
    expect(problems).toEqual([expect.stringContaining('references "API_BASE"')]);
  });

  test('browser and ES globals are NOT flagged — the plugin runtime', () => {
    expect(checkEntriesForFreeVariables({
      search: String(async function () {
        console.log(window.electron, JSON.stringify({}), fetch('/x'), globalThis.location.href, Promise.resolve(1), Intl.NumberFormat);
      }),
      _lib: String(function () { return { now: () => Date.now() }; })
    })).toEqual([]);
  });

  test('every real plugins-src entry passes the no-undef gate', () => {
    const fs = require('fs');
    const path = require('path');
    const SRC = path.join(__dirname, '../../plugins-src');
    for (const id of fs.readdirSync(SRC).filter((d) => fs.existsSync(path.join(SRC, d, 'implementation.js')))) {
      const exportsBy = require(path.join(SRC, id, 'implementation.js'));
      const impl = Object.fromEntries(Object.entries(exportsBy).map(([k, fn]) => [k, String(fn)]));
      expect(`${id}: ${checkEntriesForFreeVariables(impl).join('; ')}`).toBe(`${id}: `);
    }
  });
});

describe('build-axes validateImplementationEntries', () => {
  test('a self-contained library and methods pass', () => {
    expect(validateImplementationEntries(entries({
      _lib: function () { return { helper: () => 1 }; },
      search: async function () { return 1; }
    }))).toEqual([]);
  });

  test('a _lib that closes over module scope fails the build, not a user machine', () => {
    // The exact failure mode the gate exists for: the author writes
    // implementation.js as a normal module and the factory references a
    // module-level constant. String(fn) drops the closure; resolver-loader
    // materializes it in a clean scope; the factory call throws.
    const moduleConstant = { helper: () => 1 };
    const problems = validateImplementationEntries(entries({
      _lib: function () { return moduleConstant; }
    }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/_lib closes over module scope or throws .* moduleConstant/);
  });

  test('a _lib that throws, returns a primitive, or returns null fails', () => {
    expect(validateImplementationEntries(entries({ _lib: function () { throw new Error('boom'); } })))
      .toEqual([expect.stringContaining('throws when called in a clean scope: boom')]);
    expect(validateImplementationEntries(entries({ _lib: function () { return 'no'; } })))
      .toEqual([expect.stringContaining('must return the library (an object)')]);
    expect(validateImplementationEntries(entries({ _lib: function () { return null; } })))
      .toEqual([expect.stringContaining('must return the library (an object)')]);
  });

  test('an entry whose source does not materialize fails', () => {
    expect(validateImplementationEntries({ search: 'function () { return broken syntax' }))
      .toEqual([expect.stringContaining('does not materialize')]);
    expect(validateImplementationEntries({ search: '42' }))
      .toEqual([expect.stringContaining('materializes to a number, not a function')]);
  });

  test('every real plugins-src implementation passes (no entry closes over module scope today)', () => {
    const fs = require('fs');
    const path = require('path');
    const SRC = path.join(__dirname, '../../plugins-src');
    for (const id of fs.readdirSync(SRC).filter((d) => fs.existsSync(path.join(SRC, d, 'implementation.js')))) {
      const exportsBy = require(path.join(SRC, id, 'implementation.js'));
      const impl = Object.fromEntries(Object.entries(exportsBy).map(([k, fn]) => [k, String(fn)]));
      expect(validateImplementationEntries(impl)).toEqual([]);
    }
  });
});
