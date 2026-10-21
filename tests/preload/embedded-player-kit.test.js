// Unit tests for embedded-player-kit.js — the page-world mediaSession hijack
// shared by embedded-player preloads. The kit is the single source of truth;
// the per-preload literal copies are behaviorally diffed against it in
// tests/resolver/amazon-player-preload.test.js.

const { installMediaSessionHijack, applyMediaSessionMirror } = require('../../embedded-player-kit');

// A scope shaped like the page world: a navigator whose mediaSession is the
// real (Chromium-bound) object. installMediaSessionHijack RETURNS the real
// session (held in a closure by callers — it is deliberately not stashed on
// the scope, which the page could reach).
function makePage() {
  const realHandlers = {};
  const real = {
    setActionHandler(action, handler) { realHandlers[action] = handler; },
    metadata: undefined,
    playbackState: 'none',
    setPositionState(s) { this.positionState = s; }
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

  test('returns the real session for the caller to hold in a closure', () => {
    const page = makePage();
    const scope = { navigator: page.navigator };
    expect(installMediaSessionHijack(scope, () => {})).toBe(page.real);
    // No real-session stash on the scope — a plain window property is
    // page-writable, and the page must not be able to reach the real session
    // and re-register its own handlers over the hijack.
    expect(scope.__parachordMediaSessionReal).toBeUndefined();
  });

  test('the marker is non-writable and non-configurable (diagnostics only, page cannot scrub it)', () => {
    const page = makePage();
    const scope = { navigator: page.navigator };
    installMediaSessionHijack(scope, () => {});
    const desc = Object.getOwnPropertyDescriptor(scope, '__parachordMediaSessionHijack');
    expect(desc.value).toBe(true);
    expect(desc.writable).toBe(false);
    expect(desc.configurable).toBe(false);
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

  test('a null onAction suppresses the session without claiming its key path (optional API)', () => {
    // Suppression without handler registration — a caller that owns the OS key
    // path some other way. The Amazon preload always registers its handlers;
    // nothing about this branch is Linux-specific anymore (the Linux kill is
    // main.js's disable-features switch).
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
    expect(installMediaSessionHijack({ navigator: {} }, () => {})).toBeNull();

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
    const realA = installMediaSessionHijack({ navigator: pageA.navigator }, (a) => seenA.push(a));
    const realB = restored({ navigator: pageB.navigator }, (a) => seenB.push(a));
    pageA.realHandlers.play();
    pageB.realHandlers.play();
    pageA.navigator.mediaSession.metadata = { x: 1 };
    pageB.navigator.mediaSession.metadata = { x: 1 };
    expect(seenA).toEqual(seenB);
    expect(realA).toBe(pageA.real);
    expect(realB).toBe(pageB.real);
    expect(pageA.navigator.mediaSession.metadata).toEqual(pageB.navigator.mediaSession.metadata);
    expect(pageA.real.metadata).toBeUndefined();
    expect(pageB.real.metadata).toBeUndefined();
  });
});

// The now-playing mirror — main feeds Parachord's track through the preload
// into the page world, and applyMediaSessionMirror writes the REAL session
// (the object installMediaSessionHijack returned, held in the caller's
// closure) so the OS card shows the track instead of the page's own label.
describe('applyMediaSessionMirror', () => {
  let MediaMetadataCtor;

  beforeAll(() => {
    // The page world's MediaMetadata constructor; captured so the tests can
    // assert what Chromium would receive.
    MediaMetadataCtor = global.MediaMetadata;
    global.MediaMetadata = class MediaMetadata {
      constructor(init) {
        if (init && init.title === 'THROW') throw new TypeError('bad metadata');
        this.init = init;
      }
    };
  });
  afterAll(() => {
    if (MediaMetadataCtor === undefined) delete global.MediaMetadata;
    else global.MediaMetadata = MediaMetadataCtor;
  });

  test('metadata writes reach the real session; https artwork passes, others drop', () => {
    const page = makePage();
    const real = installMediaSessionHijack({ navigator: page.navigator }, null);
    applyMediaSessionMirror(real, {
      metadata: { title: 'Metal Health', artist: 'Quiet Riot', album: 'Metal Health', artwork: 'https://example.com/a.jpg' }
    }, global.MediaMetadata)
    expect(page.real.metadata.init).toEqual({
      title: 'Metal Health', artist: 'Quiet Riot', album: 'Metal Health',
      artwork: [{ src: 'https://example.com/a.jpg', sizes: '512x512' }]
    });
    // The page facade is unaffected by the mirror — writes behind the facade
    expect(page.navigator.mediaSession.metadata).toBeNull();

    applyMediaSessionMirror(real, {
      metadata: { title: 'T', artist: 'A', album: 'AL', artwork: 'local-art://embedded/x' }
    }, global.MediaMetadata)
    expect(page.real.metadata.init).toEqual({ title: 'T', artist: 'A', album: 'AL' }); // no artwork
  });

  test('null metadata clears; a throwing MediaMetadata degrades to text-only', () => {
    const page = makePage();
    const real = installMediaSessionHijack({ navigator: page.navigator }, null);
    applyMediaSessionMirror(real, { metadata: { title: 'T', artist: 'A', album: 'AL' } }, global.MediaMetadata)
    expect(page.real.metadata).toBeTruthy();
    applyMediaSessionMirror(real, { metadata: null }, global.MediaMetadata)
    expect(page.real.metadata).toBeNull();

    applyMediaSessionMirror(real, {
      metadata: { title: 'THROW', artist: 'A', album: 'AL', artwork: 'https://e.com/a.jpg' }
    }, global.MediaMetadata)
    // First construction throws (artwork + THROW title), fallback retries without artwork, still throws → null
    expect(page.real.metadata).toBeNull();
  });

  test('playbackState and clamped positionState reach the real session', () => {
    const page = makePage();
    const real = installMediaSessionHijack({ navigator: page.navigator }, null);
    applyMediaSessionMirror(real, { playbackState: 'playing' }, global.MediaMetadata)
    expect(page.real.playbackState).toBe('playing');
    applyMediaSessionMirror(real, { playbackState: 'bogus' }, global.MediaMetadata)
    expect(page.real.playbackState).toBe('playing'); // invalid values ignored

    applyMediaSessionMirror(real, { position: { duration: 317, position: 400, rate: 1 } }, global.MediaMetadata)
    expect(page.real.positionState).toEqual({ duration: 317, position: 317, playbackRate: 1 });
    applyMediaSessionMirror(real, { position: { duration: 317, position: 10, rate: 0 } }, global.MediaMetadata)
    expect(page.real.positionState).toEqual({ duration: 317, position: 10, playbackRate: 0 });
    applyMediaSessionMirror(real, { position: { duration: 0, position: 10, rate: 1 } }, global.MediaMetadata)
    expect(page.real.positionState.position).toBe(10); // no duration → skipped entirely
  });

  test('missing real/data and hostile sessions are tolerated', () => {
    expect(() => applyMediaSessionMirror(null, { metadata: null })).not.toThrow();
    const page = makePage();
    const real = installMediaSessionHijack({ navigator: page.navigator }, null);
    // Signature is (real, data, MediaMetadataCtor) — a swapped arg order here
    // once voided this whole battery silently (data must be the payload).
    expect(() => applyMediaSessionMirror(real, null, global.MediaMetadata)).not.toThrow();
    expect(() => applyMediaSessionMirror(real, 'junk', global.MediaMetadata)).not.toThrow();

    // A real session whose setters throw is tolerated
    const hostile = {
      set metadata(v) { throw new Error('no'); },
      set playbackState(v) { throw new Error('no'); },
      setActionHandler() { throw new Error('no'); },
      setPositionState() { throw new Error('no'); }
    };
    expect(() => applyMediaSessionMirror(hostile, {
      metadata: { title: 'T', artist: 'A', album: 'AL' },
      playbackState: 'playing',
      position: { duration: 10, position: 1, rate: 1 }
    }, global.MediaMetadata)).not.toThrow();
    // the earlier page is untouched
    expect(page.real.metadata).toBeUndefined();
  });

  test('the mirror is serialization-safe: .toString() + eval behaves identically', () => {
    const restored = new Function(`return (${applyMediaSessionMirror.toString()})`)();
    const a = makePage();
    const b = makePage();
    const realA = installMediaSessionHijack({ navigator: a.navigator }, null);
    const realB = installMediaSessionHijack({ navigator: b.navigator }, null);
    const payload = {
      metadata: { title: 'T', artist: 'A', album: 'AL', artwork: 'https://e.com/a.jpg' },
      playbackState: 'playing',
      position: { duration: 100, position: 50, rate: 1 }
    };
    applyMediaSessionMirror(realA, payload, global.MediaMetadata)
    restored(realB, payload, global.MediaMetadata);
    expect(b.real.metadata.init).toEqual(a.real.metadata.init);
    expect(b.real.playbackState).toBe(a.real.playbackState);
    expect(b.real.positionState).toEqual(a.real.positionState);
  });
});
