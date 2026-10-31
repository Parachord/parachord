// Guards for amazon-player-preload.js. The preload is dead code unless it
// stays loadable under sandbox: true — sandboxed preloads can only require
// electron/events/timers/url, never local files. An earlier revision required
// ./amazon-music-logic at the top of the preload, which threw "module not
// found" and silently killed the whole preload (no __r trap, no visibility
// stub), masked by the localStorage quality fallback. These tests keep that
// failure mode from coming back, and keep the inlined trap copy from drifting
// from amazon-music-logic.js.
//
// The trap copy cannot be compared byte-for-byte (Function.prototype.toString
// normalizes formatting), so parity is enforced behaviorally: the module's
// function and the inlined copy run the same scenario battery and must leave
// identical observable state. A fix applied to amazon-music-logic without the
// preload copy fails here on the module tests' scenarios.

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

// Scenario battery mirrored from the installAmazonRequireTrap describe block in
// amazon-music-logic.test.js. Each scenario returns the observable state it
// ends with, so the two implementations can be diffed.
function makeMetroScope() {
  const modules = {
    123: { playbackController: { audioQualitySettings: { streamingQuality: 'STANDARD' } } },
    456: { other: true }
  };
  return {
    require(id) { return modules[id]; }
  };
}


// Scenario battery for installMediaSessionHijack, same pattern as the trap
// battery above: each scenario returns observable state so the kit module's
// copy (embedded-player-kit.js) and the inlined preload copy can be diffed.
// The same shape runs standalone in tests/preload/embedded-player-kit.test.js.
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

// Scenario battery for installAmazonStreamCapture, same pattern as the trap
// battery above: each scenario returns observable state so the two copies can
// be diffed. Runs against the module's copy in amazon-music-logic.test.js too.
async function runCaptureScenarios(capture) {
  const out = [];
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  // 1. a fetch-loaded manifest is captured via the cloned response text
  {
    const scope = {};
    scope.fetch = async () => ({ clone: () => ({ text: () => Promise.resolve('<MPD/>') }), headers: { get: () => null } });
    capture(scope);
    await scope.fetch('https://cdn.example.com/a.mpd?sig=1');
    await flush();
    out.push(['fetch-manifest', scope.__parachordStreamCapture === true, JSON.stringify(scope.__parachordStreamCaps.manifests)]);
  }

  // 2. fetch passthrough hands back the original response object
  {
    const res = { clone: () => ({ text: () => Promise.resolve('') }), headers: { get: () => null } };
    const scope = {};
    scope.fetch = async () => res;
    capture(scope);
    const got = await scope.fetch('https://cdn.example.com/a.mpd');
    out.push(['fetch-passthrough', got === res]);
  }

  // 3. a small init is captured; a media-sized response is not
  {
    const small = new ArrayBuffer(10);
    const scope = {};
    scope.fetch = async (input) => (String(input).endsWith('init.mp4')
      ? { clone: () => ({ arrayBuffer: () => Promise.resolve(small) }), headers: { get: () => '10' } }
      : { clone: () => ({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(9)) }), headers: { get: () => '900000' } });
    capture(scope);
    await scope.fetch('https://cdn.example.com/init.mp4');
    await scope.fetch('https://cdn.example.com/seg.m4s');
    await flush();
    out.push(['fetch-init', scope.__parachordStreamCaps.inits.length, scope.__parachordStreamCaps.inits[0].bytes === small]);
  }

  // 4. XHR-loaded manifest + arraybuffer init; statics and instanceof survive
  {
    class FakeXHR {
      constructor() { this.responseType = ''; this._l = {}; }
      open(m, u) { this._u = u; }
      send(body) { this._b = body; }
      addEventListener(t, fn) { (this._l[t] = this._l[t] || []).push(fn); }
      fire() { (this._l.load || []).forEach((fn) => fn()); }
    }
    FakeXHR.UNSENT = 7;
    const scope = { XMLHttpRequest: FakeXHR };
    capture(scope);
    const X = scope.XMLHttpRequest;
    const x1 = new X();
    x1.open('GET', 'https://cdn.example.com/b.mpd');
    x1.responseText = '<MPD>xhr</MPD>';
    x1.fire();
    const x2 = new X();
    x2.open('GET', 'https://cdn.example.com/i.m4s');
    x2.responseType = 'arraybuffer';
    const bytes = new ArrayBuffer(12);
    x2.response = bytes;
    x2.fire();
    out.push(['xhr', X.UNSENT, x1 instanceof X, JSON.stringify(scope.__parachordStreamCaps.manifests), scope.__parachordStreamCaps.inits.length, scope.__parachordStreamCaps.inits[0].bytes === bytes]);
  }

  // 5. install is idempotent and a bare/absent scope is tolerated
  {
    const scope = {};
    scope.fetch = async () => ({ clone: () => ({ text: () => Promise.resolve('') }), headers: { get: () => null } });
    capture(scope);
    const first = scope.fetch;
    capture(scope);
    capture({});
    capture(null);
    out.push(['idempotent', scope.fetch === first]);
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
    // Same rationale as the trap: Function.prototype.toString normalizes under
    // the test transform, so parity is enforced behaviorally — the kit's
    // function and the inlined copy run the same scenario battery and must
    // leave identical observable state.
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
    // typo) fails here instead of inside Amazon's page. The trap/capture are
    // spliced from their modules (amazon-music-logic), but the hijack and
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
