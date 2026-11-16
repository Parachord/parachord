// #1452: the size setting is Chromium's zoom factor (main-process/ui-zoom.js).
const fs = require('fs');
const path = require('path');
const Z = require('../../main-process/ui-zoom');

test('levels, normalising and stepping', () => {
  expect(Z.ZOOM_LEVELS).toEqual([0.9, 1, 1.1, 1.25, 1.5]);
  expect(Z.normalizeZoom('1.25')).toBe(1.25);
  expect(Z.normalizeZoom(3)).toBe(1);
  expect(Z.normalizeZoom(undefined)).toBe(1);
  expect(Z.stepZoom(1, 1)).toBe(1.1);
  expect(Z.stepZoom(1.5, 1)).toBe(1.5);
  expect(Z.stepZoom(0.9, -1)).toBe(0.9);
  expect(Z.stepZoom(1.25, 0)).toBe(1);
});

test('the minimum window grows with the zoom, capped at the work area', () => {
  expect(Z.minSizeFor(1)).toEqual({ width: 1000, height: 600 });
  expect(Z.minSizeFor(1.25)).toEqual({ width: 1250, height: 750 });
  expect(Z.minSizeFor(1.5, { width: 1440, height: 800 })).toEqual({ width: 1440, height: 800 });
});

test('applyZoom sets the factor, the minimum, and grows a window that is too small', () => {
  const calls = [];
  const win = {
    isDestroyed: () => false,
    webContents: { setZoomFactor: (z) => calls.push(['zoom', z]) },
    getBounds: () => ({}),
    setMinimumSize: (w, h) => calls.push(['min', w, h]),
    getSize: () => [1100, 700],
    setSize: (w, h) => calls.push(['size', w, h]),
  };
  Z.applyZoom(win, 1.25, { getDisplayMatching: () => ({ workAreaSize: { width: 2000, height: 1200 } }) });
  expect(calls).toEqual([['zoom', 1.25], ['min', 1250, 750], ['size', 1250, 750]]);
});

test('IPC: set stores, applies and tells the renderer; step moves from the stored level', () => {
  const handlers = {};
  const stored = {};
  const sent = [];
  const win = { isDestroyed: () => false, webContents: { setZoomFactor() {}, send: (ch, z) => sent.push([ch, z]) }, getBounds: () => ({}), setMinimumSize() {}, getSize: () => [2000, 1200], setSize() {} };
  const api = Z.registerUiZoom({
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    store: { get: (k) => stored[k], set: (k, v) => { stored[k] = v; } },
    screen: { getDisplayMatching: () => ({ workAreaSize: { width: 3000, height: 2000 } }) },
    getWindow: () => win,
  });
  expect(handlers['ui-zoom:set'](null, 1.1)).toBe(1.1);
  expect(stored.ui_zoom).toBe(1.1);
  expect(sent).toEqual([['ui-zoom-changed', 1.1]]);
  expect(api.step(1)).toBe(1.25);
  expect(handlers['ui-zoom:get']()).toBe(1.25);
});

test('wired in: window creation, the View menu, preload, the store key, Settings', () => {
  const root = path.join(__dirname, '../..');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  expect(main).toContain('zoomFactor: initialZoom,');
  expect(main).toContain('minWidth: initialMin.width,');
  expect(main).toMatch(/label: 'Zoom In', accelerator: 'CmdOrCtrl\+=', click: \(\) => uiZoom\.step\(1\)/);
  expect(main).toMatch(/label: 'Zoom Out', accelerator: 'CmdOrCtrl\+-', click: \(\) => uiZoom\.step\(-1\)/);
  expect(main).toMatch(/label: 'Actual Size', accelerator: 'CmdOrCtrl\+0', click: \(\) => uiZoom\.step\(0\)/);
  expect(fs.readFileSync(path.join(root, 'preload.js'), 'utf8')).toContain("setZoom: (zoom) => ipcRenderer.invoke('ui-zoom:set', zoom),");
  expect(fs.readFileSync(path.join(root, 'main-process/ipc/store.js'), 'utf8')).toContain("'ui_zoom'");
  expect(require('../helpers/renderer-source').appWithPages()).toContain("React.createElement(SettingRow, { label: 'Size',");
});
