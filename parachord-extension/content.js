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

      // Try multiple click approaches
      playButton.click();

      // Try dispatching mouse events (sometimes more effective)
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window
      });
      playButton.dispatchEvent(clickEvent);

      // Also try clicking any child div (Bandcamp sometimes has the listener on child)
      const childDiv = playButton.querySelector('div');
      if (childDiv) {
        childDiv.click();
        childDiv.dispatchEvent(clickEvent);
      }

      // If play button has "busy" class, it means it's trying to load - that's good
      if (playButton.classList.contains('busy')) {
        console.log('[Parachord] Play button is loading (busy state)');
        return true;
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

  // YouTube Ad Skipper - automatically clicks "Skip Ad" button when it appears
  function setupYouTubeAdSkipper() {
    console.log('[Parachord] Setting up YouTube ad skipper...');

    // Function to find and click skip button
    function trySkipAd() {
      // YouTube uses various skip button selectors
      const skipButton = document.querySelector('.ytp-skip-ad-button') ||
                         document.querySelector('.ytp-ad-skip-button') ||
                         document.querySelector('.ytp-ad-skip-button-modern') ||
                         document.querySelector('[class*="skip-button"]') ||
                         document.querySelector('button.ytp-ad-skip-button-modern');

      if (skipButton && skipButton.offsetParent !== null) { // Check if visible
        console.log('[Parachord] 🚫 Found skip ad button, clicking...');
        skipButton.click();
        return true;
      }

      // Also check for "Skip Ads" text button (newer YouTube UI)
      const skipButtons = document.querySelectorAll('button');
      for (const btn of skipButtons) {
        if (btn.textContent.includes('Skip') && btn.offsetParent !== null) {
          const isAdSkip = btn.closest('.ytp-ad-module') ||
                          btn.closest('.video-ads') ||
                          btn.className.includes('ad');
          if (isAdSkip) {
            console.log('[Parachord] 🚫 Found skip button by text, clicking...');
            btn.click();
            return true;
          }
        }
      }

      return false;
    }

    // Check periodically for skip button (ads can appear at any time)
    setInterval(trySkipAd, 500);

    // Also use MutationObserver for faster detection
    const adObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.addedNodes.length) {
          // Check if any added node contains skip button
          setTimeout(trySkipAd, 100); // Small delay for DOM to settle
          break;
        }
      }
    });

    // Observe the player area for changes
    const playerContainer = document.querySelector('#movie_player') ||
                           document.querySelector('.html5-video-player') ||
                           document.body;

    if (playerContainer) {
      adObserver.observe(playerContainer, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style']
      });
    }

    console.log('[Parachord] YouTube ad skipper active');
  }

  // Initialize
  if (site === 'youtube') {
    // Set up ad skipper for YouTube
    if (document.readyState === 'complete') {
      setupYouTubeAdSkipper();
    } else {
      window.addEventListener('load', setupYouTubeAdSkipper);
    }
  } else if (site === 'bandcamp') {
    // For Bandcamp, start auto-play attempt after page is ready
    // The audio element may not exist until play is clicked
    console.log('[Parachord] Bandcamp detected, scheduling auto-play...');

    // Try multiple approaches since timing can vary
    setTimeout(() => {
      console.log('[Parachord] First auto-play attempt (1s)');
      autoPlayBandcamp();
    }, 1000);

    setTimeout(() => {
      console.log('[Parachord] Second auto-play attempt (2s)');
      autoPlayBandcamp();
    }, 2000);

    // Also try when DOM is fully ready
    if (document.readyState === 'complete') {
      console.log('[Parachord] DOM already complete, trying auto-play now');
      setTimeout(() => autoPlayBandcamp(), 100);
    } else {
      window.addEventListener('load', () => {
        console.log('[Parachord] Window load event, trying auto-play');
        setTimeout(() => autoPlayBandcamp(), 500);
      });
    }
  }

  waitForMedia((media) => {
    setupMediaListeners(media);
    console.log('[Parachord] Media element found:', media.tagName);
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
