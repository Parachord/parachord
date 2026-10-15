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
const { installAmazonRequireTrap } = require('../../amazon-music-logic');

const src = fs.readFileSync(path.join(__dirname, '../../amazon-player-preload.js'), 'utf8');

function inlinedTrapSource() {
  const m = src.match(/function installAmazonRequireTrap\(scope\) \{[\s\S]*?\n\}/);
  return m ? m[0] : null;
}

function inlinedTrap() {
  const text = inlinedTrapSource();
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

  test('the page stub runs standalone and logs the canary', () => {
    const m = src.match(/const PAGE_STUB = `([\s\S]*?)`;$/m);
    expect(m).toBeTruthy();
    // The stub runs in the page world where window/document exist; give it
    // bare equivalents so a closure reference into the preload's scope (or a
    // typo) fails here instead of inside Amazon's page. The stored template
    // references the trap via ${installAmazonRequireTrap.toString()} — splice
    // the real source in the way the template literal itself does at runtime.
    const stubBody = m[1].replace('${installAmazonRequireTrap.toString()}', installAmazonRequireTrap.toString());
    const logs = [];
    const fakeWindow = { addEventListener: () => {} };
    const fakeDocument = { addEventListener: () => {} };
    const Document = function Document() {};
    const run = new Function(
      'window', 'document', 'Document', 'console',
      `${stubBody}\nreturn [window.__parachordRequireTrap, typeof window.__r, typeof document.hidden === 'boolean'];`
    );
    const result = run(fakeWindow, fakeDocument, Document, { log: logs.push.bind(logs) });
    expect(result).toEqual([true, 'object', true]);
    expect(logs).toEqual(['[Amazon] Parachord preload stub active']);
  });
});
