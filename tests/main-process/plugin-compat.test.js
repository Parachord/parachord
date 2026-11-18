/**
 * main-process/plugin-compat.js: a plugin's per-platform minimum app version,
 * and where main.js enforces it. The marketplace serves only the latest copy
 * of each plugin, so without a floor a plugin that needs a newer host reaches
 * every installed app (the Amazon 1.7.0 / v0.9.11 case in parachord#1158).
 */

const fs = require('fs');
const path = require('path');
const {
  PLUGIN_PLATFORMS,
  parseVersion,
  compareVersions,
  pluginMinAppVersion,
  pluginCompatibility,
  validateMinAppVersion,
  pluginRequiredHostBridges,
  hostBridgesCompatibility,
  validateRequires
} = require('../../main-process/plugin-compat');

const ROOT = path.join(__dirname, '..', '..');

describe('parseVersion / compareVersions', () => {
  test('parses x.y.z and drops a pre-release or build suffix', () => {
    expect(parseVersion('0.9.12')).toEqual([0, 9, 12]);
    expect(parseVersion('0.9.12-beta.1')).toEqual([0, 9, 12]);
    expect(parseVersion('1.0.0+build.5')).toEqual([1, 0, 0]);
  });

  test('rejects anything that is not x.y.z', () => {
    for (const bad of ['0.9', '0.9.x', 'v0.9.12', '', null, undefined, 12]) {
      expect(parseVersion(bad)).toBeNull();
    }
  });

  test('compares numerically, not as strings', () => {
    expect(compareVersions('0.9.10', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('0.10.0', '0.9.12')).toBeGreaterThan(0);
    expect(compareVersions('0.9.11', '0.9.12')).toBeLessThan(0);
    expect(compareVersions('0.9.12', '0.9.12')).toBe(0);
  });
});

describe('pluginMinAppVersion', () => {
  const manifest = { minAppVersion: { desktop: '0.9.12', android: '1.4.0' } };

  test('reads the floor for the platform', () => {
    expect(pluginMinAppVersion(manifest, 'desktop')).toBe('0.9.12');
    expect(pluginMinAppVersion(manifest, 'android')).toBe('1.4.0');
  });

  test('a platform with no entry, or no field, has no floor', () => {
    expect(pluginMinAppVersion(manifest, 'ios')).toBeNull();
    expect(pluginMinAppVersion({}, 'desktop')).toBeNull();
    expect(pluginMinAppVersion(null, 'desktop')).toBeNull();
  });

  test('a malformed floor is no floor', () => {
    expect(pluginMinAppVersion({ minAppVersion: { desktop: '0.9' } }, 'desktop')).toBeNull();
    expect(pluginMinAppVersion({ minAppVersion: '0.9.12' }, 'desktop')).toBeNull();
    expect(pluginMinAppVersion({ minAppVersion: ['0.9.12'] }, 'desktop')).toBeNull();
  });
});

describe('pluginCompatibility', () => {
  const manifest = { minAppVersion: { desktop: '0.9.12' } };

  test('an app below the floor is refused, naming the floor', () => {
    expect(pluginCompatibility(manifest, '0.9.11', 'desktop')).toEqual({ ok: false, requires: '0.9.12' });
  });

  test('an app at or above the floor runs it', () => {
    expect(pluginCompatibility(manifest, '0.9.12', 'desktop')).toEqual({ ok: true });
    expect(pluginCompatibility(manifest, '0.10.0', 'desktop')).toEqual({ ok: true });
  });

  test("another platform's floor doesn't apply", () => {
    expect(pluginCompatibility({ minAppVersion: { android: '9.0.0' } }, '0.9.11', 'desktop')).toEqual({ ok: true });
  });

  test('a pre-release of the floor version counts as that version', () => {
    expect(pluginCompatibility(manifest, '0.9.12-beta.1', 'desktop')).toEqual({ ok: true });
  });

  test('an app that cannot report its version is not refused', () => {
    expect(pluginCompatibility(manifest, undefined, 'desktop')).toEqual({ ok: true });
  });
});

describe('validateMinAppVersion', () => {
  test('absent or well formed is fine', () => {
    expect(validateMinAppVersion(undefined)).toEqual([]);
    expect(validateMinAppVersion({ desktop: '0.9.12', android: '1.4.0', ios: '1.0.0' })).toEqual([]);
  });

  test('names each problem', () => {
    expect(validateMinAppVersion('0.9.12')).toHaveLength(1);
    expect(validateMinAppVersion(null)).toHaveLength(1);
    const problems = validateMinAppVersion({ desktop: '0.9', windows: '1.0.0' });
    expect(problems).toHaveLength(2);
    expect(problems.join(' ')).toMatch(/desktop/);
    expect(problems.join(' ')).toMatch(/windows/);
  });

  test('the platforms are desktop, android and ios', () => {
    expect(PLUGIN_PLATFORMS).toEqual(['desktop', 'android', 'ios']);
  });
});

describe('bundled plugins', () => {
  const marketplace = JSON.parse(fs.readFileSync(path.join(ROOT, 'marketplace-manifest.json'), 'utf8'));
  const sources = fs.readdirSync(path.join(ROOT, 'plugins-src'))
    .filter((id) => fs.existsSync(path.join(ROOT, 'plugins-src', id, 'manifest.json')))
    .map((id) => [id, JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins-src', id, 'manifest.json'), 'utf8')).manifest]);

  test.each(sources)('%s: minAppVersion is valid and mirrored in the marketplace entry', (id, manifest) => {
    expect(validateMinAppVersion(manifest.minAppVersion)).toEqual([]);
    const entry = marketplace.plugins.find((p) => p.id === id);
    expect(entry && entry.minAppVersion).toEqual(manifest.minAppVersion);
  });

  test.each(sources)('%s: requires, when present, is well formed', (id, _manifest) => {
    const axe = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins-src', id, 'manifest.json'), 'utf8'));
    expect(validateRequires(axe.requires)).toEqual([]);
  });
});

describe('main.js enforcement', () => {
  const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  const handler = (name) => {
    const start = main.indexOf(`ipcMain.handle('${name}'`);
    expect(start).toBeGreaterThan(-1);
    return main.slice(start, main.indexOf('\n});', start));
  };

  test('the desktop check uses the app version and the desktop platform', () => {
    expect(main).toMatch(/pluginCompatibility\(manifest, app\.getVersion\(\), 'desktop'\)/);
  });

  test('marketplace sync checks the catalog entry before downloading, and the .axe before saving', () => {
    const sync = handler('plugins-sync-marketplace');
    expect(sync).toMatch(/desktopPluginCompatibility\(pluginInfo\)/);
    expect(sync).toMatch(/desktopPluginCompatibility\(plugin\.manifest\)/);
    expect(sync.indexOf('desktopPluginCompatibility(pluginInfo)')).toBeLessThan(sync.indexOf('fetchPlugin(pluginId)'));
    expect(sync).toMatch(/skipped/);
  });

  test('the loader skips a downloaded copy that needs a newer app, never the bundled one', () => {
    const loader = handler('resolvers-load-builtin');
    expect(loader).toMatch(/if \(source !== 'app'\) \{\s*const compat = desktopPluginCompatibility\(axe\.manifest\);/);
  });

  test('installs and marketplace downloads refuse a plugin that needs a newer app', () => {
    expect(handler('resolvers-install')).toMatch(/desktopPluginCompatibility\(axe\.manifest\)/);
    expect(handler('marketplace-download-resolver')).toMatch(/desktopPluginCompatibility\(axe\.manifest\)/);
  });
});

// #1355: requires.hostBridges. A plugin declares the host bridges it calls;
// each host advertises what it supplies (window.__parachordHostBridges) and
// the loader HIDES a plugin whose bridges aren't all there — hidden, not
// erroring, so the same .axe runs where the host has the bridge. The rule
// mirrors minAppVersion's shapes: absent is no requirement, malformed is no
// requirement (build-axes rejects a malformed one at source).
describe('pluginRequiredHostBridges', () => {
  test('reads a top-level requires.hostBridges', () => {
    expect(pluginRequiredHostBridges({ requires: { hostBridges: ['webSession', 'amazonMusic'] } }))
      .toEqual(['webSession', 'amazonMusic']);
  });

  test('absent, empty or malformed is no requirement (same shape as minAppVersion)', () => {
    expect(pluginRequiredHostBridges({})).toBeNull();
    expect(pluginRequiredHostBridges(null)).toBeNull();
    expect(pluginRequiredHostBridges({ requires: null })).toBeNull();
    expect(pluginRequiredHostBridges({ requires: 'webSession' })).toBeNull();
    expect(pluginRequiredHostBridges({ requires: [] })).toBeNull();
    expect(pluginRequiredHostBridges({ requires: { hostBridges: 'webSession' } })).toBeNull();
    expect(pluginRequiredHostBridges({ requires: { hostBridges: ['webSession', 42] } })).toBeNull();
  });
});

describe('hostBridgesCompatibility', () => {
  test('a host supplying every required bridge loads the plugin', () => {
    const axe = { requires: { hostBridges: ['amazonMusic', 'webSession'] } };
    expect(hostBridgesCompatibility(axe, ['amazonMusic', 'webSession', 'widevine'])).toEqual({ ok: true });
    expect(hostBridgesCompatibility(axe, ['webSession', 'amazonMusic'])).toEqual({ ok: true });
  });

  test('a host missing any required bridge hides the plugin, naming the missing ones', () => {
    const axe = { requires: { hostBridges: ['amazonMusic', 'webSession', 'somethingElse'] } };
    expect(hostBridgesCompatibility(axe, ['amazonMusic'])).toEqual({ ok: false, missing: ['webSession', 'somethingElse'] });
    expect(hostBridgesCompatibility(axe, [])).toEqual({ ok: false, missing: ['amazonMusic', 'webSession', 'somethingElse'] });
  });

  test('no requirement (absent or malformed) loads everywhere', () => {
    expect(hostBridgesCompatibility({}, [])).toEqual({ ok: true });
    expect(hostBridgesCompatibility(null, [])).toEqual({ ok: true });
    expect(hostBridgesCompatibility({ requires: { hostBridges: 'garbled' } }, [])).toEqual({ ok: true });
  });
});

describe('validateRequires (build-axes)', () => {
  test('absent, or an object without hostBridges, is fine', () => {
    expect(validateRequires(undefined)).toEqual([]);
    expect(validateRequires({})).toEqual([]);
    expect(validateRequires({ playback: 'widevine' })).toEqual([]); // future keys pass through untouched
  });

  test('names each problem', () => {
    expect(validateRequires('webSession')).toHaveLength(1);
    expect(validateRequires(['webSession'])).toHaveLength(1);
    const problems = validateRequires({ hostBridges: 'webSession' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/requires\.hostBridges must be an array/);
    const entries = validateRequires({ hostBridges: ['webSession', '', 7] });
    expect(entries).toHaveLength(2);
    expect(entries.join(' ')).toMatch(/non-empty strings/);
  });
});

describe('host-bridge enforcement wiring (#1355)', () => {
  const preload = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'src/renderer', 'app.js'), 'utf8');
  const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');

  test('the preload advertises window.__parachordHostBridges, and every advertised bridge is a real exposed block', () => {
    // The webSession entry is LIVE since the track-search move (#1356 M5 —
    // the bridge's first consumer; it shipped held back in the layer below,
    // the #1432 review's note-8 option). The amazonMusic entry is gone since
    // #1356 M10: the Amazon flows ride webSession, nothing requires the old
    // bridge, and the exposed amazonMusic block is the diagnostic remnant
    // (debugCaptureGql) only.
    // The entry list is a plain literal now (the env-seam spread is gone),
    // so pin the whole line: webSession, no flag.
    const match = preload.match(/const HOST_BRIDGES = .*/);
    expect(match).toBeTruthy();
    expect(match[0]).toBe("const HOST_BRIDGES = ['webSession'];");
    for (const bridge of ['webSession']) {
      // Each advertised name must be a window.electron.<bridge> block the
      // preload actually exposes — the list is what the host supplies, so a
      // name with no block is a lie to every plugin that requires it.
      expect(preload).toMatch(new RegExp(`^\\s{2}${bridge}: \\{`, 'm'));
    }
    expect(preload).toMatch(/exposeInMainWorld\('__parachordHostBridges', HOST_BRIDGES\)/);
  });

  test('the renderer hides a plugin whose host bridges are not supplied — one rule, every .axe load path (#1432 review, note 7)', () => {
    // The rule's one owner is lib/host-bridges-hide.js; the main load path,
    // the fallback load and the install/reload paths all run it.
    expect(app).toContain("const { hideAxesLackingHostBridges } = require('./lib/host-bridges-hide')");
    expect(app.match(/hideAxesLackingHostBridges\(/g) || []).toHaveLength(5); // initResolvers, the fallback load, install-from-file, marketplace install, the meta-service hot-reload (handlePluginsUpdated)
    // The pure half still lives in plugin-compat (mirrored by mobile).
    expect(require('../../main-process/plugin-compat').hostBridgesHideFilter).toBeInstanceOf(Function);
    // The helper module reads the advertisement the way initResolvers did.
    const helper = fs.readFileSync(path.join(ROOT, 'src/renderer/lib', 'host-bridges-hide.js'), 'utf8');
    expect(helper).toContain('Array.from((win && win.__parachordHostBridges) || [])');
    expect(helper).toContain('hostBridgesHideFilter(axes, supplied)');
  });


  test("main.js registers Amazon's ONE webSession host under its session id, gated like the widevine bridge", () => {
    // The ONE host instance lives in main-process/amazon-web-session.js (the
    // #1356 M11 teardown: amazon-web-player.js is deleted); main.js registers
    // it by reference, never re-created.
    expect(main).toMatch(/const amazonWebSession = require\('.\/main-process\/amazon-web-session'\)/);
    expect(main).toMatch(/registerWebSession\('amazon-music', amazonWebSession\)/);
    expect(main).toMatch(/amazonWebSession\.setHost\(mainWindow\)/);

    expect(main).toMatch(/registerWebSessionBridgeIpc\(\{\s*ipcMain,\s*isAllowedSender: isMainWindowTopFrameSender,\s*sendToRenderer: safeSendToRenderer\s*\}\)/);
    // The widevine bridge and the webSession bridge share one sender predicate.
    expect(main).toMatch(/registerWidevineBridgeIpc\(\{ ipcMain, isAllowedSender: isMainWindowTopFrameSender \}\)/);
    // The teardown deleted the host-side module and its last IPC channel.
    expect(require('fs').existsSync(path.join(ROOT, 'amazon-web-player.js'))).toBe(false);
    expect(main).not.toContain("ipcMain.handle('amazonmusic-debug-capture-gql'");
  });
});
