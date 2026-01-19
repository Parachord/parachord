// Parachord Browser Extension - Content Script
// Runs on supported music sites (YouTube, Bandcamp, etc.)
// Handles playback control and state reporting

(function() {
  'use strict';

  // Detect which site we're on
  const hostname = window.location.hostname;
  let site = 'unknown';

  if (hostname.includes('youtube.com')) {
    site = 'youtube';
  } else if (hostname.includes('bandcamp.com')) {
    site = 'bandcamp';
  }

  console.log('[Parachord] Content script loaded on:', site);

  // Notify background that we're on a supported page
  chrome.runtime.sendMessage({
    type: 'event',
    event: 'connected',
    site: site,
    url: window.location.href
  }).catch(() => {
    // Background script may not be ready yet, will retry via message queue
  });

  // Get video/audio element based on site
  function getMediaElement() {
    if (site === 'youtube') {
      return document.querySelector('video.html5-main-video');
    } else if (site === 'bandcamp') {
      return document.querySelector('audio');
    }
    return document.querySelector('video') || document.querySelector('audio');
  }

  // Wait for media element to be available
  function waitForMedia(callback, maxAttempts = 50) {
    let attempts = 0;

    function check() {
      const media = getMediaElement();
      if (media) {
        callback(media);
      } else if (attempts < maxAttempts) {
        attempts++;
        setTimeout(check, 200);
      }
    }

    check();
  }

  // Set up media event listeners
  function setupMediaListeners(media) {
    media.addEventListener('play', () => {
      chrome.runtime.sendMessage({
        type: 'event',
        event: 'playing',
        site: site
      }).catch(() => {});
    });

    media.addEventListener('pause', () => {
      chrome.runtime.sendMessage({
        type: 'event',
        event: 'paused',
        site: site
      }).catch(() => {});
    });

    media.addEventListener('ended', () => {
      chrome.runtime.sendMessage({
        type: 'event',
        event: 'ended',
        site: site
      }).catch(() => {});
    });

    // Report initial state if already playing
    if (!media.paused) {
      chrome.runtime.sendMessage({
        type: 'event',
        event: 'playing',
        site: site
      }).catch(() => {});
    }
  }

  // Handle commands from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== 'command') return;

    const media = getMediaElement();

    // First try injected resolver code, then fall back to direct control
    if (window.__parachordControl) {
      if (message.action === 'play' && window.__parachordControl.play) {
        window.__parachordControl.play();
        return;
      } else if (message.action === 'pause' && window.__parachordControl.pause) {
        window.__parachordControl.pause();
        return;
      }
    }

    // Fallback: direct media control
    if (media) {
      if (message.action === 'play') {
        media.play().catch(() => {});
      } else if (message.action === 'pause') {
        media.pause();
      } else if (message.action === 'stop') {
        media.pause();
        media.currentTime = 0;
      }
    }
  });

  // Initialize
  waitForMedia(setupMediaListeners);

  // Also handle dynamic page navigation (SPA)
  let lastUrl = window.location.href;
  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      waitForMedia(setupMediaListeners);

      // Notify about new page
      chrome.runtime.sendMessage({
        type: 'event',
        event: 'connected',
        site: site,
        url: window.location.href
      }).catch(() => {});
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
})();
