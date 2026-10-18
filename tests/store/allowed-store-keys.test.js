/**
 * Every electron-store key the renderer reads or writes must be in
 * ALLOWED_STORE_KEYS (main-process/ipc/store.js), or the store-* IPC handlers silently
 * refuse it (store.set resolves false, main logs "Blocked store-set"). Six
 * keys had been missing for months without anyone noticing (2026-10-12), so
 * this parses both sides and cross-checks them.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// Files that run in the renderer and talk to window.electron.store.
const RENDERER_FILES = [
  'app.js', 'scrobbler-loader.js', 'musickit-web.js', 'resolver-loader.js',
  'resolution-scheduler.js', 'migration-plan.js', 'mbid-lookup.js', 'resolver-limiter.js',
].filter((f) => fs.existsSync(path.join(ROOT, f)));

function parseAllowlist() {
  const moduleSrc = read('main-process/ipc/store.js');
  const start = moduleSrc.indexOf('const ALLOWED_STORE_KEYS = new Set([');
  expect(start).toBeGreaterThan(-1);
  const end = moduleSrc.indexOf(']);', start);
  return new Set(moduleSrc.slice(start, end).match(/'([^']+)'/g).map((k) => k.slice(1, -1)));
}

// Literal keys passed to store.get/set/delete, store.getBatch([...]), and the
// key-list constants the bulk loader builds its batch from.
function rendererLiteralKeys() {
  const used = new Map();
  const note = (key, where) => { if (!used.has(key)) used.set(key, new Set()); used.get(key).add(where); };
  for (const f of RENDERER_FILES) {
    const src = read(f);
    for (const m of src.matchAll(/store\??\.(get|set|delete)\??\(\s*'([^']+)'/g)) note(m[2], `${f}:${m[1]}`);
    for (const m of src.matchAll(/store\??\.getBatch\??\(\s*\[([^\]]*)\]/gs)) {
      for (const k of m[1].match(/'([^']+)'/g) || []) note(k.slice(1, -1), `${f}:getBatch`);
    }
    for (const m of src.matchAll(/(?:BIG_CACHE_KEYS|criticalKeys|allKeys)\s*=\s*\[([^\]]*)\]/gs)) {
      for (const k of m[1].match(/'([^']+)'/g) || []) note(k.slice(1, -1), `${f}:keylist`);
    }
  }
  return used;
}

describe('ALLOWED_STORE_KEYS covers every key the renderer uses', () => {
  const allowed = parseAllowlist();

  test('allowlist parses', () => {
    expect(allowed.size).toBeGreaterThan(50);
    expect(allowed.has('local_playlists')).toBe(true);
  });

  test('every literal renderer store key is allowlisted', () => {
    const used = rendererLiteralKeys();
    expect(used.size).toBeGreaterThan(30);
    const missing = [...used].filter(([k]) => !allowed.has(k)).map(([k, where]) => `${k} (${[...where].join(', ')})`);
    expect(missing).toEqual([]);
  });

  test('discovery_seen_<feature> is allowlisted for every feature that marks itself seen', () => {
    const app = read('app.js');
    expect(app).toMatch(/discovery_seen_\$\{feature\}/);
    // Features mark themselves seen via <something>DiscoverySeen('<feature>', hash).
    const features = new Set([...app.matchAll(/DiscoverySeen\(\s*'([^']+)'/g)].map((m) => m[1]));
    expect(features.size).toBeGreaterThan(0);
    const missing = [...features].filter((f) => !allowed.has(`discovery_seen_${f}`));
    expect(missing).toEqual([]);
  });

  test('scrobbler-config-<id> is allowlisted for every scrobbler', () => {
    for (const id of ['lastfm', 'listenbrainz', 'librefm']) expect(allowed.has(`scrobbler-config-${id}`)).toBe(true);
  });
});
