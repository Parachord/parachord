// Unit tests for main-process/ipc/embedded-player.js — the shared IPC that
// turns hijacked OS media keys from embedded web-player views into
// mpris-control transport events. Dependency-injected, no electron require.

const {
  registerEmbeddedPlayer,
  registerEmbeddedPlayerIpc,
  sendMirrorToEmbeddedPlayer,
  createEmbeddedPlayerMirror
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

describe('sendMirrorToEmbeddedPlayer', () => {
  test('delivers to a resolver\'s live views, prunes destroyed ones, skips other resolvers', () => {
    const amazonA = { ...makeWebContents(21), sent: [], send(channel, payload) { this.sent.push(payload); }, isDestroyed: () => false };
    const amazonB = { ...makeWebContents(22), send() { throw new Error('should not reach'); }, isDestroyed: () => true };
    const other = { ...makeWebContents(23), sent: [], send(channel, payload) { this.sent.push(payload); }, isDestroyed: () => false };
    registerEmbeddedPlayer(amazonA, { resolverId: 'amazonmusic' });
    registerEmbeddedPlayer(amazonB, { resolverId: 'amazonmusic' });
    registerEmbeddedPlayer(other, { resolverId: 'bandcamp' });

    sendMirrorToEmbeddedPlayer('amazonmusic', { playbackState: 'playing' });
    expect(amazonA.sent).toEqual([{ playbackState: 'playing' }]);
    expect(other.sent).toEqual([]);
  });
});

describe('createEmbeddedPlayerMirror', () => {
  const setup = ({ isOwned = () => true, enabled = () => true } = {}) => {
    const sent = [];
    const mirror = createEmbeddedPlayerMirror({
      sendMirror: (payload) => sent.push(payload),
      isOwned,
      enabled
    });
    return { mirror, sent };
  };

  test('track change sends metadata + a zero position carrying the duration', () => {
    const { mirror, sent } = setup();
    mirror.updateTrack({ title: 'T', artist: 'A', album: 'AL', albumArt: 'https://e.com/a.jpg', duration: 254 });
    expect(sent).toEqual([{
      metadata: { title: 'T', artist: 'A', album: 'AL', artwork: 'https://e.com/a.jpg' },
      position: { duration: 254, position: 0, rate: 0 }
    }]);
  });

  test('position pushes reuse the cached duration and playback rate', () => {
    const { mirror, sent } = setup();
    mirror.updateTrack({ title: 'T', artist: 'A', album: 'AL', duration: 254 });
    mirror.updatePlaybackState('playing');
    mirror.updatePosition(30);
    expect(sent[sent.length - 1]).toEqual({ position: { duration: 254, position: 30, rate: 1 } });
    mirror.updatePlaybackState('paused');
    expect(sent[sent.length - 1]).toEqual({
      playbackState: 'paused',
      position: { duration: 254, position: 30, rate: 0 }
    });
  });

  test('a null track clears; unknown duration skips the position patch', () => {
    const { mirror, sent } = setup();
    mirror.updateTrack({ title: 'T', artist: 'A', album: 'AL', duration: 254 });
    mirror.updateTrack(null);
    expect(sent[sent.length - 1]).toEqual({ metadata: null });
    // No known duration → there is no position to claim; nothing is sent
    mirror.updatePosition(99);
    expect(sent.length).toBe(2); // the clear was the last push
    expect(sent[sent.length - 1]).toEqual({ metadata: null });
    mirror.updateTrack({ title: 'U', artist: 'B', album: 'AL' }); // no duration
    expect(sent[sent.length - 1]).toEqual({ metadata: { title: 'U', artist: 'B', album: 'AL', artwork: null } });
  });

  test('isOwned and enabled gates apply to every push (Amazon must own playback; Linux skips the mirror)', () => {
    const owned = { value: true };
    const linux = { value: false };
    const { mirror, sent } = setup({
      isOwned: () => owned.value,
      enabled: () => !linux.value
    });
    mirror.updateTrack({ title: 'T', artist: 'A', album: 'AL', duration: 10 });
    expect(sent.length).toBe(1);
    owned.value = false; // another resolver is playing — do not write into Amazon's session
    mirror.updateTrack({ title: 'T2', artist: 'A', album: 'AL', duration: 10 });
    expect(sent.length).toBe(1);
    owned.value = true;
    linux.value = true; // #848 policy: never feed Chromium's MPRIS on Linux
    mirror.updateTrack({ title: 'T3', artist: 'A', album: 'AL', duration: 10 });
    expect(sent.length).toBe(1);
  });
});
