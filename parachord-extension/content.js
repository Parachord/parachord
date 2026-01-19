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

  // Auto-play for Bandcamp tracks
  function autoPlayBandcamp(retryCount = 0) {
    console.log('[Parachord] Attempting Bandcamp auto-play, attempt:', retryCount + 1);

    // Bandcamp has several play button variants:
    // 1. Big play button on track/album pages: .playbutton or .play-btn inside inline_player
    // 2. The play button is often a div inside an anchor with role="button"
    const playButton = document.querySelector('.inline_player .playbutton') ||
                       document.querySelector('.inline_player .play-btn') ||
                       document.querySelector('.playbutton') ||
                       document.querySelector('.play_button.playing') || // Already has playing class but paused
                       document.querySelector('.play_button') ||
                       document.querySelector('[role="button"][aria-label*="Play"]') ||
                       document.querySelector('.play-btn') ||
                       document.querySelector('a.play-button') ||
                       document.querySelector('button.play');

    if (playButton) {
      console.log('[Parachord] Found Bandcamp play button:', playButton.className);
      playButton.click();

      // Also try clicking any child div (Bandcamp sometimes has the listener on child)
      const childDiv = playButton.querySelector('div');
      if (childDiv) {
        childDiv.click();
      }
      return true;
    }

    // Try the big album art play overlay
    const bigPlayButton = document.querySelector('.play-button') ||
                          document.querySelector('.tralbum-play-button') ||
                          document.querySelector('#big_play_button');
    if (bigPlayButton) {
      console.log('[Parachord] Found Bandcamp big play button');
      bigPlayButton.click();
      return true;
    }

    // Fallback: try to play the audio element directly
    const audio = document.querySelector('audio');
    if (audio && audio.src) {
      console.log('[Parachord] Auto-playing Bandcamp audio element directly');
      audio.play().catch(err => {
        console.log('[Parachord] Auto-play blocked:', err.message);
      });
      return true;
    }

    // Retry a few times since Bandcamp loads dynamically
    if (retryCount < 5) {
      setTimeout(() => autoPlayBandcamp(retryCount + 1), 500);
    } else {
      console.log('[Parachord] Could not find Bandcamp play button after retries');
    }

    return false;
  }

  // Initialize
  if (site === 'bandcamp') {
    // For Bandcamp, start auto-play attempt immediately and also after media loads
    // The audio element may not exist until play is clicked
    setTimeout(() => autoPlayBandcamp(), 1000);
  }

  waitForMedia((media) => {
    setupMediaListeners(media);
  });

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
