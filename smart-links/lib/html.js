// Shared HTML generation functions for smart links

// Official service logos - same SVG paths used in Parachord app
const SERVICE_ICONS = {
  spotify: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>`,
  appleMusic: `<svg viewBox="0 0 361 361" fill="currentColor"><path d="M263.54,234.26c0,4.56-0.04,8.7-1,13.26c-0.93,4.43-2.63,8.6-5.24,12.35c-2.61,3.74-5.95,6.81-9.85,9.11c-3.95,2.33-8.08,3.66-12.5,4.55c-8.3,1.67-13.97,2.05-19.31,0.98c-5.14-1.03-9.5-3.4-12.99-6.6c-5.17-4.74-8.39-11.14-9.09-17.82c-0.82-7.84,1.79-16.21,7.67-22.38c2.97-3.11,6.7-5.57,11.68-7.51c5.21-2.02,10.96-3.23,19.8-5.01c2.33-0.47,4.66-0.94,6.99-1.41c3.06-0.62,5.69-1.4,7.81-3.99c2.13-2.61,2.17-5.78,2.17-8.92l0-79.29c0-6.07-2.72-7.72-8.52-6.61c-4.14,0.81-93.09,18.75-93.09,18.75c-5.02,1.21-6.78,2.85-6.78,9.08l0,116.15c0,4.56-0.24,8.7-1.19,13.26c-0.93,4.43-2.63,8.6-5.24,12.35c-2.61,3.74-5.95,6.81-9.85,9.11c-3.95,2.33-8.08,3.72-12.5,4.61c-8.3,1.67-13.97,2.05-19.31,0.98c-5.14-1.03-9.5-3.47-12.99-6.66c-5.17-4.74-8.17-11.14-8.88-17.82c-0.82-7.84,1.57-16.21,7.46-22.38c2.97-3.11,6.7-5.57,11.68-7.51c5.21-2.02,10.96-3.23,19.8-5.01c2.33-0.47,4.66-0.94,6.99-1.41c3.06-0.62,5.69-1.4,7.81-3.99c2.12-2.59,2.37-5.64,2.37-8.76c0-24.6,0-133.92,0-133.92c0-1.8,0.15-3.02,0.24-3.62c0.43-2.82,1.56-5.24,3.6-6.95c1.7-1.42,3.88-2.41,6.67-3l0.04-0.01l107-21.59c0.93-0.19,8.66-1.56,9.53-1.64c5.78-0.5,9.03,3.3,9.03,9.46V234.26z"/></svg>`,
  youtube: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`,
  soundcloud: `<img src="/assets/icons/soundcloud-icon-white.png" alt="SoundCloud" style="width:20px;height:20px;object-fit:contain;"/>`,
  bandcamp: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M0 18.75l7.437-13.5H24l-7.438 13.5H0z"/></svg>`,
  tidal: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.012 3.992L8.008 7.996 4.004 3.992 0 7.996 4.004 12l4.004-4.004L12.012 12l-4.004 4.004 4.004 4.004 4.004-4.004L12.012 12l4.004-4.004-4.004-4.004zm4.004 4.004l4.004-4.004L24.024 7.996l-4.004 4.004-4.004-4.004z"/></svg>`,
  deezer: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.81 4.16v3.03H24V4.16h-5.19zM6.27 8.38v3.027h5.189V8.38h-5.19zm12.54 0v3.027H24V8.38h-5.19zM6.27 12.594v3.027h5.189v-3.027h-5.19zm6.27 0v3.027h5.19v-3.027h-5.19zm6.27 0v3.027H24v-3.027h-5.19zM0 16.81v3.029h5.19v-3.03H0zm6.27 0v3.029h5.189v-3.03h-5.19zm6.27 0v3.029h5.19v-3.03h-5.19zm6.27 0v3.029H24v-3.03h-5.19z"/></svg>`
};

const SERVICES = [
  { id: 'spotify', name: 'Spotify', color: '#1DB954' },
  { id: 'appleMusic', name: 'Apple Music', color: '#FA243C' },
  { id: 'youtube', name: 'YouTube', color: '#FF0000' },
  { id: 'soundcloud', name: 'SoundCloud', color: '#FF5500' },
  { id: 'bandcamp', name: 'Bandcamp', color: '#1DA0C3' },
  { id: 'tidal', name: 'Tidal', color: '#00FFFF' },
  { id: 'deezer', name: 'Deezer', color: '#FF0092' }
];

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function generateLinkPageHtml(data, linkId, baseUrl) {
  const { title, artist, albumArt, type, urls } = data;
  const fullTitle = `${escapeHtml(title)}${artist ? ' - ' + escapeHtml(artist) : ''}`;
  const linkUrl = `${baseUrl}/${linkId}`;

  const serviceLinksHtml = SERVICES.map(s => {
    const url = urls?.[s.id];
    if (!url) return '';
    return `
      <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="service-link" style="--service-color: ${s.color}">
        <span class="service-icon">${SERVICE_ICONS[s.id]}</span>
        <span class="service-name">${s.name}</span>
      </a>`;
  }).filter(Boolean).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${fullTitle} | Listen Now</title>
  <meta property="og:title" content="${fullTitle}">
  <meta property="og:description" content="Listen on your favorite streaming service">
  <meta property="og:type" content="music.${type === 'album' ? 'album' : 'song'}">
  ${albumArt ? `<meta property="og:image" content="${escapeHtml(albumArt)}">` : ''}
  <meta property="og:url" content="${linkUrl}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${fullTitle}">
  <meta name="twitter:description" content="Listen on your favorite streaming service">
  ${albumArt ? `<meta name="twitter:image" content="${escapeHtml(albumArt)}">` : ''}
  <link rel="alternate" type="application/json+oembed"
        href="${baseUrl}/api/oembed?url=${encodeURIComponent(linkUrl)}"
        title="${fullTitle}">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg-primary: #0f0f0f;
      --bg-secondary: #1a1a1a;
      --text-primary: #ffffff;
      --text-secondary: #a0a0a0;
      --accent: #8b5cf6;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      max-width: 400px;
      width: 100%;
      text-align: center;
    }
    .album-art {
      width: 200px;
      height: 200px;
      border-radius: 8px;
      margin-bottom: 20px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      object-fit: cover;
    }
    .album-art-placeholder {
      width: 200px;
      height: 200px;
      border-radius: 8px;
      margin-bottom: 20px;
      background: var(--bg-secondary);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 48px;
      color: var(--text-secondary);
    }
    h1 {
      font-size: 1.5rem;
      margin-bottom: 8px;
      font-weight: 600;
    }
    .artist {
      color: var(--text-secondary);
      margin-bottom: 24px;
    }
    .services {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .service-link {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 20px;
      background: var(--bg-secondary);
      border-radius: 8px;
      text-decoration: none;
      color: var(--text-primary);
      transition: all 0.2s ease;
      border: 1px solid transparent;
    }
    .service-link:hover {
      border-color: var(--service-color);
      transform: translateY(-2px);
    }
    .service-icon {
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .service-icon svg {
      width: 20px;
      height: 20px;
      color: var(--service-color);
    }
    .service-name {
      font-weight: 500;
    }
    .footer {
      margin-top: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      color: var(--text-secondary);
      font-size: 0.85rem;
    }
    .footer a {
      display: inline-flex;
      align-items: center;
      opacity: 0.7;
      transition: opacity 0.2s;
    }
    .footer a:hover {
      opacity: 1;
    }
    .footer img {
      height: 18px;
      width: auto;
    }
    .parachord-section {
      margin-top: 24px;
      padding-top: 24px;
      border-top: 1px solid var(--bg-secondary);
    }
    .parachord-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 12px 24px;
      background: var(--accent);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.2s ease;
    }
    .parachord-btn:hover {
      filter: brightness(1.1);
      transform: translateY(-2px);
    }
    .parachord-btn.hidden { display: none; }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #22c55e;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
  </style>
</head>
<body>
  <div class="container">
    ${albumArt
      ? `<img src="${escapeHtml(albumArt)}" alt="Album Art" class="album-art">`
      : `<div class="album-art-placeholder">♪</div>`
    }
    <h1>${escapeHtml(title)}</h1>
    ${artist ? `<p class="artist">${escapeHtml(artist)}</p>` : ''}

    <div class="services">
      ${serviceLinksHtml}
    </div>

    <div class="parachord-section">
      <button id="parachord-btn" class="parachord-btn hidden" onclick="playInParachord()">
        <span class="status-dot"></span>
        Play in Parachord
      </button>
    </div>

    <div class="footer">
      <span>Powered by</span>
      <a href="https://parachord.com" target="_blank" rel="noopener">
        <img src="https://parachord.com/assets/logo-wordmark.png" alt="Parachord" />
      </a>
    </div>
  </div>

  <script>
    const trackData = ${JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')};
    let ws = null;

    function connectToParachord() {
      try {
        ws = new WebSocket('ws://localhost:9876');
        ws.onopen = () => {
          document.getElementById('parachord-btn').classList.remove('hidden');
        };
        ws.onclose = () => {
          document.getElementById('parachord-btn').classList.add('hidden');
          setTimeout(connectToParachord, 3000);
        };
        ws.onerror = () => {
          ws.close();
        };
      } catch (e) {
        setTimeout(connectToParachord, 3000);
      }
    }

    function playInParachord() {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'embed', action: 'play', payload: { track: trackData } }));
      }
    }

    connectToParachord();
  </script>
</body>
</html>`;
}

export function generateEmbedHtml(data, linkId, baseUrl) {
  const { title, artist, albumArt, urls } = data;
  const linkUrl = `${baseUrl}/${linkId}`;

  // Find the first available service URL for fallback
  const firstUrl = SERVICES.map(s => urls?.[s.id]).find(Boolean);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a1a;
      color: #fff;
      height: 152px;
      overflow: hidden;
    }
    .embed {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 16px;
      height: 100%;
    }
    .art {
      width: 120px;
      height: 120px;
      border-radius: 6px;
      object-fit: cover;
      flex-shrink: 0;
    }
    .art-placeholder {
      width: 120px;
      height: 120px;
      border-radius: 6px;
      background: #2a2a2a;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 32px;
      color: #666;
      flex-shrink: 0;
    }
    .info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .title {
      font-size: 16px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .artist {
      font-size: 14px;
      color: #a0a0a0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .actions {
      display: flex;
      gap: 8px;
      margin-top: 8px;
    }
    .btn {
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 500;
      text-decoration: none;
      transition: all 0.2s;
      cursor: pointer;
      border: none;
    }
    .btn-primary {
      background: #8b5cf6;
      color: #fff;
    }
    .btn-primary:hover {
      filter: brightness(1.1);
    }
    .btn-secondary {
      background: #333;
      color: #fff;
    }
    .btn-secondary:hover {
      background: #444;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #22c55e;
      display: inline-block;
      margin-right: 6px;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .btn-connected {
      background: #22c55e;
    }
  </style>
</head>
<body>
  <div class="embed">
    ${albumArt
      ? `<img src="${escapeHtml(albumArt)}" alt="" class="art">`
      : `<div class="art-placeholder">♪</div>`
    }
    <div class="info">
      <div class="title">${escapeHtml(title)}</div>
      ${artist ? `<div class="artist">${escapeHtml(artist)}</div>` : ''}
      <div class="actions">
        <button id="play-btn" class="btn btn-primary" onclick="playTrack()">Play</button>
        <a href="${linkUrl}" target="_blank" class="btn btn-secondary">More</a>
      </div>
    </div>
  </div>
  <script>
    const trackData = {
      title: ${JSON.stringify(title || '')},
      artist: ${JSON.stringify(artist || '')},
      albumArt: ${JSON.stringify(albumArt || null)},
      urls: ${JSON.stringify(urls || {})}
    };
    const fallbackUrl = ${JSON.stringify(firstUrl || '')};
    let ws = null;
    let parachordConnected = false;

    function updatePlayButton() {
      const btn = document.getElementById('play-btn');
      if (parachordConnected) {
        btn.innerHTML = '<span class="status-dot"></span>Play';
        btn.classList.add('btn-connected');
      } else {
        btn.innerHTML = 'Play';
        btn.classList.remove('btn-connected');
      }
    }

    function connectToParachord() {
      try {
        ws = new WebSocket('ws://localhost:9876');
        ws.onopen = () => {
          parachordConnected = true;
          updatePlayButton();
        };
        ws.onclose = () => {
          parachordConnected = false;
          updatePlayButton();
          setTimeout(connectToParachord, 3000);
        };
        ws.onerror = () => {
          ws.close();
        };
      } catch (e) {
        setTimeout(connectToParachord, 3000);
      }
    }

    function playTrack() {
      if (parachordConnected && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'embed', action: 'play', payload: { track: trackData } }));
      } else if (fallbackUrl) {
        window.open(fallbackUrl, '_blank');
      }
    }

    connectToParachord();
  </script>
</body>
</html>`;
}
