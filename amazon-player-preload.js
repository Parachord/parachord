// Runs before music.amazon.com's scripts. Amazon pauses and tears down the
// Widevine element when the window blurs. The player view is 0×0 and must not
// keep keyboard focus, so the page is told it is still visible.
//
// It also installs the window.__r trap: hornet's playbackController lives in
// a Metro module whose id renumbers on every redeploy, and executing module
// factories to find it wedges the page — so the trap only observes requires
// that Amazon's own code makes and captures the store passively.
//
// And it hijacks navigator.mediaSession (embedded-player-kit.js): Amazon's
// page is the only audio playing in the app during Amazon playback, so
// Chromium hands the OS media surface (MPRIS/SMTC/Control Center) and OS
// media keys to the page's own media session. Our handlers on the real
// session receive the keys and postMessage them here (registered on every
// platform — without them a DE can fall through to Chromium's default
// element control), the page's own metadata/handlers hit an inert facade and
// never reach the OS, and main's now-playing mirror (embedded-player-mirror,
// relayed below) writes Parachord's track into the real session so the OS
// card shows it.
//
// SANDBOX CONSTRAINT (load-bearing): the Amazon views run with sandbox: true,
// and a sandboxed preload can only require 'electron'/'events'/'timers'/'url'
// — never local files. An earlier revision required ./amazon-music-logic here,
// which throws "module not found" and silently killed the ENTIRE preload: no
// trap, no visibility stub, with the localStorage quality fallback masking the
// damage (verified live on Electron 39 +wvcus). So installAmazonRequireTrap
// and installAmazonStreamCapture are inlined below as literal copies of the
// ones in amazon-music-logic.js, installMediaSessionHijack + the
// applyMediaSessionMirror relay of the ones in embedded-player-kit.js —
// and the four copies are GENERATOR-OWNED (scripts/build-amazon-preload.js
// regenerates the GENERATED-BEGIN/END blocks from .toString() of the
// sources, prettier-canonicalized; the parity test + CI drift gate are the
// guards now, no hand-edits), and
// tests/resolver/amazon-player-preload.test.js fails the build if the copies
// drift or if a local require ever comes back. Do not require local modules
// from this file.
//
// contextIsolation puts this file in a different world from the page. Patching
// document here would not affect Amazon's scripts, so the stub is evaluated in
// the page world (isolated world 0).

// GENERATED-BEGIN installMediaSessionHijack
function installMediaSessionHijack(scope, onAction) {
  if (!scope || !scope.navigator || scope.__parachordMediaSessionHijack) return null;
  const real = scope.navigator.mediaSession;
  if (!real) return null;
  try {
    Object.defineProperty(scope, '__parachordMediaSessionHijack', { value: true });
  } catch {
    scope.__parachordMediaSessionHijack = true;
  }
  if (typeof onAction === 'function') {
    const report = (action) => {
      try {
        onAction(action);
      } catch {}
    };
    for (const action of ['play', 'pause', 'previoustrack', 'nexttrack', 'stop']) {
      try {
        real.setActionHandler(action, () => report(action));
      } catch {}
    }
  }
  // Inert facade. Every page-world write becomes a silent no-op that never
  // reaches Chromium; reads return inert defaults (or the page's own last
  // write for metadata/playbackState — plain object properties — so
  // read-back page code keeps working). 'mediaSession' in navigator stays
  // true, and the MediaMetadata constructor pages call before assigning
  // .metadata is left untouched.
  const facade = {
    metadata: null,
    playbackState: 'none',
    setActionHandler() {},
    setPositionState() {},
    setCameraActive() {},
    setMicrophoneActive() {},
  };
  try {
    Object.defineProperty(scope.navigator, 'mediaSession', {
      configurable: true,
      get() {
        return facade;
      },
    });
  } catch {}
  return real;
}
// GENERATED-END installMediaSessionHijack

// GENERATED-BEGIN applyMediaSessionMirror
function applyMediaSessionMirror(real, data, MediaMetadataCtor) {
  if (!real || !data || typeof data !== 'object') return;
  try {
    if ('metadata' in data) {
      const m = data.metadata;
      if (!m) {
        real.metadata = null;
      } else if (typeof MediaMetadataCtor === 'function') {
        const base = {
          title: String(m.title || ''),
          artist: String(m.artist || ''),
          album: String(m.album || ''),
        };
        const art = m.artwork && typeof m.artwork === 'string' && /^https:/i.test(m.artwork);
        try {
          real.metadata = new MediaMetadataCtor(
            art
              ? {
                  title: base.title,
                  artist: base.artist,
                  album: base.album,
                  artwork: [{ src: m.artwork, sizes: '512x512' }],
                }
              : base,
          );
        } catch {
          try {
            real.metadata = new MediaMetadataCtor(base);
          } catch {}
        }
      }
    }
    if (
      data.playbackState === 'playing' ||
      data.playbackState === 'paused' ||
      data.playbackState === 'none'
    ) {
      try {
        real.playbackState = data.playbackState;
      } catch {}
    }
    if (data.position && Number(data.position.duration) > 0) {
      const duration = Number(data.position.duration);
      const position = Math.max(0, Math.min(Number(data.position.position) || 0, duration));
      try {
        real.setPositionState({
          duration,
          position,
          playbackRate: data.position.rate === 0 ? 0 : 1,
        });
      } catch {}
    }
  } catch {}
}
// GENERATED-END applyMediaSessionMirror

const PAGE_STUB = `(function () {
  const installMediaSessionHijack = ${installMediaSessionHijack.toString()};
  // The hijack RETURNS the real session; the stub holds it in this closure.
  // It is deliberately NOT stashed on window — a plain window property is
  // page-writable, and the page must not be able to reach the real session
  // and re-register its own handlers or metadata over the hijack.
  const msReal = installMediaSessionHijack(window, (action) => {
    try {
      window.postMessage({ __parachordEmbeddedPlayer: { resolverId: 'amazonmusic', type: 'action', action: String(action) } }, '*');
    } catch (e) {}
  });
  const applyMediaSessionMirror = ${applyMediaSessionMirror.toString()};
  // Main → view now-playing mirror: the preload world (which owns ipcRenderer)
  // relays 'embedded-player-mirror' payloads as postMessage events; the stub
  // applies them to the real session behind the facade so the OS card shows
  // Parachord's track instead of the page's own label ("Amazon Music").
  // event.source === window drops messages from cross-origin iframes (they
  // can postMessage to the window too). The bridge is page-forgeable by
  // design — the payload only carries display metadata, and main filters the
  // artwork before it is ever sent.
  window.addEventListener('message', (event) => {
    try {
      if (event.source !== window) return;
      const payload = event && event.data && event.data.__parachordEmbeddedPlayer;
      if (!payload || payload.type !== 'mirror') return;
      applyMediaSessionMirror(msReal, payload.data, window.MediaMetadata);
    } catch (e) {}
  });
  const stop = (event) => { event.stopImmediatePropagation(); };
  window.addEventListener('blur', stop, true);
  window.addEventListener('pagehide', stop, true);
  document.addEventListener('visibilitychange', stop, true);
  try {
    Object.defineProperty(document, 'hidden', { configurable: true, get() { return false; } });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get() { return 'visible'; } });
    Document.prototype.hasFocus = function () { return true; };
  } catch (e) {}
  // Canary: this line in the view's console (DevTools on the player/search
  // view) proves the preload actually ran. Its absence is how you notice the
  // sandboxed-preload failure mode this file's header warns about.
  console.log('[Amazon] Parachord preload stub active');
})();`;

// Bridge for the media-session hijack: the page-world stub reports OS media
// keys that Chromium routed to this view's active session (through our
// handlers on the real navigator.mediaSession) as postMessage events, since
// the page world has no ipcRenderer. Forward them to main, which validates
// this view against its registry and funnels them into the renderer's
// existing mpris-control transport path. DOM events cross worlds under
// contextIsolation, so the page-world postMessage reaches this listener.
// The marker is page-forgeable by design — the payload only carries
// idempotent transport actions.
try {
  const { ipcRenderer } = require('electron');
  window.addEventListener('message', (event) => {
    try {
      // event.source === window: a cross-origin iframe inside the page can
      // postMessage to the window too — only same-window messages are ours.
      if (event.source !== window) return;
      const payload = event && event.data && event.data.__parachordEmbeddedPlayer;
      if (!payload || payload.type !== 'action' || !payload.action) return;
      ipcRenderer.send('embedded-player-media-key', {
        resolverId: String(payload.resolverId || ''),
        action: String(payload.action)
      });
    } catch (e) {}
  });
  // Main → view now-playing mirror (macOS/Windows; main gates the platform
  // and playback ownership). Relay to the page world, where the stub applies
  // it to the real session behind the facade.
  ipcRenderer.on('embedded-player-mirror', (event, data) => {
    try {
      window.postMessage({ __parachordEmbeddedPlayer: { type: 'mirror', data } }, '*');
    } catch (e) {}
  });
} catch (e) {}

try {
  const { webFrame } = require('electron');
  webFrame.executeJavaScriptInIsolatedWorld(0, [{ code: PAGE_STUB }]);
} catch (e) {
  // Isolation off, or webFrame unavailable: this world is the page.
  eval(PAGE_STUB);
}
