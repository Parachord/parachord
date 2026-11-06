// bandcamp-embed-player.js: Bandcamp playback through Bandcamp's own embedded
// player, in a hidden iframe in the main window.
//
// Same contract as soundcloud-widget-player.js, different wiring. Bandcamp's
// embed has no control protocol and the renderer can't reach into a
// cross-origin iframe, so the main process drives the page
// (main-process/ipc/bandcamp-embed.js) and reports states back. This module
// owns the iframe and turns those states into the embedded-player contract in
// docs/architecture/plugins.md.
//
// "Started" means the position actually advanced. A track that hasn't within
// START_TIMEOUT_MS is reported `unplayable`, a failed source for the engine to
// route around. Each load has a token, and a state or answer from an earlier
// one is ignored. stop() blanks the iframe: leaving a track halts it.
//
// Main is told to drive the page only once the iframe has finished loading it.
// Main finds the frame by its URL, and on a replay the old page has that URL
// until the new one commits: driving it then clicks the old page, takes its old
// position as "started", and leaves the new page paused at 0:00 (#1242).

'use strict';

// The measured-bitrate meter (lib/stream-bitrate-meter.js): decoded audio
// bytes sampled against media time. See the stream-quality contract in the
// root stream-quality.js.
const { createStreamBitrateMeter } = require('./stream-bitrate-meter');

const START_TIMEOUT_MS = 15000;

function errorWithReason(message, reason) {
  const err = new Error(message);
  err.reason = reason;
  return err;
}

function createBandcampEmbedPlayer({
  win = globalThis.window,
  startTimeoutMs = START_TIMEOUT_MS,
  log = console
} = {}) {
  let iframe = null;
  let token = 0;
  let active = false;
  let started = false;
  let finished = false;
  let paused = true;
  let position = 0;
  let duration = 0;
  let volume = 1;
  let handlers = {};
  let pendingStart = null; // { resolve, reject, timer }
  let onFrameLoaded = null; // runs once when the page the current load asked for finishes
  let listening = false;
  // Measured stream bitrate: one meter per player (one embedded player per
  // adapter), restarted on every load.
  let streamMeter = createStreamBitrateMeter();
  let emittedBitrate = null;

  const bridge = () => (win && win.electron && win.electron.bandcampEmbed) || null;

  const command = (action, value) => {
    const b = bridge();
    if (!b || !active) return;
    const message = value === undefined ? { token, action } : { token, action, value };
    Promise.resolve(b.command(message)).catch(() => {});
  };

  const settleStart = (err) => {
    if (!pendingStart) return;
    const { resolve, reject, timer } = pendingStart;
    pendingStart = null;
    clearTimeout(timer);
    if (err) reject(err);
    else resolve({ durationSeconds: duration || null });
  };

  const call = (name, ...args) => {
    const fn = handlers[name];
    if (typeof fn !== 'function') return;
    try { fn(...args); } catch (e) { log.error('[Bandcamp embed] handler failed:', name, e); }
  };

  const onState = (state) => {
    if (!active || !state || state.token !== token) return;

    if (state.dur > 0 && state.dur !== duration) {
      duration = state.dur;
      call('onDuration', duration);
    }

    if (!started) {
      if (state.errorCode) {
        settleStart(errorWithReason('Bandcamp could not play this track', 'unplayable'));
        return;
      }
      if (state.t > 0) {
        started = true;
        paused = !!state.paused;
        position = state.t;
        settleStart(null);
        call('onProgress', position);
      }
      if (!state.ended) return;
    }

    if (state.ended) {
      paused = true;
      if (!finished) {
        finished = true;
        call('onFinish');
      }
      return;
    }

    if (state.errorCode) {
      call('onError');
      return;
    }

    // Measured stream bitrate: decoded bytes off the embed's own <audio>,
    // sampled against the reported position. Older control-script copies
    // (and the mobile byte-for-byte copies until they update) report no
    // decodedBytes — the meter just stays idle.
    if (state.decodedBytes != null && state.decodedBytes >= 0) {
      const bitrate = streamMeter.sample(state.t, state.decodedBytes);
      if (bitrate && bitrate !== emittedBitrate) {
        emittedBitrate = bitrate;
        call('onStreamQuality', { bitrate, origin: 'measured' });
      }
    }

    if (state.t !== position) {
      position = state.t;
      call('onProgress', position);
    }
    if (!!state.paused !== paused) {
      paused = !!state.paused;
      call(paused ? 'onPause' : 'onPlay');
    }
  };

  const ensureIframe = () => {
    if (iframe) return iframe;
    const doc = win.document;
    iframe = doc.createElement('iframe');
    iframe.setAttribute('allow', 'autoplay');
    iframe.setAttribute('title', 'Bandcamp player');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.setAttribute('tabindex', '-1');
    iframe.style.cssText = 'position:fixed;width:400px;height:120px;left:-2000px;bottom:0;opacity:0;pointer-events:none;border:0;';
    iframe.addEventListener('load', () => {
      const run = onFrameLoaded;
      onFrameLoaded = null;
      if (run) run();
    });
    doc.body.appendChild(iframe);
    return iframe;
  };

  const reset = () => {
    started = false;
    finished = false;
    paused = true;
    position = 0;
    duration = 0;
    streamMeter.reset();
    emittedBitrate = null;
  };

  // `link` is the track's Bandcamp page (what "Open in Bandcamp" opens);
  // `source` carries the track id when the resolver found one.
  const load = (link, nextHandlers = {}, source = {}) => {
    settleStart(errorWithReason('Bandcamp embed load superseded', 'superseded'));
    onFrameLoaded = null;
    const previous = active ? token : null;
    token += 1;
    const myToken = token;
    reset();
    active = true;
    handlers = nextHandlers || {};

    const b = bridge();
    if (previous !== null && b) Promise.resolve(b.stop({ token: previous })).catch(() => {});

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (token !== myToken) return;
        settleStart(errorWithReason('Bandcamp embed did not start this track', 'unplayable'));
      }, startTimeoutMs);
      pendingStart = { resolve, reject, timer };

      if (!b) {
        settleStart(errorWithReason('The Bandcamp embed bridge is missing', 'unplayable'));
        return;
      }
      if (!listening) {
        listening = true;
        b.onState(onState);
      }

      const refuse = () => {
        if (token === myToken) settleStart(errorWithReason('Bandcamp embed could not load this track', 'unplayable'));
      };
      Promise.resolve(b.prepare({ bandcampUrl: link, bandcampTrackId: source && source.bandcampTrackId }))
        .then((prepared) => {
          if (token !== myToken) return;
          if (!prepared || !prepared.success) { refuse(); return; }
          const frame = ensureIframe();
          onFrameLoaded = () => {
            if (token !== myToken) return;
            Promise.resolve(b.start({ token: myToken, url: prepared.url, volume }))
              .then((startedUp) => { if (!startedUp || !startedUp.success) refuse(); })
              .catch(refuse);
          };
          frame.src = prepared.url;
        })
        .catch(refuse);
    });
  };

  const stop = () => {
    settleStart(errorWithReason('Bandcamp embed stopped', 'superseded'));
    onFrameLoaded = null;
    const wasActive = active;
    const lastToken = token;
    token += 1;
    handlers = {};
    active = false;
    reset();
    if (!wasActive) return;
    if (iframe) iframe.src = 'about:blank';
    const b = bridge();
    if (b) Promise.resolve(b.stop({ token: lastToken })).catch(() => {});
  };

  const element = {
    get src() { return ''; },
    get paused() { return paused; },
    get currentTime() { return position; },
    set currentTime(value) {
      if (!active || !Number.isFinite(value)) return;
      position = Math.max(0, value);
      command('seek', position);
    },
    get duration() { return duration || NaN; },
    get volume() { return volume; },
    set volume(value) {
      if (!Number.isFinite(value)) return;
      volume = Math.min(1, Math.max(0, value));
      command('volume', volume);
    },
    play() {
      if (active) { command('play'); paused = false; }
      return Promise.resolve();
    },
    pause() {
      if (active) command('pause');
      paused = true;
    }
  };

  const getState = () => ({ active, started, finished, paused, position, duration, volume, token });

  return { load, stop, element, isActive: () => active, getState };
}

module.exports = { createBandcampEmbedPlayer, START_TIMEOUT_MS };
