// main-process/ipc/auth-server.js — Settings → General "Local server port"
// (parachord#958). Reads the running server's state and saves the port the
// next launch binds. The port only applies after a restart: tearing the
// listener down mid-OAuth would strand a sign-in in progress.
//
// Dependency-injected ({ ipcMain, store, getAuthServerState }) so jest drives
// the handlers directly (tests/main-process/auth-server-ipc.test.js).

const {
  DEFAULT_AUTH_PORT,
  MIN_AUTH_PORT,
  MAX_AUTH_PORT,
  normalizeAuthPort,
  resolveAuthPort,
} = require('../auth-port');

const STORE_KEY = 'oauth_callback_port';

function registerAuthServerIpc({ ipcMain, store, getAuthServerState }) {
  const status = () => {
    const state = getAuthServerState() || {};
    return {
      // What is bound now — redirect URIs use this until the next launch.
      port: state.port ?? null,
      listening: !!state.listening,
      error: state.error || null,
      // What the next launch will bind (store → AUTH_SERVER_PORT → default).
      configuredPort: resolveAuthPort({ stored: store.get(STORE_KEY), env: process.env.AUTH_SERVER_PORT }),
      defaultPort: DEFAULT_AUTH_PORT,
    };
  };

  ipcMain.handle('auth-server:get-status', () => status());

  // Saves the port for the next launch. The default is stored as "unset" so
  // resetting leaves no trace, unless an AUTH_SERVER_PORT env would then win
  // over it: the user asked for the default, so store it explicitly.
  ipcMain.handle('auth-server:set-port', (event, value) => {
    const port = normalizeAuthPort(value);
    if (port === null) {
      // `message`, not `error`: status() carries `error` (the bind error).
      return {
        ...status(),
        success: false,
        message: `Use a whole number from ${MIN_AUTH_PORT} to ${MAX_AUTH_PORT} (9876 is taken by Parachord's browser extension server).`,
      };
    }
    if (port === DEFAULT_AUTH_PORT && normalizeAuthPort(process.env.AUTH_SERVER_PORT) === null) {
      store.delete(STORE_KEY);
    } else {
      store.set(STORE_KEY, port);
    }
    return { success: true, ...status() };
  });
}

module.exports = { registerAuthServerIpc, STORE_KEY };
