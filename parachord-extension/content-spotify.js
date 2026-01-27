// Parachord Browser Extension - Spotify Content Script
// Intercepts spotify: protocol links and optionally internal navigation
// to redirect to Parachord instead of opening the Spotify desktop app

(function() {
  'use strict';

  console.log('[Parachord] Spotify content script loaded');

  // Check if interception is enabled (default: true for protocol links)
  let interceptEnabled = true;
  let interceptAllLinks = false; // If true, intercept all track/album/playlist clicks

  // Load settings from storage
  chrome.storage.local.get(['spotifyInterceptEnabled', 'spotifyInterceptAll'], (result) => {
    if (result.spotifyInterceptEnabled !== undefined) {
      interceptEnabled = result.spotifyInterceptEnabled;
    }
    if (result.spotifyInterceptAll !== undefined) {
      interceptAllLinks = result.spotifyInterceptAll;
    }
    console.log('[Parachord] Spotify intercept settings:', { interceptEnabled, interceptAllLinks });
  });

  // Listen for settings changes
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
      if (changes.spotifyInterceptEnabled) {
        interceptEnabled = changes.spotifyInterceptEnabled.newValue;
        console.log('[Parachord] Spotify intercept enabled:', interceptEnabled);
      }
      if (changes.spotifyInterceptAll) {
        interceptAllLinks = changes.spotifyInterceptAll.newValue;
        console.log('[Parachord] Spotify intercept all links:', interceptAllLinks);
      }
    }
  });

  // Send URL to Parachord via background script
  function sendToParachord(url, source = 'intercept') {
    console.log('[Parachord] Intercepted Spotify link:', url);
    chrome.runtime.sendMessage({
      type: 'sendToParachord',
      url: url,
      source: source
    }).catch((err) => {
      console.error('[Parachord] Failed to send to background:', err);
    });
  }

  // Check if a URL is a Spotify content URL we should intercept
  function isSpotifyContentUrl(url) {
    if (!url) return false;

    // Match spotify: URI scheme
    if (url.startsWith('spotify:')) {
      return true;
    }

    // Match open.spotify.com URLs for tracks, albums, playlists
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

  // Check if this is a spotify: protocol URI
  function isSpotifyProtocol(url) {
    return url && url.startsWith('spotify:');
  }

  // Convert spotify: URI to https URL for consistent handling
  function spotifyUriToUrl(uri) {
    // spotify:track:4iV5W9uYEdYUVa79Axb7Rh -> https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh
    const match = uri.match(/^spotify:(track|album|playlist|artist|show|episode):([a-zA-Z0-9]+)$/);
    if (match) {
      return `https://open.spotify.com/${match[1]}/${match[2]}`;
    }
    return uri; // Return as-is if can't convert
  }

  // Main click handler - uses capture phase to intercept before Spotify's handlers
  document.addEventListener('click', (e) => {
    if (!interceptEnabled) return;

    // Find the closest link element
    const link = e.target.closest('a[href]');
    if (!link) return;

    const href = link.href || link.getAttribute('href');
    if (!href) return;

    // Always intercept spotify: protocol links (these open the desktop app)
    if (isSpotifyProtocol(href)) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      // Convert to URL format and send
      const url = spotifyUriToUrl(href);
      sendToParachord(url, 'protocol-intercept');

      // Show visual feedback
      showInterceptFeedback(link);
      return;
    }

    // Optionally intercept all internal navigation links
    if (interceptAllLinks && isSpotifyContentUrl(href)) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      sendToParachord(href, 'link-intercept');
      showInterceptFeedback(link);
      return;
    }
  }, true); // Capture phase

  // Also intercept mousedown to catch right-click context menu triggers
  // and middle-click (which might open in new tab)
  document.addEventListener('auxclick', (e) => {
    if (!interceptEnabled) return;
    if (e.button !== 1) return; // Only middle click

    const link = e.target.closest('a[href]');
    if (!link) return;

    const href = link.href || link.getAttribute('href');
    if (!href) return;

    if (isSpotifyProtocol(href)) {
      e.preventDefault();
      e.stopPropagation();

      const url = spotifyUriToUrl(href);
      sendToParachord(url, 'middle-click-intercept');
      showInterceptFeedback(link);
    }
  }, true);

  // Intercept "Open in Spotify" buttons that might use onclick handlers
  // These often have data attributes or specific classes
  function setupOpenInSpotifyInterception() {
    // Look for "Open in Spotify" type buttons
    const observer = new MutationObserver((mutations) => {
      // Look for buttons/links that open the desktop app
      const openButtons = document.querySelectorAll(
        '[data-testid="play-button-or-resume"], ' +
        'button[aria-label*="Play"], ' +
        'a[href^="spotify:"]'
      );

      openButtons.forEach(button => {
        if (button.dataset.parachordIntercepted) return;
        button.dataset.parachordIntercepted = 'true';

        // Add our click handler with higher priority
        button.addEventListener('click', (e) => {
          if (!interceptEnabled) return;

          // Check for spotify: href
          const href = button.href || button.getAttribute('href');
          if (href && isSpotifyProtocol(href)) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            const url = spotifyUriToUrl(href);
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
    // Create a brief visual indicator
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
    document.addEventListener('DOMContentLoaded', setupOpenInSpotifyInterception);
  } else {
    setupOpenInSpotifyInterception();
  }

  // Notify that we're active on this page
  chrome.runtime.sendMessage({
    type: 'event',
    event: 'interceptorActive',
    site: 'spotify',
    url: window.location.href
  }).catch(() => {});

  // Scrape playlist/album tracks from the page DOM
  // This is used as a fallback when the Spotify API returns 404 (editorial playlists)
  function scrapePlaylistTracks() {
    const tracks = [];

    // Try to get playlist/album name
    let collectionName = '';
    const titleEl = document.querySelector('[data-testid="entityTitle"] h1') ||
                    document.querySelector('h1[data-encore-id="text"]') ||
                    document.querySelector('span[data-testid="entityTitle"]');
    if (titleEl) {
      collectionName = titleEl.textContent.trim();
    }

    // Find all track rows - Spotify uses data-testid="tracklist-row"
    const trackRows = document.querySelectorAll('[data-testid="tracklist-row"]');

    trackRows.forEach((row, index) => {
      try {
        // Track name - usually in a link with specific data-testid
        const trackNameEl = row.querySelector('[data-testid="internal-track-link"] div') ||
                           row.querySelector('a[href*="/track/"] div') ||
                           row.querySelector('[data-testid="internal-track-link"]');

        // Artist name(s) - usually in span or link elements after the track name
        const artistEls = row.querySelectorAll('a[href*="/artist/"]');

        // Album name - in link to album
        const albumEl = row.querySelector('a[href*="/album/"]');

        // Duration - usually in a specific column
        const durationEl = row.querySelector('[data-testid="tracklist-duration"]') ||
                          row.querySelector('div[aria-label*="duration"]');

        if (trackNameEl) {
          const trackName = trackNameEl.textContent.trim();
          const artists = Array.from(artistEls).map(a => a.textContent.trim()).join(', ');
          const album = albumEl ? albumEl.textContent.trim() : '';

          // Parse duration if available (format: "3:45")
          let duration = 0;
          if (durationEl) {
            const durationText = durationEl.textContent.trim();
            const match = durationText.match(/(\d+):(\d+)/);
            if (match) {
              duration = parseInt(match[1]) * 60 + parseInt(match[2]);
            }
          }

          if (trackName && artists) {
            tracks.push({
              title: trackName,
              artist: artists,
              album: album,
              duration: duration,
              position: index + 1
            });
          }
        }
      } catch (e) {
        console.error('[Parachord] Error scraping track row:', e);
      }
    });

    console.log(`[Parachord] Scraped ${tracks.length} tracks from playlist`);

    return {
      name: collectionName,
      tracks: tracks,
      url: window.location.href,
      scrapedAt: new Date().toISOString()
    };
  }

  // Listen for scrape requests from popup/background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'scrapePlaylist') {
      console.log('[Parachord] Received scrape request');
      const result = scrapePlaylistTracks();
      sendResponse(result);
      return true;
    }
  });

})();
