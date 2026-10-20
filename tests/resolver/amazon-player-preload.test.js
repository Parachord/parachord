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
const { installAmazonRequireTrap, installAmazonStreamCapture } = require('../../amazon-music-logic');
const { installMediaSessionHijack } = require('../../embedded-player-kit');

const src = fs.readFileSync(path.join(__dirname, '../../amazon-player-preload.js'), 'utf8');

function inlinedTrapSource() {
  const m = src.match(/function installAmazonRequireTrap\(scope\) \{[\s\S]*?\n\}/);
  return m ? m[0] : null;
}

function inlinedCaptureSource() {
  const m = src.match(/function installAmazonStreamCapture\(scope\) \{[\s\S]*?\n\}/);
  return m ? m[0] : null;
}

function inlinedCapture() {
  const text = inlinedCaptureSource();
  return text ? new Function(`return (${text})`)() : null;
}

function inlinedGqlCapture() {
  const text = inlinedGqlCaptureSource();
  return text ? new Function(`return (${text})`)() : null;
}

function inlinedTrap() {
  const text = inlinedTrapSource();
  return text ? new Function(`return (${text})`)() : null;
}

function inlinedHijackSource() {
  const m = src.match(/function installMediaSessionHijack\(scope, onAction\) \{[\s\S]*?\n\}/);
  return m ? m[0] : null;
}

function inlinedHijack() {
  const text = inlinedHijackSource();
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

function runTrapScenarios(trap) {
  const out = [];

  // 1. captures the playbackController when Amazon requires its module
  {
    const scope = makeMetroScope();
    trap(scope);
    scope.__r = scope.require;
    scope.__r(456);
    out.push(['capture-pre-miss', scope.__parachordAmazonPlayback]);
    scope.__r(123);
    out.push(['capture', scope.__parachordAmazonPlayback.audioQualitySettings.streamingQuality,
      scope.__parachordAmazonPlaybackModuleId]);
  }

  // 2. wraps a require that was already assigned before the trap
  {
    const scope = makeMetroScope();
    scope.__r = scope.require;
    trap(scope);
    scope.__r(123);
    out.push(['pre-assigned', scope.__parachordAmazonPlaybackModuleId]);
  }

  // 3. passes through calls and require's own properties
  {
    const scope = makeMetroScope();
    trap(scope);
    const asyncChunk = () => {};
    scope.require.async = asyncChunk;
    scope.__r = scope.require;
    out.push(['passthrough', scope.__r !== scope.require, scope.__r.async === asyncChunk,
      JSON.stringify(scope.__r(456))]);
  }

  // 4. re-assignment re-wraps; install is idempotent
  {
    const scope = makeMetroScope();
    trap(scope);
    scope.__r = scope.require;
    const first = scope.__r;
    scope.__r = scope.require;
    scope.__r(123);
    out.push(['re-wrap', scope.__r !== first, scope.__parachordAmazonPlaybackModuleId]);
    trap(scope);
    out.push(['idempotent', scope.__r === scope.__r]);
  }

  // 5. a throwing module export does not break the require
  {
    const scope = {};
    const hostile = { get playbackController() { throw new Error('getter'); } };
    scope.require = (id) => (id === 7 ? hostile : { ok: 1 });
    trap(scope);
    scope.__r = scope.require;
    let threw = false;
    try { scope.__r(7); } catch (e) { threw = true; }
    out.push(['hostile', threw, JSON.stringify(scope.__r(8)), scope.__parachordAmazonPlayback]);
  }

  return out;
}

// Scenario battery for installMediaSessionHijack, same pattern as the trap
// battery above: each scenario returns observable state so the kit module's
// copy (embedded-player-kit.js) and the inlined preload copy can be diffed.
// The same shape runs standalone in tests/preload/embedded-player-kit.test.js.
function runHijackScenarios(hijack) {
  const out = [];

  // 1. our transport handlers are registered on the real session; seek
  //    actions are deliberately absent
  {
    const real = { handlers: {} };
    real.setActionHandler = (a, fn) => { real.handlers[a] = fn; };
    const scope = { navigator: { mediaSession: real } };
    const seen = [];
    hijack(scope, (a) => seen.push(a));
    real.handlers.play();
    real.handlers.nexttrack();
    out.push(['handlers', Object.keys(real.handlers).sort().join(','), JSON.stringify(seen)]);
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

  test('the inlined trap is behaviorally identical to amazon-music-logic.js', () => {
    const inlined = inlinedTrap();
    expect(inlined).toBeInstanceOf(Function);
    expect(runTrapScenarios(inlined)).toEqual(runTrapScenarios(installAmazonRequireTrap));
  });

  test('the inlined trap still captures the store on its own', () => {
    const scope = {};
    const store = { playbackController: { audioQualitySettings: { streamingQuality: 'HD' } } };
    const require = (id) => (id === 123 ? store : { other: true });
    inlinedTrap()(scope);
    scope.__r = require;
    expect(scope.__r(123)).toBe(store);
    expect(scope.__r(456)).toEqual({ other: true });
    expect(scope.__parachordAmazonPlayback).toBe(store.playbackController);
    expect(scope.__parachordAmazonPlaybackModuleId).toBe(123);
  });

  test('the inlined stream capture is behaviorally identical to amazon-music-logic.js', async () => {
    // Same rationale as the trap: Function.prototype.toString normalizes under
    // the test transform, so parity is enforced behaviorally — the module's
    // function and the inlined copy run the same scenario battery and must
    // leave identical observable state.
    const inlined = inlinedCapture();
    expect(inlined).toBeInstanceOf(Function);
    expect(await runCaptureScenarios(inlined)).toEqual(await runCaptureScenarios(installAmazonStreamCapture));
  });



  test('the inlined stream capture still records on its own', async () => {
    const scope = {};
    scope.fetch = async () => ({ clone: () => ({ text: () => Promise.resolve('<MPD/>') }), headers: { get: () => null } });
    inlinedCapture()(scope);
    await scope.fetch('https://cdn.example.com/manifest.mpd');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scope.__parachordStreamCaps.manifests).toEqual([
      { url: 'https://cdn.example.com/manifest.mpd', text: '<MPD/>' }
    ]);
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

  test('the page stub runs standalone and logs the canary', () => {
    const m = src.match(/const PAGE_STUB = `([\s\S]*?)`;$/m);
    expect(m).toBeTruthy();
    // The stub runs in the page world where window/document exist; give it
    // bare equivalents so a closure reference into the preload's scope (or a
    // typo) fails here instead of inside Amazon's page. The stored template
    // references the trap, capture and hijack via ${...toString()} — splice the
    // real sources in the way the template literal itself does at runtime.
    const stubBody = m[1]
      .replace('${installAmazonRequireTrap.toString()}', installAmazonRequireTrap.toString())
      .replace('${installAmazonStreamCapture.toString()}', installAmazonStreamCapture.toString())
      .replace('${installMediaSessionHijack.toString()}', installMediaSessionHijack.toString());
    const logs = [];
    const posted = [];
    const realHandlers = {};
    const realSession = {
      setActionHandler(action, fn) { realHandlers[action] = fn; }
    };
    const fakeWindow = {
      addEventListener: () => {},
      postMessage: (payload) => posted.push(payload),
      navigator: { mediaSession: realSession }
    };
    const fakeDocument = { addEventListener: () => {} };
    const Document = function Document() {};
    const run = new Function(
      'window', 'document', 'Document', 'console', 'realSession',
      `${stubBody}\nreturn [window.__parachordRequireTrap, typeof window.__r, typeof document.hidden === 'boolean', window.__parachordStreamCapture === true, !!window.__parachordStreamCaps, window.__parachordMediaSessionHijack === true, window.navigator.mediaSession !== realSession, typeof window.navigator.mediaSession.setActionHandler === 'function'];`
    );
    const result = run(fakeWindow, fakeDocument, Document, { log: logs.push.bind(logs) }, realSession);
    expect(result).toEqual([true, 'object', true, true, true, true, true, true]);
    expect(logs).toEqual(['[Amazon] Parachord preload stub active']);
    // Our handler on the real session bridges through postMessage — the
    // preload world listens for exactly this shape and forwards it to the
    // embedded-player-media-key IPC.
    realHandlers.pause();
    expect(posted).toEqual([
      { __parachordEmbeddedPlayer: { resolverId: 'amazonmusic', type: 'action', action: 'pause' } }
    ]);
  });
});
