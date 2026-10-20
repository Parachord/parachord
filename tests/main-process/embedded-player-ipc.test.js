// Unit tests for main-process/ipc/embedded-player.js — the shared IPC that
// turns hijacked OS media keys from embedded web-player views into
// mpris-control transport events. Dependency-injected, no electron require.

const {
  registerEmbeddedPlayer,
  registerEmbeddedPlayerIpc
} = require('../../main-process/ipc/embedded-player');

function makeWebContents(id) {
  const listeners = {};
  return {
    id,
    once(event, fn) { listeners[event] = fn; },
    emit(event) { if (listeners[event]) listeners[event](); },
    _listeners: listeners
  };
}

function makeIpcMain() {
  const handlers = new Map();
  return {
    on(channel, fn) { handlers.set(channel, fn); },
    _handlers: handlers
  };
}

function setup({ mediaKeysEnabled } = {}) {
  const ipcMain = makeIpcMain();
  const sent = [];
  registerEmbeddedPlayerIpc({
    ipcMain,
    safeSendToRenderer: (channel, payload) => sent.push([channel, payload]),
    mediaKeysEnabled: mediaKeysEnabled || (() => true)
  });
  const fire = (sender, payload) => ipcMain._handlers.get('embedded-player-media-key')({ sender }, payload);
  return { fire, sent };
}

describe('registerEmbeddedPlayerIpc', () => {
  test('forwards hijacked actions from registered views into mpris-control', () => {
    const { fire, sent } = setup();
    const view = makeWebContents(11);
    registerEmbeddedPlayer(view, { resolverId: 'amazonmusic' });

    fire(view, { action: 'play' });
    fire(view, { action: 'pause' });
    fire(view, { action: 'stop' });
    fire(view, { action: 'previoustrack' });
    fire(view, { action: 'nexttrack' });
    expect(sent).toEqual([
      ['mpris-control', { action: 'play', source: 'embedded:amazonmusic' }],
      ['mpris-control', { action: 'pause', source: 'embedded:amazonmusic' }],
      ['mpris-control', { action: 'stop', source: 'embedded:amazonmusic' }],
      ['mpris-control', { action: 'previous', source: 'embedded:amazonmusic' }],
      ['mpris-control', { action: 'next', source: 'embedded:amazonmusic' }]
    ]);
  });

  test('unregistered views and malformed payloads are dropped silently', () => {
    const { fire, sent } = setup();
    const stranger = makeWebContents(99);

    fire(stranger, { action: 'play' });            // not registered
    fire(null, { action: 'play' });                // no sender
    fire({ id: 'not-a-number' }, { action: 'play' });// sender without numeric id

    const view = makeWebContents(12);
    registerEmbeddedPlayer(view, { resolverId: 'amazonmusic' });
    fire(view, { action: 'seekto' });              // not a hijacked action
    fire(view, { action: 'drop-table' });          // forged/stale payload
    fire(view, null);                              // no payload at all

    expect(sent).toEqual([]);
  });

  test('the media-key-handling opt-out is honored per event', () => {
    let enabled = false;
    const { fire, sent } = setup({ mediaKeysEnabled: () => enabled });
    const view = makeWebContents(13);
    registerEmbeddedPlayer(view, { resolverId: 'amazonmusic' });

    fire(view, { action: 'play' });
    expect(sent).toEqual([]);
    enabled = true;
    fire(view, { action: 'play' });
    expect(sent).toEqual([['mpris-control', { action: 'play', source: 'embedded:amazonmusic' }]]);
  });

  test('a destroyed view is unregistered; registration is idempotent per id', () => {
    const { fire, sent } = setup();
    const view = makeWebContents(14);
    registerEmbeddedPlayer(view, { resolverId: 'amazonmusic' });
    registerEmbeddedPlayer(view, { resolverId: 'amazonmusic' });
    fire(view, { action: 'play' });
    expect(sent.length).toBe(1);

    view.emit('destroyed');
    fire(view, { action: 'play' });
    expect(sent.length).toBe(1);
  });

  test('registerEmbeddedPlayer tolerates non-webContents inputs', () => {
    expect(() => registerEmbeddedPlayer(null, { resolverId: 'x' })).not.toThrow();
    expect(() => registerEmbeddedPlayer({}, { resolverId: 'x' })).not.toThrow();
    expect(() => registerEmbeddedPlayer({ id: 1 }, {})).not.toThrow();
  });
});
