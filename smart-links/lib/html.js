// Shared HTML generation functions for smart links

// SVG icons for each streaming service
const SERVICE_ICONS = {
  spotify: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>`,
  appleMusic: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.994 6.124a9.23 9.23 0 00-.24-2.19c-.317-1.31-1.062-2.31-2.18-3.043a5.022 5.022 0 00-1.877-.726 10.496 10.496 0 00-1.564-.15c-.04-.003-.083-.01-.124-.013H5.986c-.152.01-.303.017-.455.026-.747.043-1.49.123-2.193.4-1.336.53-2.3 1.452-2.865 2.78-.192.448-.292.925-.363 1.408-.056.392-.088.785-.1 1.18 0 .032-.007.062-.01.093v12.223c.01.14.017.283.027.424.05.815.154 1.624.497 2.373.65 1.42 1.738 2.353 3.234 2.801.42.127.856.187 1.293.228.555.053 1.11.06 1.667.06h11.03a12.5 12.5 0 001.57-.1c.822-.106 1.596-.35 2.295-.81a5.046 5.046 0 001.88-2.207c.186-.42.293-.87.37-1.324.113-.675.138-1.358.137-2.04-.002-3.8 0-7.595-.003-11.393zm-6.423 3.99v5.712c0 .417-.058.827-.244 1.206-.29.59-.76.962-1.388 1.14-.35.1-.706.157-1.07.173-.95.042-1.785-.49-2.07-1.378-.3-.93.1-1.95 1.058-2.403.378-.178.79-.263 1.2-.334.494-.086.99-.16 1.478-.26.238-.048.46-.137.6-.34.09-.132.126-.282.126-.44V8.15c0-.23-.07-.42-.293-.49-.116-.035-.238-.03-.36-.01-.36.06-.72.13-1.078.19l-3.58.64c-.056.01-.112.024-.168.033-.28.048-.4.187-.42.47 0 .062-.004.124-.004.187V17.1c0 .454-.05.9-.252 1.312-.302.617-.79.998-1.448 1.17-.343.09-.693.13-1.048.142-.988.024-1.834-.528-2.104-1.453-.27-.93.15-1.932 1.096-2.37.376-.17.778-.25 1.182-.32.484-.084.97-.156 1.452-.25.263-.05.508-.15.65-.38.074-.12.106-.26.106-.4V5.624c0-.194.028-.38.143-.546.16-.233.4-.337.662-.39.113-.024.228-.038.34-.054l5.03-.903 1.61-.292c.168-.028.34-.058.508-.06.242-.003.4.1.47.338.03.1.04.2.04.3v5.99l.002.05z"/></svg>`,
  youtube: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`,
  soundcloud: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M1.175 12.225c-.051 0-.094.046-.101.1l-.233 2.154.233 2.105c.007.058.05.098.101.098.05 0 .09-.04.099-.098l.255-2.105-.27-2.154c-.009-.06-.052-.1-.102-.1m-.899.828c-.06 0-.091.037-.104.094L0 14.479l.165 1.308c.014.057.045.094.09.094s.089-.037.099-.094l.19-1.308-.18-1.334c-.01-.057-.054-.09-.09-.09m1.83-1.229c-.06 0-.12.045-.12.104l-.21 2.563.225 2.458c0 .06.045.104.105.104.074 0 .12-.044.135-.104l.24-2.474-.24-2.547c-.015-.06-.06-.104-.12-.104m.945-.089c-.075 0-.135.06-.15.135l-.193 2.64.21 2.544c.016.077.075.138.149.138.075 0 .135-.061.15-.15l.24-2.532-.24-2.623c0-.075-.06-.135-.135-.15m1.065.202c-.09 0-.149.074-.165.164l-.165 2.445.18 2.52c.016.104.075.164.165.164.089 0 .149-.06.164-.164l.209-2.52-.21-2.474a.174.174 0 00-.164-.164m1.065-.247c-.104 0-.179.09-.179.194l-.15 2.459.165 2.473c0 .12.075.193.18.193.104 0 .179-.073.193-.193l.181-2.49-.181-2.459c-.014-.089-.089-.177-.194-.177m1.095-.165c-.119 0-.209.09-.209.21l-.135 2.46.149 2.413c.016.12.09.209.21.209.105 0 .194-.089.21-.209l.164-2.413-.164-2.475a.216.216 0 00-.21-.21m1.214-.28c-.135 0-.239.105-.239.24l-.12 2.602.135 2.369c0 .149.104.254.239.254.12 0 .239-.105.254-.254l.15-2.384-.15-2.588c-.015-.135-.12-.24-.255-.24m1.095-.252c-.135 0-.255.12-.27.27l-.104 2.595.119 2.324c.016.149.135.27.27.27.149 0 .27-.12.284-.27l.135-2.339-.135-2.58a.278.278 0 00-.284-.27m1.155-.165c-.164 0-.284.135-.284.285l-.105 2.58.12 2.249c0 .165.12.3.285.3.149 0 .284-.12.284-.285l.135-2.264-.135-2.565c-.015-.165-.135-.3-.285-.3m1.14-.21c-.18 0-.315.149-.315.33v.015l-.09 2.624.104 2.175c0 .18.135.33.315.33.165 0 .315-.15.315-.33l.12-2.19-.12-2.61a.327.327 0 00-.315-.33m1.11-.195c-.195 0-.345.165-.36.36l-.074 2.503.09 2.085c.015.194.165.359.36.359.18 0 .344-.164.359-.359l.104-2.085-.104-2.503c-.015-.195-.165-.36-.36-.36m1.125-.12c-.21 0-.375.18-.375.39l-.06 2.46.074 1.98c.016.209.166.389.375.389.195 0 .36-.18.375-.39l.09-1.979-.09-2.46c-.015-.21-.18-.39-.375-.39m1.156-.165c-.225 0-.405.195-.405.42l-.044 2.461.06 1.935c0 .225.18.42.404.42.21 0 .391-.195.405-.42l.075-1.935-.075-2.461c-.015-.225-.195-.42-.405-.42m1.395-.06c-.12 0-.225.045-.315.135-.075.075-.12.18-.12.3l-.03 2.39.045 1.875c0 .24.195.435.435.435.225 0 .42-.195.435-.435l.06-1.875-.074-2.39c-.015-.24-.21-.435-.436-.435m1.17-.104c-.255 0-.45.21-.45.465l-.045 2.31.045 1.845c0 .254.195.465.45.465.24 0 .45-.21.45-.465l.06-1.845-.06-2.31c0-.255-.21-.465-.45-.465m1.44-.03c-.269 0-.479.225-.494.494l-.03 2.145.03 1.755c0 .27.225.495.495.495.254 0 .479-.225.479-.495l.045-1.755-.045-2.145c-.015-.27-.24-.495-.495-.495m1.125-.075c-.27 0-.51.24-.51.525l-.015 2.115.03 1.68c0 .285.24.525.51.525.284 0 .51-.24.524-.525l.03-1.68-.03-2.115c-.015-.285-.255-.525-.525-.525m2.115.584c-.21-.089-.45-.134-.705-.134-.21 0-.42.03-.615.09-.195-.735-.735-1.305-1.455-1.5-.195-.06-.405-.09-.615-.09-1.005 0-1.845.735-2.025 1.71-5.175.075-6.27 4.455-6.27 5.745 0 2.115 1.71 3.825 3.84 3.825h7.83c1.575 0 2.85-1.275 2.85-2.85 0-1.575-1.275-2.85-2.85-2.85"/></svg>`,
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
      <a href="${escapeHtml(url)}" onclick="window.open(this.href, '${s.id}', 'width=1024,height=768,menubar=no,toolbar=no,location=yes,status=no'); return false;" class="service-link" style="--service-color: ${s.color}">
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
