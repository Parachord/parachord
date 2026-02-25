// Parachord Browser Extension - Background Service Worker
// Communicates with Parachord desktop app via Chrome native messaging

const NATIVE_HOST_NAME = 'com.parachord.desktop';

let port = null;
let activeTabId = null;

// Connection state
let isConnected = false;

// Page support indicator state
let currentPageSupported = false;

// Queue for messages that arrive before native messaging is connected
let pendingMessages = [];

// Track tab ID being programmatically closed (to avoid clearing activeTabId)
let programmaticCloseTabId = null;

// Reconnection state
let reconnectTimer = null;
const RECONNECT_DELAY = 5000;

// Connect to Parachord desktop via native messaging
function connect() {
  if (port) {
    return;
  }

  try {
    port = chrome.runtime.connectNative(NATIVE_HOST_NAME);

    port.onMessage.addListener((message) => {
      console.log('[Parachord] Native message received:', message.type, message.action || message.event || '');
      handleDesktopMessage(message);
    });

    port.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError;
      console.log('[Parachord] Native messaging disconnected', error ? error.message : '');
      port = null;
      isConnected = false;

      // Update badge to show disconnected status
      updateBadge();

      // Schedule reconnection
      scheduleReconnect();
    });

    // Native messaging connection is established synchronously by connectNative;
    // if the host is available the port stays open, otherwise onDisconnect fires.
    // We consider ourselves connected after the port is created without immediate error.
    isConnected = true;
    clearReconnectTimer();

    // Update badge
    checkCurrentTab();

    // Send any queued messages
    if (pendingMessages.length > 0) {
      pendingMessages.forEach(msg => {
        port.postMessage(msg);
      });
      pendingMessages = [];
    }

    console.log('[Parachord] Connected to desktop app via native messaging');
  } catch (error) {
    console.error('[Parachord] Failed to connect:', error);
    port = null;
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  clearReconnectTimer();
  reconnectTimer = setTimeout(() => {
    connect();
  }, RECONNECT_DELAY);
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

// Send message to desktop
function sendToDesktop(message) {
  console.log('[Parachord] sendToDesktop called:', message.type, message.url || message.event || '');
  if (port && isConnected) {
    console.log('[Parachord] Sending via native messaging:', JSON.stringify(message));
    port.postMessage(message);
    return true;
  }
  // Queue the message if not connected yet
  console.log('[Parachord] Not connected, queuing message');
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
  }
}

// Handle messages from content scripts and popup
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
  } else if (message.type === 'sendToParachord') {
    // Forward URL to desktop from popup
    console.log('[Parachord] Sending URL to desktop from popup:', message.url);
    const sent = sendToDesktop(message);
    console.log('[Parachord] Send result:', sent ? 'sent immediately' : 'queued (not connected)');
    sendResponse({ received: true, sent: sent });
    return true;
  } else if (message.type === 'sendScrapedPlaylist') {
    // Forward scraped playlist data to desktop
    console.log('[Parachord] Sending scraped playlist to desktop:', message.playlist?.name, `(${message.playlist?.tracks?.length} tracks)`);
    const sent = sendToDesktop({
      type: 'scrapedPlaylist',
      playlist: message.playlist,
      source: message.source || 'scrape'
    });
    sendResponse({ received: true, sent: sent });
    return true;
  } else if (message.type === 'scrapePlaylist') {
    // Request to scrape playlist from current tab - forward to content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'scrapePlaylist' }, (response) => {
          sendResponse(response);
        });
      } else {
        sendResponse({ error: 'No active tab' });
      }
    });
    return true; // Keep channel open for async response
  } else if (message.type === 'addFriend') {
    // Forward add friend request to desktop (Last.fm/ListenBrainz user profiles)
    console.log('[Parachord] Sending add friend request to desktop:', message.url);
    const sent = sendToDesktop({
      type: 'addFriend',
      url: message.url,
      service: message.service,
      source: message.source || 'popup'
    });
    console.log('[Parachord] Send result:', sent ? 'sent immediately' : 'queued (not connected)');
    sendResponse({ received: true, sent: sent });
    return true;
  } else if (message.type === 'sendScrapedAlbum') {
    // Forward scraped album data to desktop (for album lookup, e.g., Pitchfork reviews)
    console.log('[Parachord] Sending scraped album to desktop:', message.album?.artist, '-', message.album?.album);
    const sent = sendToDesktop({
      type: 'scrapedAlbum',
      album: message.album,
      source: message.source || 'scrape'
    });
    sendResponse({ received: true, sent: sent });
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

// Intercept settings (loaded from storage)
let spotifyInterceptEnabled = true;
let appleMusicInterceptEnabled = true;

// Load intercept settings
chrome.storage.local.get(['spotifyInterceptEnabled', 'appleMusicInterceptEnabled'], (result) => {
  if (result.spotifyInterceptEnabled !== undefined) {
    spotifyInterceptEnabled = result.spotifyInterceptEnabled;
  }
  if (result.appleMusicInterceptEnabled !== undefined) {
    appleMusicInterceptEnabled = result.appleMusicInterceptEnabled;
  }
  console.log('[Parachord] Intercept settings loaded:', { spotifyInterceptEnabled, appleMusicInterceptEnabled });
});

// Listen for settings changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    if (changes.spotifyInterceptEnabled !== undefined) {
      spotifyInterceptEnabled = changes.spotifyInterceptEnabled.newValue;
      console.log('[Parachord] Spotify intercept:', spotifyInterceptEnabled);
    }
    if (changes.appleMusicInterceptEnabled !== undefined) {
      appleMusicInterceptEnabled = changes.appleMusicInterceptEnabled.newValue;
      console.log('[Parachord] Apple Music intercept:', appleMusicInterceptEnabled);
    }
  }
});

// Check if URL is a Spotify content URL (track, album, playlist)
function isSpotifyContentUrl(url) {
  if (!url) return false;
  const patterns = [
    /open\.spotify\.com\/track\//,
    /open\.spotify\.com\/album\//,
    /open\.spotify\.com\/playlist\//,
    /open\.spotify\.com\/intl-[^/]+\/track\//,
    /open\.spotify\.com\/intl-[^/]+\/album\//,
    /open\.spotify\.com\/intl-[^/]+\/playlist\//
  ];
  return patterns.some(pattern => pattern.test(url));
}

// Check if URL is an Apple Music content URL (album, playlist, song)
function isAppleMusicContentUrl(url) {
  if (!url) return false;
  const patterns = [
    /music\.apple\.com\/[^/]+\/album\//,
    /music\.apple\.com\/[^/]+\/playlist\//,
    /music\.apple\.com\/[^/]+\/song\//
  ];
  return patterns.some(pattern => pattern.test(url));
}

// Check if URL is a page the extension supports (scraping, playback, or actions)
function isSupportedPage(url) {
  if (!url) return false;
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    const pathname = urlObj.pathname;

    // Spotify
    if (hostname === 'open.spotify.com') {
      return /\/(track|album|playlist|artist)\//.test(pathname) ||
             /\/intl-[^/]+\/(track|album|playlist|artist)\//.test(pathname);
    }

    // Apple Music
    if (hostname === 'music.apple.com') {
      return /\/(album|playlist|song|artist)\//.test(pathname);
    }

    // YouTube
    if (hostname === 'www.youtube.com' || hostname === 'youtube.com') {
      return pathname === '/watch' || pathname.startsWith('/playlist');
    }

    // Bandcamp
    if (hostname.endsWith('.bandcamp.com')) {
      return /^\/(track|album)\//.test(pathname);
    }
    if (hostname === 'bandcamp.com') {
      return pathname.includes('/playlist/');
    }

    // Last.fm
    if (hostname === 'www.last.fm' || hostname === 'last.fm') {
      return pathname.startsWith('/user/') && pathname.split('/').filter(Boolean).length >= 2;
    }

    // ListenBrainz
    if (hostname === 'listenbrainz.org') {
      return pathname.startsWith('/user/') && pathname.split('/').filter(Boolean).length >= 2;
    }

    // Pitchfork
    if (hostname === 'pitchfork.com') {
      return pathname.startsWith('/reviews/albums/') || pathname.startsWith('/reviews/tracks/');
    }

    // SoundCloud
    if (hostname === 'soundcloud.com') {
      const segments = pathname.split('/').filter(Boolean);
      if (pathname.includes('/sets/')) return true;
      if (pathname.endsWith('/likes')) return true;
      if (segments.length >= 2 && !['tracks', 'albums', 'sets', 'reposts', 'likes', 'followers', 'following'].includes(segments[1])) return true;
      if (segments.length === 1 || (segments.length >= 2 && segments[1] === 'tracks')) return true;
      return false;
    }

    return false;
  } catch (e) {
    return false;
  }
}

// Unified badge update - handles connection status + page support indicator
function updateBadge() {
  if (!isConnected) {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
  } else if (currentPageSupported) {
    chrome.action.setBadgeText({ text: ' ' });
    chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// Check the currently active tab and update badge accordingly
async function checkCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab && tab.url) {
      currentPageSupported = isSupportedPage(tab.url);
    } else {
      currentPageSupported = false;
    }
    updateBadge();
  } catch (e) {
    // Ignore errors (e.g., no focused window)
  }
}

// Intercept navigation to Spotify/Apple Music URLs
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  // Only intercept main frame navigations (not iframes)
  if (details.frameId !== 0) return;

  // Don't intercept if not connected — the URL would be lost
  if (!isConnected || !port) return;

  const url = details.url;

  // Check Spotify
  if (spotifyInterceptEnabled && isSpotifyContentUrl(url)) {
    console.log('[Parachord] Intercepting Spotify navigation:', url);

    const sent = sendToDesktop({
      type: 'sendToParachord',
      url: url,
      source: 'navigation-intercept'
    });

    // Only close the tab if the message was actually sent
    if (sent) {
      chrome.tabs.remove(details.tabId).catch(() => {});
    }
    return;
  }

  // Check Apple Music
  if (appleMusicInterceptEnabled && isAppleMusicContentUrl(url)) {
    console.log('[Parachord] Intercepting Apple Music navigation:', url);

    const sent = sendToDesktop({
      type: 'sendToParachord',
      url: url,
      source: 'navigation-intercept'
    });

    // Only close the tab if the message was actually sent
    if (sent) {
      chrome.tabs.remove(details.tabId).catch(() => {});
    }
    return;
  }
});

// Start connection when extension loads
connect();

// Also try to connect when service worker wakes up
chrome.runtime.onStartup.addListener(() => {
  connect();
});

// Reconnect on install/update and create context menus
chrome.runtime.onInstalled.addListener(() => {
  connect();
  createContextMenus();
});

// Also create context menus on service worker startup (they persist but this ensures they exist)
createContextMenus();

// Create context menus for supported sites
function createContextMenus() {
  // Remove existing menus first
  chrome.contextMenus.removeAll(() => {
    // Context menu for page (when right-clicking on the page)
    chrome.contextMenus.create({
      id: 'send-page-to-parachord',
      title: 'Send to Parachord',
      contexts: ['page'],
      documentUrlPatterns: [
        'https://open.spotify.com/track/*',
        'https://open.spotify.com/album/*',
        'https://open.spotify.com/playlist/*',
        'https://open.spotify.com/intl-*/track/*',
        'https://open.spotify.com/intl-*/album/*',
        'https://open.spotify.com/intl-*/playlist/*',
        'https://music.apple.com/*/album/*',
        'https://music.apple.com/*/playlist/*',
        'https://www.youtube.com/watch*',
        'https://youtube.com/watch*',
        'https://www.youtube.com/playlist*',
        'https://youtube.com/playlist*',
        'https://*.bandcamp.com/track/*',
        'https://*.bandcamp.com/album/*'
      ]
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('[Parachord] Failed to create page context menu:', chrome.runtime.lastError);
      } else {
        console.log('[Parachord] Page context menu created');
      }
    });

    // Context menu for links (when right-clicking on a link)
    chrome.contextMenus.create({
      id: 'send-link-to-parachord',
      title: 'Send Link to Parachord',
      contexts: ['link'],
      targetUrlPatterns: [
        'https://open.spotify.com/track/*',
        'https://open.spotify.com/album/*',
        'https://open.spotify.com/playlist/*',
        'https://open.spotify.com/intl-*/track/*',
        'https://open.spotify.com/intl-*/album/*',
        'https://open.spotify.com/intl-*/playlist/*',
        'https://music.apple.com/*/album/*',
        'https://music.apple.com/*/playlist/*',
        'https://www.youtube.com/watch*',
        'https://youtube.com/watch*',
        'https://www.youtube.com/playlist*',
        'https://youtube.com/playlist*',
        'https://*.bandcamp.com/track/*',
        'https://*.bandcamp.com/album/*'
      ]
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('[Parachord] Failed to create link context menu:', chrome.runtime.lastError);
      } else {
        console.log('[Parachord] Link context menu created');
      }
    });
  });
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  console.log('[Parachord] Context menu clicked:', info.menuItemId);
  let url = null;

  if (info.menuItemId === 'send-page-to-parachord') {
    url = tab?.url || info.pageUrl;
    console.log('[Parachord] Page URL:', url);
  } else if (info.menuItemId === 'send-link-to-parachord') {
    url = info.linkUrl;
    console.log('[Parachord] Link URL:', url);
  }

  if (url) {
    console.log('[Parachord] Sending URL to desktop:', url);
    const sent = sendToDesktop({
      type: 'sendToParachord',
      url: url,
      source: info.menuItemId === 'send-link-to-parachord' ? 'link' : 'page'
    });
    console.log('[Parachord] Message sent to desktop:', sent ? 'immediately' : 'queued');
  } else {
    console.log('[Parachord] No URL to send');
  }
});

// Keep-alive mechanism using Chrome alarms API
// When connected, the native messaging port keeps the service worker alive.
// The alarm handles reconnection when disconnected.
const KEEP_ALIVE_ALARM = 'parachord-keepalive';

// Set up alarm for keep-alive (fires every 20 seconds)
chrome.alarms.create(KEEP_ALIVE_ALARM, { periodInMinutes: 0.33 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEP_ALIVE_ALARM) {
    // Reconnect if needed
    if (!port || !isConnected) {
      connect();
    } else {
      // Send ping to keep connection alive
      port.postMessage({ type: 'ping' });
    }

    // Re-send heartbeat if we have an active tab
    if (activeTabId && port && isConnected) {
      chrome.tabs.get(activeTabId).then(tab => {
        if (tab && tab.url) {
          let site = 'unknown';
          if (tab.url.includes('youtube.com')) site = 'youtube';
          else if (tab.url.includes('bandcamp.com')) site = 'bandcamp';

          port.postMessage({
            type: 'event',
            event: 'heartbeat',
            site: site,
            tabId: activeTabId,
            url: tab.url
          });
        }
      }).catch(() => {
        activeTabId = null;
      });
    }
  }
});

// --- Page support indicator: tab listeners ---

// Update indicator when user switches tabs
chrome.tabs.onActivated.addListener(() => {
  checkCurrentTab();
});

// Update indicator when a tab navigates to a new URL
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only react to URL changes on the active tab
  if (changeInfo.url && tab.active) {
    currentPageSupported = isSupportedPage(changeInfo.url);
    updateBadge();
  }
});

// Update indicator when switching browser windows
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    checkCurrentTab();
  }
});

// Check current tab on service worker startup
checkCurrentTab();
