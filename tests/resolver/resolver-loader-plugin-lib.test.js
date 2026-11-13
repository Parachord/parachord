/**
 * The plugin library (#1356): implementation._lib is a FACTORY, not a method.
 * resolver-loader.js materializes it with the same `new Function('return ' +
 * src)()` as every implementation entry, then invokes it exactly once per
 * resolver instance and exposes its return value to every method as
 * `this.lib`. This is the prerequisite for moving Amazon's logic into the
 * plugin (issue #1356): the ~60 shared helpers in amazon-music-logic.js have
 * to live somewhere a plugin's methods can all reach.
 *
 * The tests serialize real functions with String(fn) — the exact wire path
 * scripts/build-axes.js produces — so the contract is proven end to end:
 * the factory is written as a normal function in implementation.js, not as a
 * source string by hand.
 */

const ResolverLoader = require('../../resolver-loader');

// Serialize a function the way build-axes does, so tests can define the
// plugin as real functions (and lint/eslint still parse them).
const axeImplementation = (fns) => Object.fromEntries(
  Object.entries(fns).map(([key, fn]) => [key, String(fn)])
);

function loadPlugin(implementation, id = 'libtest') {
  const loader = new ResolverLoader();
  loader.loadResolver({
    manifest: { id, name: 'Lib Test', version: '1.0.0' },
    capabilities: { resolve: true },
    urlPatterns: [],
    implementation: axeImplementation(implementation),
  });
  return loader.getResolver(id);
}

describe('implementation._lib — the plugin library', () => {
  test('every method sees the same library object as this.lib', async () => {
    const resolver = loadPlugin({
      // The factory runs once and returns the shared library.
      _lib: function () {
        return { marker: { shared: true }, count: 0 };
      },
      readMarker: async function () { return this.lib.marker; },
      readMarkerToo: async function () { return this.lib.marker; },
    });

    expect(typeof resolver.lib).toBe('object');
    // One object, shared between methods — not one per method.
    const a = await resolver.readMarker();
    const b = await resolver.readMarkerToo();
    expect(a).toBe(b);
    expect(a).toBe(resolver.lib.marker);
  });

  test('cross-call state on the library survives between methods', async () => {
    const resolver = loadPlugin({
      _lib: function () { return { counter: 0, log: [] }; },
      increment: async function () { this.lib.counter += 1; return this.lib.counter; },
      push: async function (entry) { this.lib.log.push(entry); return this.lib.log; },
    });

    expect(await resolver.increment()).toBe(1);
    expect(await resolver.increment()).toBe(2);
    expect(await resolver.push('x')).toEqual(['x']);
    // State is shared through the library object, visible from any method.
    expect(resolver.lib.counter).toBe(2);
    expect(resolver.lib.log).toEqual(['x']);
  });

  test('state on the resolver instance (this) is shared too — locked in, not a regression', async () => {
    // _bindContext binds every method to the same resolver object, so methods
    // could always stash state on `this`. The library is the canonical home
    // for shared helpers; this locks in that instance state also keeps
    // working (the resolver object is per loaded instance).
    const resolver = loadPlugin({
      _lib: function () { return {}; },
      stash: async function (key, value) { this[key] = value; },
      read: async function (key) { return this[key]; },
    });

    await resolver.stash('_cache', { hits: 1 });
    expect(await resolver.read('_cache')).toEqual({ hits: 1 });
  });

  test('each loaded instance gets its own library (the factory is per instance)', async () => {
    let factories = 0;
    const makeAxe = () => ({
      manifest: { id: `libtest-${++factories}`, name: 'Lib Test', version: '1.0.0' },
      capabilities: {},
      urlPatterns: [],
      implementation: axeImplementation({
        _lib: function () { return { self: Math.random() }; },
        identity: async function () { return this.lib; },
      }),
    });
    const loader = new ResolverLoader();
    loader.loadResolver(makeAxe());
    loader.loadResolver(makeAxe());
    const first = loader.getResolver('libtest-1');
    const second = loader.getResolver('libtest-2');

    expect(first.lib).not.toBe(second.lib);
    expect(await first.identity()).toBe(first.lib);
    expect(await second.identity()).toBe(second.lib);
  });

  test('_lib never materializes as a callable method, and lib is reserved', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const resolver = loadPlugin({
      _lib: function () { return { answer: 42 }; },
      // A method named `lib` must not clobber the injected library.
      lib: async function () { return 'i am not the library'; },
      answer: async function () { return this.lib.answer; },
    });

    expect(typeof resolver._lib).toBe('undefined'); // not a method
    expect(typeof resolver.lib).toBe('object'); // not clobbered by the method above
    expect(await resolver.answer()).toBe(42);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('reserved implementation key "lib"'));
    warn.mockRestore();
  });

  test('a plugin without _lib loads unchanged, with this.lib null', async () => {
    const resolver = loadPlugin({
      search: async function () { return [{ id: 'x', title: 't', artist: 'a' }]; },
    });

    expect(resolver.lib).toBeNull();
    expect(await resolver.search('t')).toEqual([{ id: 'x', title: 't', artist: 'a' }]);
  });

  test('a throwing factory degrades to this.lib null — the plugin still loads', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const resolver = loadPlugin({
      _lib: function () { throw new Error('factory exploded'); },
      search: async function () { return ['still', 'callable']; },
    });

    expect(resolver.lib).toBeNull();
    expect(await resolver.search('q')).toEqual(['still', 'callable']);
    expect(error).toHaveBeenCalledWith(
      'Failed to create the plugin library for libtest:',
      expect.objectContaining({ message: 'factory exploded' })
    );
    error.mockRestore();
  });

  test('a factory that returns a primitive is rejected, not half-loaded', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const resolver = loadPlugin({
      _lib: function () { return 'not a library'; },
      search: async function () { return []; },
    });

    expect(resolver.lib).toBeNull();
    expect(await resolver.search('q')).toEqual([]);
    expect(error).toHaveBeenCalledWith(
      'Failed to create the plugin library for libtest:',
      expect.anything()
    );
    error.mockRestore();
  });

  test('a non-string _lib entry (a hand-edited .axe) never becomes a method', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const loader = new ResolverLoader();
    loader.loadResolver({
      manifest: { id: 'libtest', name: 'Lib Test', version: '1.0.0' },
      capabilities: {},
      urlPatterns: [],
      implementation: { _lib: { not: 'source' }, search: 'async function () { return 1; }' },
    });
    const resolver = loader.getResolver('libtest');

    expect(resolver.lib).toBeNull();
    expect(typeof resolver._lib).toBe('undefined');
    expect(resolver.search).toBeInstanceOf(Function);
    expect(error).toHaveBeenCalled();
    warn.mockRestore();
    error.mockRestore();
  });

  test('the loader still drops prototype-pollution keys alongside a _lib', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const loader = new ResolverLoader();
    // JSON.parse, not an object literal: { __proto__: ... } in a literal sets
    // the prototype instead of creating an own key, and the loader's filter
    // would never see it. A parsed .axe carries it as a real entry.
    const implementation = JSON.parse('{"_lib": "function () { return { ok: true }; }", "__proto__": "function () { return 1; }", "constructor": "function () { return 2; }", "search": "async function () { return this.lib.ok; }"}');
    loader.loadResolver({
      manifest: { id: 'libtest', name: 'Lib Test', version: '1.0.0' },
      capabilities: {},
      urlPatterns: [],
      implementation,
    });
    const resolver = loader.getResolver('libtest');

    expect(resolver.lib).toEqual({ ok: true });
    expect(await resolver.search()).toBe(true);
    // `constructor` (a normal own key) is filtered with the standard warning.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"constructor"'));
    // `__proto__` never gets that far: `implFunctions[key] = fn` on that name
    // hits the prototype setter and is silently dropped (pre-existing loader
    // behavior — it never reaches the filter and never lands on the resolver).
    // Assert the outcome that matters: no own `__proto__` lands anywhere.
    expect(Object.prototype.hasOwnProperty.call(resolver, '__proto__')).toBe(false);
    warn.mockRestore();
  });
});

describe('the wire path — a real plugin through scripts/build-axes serialization', () => {
  test('an implementation.js-style module with _lib survives String(fn) round-trip', async () => {
    // Exactly what build-axes writes: every export is a function, serialized
    // with String(fn); the loader materializes each with new Function. A
    // plugin author writes implementation.js normally and never sees strings.
    const implementationModule = {
      _lib: function () {
        const helpers = {
          shout: (s) => String(s || '').toUpperCase(),
        };
        return { helpers, seen: 0 };
      },
      search: async function (query) {
        this.lib.seen += 1;
        return [{ id: this.lib.helpers.shout(query), title: query }];
      },
    };
    const resolver = loadPlugin(implementationModule);

    expect(await resolver.search('quiet')).toEqual([{ id: 'QUIET', title: 'quiet' }]);
    expect(await resolver.search('again')).toEqual([{ id: 'AGAIN', title: 'again' }]);
    expect(resolver.lib.seen).toBe(2);
  });
});
