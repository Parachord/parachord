/**
 * main.js prunes expired track tombstones once at startup. From #865 until
 * 2026-10-18 the prune ran above `const Tombstones = require(...)`, so it hit
 * the const's temporal dead zone; the surrounding try/catch logged
 * "Cannot access 'Tombstones' before initialization" and nothing was pruned.
 * main.js can't be loaded under jest (it boots Electron), so this pins the
 * source order and checks the call it makes does prune.
 */

const fs = require('fs');
const path = require('path');
const Tombstones = require('../../sync-engine/tombstones');

const main = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');

describe('startup tombstone prune', () => {
  test('Tombstones is required before the top-level prune call', () => {
    const requireAt = main.indexOf("const Tombstones = require('./sync-engine/tombstones')");
    const pruneAt = main.indexOf('Tombstones.pruneExpired(store)');
    expect(requireAt).toBeGreaterThan(-1);
    expect(pruneAt).toBeGreaterThan(-1);
    expect(requireAt).toBeLessThan(pruneAt);
    // Exactly one declaration: a second `const Tombstones` would be a
    // SyntaxError at main.js load.
    expect(main.split("const Tombstones = require(").length - 1).toBe(1);
  });

  test('pruneExpired(store) drops entries older than the TTL', () => {
    const data = {};
    const store = {
      get: (k, d) => (k in data ? data[k] : d),
      set: (k, v) => { data[k] = v; },
      delete: (k) => { delete data[k]; },
    };
    const now = Date.now();
    Tombstones.addTombstone(store, 'spotify', 'old', now - Tombstones.TOMBSTONE_TTL_MS - 1000);
    Tombstones.addTombstone(store, 'spotify', 'fresh', now);
    expect(Tombstones.pruneExpired(store)).toBe(1);
    expect(Tombstones.getTombstone(store, 'spotify', 'old')).toBeNull();
    expect(Tombstones.getTombstone(store, 'spotify', 'fresh')).not.toBeNull();
  });
});
