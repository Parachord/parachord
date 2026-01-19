// Parachord Browser Extension - Background Service Worker
// Maintains WebSocket connection to Parachord desktop app

const PARACHORD_WS_URL = 'ws://127.0.0.1:9876';

let socket = null;
let reconnectTimer = null;
let activeTabId = null;

// Connection state
let isConnected = false;

// Queue for messages that arrive before WebSocket is connected
let pendingMessages = [];

// Track tab ID being programmatically closed (to avoid clearing activeTabId)
let programmaticCloseTabId = null;

// Connect to Parachord desktop
function connect() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    return;
  }

  try {
    socket = new WebSocket(PARACHORD_WS_URL);

    socket.onopen = () => {
      console.log('[Parachord] Connected to desktop app');
      isConnected = true;
      clearReconnectTimer();

      // Update badge to show connected status
      chrome.action.setBadgeText({ text: '' });
      chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });

      // Send any queued messages
      if (pendingMessages.length > 0) {
        pendingMessages.forEach(msg => {
          socket.send(JSON.stringify(msg));
        });
        pendingMessages = [];
      }
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('[Parachord] WebSocket received:', message.type, message.action || message.event || '');
        handleDesktopMessage(message);
      } catch (error) {
        console.error('[Parachord] Failed to parse message:', error);
      }
    };

    socket.onclose = () => {
      isConnected = false;
      socket = null;

      // Update badge to show disconnected
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });

      // Schedule reconnection
      scheduleReconnect();
    };

    socket.onerror = () => {
      // Error will trigger onclose, which handles reconnection
    };
  } catch (error) {
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  clearReconnectTimer();
  reconnectTimer = setTimeout(() => {
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
  // Queue the message if not connected yet
  pendingMessages.push(message);
  connect();
  return false;
}

// Handle messages from desktop
function handleDesktopMessage(message) {
  console.log('[Parachord] handleDesktopMessage:', JSON.stringify(message));
  if (message.type === 'command') {
    console.log('[Parachord] Command received, action:', message.action, 'tabId:', message.tabId);
    if (message.action === 'closeTab' && message.tabId) {
      // Close the specified tab
      console.log('[Parachord] Closing tab:', message.tabId);
      // Mark as programmatic close so onRemoved doesn't clear activeTabId or send tabClosed
      programmaticCloseTabId = message.tabId;
      chrome.tabs.remove(message.tabId).then(() => {
        console.log('[Parachord] Tab closed successfully:', message.tabId);
        // Clear the flag after a short delay to allow onRemoved to check it
        setTimeout(() => {
          if (programmaticCloseTabId === message.tabId) {
            programmaticCloseTabId = null;
          }
        }, 100);
      }).catch((err) => {
        console.error('[Parachord] Failed to close tab:', message.tabId, err);
        programmaticCloseTabId = null;
      });
    } else {
      // Forward other commands to content script
      if (activeTabId) {
        chrome.tabs.sendMessage(activeTabId, message).catch(() => {});
      }
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
      },
      args: [code]
    });
  } catch (error) {
    console.error('[Parachord] Failed to inject code:', error);
  }
}

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

    sendResponse({ received: true });
    return true;
  } else if (message.type === 'getStatus') {
    sendResponse({ connected: isConnected });
    return true;
  }

  return true;
});

// Handle tab close - notify desktop if it was the active playback tab
chrome.tabs.onRemoved.addListener((tabId) => {
  // Skip if this was a programmatic close (switching tracks)
  if (tabId === programmaticCloseTabId) {
    console.log('[Parachord] Ignoring programmatic tab close for:', tabId);
    return;
  }

  if (tabId === activeTabId) {
    console.log('[Parachord] User closed playback tab:', tabId);
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
    chrome.tabs.remove(message.tabId).catch(() => {});
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

// Keep-alive mechanism using Chrome alarms API
// This survives service worker restarts
const KEEP_ALIVE_ALARM = 'parachord-keepalive';

// Set up alarm for keep-alive (fires every 20 seconds)
chrome.alarms.create(KEEP_ALIVE_ALARM, { periodInMinutes: 0.33 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEP_ALIVE_ALARM) {
    // Check connection and reconnect if needed
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      connect();
    } else {
      // Send ping to keep connection alive
      socket.send(JSON.stringify({ type: 'ping' }));
    }

    // Re-send heartbeat if we have an active tab
    if (activeTabId && socket && socket.readyState === WebSocket.OPEN) {
      chrome.tabs.get(activeTabId).then(tab => {
        if (tab && tab.url) {
          let site = 'unknown';
          if (tab.url.includes('youtube.com')) site = 'youtube';
          else if (tab.url.includes('bandcamp.com')) site = 'bandcamp';

          socket.send(JSON.stringify({
            type: 'event',
            event: 'heartbeat',
            site: site,
            tabId: activeTabId,
            url: tab.url
          }));
        }
      }).catch(() => {
        activeTabId = null;
      });
    }
  }
});
