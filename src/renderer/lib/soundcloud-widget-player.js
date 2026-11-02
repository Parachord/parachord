// soundcloud-widget-player.js — SoundCloud playback through SoundCloud's own
// embeddable widget (w.soundcloud.com/player), in a hidden iframe in the
// main window.
//
// Why the widget and not the API: on the public API a signed-in user gets
// 30-second previews at best. Full streams come only as AAC HLS, and every
// stream download answered 403 "An active Artist Pro subscription is
// required" (live-verified 2026-11-02, on a fully `playable` track too). The
// widget is SoundCloud's own player, needs no sign-in, and plays the whole
// track for anything SoundCloud lets it embed. A track it won't play loads
// its title and art, shows "Play another track", and never starts — so
// "started" means the position actually advanced, and a track that hasn't
// within START_TIMEOUT_MS is reported `unplayable` for the engine to route
// around.
//
// The widget is driven with its postMessage protocol directly, NOT by
// loading SoundCloud's api.js: a third-party script in the main renderer
// would run beside window.electron. Messages are JSON `{method, value}`:
//   to the widget    {method:'addEventListener', value:<event>}, play, pause,
//                    seekTo(ms), setVolume(0-100), getDuration
//   from the widget  ready, playProgress {currentPosition ms}, play, pause,
//                    finish, error, and getter replies under the getter's name
// Only messages from WIDGET_ORIGIN whose source is our iframe's window count.
//
// Each load gets a generation; anything from an earlier load (or before the
// new document says `ready`) is ignored. stop() blanks the iframe: leaving a
// SoundCloud track halts it rather than leaving a paused widget around.
//
// `element` is an HTMLMediaElement-shaped facade (paused, currentTime,
// duration, volume, play(), pause()) so the transport, seek and volume code
// that drives the shared audio element can drive the widget the same way.

'use strict';

const WIDGET_ORIGIN = 'https://w.soundcloud.com';
const WIDGET_PLAYER_URL = `${WIDGET_ORIGIN}/player/`;
const WIDGET_EVENTS = ['playProgress', 'play', 'pause', 'finish', 'error'];
const START_TIMEOUT_MS = 10000;

function widgetSrc(permalinkUrl) {
  const params = new URLSearchParams({
    url: permalinkUrl,
    auto_play: 'true',
    visual: 'false',
    hide_related: 'true',
    show_comments: 'false',
    show_teaser: 'false'
  });
  return `${WIDGET_PLAYER_URL}?${params.toString()}`;
}

function errorWithReason(message, reason) {
  const err = new Error(message);
  err.reason = reason;
  return err;
}

function createSoundCloudWidgetPlayer({ win = globalThis.window, startTimeoutMs = START_TIMEOUT_MS, log = console } = {}) {
  let iframe = null;
  let generation = 0;
  let ready = false;
  let active = false;
  let started = false;
  let paused = true;
  let positionMs = 0;
  let durationMs = 0;
  let volume = 1;
  let handlers = {};
  let pendingStart = null; // { resolve, reject, timer }

  const post = (method, value) => {
    const target = iframe && iframe.contentWindow;
    if (!target || typeof target.postMessage !== 'function') return;
    target.postMessage(JSON.stringify(value === undefined ? { method } : { method, value }), WIDGET_ORIGIN);
  };

  const settleStart = (err) => {
    if (!pendingStart) return;
    const { resolve, reject, timer } = pendingStart;
    pendingStart = null;
    clearTimeout(timer);
    if (err) reject(err);
    else resolve({ durationSeconds: durationMs ? durationMs / 1000 : null });
  };

  const call = (name, ...args) => {
    const fn = handlers[name];
    if (typeof fn !== 'function') return;
    try { fn(...args); } catch (e) { log.error('[SoundCloud widget] handler failed:', name, e); }
  };

  const onMessage = (event) => {
    if (!iframe || event.origin !== WIDGET_ORIGIN || event.source !== iframe.contentWindow) return;
    let msg;
    try { msg = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
    if (!msg || typeof msg.method !== 'string' || !active) return;
    const { method, value } = msg;

    if (method === 'ready') {
      if (ready) return;
      ready = true;
      WIDGET_EVENTS.forEach((name) => post('addEventListener', name));
      post('setVolume', Math.round(volume * 100));
      post('getDuration');
      post('play');
      return;
    }
    if (!ready) return; // a late message from the previous document

    switch (method) {
      case 'getDuration':
        if (typeof value === 'number' && value > 0) {
          durationMs = value;
          call('onDuration', value / 1000);
        }
        break;
      case 'playProgress': {
        const at = value && typeof value.currentPosition === 'number' ? value.currentPosition : null;
        if (at === null) break;
        positionMs = at;
        if (!started && at > 0) {
          started = true;
          paused = false;
          settleStart(null);
        }
        if (started) call('onProgress', at / 1000);
        break;
      }
      case 'play':
        paused = false;
        if (started) call('onPlay');
        break;
      case 'pause':
        // The widget reports a pause while it is still starting up; only a
        // pause of a track that has played means anything to the transport.
        paused = true;
        if (started) call('onPause');
        break;
      case 'finish':
        paused = true;
        if (started) call('onFinish');
        break;
      case 'error':
        if (!started) settleStart(errorWithReason('SoundCloud widget reported an error', 'unplayable'));
        else call('onError');
        break;
      default:
        break;
    }
  };

  const ensureIframe = () => {
    if (iframe) return iframe;
    const doc = win.document;
    iframe = doc.createElement('iframe');
    iframe.setAttribute('allow', 'autoplay');
    iframe.setAttribute('title', 'SoundCloud player');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.setAttribute('tabindex', '-1');
    iframe.style.cssText = 'position:fixed;width:1px;height:1px;left:0;bottom:0;opacity:0;pointer-events:none;border:0;';
    doc.body.appendChild(iframe);
    win.addEventListener('message', onMessage);
    return iframe;
  };

  const reset = () => {
    ready = false;
    started = false;
    paused = true;
    positionMs = 0;
    durationMs = 0;
  };

  // Load a track by its soundcloud.com permalink and start it. Resolves once
  // the position has advanced; rejects with reason 'unplayable' when it
  // hasn't within startTimeoutMs, 'superseded' when another load or stop()
  // came first.
  const load = (permalinkUrl, nextHandlers = {}) => {
    settleStart(errorWithReason('SoundCloud widget load superseded', 'superseded'));
    generation += 1;
    const myGeneration = generation;
    reset();
    active = true;
    handlers = nextHandlers || {};
    ensureIframe().src = widgetSrc(permalinkUrl);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (generation !== myGeneration) return;
        settleStart(errorWithReason('SoundCloud widget did not start this track', 'unplayable'));
      }, startTimeoutMs);
      pendingStart = { resolve, reject, timer };
    });
  };

  const stop = () => {
    settleStart(errorWithReason('SoundCloud widget stopped', 'superseded'));
    generation += 1;
    handlers = {};
    const wasActive = active;
    active = false;
    reset();
    if (iframe && wasActive) iframe.src = 'about:blank';
  };

  const element = {
    get src() { return ''; },
    get paused() { return paused; },
    get currentTime() { return positionMs / 1000; },
    set currentTime(seconds) {
      if (!ready || !Number.isFinite(seconds)) return;
      positionMs = Math.max(0, Math.round(seconds * 1000));
      post('seekTo', positionMs);
    },
    get duration() { return durationMs ? durationMs / 1000 : NaN; },
    get volume() { return volume; },
    set volume(value) {
      if (!Number.isFinite(value)) return;
      volume = Math.min(1, Math.max(0, value));
      if (ready) post('setVolume', Math.round(volume * 100));
    },
    play() {
      if (ready) { post('play'); paused = false; }
      return Promise.resolve();
    },
    pause() {
      if (ready) post('pause');
      paused = true;
    }
  };

  const getState = () => ({ active, ready, started, paused, positionMs, durationMs, volume, generation });

  return { load, stop, element, isActive: () => active, getState };
}

module.exports = { createSoundCloudWidgetPlayer, widgetSrc, WIDGET_ORIGIN, START_TIMEOUT_MS };
