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
    // Prototype keys pass a bare property lookup — the allowlist must not let
    // 'constructor'/'toString'/'__proto__' through (PR review, 2026-10)
    fire(view, { action: 'constructor' });
    fire(view, { action: 'toString' });
    fire(view, { action: '__proto__' });

    expect(sent).toEqual([]);
  });

  test('a registered view whose resolver does not own playback cannot drive the transport', () => {
    // The search view / a parked player view must not reach Parachord's
    // transport while another resolver plays — the registration's isOwned()
    // gate (amazonWebPlayer.currentAsin, PR review, 2026-10).
    const { fire, sent } = setup();
    const owned = { value: true };
    const view = makeWebContents(31);
    registerEmbeddedPlayer(view, { resolverId: 'amazonmusic', isOwned: () => owned.value });
    fire(view, { action: 'play' });
    expect(sent.length).toBe(1);
    owned.value = false; // Amazon no longer owns playback (halted / disabled)
    fire(view, { action: 'pause' });
    fire(view, { action: 'nexttrack' });
    expect(sent.length).toBe(1);
  });

  test('a per-sender rate limit caps transport spam from a page script', () => {
    const { fire, sent } = setup();
    const view = makeWebContents(32);
    registerEmbeddedPlayer(view, { resolverId: 'amazonmusic' });
    for (let i = 0; i < 12; i++) fire(view, { action: i % 2 ? 'nexttrack' : 'previoustrack' });
    expect(sent.length).toBe(12); // within the window
    fire(view, { action: 'play' });
    expect(sent.length).toBe(12); // capped
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

  test('a REAL state transition re-anchors with the cached position and the matching rate', () => {
    // PR review, 2026-10: a bare state push with no position leaves a stale
    // rate anchor (cold start used to stick at rate 0). A real transition now
    // carries playbackState + a position patch with the CACHED position (the
    // renderer pushes mpris:update-position alongside state changes) and the
    // matching rate. Repeated identical state pushes (churn re-fires) push
    // nothing at all.
    const { mirror, sent } = setup();
    mirror.updateTrack({ id: 't1', title: 'T', artist: 'A', album: 'AL', duration: 254 });
    mirror.updatePosition(30);
    const before = sent.length;
    mirror.updatePlaybackState('playing'); // real transition: paused → playing
    expect(sent[sent.length - 1]).toEqual({
      playbackState: 'playing',
      position: { duration: 254, position: 30, rate: 1 }
    });
    mirror.updatePlaybackState('playing'); // churn re-fire, no transition
    expect(sent.length).toBe(before + 1);
    mirror.updatePlaybackState('paused'); // real transition
    expect(sent[sent.length - 1]).toEqual({
      playbackState: 'paused',
      position: { duration: 254, position: 30, rate: 0 }
    });
    // 'stopped' maps to 'none' (the renderer sends it when currentTrack
    // clears), not collapsed to 'paused'
    mirror.updatePlaybackState('stopped');
    expect(sent[sent.length - 1].playbackState).toBe('none');
  });

  test('a same-track churn that first makes the duration known re-anchors with it', () => {
    // A search-resolved Amazon track starts at duration 0; the poller repairs
    // it mid-play as a same-track churn. Without a position push there, the
    // card never gets the duration (PR review, 2026-10).
    const { mirror, sent } = setup();
    mirror.updateTrack({ id: 't1', title: 'T', artist: 'A', album: 'AL' }); // no duration
    mirror.updatePlaybackState('playing');
    mirror.updatePosition(5);
    const before = sent.length;
    mirror.updateTrack({ id: 't1', title: 'T', artist: 'A', album: 'AL', duration: 442 }); // repaired
    expect(sent[sent.length - 1]).toEqual({
      metadata: { title: 'T', artist: 'A', album: 'AL', artwork: null },
      position: { duration: 442, position: 5, rate: 1 }
    });
    // A churn that does NOT change the duration pushes metadata only — no
    // position re-anchor
    mirror.updateTrack({ id: 't1', title: 'T', artist: 'A', album: 'AL', duration: 442 });
    expect(sent[sent.length - 1].position).toBeUndefined();
    expect(sent.length).toBe(before + 2); // the repair anchor + this metadata-only push
  });

  test('artwork is filtered https-only in MAIN before the payload crosses into the page world', () => {
    // PR review, 2026-10: the mirror payload is postMessage-broadcast in the
    // page world (visible to page listeners), so a file:// cover path must
    // never make the trip. main is the filter; the kit check is the belt.
    const { mirror, sent } = setup();
    mirror.updateTrack({ id: 't1', title: 'T', artist: 'A', album: 'AL', duration: 100, albumArt: 'file:///Users/theli/covers/x.jpg' });
    expect(sent[sent.length - 1].metadata.artwork).toBeNull();
    mirror.updateTrack({ id: 't1', title: 'T', artist: 'A', album: 'AL', duration: 100, albumArt: 'https://dn710707.ca.archive.org/cover.jpg' });
    expect(sent[sent.length - 1].metadata.artwork).toBe('https://dn710707.ca.archive.org/cover.jpg');
    mirror.updateTrack({ id: 't1', title: 'T', artist: 'A', album: 'AL', duration: 100, albumArt: 'local-art://embedded/abc' });
    expect(sent[sent.length - 1].metadata.artwork).toBeNull();
  });

  test('a same-track churn does NOT reset the position (the macOS progress-loop regression)', () => {
    // During Amazon playback the poller's ~2s progress emits re-create the
    // currentTrack object (duration repair, stream-quality attach), and each
    // identity churn re-fires the mpris:update-track AND update-playback-state
    // pushes. updateTrack used to push position 0 on every call, so the OS
    // card looped 0:00 → 0:02 → reset at the poller's cadence (observed on
    // macOS, 2026-10). Same-track pushes must carry metadata only, and
    // update-playback-state must not carry a position patch at all.
    const { mirror, sent } = setup();
    mirror.updateTrack({ id: 't1', title: 'T', artist: 'A', album: 'AL', duration: 254 });
    mirror.updatePlaybackState('playing');
    mirror.updatePosition(120);
    const pushesBeforeChurn = sent.length;
    mirror.updateTrack({ id: 't1', title: 'T', artist: 'A', album: 'AL', duration: 254, albumArt: 'https://e.com/late-art.jpg' });
    mirror.updatePlaybackState('playing'); // same state — deduped to nothing
    mirror.updateTrack({ id: 't1', title: 'T', artist: 'A', album: 'AL', duration: 254 });
    expect(sent.length).toBe(pushesBeforeChurn + 2);
    expect(sent[pushesBeforeChurn]).toEqual({
      metadata: { title: 'T', artist: 'A', album: 'AL', artwork: 'https://e.com/late-art.jpg' }
    });
    expect(sent[pushesBeforeChurn + 1].position).toBeUndefined();
    // A REAL track change re-anchors at 0
    mirror.updateTrack({ id: 't2', title: 'U', artist: 'B', album: 'AL', duration: 300 });
    expect(sent[sent.length - 1]).toEqual({
      metadata: { title: 'U', artist: 'B', album: 'AL', artwork: null },
      position: { duration: 300, position: 0, rate: 1 }
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

  test('isOwned and enabled gates apply to every push (Amazon must own playback; an enabled() gate stays available)', () => {
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
    linux.value = true; // the enabled() gate models main's Linux skip (platform !== 'linux')
    mirror.updateTrack({ title: 'T3', artist: 'A', album: 'AL', duration: 10 });
    expect(sent.length).toBe(1);
  });
});
