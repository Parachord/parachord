/**
 * A plugin's saved config while the startup bulk load is still running: the
 * in-memory copy can be empty, and getResolverConfig caches what it returns
 * for 10 seconds, so answering {} would leave the plugin unconfigured for the
 * whole first resolution (1056 review: a deep link at launch).
 */

const fs = require('fs');
const path = require('path');
const { savedPluginConfig } = require('../../src/renderer/lib/playback-helpers');

describe('savedPluginConfig', () => {
  const stored = { subsonic: { serverUrl: 'http://stored' } };

  test('an in-memory entry wins and the store is not read', async () => {
    const readStored = jest.fn();
    const memory = { serverUrl: 'http://memory' };
    await expect(savedPluginConfig('subsonic', memory, readStored)).resolves.toBe(memory);
    expect(readStored).not.toHaveBeenCalled();
  });

  test('an empty in-memory copy falls back to the saved entry', async () => {
    await expect(savedPluginConfig('subsonic', undefined, async () => stored)).resolves.toEqual({ serverUrl: 'http://stored' });
  });

  test('nothing saved for this plugin answers an empty config', async () => {
    await expect(savedPluginConfig('plex', undefined, async () => stored)).resolves.toEqual({});
    await expect(savedPluginConfig('plex', undefined, async () => null)).resolves.toEqual({});
  });

  test('a failed store read answers an empty config', async () => {
    await expect(savedPluginConfig('subsonic', undefined, async () => { throw new Error('ipc'); })).resolves.toEqual({});
  });

  test('getResolverConfig reads through it', () => {
    const appSrc = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
    const start = appSrc.indexOf('const _fetchResolverConfig = async');
    const body = appSrc.slice(start, appSrc.indexOf('\n  };\n', start));
    expect(body).toContain('savedPluginConfig(');
    expect(body).toContain('metaServiceConfigsRef.current?.[resolverId] || metaServiceConfigs[resolverId]');
    expect(body).toContain("window.electron.store.get('meta_service_configs')");
  });
});
