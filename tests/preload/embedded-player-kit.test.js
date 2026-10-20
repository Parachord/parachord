// Unit tests for embedded-player-kit.js — the page-world mediaSession hijack
// shared by embedded-player preloads. The kit is the single source of truth;
// the per-preload literal copies are behaviorally diffed against it in
// tests/resolver/amazon-player-preload.test.js.

const { installMediaSessionHijack } = require('../../embedded-player-kit');

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
  });
});
