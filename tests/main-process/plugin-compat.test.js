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
  validateMinAppVersion
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
