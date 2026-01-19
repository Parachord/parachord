// Parachord Browser Extension - Popup Script

document.addEventListener('DOMContentLoaded', async () => {
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const sendUrlBtn = document.getElementById('send-url');

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
    try {
      // Get current tab URL
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url) {
        alert('Cannot get current tab URL');
        return;
      }

      // Send to background script to forward to desktop
      chrome.runtime.sendMessage({
        type: 'resolveUrl',
        url: tab.url
      });

      // Close popup
      window.close();
    } catch (error) {
      console.error('Failed to send URL:', error);
      alert('Failed to send URL to Parachord');
    }
  });

  // Initial status check
  updateStatus();

  // Refresh status every 2 seconds
  setInterval(updateStatus, 2000);
});
