// Parachord Browser Extension - Apple Music Content Script
// Intercepts music:/itmss: protocol links and optionally internal navigation
// to redirect to Parachord instead of opening the Apple Music app

(function() {
  'use strict';

  console.log('[Parachord] Apple Music content script loaded');

  // Check if interception is enabled (default: true for protocol links)
  let interceptEnabled = true;
  let interceptAllLinks = false; // If true, intercept all track/album/playlist clicks

  // Load settings from storage
  chrome.storage.local.get(['appleMusicInterceptEnabled', 'appleMusicInterceptAll'], (result) => {
    if (result.appleMusicInterceptEnabled !== undefined) {
      interceptEnabled = result.appleMusicInterceptEnabled;
    }
    if (result.appleMusicInterceptAll !== undefined) {
      interceptAllLinks = result.appleMusicInterceptAll;
    }
    console.log('[Parachord] Apple Music intercept settings:', { interceptEnabled, interceptAllLinks });
  });

  // Listen for settings changes
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
      if (changes.appleMusicInterceptEnabled) {
        interceptEnabled = changes.appleMusicInterceptEnabled.newValue;
        console.log('[Parachord] Apple Music intercept enabled:', interceptEnabled);
      }
      if (changes.appleMusicInterceptAll) {
        interceptAllLinks = changes.appleMusicInterceptAll.newValue;
        console.log('[Parachord] Apple Music intercept all links:', interceptAllLinks);
      }
    }
  });

  // Send URL to Parachord via background script
  function sendToParachord(url, source = 'intercept') {
    console.log('[Parachord] Intercepted Apple Music link:', url);
    chrome.runtime.sendMessage({
      type: 'sendToParachord',
      url: url,
      source: source
    }).catch((err) => {
      console.error('[Parachord] Failed to send to background:', err);
    });
  }

  // Apple Music protocol schemes
  const APPLE_MUSIC_PROTOCOLS = [
    'music:',
    'musics:',
    'itms:',
    'itmss:',
    'itunes:',
    'itunesradio:',
    'itsradio:'
  ];

  // Check if a URL uses an Apple Music protocol
  function isAppleMusicProtocol(url) {
    if (!url) return false;
    return APPLE_MUSIC_PROTOCOLS.some(protocol => url.startsWith(protocol));
  }

  // Check if a URL is an Apple Music content URL we should intercept
  function isAppleMusicContentUrl(url) {
    if (!url) return false;

    // Match Apple Music protocol schemes
    if (isAppleMusicProtocol(url)) {
      return true;
    }

    // Match music.apple.com URLs for albums, playlists, songs
    const patterns = [
      /music\.apple\.com\/[^/]+\/album\//,
      /music\.apple\.com\/[^/]+\/playlist\//,
      /music\.apple\.com\/[^/]+\/song\//,
      /music\.apple\.com\/[^/]+\/artist\//,
      /music\.apple\.com\/[^/]+\/station\//
    ];

    return patterns.some(pattern => pattern.test(url));
  }

  // Convert Apple Music protocol URL to https URL for consistent handling
  function appleMusicProtocolToUrl(protocolUrl) {
    // music://music.apple.com/us/album/... -> https://music.apple.com/us/album/...
    // itmss://music.apple.com/... -> https://music.apple.com/...

    for (const protocol of APPLE_MUSIC_PROTOCOLS) {
      if (protocolUrl.startsWith(protocol)) {
        let path = protocolUrl.slice(protocol.length);
        // Remove leading slashes
        path = path.replace(/^\/+/, '');

        // If it starts with music.apple.com, use https
        if (path.startsWith('music.apple.com')) {
          return 'https://' + path;
        }

        // Otherwise, prepend the domain
        return 'https://music.apple.com/' + path;
      }
    }

    return protocolUrl; // Return as-is if can't convert
  }

  // Main click handler - uses capture phase to intercept before Apple's handlers
  document.addEventListener('click', (e) => {
    if (!interceptEnabled) return;

    // Find the closest link element
    const link = e.target.closest('a[href]');
    if (!link) return;

    const href = link.href || link.getAttribute('href');
    if (!href) return;

    // Always intercept Apple Music protocol links (these open the desktop app)
    if (isAppleMusicProtocol(href)) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      // Convert to URL format and send
      const url = appleMusicProtocolToUrl(href);
      sendToParachord(url, 'protocol-intercept');

      // Show visual feedback
      showInterceptFeedback(link);
      return;
    }

    // Optionally intercept all internal navigation links
    if (interceptAllLinks && isAppleMusicContentUrl(href)) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      sendToParachord(href, 'link-intercept');
      showInterceptFeedback(link);
      return;
    }
  }, true); // Capture phase

  // Also intercept middle-click
  document.addEventListener('auxclick', (e) => {
    if (!interceptEnabled) return;
    if (e.button !== 1) return; // Only middle click

    const link = e.target.closest('a[href]');
    if (!link) return;

    const href = link.href || link.getAttribute('href');
    if (!href) return;

    if (isAppleMusicProtocol(href)) {
      e.preventDefault();
      e.stopPropagation();

      const url = appleMusicProtocolToUrl(href);
      sendToParachord(url, 'middle-click-intercept');
      showInterceptFeedback(link);
    }
  }, true);

  // Intercept "Open in Music" or "Listen in Apple Music" buttons
  function setupOpenInMusicInterception() {
    const observer = new MutationObserver((mutations) => {
      // Look for buttons/links that open the Music app
      // Apple Music uses various button patterns
      const openButtons = document.querySelectorAll(
        'a[href^="music:"], ' +
        'a[href^="musics:"], ' +
        'a[href^="itms:"], ' +
        'a[href^="itmss:"], ' +
        '[data-testid*="open-in-app"], ' +
        'button[aria-label*="Open in"], ' +
        'button[aria-label*="Listen in"]'
      );

      openButtons.forEach(button => {
        if (button.dataset.parachordIntercepted) return;
        button.dataset.parachordIntercepted = 'true';

        button.addEventListener('click', (e) => {
          if (!interceptEnabled) return;

          const href = button.href || button.getAttribute('href');
          if (href && isAppleMusicProtocol(href)) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            const url = appleMusicProtocolToUrl(href);
            sendToParachord(url, 'button-intercept');
            showInterceptFeedback(button);
          }
        }, true);
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Visual feedback when a link is intercepted
  function showInterceptFeedback(element) {
    const originalBg = element.style.backgroundColor;
    const originalTransition = element.style.transition;

    element.style.transition = 'background-color 0.2s';
    element.style.backgroundColor = 'rgba(34, 197, 94, 0.3)'; // Green flash

    setTimeout(() => {
      element.style.backgroundColor = originalBg;
      setTimeout(() => {
        element.style.transition = originalTransition;
      }, 200);
    }, 300);
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupOpenInMusicInterception);
  } else {
    setupOpenInMusicInterception();
  }

  // Notify that we're active on this page
  chrome.runtime.sendMessage({
    type: 'event',
    event: 'interceptorActive',
    site: 'applemusic',
    url: window.location.href
  }).catch(() => {});

})();
