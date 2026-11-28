// src/renderer/lib/plugin-host-supplier.js: what desktop supplies plugins
// under the plug-in host contract (#1561; docs/architecture/plugins.md "The
// plug-in host contract"). ResolverLoader builds each plugin's frozen
// `this.host` from it: the core (platform, appVersion, getConfig,
// openExternal) and the bridges this host has, of which a plugin sees only
// the ones its manifest declares.
//
// Bridges come from two places:
// - the preload's, advertised in window.__parachordHostBridges (the list the
//   hide rule reads) and exposed at window.electron.<name>;
// - the renderer's own: `widevine`, the shared Widevine player
//   (window.__parachordWidevine, set by hooks/use-playback-engine.js), which
//   plugins declare as optional because the phones have none; and
//   `musicKit`, the Apple Music account calls the app makes for its plug-in
//   (window.__parachordMusicKit, set in app.js: isSignedIn, favoriteSong).
// Each is read when the plugin asks, so a bridge set up after plugins load is
// still the live object.
//
// Loads under plain Node.

'use strict';

// Bridges the renderer supplies itself, by name → how to read it.
const RENDERER_BRIDGES = {
  widevine: (win) => win.__parachordWidevine,
  musicKit: (win) => win.__parachordMusicKit,
};

function desktopPluginHostSupplier(win, getConfig) {
  const w = win || {};
  const electron = () => w.electron || null;
  const bridges = {};
  const advertised = Array.isArray(w.__parachordHostBridges) ? w.__parachordHostBridges : [];
  for (const name of advertised) {
    if (typeof name === 'string' && name) bridges[name] = () => (electron() ? electron()[name] : null);
  }
  for (const [name, read] of Object.entries(RENDERER_BRIDGES)) {
    if (!bridges[name]) bridges[name] = () => read(w) || null;
  }
  return {
    platform: 'desktop',
    appVersion: () => {
      const updater = electron() && electron().updater;
      return updater && typeof updater.getVersion === 'function' ? updater.getVersion() : null;
    },
    getConfig: (pluginId) => (typeof getConfig === 'function' ? getConfig(pluginId) : {}),
    openExternal: (url) => {
      const shell = electron() && electron().shell;
      if (!shell || typeof shell.openExternal !== 'function') throw new Error('This app can’t open links');
      return shell.openExternal(url);
    },
    bridges,
  };
}

module.exports = { desktopPluginHostSupplier, RENDERER_BRIDGES };
