// What desktop supplies plugins under the plug-in host contract (#1561):
// src/renderer/lib/plugin-host-supplier.js.

const { desktopPluginHostSupplier } = require('../../src/renderer/lib/plugin-host-supplier');
const fs = require('fs');
const path = require('path');

describe('desktopPluginHostSupplier', () => {
  test('the preload’s advertised bridges come from window.electron, read when asked', () => {
    const win = { __parachordHostBridges: ['webSession'], electron: { webSession: { id: 1 } } };
    const s = desktopPluginHostSupplier(win);
    expect(s.bridges.webSession()).toEqual({ id: 1 });
    win.electron.webSession = { id: 2 };
    expect(s.bridges.webSession()).toEqual({ id: 2 });
    expect(s.bridges.localFiles).toBeUndefined(); // not advertised, so not supplied
  });

  test('widevine is the renderer’s shared player, null until it exists', () => {
    const win = {};
    const s = desktopPluginHostSupplier(win);
    expect(s.bridges.widevine()).toBeNull();
    win.__parachordWidevine = { stop() {} };
    expect(s.bridges.widevine()).toBe(win.__parachordWidevine);
  });

  test('the core reads the app version, the config callback and the shell', async () => {
    const openExternal = jest.fn().mockResolvedValue(true);
    const win = { electron: { updater: { getVersion: () => Promise.resolve('0.9.14') }, shell: { openExternal } } };
    const s = desktopPluginHostSupplier(win, (id) => ({ id }));
    expect(s.platform).toBe('desktop');
    expect(await s.appVersion()).toBe('0.9.14');
    expect(s.getConfig('amazonmusic')).toEqual({ id: 'amazonmusic' });
    await s.openExternal('https://example.com');
    expect(openExternal).toHaveBeenCalledWith('https://example.com');
    expect(desktopPluginHostSupplier({}).appVersion()).toBeNull();
  });

  test('app.js builds the loader with it', () => {
    const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
    expect(app).toMatch(/new ResolverLoader\(\{\s*host: desktopPluginHostSupplier\(window,/);
    expect(app).not.toMatch(/new ResolverLoader\(\)/);
  });
});
