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

  // Parse ISO 8601 duration (e.g., "PT3M45S") to seconds
  function parseIsoDuration(isoDuration) {
    if (!isoDuration) return 0;
    const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;
    const hours = parseInt(match[1] || 0);
    const minutes = parseInt(match[2] || 0);
    const seconds = parseInt(match[3] || 0);
    return hours * 3600 + minutes * 60 + seconds;
  }

  // Extract artist name from various JSON-LD formats
  function extractArtistFromJsonLd(obj) {
    if (!obj) return '';
    // byArtist can be: { name: "..." }, "Artist Name", [{ name: "..." }, ...], { "@type": "MusicGroup", "name": "..." }
    const artistProp = obj.byArtist || obj.creator || obj.author;
    if (!artistProp) return '';
    if (typeof artistProp === 'string') return artistProp;
    if (Array.isArray(artistProp)) {
      return artistProp.map(a => (typeof a === 'string' ? a : a.name || '')).filter(Boolean).join(', ');
    }
    return artistProp.name || '';
  }

  // Try to extract tracks from JSON-LD schema (most reliable method)
  function extractFromJsonLd() {
    const tracks = [];
    let collectionName = '';

    try {
      const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');

      for (const script of jsonLdScripts) {
        try {
          const data = JSON.parse(script.textContent);

          // Log first JSON-LD schema type for debugging
          if (tracks.length === 0) {
            console.log('[Parachord] JSON-LD schema type:', data['@type'] || (Array.isArray(data) ? 'Array' : typeof data));
          }

          // Handle MusicPlaylist schema
          if (data['@type'] === 'MusicPlaylist' || data['@type'] === 'MusicAlbum') {
            collectionName = data.name || '';

            if (data.track && Array.isArray(data.track)) {
              // Log first track structure for debugging
              if (data.track.length > 0) {
                const firstItem = data.track[0].item || data.track[0];
                console.log('[Parachord] JSON-LD first track keys:', Object.keys(firstItem).join(', '));
                console.log('[Parachord] JSON-LD first track sample:', JSON.stringify(firstItem).substring(0, 300));
              }

              for (const item of data.track) {
                const track = item.item || item;
                if (track.name) {
                  tracks.push({
                    title: track.name,
                    artist: extractArtistFromJsonLd(track),
                    album: track.inAlbum?.name || collectionName,
                    duration: parseIsoDuration(track.duration),
                    position: tracks.length + 1
                  });
                }
              }
            }
          }

          // Handle array of schemas
          if (Array.isArray(data)) {
            for (const item of data) {
              if (item['@type'] === 'MusicRecording' && item.name) {
                tracks.push({
                  title: item.name,
                  artist: extractArtistFromJsonLd(item),
                  album: item.inAlbum?.name || '',
                  duration: parseIsoDuration(item.duration),
                  position: tracks.length + 1
                });
              }
            }
          }
        } catch (e) {
          // Continue to next script
        }
      }
    } catch (e) {
      console.error('[Parachord] JSON-LD extraction error:', e);
    }

    return { tracks, collectionName };
  }

  // Try to extract artist info from DOM elements and merge with JSON-LD tracks
  function supplementArtistsFromDom(jsonLdTracks) {
    // Collect artist info from visible DOM elements
    // Apple Music renders song-name-wrapper with by-line (artist) for each visible track
    const artistSelectors = [
      '[data-testid="song-name-wrapper"]',
      '.songs-list-row',
      '[data-testid="track-list-item"]',
      '[role="row"]'
    ];

    let rows = [];
    for (const sel of artistSelectors) {
      rows = document.querySelectorAll(sel);
      if (rows.length > 0) {
        console.log(`[Parachord] DOM artist supplement: found ${rows.length} elements via "${sel}"`);
        break;
      }
    }

    if (rows.length === 0) {
      // Try broader approach: find all by-line/artist elements on the page
      const allByLines = document.querySelectorAll(
        '[data-testid="track-title-by-line"], [class*="by-line"], [class*="songs-list-row__by-line"]'
      );
      const allTitles = document.querySelectorAll(
        '[data-testid="track-title"], [class*="song-name"]:not([class*="wrapper"]), a[href*="/song/"]'
      );
      console.log(`[Parachord] DOM artist supplement: found ${allByLines.length} by-lines, ${allTitles.length} titles directly`);

      if (allTitles.length > 0 && allByLines.length > 0) {
        // Build a map of title → artist from paired DOM elements
        const minLen = Math.min(allTitles.length, allByLines.length);
        let matched = 0;
        for (let i = 0; i < minLen && i < jsonLdTracks.length; i++) {
          const domTitle = allTitles[i]?.textContent?.trim();
          const domArtist = allByLines[i]?.textContent?.trim();
          if (domArtist && jsonLdTracks[i] && !jsonLdTracks[i].artist) {
            jsonLdTracks[i].artist = domArtist;
            matched++;
          }
        }
        console.log(`[Parachord] DOM artist supplement: matched ${matched} artists via direct pairing`);
        return;
      }

      console.log('[Parachord] DOM artist supplement: no DOM elements found');
      return;
    }

    // For each row element, try to extract title and artist
    const domTrackInfo = [];
    rows.forEach(row => {
      const titleEl = row.querySelector('[data-testid="track-title"]') ||
                     row.querySelector('[class*="song-name"]:not([class*="wrapper"])') ||
                     row.querySelector('a[href*="/song/"]') ||
                     row.querySelector('[class*="track-name"]');
      const artistEl = row.querySelector('[data-testid="track-title-by-line"]') ||
                      row.querySelector('[class*="by-line"]') ||
                      row.querySelector('[class*="songs-list-row__by-line"]') ||
                      row.querySelector('a[href*="/artist/"]') ||
                      row.querySelector('[data-testid="track-artist"]');
      if (titleEl) {
        domTrackInfo.push({
          title: titleEl.textContent.trim(),
          artist: artistEl ? artistEl.textContent.trim() : ''
        });
      }
    });

    console.log(`[Parachord] DOM artist supplement: extracted ${domTrackInfo.length} DOM entries`);

    // Match DOM artists to JSON-LD tracks by title
    let matched = 0;
    for (const jsonTrack of jsonLdTracks) {
      if (jsonTrack.artist) continue; // already has artist
      const domMatch = domTrackInfo.find(d =>
        d.artist && d.title && (
          d.title === jsonTrack.title ||
          d.title.toLowerCase() === jsonTrack.title.toLowerCase()
        )
      );
      if (domMatch) {
        jsonTrack.artist = domMatch.artist;
        matched++;
      }
    }
    console.log(`[Parachord] DOM artist supplement: matched ${matched} artists by title`);

    // If title matching didn't work well, try positional matching for unmatched tracks
    if (matched < jsonLdTracks.length / 2 && domTrackInfo.length > 0) {
      let positionalMatched = 0;
      for (let i = 0; i < Math.min(jsonLdTracks.length, domTrackInfo.length); i++) {
        if (!jsonLdTracks[i].artist && domTrackInfo[i].artist) {
          jsonLdTracks[i].artist = domTrackInfo[i].artist;
          positionalMatched++;
        }
      }
      console.log(`[Parachord] DOM artist supplement: matched ${positionalMatched} additional artists by position`);
    }
  }

  // Scrape playlist/album tracks from the page DOM
  function scrapePlaylistTracks() {
    // First try JSON-LD extraction (most reliable for track list)
    const jsonLdResult = extractFromJsonLd();
    if (jsonLdResult.tracks.length > 0) {
      // Check if JSON-LD tracks are missing artist info
      const tracksWithArtist = jsonLdResult.tracks.filter(t => t.artist).length;
      console.log(`[Parachord] Extracted ${jsonLdResult.tracks.length} tracks from JSON-LD (${tracksWithArtist} have artist info)`);

      if (tracksWithArtist < jsonLdResult.tracks.length / 2) {
        // Most tracks lack artists - try to supplement from DOM
        console.log('[Parachord] JSON-LD tracks missing artists, supplementing from DOM...');
        supplementArtistsFromDom(jsonLdResult.tracks);
        const afterSupplement = jsonLdResult.tracks.filter(t => t.artist).length;
        console.log(`[Parachord] After DOM supplement: ${afterSupplement}/${jsonLdResult.tracks.length} tracks have artists`);
      }

      return {
        name: jsonLdResult.collectionName,
        tracks: jsonLdResult.tracks,
        url: window.location.href,
        scrapedAt: new Date().toISOString()
      };
    }

    console.log('[Parachord] JSON-LD extraction failed, falling back to DOM scraping');

    const tracks = [];

    // Try to get playlist/album name
    let collectionName = '';
    const titleEl = document.querySelector('[data-testid="non-editorial-shelf-item-title"]') ||
                    document.querySelector('h1.headings__title') ||
                    document.querySelector('.headings h1') ||
                    document.querySelector('h1[class*="product-name"]') ||
                    document.querySelector('h1') ||
                    document.querySelector('[class*="headings"] [class*="title"]');
    if (titleEl) {
      collectionName = titleEl.textContent.trim();
    }

    // Find all track rows - Apple Music uses various patterns
    // Try multiple selectors in order of likelihood
    let trackRows = document.querySelectorAll('.songs-list-row');

    if (trackRows.length === 0) {
      trackRows = document.querySelectorAll('[data-testid="track-list-item"]');
    }
    if (trackRows.length === 0) {
      trackRows = document.querySelectorAll('[class*="songs-list"] [class*="row"]');
    }
    if (trackRows.length === 0) {
      trackRows = document.querySelectorAll('.song-list-item');
    }
    if (trackRows.length === 0) {
      trackRows = document.querySelectorAll('[class*="track-list"] [class*="row"]');
    }
    if (trackRows.length === 0) {
      // Try finding any list items that look like tracks
      trackRows = document.querySelectorAll('[role="row"], [role="listitem"]');
    }

    // Last resort: use song-name-wrappers as row proxies (contains title + artist)
    let usingWrapperAsRow = false;
    if (trackRows.length === 0) {
      trackRows = document.querySelectorAll('[data-testid="song-name-wrapper"]');
      if (trackRows.length > 0) {
        usingWrapperAsRow = true;
        console.log(`[Parachord] Using song-name-wrapper as row proxy (${trackRows.length} found)`);
      }
    }

    console.log(`[Parachord] Found ${trackRows.length} track rows (wrapperAsRow: ${usingWrapperAsRow})`);

    // Log first row's ancestor chain for debugging
    if (trackRows.length > 0 && usingWrapperAsRow) {
      let el = trackRows[0];
      const chain = [];
      for (let i = 0; i < 6 && el; i++) {
        const tag = el.tagName?.toLowerCase() || '?';
        const cls = el.className ? `.${String(el.className).split(' ').slice(0, 2).join('.')}` : '';
        const role = el.getAttribute?.('role') ? `[role=${el.getAttribute('role')}]` : '';
        const testId = el.getAttribute?.('data-testid') ? `[data-testid=${el.getAttribute('data-testid')}]` : '';
        chain.push(`${tag}${cls}${role}${testId}`);
        el = el.parentElement;
      }
      console.log('[Parachord] First row ancestor chain:', chain.join(' > '));
      console.log('[Parachord] First row outerHTML (truncated):', trackRows[0].outerHTML.substring(0, 500));
    }

    trackRows.forEach((row, index) => {
      try {
        // If using wrapper as row, walk up to the actual full row element
        // Try multiple strategies: role="row", songs-list-row class, or walk up several levels
        const fullRow = usingWrapperAsRow ? (
          row.closest('[role="row"]') ||
          row.closest('[class*="songs-list-row"]:not([class*="__"])') ||
          row.parentElement?.parentElement?.parentElement ||
          row.parentElement?.parentElement ||
          row.parentElement ||
          row
        ) : row;

        // Track name - various selectors for different page layouts
        const trackNameEl = row.querySelector('[data-testid="track-title"]') ||
                           row.querySelector('.songs-list-row__song-name') ||
                           row.querySelector('.song-name') ||
                           row.querySelector('[class*="song-name"]:not([class*="wrapper"])') ||
                           row.querySelector('[class*="track-name"]') ||
                           row.querySelector('a[href*="/song/"]') ||
                           row.querySelector('[class*="title"]:not([class*="subtitle"]):not([class*="by-line"])');

        // Artist name(s) - search within wrapper first, then full row (playlist pages
        // show artist in a separate column outside the song-name-wrapper)
        const artistEl = row.querySelector('[data-testid="track-title-by-line"]') ||
                        row.querySelector('.songs-list-row__by-line') ||
                        row.querySelector('[data-testid="track-artist"]') ||
                        row.querySelector('[class*="by-line"]') ||
                        row.querySelector('a[href*="/artist/"]') ||
                        (fullRow !== row && (
                          fullRow.querySelector('[data-testid="track-title-by-line"]') ||
                          fullRow.querySelector('.songs-list-row__by-line') ||
                          fullRow.querySelector('[data-testid="track-artist"]') ||
                          fullRow.querySelector('[class*="artist-name"]') ||
                          fullRow.querySelector('[class*="by-line"]') ||
                          fullRow.querySelector('a[href*="/artist/"]')
                        )) || null;

        // Album name (if available - usually only on playlist pages)
        // Search in the full row context for album/duration which may be outside the wrapper
        const albumEl = fullRow.querySelector('.songs-list-row__album-name') ||
                       fullRow.querySelector('[data-testid="track-album"]') ||
                       fullRow.querySelector('a[href*="/album/"]');

        // Duration
        const durationEl = fullRow.querySelector('.songs-list-row__length') ||
                          fullRow.querySelector('[data-testid="track-duration"]') ||
                          fullRow.querySelector('.song-duration') ||
                          fullRow.querySelector('[class*="duration"]') ||
                          fullRow.querySelector('time');

        if (trackNameEl) {
          const trackName = trackNameEl.textContent.trim();
          const artist = artistEl ? artistEl.textContent.trim() : '';
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

          // Log first few tracks for debugging
          if (index < 3) {
            console.log(`[Parachord] Track ${index + 1}: "${trackName}" by "${artist}" (has title el: ${!!trackNameEl}, has artist el: ${!!artistEl})`);
          }

          // Accept tracks even without artist (some playlist views don't show artist inline)
          if (trackName) {
            tracks.push({
              title: trackName,
              artist: artist,
              album: album,
              duration: duration,
              position: index + 1
            });
          }
        } else if (index < 3) {
          // Log why first few rows failed to extract
          console.log(`[Parachord] Track ${index + 1}: no title element found. Row text: "${row.textContent.trim().substring(0, 100)}"`);
        }
      } catch (e) {
        console.error('[Parachord] Error scraping track row:', e);
      }
    });

    console.log(`[Parachord] Scraped ${tracks.length} tracks from Apple Music DOM`);

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
