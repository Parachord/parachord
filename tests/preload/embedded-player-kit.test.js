// Unit tests for embedded-player-kit.js — the page-world mediaSession hijack
// shared by embedded-player preloads. The kit is the single source of truth;
// the per-preload literal copies are behaviorally diffed against it in
// tests/resolver/amazon-player-preload.test.js.

const { installMediaSessionHijack, applyMediaSessionMirror } = require('../../embedded-player-kit');

// A scope shaped like the page world: a navigator whose mediaSession is the
// real (Chromium-bound) object. The facade swap happens on the navigator, so
// the harness keeps a handle on the "real" object the way the kit does.
function makePage() {
  const realHandlers = {};
  const real = {
    setActionHandler(action, handler) { realHandlers[action] = handler; },
    metadata: undefined,
    playbackState: 'none',
    setPositionState() { real.positionPushed = (real.positionPushed || 0) + 1; }
  };
  const navigator = { mediaSession: real };
  return { navigator, real, realHandlers };
}

describe('installMediaSessionHijack', () => {
  test('registers our transport handlers on the real session before shadowing', () => {
    const page = makePage();
    const seen = [];
    installMediaSessionHijack({ navigator: page.navigator }, (a) => seen.push(a));

    for (const action of ['play', 'pause', 'previoustrack', 'nexttrack', 'stop']) {
      expect(typeof page.realHandlers[action]).toBe('function');
    }
    // No seek actions — Parachord's OS surfaces report canSeek=false today;
    // registering a seekto handler would promise a seek we do not route.
    for (const action of ['seekto', 'seekbackward', 'seekforward']) {
      expect(page.realHandlers[action]).toBeUndefined();
    }
    page.realHandlers.play();
    page.realHandlers.nexttrack();
    expect(seen).toEqual(['play', 'nexttrack']);
  });

  test('page-world mediaSession writes become inert and never touch the real session', () => {
    const page = makePage();
    installMediaSessionHijack({ navigator: page.navigator }, () => {});

    const ms = page.navigator.mediaSession;
    expect(ms).not.toBe(page.real);

    // Every shape of page usage is a silent no-op on the facade…
    ms.metadata = { title: 'Metal Health', artist: 'Quiet Riot' };
    ms.playbackState = 'playing';
    ms.setActionHandler('play', () => { throw new Error('page handler must never run'); });
    ms.setPositionState({ duration: 317, position: 10, playbackRate: 1 });

    // …and none of it reached the real object the OS integration reads.
    expect(page.real.metadata).toBeUndefined();
    expect(page.real.playbackState).toBe('none');
    expect(page.real.positionPushed).toBeUndefined();
    expect(page.realHandlers.play).toBeDefined(); // still OUR handler

    // Read-backs see the page's own last write (plain object properties), so
    // page code that echoes mediaSession state keeps working.
    expect(ms.metadata).toEqual({ title: 'Metal Health', artist: 'Quiet Riot' });
    expect(ms.playbackState).toBe('playing');
  });

  test('facade defaults before any page write', () => {
    const page = makePage();
    installMediaSessionHijack({ navigator: page.navigator }, () => {});
    expect(page.navigator.mediaSession.metadata).toBeNull();
    expect(page.navigator.mediaSession.playbackState).toBe('none');
  });

  test('marker makes install idempotent; a second install cannot re-shadow', () => {
    const page = makePage();
    const scope = { navigator: page.navigator };
    installMediaSessionHijack(scope, () => {});
    const firstFacade = scope.navigator.mediaSession;
    const firstHandler = page.realHandlers.play;
    installMediaSessionHijack(scope, () => {});
    expect(scope.navigator.mediaSession).toBe(firstFacade);
    expect(page.realHandlers.play).toBe(firstHandler);
  });

  test('a null onAction suppresses the session without claiming it (the Linux policy)', () => {
    // On Linux the native MPRIS player owns the OS surface. Chromium
    // publishes its own MPRIS entry for a CONTROLLABLE session (registered
    // actions) or one with metadata, so the kit must suppress the page's
    // session WITHOUT registering handlers there — no metadata, no actions,
    // no entry (same state as the main renderer's audio, #848).
    const page = makePage();
    installMediaSessionHijack({ navigator: page.navigator }, null);
    expect(Object.keys(page.realHandlers)).toEqual([]); // nothing registered
    // The facade still installed — the page's writes still never land
    page.navigator.mediaSession.metadata = { title: 'T' };
    page.navigator.mediaSession.playbackState = 'playing';
    expect(page.real.metadata).toBeUndefined();
    expect(page.real.playbackState).toBe('none');
    expect(page.navigator.mediaSession.metadata).toEqual({ title: 'T' });
    // A non-function non-null onAction is treated the same way
    const page2 = makePage();
    expect(() => installMediaSessionHijack({ navigator: page2.navigator }, 'bogus')).not.toThrow();
    expect(Object.keys(page2.realHandlers)).toEqual([]);
    expect(page2.navigator.mediaSession).not.toBe(page2.real);
  });

  test('a throwing onAction never propagates into Chromium key dispatch', () => {
    const page = makePage();
    installMediaSessionHijack({ navigator: page.navigator }, () => { throw new Error('bridge down'); });
    expect(() => page.realHandlers.pause()).not.toThrow();
  });

  test('missing navigator/mediaSession and hostile navigators are tolerated', () => {
    expect(() => installMediaSessionHijack(null, () => {})).not.toThrow();
    expect(() => installMediaSessionHijack({}, () => {})).not.toThrow();
    expect(() => installMediaSessionHijack({ navigator: {} }, () => {})).not.toThrow();
    expect(() => installMediaSessionHijack({ navigator: {} }, () => {})).not.toThrow();

    // A navigator that cannot be shadowed (frozen) still gets our handlers —
    // the key hijack matters even when the metadata facade cannot install.
    const realHandlers = {};
    const frozenNav = Object.freeze({
      mediaSession: { setActionHandler(a, fn) { realHandlers[a] = fn; } }
    });
    expect(() => installMediaSessionHijack({ navigator: frozenNav }, () => {})).not.toThrow();
    expect(typeof realHandlers.play).toBe('function');

    // A real session that rejects setActionHandler entirely is also tolerated.
    const hostile = {
      setActionHandler() { throw new Error('unsupported action'); }
    };
    expect(() => installMediaSessionHijack({ navigator: { mediaSession: hostile } }, () => {})).not.toThrow();
  });

  test('the function is serialization-safe: .toString() + eval behaves identically', () => {
    // The kit is inlined into page-world stubs via Function.prototype.toString
    // (sandboxed preloads cannot require local modules), so the serialized
    // form must be self-contained — no closure over module scope.
    const restored = new Function(`return (${installMediaSessionHijack.toString()})`)();
    const pageA = makePage();
    const pageB = makePage();
    const seenA = [];
    const seenB = [];
    installMediaSessionHijack({ navigator: pageA.navigator }, (a) => seenA.push(a));
    restored({ navigator: pageB.navigator }, (a) => seenB.push(a));
    pageA.realHandlers.play();
    pageB.realHandlers.play();
    pageA.navigator.mediaSession.metadata = { x: 1 };
    pageB.navigator.mediaSession.metadata = { x: 1 };
    expect(seenA).toEqual(seenB);
    expect(pageA.navigator.mediaSession.metadata).toEqual(pageB.navigator.mediaSession.metadata);
    expect(pageA.real.metadata).toBeUndefined();
    expect(pageB.real.metadata).toBeUndefined();
    // The null-onAction branch survives serialization too
    const pageC = makePage();
    const pageD = makePage();
    installMediaSessionHijack({ navigator: pageC.navigator }, null);
    restored({ navigator: pageD.navigator }, null);
    expect(Object.keys(pageC.realHandlers)).toEqual([]);
    expect(Object.keys(pageD.realHandlers)).toEqual([]);
    expect(pageD.navigator.mediaSession).not.toBe(pageD.real);
  });
});

// The now-playing mirror — main feeds Parachord's track through the preload
// into the page world, and applyMediaSessionMirror writes the REAL session
// behind the facade so the OS card shows the track instead of the page's own
// label ("Amazon Music", the document title).
describe('applyMediaSessionMirror', () => {
  let MediaMetadataCtor;
  const constructed = [];

  beforeAll(() => {
    // The page world's MediaMetadata constructor; captured so the tests can
    // assert what Chromium would receive.
    MediaMetadataCtor = global.MediaMetadata;
    global.MediaMetadata = class MediaMetadata {
      constructor(init) {
        if (init && init.title === 'THROW') throw new TypeError('bad metadata');
        this.init = init;
        constructed.push(init);
      }
    };
  });
  afterAll(() => {
    if (MediaMetadataCtor === undefined) delete global.MediaMetadata;
    else global.MediaMetadata = MediaMetadataCtor;
  });

  // A page whose hijack installed: the real session is stashed on the scope.
  const makeInstalledPage = () => {
    const real = {
      handlers: {},
      metadata: undefined,
      playbackState: 'none',
      positionState: null,
      setActionHandler(a, fn) { this.handlers[a] = fn; },
      setPositionState(s) { this.positionState = s; }
    };
    real.setActionHandler = real.setActionHandler.bind(real);
    const scope = { navigator: { mediaSession: real } };
    if (typeof global.MediaMetadata === 'function') scope.MediaMetadata = global.MediaMetadata;
    installMediaSessionHijack(scope, null);
    return { scope, real };
  };

  test('the hijack stashes the real session for the mirror path', () => {
    const { scope, real } = makeInstalledPage();
    expect(scope.__parachordMediaSessionReal).toBe(real);
  });

  test('metadata writes reach the real session; https artwork passes, others drop', () => {
    const { scope, real } = makeInstalledPage();
    applyMediaSessionMirror(scope, {
      metadata: { title: 'Metal Health', artist: 'Quiet Riot', album: 'Metal Health', artwork: 'https://example.com/a.jpg' }
    });
    expect(real.metadata.init).toEqual({
      title: 'Metal Health', artist: 'Quiet Riot', album: 'Metal Health',
      artwork: [{ src: 'https://example.com/a.jpg', sizes: '512x512' }]
    });
    // The page facade is unaffected by the mirror — writes behind the facade
    expect(scope.navigator.mediaSession.metadata).toBeNull();

    applyMediaSessionMirror(scope, {
      metadata: { title: 'T', artist: 'A', album: 'AL', artwork: 'local-art://embedded/x' }
    });
    expect(real.metadata.init).toEqual({ title: 'T', artist: 'A', album: 'AL' }); // no artwork
  });

  test('null metadata clears; a throwing MediaMetadata degrades to text-only', () => {
    const { scope, real } = makeInstalledPage();
    applyMediaSessionMirror(scope, { metadata: { title: 'T', artist: 'A', album: 'AL' } });
    expect(real.metadata).toBeTruthy();
    applyMediaSessionMirror(scope, { metadata: null });
    expect(real.metadata).toBeNull();

    applyMediaSessionMirror(scope, {
      metadata: { title: 'THROW', artist: 'A', album: 'AL', artwork: 'https://e.com/a.jpg' }
    });
    // First construction throws (artwork + THROW title), fallback retries without artwork, still throws → null
    expect(real.metadata).toBeNull();
  });

  test('playbackState and clamped positionState reach the real session', () => {
    const { scope, real } = makeInstalledPage();
    applyMediaSessionMirror(scope, { playbackState: 'playing' });
    expect(real.playbackState).toBe('playing');
    applyMediaSessionMirror(scope, { playbackState: 'bogus' });
    expect(real.playbackState).toBe('playing'); // invalid values ignored

    applyMediaSessionMirror(scope, { position: { duration: 317, position: 400, rate: 1 } });
    expect(real.positionState).toEqual({ duration: 317, position: 317, playbackRate: 1 });
    applyMediaSessionMirror(scope, { position: { duration: 317, position: 10, rate: 0 } });
    expect(real.positionState).toEqual({ duration: 317, position: 10, playbackRate: 0 });
    applyMediaSessionMirror(scope, { position: { duration: 0, position: 10, rate: 1 } });
    expect(real.positionState.position).toBe(10); // no duration → skipped entirely
  });

  test('no stash / no data / hostile sessions are tolerated', () => {
    expect(() => applyMediaSessionMirror(null, { metadata: null })).not.toThrow();
    expect(() => applyMediaSessionMirror({}, { metadata: null })).not.toThrow(); // hijack never ran
    const { scope, real } = makeInstalledPage();
    expect(() => applyMediaSessionMirror(scope, null)).not.toThrow();
    expect(() => applyMediaSessionMirror(scope, 'junk')).not.toThrow();

    // A real session whose setters throw is tolerated
    const hostile = {
      set metadata(v) { throw new Error('no'); },
      set playbackState(v) { throw new Error('no'); },
      setActionHandler() { throw new Error('no'); },
      setPositionState() { throw new Error('no'); }
    };
    const hostileScope = { navigator: { mediaSession: hostile } };
    installMediaSessionHijack(hostileScope, null);
    expect(() => applyMediaSessionMirror(hostileScope, {
      metadata: { title: 'T', artist: 'A', album: 'AL' },
      playbackState: 'playing',
      position: { duration: 10, position: 1, rate: 1 }
    })).not.toThrow();
    // the earlier page is untouched
    expect(real.metadata).toBeUndefined();
  });

  test('the mirror is serialization-safe: .toString() + eval behaves identically', () => {
    const restored = new Function(`return (${applyMediaSessionMirror.toString()})`)();
    const a = makeInstalledPage();
    const b = makeInstalledPage();
    const payload = {
      metadata: { title: 'T', artist: 'A', album: 'AL', artwork: 'https://e.com/a.jpg' },
      playbackState: 'playing',
      position: { duration: 100, position: 50, rate: 1 }
    };
    applyMediaSessionMirror(a.scope, payload);
    restored(b.scope, payload);
    expect(b.real.metadata.init).toEqual(a.real.metadata.init);
    expect(b.real.playbackState).toBe(a.real.playbackState);
    expect(b.real.positionState).toEqual(a.real.positionState);
  });
});
