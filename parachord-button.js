/**
 * Parachord Button - Embeddable "Send to Parachord" button for third-party websites.
 *
 * Usage:
 *
 *   1. Declarative (data attributes):
 *      <script src="https://parachord.com/button.js"></script>
 *      <div class="parachord-button"
 *           data-title="My Playlist"
 *           data-creator="My Website"
 *           data-tracks='[{"title":"Song","artist":"Artist","album":"Album"}]'>
 *      </div>
 *
 *   2. Declarative with hosted XSPF:
 *      <div class="parachord-button"
 *           data-xspf-url="https://example.com/playlist.xspf">
 *      </div>
 *
 *   3. Programmatic:
 *      Parachord.sendPlaylist({
 *        title: "My Playlist",
 *        creator: "My Website",
 *        tracks: [
 *          { title: "Karma Police", artist: "Radiohead", album: "OK Computer" },
 *          { title: "Hyperballad", artist: "Bjork", album: "Post" }
 *        ]
 *      });
 *
 * Track format:
 *   { title: string, artist: string, album?: string, duration?: number (seconds) }
 */
(function () {
  'use strict';

  if (window.Parachord) return; // Already loaded

  var WEBSOCKET_PORT = 9876;
  var PROTOCOL_SCHEME = 'parachord';
  var ACCENT_COLOR = '#8b5cf6';

  var ws = null;
  var wsConnected = false;
  var connectAttempts = 0;
  var maxReconnectDelay = 16000;
  var pendingRequests = {};
  var requestIdCounter = 0;

  // --- WebSocket connection ---

  function connectWebSocket() {
    try {
      ws = new WebSocket('ws://127.0.0.1:' + WEBSOCKET_PORT);

      ws.onopen = function () {
        wsConnected = true;
        connectAttempts = 0;
        updateAllButtons();
        // Send a ping to identify as embed
        ws.send(JSON.stringify({ type: 'embed', action: 'ping', requestId: 'init' }));
      };

      ws.onclose = function () {
        wsConnected = false;
        ws = null;
        updateAllButtons();
        scheduleReconnect();
      };

      ws.onerror = function () {
        if (ws) ws.close();
      };

      ws.onmessage = function (event) {
        try {
          var msg = JSON.parse(event.data);
          if (msg.requestId && pendingRequests[msg.requestId]) {
            pendingRequests[msg.requestId](msg);
            delete pendingRequests[msg.requestId];
          }
        } catch (e) { /* ignore parse errors */ }
      };
    } catch (e) {
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    var delay = Math.min(1000 * Math.pow(2, connectAttempts), maxReconnectDelay);
    connectAttempts++;
    setTimeout(connectWebSocket, delay);
  }

  function sendWsMessage(action, payload) {
    return new Promise(function (resolve) {
      if (!wsConnected || !ws || ws.readyState !== WebSocket.OPEN) {
        resolve({ success: false, error: 'Not connected' });
        return;
      }
      var id = 'btn-' + (++requestIdCounter);
      pendingRequests[id] = resolve;
      ws.send(JSON.stringify({ type: 'embed', action: action, requestId: id, payload: payload }));
      // Timeout after 10 seconds
      setTimeout(function () {
        if (pendingRequests[id]) {
          delete pendingRequests[id];
          resolve({ success: false, error: 'Timeout' });
        }
      }, 10000);
    });
  }

  // --- Protocol URL helpers ---

  function buildImportUrl(playlist) {
    if (playlist.xspfUrl) {
      return PROTOCOL_SCHEME + '://import?url=' + encodeURIComponent(playlist.xspfUrl);
    }
    var tracks = playlist.tracks || [];
    var b64 = btoa(unescape(encodeURIComponent(JSON.stringify(tracks))));
    var url = PROTOCOL_SCHEME + '://import?tracks=' + encodeURIComponent(b64);
    if (playlist.title) url += '&title=' + encodeURIComponent(playlist.title);
    if (playlist.creator) url += '&creator=' + encodeURIComponent(playlist.creator);
    return url;
  }

  // --- Core API ---

  function sendPlaylist(playlist) {
    if (wsConnected) {
      return sendWsMessage('importPlaylist', {
        title: playlist.title || 'Imported Playlist',
        creator: playlist.creator || 'Unknown',
        tracks: playlist.tracks || []
      });
    }
    // Fallback: open protocol URL
    window.location.href = buildImportUrl(playlist);
    return Promise.resolve({ success: true, method: 'protocol' });
  }

  function sendXspfUrl(url) {
    if (wsConnected) {
      // Use protocol URL via WS - the import handler will fetch the XSPF
      var protocolUrl = PROTOCOL_SCHEME + '://import?url=' + encodeURIComponent(url);
      return sendWsMessage('importPlaylist', { xspfUrl: url });
    }
    window.location.href = PROTOCOL_SCHEME + '://import?url=' + encodeURIComponent(url);
    return Promise.resolve({ success: true, method: 'protocol' });
  }

  // --- Button rendering ---

  var SVG_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>';

  var buttonCSS =
    '.parachord-btn-widget{display:inline-flex;align-items:center;gap:8px;padding:10px 18px;' +
    'background:' + ACCENT_COLOR + ';color:#fff;border:none;border-radius:8px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
    'font-size:14px;font-weight:500;cursor:pointer;text-decoration:none;transition:all .2s ease;line-height:1;}' +
    '.parachord-btn-widget:hover{filter:brightness(1.15);transform:translateY(-1px);}' +
    '.parachord-btn-widget:active{transform:translateY(0);}' +
    '.parachord-btn-widget svg{flex-shrink:0;}' +
    '.parachord-btn-dot{width:8px;height:8px;border-radius:50%;background:#22c55e;animation:parachord-pulse 2s infinite;}' +
    '@keyframes parachord-pulse{0%,100%{opacity:1}50%{opacity:.5}}';

  var styleInjected = false;

  function injectStyles() {
    if (styleInjected) return;
    var style = document.createElement('style');
    style.textContent = buttonCSS;
    document.head.appendChild(style);
    styleInjected = true;
  }

  function createButtonElement(playlist, options) {
    injectStyles();
    options = options || {};

    var btn = document.createElement('button');
    btn.className = 'parachord-btn-widget';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Send to Parachord');

    var label = options.label || 'Send to Parachord';

    function render() {
      btn.innerHTML =
        (wsConnected ? '<span class="parachord-btn-dot"></span>' : '') +
        SVG_ICON +
        '<span>' + label + '</span>';
    }
    render();

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      if (playlist.xspfUrl) {
        sendXspfUrl(playlist.xspfUrl);
      } else {
        sendPlaylist(playlist);
      }
      // Brief visual feedback
      var origLabel = btn.querySelector('span:last-child');
      if (origLabel) {
        origLabel.textContent = 'Sent!';
        setTimeout(function () { origLabel.textContent = label; }, 2000);
      }
    });

    // Store render function for updates
    btn._parachordRender = render;
    return btn;
  }

  // Track all rendered buttons so we can update their connected state
  var allButtons = [];

  function updateAllButtons() {
    allButtons.forEach(function (btn) {
      if (btn._parachordRender) btn._parachordRender();
    });
  }

  // --- Auto-initialization from data attributes ---

  function initDeclarativeButtons() {
    var elements = document.querySelectorAll('.parachord-button');
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      if (el.getAttribute('data-parachord-initialized')) continue;
      el.setAttribute('data-parachord-initialized', 'true');

      var playlist = {};

      if (el.getAttribute('data-xspf-url')) {
        playlist.xspfUrl = el.getAttribute('data-xspf-url');
      } else {
        playlist.title = el.getAttribute('data-title') || 'Playlist';
        playlist.creator = el.getAttribute('data-creator') || '';
        try {
          playlist.tracks = JSON.parse(el.getAttribute('data-tracks') || '[]');
        } catch (e) {
          playlist.tracks = [];
          console.warn('Parachord Button: invalid data-tracks JSON', e);
        }
      }

      var options = {};
      if (el.getAttribute('data-label')) {
        options.label = el.getAttribute('data-label');
      }

      var btn = createButtonElement(playlist, options);
      el.appendChild(btn);
      allButtons.push(btn);
    }
  }

  // --- Public API ---

  window.Parachord = {
    /** Send a playlist to Parachord. */
    sendPlaylist: sendPlaylist,

    /** Send a hosted XSPF URL to Parachord. */
    sendXspfUrl: sendXspfUrl,

    /** Create a button element you can append to the DOM yourself. */
    createButton: function (playlist, options) {
      var btn = createButtonElement(playlist, options);
      allButtons.push(btn);
      return btn;
    },

    /** Whether Parachord desktop app is currently detected as running. */
    get isConnected() {
      return wsConnected;
    }
  };

  // Start WebSocket connection and scan for declarative buttons
  connectWebSocket();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDeclarativeButtons);
  } else {
    initDeclarativeButtons();
  }

  // Also watch for dynamically added buttons
  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].addedNodes.length) {
          initDeclarativeButtons();
          return;
        }
      }
    }).observe(document.body || document.documentElement, { childList: true, subtree: true });
  }
})();
