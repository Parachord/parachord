#!/usr/bin/env node
/**
 * Parachord Link Generator
 *
 * Generates smart link pages that:
 * 1. Connect to Parachord for full playback (when installed)
 * 2. Fall back to multi-service links (when not installed)
 *
 * If Parachord is running, resolves actual track links via resolvers.
 * Otherwise, falls back to search URLs.
 *
 * Usage:
 *   node generate-link.js <spotify-url> [output-file]
 *   node generate-link.js "https://open.spotify.com/track/..." my-track.html
 */

const fs = require('fs');
const path = require('path');

// WebSocket is optional - only needed if Parachord is running
let WebSocket;
try {
  WebSocket = require('ws');
} catch (e) {
  // ws module not available - will skip Parachord resolution
}

// Service configurations
const SERVICES = {
  spotify: {
    name: 'Spotify',
    icon: '●',
    color: '#1DB954',
    searchUrl: (artist, track) => `https://open.spotify.com/search/${encodeURIComponent(`${artist} ${track}`)}`,
    embedUrl: (id) => `https://open.spotify.com/embed/track/${id}?utm_source=generator&theme=0`
  },
  apple: {
    name: 'Apple Music',
    icon: '●',
    color: '#FA243C',
    searchUrl: (artist, track) => `https://music.apple.com/search?term=${encodeURIComponent(`${artist} ${track}`)}`
  },
  youtube: {
    name: 'YouTube',
    icon: '▶',
    color: '#FF0000',
    searchUrl: (artist, track) => `https://www.youtube.com/results?search_query=${encodeURIComponent(`${artist} ${track}`)}`
  },
  youtubeMusic: {
    name: 'YouTube Music',
    icon: '●',
    color: '#FF0000',
    searchUrl: (artist, track) => `https://music.youtube.com/search?q=${encodeURIComponent(`${artist} ${track}`)}`
  },
  soundcloud: {
    name: 'SoundCloud',
    icon: '☁',
    color: '#FF5500',
    searchUrl: (artist, track) => `https://soundcloud.com/search?q=${encodeURIComponent(`${artist} ${track}`)}`
  },
  bandcamp: {
    name: 'Bandcamp',
    icon: '■',
    color: '#629AA9',
    searchUrl: (artist, track) => `https://bandcamp.com/search?q=${encodeURIComponent(`${artist} ${track}`)}`
  },
  deezer: {
    name: 'Deezer',
    icon: '◆',
    color: '#FEAA2D',
    searchUrl: (artist, track) => `https://www.deezer.com/search/${encodeURIComponent(`${artist} ${track}`)}`
  },
  tidal: {
    name: 'Tidal',
    icon: '◆',
    color: '#000000',
    searchUrl: (artist, track) => `https://tidal.com/search?q=${encodeURIComponent(`${artist} ${track}`)}`
  },
  amazon: {
    name: 'Amazon Music',
    icon: '◆',
    color: '#00A8E1',
    searchUrl: (artist, track) => `https://music.amazon.com/search/${encodeURIComponent(`${artist} ${track}`)}`
  }
};

// Connect to Parachord and search for track
const PARACHORD_WS_URL = 'ws://127.0.0.1:9876';

async function searchParachord(query) {
  return new Promise((resolve) => {
    // Skip if WebSocket not available
    if (!WebSocket) {
      resolve(null);
      return;
    }

    let resolved = false;

    try {
      const ws = new WebSocket(PARACHORD_WS_URL);
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          ws.close();
          resolve(null);
        }
      }, 10000);

      ws.on('open', () => {
        console.log('  Connected to Parachord, searching resolvers...');
        ws.send(JSON.stringify({
          type: 'embed',
          action: 'search',
          requestId: 'link-gen-' + Date.now(),
          payload: { query }
        }));
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'embed-response' && !resolved) {
            resolved = true;
            clearTimeout(timeout);
            ws.close();
            resolve(msg.results || []);
          }
        } catch (e) {
          // ignore parse errors
        }
      });

      ws.on('error', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve(null);
        }
      });

      ws.on('close', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve(null);
        }
      });
    } catch (e) {
      resolve(null);
    }
  });
}

// Map resolver results to service URLs
function mapResolverResults(results) {
  const serviceUrls = {};

  for (const track of results) {
    const resolverId = track.resolverId;

    // Map resolver IDs to services with direct URLs
    if (resolverId === 'spotify' && track.spotifyId) {
      serviceUrls.spotify = `https://open.spotify.com/track/${track.spotifyId}`;
    } else if (resolverId === 'youtube' && track.youtubeId) {
      serviceUrls.youtube = `https://www.youtube.com/watch?v=${track.youtubeId}`;
    } else if (resolverId === 'soundcloud' && track.soundcloudUrl) {
      serviceUrls.soundcloud = track.soundcloudUrl;
    } else if (resolverId === 'bandcamp' && track.bandcampUrl) {
      serviceUrls.bandcamp = track.bandcampUrl;
    } else if (resolverId === 'qobuz' && track.qobuzId) {
      serviceUrls.qobuz = `https://www.qobuz.com/track/${track.qobuzId}`;
    }
  }

  return serviceUrls;
}

// Parse Spotify URL to get track ID
function parseSpotifyUrl(url) {
  const match = url.match(/spotify\.com\/track\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

// Fetch track info from Spotify oEmbed API (no auth needed)
async function fetchSpotifyTrackInfo(trackId) {
  const oembedUrl = `https://open.spotify.com/oembed?url=https://open.spotify.com/track/${trackId}`;

  try {
    const response = await fetch(oembedUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();

    // Parse title which is usually "Track Name - Artist Name"
    const titleParts = data.title.split(' - ');
    const trackName = titleParts[0] || data.title;
    const artistName = titleParts.slice(1).join(' - ') || 'Unknown Artist';

    return {
      id: trackId,
      title: trackName,
      artist: artistName,
      albumArt: data.thumbnail_url,
      spotifyUrl: `https://open.spotify.com/track/${trackId}`,
      spotifyEmbed: data.html
    };
  } catch (error) {
    console.error('Failed to fetch Spotify track info:', error.message);
    return null;
  }
}

// Generate the HTML page
function generateHtml(track, options = {}) {
  const { enabledServices = Object.keys(SERVICES), resolvedUrls = {} } = options;

  const serviceLinks = enabledServices
    .map(id => {
      const service = SERVICES[id];
      if (!service) return '';

      // Use resolved URL if available, otherwise fall back to search URL
      let url;
      if (id === 'spotify') {
        url = track.spotifyUrl;
      } else if (resolvedUrls[id]) {
        url = resolvedUrls[id];
      } else {
        url = service.searchUrl(track.artist, track.title);
      }

      const isResolved = resolvedUrls[id] || id === 'spotify';

      return `
        <a href="${url}" target="_blank" rel="noopener" class="service-link ${isResolved ? 'resolved' : 'search'}" style="--service-color: ${service.color}">
          <span class="service-icon">${service.icon}</span>
          <span class="service-name">${service.name}</span>
          <span class="service-status">${isResolved ? '✓' : '🔍'}</span>
        </a>`;
    })
    .filter(link => link) // Remove empty entries
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${track.title} - ${track.artist} | Listen Now</title>

  <!-- Open Graph -->
  <meta property="og:title" content="${track.title} - ${track.artist}">
  <meta property="og:description" content="Listen to ${track.title} by ${track.artist}">
  <meta property="og:image" content="${track.albumArt}">
  <meta property="og:type" content="music.song">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${track.title} - ${track.artist}">
  <meta name="twitter:image" content="${track.albumArt}">

  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    :root {
      --bg: #0a0a0a;
      --surface: #141414;
      --surface-hover: #1f1f1f;
      --text: #ffffff;
      --text-secondary: #888888;
      --accent: #8b5cf6;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    .container {
      width: 100%;
      max-width: 400px;
    }

    /* Track Card */
    .track-card {
      background: var(--surface);
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    }

    .album-art {
      width: 100%;
      aspect-ratio: 1;
      background: #222;
      position: relative;
    }

    .album-art img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .track-info {
      padding: 20px;
      text-align: center;
    }

    .track-title {
      font-size: 1.5rem;
      font-weight: 700;
      margin-bottom: 4px;
    }

    .track-artist {
      color: var(--text-secondary);
      font-size: 1rem;
    }

    /* Parachord Mode */
    .parachord-controls {
      padding: 16px 20px;
      border-top: 1px solid rgba(255,255,255,0.1);
      display: none;
    }

    .parachord-controls.active {
      display: block;
    }

    .parachord-status {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      font-size: 0.875rem;
      color: var(--accent);
      margin-bottom: 12px;
    }

    .parachord-status::before {
      content: '';
      width: 8px;
      height: 8px;
      background: var(--accent);
      border-radius: 50%;
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    .play-button {
      width: 100%;
      padding: 14px;
      background: var(--accent);
      border: none;
      border-radius: 8px;
      color: white;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.1s, opacity 0.1s;
    }

    .play-button:hover {
      opacity: 0.9;
    }

    .play-button:active {
      transform: scale(0.98);
    }

    /* Service Links */
    .services {
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .services-header {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--text-secondary);
      margin-bottom: 8px;
    }

    .service-link {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      background: var(--surface-hover);
      border-radius: 8px;
      text-decoration: none;
      color: var(--text);
      transition: background 0.2s, transform 0.1s;
    }

    .service-link:hover {
      background: #2a2a2a;
      transform: translateX(4px);
    }

    .service-icon {
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--service-color);
      font-size: 1.25rem;
    }

    .service-name {
      flex: 1;
      font-weight: 500;
    }

    .service-status {
      color: var(--text-secondary);
      font-size: 0.875rem;
    }

    .service-link.resolved .service-status {
      color: #22c55e;
    }

    .service-link.search .service-status {
      opacity: 0.5;
    }

    /* Footer */
    .footer {
      text-align: center;
      padding: 20px;
      color: var(--text-secondary);
      font-size: 0.75rem;
    }

    .footer a {
      color: var(--accent);
      text-decoration: none;
    }

    /* Embed */
    .spotify-embed {
      padding: 0 20px 20px;
    }

    .spotify-embed iframe {
      width: 100%;
      border-radius: 12px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="track-card">
      <!-- Album Art -->
      <div class="album-art">
        <img src="${track.albumArt}" alt="${track.title}" />
      </div>

      <!-- Track Info -->
      <div class="track-info">
        <h1 class="track-title">${track.title}</h1>
        <p class="track-artist">${track.artist}</p>
      </div>

      <!-- Parachord Controls (shown when connected) -->
      <div class="parachord-controls" id="parachordControls">
        <div class="parachord-status">
          Connected to Parachord
        </div>
        <button class="play-button" id="playButton">
          ▶ Play in Parachord
        </button>
      </div>

      <!-- Spotify Embed (preview) -->
      <div class="spotify-embed">
        <iframe
          src="${SERVICES.spotify.embedUrl(track.id)}"
          width="100%"
          height="152"
          frameBorder="0"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          loading="lazy">
        </iframe>
      </div>

      <!-- Service Links -->
      <div class="services">
        <div class="services-header">Also available on</div>
        ${serviceLinks}
      </div>
    </div>

    <div class="footer">
      Powered by <a href="https://parachord.com">Parachord</a>
    </div>
  </div>

  <script>
    // Track data
    const TRACK = {
      id: '${track.id}',
      title: '${track.title.replace(/'/g, "\\'")}',
      artist: '${track.artist.replace(/'/g, "\\'")}',
      albumArt: '${track.albumArt}',
      spotifyUri: 'spotify:track:${track.id}',
      sources: {
        spotify: {
          spotifyUri: 'spotify:track:${track.id}',
          spotifyId: '${track.id}'
        }
      }
    };

    // Parachord connection
    const PARACHORD_WS_URL = 'ws://127.0.0.1:9876';
    let socket = null;
    let isConnected = false;

    function connect() {
      try {
        socket = new WebSocket(PARACHORD_WS_URL);

        socket.onopen = () => {
          console.log('[Link] Connected to Parachord');
          isConnected = true;
          document.getElementById('parachordControls').classList.add('active');
        };

        socket.onclose = () => {
          isConnected = false;
          document.getElementById('parachordControls').classList.remove('active');
          // Retry connection
          setTimeout(connect, 5000);
        };

        socket.onerror = () => {
          // Will trigger onclose
        };
      } catch (e) {
        setTimeout(connect, 5000);
      }
    }

    function sendMessage(message) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    }

    // Play button
    document.getElementById('playButton').addEventListener('click', () => {
      sendMessage({
        type: 'embed',
        action: 'play',
        requestId: 'play-' + Date.now(),
        payload: { track: TRACK }
      });

      // Update button
      const btn = document.getElementById('playButton');
      btn.textContent = '✓ Playing';
      setTimeout(() => {
        btn.textContent = '▶ Play in Parachord';
      }, 2000);
    });

    // Start connection
    connect();
  </script>
</body>
</html>`;
}

// Main
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
Parachord Link Generator

Usage:
  node generate-link.js <spotify-url> [output-file]
  node generate-link.js --manual "<title>" "<artist>" "<album-art-url>" "<spotify-id>" [output-file]

Examples:
  node generate-link.js "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT"
  node generate-link.js "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT" my-song.html
  node generate-link.js --manual "Bohemian Rhapsody" "Queen" "https://..." "4u7EnebtmKWzUH4xxxxx" song.html
`);
    process.exit(1);
  }

  let track;
  let outputFile;

  // Manual mode
  if (args[0] === '--manual') {
    if (args.length < 5) {
      console.error('Error: Manual mode requires: title, artist, album-art-url, spotify-id');
      process.exit(1);
    }
    track = {
      id: args[4],
      title: args[1],
      artist: args[2],
      albumArt: args[3],
      spotifyUrl: `https://open.spotify.com/track/${args[4]}`
    };
    outputFile = args[5] || 'link.html';
    console.log(`Using manual track info: "${track.title}" by ${track.artist}`);
  } else {
    // URL mode
    const url = args[0];
    outputFile = args[1] || 'link.html';

    // Parse URL
    const trackId = parseSpotifyUrl(url);
    if (!trackId) {
      console.error('Error: Invalid Spotify URL');
      console.error('Expected format: https://open.spotify.com/track/<track-id>');
      process.exit(1);
    }

    console.log(`Fetching track info for ${trackId}...`);

    // Fetch track info
    track = await fetchSpotifyTrackInfo(trackId);
    if (!track) {
      console.error('Error: Could not fetch track info from Spotify');
      console.error('');
      console.error('Try manual mode instead:');
      console.error(`  node generate-link.js --manual "Song Title" "Artist Name" "https://album-art-url" "${trackId}" output.html`);
      process.exit(1);
    }

    console.log(`Found: "${track.title}" by ${track.artist}`);
  }

  // Try to resolve actual service URLs via Parachord
  let resolvedUrls = {};
  console.log('\nSearching for track on streaming services...');

  const searchResults = await searchParachord(`${track.artist} ${track.title}`);
  if (searchResults && searchResults.length > 0) {
    console.log(`  Found ${searchResults.length} results from Parachord resolvers`);
    resolvedUrls = mapResolverResults(searchResults);

    const resolvedCount = Object.keys(resolvedUrls).length;
    if (resolvedCount > 0) {
      console.log(`  Resolved direct links for: ${Object.keys(resolvedUrls).join(', ')}`);
    }
  } else {
    console.log('  Parachord not running or no results - using search URLs as fallback');
  }

  // Generate HTML
  const html = generateHtml(track, { resolvedUrls });

  // Write file
  const outputPath = path.resolve(outputFile);
  fs.writeFileSync(outputPath, html);

  console.log(`\n✅ Generated: ${outputPath}`);
  console.log(`\nOpen in browser to test, or upload to any web host.`);
}

main().catch(console.error);
