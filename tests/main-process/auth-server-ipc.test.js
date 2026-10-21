/**
 * Settings → General "Local server port" IPC (parachord#958):
 * main-process/ipc/auth-server.js, driven with a fake ipcMain and store.
 */

const { registerAuthServerIpc, STORE_KEY } = require('../../main-process/ipc/auth-server');

function setup(state = { port: 8888, listening: true, error: null }) {
  const handlers = new Map();
  const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn) };
  const data = new Map();
  const store = {
    get: (k) => data.get(k),
    set: (k, v) => data.set(k, v),
    delete: (k) => data.delete(k),
  };
  registerAuthServerIpc({ ipcMain, store, getAuthServerState: () => state });
  const call = (channel, ...args) => handlers.get(channel)({}, ...args);
  return { call, data, state };
}

describe('auth-server IPC', () => {
  const savedEnv = process.env.AUTH_SERVER_PORT;
  beforeEach(() => { delete process.env.AUTH_SERVER_PORT; });
  afterAll(() => {
    if (savedEnv === undefined) delete process.env.AUTH_SERVER_PORT;
    else process.env.AUTH_SERVER_PORT = savedEnv;
  });

  test('get-status reports the bound port, the next launch\'s port and any bind error', () => {
    const { call } = setup({ port: 8888, listening: false, error: { code: 'EADDRINUSE', message: 'in use' } });
    expect(call('auth-server:get-status')).toEqual({
      port: 8888,
      listening: false,
      error: { code: 'EADDRINUSE', message: 'in use' },
      configuredPort: 8888,
      defaultPort: 8888,
    });
  });

  test('set-port saves for the next launch; the bound port is unchanged until restart', () => {
    const { call, data } = setup();
    const result = call('auth-server:set-port', '18888');
    expect(result.success).toBe(true);
    expect(data.get(STORE_KEY)).toBe(18888);
    expect(result.port).toBe(8888);
    expect(result.configuredPort).toBe(18888);
  });

  test('set-port rejects an invalid port and stores nothing', () => {
    const { call, data } = setup();
    for (const bad of ['80', '9876', 'abc', '70000', '']) {
      const result = call('auth-server:set-port', bad);
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/1024 to 65535/);
    }
    expect(data.has(STORE_KEY)).toBe(false);
  });

  test('saving the default clears the setting instead of storing 8888', () => {
    const { call, data } = setup();
    call('auth-server:set-port', 18888);
    call('auth-server:set-port', 8888);
    expect(data.has(STORE_KEY)).toBe(false);
  });

  test('saving the default is stored explicitly when AUTH_SERVER_PORT would otherwise win', () => {
    process.env.AUTH_SERVER_PORT = '19999';
    const { call, data } = setup({ port: 19999, listening: true, error: null });
    const result = call('auth-server:set-port', 8888);
    expect(data.get(STORE_KEY)).toBe(8888);
    expect(result.configuredPort).toBe(8888);
  });
});
