// main-process/ui-zoom.js: the window's size setting (#1452).
//
// Text size and density are one setting: Chromium's zoom factor, which
// scales text, art, controls and spacing together. The alternative, type
// and spacing tokens across ~1,000 inline pixel values, was decided against
// (2026-11-16): the zoom gives a larger or smaller app without them.
//
// The layout is built for a window at least 1000 points wide (the content
// area is then 744px). Zoom divides the CSS width, so the window's minimum
// size grows with the zoom: at 125% the window can't go below 1250 wide, and
// pages never lay out narrower than at 100%. The minimum is capped at the
// display's work area, so a big zoom on a small screen still fits.
//
// The level is stored as `ui_zoom` and applied at window creation
// (webPreferences.zoomFactor), so the app never paints at the wrong size.

const ZOOM_LEVELS = [0.9, 1, 1.1, 1.25, 1.5];
const BASE_MIN = { width: 1000, height: 600 };
const STORE_KEY = 'ui_zoom';

function normalizeZoom(value) {
  const n = Number(value);
  return ZOOM_LEVELS.includes(n) ? n : 1;
}

// dir: 1 bigger, -1 smaller, 0 back to 100%. Stops at the ends.
function stepZoom(current, dir) {
  if (dir === 0) return 1;
  const i = ZOOM_LEVELS.indexOf(normalizeZoom(current));
  return ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, i + (dir > 0 ? 1 : -1)))];
}

// The window's minimum size at a zoom, capped at the work area.
function minSizeFor(zoom, workArea) {
  const z = normalizeZoom(zoom);
  const width = Math.round(BASE_MIN.width * z);
  const height = Math.round(BASE_MIN.height * z);
  if (!workArea) return { width, height };
  return { width: Math.min(width, workArea.width), height: Math.min(height, workArea.height) };
}

function applyZoom(win, zoom, screen) {
  if (!win || win.isDestroyed()) return;
  const z = normalizeZoom(zoom);
  win.webContents.setZoomFactor(z);
  const workArea = screen ? screen.getDisplayMatching(win.getBounds()).workAreaSize : null;
  const min = minSizeFor(z, workArea);
  win.setMinimumSize(min.width, min.height);
  // A window smaller than the new minimum grows to it.
  const [w, h] = win.getSize();
  if (w < min.width || h < min.height) win.setSize(Math.max(w, min.width), Math.max(h, min.height));
}

// IPC: ui-zoom:get, ui-zoom:set (a level), ui-zoom:step (1, -1, 0). Each
// change is stored, applied and sent to the renderer (ui-zoom-changed) so
// Settings shows it, whether it came from Settings or the View menu.
function registerUiZoom({ ipcMain, store, screen, getWindow }) {
  const set = (zoom) => {
    const z = normalizeZoom(zoom);
    store.set(STORE_KEY, z);
    const win = getWindow();
    applyZoom(win, z, screen);
    if (win && !win.isDestroyed()) win.webContents.send('ui-zoom-changed', z);
    return z;
  };
  const step = (dir) => set(stepZoom(store.get(STORE_KEY), dir));
  ipcMain.handle('ui-zoom:get', () => normalizeZoom(store.get(STORE_KEY)));
  ipcMain.handle('ui-zoom:set', (_event, zoom) => set(zoom));
  ipcMain.handle('ui-zoom:step', (_event, dir) => step(Number(dir) || 0));
  return { set, step, initial: () => normalizeZoom(store.get(STORE_KEY)) };
}

module.exports = { ZOOM_LEVELS, BASE_MIN, STORE_KEY, normalizeZoom, stepZoom, minSizeFor, applyZoom, registerUiZoom };
