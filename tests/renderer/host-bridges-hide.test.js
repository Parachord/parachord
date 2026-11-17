/**
 * @jest-environment jsdom
 *
 * src/renderer/lib/host-bridges-hide.js — the ONE hostBridges hide rule every
 * .axe load path runs (#1355; #1432 review, note 7): initResolvers ran the
 * only copy, and the fallback load plus the install/reload paths loaded .axe
 * content without it. This pins the extracted helper: the advertisement read
 * (contextBridge need not hand back a literal Array — Array.from survives the
 * proxy), the hide itself (the plugin-compat rule), the loader's log line, and
 * the `win` injection the single-axe install paths rely on (they pass one axe
 * and check the result is empty).
 */

const { hideAxesLackingHostBridges } = require('../../src/renderer/lib/host-bridges-hide');

// The advertisement shape the real preload exposes: contextBridge can hand
// back a non-Array iterable (the jsdom wiring test in
// plugin-compat-hide-filter.test.js pins the same crossing).
function stubAdvertisement(names) {
  return {
    *[Symbol.iterator]() { yield* names; }
  };
}

function makeWindow(names) {
  return { __parachordHostBridges: stubAdvertisement(names) };
}

describe('hideAxesLackingHostBridges (the one rule every .axe load path runs)', () => {
  test('hides every axe whose required bridges are not all supplied, logging it by name', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const usesWebSession = { manifest: { id: 'uses-websession', name: 'Uses webSession' }, requires: { hostBridges: ['webSession'] } };
      const plain = { manifest: { id: 'plain', name: 'Plain' } };
      const visible = hideAxesLackingHostBridges([usesWebSession, plain], makeWindow(['amazonMusic']));
      expect(visible).toEqual([plain]); // the bridgeless plugin never loads
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0][0]).toMatch(/Hidden 1 plugin\(s\) whose host bridges this app doesn't supply: Uses webSession \(needs webSession\)/);
    } finally {
      log.mockRestore();
    }
  });

  test('a non-Array advertisement (the contextBridge proxy shape) still reads', () => {
    const needsBridge = { manifest: { id: 'needs', name: 'Needs' }, requires: { hostBridges: ['amazonMusic'] } };
    // Supplied (an advertisement the host supplies fully): visible.
    expect(hideAxesLackingHostBridges([needsBridge], makeWindow(['amazonMusic']))).toEqual([needsBridge]);
    // Not supplied: hidden — Array.from on the iterable, not Array.isArray.
    expect(hideAxesLackingHostBridges([needsBridge], makeWindow([]))).toEqual([]);
  });

  test("the install paths' single-axe shape: an empty result means hidden here, and a missing advertisement hides too", () => {
    const axe = { manifest: { id: 'x', name: 'X' }, requires: { hostBridges: ['webSession'] } };
    // A host with no window global at all (undefined) supplies nothing.
    expect(hideAxesLackingHostBridges([axe], {})).toEqual([]);
    expect(hideAxesLackingHostBridges([axe], undefined)).toEqual([]);
    // The same axe with the bridge supplied loads — one rule, not a blanket hide.
    expect(hideAxesLackingHostBridges([axe], makeWindow(['webSession']))).toEqual([axe]);
  });

  test('a malformed requires is no requirement; a non-array axes input is empty', () => {
    const malformed = { manifest: { id: 'm', name: 'M' }, requires: { hostBridges: 'nope' } };
    expect(hideAxesLackingHostBridges([malformed], makeWindow([]))).toEqual([malformed]);
    expect(hideAxesLackingHostBridges(null, makeWindow([]))).toEqual([]);
  });
});
