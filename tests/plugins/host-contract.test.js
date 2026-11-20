/**
 * The plug-in host contract (#1561; docs/architecture/plugins.md "The plug-in
 * host contract"), held over plugins-src/. Desktop plugins aren't sandboxed,
 * so nothing at run time stops one reading window.electron; these do.
 *
 * 1. The ratchet: how many times each plugin reaches the host through a
 *    global (window.electron.*, an app object on window, an underscored
 *    window.__parachord* name) and keeps its own state on window. The counts
 *    start at what shipped plugins did before the contract and only fall: a
 *    rise fails, and a fall fails until it's locked in with
 *      UPDATE_HOST_GLOBALS_BASELINE=1 npx jest tests/plugins/host-contract.test.js
 *    and the baseline committed. The `hostBridge` accessor's own older-app
 *    fallback is the one exception.
 * 2. Declared means used, and used means declared: every bridge a plugin
 *    reaches (this.host.<name>, this.hostBridge('<name>')) is a core key or
 *    one its manifest's `requires` names, and every name there is used.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'plugins-src');
const BASELINE = path.join(__dirname, 'host-globals-baseline.json');
const CORE = new Set(['appVersion', 'platform', 'getConfig', 'openExternal']);

const HOST_GLOBAL = /\bwindow\.(?:electron\b|__parachord\w*|scrobbleManager\b|achordion\b|iTunesRateLimiter\b|resolveMbidForLove\b|getMusicKitWeb\b|appleMusic\w*|dispatchEvent\b|open\b)/g;
const PLUGIN_STATE = /\bwindow\.(?:_[A-Za-z]\w*|__(?!parachord)\w+)/g;

// The code, without comments (block comments that open a line, whole-line
// `//` ones and ` // trailing` ones; a URL's `//` has no space before it) and without the hostBridge accessor's body.
function codeOf(id) {
  let src = fs.readFileSync(path.join(SRC, id, 'implementation.js'), 'utf8');
  // Block comments that open a line; a `/*` inside a string (a URL glob) isn't one.
  src = src.replace(/^\s*\/\*[\s\S]*?\*\//gm, '');
  src = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\s\/\/\s.*$/, '')).join('\n');
  const start = src.indexOf('hostBridge: function');
  if (start !== -1) {
    const end = src.indexOf('\n  },', start);
    src = src.slice(0, start) + src.slice(end === -1 ? src.length : end);
  }
  return src;
}

const plugins = fs.readdirSync(SRC).filter((id) => fs.existsSync(path.join(SRC, id, 'implementation.js'))).sort();

function counts() {
  const out = {};
  for (const id of plugins) {
    const code = codeOf(id);
    const host = (code.match(HOST_GLOBAL) || []).length;
    const state = (code.match(PLUGIN_STATE) || []).length;
    if (host || state) out[id] = { hostGlobals: host, windowState: state };
  }
  return out;
}

describe('host globals in plugins-src (the ratchet)', () => {
  const now = counts();
  if (process.env.UPDATE_HOST_GLOBALS_BASELINE === '1') {
    fs.writeFileSync(BASELINE, JSON.stringify(now, null, 2) + '\n');
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));

  for (const id of plugins) {
    test(`${id}: no new host globals`, () => {
      const was = baseline[id] || { hostGlobals: 0, windowState: 0 };
      const is = now[id] || { hostGlobals: 0, windowState: 0 };
      for (const key of ['hostGlobals', 'windowState']) {
        if (is[key] > was[key]) {
          throw new Error(`${id} reaches the host through a global ${is[key]} times (baseline ${was[key]}). ` +
            'Use this.host / this.hostBridge (docs/architecture/plugins.md "The plug-in host contract").');
        }
        if (is[key] < was[key]) {
          throw new Error(`${id}'s ${key} fell from ${was[key]} to ${is[key]}: lock it in with ` +
            'UPDATE_HOST_GLOBALS_BASELINE=1 npx jest tests/plugins/host-contract.test.js and commit the baseline.');
        }
      }
    });
  }

  test('Amazon Music reaches the web session only through the contract', () => {
    expect(codeOf('amazonmusic')).not.toMatch(/window\.electron\.webSession|window\.__parachordWidevine/);
  });
});

describe('declared bridges are used, and used bridges are declared', () => {
  for (const id of plugins) {
    test(id, () => {
      const manifest = JSON.parse(fs.readFileSync(path.join(SRC, id, 'manifest.json'), 'utf8'));
      const requires = manifest.requires || {};
      const declared = new Set([...(requires.hostBridges || []), ...(requires.optionalHostBridges || [])]);
      const src = fs.readFileSync(path.join(SRC, id, 'implementation.js'), 'utf8');
      const used = new Set();
      for (const m of src.matchAll(/this\.host\.([A-Za-z_]\w*)/g)) used.add(m[1]);
      for (const m of src.matchAll(/hostBridge\(\s*['"]([^'"]+)['"]\s*\)/g)) used.add(m[1]);
      const undeclared = [...used].filter((name) => !CORE.has(name) && !declared.has(name));
      expect(undeclared).toEqual([]);
      const unused = [...declared].filter((name) => !used.has(name));
      expect(unused).toEqual([]);
    });
  }
});
