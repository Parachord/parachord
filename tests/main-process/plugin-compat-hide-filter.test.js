/**
 * @jest-environment jsdom
 *
 * The hostBridges hide-filter end-to-end (#1355 wiring — the #1356 review's
 * missing test): initResolvers filters its .axe list through
 * plugin-compat's hostBridgesHideFilter with the preload's advertisement
 * (window.__parachordHostBridges) as the supplied list, hiding every plugin
 * whose required bridges this host doesn't supply. app.js never executes
 * under jest (56k renderer lines on vendor globals — see the wiring pins in
 * plugin-compat.test.js for the call site), so the filter is the seam this
 * drives: the REAL function the renderer runs, fed stub .axe content and a
 * stubbed advertisement read the way initResolvers reads it.
 */

const { hostBridgesHideFilter } = require('../../main-process/plugin-compat');

// The stub advertisement, shaped like the awkward real thing: contextBridge
// need not hand back a literal Array (a proxy still iterates), which is why
// initResolvers reads it with Array.from — a non-Array iterable here pins
// that the read survives the same crossing.
function stubAdvertisement(names) {
  window.__parachordHostBridges = {
    *[Symbol.iterator]() { yield* names; }
  };
  return Array.from(window.__parachordHostBridges || []); // initResolvers's exact read
}

describe('the hostBridges hide-filter (initResolvers wiring)', () => {
  test('a plugin whose bridges are all supplied loads; one needing an unsupplied bridge is hidden, named for the log', () => {
    const supplied = stubAdvertisement(['amazonMusic', 'webSession']);
    const usesWebSession = {
      manifest: { id: 'uses-websession', name: 'Uses webSession' },
      requires: { hostBridges: ['webSession'] }
    };
    const needsNope = {
      manifest: { id: 'needs-nope', name: 'Needs nope' },
      requires: { hostBridges: ['webSession', 'nope'] } // 'nope' is not a bridge this host supplies
    };
    const noRequirement = { manifest: { id: 'plain', name: 'Plain' } };
    const { visible, hidden } = hostBridgesHideFilter([usesWebSession, needsNope, noRequirement], supplied);
    expect(visible).toEqual([usesWebSession, noRequirement]);
    expect(hidden).toEqual(['Needs nope (needs nope)']);
  });

  test('a hidden plugin falls back to the id when the manifest carries no name; a malformed requires never hides', () => {
    const supplied = stubAdvertisement(['webSession']);
    const nameless = { manifest: { id: 'nameless' }, requires: { hostBridges: ['nope'] } };
    const malformed = { manifest: { id: 'malformed', name: 'Malformed' }, requires: { hostBridges: 'nope' } };
    const { visible, hidden } = hostBridgesHideFilter([nameless, malformed], supplied);
    expect(visible).toEqual([malformed]); // malformed is no requirement (build-axes rejects one at source)
    expect(hidden).toEqual(['nameless (needs nope)']);
  });
});
