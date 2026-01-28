// Parachord Browser Extension - Content Script
// Runs on supported music sites (YouTube, Bandcamp, etc.)
// Handles playback control and state reporting

(function() {
  'use strict';

  // Detect which site we're on
  const hostname = window.location.hostname;
  const pathname = window.location.pathname;
  let site = 'unknown';

  if (hostname.includes('youtube.com')) {
    site = 'youtube';
  } else if (hostname.includes('bandcamp.com')) {
    site = 'bandcamp';
  }

  console.log('[Parachord] Content script loaded on:', site, 'hostname:', hostname, 'pathname:', pathname);

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

    // For YouTube, the ad skipper handles 'ended' events more intelligently
    // to account for end-of-video ads. For other sites, use the standard handler.
    if (site !== 'youtube') {
      media.addEventListener('ended', () => {
        chrome.runtime.sendMessage({
          type: 'event',
          event: 'ended',
          site: site
        }).catch(() => {});
      });
    }

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
  // Also handles end-of-video ads to ensure proper track advancement
  function setupYouTubeAdSkipper() {
    console.log('[Parachord] Setting up YouTube ad skipper...');

    // Track state for end-of-video detection
    let videoDuration = 0;
    let hasReachedEnd = false;
    let endedEventSent = false;
    let lastVideoSrc = '';

    // Check if an ad is currently playing
    function isAdPlaying() {
      const player = document.querySelector('#movie_player') ||
                     document.querySelector('.html5-video-player');
      if (!player) return false;

      // YouTube adds 'ad-showing' class when an ad is playing
      return player.classList.contains('ad-showing') ||
             player.classList.contains('ad-interrupting') ||
             document.querySelector('.ytp-ad-player-overlay') !== null ||
             document.querySelector('.ytp-ad-player-overlay-instream-info') !== null;
    }

    // Check if video content has truly ended (not an ad)
    function hasVideoContentEnded() {
      const media = document.querySelector('video.html5-main-video');
      if (!media) return false;

      // If we're showing an ad, the video content timing is unreliable
      if (isAdPlaying()) {
        // During ads, check if we previously recorded the video reached its end
        return hasReachedEnd;
      }

      // Video has ended when currentTime is at or very close to duration
      // Use a 1.5 second buffer to account for minor timing differences
      const timeRemaining = media.duration - media.currentTime;
      return media.duration > 0 && timeRemaining < 1.5;
    }

    // Send the ended event to advance to next track
    function sendEndedEvent() {
      if (endedEventSent) return;
      endedEventSent = true;
      console.log('[Parachord] 🎵 Video content ended, sending ended event');
      chrome.runtime.sendMessage({
        type: 'event',
        event: 'ended',
        site: site
      }).catch(() => {});
    }

    // Function to find and click skip button
    function trySkipAd() {
      // YouTube uses various skip button selectors
      const skipButton = document.querySelector('.ytp-skip-ad-button') ||
                         document.querySelector('.ytp-ad-skip-button') ||
                         document.querySelector('.ytp-ad-skip-button-modern') ||
                         document.querySelector('[class*="skip-button"]') ||
                         document.querySelector('button.ytp-ad-skip-button-modern');

      if (skipButton && skipButton.offsetWidth > 0 && skipButton.offsetHeight > 0) { // Check if visible
        console.log('[Parachord] 🚫 Found skip ad button, clicking...');
        skipButton.click();
        return true;
      }

      // Also check for "Skip Ads" text button (newer YouTube UI)
      const skipButtons = document.querySelectorAll('button');
      for (const btn of skipButtons) {
        if (btn.textContent.includes('Skip') && btn.offsetWidth > 0 && btn.offsetHeight > 0) {
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

    // Handle end-of-video ads specifically
    function handleEndOfVideoAd() {
      // If video content has ended and we're showing an ad, this is an end-of-video ad
      if (hasReachedEnd && isAdPlaying()) {
        console.log('[Parachord] 🚫 End-of-video ad detected');

        // Try to skip the ad
        if (trySkipAd()) {
          console.log('[Parachord] ✓ Skipped end-of-video ad');
          return;
        }

        // If we can't skip, send ended event anyway so the queue advances
        // The user doesn't need to watch post-roll ads for Parachord to work
        console.log('[Parachord] Cannot skip end ad, sending ended event to advance queue');
        sendEndedEvent();
      }
    }

    // Monitor video progress to detect when content actually ends
    function setupVideoEndDetection() {
      const media = document.querySelector('video.html5-main-video');
      if (!media) {
        setTimeout(setupVideoEndDetection, 500);
        return;
      }

      // Reset state when video source changes (new video loaded)
      function checkVideoChange() {
        if (media.src !== lastVideoSrc) {
          console.log('[Parachord] New video detected, resetting end detection state');
          lastVideoSrc = media.src;
          hasReachedEnd = false;
          endedEventSent = false;
          videoDuration = 0;
        }
      }

      // Track video duration (excluding ads)
      media.addEventListener('durationchange', () => {
        checkVideoChange();
        // Only update duration when not showing an ad
        if (!isAdPlaying() && media.duration > 0 && isFinite(media.duration)) {
          videoDuration = media.duration;
          console.log('[Parachord] Video duration:', videoDuration);
        }
      });

      // Monitor timeupdate to detect when video content reaches the end
      media.addEventListener('timeupdate', () => {
        checkVideoChange();

        // Skip if we're in an ad
        if (isAdPlaying()) return;

        // Check if video content has reached the end
        if (videoDuration > 0 && media.currentTime >= videoDuration - 1.5) {
          if (!hasReachedEnd) {
            console.log('[Parachord] Video content reached end (currentTime:', media.currentTime, 'duration:', videoDuration, ')');
            hasReachedEnd = true;
          }
        }
      });

      // Also handle the native ended event
      media.addEventListener('ended', () => {
        checkVideoChange();
        console.log('[Parachord] Native ended event fired');
        hasReachedEnd = true;

        // If no ad is playing, send ended event immediately
        if (!isAdPlaying()) {
          sendEndedEvent();
        } else {
          // Ad is playing after video ended - handle it
          console.log('[Parachord] Ad playing after video ended, will try to skip or advance');
          handleEndOfVideoAd();
        }
      });

      // Handle loadedmetadata for initial duration
      media.addEventListener('loadedmetadata', () => {
        checkVideoChange();
        if (!isAdPlaying() && media.duration > 0 && isFinite(media.duration)) {
          videoDuration = media.duration;
        }
      });

      console.log('[Parachord] Video end detection set up');
    }

    // Check periodically for skip button and end-of-video ads
    setInterval(() => {
      trySkipAd();
      // Also check for end-of-video ad state
      if (hasReachedEnd && !endedEventSent) {
        handleEndOfVideoAd();
      }
    }, 500);

    // Also use MutationObserver for faster detection
    const adObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.addedNodes.length) {
          // Check if any added node contains skip button
          setTimeout(trySkipAd, 100); // Small delay for DOM to settle
          break;
        }

        // Check for class changes on the player (ad-showing class)
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          const target = mutation.target;
          if (target.id === 'movie_player' || target.classList.contains('html5-video-player')) {
            // Check if ad state changed
            if (hasReachedEnd && !endedEventSent && !isAdPlaying()) {
              // Ad finished, send ended event
              console.log('[Parachord] Ad finished after video end, sending ended event');
              sendEndedEvent();
            }
          }
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

    // Set up video end detection
    setupVideoEndDetection();

    console.log('[Parachord] YouTube ad skipper active (with end-of-video ad handling)');
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

  // Scrape Bandcamp tracks from the page DOM
  function scrapeBandcampTracks() {
    const tracks = [];
    const pathname = window.location.pathname;

    // Determine page type
    const isTrackPage = pathname.includes('/track/');
    const isAlbumPage = pathname.includes('/album/');
    const isPlaylistPage = pathname.includes('/playlist/');

    console.log('[Parachord] Scraping Bandcamp, page type:', { isTrackPage, isAlbumPage, isPlaylistPage, pathname });

    // Get collection name
    let collectionName = '';
    if (isAlbumPage || isPlaylistPage) {
      const titleEl = document.querySelector('#name-section h2.trackTitle') ||
                      document.querySelector('.playlist-title') ||
                      document.querySelector('h1') ||
                      document.querySelector('#name-section .title');
      if (titleEl) {
        collectionName = titleEl.textContent.trim();
      }
    }

    // Get artist name (used as fallback)
    let pageArtist = '';
    const artistEl = document.querySelector('#name-section h3 span a') ||
                     document.querySelector('#band-name-location .title') ||
                     document.querySelector('span[itemprop="byArtist"] a');
    if (artistEl) {
      pageArtist = artistEl.textContent.trim();
    }

    if (isTrackPage) {
      // Single track page
      const trackTitle = document.querySelector('#name-section h2.trackTitle')?.textContent?.trim() ||
                        document.querySelector('h2.trackTitle')?.textContent?.trim();
      const trackArtist = document.querySelector('#name-section h3 span a')?.textContent?.trim() ||
                         document.querySelector('span[itemprop="byArtist"] a')?.textContent?.trim();
      const albumName = document.querySelector('#name-section h3.albumTitle span a')?.textContent?.trim() || '';
      const durationEl = document.querySelector('.time_total');
      let duration = 0;
      if (durationEl) {
        const match = durationEl.textContent.trim().match(/(\d+):(\d+)/);
        if (match) {
          duration = parseInt(match[1]) * 60 + parseInt(match[2]);
        }
      }

      if (trackTitle && trackArtist) {
        tracks.push({
          title: trackTitle,
          artist: trackArtist,
          album: albumName,
          duration: duration,
          position: 1
        });
      }
    } else if (isAlbumPage) {
      // Album page - get all tracks from the track table
      const trackRows = document.querySelectorAll('#track_table .track_row_view') ||
                       document.querySelectorAll('.track_list .track_row_view') ||
                       document.querySelectorAll('table.track_list tr.track_row_view');

      trackRows.forEach((row, index) => {
        try {
          const titleEl = row.querySelector('.track-title') ||
                         row.querySelector('.title-col .title') ||
                         row.querySelector('span[itemprop="name"]');
          const durationEl = row.querySelector('.time') ||
                            row.querySelector('.track_time');

          if (titleEl) {
            const trackName = titleEl.textContent.trim();
            let duration = 0;
            if (durationEl) {
              const match = durationEl.textContent.trim().match(/(\d+):(\d+)/);
              if (match) {
                duration = parseInt(match[1]) * 60 + parseInt(match[2]);
              }
            }

            if (trackName) {
              tracks.push({
                title: trackName,
                artist: pageArtist,
                album: collectionName,
                duration: duration,
                position: index + 1
              });
            }
          }
        } catch (e) {
          console.error('[Parachord] Error scraping Bandcamp track row:', e);
        }
      });
    } else if (isPlaylistPage) {
      // User playlist page (bandcamp.com/username/playlist/id)

      // First, try to get track URLs from page data (JavaScript variable or inline JSON)
      let trackUrlMap = {}; // Map of track title (lowercase) -> URL

      try {
        // Try to find playlist data in page scripts
        const scripts = document.querySelectorAll('script:not([src])');
        for (const script of scripts) {
          const content = script.textContent;
          // Look for JSON data containing track URLs
          if (content.includes('bandcamp.com/track/')) {
            // Try to extract URLs and titles from the script
            const urlMatches = content.matchAll(/https?:\/\/[^"'\s]+\.bandcamp\.com\/track\/[^"'\s]+/g);
            for (const match of urlMatches) {
              const url = match[0].replace(/[\\'"]/g, '');
              // Extract slug from URL
              const slug = url.split('/track/')[1]?.split(/[?#]/)[0]?.replace(/-/g, ' ') || '';
              if (slug) {
                trackUrlMap[slug.toLowerCase()] = url;
              }
            }
          }
        }
        console.log('[Parachord] Found', Object.keys(trackUrlMap).length, 'track URLs from page scripts');
      } catch (e) {
        console.error('[Parachord] Error extracting URLs from scripts:', e);
      }

      // Try multiple selectors and log what we find
      let playlistItems = document.querySelectorAll('.playlist-track');
      console.log('[Parachord] .playlist-track found:', playlistItems.length);

      if (playlistItems.length === 0) {
        playlistItems = document.querySelectorAll('.collection-item-container');
        console.log('[Parachord] .collection-item-container found:', playlistItems.length);
      }
      if (playlistItems.length === 0) {
        playlistItems = document.querySelectorAll('[class*="playlist"] [class*="track"]');
        console.log('[Parachord] [class*="playlist"] [class*="track"] found:', playlistItems.length);
      }
      if (playlistItems.length === 0) {
        // Try more generic selectors for Bandcamp fan playlists
        playlistItems = document.querySelectorAll('.item-link');
        console.log('[Parachord] .item-link found:', playlistItems.length);
      }
      if (playlistItems.length === 0) {
        playlistItems = document.querySelectorAll('.track-info');
        console.log('[Parachord] .track-info found:', playlistItems.length);
      }

      // Debug: log the page structure
      console.log('[Parachord] Page body classes:', document.body.className);
      console.log('[Parachord] Main content:', document.querySelector('main')?.className || document.querySelector('#content')?.className || 'not found');

      playlistItems.forEach((item, index) => {
        try {
          const titleEl = item.querySelector('.playlist-track-title') ||
                         item.querySelector('.collection-item-title') ||
                         item.querySelector('[class*="title"]');
          const artistEl = item.querySelector('.playlist-track-artist') ||
                          item.querySelector('.collection-item-artist') ||
                          item.querySelector('[class*="artist"]');

          // Try to find Bandcamp track URL - be careful to only use URLs that match the track
          let trackUrl = '';
          const trackTitle = titleEl?.textContent?.trim()?.toLowerCase() || '';

          // Helper to check if a URL likely matches this track
          const urlMatchesTrack = (url) => {
            if (!url || !trackTitle) return false;
            try {
              const urlPath = new URL(url).pathname.toLowerCase();
              // Extract slug from URL path (e.g., /track/browsing-similar-products -> browsing-similar-products)
              const slug = urlPath.split('/track/')[1]?.replace(/-/g, ' ') || '';
              // Check if title words appear in slug or vice versa
              const titleWords = trackTitle.split(/\s+/).filter(w => w.length > 2);
              const slugWords = slug.split(/\s+/).filter(w => w.length > 2);
              const matchCount = titleWords.filter(w => slug.includes(w)).length;
              // Require at least 2 matching words or 50% of title words
              return matchCount >= 2 || matchCount >= titleWords.length * 0.5;
            } catch (e) {
              return false;
            }
          };

          // First, check if the item itself is a link
          if (item.tagName === 'A' && item.href && item.href.includes('/track/')) {
            if (urlMatchesTrack(item.href)) {
              trackUrl = item.href;
            }
          }

          // Then check for direct link children - find all links and check which one matches
          if (!trackUrl) {
            const allLinks = item.querySelectorAll('a[href*="/track/"]');
            for (const linkEl of allLinks) {
              if (linkEl.href && urlMatchesTrack(linkEl.href)) {
                trackUrl = linkEl.href;
                break;
              }
            }
          }

          // Check for data-tralbum-url or similar data attributes
          if (!trackUrl) {
            const urlAttr = item.dataset?.url || item.dataset?.href || item.dataset?.trackUrl;
            if (urlAttr && urlAttr.includes('/track/') && urlMatchesTrack(urlAttr.startsWith('http') ? urlAttr : 'https://' + urlAttr)) {
              trackUrl = urlAttr.startsWith('http') ? urlAttr : 'https://' + urlAttr;
            }
          }

          // Check parent's direct link (but only if parent is a direct wrapper, not a container of many tracks)
          if (!trackUrl && item.parentElement?.tagName === 'A' && item.parentElement.href?.includes('/track/')) {
            if (urlMatchesTrack(item.parentElement.href)) {
              trackUrl = item.parentElement.href;
            }
          }

          // Try to find URL from trackUrlMap (extracted from page scripts)
          if (!trackUrl && trackTitle && Object.keys(trackUrlMap).length > 0) {
            // Convert title to slug-like format and try matching
            const titleSlug = trackTitle.replace(/[^a-z0-9\s]/gi, '').toLowerCase();
            const titleWords = titleSlug.split(/\s+/).filter(w => w.length > 2);

            // Try to find a URL whose slug contains enough matching words
            for (const [slug, url] of Object.entries(trackUrlMap)) {
              const slugWords = slug.split(/\s+/).filter(w => w.length > 2);
              const matchCount = titleWords.filter(w => slug.includes(w)).length;
              // Match if 2+ words match or 50%+ of title words
              if (matchCount >= 2 || (titleWords.length > 0 && matchCount >= titleWords.length * 0.5)) {
                trackUrl = url;
                console.log(`[Parachord] Matched track "${trackTitle}" to URL via script data: ${url}`);
                break;
              }
            }
          }

          // Clean up URL - remove query params like ?from=playlist
          if (trackUrl) {
            try {
              const urlObj = new URL(trackUrl);
              trackUrl = urlObj.origin + urlObj.pathname;
            } catch (e) {
              // Keep as-is if URL parsing fails
            }
          }

          console.log(`[Parachord] Track ${index}: "${titleEl?.textContent?.trim()}" -> URL: ${trackUrl || '(none)'} (title match: ${trackUrl ? 'yes' : 'n/a'})`);

          if (titleEl) {
            const trackName = titleEl.textContent.trim();
            const trackArtist = artistEl ? artistEl.textContent.trim() : '';

            if (trackName && trackArtist) {
              tracks.push({
                title: trackName,
                artist: trackArtist,
                album: '',
                duration: 0,
                position: index + 1,
                url: trackUrl // Include Bandcamp URL if found
              });
            }
          }
        } catch (e) {
          console.error('[Parachord] Error scraping Bandcamp playlist item:', e);
        }
      });
    }

    // Deduplicate tracks by title+artist
    const seen = new Set();
    const uniqueTracks = tracks.filter(track => {
      const key = `${track.title.toLowerCase()}|${track.artist.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Re-number positions after deduplication
    uniqueTracks.forEach((track, i) => track.position = i + 1);

    console.log(`[Parachord] Scraped ${uniqueTracks.length} unique tracks from Bandcamp (${tracks.length} before dedup)`);

    return {
      name: collectionName || (isTrackPage ? uniqueTracks[0]?.title : ''),
      tracks: uniqueTracks,
      url: window.location.href,
      scrapedAt: new Date().toISOString()
    };
  }

  // Listen for scrape requests from popup/background (Bandcamp only)
  if (site === 'bandcamp') {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'scrapePlaylist') {
        console.log('[Parachord] Received scrape request for Bandcamp');
        const result = scrapeBandcampTracks();
        sendResponse(result);
        return true;
      }
    });
  }
})();
