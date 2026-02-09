// Shared HTML generation functions for smart links

const SERVICES = [
  { id: 'spotify', name: 'Spotify', color: '#1DB954', icon: '●' },
  { id: 'appleMusic', name: 'Apple Music', color: '#FA243C', icon: '♪' },
  { id: 'youtube', name: 'YouTube', color: '#FF0000', icon: '▶' },
  { id: 'soundcloud', name: 'SoundCloud', color: '#FF5500', icon: '☁' },
  { id: 'bandcamp', name: 'Bandcamp', color: '#629AA9', icon: '♫' },
  { id: 'tidal', name: 'Tidal', color: '#000000', icon: '◆' },
  { id: 'deezer', name: 'Deezer', color: '#FF0092', icon: '◉' }
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
      <a href="${escapeHtml(url)}" onclick="window.open(this.href, '${s.id}', 'width=1024,height=768,menubar=no,toolbar=no,location=yes,status=no'); return false;" class="service-link" style="--service-color: ${s.color}">
        <span class="service-icon">${s.icon}</span>
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
      font-size: 1.2rem;
      color: var(--service-color);
      width: 24px;
      text-align: center;
    }
    .service-name {
      font-weight: 500;
    }
    .footer {
      margin-top: 32px;
      color: var(--text-secondary);
      font-size: 0.85rem;
    }
    .footer a {
      color: var(--accent);
      text-decoration: none;
    }
    .footer a:hover {
      text-decoration: underline;
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
      <p>Powered by <a href="https://parachord.app" onclick="window.open(this.href, 'parachord', 'width=1024,height=768'); return false;">Parachord</a></p>
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

  // Find the first available service URL for the play button
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
        ${firstUrl ? `<a href="${escapeHtml(firstUrl)}" target="_blank" class="btn btn-primary">Play</a>` : ''}
        <a href="${linkUrl}" target="_blank" class="btn btn-secondary">More</a>
      </div>
    </div>
  </div>
</body>
</html>`;
}
