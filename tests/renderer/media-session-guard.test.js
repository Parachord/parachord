/**
 * Mac media keys resumed audio but left the playbar's button on Play.
 *
 * Apple's MusicKit JS runs in the main renderer (configured at startup for
 * catalog search, and the Apple Music engine when the native helper can't
 * play). Its MediaSessionManager clears every navigator.mediaSession action
 * handler and installs its own on configure and on every capability change.
 * After that a media key, Control Center or the Windows overlay went to
 * MusicKit's player instead of handlePlayPause: a MusicKit JS track resumed
 * under a paused button (its time updates moved the progress bar), and any
 * other track's key did nothing. Parachord now claims its transport actions.
 */

const fs = require('fs');
const path = require('path');
const { claimMediaSessionActions, CLAIMED_ACTIONS } = require('../../src/renderer/lib/media-session-guard');

// The platform object: setActionHandler lives on the prototype, as in Chromium.
class FakeMediaSession {
  constructor() { this.handlers = {}; }
  setActionHandler(action, handler) {
    // Chromium's IDL converts undefined to null (removes the handler).
    if (handler == null) delete this.handlers[action];
    else this.handlers[action] = handler;
  }
  press(action) {
    const handler = this.handlers[action];
    if (handler) handler({ action });
    return !!handler;
  }
}

// MusicKit JS v3's MediaSessionManager, as shipped in
// js-cdn.music.apple.com/musickit/v3/musickit.js (de-minified): it resets every
// handler, then installs play/pause on its own controller, and does it again
// whenever its capabilities change.
function musicKitTakesTheSession(session, controller, capabilities = {}) {
  const reset = () => {
    for (const action of ['play', 'pause', 'seekforward', 'seekbackward', 'nexttrack', 'previoustrack']) {
      session.setActionHandler(action, undefined);
    }
  };
  const install = () => {
    reset();
    session.setActionHandler('play', () => controller.play());
    if (capabilities.canPause) session.setActionHandler('pause', () => controller.pause());
    else session.setActionHandler('pause', () => controller.stop());
    if (capabilities.canSeek) {
      session.setActionHandler('seekforward', () => controller.seekForward());
      session.setActionHandler('seekbackward', () => controller.seekBackward());
    }
    if (capabilities.canSkipToNextItem) session.setActionHandler('nexttrack', () => controller.skipToNextItem());
    if (capabilities.canSkipToPreviousItem) session.setActionHandler('previoustrack', () => controller.skipToPreviousItem());
  };
  install();
  return { capabilitiesChanged: install };
}

const fakeController = () => ({
  calls: [],
  play() { this.calls.push('play'); },
  pause() { this.calls.push('pause'); },
  stop() { this.calls.push('stop'); },
  seekForward() { this.calls.push('seekforward'); },
  seekBackward() { this.calls.push('seekbackward'); },
  skipToNextItem() { this.calls.push('next'); },
  skipToPreviousItem() { this.calls.push('previous'); },
});

const parachordHandlers = (log) => ({
  play: () => log.push('play'),
  pause: () => log.push('pause'),
  nexttrack: () => log.push('next'),
  previoustrack: () => log.push('previous'),
});

describe('claimMediaSessionActions', () => {
  test('without the claim, MusicKit JS takes the keys (the bug)', () => {
    const session = new FakeMediaSession();
    const log = [];
    for (const [action, fn] of Object.entries(parachordHandlers(log))) session.setActionHandler(action, fn);
    const controller = fakeController();
    musicKitTakesTheSession(session, controller);
    session.press('play');
    expect(log).toEqual([]);
    expect(controller.calls).toEqual(['play']);
    // Next and previous are gone altogether.
    expect(session.press('nexttrack')).toBe(false);
  });

  test("MusicKit JS configured after the claim can't replace or clear Parachord's handlers", () => {
    const session = new FakeMediaSession();
    const log = [];
    claimMediaSessionActions(session, parachordHandlers(log));
    const controller = fakeController();
    const musicKit = musicKitTakesTheSession(session, controller, { canSkipToNextItem: true, canSkipToPreviousItem: true });
    musicKit.capabilitiesChanged();
    for (const action of ['play', 'pause', 'nexttrack', 'previoustrack']) session.press(action);
    expect(log).toEqual(['play', 'pause', 'next', 'previous']);
    expect(controller.calls).toEqual([]);
  });

  test('a claim made after MusicKit JS took the session puts Parachord back', () => {
    const session = new FakeMediaSession();
    const controller = fakeController();
    musicKitTakesTheSession(session, controller);
    const log = [];
    claimMediaSessionActions(session, parachordHandlers(log));
    session.press('play');
    session.press('pause');
    expect(log).toEqual(['play', 'pause']);
    expect(controller.calls).toEqual([]);
  });

  test('actions Parachord does not handle still reach whoever sets them', () => {
    const session = new FakeMediaSession();
    claimMediaSessionActions(session, parachordHandlers([]));
    const controller = fakeController();
    musicKitTakesTheSession(session, controller, { canSeek: true });
    session.press('seekforward');
    expect(controller.calls).toEqual(['seekforward']);
  });

  test('reports each refused replacement, for the log', () => {
    const session = new FakeMediaSession();
    const refused = [];
    claimMediaSessionActions(session, parachordHandlers([]), { onRefused: (action) => refused.push(action) });
    musicKitTakesTheSession(session, fakeController());
    expect(new Set(refused)).toEqual(new Set(['play', 'pause', 'nexttrack', 'previoustrack']));
  });

  test('release puts the original method back and clears the claimed handlers', () => {
    const session = new FakeMediaSession();
    const release = claimMediaSessionActions(session, parachordHandlers([]));
    expect(Object.prototype.hasOwnProperty.call(session, 'setActionHandler')).toBe(true);
    release();
    expect(Object.prototype.hasOwnProperty.call(session, 'setActionHandler')).toBe(false);
    expect(session.handlers).toEqual({});
    const controller = fakeController();
    musicKitTakesTheSession(session, controller);
    session.press('play');
    expect(controller.calls).toEqual(['play']);
  });

  test('a second claim (a remount) still guards the original method', () => {
    const session = new FakeMediaSession();
    claimMediaSessionActions(session, parachordHandlers([]));
    const log = [];
    claimMediaSessionActions(session, parachordHandlers(log));
    musicKitTakesTheSession(session, fakeController());
    session.press('play');
    expect(log).toEqual(['play']);
  });

  test('no session, or none with setActionHandler, is a no-op', () => {
    expect(() => claimMediaSessionActions(null, {})()).not.toThrow();
    expect(() => claimMediaSessionActions({}, {})()).not.toThrow();
  });

  test('claims the four transport actions', () => {
    expect(CLAIMED_ACTIONS).toEqual(['play', 'pause', 'nexttrack', 'previoustrack']);
  });
});

describe('the OS media-session handlers are claimed in app.js', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');

  test('the transport effect installs its handlers through claimMediaSessionActions', () => {
    const start = app.indexOf('// Transport controls from the widget / Control Center / hardware keys routed');
    expect(start).toBeGreaterThan(-1);
    const effect = app.slice(start, app.indexOf('// Track metadata on track change.', start));
    expect(effect).toContain('return claimMediaSessionActions(ms, handlers, {');
    // No direct setActionHandler left for MusicKit JS to overwrite.
    expect(effect).not.toMatch(/ms\.setActionHandler\(/);
    for (const action of ['play:', 'pause:', 'nexttrack:', 'previoustrack:']) expect(effect).toContain(action);
  });
});
