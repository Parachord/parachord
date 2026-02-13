// Parachord Browser Extension - Popup Script

document.addEventListener('DOMContentLoaded', async () => {
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const sendUrlBtn = document.getElementById('send-url');
  const sendUrlBtnText = document.getElementById('send-url-text');
  const sendUrlBtnIcon = document.getElementById('send-url-icon');
  const pageIndicator = document.getElementById('page-indicator');
  const pageIndicatorText = document.getElementById('page-indicator-text');
  const pageIndicatorName = document.getElementById('page-indicator-name');
  const spotifyInterceptToggle = document.getElementById('spotify-intercept');
  const appleMusicInterceptToggle = document.getElementById('applemusic-intercept');

  // Detect page type from URL
  function detectPageType(url) {
    if (!url) return { service: null, type: null };

    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      const pathname = urlObj.pathname;

      // Spotify (use includes to handle /intl-*/ prefix)
      if (hostname === 'open.spotify.com') {
        if (pathname.includes('/track/')) return { service: 'spotify', type: 'track' };
        if (pathname.includes('/album/')) return { service: 'spotify', type: 'album' };
        if (pathname.includes('/playlist/')) return { service: 'spotify', type: 'playlist' };
        if (pathname.includes('/artist/')) return { service: 'spotify', type: 'artist' };
        return { service: 'spotify', type: 'unknown' };
      }

      // Apple Music
      if (hostname === 'music.apple.com') {
        if (pathname.includes('/song/')) return { service: 'apple', type: 'track' };
        if (pathname.includes('/album/') && !pathname.includes('?i=')) return { service: 'apple', type: 'album' };
        if (pathname.includes('/album/') && pathname.includes('?i=')) return { service: 'apple', type: 'track' }; // Direct track link
        if (pathname.includes('/playlist/')) return { service: 'apple', type: 'playlist' };
        if (pathname.includes('/artist/')) return { service: 'apple', type: 'artist' };
        return { service: 'apple', type: 'unknown' };
      }

      // YouTube
      if (hostname === 'www.youtube.com' || hostname === 'youtube.com') {
        if (pathname === '/watch') return { service: 'youtube', type: 'video' };
        if (pathname.startsWith('/playlist')) return { service: 'youtube', type: 'playlist' };
        return { service: 'youtube', type: 'unknown' };
      }

      // Bandcamp (artist subdomains)
      if (hostname.endsWith('.bandcamp.com')) {
        if (pathname.startsWith('/track/')) return { service: 'bandcamp', type: 'track' };
        if (pathname.startsWith('/album/')) return { service: 'bandcamp', type: 'album' };
        return { service: 'bandcamp', type: 'unknown' };
      }

      // Bandcamp user playlists (bandcamp.com/username/playlist/id)
      if (hostname === 'bandcamp.com') {
        if (pathname.includes('/playlist/')) return { service: 'bandcamp', type: 'playlist' };
        return { service: 'bandcamp', type: 'unknown' };
      }

      // Last.fm user profiles (last.fm/user/username)
      if (hostname === 'www.last.fm' || hostname === 'last.fm') {
        if (pathname.startsWith('/user/') && pathname.split('/').filter(Boolean).length >= 2) {
          return { service: 'lastfm', type: 'user' };
        }
        return { service: 'lastfm', type: 'unknown' };
      }

      // ListenBrainz user profiles (listenbrainz.org/user/username)
      if (hostname === 'listenbrainz.org') {
        if (pathname.startsWith('/user/') && pathname.split('/').filter(Boolean).length >= 2) {
          return { service: 'listenbrainz', type: 'user' };
        }
        return { service: 'listenbrainz', type: 'unknown' };
      }

      // Pitchfork reviews
      if (hostname === 'pitchfork.com') {
        if (pathname.startsWith('/reviews/albums/')) return { service: 'pitchfork', type: 'album' };
        if (pathname.startsWith('/reviews/tracks/')) return { service: 'pitchfork', type: 'track' };
        return { service: 'pitchfork', type: 'unknown' };
      }

      // SoundCloud
      if (hostname === 'soundcloud.com') {
        const segments = pathname.split('/').filter(Boolean);
        // Sets (playlists/albums): /artist/sets/name
        if (pathname.includes('/sets/')) return { service: 'soundcloud', type: 'playlist' };
        // Likes: /artist/likes
        if (pathname.endsWith('/likes')) return { service: 'soundcloud', type: 'likes' };
        // Track: /artist/track-name (2 segments, not a special page)
        if (segments.length >= 2 && !['tracks', 'albums', 'sets', 'reposts', 'likes', 'followers', 'following'].includes(segments[1])) {
          return { service: 'soundcloud', type: 'track' };
        }
        // Artist page
        if (segments.length === 1 || segments[1] === 'tracks') {
          return { service: 'soundcloud', type: 'artist' };
        }
        return { service: 'soundcloud', type: 'unknown' };
      }

      return { service: null, type: null };
    } catch (e) {
      return { service: null, type: null };
    }
  }

  // Get button text based on page type
  function getButtonConfig(pageInfo) {
    const { service, type } = pageInfo;

    // User profile pages (Last.fm, ListenBrainz)
    if (type === 'user') {
      return { text: 'Add to Friends', icon: 'addFriend' };
    }

    // Track pages
    if (type === 'track') {
      return { text: 'Play Next', icon: 'playNext' };
    }

    // Album pages
    if (type === 'album') {
      return { text: 'Play Album Next', icon: 'playNext' };
    }

    // Playlist pages
    if (type === 'playlist') {
      return { text: 'Play Playlist Next', icon: 'playNext' };
    }

    // Video pages (YouTube)
    if (type === 'video') {
      return { text: 'Play Next', icon: 'playNext' };
    }

    // Default
    return { text: 'Play Next', icon: 'playNext' };
  }

  // Service name labels
  const SERVICE_NAMES = {
    spotify: 'Spotify',
    apple: 'Apple Music',
    youtube: 'YouTube',
    bandcamp: 'Bandcamp',
    lastfm: 'Last.fm',
    listenbrainz: 'ListenBrainz',
    pitchfork: 'Pitchfork',
    soundcloud: 'SoundCloud'
  };

  // Type labels
  const TYPE_NAMES = {
    track: 'track',
    album: 'album',
    playlist: 'playlist',
    video: 'video',
    artist: 'artist',
    user: 'user profile',
    likes: 'likes'
  };

  // Extract the content name from the browser tab title by stripping service branding
  function extractContentName(tabTitle, pageInfo) {
    if (!tabTitle || !pageInfo.service) return null;

    let name = tabTitle;

    switch (pageInfo.service) {
      case 'spotify':
        // "Song Name - song by Artist | Spotify" → "Song Name - song by Artist"
        name = name.replace(/\s*[|·]\s*Spotify\s*$/i, '');
        break;
      case 'apple':
        // "Album by Artist - Apple Music" → "Album by Artist"
        name = name.replace(/\s*[-–]\s*Apple\s*Music\s*$/i, '');
        break;
      case 'youtube':
        // "Video Title - YouTube" → "Video Title"
        name = name.replace(/\s*[-–]\s*YouTube\s*$/i, '');
        break;
      case 'bandcamp':
        // "Track Name | Artist Name" → "Track Name | Artist Name" (keep artist, it's useful)
        break;
      case 'soundcloud':
        // "Stream Artist - Track by Artist | Listen online for free on SoundCloud"
        name = name.replace(/\s*[|·]\s*(Listen online.*|SoundCloud)\s*$/i, '');
        name = name.replace(/^Stream\s+/i, '');
        break;
      case 'pitchfork':
        // "Artist: Album Album Review | Pitchfork" → "Artist: Album"
        name = name.replace(/\s*[|·]\s*Pitchfork\s*$/i, '');
        name = name.replace(/\s+(Album|Track)\s+Review\s*$/i, '');
        break;
      case 'lastfm':
        // "username's Music Profile – Users at Last.fm" → "username"
        name = name.replace(/['']s\s+Music\s+Profile\s*[-–].*$/i, '');
        break;
      case 'listenbrainz':
        // "username - ListenBrainz" → "username"
        name = name.replace(/\s*[-–]\s*ListenBrainz\s*$/i, '');
        break;
    }

    name = name.trim();
    return name || null;
  }

  // Update page support indicator
  function updatePageIndicator(pageInfo, tabTitle) {
    const { service, type } = pageInfo;

    if (service && type && type !== 'unknown') {
      const serviceName = SERVICE_NAMES[service] || service;
      const typeName = TYPE_NAMES[type] || type;
      pageIndicatorText.textContent = `${serviceName} ${typeName}`;
      pageIndicator.classList.add('visible');
      pageIndicator.classList.remove('unsupported');

      // Show extracted content name
      const contentName = extractContentName(tabTitle, pageInfo);
      if (contentName) {
        pageIndicatorName.textContent = contentName;
        pageIndicatorName.title = contentName;
        pageIndicatorName.classList.add('visible');
      } else {
        pageIndicatorName.classList.remove('visible');
      }
    } else if (service && type === 'unknown') {
      const serviceName = SERVICE_NAMES[service] || service;
      pageIndicatorText.textContent = `${serviceName} page (unsupported type)`;
      pageIndicator.classList.add('visible', 'unsupported');
      pageIndicatorName.classList.remove('visible');
    } else {
      pageIndicator.classList.remove('visible');
      pageIndicatorName.classList.remove('visible');
    }
  }

  // Update button based on current tab
  async function updateButtonForCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url) return;

      const pageInfo = detectPageType(tab.url);
      const buttonConfig = getButtonConfig(pageInfo);

      updatePageIndicator(pageInfo, tab.title);
      sendUrlBtnText.textContent = buttonConfig.text;

      // Update icon
      if (buttonConfig.icon === 'playNext') {
        sendUrlBtnIcon.innerHTML = '<path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>';
      } else if (buttonConfig.icon === 'addFriend') {
        // Person with plus icon
        sendUrlBtnIcon.innerHTML = '<path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>';
      } else {
        sendUrlBtnIcon.innerHTML = '<path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>';
      }
    } catch (e) {
      console.error('[Popup] Failed to update button:', e);
    }
  }

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
    console.log('[Popup] Send button clicked');

    // Visual feedback
    const originalText = sendUrlBtnText.textContent;
    sendUrlBtnText.textContent = 'Sending...';
    sendUrlBtn.disabled = true;

    try {
      // Get current tab URL
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      console.log('[Popup] Current tab:', tab?.url);
      if (!tab || !tab.url) {
        alert('Cannot get current tab URL');
        sendUrlBtnText.textContent = originalText;
        sendUrlBtn.disabled = false;
        return;
      }

      const pageInfo = detectPageType(tab.url);

      // Handle "Add to Friends" for Last.fm and ListenBrainz user profiles
      if (pageInfo.type === 'user' && (pageInfo.service === 'lastfm' || pageInfo.service === 'listenbrainz')) {
        console.log(`[Popup] ${pageInfo.service} user profile detected, sending add friend request...`);
        sendUrlBtnText.textContent = 'Adding...';

        const response = await chrome.runtime.sendMessage({
          type: 'addFriend',
          url: tab.url,
          service: pageInfo.service,
          source: 'popup'
        });
        console.log('[Popup] Background script response:', response);

        if (response && response.sent) {
          sendUrlBtnText.textContent = 'Added!';
          sendUrlBtn.style.background = '#22c55e';
        } else {
          sendUrlBtnText.textContent = 'Queued (WS disconnected)';
          sendUrlBtn.style.background = '#f59e0b';
        }
        return;
      }

      // For Spotify/Apple Music playlists, Bandcamp, Pitchfork, and SoundCloud, scrape the page
      const shouldScrape = (pageInfo.service === 'spotify' && pageInfo.type === 'playlist') ||
                           (pageInfo.service === 'apple' && pageInfo.type === 'playlist') ||
                           (pageInfo.service === 'bandcamp' && ['track', 'album', 'playlist'].includes(pageInfo.type)) ||
                           (pageInfo.service === 'pitchfork' && ['track', 'album'].includes(pageInfo.type)) ||
                           (pageInfo.service === 'soundcloud' && ['track', 'playlist', 'artist', 'likes'].includes(pageInfo.type));

      if (shouldScrape) {
        console.log(`[Popup] ${pageInfo.service} playlist detected, scraping tracks...`);
        sendUrlBtnText.textContent = 'Scraping...';

        try {
          // Request scrape from content script
          const scrapeResult = await chrome.tabs.sendMessage(tab.id, { type: 'scrapePlaylist' });

          if (scrapeResult && scrapeResult.tracks && scrapeResult.tracks.length > 0) {
            console.log('[Popup] Scraped', scrapeResult.tracks.length, 'tracks');

            // Check if this is an album that needs lookup (e.g., Pitchfork album review without tracklist)
            // In this case, the scraper returns a single track with isAlbum: true
            const needsAlbumLookup = scrapeResult.type === 'album' &&
                                     scrapeResult.tracks.length === 1 &&
                                     scrapeResult.tracks[0].isAlbum === true;

            if (needsAlbumLookup) {
              console.log('[Popup] Album needs tracklist lookup:', scrapeResult.artist, '-', scrapeResult.album);
              sendUrlBtnText.textContent = 'Looking up album...';

              // Send album info for MusicBrainz lookup
              const response = await chrome.runtime.sendMessage({
                type: 'sendScrapedAlbum',
                album: {
                  artist: scrapeResult.artist,
                  album: scrapeResult.album,
                  score: scrapeResult.score,
                  url: scrapeResult.url
                },
                source: 'popup-album-scrape'
              });

              if (response && response.sent) {
                sendUrlBtnText.textContent = 'Album sent!';
                sendUrlBtn.style.background = '#22c55e';
              } else {
                sendUrlBtnText.textContent = 'Queued (WS disconnected)';
                sendUrlBtn.style.background = '#f59e0b';
              }
              return;
            }

            // Send scraped playlist to Parachord
            const response = await chrome.runtime.sendMessage({
              type: 'sendScrapedPlaylist',
              playlist: scrapeResult,
              source: 'popup-scrape'
            });

            if (response && response.sent) {
              sendUrlBtnText.textContent = `Sent ${scrapeResult.tracks.length} tracks!`;
              sendUrlBtn.style.background = '#22c55e';
            } else {
              sendUrlBtnText.textContent = 'Queued (WS disconnected)';
              sendUrlBtn.style.background = '#f59e0b';
            }
            return;
          } else {
            console.log('[Popup] Scrape returned no tracks, falling back to URL');
          }
        } catch (scrapeError) {
          // Content script may not be loaded - fall back to URL approach
          console.log('[Popup] Scrape failed (content script may not be loaded), falling back to URL:', scrapeError.message);
        }
      }

      // Default: Send URL to background script to forward to desktop
      console.log('[Popup] Sending message to background script...');
      const response = await chrome.runtime.sendMessage({
        type: 'sendToParachord',
        url: tab.url,
        source: 'popup'
      });
      console.log('[Popup] Background script response:', response);

      // Show success feedback based on whether it was actually sent
      if (response && response.sent) {
        sendUrlBtnText.textContent = 'Sent!';
        sendUrlBtn.style.background = '#22c55e';
      } else {
        // Message was queued because WebSocket wasn't connected
        sendUrlBtnText.textContent = 'Queued (WS disconnected)';
        sendUrlBtn.style.background = '#f59e0b'; // Orange/yellow
      }

      // Don't auto-close - let user see the result
      // User can click away to close the popup
    } catch (error) {
      console.error('[Popup] Failed to send URL:', error);
      sendUrlBtnText.textContent = 'Error!';
      sendUrlBtn.style.background = '#ef4444';
      setTimeout(() => {
        sendUrlBtnText.textContent = originalText;
        sendUrlBtn.style.background = '';
        sendUrlBtn.disabled = false;
      }, 2000);
    }
  });

  // Initial status check
  updateStatus();

  // Update button based on current page
  updateButtonForCurrentTab();

  // Refresh status every 2 seconds
  setInterval(updateStatus, 2000);

  // Load intercept settings
  chrome.storage.local.get(
    ['spotifyInterceptEnabled', 'appleMusicInterceptEnabled'],
    (result) => {
      // Default to true if not set
      spotifyInterceptToggle.checked = result.spotifyInterceptEnabled !== false;
      appleMusicInterceptToggle.checked = result.appleMusicInterceptEnabled !== false;
    }
  );

  // Save Spotify intercept setting
  spotifyInterceptToggle.addEventListener('change', () => {
    chrome.storage.local.set({
      spotifyInterceptEnabled: spotifyInterceptToggle.checked
    });
    console.log('[Popup] Spotify intercept:', spotifyInterceptToggle.checked);
  });

  // Save Apple Music intercept setting
  appleMusicInterceptToggle.addEventListener('change', () => {
    chrome.storage.local.set({
      appleMusicInterceptEnabled: appleMusicInterceptToggle.checked
    });
    console.log('[Popup] Apple Music intercept:', appleMusicInterceptToggle.checked);
  });
});
