// N-way incremental write-primitive defaults (parachord#911, Step 2 / PR-1).
//
// Desktop sync providers are plain objects, not classes with a shared base, so
// there's no interface to carry "default implementation that throws" the way
// the Kotlin SyncProvider interface does. This helper supplies that guarantee:
// wrap a provider and any incremental write primitive it does NOT implement is
// filled with a stub that THROWS (loudly) rather than silently no-opping.
//
// Why throw, not no-op: the materialize executor dispatches removals on
// `trackRemoveMode`, so in correct operation it only calls the primitives a
// provider actually supports. A missing primitive being invoked means a
// dispatch bug — and a silent no-op there could read downstream as "nothing to
// remove" (a false success), which the no-false-drop invariant forbids. The
// FakeProvider in the executor tests throws on mis-dispatch for the same
// reason; this is the production-side equivalent.
//
// Pure + dormant: nothing wraps real providers until the reconcile driver
// (PR-4). `nativeIdOf` is intentionally NOT defaulted — it's a pure accessor
// every provider defines, and a throwing stub there would mask a real gap.

const INCREMENTAL_PRIMITIVES = [
  'addPlaylistTracks',
  'removePlaylistTracksByNativeId',
  'removePlaylistTracksByPosition',
  'replacePlaylistTracks',
  'remotePlaylistExists',
  'searchForTrackId',
];

/**
 * Return a shallow copy of `provider` with every unimplemented incremental
 * write primitive replaced by an async stub that throws. Methods the provider
 * already defines are preserved untouched. Non-destructive (does not mutate the
 * input). Object-method `this` resolves to the returned copy, so a real
 * provider whose methods call `this.fetchPlaylistTracks` still works.
 * @param {object} provider - a sync provider object (must have `capabilities`)
 * @returns {object} the provider augmented with throwing defaults
 */
function withIncrementalDefaults(provider) {
  if (!provider || typeof provider !== 'object') {
    throw new Error('withIncrementalDefaults: provider must be an object');
  }
  const out = { ...provider };
  const id = out.id || 'provider';
  for (const method of INCREMENTAL_PRIMITIVES) {
    if (typeof out[method] !== 'function') {
      out[method] = async () => {
        throw new Error(`${method} not implemented by ${id}`);
      };
    }
  }
  return out;
}

module.exports = { withIncrementalDefaults, INCREMENTAL_PRIMITIVES };
