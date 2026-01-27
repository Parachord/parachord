// Parachord Browser Extension - SoundCloud Content Script
// Scrapes tracks, playlists/sets, and albums

(function() {
  'use strict';

  console.log('[Parachord] SoundCloud content script loaded');

  // Determine page type from URL
  function getPageType() {
    const path = window.location.pathname;

    // Sets (playlists/albums): /artist/sets/name
    if (path.includes('/sets/')) return 'playlist';

    // Likes page: /artist/likes
    if (path.endsWith('/likes')) return 'likes';

    // Reposts page: /artist/reposts
    if (path.endsWith('/reposts')) return 'reposts';

    // Track pages: /artist/track-name (but not /artist or /artist/)
    const segments = path.split('/').filter(Boolean);
    if (segments.length >= 2 && !['tracks', 'albums', 'sets', 'reposts', 'likes', 'followers', 'following'].includes(segments[1])) {
      return 'track';
    }

    // Artist page with tracks
    if (segments.length === 1 || (segments.length === 2 && segments[1] === 'tracks')) {
      return 'artist';
    }

    return 'unknown';
  }

  // Try multiple selectors and return first match
  function queryFirst(selectors) {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  // Extract text from element
  function extractText(selectors) {
    const el = queryFirst(selectors);
    return el ? el.textContent.trim() : '';
  }

  // Parse duration string (e.g., "3:45" or "1:23:45") to seconds
  function parseDuration(durationStr) {
    if (!durationStr) return 0;
    const parts = durationStr.split(':').map(p => parseInt(p, 10));
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    return 0;
  }

  // Scrape a single track page
  function scrapeTrack() {
    // Artist name selectors
    const artistSelectors = [
      'a[class*="profileHovercard"]',
      '.soundTitle__username',
      'a[href^="/"][class*="Avatar"] + a',
      '.soundContext__usernameLink',
      'span[class*="SoundTitle__username"]',
      'a.sc-link-primary[href^="/"]'
    ];

    // Track title selectors
    const titleSelectors = [
      'span[class*="SoundTitle__title"]',
      '.soundTitle__title',
      'h1[class*="soundTitle"]',
      '.fullHero__title'
    ];

    // Duration selectors
    const durationSelectors = [
      'span[class*="Duration"]',
      '.playbackTimeline__duration',
      'time[class*="duration"]'
    ];

    const artist = extractText(artistSelectors);
    const title = extractText(titleSelectors);
    const durationStr = extractText(durationSelectors);
    const duration = parseDuration(durationStr);

    console.log(`[Parachord] Scraped SoundCloud track: ${artist} - ${title}`);

    return {
      type: 'track',
      name: `${artist} - ${title}`,
      tracks: [{
        title: title,
        artist: artist,
        duration: duration,
        url: window.location.href
      }],
      url: window.location.href,
      scrapedAt: new Date().toISOString()
    };
  }

  // Scrape a playlist/set/album page
  function scrapePlaylist() {
    const tracks = [];

    // Playlist/set title selectors
    const playlistTitleSelectors = [
      'span[class*="SoundTitle__title"]',
      '.soundTitle__title',
      'h1[class*="soundTitle"]'
    ];

    // Playlist owner selectors
    const ownerSelectors = [
      'a[class*="profileHovercard"]',
      '.soundTitle__username',
      'a.sc-link-primary[href^="/"]'
    ];

    const playlistName = extractText(playlistTitleSelectors);
    const owner = extractText(ownerSelectors);

    // Track item selectors - SoundCloud uses various patterns
    const trackItemSelectors = [
      '.trackList__item',
      '.soundList__item',
      '[class*="TrackList"] li',
      '.compactTrackList__item'
    ];

    for (const selector of trackItemSelectors) {
      const trackEls = document.querySelectorAll(selector);
      if (trackEls.length > 0) {
        trackEls.forEach((el, index) => {
          // Track title within item
          const titleEl = el.querySelector('.trackItem__trackTitle, .soundTitle__title, a[class*="trackItem__link"], [class*="TrackItem__title"]');
          // Artist within item
          const artistEl = el.querySelector('.trackItem__username, .soundTitle__username, a[class*="TrackItem__user"]');
          // Duration within item
          const durationEl = el.querySelector('.trackItem__duration, [class*="Duration"]');

          const trackTitle = titleEl ? titleEl.textContent.trim() : '';
          const trackArtist = artistEl ? artistEl.textContent.trim() : owner;
          const durationStr = durationEl ? durationEl.textContent.trim() : '';

          if (trackTitle) {
            tracks.push({
              title: trackTitle,
              artist: trackArtist,
              duration: parseDuration(durationStr),
              position: index + 1
            });
          }
        });
        break;
      }
    }

    // Fallback: try to get tracks from compact list
    if (tracks.length === 0) {
      const compactItems = document.querySelectorAll('.compactTrackListItem, .compactTrackList__item');
      compactItems.forEach((el, index) => {
        const link = el.querySelector('a');
        if (link) {
          const text = link.textContent.trim();
          // Often format is "Artist - Title" or just "Title"
          const parts = text.split(' - ');
          if (parts.length >= 2) {
            tracks.push({
              title: parts.slice(1).join(' - '),
              artist: parts[0],
              position: index + 1
            });
          } else {
            tracks.push({
              title: text,
              artist: owner,
              position: index + 1
            });
          }
        }
      });
    }

    console.log(`[Parachord] Scraped SoundCloud playlist: ${playlistName} (${tracks.length} tracks)`);

    return {
      type: 'playlist',
      name: playlistName || 'SoundCloud Playlist',
      owner: owner,
      tracks: tracks,
      url: window.location.href,
      scrapedAt: new Date().toISOString()
    };
  }

  // Scrape tracks from artist page, likes, or reposts
  function scrapeTrackList() {
    const tracks = [];

    // Get the page context (artist name for likes/reposts)
    const artistSelectors = [
      'h2[class*="profileHeader__title"]',
      '.profileHeaderInfo__userName',
      'h1'
    ];
    const pageArtist = extractText(artistSelectors);

    // Sound items on the page
    const soundItemSelectors = [
      '.soundList__item',
      '.userStreamItem',
      '[class*="SoundCard"]',
      '.sound__content'
    ];

    for (const selector of soundItemSelectors) {
      const items = document.querySelectorAll(selector);
      if (items.length > 0) {
        items.forEach((el, index) => {
          const titleEl = el.querySelector('.soundTitle__title, [class*="SoundTitle__title"], a[class*="sound__coverArt"]');
          const artistEl = el.querySelector('.soundTitle__username, [class*="SoundTitle__username"]');
          const durationEl = el.querySelector('[class*="Duration"]');

          const title = titleEl ? titleEl.textContent.trim() : '';
          const artist = artistEl ? artistEl.textContent.trim() : pageArtist;
          const durationStr = durationEl ? durationEl.textContent.trim() : '';

          if (title) {
            tracks.push({
              title: title,
              artist: artist,
              duration: parseDuration(durationStr),
              position: index + 1
            });
          }
        });
        break;
      }
    }

    const pageType = getPageType();
    let listName = pageArtist || 'SoundCloud';
    if (pageType === 'likes') listName += ' Likes';
    else if (pageType === 'reposts') listName += ' Reposts';
    else listName += ' Tracks';

    console.log(`[Parachord] Scraped SoundCloud ${pageType}: ${tracks.length} tracks`);

    return {
      type: pageType,
      name: listName,
      tracks: tracks,
      url: window.location.href,
      scrapedAt: new Date().toISOString()
    };
  }

  // Main scrape function
  function scrape() {
    const pageType = getPageType();

    switch (pageType) {
      case 'track':
        return scrapeTrack();
      case 'playlist':
        return scrapePlaylist();
      case 'artist':
      case 'likes':
      case 'reposts':
        return scrapeTrackList();
      default:
        console.log('[Parachord] Unknown SoundCloud page type');
        return null;
    }
  }

  // Listen for scrape requests from popup/background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'scrapePlaylist' || message.type === 'scrapeSoundCloud') {
      console.log('[Parachord] Received scrape request for SoundCloud');
      const result = scrape();
      sendResponse(result);
      return true;
    }
  });

})();
