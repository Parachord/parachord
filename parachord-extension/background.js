// Parachord Browser Extension - Background Service Worker
// Maintains WebSocket connection to Parachord desktop app

const PARACHORD_WS_URL = 'ws://127.0.0.1:9876';

let socket = null;
let reconnectTimer = null;
let activeTabId = null;

// Connection state
let isConnected = false;

// Connect to Parachord desktop
function connect() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    return;
  }

  console.log('[Parachord] Connecting to desktop app...');

  try {
    socket = new WebSocket(PARACHORD_WS_URL);

    socket.onopen = () => {
      console.log('[Parachord] Connected to desktop app');
      isConnected = true;
      clearReconnectTimer();

      // Update badge to show connected status
      chrome.action.setBadgeText({ text: '' });
      chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('[Parachord] Received:', message);
        handleDesktopMessage(message);
      } catch (error) {
        console.error('[Parachord] Failed to parse message:', error);
      }
    };

    socket.onclose = () => {
      console.log('[Parachord] Disconnected from desktop app');
      isConnected = false;
      socket = null;

      // Update badge to show disconnected
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });

      // Schedule reconnection
      scheduleReconnect();
    };

    socket.onerror = (error) => {
      console.error('[Parachord] WebSocket error:', error);
    };
  } catch (error) {
    console.error('[Parachord] Failed to create WebSocket:', error);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  clearReconnectTimer();
  reconnectTimer = setTimeout(() => {
    console.log('[Parachord] Attempting to reconnect...');
    connect();
  }, 5000);
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

// Send message to desktop
function sendToDesktop(message) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
    return true;
  }
  console.warn('[Parachord] Cannot send - not connected');
  return false;
}

// Handle messages from desktop
function handleDesktopMessage(message) {
  if (message.type === 'command') {
    // Forward command to content script
    if (activeTabId) {
      chrome.tabs.sendMessage(activeTabId, message).catch(err => {
        console.error('[Parachord] Failed to send to content script:', err);
      });
    }
  } else if (message.type === 'injectCode') {
    // Inject browser control code from resolver
    if (activeTabId && message.code) {
      injectBrowserControlCode(activeTabId, message.code);
    }
  }
}

// Inject browser control functions from resolver
async function injectBrowserControlCode(tabId, code) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (codeObj) => {
        // Store the injected functions on window for content script to use
        window.__parachordControl = {
          play: codeObj.browserPlay ? new Function('return (' + codeObj.browserPlay + ')();') : null,
          pause: codeObj.browserPause ? new Function('return (' + codeObj.browserPause + ')();') : null,
          getState: codeObj.browserGetState ? new Function('return (' + codeObj.browserGetState + ')();') : null
        };
        console.log('[Parachord] Browser control code injected');
      },
      args: [code]
    });
  } catch (error) {
    console.error('[Parachord] Failed to inject code:', error);
  }
}

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Parachord] Message from content script:', message);

  if (message.type === 'event') {
    // Track active tab for playback events
    if (message.event === 'connected' && sender.tab) {
      activeTabId = sender.tab.id;
      message.tabId = sender.tab.id;
    } else if (message.event === 'ended' || message.event === 'tabClosed') {
      if (sender.tab) {
        message.tabId = sender.tab.id;
      }
    }

    // Forward to desktop
    sendToDesktop(message);
  } else if (message.type === 'getStatus') {
    // Content script asking for connection status
    sendResponse({ connected: isConnected });
    return true;
  }
});

// Handle tab close - notify desktop if it was the active playback tab
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeTabId) {
    console.log('[Parachord] Active playback tab closed');
    sendToDesktop({
      type: 'event',
      event: 'tabClosed',
      tabId: tabId
    });
    activeTabId = null;
  }
});

// Handle command to close a tab from desktop
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'closeTab' && message.tabId) {
    chrome.tabs.remove(message.tabId).catch(err => {
      console.error('[Parachord] Failed to close tab:', err);
    });
  }
});

// Start connection when extension loads
connect();

// Also try to connect when service worker wakes up
chrome.runtime.onStartup.addListener(() => {
  connect();
});

// Reconnect on install/update
chrome.runtime.onInstalled.addListener(() => {
  connect();
});
