// Spike preload: the only bridge between player-b.html and main.
// relayLicense sends the CDM's license-challenge bytes to main, which relays
// them to dmls getLicenseForPlaybackV2 and returns the license bytes. The
// manifest push (player-b:load) carries the DASH MPD main fetched.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__playerB', {
  relayLicense: (b64Challenge) => ipcRenderer.invoke('amazon-b-license', b64Challenge),
});
// contextIsolation: the preload runs in its own world and cannot see the
// page's __playerB_load. Cross the boundary with a CustomEvent (its detail
// structured-clones across worlds).
ipcRenderer.on('player-b:load', (_ev, payload) => {
  window.dispatchEvent(new CustomEvent('player-b-load', { detail: payload }));
});
