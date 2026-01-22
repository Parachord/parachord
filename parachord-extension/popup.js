// Parachord Browser Extension - Popup Script

document.addEventListener('DOMContentLoaded', async () => {
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const sendUrlBtn = document.getElementById('send-url');
  const spotifyInterceptToggle = document.getElementById('spotify-intercept');
  const appleMusicInterceptToggle = document.getElementById('applemusic-intercept');

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
    const originalText = sendUrlBtn.textContent;
    sendUrlBtn.textContent = 'Sending...';
    sendUrlBtn.disabled = true;

    try {
      // Get current tab URL
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      console.log('[Popup] Current tab:', tab?.url);
      if (!tab || !tab.url) {
        alert('Cannot get current tab URL');
        sendUrlBtn.textContent = originalText;
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
        sendUrlBtn.textContent = 'Sent!';
        sendUrlBtn.style.background = '#22c55e';
      } else {
        // Message was queued because WebSocket wasn't connected
        sendUrlBtn.textContent = 'Queued (WS disconnected)';
        sendUrlBtn.style.background = '#f59e0b'; // Orange/yellow
      }

      // Don't auto-close - let user see the result
      // User can click away to close the popup
    } catch (error) {
      console.error('[Popup] Failed to send URL:', error);
      sendUrlBtn.textContent = 'Error!';
      sendUrlBtn.style.background = '#ef4444';
      setTimeout(() => {
        sendUrlBtn.textContent = originalText;
        sendUrlBtn.style.background = '';
        sendUrlBtn.disabled = false;
      }, 2000);
    }
  });

  // Initial status check
  updateStatus();

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
