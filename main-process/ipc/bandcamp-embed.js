// main-process/ipc/bandcamp-embed.js: the main-process half of Bandcamp's
// hidden embed (the renderer half is src/renderer/lib/bandcamp-embed-player.js).
//
// SoundCloud's widget takes commands over postMessage. Bandcamp's embed has no
// such protocol, and the renderer can't reach into a cross-origin iframe, but
// the main process can, through WebFrameMain. So main runs a small control
// script in the embed's frame and polls it.
//
// The page is third party, so:
//   - only the main window's top frame may send these messages;
//   - only a frame showing exactly the embed URL asked for is driven, and that
//     URL has to pass isBandcampEmbedUrl;
//   - only fixed scripts run in it: an action picks one, and a value reaches it
//     only as a checked number, never as text;
//   - what the page answers goes through sanitizeEmbedState.
//
// The polling lives here rather than in the renderer because nothing in main
// slows down with the window, and a late `ended` would hold up the queue.
//
// Dependency-injected, so jest drives it with fakes.

const fs = require('fs');
const path = require('path');
const { isBandcampEmbedUrl, resolveBandcampEmbedUrl } = require('../bandcamp-embed-url');

const POLL_MS = 500;
// A position or duration past this (a month) isn't a real one.
const MAX_SECONDS = 2592000;

const seconds = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_SECONDS ? value : 0);

function sanitizeEmbedState(raw) {
  if (typeof raw !== 'string') return null;
  let state;
  try { state = JSON.parse(raw); } catch { return null; }
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
  return {
    audio: state.audio === true,
    hasSrc: state.hasSrc === true,
    paused: state.paused !== false,
    ended: state.ended === true,
    t: seconds(state.t),
    dur: seconds(state.dur),
    errorCode: Number.isInteger(state.errorCode) ? state.errorCode : null
  };
}

const COMMANDS = new Map([
  ['play', { script: () => 'bcPlay()', gesture: true }],
  ['pause', { script: () => 'bcPause()' }],
  ['seek', { script: (v) => `bcSeek(${Math.max(0, v)})`, takesNumber: true }],
  ['volume', { script: (v) => `bcVolume(${Math.min(1, Math.max(0, v))})`, takesNumber: true }]
]);

function registerBandcampEmbedIpc({ ipcMain, getMainWindow, sendToRenderer, fetch, controlScript, log = console }) {
  let script = controlScript;
  const control = () => {
    if (!script) script = fs.readFileSync(path.join(__dirname, '..', 'bandcamp-embed-control.js'), 'utf8');
    return script;
  };

  let session = null; // { token, url, volume, timer, busy, installed, started, last }

  const fromMainWindow = (event) => {
    const win = getMainWindow();
    if (!win || win.isDestroyed() || !event) return false;
    return event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame;
  };

  const frameFor = (url) => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return null;
    try {
      return win.webContents.mainFrame.frames.find((frame) => frame.url === url) || null;
    } catch {
      return null;
    }
  };

  const endSession = () => {
    if (session && session.timer) clearInterval(session.timer);
    session = null;
  };

  const poll = async (current) => {
    if (current.busy) return;
    current.busy = true;
    try {
      const frame = frameFor(current.url);
      if (!frame) return;
      if (!current.installed) {
        await frame.executeJavaScript(control());
        current.installed = true;
      }
      if (!current.started) {
        if (typeof current.volume === 'number') await frame.executeJavaScript(`bcVolume(${current.volume})`);
        current.started = (await frame.executeJavaScript('bcStart()', true)) === true;
        if (!current.started) return;
      }
      const state = sanitizeEmbedState(await frame.executeJavaScript('bcState()'));
      if (!state || session !== current) return;
      const json = JSON.stringify(state);
      if (json !== current.last) {
        current.last = json;
        sendToRenderer('bandcamp-embed:state', { ...state, token: current.token });
      }
    } catch {
      // The frame went away or reloaded: the next poll finds it again, and a
      // reloaded page needs the control script again.
      current.installed = false;
    } finally {
      current.busy = false;
    }
  };

  const refuse = { success: false, reason: 'unplayable' };

  ipcMain.handle('bandcamp-embed:prepare', async (event, source) => {
    if (!fromMainWindow(event) || !source || typeof source !== 'object') return refuse;
    const url = await resolveBandcampEmbedUrl(source, { fetch, log });
    return url ? { success: true, url } : refuse;
  });

  ipcMain.handle('bandcamp-embed:start', async (event, { token, url, volume } = {}) => {
    if (!fromMainWindow(event) || !isBandcampEmbedUrl(url)) return refuse;
    endSession();
    const current = {
      token,
      url,
      volume: typeof volume === 'number' && Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : undefined,
      busy: false,
      installed: false,
      started: false,
      last: null
    };
    session = current;
    current.timer = setInterval(() => { poll(current); }, POLL_MS);
    return { success: true };
  });

  ipcMain.handle('bandcamp-embed:command', async (event, { token, action, value } = {}) => {
    if (!fromMainWindow(event) || !session || session.token !== token) return { success: false };
    const command = typeof action === 'string' ? COMMANDS.get(action) : null;
    if (!command) return { success: false };
    if (command.takesNumber && !(typeof value === 'number' && Number.isFinite(value))) return { success: false };
    if (action === 'volume') session.volume = Math.min(1, Math.max(0, value));
    const frame = frameFor(session.url);
    if (!frame) return { success: false };
    try {
      await frame.executeJavaScript(command.script(value), command.gesture === true);
      return { success: true };
    } catch {
      return { success: false };
    }
  });

  ipcMain.handle('bandcamp-embed:stop', async (event, { token } = {}) => {
    if (!fromMainWindow(event)) return { success: false };
    if (session && session.token === token) endSession();
    return { success: true };
  });
}

module.exports = { registerBandcampEmbedIpc, sanitizeEmbedState, POLL_MS };
