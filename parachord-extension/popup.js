// Parachord Browser Extension - Popup Script

document.addEventListener('DOMContentLoaded', async () => {
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const sendUrlBtn = document.getElementById('send-url');
  const sendUrlBtnText = document.getElementById('send-url-text');
  const sendUrlBtnIcon = document.getElementById('send-url-icon');
  const spotifyInterceptToggle = document.getElementById('spotify-intercept');
  const appleMusicInterceptToggle = document.getElementById('applemusic-intercept');

  // Detect page type from URL
  function detectPageType(url) {
    if (!url) return { service: null, type: null };

    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      const pathname = urlObj.pathname;

      // Spotify
      if (hostname === 'open.spotify.com') {
        if (pathname.startsWith('/track/')) return { service: 'spotify', type: 'track' };
        if (pathname.startsWith('/album/')) return { service: 'spotify', type: 'album' };
        if (pathname.startsWith('/playlist/')) return { service: 'spotify', type: 'playlist' };
        if (pathname.startsWith('/artist/')) return { service: 'spotify', type: 'artist' };
        return { service: 'spotify', type: 'unknown' };
      }

      // Apple Music
      if (hostname === 'music.apple.com') {
        if (pathname.includes('/song/')) return { service: 'apple', type: 'track' };
        if (pathname.includes('/album/') && !pathname.includes('?i=')) return { service: 'apple', type: 'album' };
        if (pathname.includes('/album/') && pathname.includes('?i=')) return { service: 'apple', type: 'track' }; // Direct track link
        if (pathname.includes('/playlist/')) return { service: 'apple', type: 'playlist' };
        if (pathname.includes('/artist/')) return { service: 'apple', type: 'artist' };
        return { service: 'apple', type: 'unknown' };
      }

      // YouTube
      if (hostname === 'www.youtube.com' || hostname === 'youtube.com') {
        if (pathname === '/watch') return { service: 'youtube', type: 'video' };
        if (pathname.startsWith('/playlist')) return { service: 'youtube', type: 'playlist' };
        return { service: 'youtube', type: 'unknown' };
      }

      // Bandcamp
      if (hostname.endsWith('.bandcamp.com')) {
        if (pathname.startsWith('/track/')) return { service: 'bandcamp', type: 'track' };
        if (pathname.startsWith('/album/')) return { service: 'bandcamp', type: 'album' };
        return { service: 'bandcamp', type: 'unknown' };
      }

      return { service: null, type: null };
    } catch (e) {
      return { service: null, type: null };
    }
  }

  // Get button text based on page type
  function getButtonConfig(pageInfo) {
    const { service, type } = pageInfo;

    // Track pages for Spotify and Apple Music show "Play Next"
    if ((service === 'spotify' || service === 'apple') && type === 'track') {
      return { text: 'Play Next', icon: 'playNext' };
    }

    // Album pages
    if (type === 'album') {
      return { text: 'Add Album to Queue', icon: 'add' };
    }

    // Playlist pages
    if (type === 'playlist') {
      return { text: 'Add Playlist to Queue', icon: 'add' };
    }

    // Video pages (YouTube)
    if (type === 'video') {
      return { text: 'Add Video to Queue', icon: 'add' };
    }

    // Default
    return { text: 'Add to Queue', icon: 'add' };
  }

  // Update button based on current tab
  async function updateButtonForCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url) return;

      const pageInfo = detectPageType(tab.url);
      const buttonConfig = getButtonConfig(pageInfo);

      sendUrlBtnText.textContent = buttonConfig.text;

      // Update icon
      if (buttonConfig.icon === 'playNext') {
        sendUrlBtnIcon.innerHTML = '<path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>';
      } else {
        sendUrlBtnIcon.innerHTML = '<path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>';
      }
    } catch (e) {
      console.error('[Popup] Failed to update button:', e);
    }
  }

  // Check connection status
  async function updateStatus() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'getStatus' });
      if (response && response.connected) {
        statusDot.classList.add('connected');
        statusText.classList.add('connected');
        statusText.textContent = 'Connected to Parachord';
        sendUrlBtn.disabled = false;
      } else {
        statusDot.classList.remove('connected');
        statusText.classList.remove('connected');
        statusText.textContent = 'Not connected';
        sendUrlBtn.disabled = true;
      }
    } catch (error) {
      console.error('Failed to get status:', error);
      statusDot.classList.remove('connected');
      statusText.classList.remove('connected');
      statusText.textContent = 'Error checking status';
      sendUrlBtn.disabled = true;
    }
  }

  // Send current URL to Parachord
  sendUrlBtn.addEventListener('click', async () => {
    console.log('[Popup] Send button clicked');

    // Visual feedback
    const originalText = sendUrlBtnText.textContent;
    sendUrlBtnText.textContent = 'Sending...';
    sendUrlBtn.disabled = true;

    try {
      // Get current tab URL
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      console.log('[Popup] Current tab:', tab?.url);
      if (!tab || !tab.url) {
        alert('Cannot get current tab URL');
        sendUrlBtnText.textContent = originalText;
        sendUrlBtn.disabled = false;
        return;
      }

      // Send to background script to forward to desktop
      console.log('[Popup] Sending message to background script...');
      const response = await chrome.runtime.sendMessage({
        type: 'sendToParachord',
        url: tab.url,
        source: 'popup'
      });
      console.log('[Popup] Background script response:', response);

      // Show success feedback based on whether it was actually sent
      if (response && response.sent) {
        sendUrlBtnText.textContent = 'Sent!';
        sendUrlBtn.style.background = '#22c55e';
      } else {
        // Message was queued because WebSocket wasn't connected
        sendUrlBtnText.textContent = 'Queued (WS disconnected)';
        sendUrlBtn.style.background = '#f59e0b'; // Orange/yellow
      }

      // Don't auto-close - let user see the result
      // User can click away to close the popup
    } catch (error) {
      console.error('[Popup] Failed to send URL:', error);
      sendUrlBtnText.textContent = 'Error!';
      sendUrlBtn.style.background = '#ef4444';
      setTimeout(() => {
        sendUrlBtnText.textContent = originalText;
        sendUrlBtn.style.background = '';
        sendUrlBtn.disabled = false;
      }, 2000);
    }
  });

  // Initial status check
  updateStatus();

  // Update button based on current page
  updateButtonForCurrentTab();

  // Refresh status every 2 seconds
  setInterval(updateStatus, 2000);

  // Load intercept settings
  chrome.storage.local.get(
    ['spotifyInterceptEnabled', 'appleMusicInterceptEnabled'],
    (result) => {
      // Default to true if not set
      spotifyInterceptToggle.checked = result.spotifyInterceptEnabled !== false;
      appleMusicInterceptToggle.checked = result.appleMusicInterceptEnabled !== false;
    }
  );

  // Save Spotify intercept setting
  spotifyInterceptToggle.addEventListener('change', () => {
    chrome.storage.local.set({
      spotifyInterceptEnabled: spotifyInterceptToggle.checked
    });
    console.log('[Popup] Spotify intercept:', spotifyInterceptToggle.checked);
  });

  // Save Apple Music intercept setting
  appleMusicInterceptToggle.addEventListener('change', () => {
    chrome.storage.local.set({
      appleMusicInterceptEnabled: appleMusicInterceptToggle.checked
    });
    console.log('[Popup] Apple Music intercept:', appleMusicInterceptToggle.checked);
  });
});
