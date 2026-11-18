// Guards for amazon-player-preload.js. The preload is dead code unless it
// stays loadable under sandbox: true — sandboxed preloads can only require
// electron/events/timers/url, never local files. An earlier revision required
// ./amazon-music-logic at the top of the preload (the module and this file's
// trap/capture batteries for it are both gone since #1356's teardown), which
// threw "module not found" and silently killed the whole preload (no __r
// trap, no visibility stub), masked by the localStorage quality fallback.
// These tests keep that failure mode from coming back.
//
// The inlined copies (the mediaSession hijack and the now-playing mirror,
// both from embedded-player-kit.js) cannot be compared byte-for-byte
// (Function.prototype.toString normalizes formatting), so parity is enforced
// behaviorally: the kit's function and the inlined copy run the same scenario
// battery and must leave identical observable state.

const fs = require('fs');
const path = require('path');
const { installMediaSessionHijack, applyMediaSessionMirror } = require('../../embedded-player-kit');

const src = fs.readFileSync(path.join(__dirname, '../../amazon-player-preload.js'), 'utf8');





function inlinedHijackSource() {
  // Signature-agnostic param match, same lesson as inlinedMirrorSource: a
  // hardcoded signature failed loudly at worst, but stay consistent.
  const m = src.match(/function installMediaSessionHijack\([^)]*\) \{[\s\S]*?\n\}/);
  return m ? m[0] : null;
}

function inlinedHijack() {
  const text = inlinedHijackSource();
  return text ? new Function(`return (${text})`)() : null;
}

function inlinedMirrorSource() {
  // Signature-agnostic param match: the mirror's signature changed during
  // review (scope,data → real,data,MediaMetadataCtor) and a hardcoded old
  // signature silently spliced `null` into the stub instead of the function.
  const m = src.match(/function applyMediaSessionMirror\([^)]*\) \{[\s\S]*?\n\}/);
  return m ? m[0] : null;
}

function inlinedMirror() {
  const text = inlinedMirrorSource();
  return text ? new Function(`return (${text})`)() : null;
}

// Scenario battery for installMediaSessionHijack: each scenario returns
// observable state so the kit module's copy (embedded-player-kit.js) and the
// inlined preload copy can be diffed. The same shape runs standalone in
// tests/preload/embedded-player-kit.test.js.
function runHijackScenarios(hijack) {
  const out = [];

  // 1. our transport handlers are registered on the real session; seek
  //    actions are deliberately absent; install RETURNS the real session and
  //    stashes NOTHING on the scope (a window property is page-writable)
  {
    const real = { handlers: {} };
    real.setActionHandler = (a, fn) => { real.handlers[a] = fn; };
    const scope = { navigator: { mediaSession: real } };
    const seen = [];
    const returned = hijack(scope, (a) => seen.push(a));
    real.handlers.play();
    real.handlers.nexttrack();
    out.push(['handlers', Object.keys(real.handlers).sort().join(','), JSON.stringify(seen),
      returned === real, scope.__parachordMediaSessionReal === undefined]);
  }

  // 2. page-world writes hit the facade and never reach the real session
  {
    const real = { handlers: {}, metadata: undefined, playbackState: 'none' };
    real.setActionHandler = (a, fn) => { real.handlers[a] = fn; };
    const scope = { navigator: { mediaSession: real } };
    hijack(scope, () => {});
    const ms = scope.navigator.mediaSession;
    ms.metadata = { title: 'T' };
    ms.playbackState = 'playing';
    ms.setActionHandler('play', () => { throw new Error('page handler ran'); });
    ms.setPositionState({ duration: 1 });
    out.push(['facade', JSON.stringify(ms.metadata), ms.playbackState,
      real.metadata === undefined, real.playbackState === 'none',
      typeof real.handlers.play === 'function', scope.__parachordMediaSessionHijack === true]);
  }

  // 3. install is idempotent — a second install cannot re-shadow or re-register
  {
    const real = { handlers: {} };
    real.setActionHandler = (a, fn) => { real.handlers[a] = fn; };
    const scope = { navigator: { mediaSession: real } };
    hijack(scope, () => {});
    const firstFacade = scope.navigator.mediaSession;
    const firstHandler = real.handlers.play;
    hijack(scope, () => {});
    out.push(['idempotent', scope.navigator.mediaSession === firstFacade, real.handlers.play === firstHandler]);
  }

  // 4. missing navigator/mediaSession and hostile sessions are tolerated
  {
    const hostile = { setActionHandler() { throw new Error('unsupported action'); } };
    let threw = false;
    try {
      hijack(null, () => {});
      hijack({}, () => {});
      hijack({ navigator: {} }, () => {});
      hijack({ navigator: { mediaSession: hostile } }, () => {});
    } catch (e) { threw = true; }
    out.push(['tolerant', threw]);
  }

  // 5. a frozen navigator (facade cannot install) still gets our handlers
  {
    const handlers = {};
    const frozenNav = Object.freeze({ mediaSession: { setActionHandler: (a, fn) => { handlers[a] = fn; } } });
    let threw = false;
    try { hijack({ navigator: frozenNav }, () => {}); } catch (e) { threw = true; }
    out.push(['frozen', threw, typeof handlers.play === 'function']);
  }

  // 6. a throwing onAction never propagates into Chromium key dispatch
  {
    const real = { handlers: {} };
    real.setActionHandler = (a, fn) => { real.handlers[a] = fn; };
    hijack({ navigator: { mediaSession: real } }, () => { throw new Error('bridge down'); });
    let threw = false;
    try { real.handlers.pause(); } catch (e) { threw = true; }
    out.push(['throwing-callback', threw]);
  }

  // 7. a null onAction suppresses without claiming the key path (an optional
  //    API shape — not the Amazon preload's choice, and not Linux-specific;
  //    the Linux kill is main.js's disable-features switch)
  {
    const real = { handlers: {}, metadata: undefined, playbackState: 'none' };
    real.setActionHandler = (a, fn) => { real.handlers[a] = fn; };
    const scope = { navigator: { mediaSession: real } };
    hijack(scope, null);
    scope.navigator.mediaSession.metadata = { title: 'T' };
    scope.navigator.mediaSession.playbackState = 'playing';
    out.push(['null-onaction', Object.keys(real.handlers).length, scope.navigator.mediaSession !== real,
      real.metadata === undefined, real.playbackState === 'none',
      JSON.stringify(scope.navigator.mediaSession.metadata), scope.navigator.mediaSession.playbackState]);
  }

  return out;
}

describe('amazon-player-preload', () => {
  test('requires no local modules — sandboxed preloads cannot load them', () => {
    const localRequires = src.match(/require\(\s*['"]\./g) || [];
    expect(localRequires).toEqual([]);
  });

  test('only requires builtins available to sandboxed preloads', () => {
    const requires = [...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]);
    expect(requires.length).toBeGreaterThan(0);
    for (const name of requires) {
      expect(['electron', 'events', 'timers', 'url']).toContain(name);
    }
  });

  test('the inlined mediaSession hijack is behaviorally identical to embedded-player-kit.js', () => {
    // Function.prototype.toString normalizes under the test transform, so
    // parity is enforced behaviorally — the kit's function and the inlined
    // copy run the same scenario battery and must leave identical observable
    // state.
    const inlined = inlinedHijack();
    expect(inlined).toBeInstanceOf(Function);
    expect(runHijackScenarios(inlined)).toEqual(runHijackScenarios(installMediaSessionHijack));
  });

  test('the inlined mediaSession hijack still registers and shadows on its own', () => {
    const real = { handlers: {} };
    real.setActionHandler = (a, fn) => { real.handlers[a] = fn; };
    const scope = { navigator: { mediaSession: real } };
    const seen = [];
    inlinedHijack()(scope, (a) => seen.push(a));
    expect(scope.navigator.mediaSession).not.toBe(real);
    real.handlers.pause();
    expect(seen).toEqual(['pause']);
    scope.navigator.mediaSession.metadata = { title: 'T' };
    expect(real.metadata).toBeUndefined();
  });

  test('the inlined now-playing mirror is behaviorally identical to embedded-player-kit.js', () => {
    // Same rationale as the hijack parity: behavioral batteries against both
    // copies — and the install+mirror PAIR runs together, because the mirror's
    // contract depends on what install returned (the real session). Running
    // the kit's install against the inlined mirror (or vice versa) would miss
    // an inlined drift in the OTHER function. A page-world MediaMetadata stub
    // stands in for Chromium's.
    global.MediaMetadata = global.MediaMetadata || class MediaMetadata {
      constructor(init) { this.init = init; }
    };
    const runMirrorScenarios = (install, mirror) => {
      const out = [];
      const real = {
        handlers: {}, metadata: undefined, playbackState: 'none', positionState: null,
        setActionHandler(a, fn) { this.handlers[a] = fn; },
        setPositionState(s) { this.positionState = s; }
      };
      const scope = { navigator: { mediaSession: real } };
      const returned = install(scope, null);
      out.push(['install-return', returned === real]);
      mirror(returned, { metadata: { title: 'T', artist: 'A', album: 'AL', artwork: 'https://e.com/a.jpg' } }, global.MediaMetadata);
      out.push(['metadata', JSON.stringify(real.metadata.init)]);
      mirror(returned, { playbackState: 'playing' }, global.MediaMetadata);
      mirror(returned, { position: { duration: 317, position: 500, rate: 1 } }, global.MediaMetadata);
      out.push(['state', real.playbackState, JSON.stringify(real.positionState)]);
      mirror(returned, { metadata: null }, global.MediaMetadata);
      mirror(returned, { playbackState: 'bogus' }, global.MediaMetadata);
      out.push(['clear', real.metadata, real.playbackState]);
      let threw = false;
      try {
        mirror(returned, null, global.MediaMetadata);
        mirror({}, { metadata: null }, global.MediaMetadata);
        mirror(null, { metadata: null }, global.MediaMetadata);
      } catch (e) { threw = true; }
      out.push(['tolerant', threw]);
      return out;
    };
    const inlinedInstall = inlinedHijack();
    const inlinedMirrorFn = inlinedMirror();
    expect(inlinedMirrorFn).toBeInstanceOf(Function);
    // module pair vs inlined pair — each pair exercises its own install
    expect(runMirrorScenarios(inlinedInstall, inlinedMirrorFn))
      .toEqual(runMirrorScenarios(installMediaSessionHijack, applyMediaSessionMirror));
  });

  test('the page stub runs standalone and logs the canary', () => {
    const m = src.match(/const PAGE_STUB = `([\s\S]*?)`;$/m);
    expect(m).toBeTruthy();
    // The stub runs in the page world where window/document exist; give it
    // bare equivalents so a closure reference into the preload's scope (or a
    // typo) fails here instead of inside Amazon's page. The hijack and
    // mirror are spliced from the INLINE sources in THIS file — running the
    // page stub against exactly what ships in the preload is the parity
    // net that catches an inlined drift the module batteries could miss.
    const stubBody = m[1]
      .replace('${installMediaSessionHijack.toString()}', inlinedHijackSource())
      .replace('${applyMediaSessionMirror.toString()}', inlinedMirrorSource());
    const logs = [];
    const posted = [];
    const realHandlers = {};
    const stubListeners = [];
    const realSession = {
      setActionHandler(action, fn) { realHandlers[action] = fn; },
      metadata: null,
      playbackState: 'none',
      positionState: null,
      setPositionState(s) { this.positionState = s; }
    };
    const fakeWindow = {
      addEventListener: (type, fn) => { if (type === 'message') stubListeners.push(fn); },
      postMessage: (payload) => posted.push(payload),
      navigator: { mediaSession: realSession },
      MediaMetadata: class MediaMetadata {
        constructor(init) { this.init = init; }
      }
    };
    const fakeDocument = { addEventListener: () => {} };
    const Document = function Document() {};
    const run = new Function(
      'window', 'document', 'Document', 'console', 'realSession',
      `${stubBody}\nreturn [typeof document.hidden === 'boolean', window.__parachordMediaSessionHijack === true, window.navigator.mediaSession !== realSession, typeof window.navigator.mediaSession.setActionHandler === 'function'];`
    );
    const result = run(fakeWindow, fakeDocument, Document, { log: logs.push.bind(logs) }, realSession);
    expect(result).toEqual([true, true, true, true]);
    expect(logs).toEqual(['[Amazon] Parachord preload stub active']);
    // Our handler on the real session bridges through postMessage — the
    // preload world listens for exactly this shape and forwards it to the
    // embedded-player-media-key IPC.
    realHandlers.pause();
    expect(posted).toEqual([
      { __parachordEmbeddedPlayer: { resolverId: 'amazonmusic', type: 'action', action: 'pause' } }
    ]);

    // The mirror relay end-to-end: the preload world forwards main's
    // `embedded-player-mirror` payloads as postMessage events, and the
    // stub's message listener applies them to the real session the stub
    // CAPTURED from install (held in its closure — not on window) and passes
    // to applyMediaSessionMirror along with the page's MediaMetadata
    // constructor. A page-world MediaMetadata stub stands in for Chromium's.
    // Cross-origin iframes are dropped: the listener requires
    // event.source === window.
    expect(stubListeners.length).toBe(1);
    {
      const mirrorEvent = (data, source) => ({ data: { __parachordEmbeddedPlayer: { type: 'mirror', data } }, source });
      stubListeners[0](mirrorEvent({
        metadata: { title: 'Два монаха в одну ночь', artist: 'Король и Шут', album: 'Альбом' },
        playbackState: 'playing',
        position: { duration: 254, position: 10, rate: 1 }
      }, fakeWindow));
      stubListeners[0](mirrorEvent({ playbackState: 'paused' }, fakeWindow));
      expect(realSession.metadata.init.title).toBe('Два монаха в одну ночь');
      expect(realSession.playbackState).toBe('paused');
      expect(realSession.positionState).toEqual({ duration: 254, position: 10, playbackRate: 1 });
      // A cross-origin iframe's message is ignored (source is not the window)
      stubListeners[0](mirrorEvent({ playbackState: 'playing' }, { alien: true }));
      expect(realSession.playbackState).toBe('paused');
    }
  });

});
