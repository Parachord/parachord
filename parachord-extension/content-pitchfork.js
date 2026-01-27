// Parachord Browser Extension - Pitchfork Content Script
// Scrapes album and track review pages

(function() {
  'use strict';

  console.log('[Parachord] Pitchfork content script loaded');

  // Determine if this is an album or track review
  function getReviewType() {
    const path = window.location.pathname;
    if (path.includes('/reviews/albums/')) return 'album';
    if (path.includes('/reviews/tracks/')) return 'track';
    return null;
  }

  // Try multiple selectors and return first match
  function queryFirst(selectors) {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  // Extract text from element, trying multiple selectors
  function extractText(selectors) {
    const el = queryFirst(selectors);
    return el ? el.textContent.trim() : '';
  }

  // Scrape album review page
  function scrapeAlbumReview() {
    // Artist name selectors (Pitchfork has changed their design several times)
    const artistSelectors = [
      '[class*="ArtistLink"]',
      '[class*="artist-link"]',
      '.review-detail__artist-links a',
      '[data-testid="artist-links"] a',
      'h2[class*="Artist"]',
      '.artist-links a',
      'ul[class*="ArtistLinks"] a',
      '[class*="SplitScreenContentHeaderArtist"] a',
      'a[href*="/artists/"]'
    ];

    // Album title selectors
    const albumSelectors = [
      '[class*="SplitScreenContentHeaderHed"]',
      '[data-testid="review-heading"]',
      'h1[class*="AlbumTitle"]',
      '.review-detail__title',
      'h1[class*="Heading"]',
      '.single-album-tombstone__review-title'
    ];

    // Score selectors
    const scoreSelectors = [
      '[class*="Rating"]',
      '[class*="score"]',
      '.score',
      '[data-testid="review-score"]'
    ];

    const artist = extractText(artistSelectors);
    const album = extractText(albumSelectors);
    const scoreEl = queryFirst(scoreSelectors);
    const score = scoreEl ? scoreEl.textContent.trim() : '';

    // Try to find track listing (some album reviews include it)
    const tracks = [];
    const trackListSelectors = [
      '[class*="TrackList"] li',
      '.tracklist li',
      '[class*="track-list"] li',
      'ol[class*="Track"] li'
    ];

    for (const selector of trackListSelectors) {
      const trackEls = document.querySelectorAll(selector);
      if (trackEls.length > 0) {
        trackEls.forEach((el, index) => {
          const title = el.textContent.trim();
          if (title) {
            tracks.push({
              title: title,
              artist: artist,
              album: album,
              position: index + 1
            });
          }
        });
        break;
      }
    }

    // If no track list found, create a single entry for the album
    if (tracks.length === 0 && artist && album) {
      tracks.push({
        title: album,
        artist: artist,
        album: album,
        isAlbum: true
      });
    }

    console.log(`[Parachord] Scraped Pitchfork album review: ${artist} - ${album} (${tracks.length} tracks, score: ${score})`);

    return {
      type: 'album',
      name: `${artist} - ${album}`,
      artist: artist,
      album: album,
      score: score,
      tracks: tracks,
      url: window.location.href,
      scrapedAt: new Date().toISOString()
    };
  }

  // Scrape track review page
  function scrapeTrackReview() {
    // For track reviews, the format is often "Artist: Track Title" or separate elements
    const artistSelectors = [
      '[class*="ArtistLink"]',
      '[class*="artist-link"]',
      'a[href*="/artists/"]',
      '[class*="SplitScreenContentHeaderArtist"] a',
      '.review-detail__artist-links a'
    ];

    const trackSelectors = [
      '[class*="SplitScreenContentHeaderHed"]',
      '[data-testid="review-heading"]',
      'h1[class*="Title"]',
      '.review-detail__title',
      'h1[class*="Heading"]'
    ];

    let artist = extractText(artistSelectors);
    let track = extractText(trackSelectors);

    // Sometimes the title includes both artist and track as "Artist: Track"
    if (!artist && track.includes(':')) {
      const parts = track.split(':');
      artist = parts[0].trim();
      track = parts.slice(1).join(':').trim();
    }

    // Also try to extract from the URL slug as fallback
    if (!artist || !track) {
      const pathMatch = window.location.pathname.match(/\/reviews\/tracks\/([^/]+)/);
      if (pathMatch) {
        const slug = pathMatch[1];
        // Slug format is typically: artist-name-track-title
        // This is imperfect but better than nothing
        console.log(`[Parachord] Falling back to URL slug: ${slug}`);
      }
    }

    console.log(`[Parachord] Scraped Pitchfork track review: ${artist} - ${track}`);

    return {
      type: 'track',
      name: `${artist} - ${track}`,
      tracks: [{
        title: track,
        artist: artist
      }],
      url: window.location.href,
      scrapedAt: new Date().toISOString()
    };
  }

  // Main scrape function
  function scrape() {
    const reviewType = getReviewType();

    if (reviewType === 'album') {
      return scrapeAlbumReview();
    } else if (reviewType === 'track') {
      return scrapeTrackReview();
    }

    return null;
  }

  // Listen for scrape requests from popup/background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'scrapePlaylist' || message.type === 'scrapePitchfork') {
      console.log('[Parachord] Received scrape request for Pitchfork');
      const result = scrape();
      sendResponse(result);
      return true;
    }
  });

})();
